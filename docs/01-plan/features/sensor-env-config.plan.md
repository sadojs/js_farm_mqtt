# Plan: sensor-env-config (센서 환경 설정)

> 그룹별 센서 매핑 환경설정 기능

## 1. 배경 및 문제

### 현재 상황
- 센서 타입이 여러 모듈에 **하드코딩** (`ALLOWED_SENSOR_TYPES`, `SENSOR_LABELS`, 대시보드 쿼리 등)
- 모든 그룹이 동일한 센서 타입(`temperature`, `humidity`, `co2`, `rainfall`, `uv`, `dew_point`)을 사용
- 외부 온도/습도는 날씨 API(`weather_data` 테이블)에서, 나머지는 센서 장비에서 가져옴
- **문제점**:
  1. 농장마다 보유한 센서 장비 타입이 다름
  2. 같은 그룹에 온도 센서가 여러 개일 경우 어떤 것이 "내부 온도"인지 구분 불가
  3. 기상관측센서(qxj)는 `temp_current_external`, `humidity_outdoor` 등 25개 타입을 보고하지만 `ALLOWED_SENSOR_TYPES` 6개로만 저장
  4. 새 센서 타입 추가 시 코드 여러 곳을 수정해야 함

### 현재 데이터 흐름

```
[Tuya 센서] → sensor-collector (TUYA_SENSOR_MAP → ALLOWED_SENSOR_TYPES 6개 필터)
                → sensor_data 테이블
                → 대시보드/자동화/리포트/수확관리/알림에서 하드코딩된 타입으로 조회

[기상청 API] → weather-collector (매시간)
                → weather_data 테이블 (temperature, humidity, precipitation, wind_speed, condition)
                → 대시보드 날씨카드/자동화 날씨엔진에서 사용
```

### 영향받는 모듈 (센서 타입 하드코딩 위치)

| 모듈 | 파일 | 하드코딩 내용 |
|------|------|-------------|
| 센서 수집 | `sensor-collector.service.ts` | `ALLOWED_SENSOR_TYPES` 6개 |
| 대시보드 | `dashboard.service.ts` | `IN ('temperature','humidity','dew_point','uv','rainfall')` |
| 그룹 UI | `Groups.vue` | `SENSOR_LABELS`, `ALLOWED_SENSOR_FIELDS` |
| 수확 추천 | `harvest-rec.service.ts` | `temperature`, `humidity`, `dew_point` 직접 참조 |
| 센서 알림 | `sensor-alert-rules.ts` | 24개 센서 타입별 임계값 |
| 리포트 | `reports.service.ts` | 쿼리 파라미터로 동적 (영향 적음) |
| 자동화 | `weather-engine.ts` | `temperature`, `humidity`, `precipitation` 등 |

## 2. 목표

1. **그룹별 센서 매핑**: 각 그룹에서 "논리적 역할"(내부 온도, 외부 습도 등)에 "물리적 소스"(특정 장비의 특정 센서 타입 또는 날씨 API 필드)를 매핑
2. **확장성**: 매핑 역할(role)을 DB 테이블로 관리하여 향후 어드민 페이지에서 추가/수정 가능
3. **하위 호환**: 기존 홍길동 농장(test@farm.com)의 데이터 흐름이 깨지지 않도록 기본 매핑 자동 생성
4. **점진적 적용**: 1단계에서는 매핑 CRUD + UI만 구현, 소비 모듈의 실제 전환은 2단계에서 진행

## 3. 핵심 개념

### 3-1. 매핑 역할 (Env Role)

향후 어드민에서 관리할 수 있는 **논리적 환경 역할** 테이블:

| role_key | 한글명 | 카테고리 | 기본 단위 |
|----------|--------|---------|----------|
| `internal_temp` | 내부 온도 | internal | °C |
| `internal_humidity` | 내부 습도 | internal | % |
| `external_temp` | 외부 온도 | external | °C |
| `external_humidity` | 외부 습도 | external | % |
| `co2` | CO2 | internal | ppm |
| `uv` | UV | external | idx |
| `rainfall` | 강우량 | external | mm |

- 초기 7개 역할 고정 등록 (시드)
- 향후 어드민 페이지에서 CRUD 가능하도록 테이블 설계
- `category`: `internal` / `external` — UI에서 섹션 구분용

### 3-2. 매핑 소스 (Mapping Source)

각 역할에 연결할 수 있는 소스 유형:

| source_type | 설명 | 식별자 |
|------------|------|--------|
| `sensor` | 센서 장비의 특정 항목 | `device_id` + `sensor_type` |
| `weather` | 날씨 API 필드 | `weather_field` (temperature, humidity, precipitation) |

### 3-3. 매핑 관계

```
[env_roles] 1 ← N [env_mappings] N → 1 [house_groups]
                                  N → 0..1 [devices] (sensor 소스일 때)
```

## 4. 기능 범위

### 4-1. 1단계 (이번 구현)

| # | 기능 | 설명 |
|---|------|------|
| F1 | `env_roles` 테이블 + 시드 | 7개 기본 역할 등록 |
| F2 | `env_mappings` 테이블 | 그룹별 역할-소스 매핑 저장 |
| F3 | 백엔드 CRUD API | 매핑 조회/저장 + 선택 가능한 소스 목록 |
| F4 | 그룹 UI 환경설정 버튼 | Groups.vue 각 그룹 상단에 버튼 추가 |
| F5 | 환경설정 모달 | 역할별 소스 선택 드롭다운 + 현재값 표시 |
| F6 | 홍길동 기본 매핑 | test@farm.com 그룹에 기존 동작과 동일한 매핑 시드 |
| F7 | 매핑 해석 서비스 | `EnvMappingResolver` — 그룹의 매핑에 따라 실제 값 조회 |
| F8 | 대시보드 위젯 전환 | 기존 하드코딩 → 매핑 기반 조회로 변경 |
| F9 | 그룹 센서 표시 전환 | Groups.vue 센서 표시를 매핑 기반으로 변경 |

### 4-2. 2단계 (향후)

| # | 기능 | 설명 |
|---|------|------|
| F10 | 어드민: 역할 관리 | 어드민 페이지에서 `env_roles` CRUD |
| F11 | 자동화 룰 전환 | 자동화 조건에서 매핑 역할 참조 |
| F12 | 리포트 전환 | 리포트 쿼리에서 매핑 역할 참조 |
| F13 | 수확 추천 전환 | 수확 추천에서 매핑 기반 환경 데이터 사용 |
| F14 | 센서 수집 확장 | `ALLOWED_SENSOR_TYPES` 제거, 모든 센서 타입 저장 |

## 5. DB 스키마

### 5-1. env_roles (환경 역할 정의)

```sql
CREATE TABLE env_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_key VARCHAR(50) UNIQUE NOT NULL,       -- 'internal_temp'
  label VARCHAR(100) NOT NULL,                -- '내부 온도'
  category VARCHAR(20) NOT NULL DEFAULT 'internal',  -- 'internal' | 'external'
  unit VARCHAR(20) NOT NULL DEFAULT '',       -- '°C', '%', 'ppm'
  sort_order INT NOT NULL DEFAULT 0,          -- UI 정렬 순서
  is_default BOOLEAN NOT NULL DEFAULT true,   -- 시스템 기본 역할 여부
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 시드 데이터
INSERT INTO env_roles (role_key, label, category, unit, sort_order) VALUES
  ('internal_temp',     '내부 온도',  'internal', '°C',  1),
  ('internal_humidity', '내부 습도',  'internal', '%',   2),
  ('external_temp',     '외부 온도',  'external', '°C',  3),
  ('external_humidity', '외부 습도',  'external', '%',   4),
  ('co2',               'CO2',       'internal', 'ppm', 5),
  ('uv',                'UV',        'external', '',    6),
  ('rainfall',          '강우량',    'external', 'mm',  7);
```

### 5-2. env_mappings (그룹별 매핑)

```sql
CREATE TABLE env_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES house_groups(id) ON DELETE CASCADE,
  role_key VARCHAR(50) NOT NULL REFERENCES env_roles(role_key) ON DELETE CASCADE,
  source_type VARCHAR(20) NOT NULL CHECK (source_type IN ('sensor', 'weather')),
  device_id UUID REFERENCES devices(id) ON DELETE SET NULL,  -- sensor일 때
  sensor_type VARCHAR(50),                                     -- sensor일 때
  weather_field VARCHAR(50),                                   -- weather일 때
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(group_id, role_key)
);

CREATE INDEX idx_env_mappings_group ON env_mappings(group_id);
```

## 6. API 설계

### 6-1. 환경 역할 목록

```
GET /env-config/roles
→ EnvRole[] (전체 역할 목록, sort_order 순)
```

### 6-2. 매핑 가능한 소스 목록

```
GET /env-config/groups/:groupId/sources
→ {
    sensors: [
      { deviceId, deviceName, sensorType, label, currentValue, unit }
    ],
    weather: [
      { field: 'temperature', label: '외부 온도 (기상청)', currentValue, unit }
    ]
  }
```

- `sensors`: 해당 그룹에 속한 센서 장비들의 최신 센서 타입별 값
  - 표시: `석문리기상관측센서 - 온도 (temperature) - 0.9°C`
- `weather`: 해당 유저의 날씨 데이터 필드
  - 표시: `기상청 날씨 - 외부 온도 (temperature) - 3.0°C`

### 6-3. 그룹 매핑 조회

```
GET /env-config/groups/:groupId/mappings
→ EnvMapping[] (해당 그룹의 역할별 매핑)
```

### 6-4. 그룹 매핑 일괄 저장

```
PUT /env-config/groups/:groupId/mappings
Body: {
  mappings: [
    { roleKey: 'internal_temp', sourceType: 'sensor', deviceId: '...', sensorType: 'temperature' },
    { roleKey: 'external_temp', sourceType: 'weather', weatherField: 'temperature' },
    ...
  ]
}
→ EnvMapping[]
```

### 6-5. 매핑 기반 현재값 조회 (해석 서비스)

```
GET /env-config/groups/:groupId/resolved
→ {
    internal_temp: { value: 0.9, unit: '°C', label: '내부 온도', source: '석문리기상관측센서 / temperature', updatedAt: '...' },
    external_temp: { value: 3.0, unit: '°C', label: '외부 온도', source: '기상청 날씨', updatedAt: '...' },
    ...
  }
```

## 7. 프론트엔드 설계

### 7-1. 환경설정 버튼 (Groups.vue)

각 그룹 카드 상단에 설정 아이콘 버튼 추가:

```
┌─────────────────────────────────────────┐
│ 석문리 하우스                    [⚙] [▼] │
│ ─────────────────────────────────────── │
│  센서 | 작동기 | 개폐기 | 관수 | 자동화  │
│ ...                                      │
└─────────────────────────────────────────┘
```

### 7-2. 환경설정 모달

```
┌───────────────────────────────────────────────────────────┐
│ 센서 환경 설정 — 석문리 하우스                       [X] │
│ ─────────────────────────────────────────────────────── │
│                                                           │
│ ── 내부 환경 ──                                          │
│                                                           │
│ 내부 온도 (°C)                                            │
│ ┌─────────────────────────────────────────────────────┐  │
│ │ 석문리기상관측센서 - 온도 (temperature) - 0.9°C   ▼│  │
│ └─────────────────────────────────────────────────────┘  │
│                                                           │
│ 내부 습도 (%)                                             │
│ ┌─────────────────────────────────────────────────────┐  │
│ │ 석문리기상관측센서 - 습도 (humidity) - 81%         ▼│  │
│ └─────────────────────────────────────────────────────┘  │
│                                                           │
│ CO2 (ppm)                                                 │
│ ┌─────────────────────────────────────────────────────┐  │
│ │ (미설정)                                           ▼│  │
│ └─────────────────────────────────────────────────────┘  │
│                                                           │
│ ── 외부 환경 ──                                          │
│                                                           │
│ 외부 온도 (°C)                                            │
│ ┌─────────────────────────────────────────────────────┐  │
│ │ 기상청 날씨 - 외부 온도 (temperature) - 3.0°C    ▼│  │
│ └─────────────────────────────────────────────────────┘  │
│                                                           │
│ 외부 습도 (%)                                             │
│ ┌─────────────────────────────────────────────────────┐  │
│ │ 기상청 날씨 - 외부 습도 (humidity) - 73%          ▼│  │
│ └─────────────────────────────────────────────────────┘  │
│                                                           │
│ UV                                                        │
│ ┌─────────────────────────────────────────────────────┐  │
│ │ 석문리기상관측센서 - UV 지수 (uv_index) - 0       ▼│  │
│ └─────────────────────────────────────────────────────┘  │
│                                                           │
│ 강우량 (mm)                                               │
│ ┌─────────────────────────────────────────────────────┐  │
│ │ 석문리기상관측센서 - 강우량 (rainfall) - 0mm      ▼│  │
│ └─────────────────────────────────────────────────────┘  │
│                                                           │
│                              [취소]  [저장]               │
└───────────────────────────────────────────────────────────┘
```

- 드롭다운 옵션 형식: `{장비명} - {한글명} ({영문 센서타입}) - {현재값}{단위}`
- 날씨 소스: `기상청 날씨 - {한글명} ({필드명}) - {현재값}{단위}`
- `(미설정)` 옵션으로 매핑 해제 가능

## 8. 홍길동(test@farm.com) 기본 매핑

### 그룹: 석문리 하우스

| 역할 | 소스 타입 | 장비/필드 | 센서 타입 |
|------|----------|----------|----------|
| internal_temp | sensor | 석문리기상관측센서 | temperature |
| internal_humidity | sensor | 석문리기상관측센서 | humidity |
| external_temp | weather | — | temperature |
| external_humidity | weather | — | humidity |
| co2 | (미설정) | — | — |
| uv | sensor | 석문리기상관측센서 | uv |
| rainfall | sensor | 석문리기상관측센서 | rainfall |

- 이 매핑은 DB 시드 또는 마이그레이션 스크립트로 자동 생성
- 기존 대시보드/자동화/리포트 동작과 동일한 결과를 보장

## 9. 검증 방법

### 전후 비교 검증

1. **매핑 전**: `GET /dashboard/widgets` → 기존 하드코딩 기반 센서값 기록
2. **매핑 후**: `GET /env-config/groups/:groupId/resolved` → 매핑 기반 센서값
3. **비교**: 동일 역할의 값이 전후 일치하는지 확인

### 체크리스트

| # | 검증 항목 |
|---|----------|
| 1 | `env_roles` 테이블 7개 역할 시드 확인 |
| 2 | `env_mappings` 테이블 생성 확인 |
| 3 | 홍길동 기본 매핑 6개 자동 생성 확인 (co2 제외) |
| 4 | `GET /env-config/roles` — 7개 역할 반환 |
| 5 | `GET /env-config/groups/:id/sources` — 센서 항목 + 날씨 항목 반환 |
| 6 | `GET /env-config/groups/:id/mappings` — 기본 매핑 반환 |
| 7 | `PUT /env-config/groups/:id/mappings` — 매핑 저장/수정 |
| 8 | `GET /env-config/groups/:id/resolved` — 매핑 기반 현재값 반환 |
| 9 | 해석된 값이 기존 대시보드 값과 일치 |
| 10 | Groups.vue 환경설정 버튼 표시 |
| 11 | 환경설정 모달 오픈 + 역할/소스 표시 |
| 12 | 모달에서 매핑 변경 → 저장 → 반영 확인 |
| 13 | 빌드 통과 (백엔드 + 프론트엔드) |

## 10. 변경 파일 예상

### 신규 파일

| # | 파일 | 설명 |
|---|------|------|
| N1 | `backend/src/modules/env-config/env-config.module.ts` | 모듈 |
| N2 | `backend/src/modules/env-config/env-config.controller.ts` | API 5개 엔드포인트 |
| N3 | `backend/src/modules/env-config/env-config.service.ts` | CRUD + 해석 서비스 |
| N4 | `backend/src/modules/env-config/entities/env-role.entity.ts` | 역할 엔티티 |
| N5 | `backend/src/modules/env-config/entities/env-mapping.entity.ts` | 매핑 엔티티 |
| N6 | `frontend/src/api/env-config.api.ts` | API 클라이언트 |

### 수정 파일

| # | 파일 | 변경 |
|---|------|------|
| M1 | `backend/src/app.module.ts` | EnvConfigModule import |
| M2 | `frontend/src/views/Groups.vue` | 환경설정 버튼 + 모달 추가 |
| M3 | `backend/database/schema.sql` | env_roles + env_mappings DDL |

## 11. 구현 순서

| Phase | 작업 |
|-------|------|
| 1 | DB: `env_roles` + `env_mappings` 테이블 생성 + 시드 |
| 2 | Backend: 엔티티 + 서비스 + 컨트롤러 + 모듈 |
| 3 | Backend: 홍길동 기본 매핑 시드 |
| 4 | Frontend: API 클라이언트 |
| 5 | Frontend: Groups.vue 환경설정 버튼 + 모달 |
| 6 | 전후 비교 검증 |
| 7 | 빌드 확인 |

## 12. 확장성 고려사항

- `env_roles` 테이블은 어드민이 직접 행을 추가하여 새 역할 정의 가능
- `is_default` 컬럼으로 시스템 기본 역할 vs 사용자 추가 역할 구분
- `sort_order` 컬럼으로 UI 표시 순서 제어
- `category` 컬럼으로 내부/외부 환경 섹션 분류
- 향후 어드민 CRUD 페이지에서 역할 추가/수정/삭제 가능
- 매핑은 `group_id + role_key` UNIQUE 제약으로 중복 방지
