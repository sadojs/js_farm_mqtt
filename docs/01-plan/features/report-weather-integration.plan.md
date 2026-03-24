# Plan: 리포트 조회 버그 수정 + 날씨 데이터 통합

## Feature ID
`report-weather-integration`

## Date
2026-02-22

---

## 1. 배경

리포트 화면에서 기간을 선택하고 조회 버튼을 눌러도 데이터가 조회되지 않는 버그가 존재함. 추가로 사용자 농장 위치의 날씨 정보(기상청 API)를 시간 단위로 DB에 저장하고, 리포트에서 센서 데이터와 날씨 데이터를 비교 표시하는 기능을 구현해야 함.

---

## 2. 요구사항

### FR-01: 리포트 기간 조회 버그 수정
- **문제 원인**: `selectPeriod('custom')` 호출 시 `updateDateRange()`와 `loadAllData()`가 호출되지 않음. 사용자가 날짜를 선택하고 "조회" 버튼을 클릭하면 `loadAllData()`만 호출되는데, `startDate`/`endDate`가 `customStartDate`/`customEndDate`에서 변환되지 않아 빈 값으로 즉시 `return`됨
- **위치**: `Reports.vue` L397-402, L435-436
- **수정**: "조회" 버튼 클릭 시 `updateDateRange()` 호출 후 `loadAllData()` 실행

### FR-02: 날씨 데이터 시간 단위 DB 저장
- **대상**: 백엔드 새 모듈 또는 기존 dashboard 모듈 확장
- **내용**:
  - `weather_data` 테이블 생성 (TimescaleDB Hypertable)
  - 1시간마다 기상청 초단기실황 API를 호출하여 온도/습도/강수량/풍속 저장
  - NestJS `@nestjs/schedule` 크론잡으로 자동 수집
  - 사용자별 주소 기반으로 해당 좌표의 날씨 데이터 저장

### FR-03: 리포트 날씨 데이터 조회 API
- **대상**: `reports.controller.ts`, `reports.service.ts`
- **내용**:
  - `GET /reports/weather-hourly` 엔드포인트 추가
  - startDate/endDate 기간에 해당하는 시간 단위 날씨 데이터 반환
  - 응답: `{ time, temperature, humidity, precipitation, windSpeed }`

### FR-04: 센서 타입 선택 UI 변경 + 날씨 비교 차트
- **대상**: `Reports.vue`
- **AS-IS**:
  - `온/습도` - 센서 온도+습도 차트
  - `온도` - 센서 온도 차트
  - `습도` - 센서 습도 차트
- **TO-BE**:
  - `온/습도` - 날씨(실외) 온/습도 vs 센서(실내) 온/습도 비교 차트
  - `온도` - 날씨 온도 vs 센서 온도 비교 차트
  - `습도` - 날씨 습도 vs 센서 습도 비교 차트
- **차트 표시**: 각 타입 선택 시 센서 데이터 라인 + 날씨 데이터 라인을 동시에 표시 (실선: 센서, 점선: 날씨)

---

## 3. 기술 결정

### 3-1. weather_data 테이블 설계

```sql
CREATE TABLE weather_data (
  time TIMESTAMPTZ NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  temperature DECIMAL(5, 2),    -- 기온 (°C)
  humidity DECIMAL(5, 2),       -- 습도 (%)
  precipitation DECIMAL(5, 2),  -- 강수량 (mm)
  wind_speed DECIMAL(5, 2),     -- 풍속 (m/s)
  condition VARCHAR(20),        -- 'clear', 'rain' 등
  nx INT,                       -- 기상청 격자 X
  ny INT                        -- 기상청 격자 Y
);

SELECT create_hypertable('weather_data', 'time');
CREATE INDEX idx_weather_data_user ON weather_data(user_id, time DESC);
```

- TimescaleDB Hypertable로 시계열 최적화
- 사용자별로 저장 (주소가 다를 수 있으므로)
- 기존 `sensor_data`와 동일한 time 기반 조회 패턴

### 3-2. 크론잡 스케줄러

```
@nestjs/schedule의 @Cron('0 * * * *') 사용 (매 정시)
```

- 모든 활성 사용자의 주소에 대해 기상청 API 호출
- 기존 `DashboardService.getWeatherForUser()` 로직 재사용
- 동일 시간대 중복 저장 방지 (UPSERT 또는 존재 여부 확인)

### 3-3. 날씨 vs 센서 비교 차트

- **센서 데이터**: 기존 `reportApi.getHourlyData()` (실선)
- **날씨 데이터**: 새 `reportApi.getWeatherHourly()` (점선)
- **범례**: "실내 온도" / "외부 온도 (날씨)", "실내 습도" / "외부 습도 (날씨)"
- **라인 스타일**: 센서=실선, 날씨=점선 (`borderDash: [5, 5]`)

---

## 4. 수정 대상 파일

| # | File | FR | 변경 내용 |
|---|------|-----|----------|
| 1 | `Reports.vue` | FR-01 | "조회" 버튼에 `updateDateRange()` 호출 추가 |
| 2 | `backend/database/schema.sql` | FR-02 | `weather_data` 테이블 DDL 추가 |
| 3 | `backend/src/modules/weather/weather-data.entity.ts` | FR-02 | WeatherData 엔티티 (신규) |
| 4 | `backend/src/modules/weather/weather.module.ts` | FR-02 | 날씨 모듈 (신규) |
| 5 | `backend/src/modules/weather/weather-collector.service.ts` | FR-02 | 크론잡 수집 서비스 (신규) |
| 6 | `backend/src/modules/reports/reports.controller.ts` | FR-03 | `GET /reports/weather-hourly` 엔드포인트 추가 |
| 7 | `backend/src/modules/reports/reports.service.ts` | FR-03 | `getWeatherHourly()` 쿼리 메서드 추가 |
| 8 | `frontend/src/api/report.api.ts` | FR-03 | `getWeatherHourly()` API 함수 추가 |
| 9 | `Reports.vue` sensorTypeOptions | FR-04 | 라벨 변경 + 날씨 데이터 로드 |
| 10 | `Reports.vue` 차트 로직 | FR-04 | 날씨 데이터 라인(점선) 추가, 범례 변경 |
| 11 | `backend/src/app.module.ts` | FR-02 | WeatherModule import 추가 |

**신규 파일**: 3개 (entity, module, service)
**백엔드 변경**: 5개 파일
**프론트엔드 변경**: 2개 파일

---

## 5. 구현 순서 (7 Phase)

### Phase 1: 리포트 조회 버그 수정 (FR-01)
| Step | 파일 | 작업 |
|------|------|------|
| 1-1 | Reports.vue | "조회" 버튼 `@click`에 `updateDateRange()` 호출 추가 후 `loadAllData()` |

### Phase 2: weather_data DB 테이블 + 엔티티 (FR-02)
| Step | 파일 | 작업 |
|------|------|------|
| 2-1 | schema.sql | `weather_data` 테이블 DDL + Hypertable + 인덱스 추가 |
| 2-2 | weather-data.entity.ts | WeatherData TypeORM 엔티티 생성 |

### Phase 3: 날씨 수집 크론잡 (FR-02)
| Step | 파일 | 작업 |
|------|------|------|
| 3-1 | weather-collector.service.ts | 크론잡 서비스: 매시간 모든 사용자 날씨 수집, DashboardService 로직 재사용 |
| 3-2 | weather.module.ts | WeatherModule 정의 (ScheduleModule, TypeORM) |
| 3-3 | app.module.ts | WeatherModule import 추가 |

### Phase 4: 날씨 조회 API (FR-03)
| Step | 파일 | 작업 |
|------|------|------|
| 4-1 | reports.service.ts | `getWeatherHourly(userId, params)` 쿼리 추가 |
| 4-2 | reports.controller.ts | `GET /reports/weather-hourly` 엔드포인트 추가 |

### Phase 5: 프론트엔드 API + 데이터 로드 (FR-03, FR-04)
| Step | 파일 | 작업 |
|------|------|------|
| 5-1 | report.api.ts | `getWeatherHourly()` API 함수 추가 |
| 5-2 | Reports.vue | `loadAllData()`에 날씨 데이터 로드 추가 (4번째 Promise.all 항목) |

### Phase 6: 센서 타입 UI + 비교 차트 (FR-04)
| Step | 파일 | 작업 |
|------|------|------|
| 6-1 | Reports.vue | sensorTypeOptions 라벨 수정 |
| 6-2 | Reports.vue | 차트 로직: 날씨 데이터 라인(점선) 추가, 범례 "실내/외부" 구분 |
| 6-3 | Reports.vue | 통계 카드에 외부 온도/습도 추가 (선택사항) |

### Phase 7: 빌드 검증
| Step | 작업 |
|------|------|
| 7-1 | 프론트엔드 `npm run build` (vue-tsc + vite) 통과 확인 |
| 7-2 | 백엔드 `npm run build` (NestJS) 통과 확인 |

---

## 6. 영향도 분석

| 항목 | 영향 |
|------|------|
| 신규 의존성 | `@nestjs/schedule` (이미 설치 여부 확인 필요) |
| DB 변경 | `weather_data` 테이블 1개 추가 (마이그레이션 필요) |
| 기존 API | 변경 없음 (새 엔드포인트만 추가) |
| 기존 UI | 센서 타입 라벨 변경, 차트에 라인 추가 |
| 성능 | 크론잡 매시간 실행, 사용자 수 × API 호출 (rate limit 주의) |
| 기상청 API | 기존 DashboardService와 동일 API 사용, 호출 빈도 증가 |

---

## 7. 참고 자료
- 기상청 초단기실황 API: 기존 `DashboardService` (`getUltraSrtNcst`)
- TimescaleDB Hypertable: 기존 `sensor_data` 테이블 패턴 재사용
- Chart.js 점선 스타일: `borderDash: [5, 5]` 옵션
