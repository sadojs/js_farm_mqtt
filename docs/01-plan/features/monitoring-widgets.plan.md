# Plan: monitoring-widgets

> 대시보드 실시간 환경 모니터링 위젯 7종 추가

## 1. 개요

현재 대시보드는 KMA 기상 API 날씨 카드(외부 기온/습도/풍속/강수량)와 장비/센서 요약 카드만 표시한다.
이를 확장하여 **농업 환경 분석 위젯 7종**을 추가, 실시간 내부/외부 환경 비교 및 의사결정 지원 정보를 제공한다.

### 현재 상태 (AS-IS)

| 영역 | 내용 |
|------|------|
| 날씨 카드 | KMA API 외부 기온/습도/풍속/강수량 |
| SummaryCards | 장비 목록 + 센서 현황 + 요약(전체장비/그룹/자동화/온라인) |
| 센서 데이터 | 5분 주기 TimescaleDB 수집 (sensor_data 테이블) |
| 수집 필드 | temperature, humidity, co2, rainfall, uv, dew_point |

### 목표 상태 (TO-BE)

| 위젯 | 표시 | 필요 데이터 |
|------|------|------------|
| 1. 내부 VPD | 값(kPa) + LOW/OK/HIGH 배지 | 내부 온도, 내부 습도 |
| 2. 환기 필요 스코어 | 점수 + Normal/Recommended/Urgent | 내부/외부 온도, 내부/외부 습도 |
| 3. 온도 상승속도 | 10분 변화량(°C) + 상태 | 내부 온도 현재 + 10분 전 |
| 4. 습도 변화율 | 10분 변화량(%) + 상태 | 내부 습도 현재 + 10분 전 |
| 5. 외부 대비 내부 | ΔT, ΔRH + 게이지 | 내부/외부 온도, 내부/외부 습도 |
| 6. UV 위험도 | 카테고리 + 라벨 | uv 센서 데이터 |
| 7. 환경 상태 점수 | 0~100 + 상태색 | VPD, 온도, UV, (이슬점) |

## 2. 센서 가용성 분석

### 현재 보유 센서 (수정됨)

| 장비 | 카테고리 | 수집 필드 | 실제 역할 |
|------|----------|----------|----------|
| qxj | **하우스 내부** 센서 | temperature, humidity, rainfall, uv, dew_point | 온실 내부 온습도 + 기상 관측 |
| hjjcy | CO2 전용 | ~~temperature, humidity~~, co2 | CO2만 사용 (온습도 미사용) |

### 외부 날씨 데이터 소스

| 소스 | 제공 필드 | 비고 |
|------|----------|------|
| KMA 초단기실황 API | temperature (T1H), humidity (REH) | 기존 `GET /dashboard/weather` 재사용 |

### 위젯별 데이터 매핑

| 요구 필드 | 매핑 소스 | 비고 |
|-----------|----------|------|
| `inside_temp_c` | qxj → sensor_type='temperature' | qxj = 하우스 내부 센서 |
| `inside_rh_pct` | qxj → sensor_type='humidity' | qxj = 하우스 내부 센서 |
| `outside_temp_c` | **KMA 날씨 API** → weather.temperature | 기존 dashboard/weather 엔드포인트 |
| `outside_rh_pct` | **KMA 날씨 API** → weather.humidity | 기존 dashboard/weather 엔드포인트 |
| `uv` / `uv_index` | qxj → sensor_type='uv' | Tuya 코드 `uv_index`(정수) |
| `inside_dewpoint_c` | qxj → sensor_type='dew_point' | qxj가 직접 측정 (Tuya `dew_point_temp`) |

### 추가 센서 필요 여부: **불필요**

> 7개 위젯 모두 기존 qxj(내부) + KMA API(외부) 조합으로 구현 가능.
> `inside_dewpoint_c`는 qxj 센서가 직접 측정하므로 계산 불필요.
> hjjcy의 온습도는 사용하지 않음 (CO2 전용).
> 따라서 **새로운 센서 하드웨어 추가 없이** 전부 구현 가능.

## 3. 데이터 소스 전략

- **내부 데이터 (qxj)**: sensor_data 테이블에서 qxj 장비의 device_id로 필터
- **외부 데이터 (KMA)**: 기존 `GET /dashboard/weather` API 응답 재사용
- **hjjcy**: CO2(sensor_type='co2')만 조회, 온습도 무시

**장점**: device JOIN 없이 qxj device_id만 알면 바로 조회 가능

## 4. 요구사항 (Functional Requirements)

### FR-01: 백엔드 API - 위젯 데이터 엔드포인트

새 엔드포인트 `GET /dashboard/widgets` 추가:

```typescript
// 응답 구조
{
  inside: { temperature: number | null, humidity: number | null, dewPoint: number | null, uv: number | null, rainfall: number | null },
  history: {  // 10분 전 데이터 (변화율 계산용)
    inside: { temperature: number | null, humidity: number | null },
    timestamp: string | null
  },
  trend6h: {  // 6시간 미니 트렌드
    inside_temp: { time: string, value: number }[],
    inside_rh: { time: string, value: number }[],
    uv: { time: string, value: number }[]
  },
  uvStats14d: { min: number, max: number } | null  // UV norm 계산용
}
// 외부 데이터는 기존 GET /dashboard/weather 응답 사용
```

- qxj device_id로 sensor_data 직접 필터 (내부 데이터)
- 외부 데이터: 기존 `GET /dashboard/weather` API 재사용 (KMA)
- 10분 전 데이터: `time >= NOW() - INTERVAL '15 min'` 범위에서 가장 가까운 샘플
- 6시간 트렌드: 최근 6시간 raw 데이터 (5분 간격 ≈ 72 포인트)
- UV 14일 통계: 최근 14일 min/max (uv_norm 계산용)

### FR-02: 프론트엔드 계산 유틸리티

`frontend/src/utils/widget-calculations.ts` 모듈 생성:

| 함수 | 입력 | 출력 |
|------|------|------|
| `calcVPD(tempC, rhPct)` | 온도, 습도 | `{ value: number, status: 'LOW'|'OK'|'HIGH' }` |
| `calcVentScore(inT, outT, inRH, outRH)` | 내외부 온습도 | `{ score: number, status: 'Normal'|'Recommended'|'Urgent' }` |
| `calcTempRate(now, prev)` | 현재/과거 온도 | `{ delta: number, status: string }` |
| `calcRhRate(now, prev)` | 현재/과거 습도 | `{ delta: number, status: string }` |
| `calcDelta(inT, outT, inRH, outRH)` | 내외부 값 | `{ dT: number, dRH: number }` |
| `calcUVRisk(uv, stats14d?)` | UV값, 14일 통계 | `{ level: number, label: string, category: string }` |
| `calcEnvScore(vpd, tempC, uvNorm?, dewpointC?, insideTempC?)` | 서브점수 입력 | `{ score: number, color: 'green'|'yellow'|'red' }` |
| `calcInsideDewpoint(tempC, rhPct)` | 내부 T/RH | `number` (Magnus 공식) |

### FR-03: 프론트엔드 위젯 컴포넌트

`frontend/src/components/dashboard/MonitoringWidgets.vue` 생성:

- 7개 위젯 카드를 반응형 그리드로 배치
- 각 카드 구조: Title / Value(큰 글씨) / Unit / Status Badge / Hint Text
- ΔT/ΔRH 위젯: 숫자 + 게이지 (가로 막대)
  - ΔT 범위: -10 ~ +10
  - ΔRH 범위: -40 ~ +40
- 환경 점수: 0~100 + 상태색 원형 표시
- 6시간 미니 트렌드 라인 (선택적, SVG 또는 CSS)

### FR-04: Dashboard.vue 통합

- `Dashboard.vue`에 `<MonitoringWidgets />` 추가 (날씨 카드와 SummaryCards 사이)
- `dashboardApi.getWidgets()` 호출로 데이터 페칭
- 새로고침 버튼과 연동

## 5. 계산식 명세

### A) VPD (Vapor Pressure Deficit)

```
es = 0.6108 * exp((17.27 * T) / (T + 237.3))   // 포화 수증기압 (kPa)
vpd = es * (1 - RH / 100)                        // VPD (kPa)

상태: vpd < 0.4 → LOW | 0.4~1.2 → OK | > 1.2 → HIGH
```

### B) 환기 필요 스코어

```
dT  = inside_temp - outside_temp
dRH = inside_rh - outside_rh
v_need = max(0, dT) * 1.0 + max(0, dRH) * 0.1

상태: v_need > 6 → Urgent | > 3 → Recommended | 그 외 → Normal
```

### C) 10분 변화량

```
temp_10m = inside_temp(now) - inside_temp(10m_ago)    // fallback: 15분 전
rh_10m   = inside_rh(now) - inside_rh(10m_ago)

온도 상태: > +2.0 → Very rapid | > +1.0 → Rapid warming | 그 외 → Stable
습도 상태: > +5 → Rapid humidifying | < -5 → Rapid drying | 그 외 → Stable
```

### D) UV 위험도

```
// uv_index 기반 (Tuya uv_index 코드 사용)
0-2: 낮음 | 3-5: 보통 | 6-7: 높음 | 8-10: 매우높음 | 11+: 위험

// raw UV fallback
uv_norm = clip((uv - uv_min_14d) / (uv_max_14d - uv_min_14d), 0, 1)
< 0.3: 낮음 | < 0.6: 보통 | < 0.8: 높음 | >= 0.8: 매우높음
```

### E) 환경 상태 점수

```
S_vpd  = clip(1 - |vpd - 0.8| / 0.8, 0, 1)
S_cond = inside_dewpoint 있으면 clip((inside_temp - inside_dewpoint) / 4, 0, 1), 없으면 1
S_T    = 온도 쾌적 (Tmin=20, Tmax=30, d=5, 범위 밖 선형 감점)
S_uv   = uv_norm 있으면 1 - max(0, uv_norm - 0.7), 없으면 1

가중치: w_vpd=4, w_cond=3, w_T=3, w_uv=1
score = 100 * (4*S_vpd + 3*S_cond + 3*S_T + 1*S_uv) / 11

상태색: >= 80 → Green | >= 60 → Yellow | < 60 → Red
```

## 6. 구현 범위 및 우선순위

| 순서 | 작업 | 파일 | 우선순위 |
|------|------|------|----------|
| 1 | 백엔드 위젯 API | `dashboard.controller.ts`, `dashboard.service.ts` | P0 |
| 2 | 계산 유틸 모듈 | `frontend/src/utils/widget-calculations.ts` | P0 |
| 3 | 위젯 컴포넌트 | `frontend/src/components/dashboard/MonitoringWidgets.vue` | P0 |
| 4 | Dashboard 통합 | `frontend/src/views/Dashboard.vue` | P0 |
| 5 | API 클라이언트 | `frontend/src/api/dashboard.api.ts` | P0 |
| 6 | 6시간 트렌드 라인 | MonitoringWidgets 내 SVG sparkline | P1 |
| 7 | 유닛 테스트 | `widget-calculations.test.ts` | P1 |

## 7. 기술적 고려사항

### 데이터 조회 전략

```sql
-- 1) qxj device_id 찾기
SELECT id FROM devices WHERE user_id = $1 AND category LIKE '%qxj%' AND device_type = 'sensor'

-- 2) 최신 내부 데이터 (qxj)
SELECT DISTINCT ON (sensor_type) sensor_type, value, unit, time
FROM sensor_data
WHERE device_id = $qxj_id AND sensor_type IN ('temperature','humidity','uv','dew_point','rainfall')
ORDER BY sensor_type, time DESC

-- 3) 외부 데이터: GET /dashboard/weather (기존 API)
```

- qxj device_id로 직접 필터 (JOIN 불필요)
- 외부 온습도는 KMA 날씨 API에서 가져옴
- hjjcy 온습도는 사용하지 않음 (CO2만 활용)
- 성능: sensor_data에 `(device_id, sensor_type, time)` 인덱스 활용

### 프론트엔드 데이터 흐름

```
Dashboard.vue (onMounted)
  → dashboardApi.getWidgets()
  → MonitoringWidgets.vue (props: widgetData)
    → widget-calculations.ts (계산)
    → 7개 카드 렌더링
```

### UI 레이아웃

```
[날씨 카드 (기존)]
[━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━]
[  VPD  |  환기 스코어  |  온도 변화  ]     ← 데스크탑 3열
[습도 변화|  ΔT/ΔRH    |  UV 위험도  ]
[      환경 상태 점수 (전체 너비)       ]
[━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━]
[SummaryCards (기존)]
```

모바일: 1열 세로 스택

## 8. 비기능 요구사항

| 항목 | 기준 |
|------|------|
| API 응답 시간 | < 500ms (3~4개 쿼리 병렬 실행) |
| 반응형 | 모바일 1열, 태블릿 2열, 데스크탑 3열 |
| 데이터 없음 처리 | 센서 오프라인 시 "-" 표시, 상태 배지 비활성 |
| 접근 제어 | JwtAuthGuard, getEffectiveUserId 패턴 적용 |

## 9. 리스크 및 대응

| 리스크 | 영향 | 대응 |
|--------|------|------|
| hjjcy/qxj 장비가 없는 사용자 | 위젯 데이터 null | null 안전 처리, "-" 표시 |
| 10분 전 데이터 없음 (첫 수집 직후) | 변화율 계산 불가 | 15분 fallback, 없으면 "-" |
| UV raw 값 범위 불명확 | uv_norm 부정확 | 14일 min/max 없으면 uv_index 카테고리 사용 |
| device category 값 불일치 | 내외부 구분 실패 | LIKE 패턴 + 로그 경고 |
