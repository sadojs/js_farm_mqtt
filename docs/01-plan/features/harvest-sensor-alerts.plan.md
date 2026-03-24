# Plan: harvest-sensor-alerts

> 수확 예측 카운터 + 센서 이상 감지 — 독립 페이지 2종 추가

## 1. 개요

기존 기능에 영향 없이 **완전 독립된 2개 페이지**를 추가한다.
삭제 시 모듈 폴더 + DB 테이블 + 라우터 엔트리 + 네비게이션 링크만 제거하면 복원 가능.

### 기준 환경
- **지역**: 강원도 횡성군 둔내면 (해발 ~500m, 내륙산간)
- **작물**: 방울토마토 (하우스 재배)
- **기후 특성**: 봄 늦서리(4월 중순까지), 여름 고온다습, 가을 조기 서리(10월 초)
- **재배 캘린더**: 정식 3월 하순~4월 중순 → 수확 6월~9월

### 현재 상태 (AS-IS)

| 영역 | 상태 |
|------|------|
| 수확 관리 | 없음 — 파종/수확 일정 추적 기능 없음 |
| 센서 이상 감지 | 없음 — sensor_data에 status 필드 있으나 항상 'normal' |
| 알림 테이블 | `notifications` 존재하나 자동화 실행 알림 전용 |

### 목표 상태 (TO-BE)

| 기능 | 설명 |
|------|------|
| 수확 예측 카운터 | 파종일 + 생육기간 → 예상 수확일/D-day/진행률 |
| 센서 이상 감지 | 값 고정/급변/범위 이탈/데이터 없음 → 알림 인박스 |

---

## 2. 기능 1: 수확 예측 카운터

### FR-01: 배치 관리 CRUD

**crop_batches 테이블** (신규, 일반 테이블):

| 필드 | 타입 | 설명 |
|------|------|------|
| id | UUID PK | |
| user_id | UUID FK(users) | 소유자 |
| crop_name | VARCHAR(100) | 작물명 (예: 방울토마토) |
| variety | VARCHAR(100) | 품종 (예: 대추방울) |
| house_name | VARCHAR(100) | 하우스/구역 이름 |
| sow_date | DATE | 파종일(정식일) |
| grow_days | INT | 생육기간 (일) |
| stage | VARCHAR(50) | 현재 단계 (seedling/vegetative/flowering/fruiting/harvest) |
| memo | TEXT | 메모 |
| status | VARCHAR(20) | 'active' / 'completed' |
| completed_at | TIMESTAMPTZ | 완료 처리 시각 |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

**CRUD API**:
- `POST /harvest/batches` — 배치 생성
- `GET /harvest/batches` — 목록 조회 (?status=active|completed)
- `GET /harvest/batches/:id` — 상세 조회
- `PUT /harvest/batches/:id` — 수정
- `PUT /harvest/batches/:id/complete` — 완료 처리
- `POST /harvest/batches/:id/clone` — 복제 (하우스명만 변경)
- `DELETE /harvest/batches/:id` — 삭제

### FR-02: 계산 로직 (프론트엔드)

```
예상 수확일 = 파종일 + 생육기간
D-day     = 예상 수확일 − 오늘    (음수면 D+N)
진행률     = clamp((오늘 − 파종일) / 생육기간, 0, 1)
```

### FR-03: 작물 프리셋 (프론트엔드 상수)

서버 리소스 0, 프론트엔드 상수로 관리:

```typescript
// 강원도 횡성군 둔내 기준 방울토마토 중심
const CROP_PRESETS = [
  { name: '방울토마토', variety: '대추방울', growDays: 100, stages: ['육묘','정식','생장','개화','착과','수확'] },
  { name: '방울토마토', variety: '미니찰', growDays: 90, stages: ['육묘','정식','생장','개화','착과','수확'] },
  { name: '방울토마토', variety: '탐스러운', growDays: 110, stages: ['육묘','정식','생장','개화','착과','수확'] },
  { name: '딸기', variety: '설향', growDays: 120, stages: ['정식','활착','개화','착과','수확'] },
  { name: '오이', variety: '다다기', growDays: 60, stages: ['정식','생장','수확'] },
  { name: '고추', variety: '청양', growDays: 150, stages: ['육묘','정식','생장','개화','착과','수확'] },
]
```

### FR-04: 화면 1 — Harvest 홈 (리스트)

| 요소 | 내용 |
|------|------|
| 헤더 | "수확 관리" + "배치 추가" 버튼 |
| 탭 | 진행중 / 완료 |
| 상단 섹션 | "7일 이내 수확 예정" (0 ≤ D-day ≤ 7) + "기한 경과" (D-day < 0) — 자동 필터 |
| 배치 카드 | 제목(작물/하우스) + 보조정보(파종일·생육일수) + 강조(예상수확일) + D-day 뱃지 + 진행률 바 + 단계 드롭다운 |
| 3점 메뉴 | 수정 / 완료 처리 / 복제 / 삭제 |

### FR-05: 화면 2 — 배치 추가/수정 (모달)

| 필드 | 타입 | 검증 |
|------|------|------|
| 작물명 | 드롭다운 (프리셋) + 직접입력 | 필수 |
| 품종 | 텍스트 (프리셋 선택 시 자동입력) | 선택 |
| 하우스/구역 | 드롭다운 (그룹 목록 활용) or 직접입력 | 필수 |
| 파종일 | 데이트 피커 | 필수, 미래 1년 이내 |
| 생육기간 | 숫자 입력 (프리셋 선택 시 자동입력) | 필수, 1~365 |
| 메모 | textarea | 선택, 200자 |

---

## 3. 기능 2: 센서 이상 감지

### FR-06: 이상 감지 룰 엔진 (백엔드 Cron)

5분 주기로 sensor_data 분석 (센서 수집 크론과 동일 주기):

| # | 유형 | 룰 | 심각도 |
|---|------|-----|--------|
| 1 | 데이터 없음 (no_data) | 마지막 수신 > 30분 | WARNING |
| 1b | 데이터 없음 (장기) | 마지막 수신 > 6시간 | CRITICAL |
| 2 | 값 고정 (flatline) | \|현재값 − 24h전 값\| < epsilon | WARNING |
| 3 | 급변 (spike) | \|현재값 − 10분전 값\| > threshold | WARNING |
| 4 | 범위 이탈 (out_of_range) | 값 < min 또는 값 > max | CRITICAL |

**센서별 파라미터 (방울토마토 + 둔내 기준)**:

| sensor_type | epsilon (flatline) | spike_threshold (10분) | min | max | unit |
|------------|-------------------|----------------------|-----|-----|------|
| temperature | 0.3°C | 8°C | -15 | 55 | °C |
| humidity | 0.5% | 25% | 0 | 100 | % |
| co2 | 10 ppm | 500 ppm | 250 | 5000 | ppm |
| soil_moisture | 0.5% | 20% | 0 | 100 | % |
| uv | 0.5 | 5 | 0 | 15 | idx |
| dew_point | 0.3°C | 5°C | -20 | 40 | °C |
| rainfall | 0.1 mm | 50 mm | 0 | 300 | mm |

### FR-07: sensor_alerts 테이블 (신규)

| 필드 | 타입 | 설명 |
|------|------|------|
| id | UUID PK | |
| user_id | UUID FK(users) | 소유자 |
| device_id | UUID FK(devices) | 센서 장비 |
| sensor_type | VARCHAR(50) | 센서 타입 |
| alert_type | VARCHAR(30) | 'no_data' / 'flatline' / 'spike' / 'out_of_range' |
| severity | VARCHAR(20) | 'warning' / 'critical' |
| message | TEXT | 사람이 이해 가능한 설명 |
| value | DECIMAL | 감지 시점 값 (no_data는 null) |
| threshold | TEXT | 적용된 임계값 설명 |
| resolved | BOOLEAN | 해결 여부 |
| resolved_at | TIMESTAMPTZ | 해결 시각 |
| snoozed_until | TIMESTAMPTZ | 스누즈 종료 시각 |
| created_at | TIMESTAMPTZ | 감지 시각 |

**API**:
- `GET /sensor-alerts` — 알림 목록 (?severity=warning|critical, ?resolved=false, ?deviceId=xxx)
- `GET /sensor-alerts/:id` — 상세 (24h min/max/delta + 조치가이드)
- `PUT /sensor-alerts/:id/resolve` — 해결 처리
- `PUT /sensor-alerts/:id/snooze` — 스누즈 (body: { days: 1|7 })

### FR-08: 화면 1 — Alerts 인박스

| 요소 | 내용 |
|------|------|
| 헤더 | "센서 알림" + 미해결 카운트 뱃지 |
| 필터 칩 | 전체 / 심각 / 경고 / 해결됨 |
| 하우스 필터 | 드롭다운 (그룹 기반) |
| 알림 카드 | 심각도 아이콘 + 뱃지 + 센서명 + 하우스명 + 유형 + 시간 + 한줄가이드 + [보기/해결] 버튼 |

### FR-09: 화면 2 — 알림 상세 (모달 or 확장)

| 요소 | 내용 |
|------|------|
| 헤더 | 제목("값 고정 감지") + 심각도 뱃지 + 센서/하우스 |
| 숫자 요약 | 최근 24h min / max / delta / 마지막 값 |
| 감지 이유 | "36시간 동안 변화량이 0.5% 이하" |
| 조치 가이드 | 체크리스트 (유형별 다름) |
| 액션 | 해결 처리 / 스누즈(1일/1주) |

**유형별 조치 가이드**:

| 유형 | 가이드 |
|------|--------|
| no_data | 배터리/전원 확인 → 게이트웨이 연결 확인 → Tuya 앱에서 장비 상태 확인 |
| flatline | 센서 프로브 접촉 확인 → 전원 리부팅 → 주변 센서와 비교 |
| spike | 주변 환경 변화 확인 → 센서 위치 이탈 확인 → 오작동 시 데이터 무시 |
| out_of_range | 센서 교정 필요 → 물리적 손상 확인 → 교체 검토 |

### FR-10: 중복 알림 방지

같은 device_id + sensor_type + alert_type 조합으로 **미해결 알림이 이미 존재**하면 새 알림 생성하지 않음.
→ 크론이 돌 때마다 중복 방지 체크.

---

## 4. 기존 코드 영향도 (Zero Impact 설계)

### 수정되는 기존 파일 (최소)

| 파일 | 변경 | 영향 |
|------|------|------|
| `frontend/src/router/index.ts` | 2개 라우트 추가 | 기존 라우트 무관 |
| `frontend/src/App.vue` | 2개 네비게이션 링크 추가 | 기존 메뉴 무관 |
| `backend/src/app.module.ts` | 2개 모듈 import 추가 | 기존 모듈 무관 |
| `backend/database/schema.sql` | 2개 테이블 DDL 추가 | 기존 테이블 무관 |

### 삭제 시 복원 절차

```
1. frontend/src/views/Harvest.vue 삭제
2. frontend/src/views/Alerts.vue 삭제
3. backend/src/modules/harvest/ 폴더 삭제
4. backend/src/modules/sensor-alerts/ 폴더 삭제
5. router/index.ts에서 /harvest, /alerts 라우트 제거
6. App.vue에서 네비게이션 링크 2개 제거
7. app.module.ts에서 HarvestModule, SensorAlertsModule import 제거
8. DB: DROP TABLE crop_batches; DROP TABLE sensor_alerts;
```

### 신규 파일 목록 (기존 파일 수정 없이 추가만)

**수확 예측**:
| # | 파일 | 설명 |
|---|------|------|
| N1 | `backend/src/modules/harvest/harvest.module.ts` | 모듈 |
| N2 | `backend/src/modules/harvest/harvest.controller.ts` | API 컨트롤러 |
| N3 | `backend/src/modules/harvest/harvest.service.ts` | 비즈니스 로직 |
| N4 | `backend/src/modules/harvest/entities/crop-batch.entity.ts` | 엔티티 |
| N5 | `backend/src/modules/harvest/dto/create-batch.dto.ts` | DTO |
| N6 | `frontend/src/api/harvest.api.ts` | API 클라이언트 |
| N7 | `frontend/src/views/Harvest.vue` | 화면 (리스트 + 모달) |
| N8 | `frontend/src/utils/harvest-presets.ts` | 작물 프리셋 상수 |

**센서 이상 감지**:
| # | 파일 | 설명 |
|---|------|------|
| N9 | `backend/src/modules/sensor-alerts/sensor-alerts.module.ts` | 모듈 |
| N10 | `backend/src/modules/sensor-alerts/sensor-alerts.controller.ts` | API |
| N11 | `backend/src/modules/sensor-alerts/sensor-alerts.service.ts` | 룰 엔진 + CRUD |
| N12 | `backend/src/modules/sensor-alerts/entities/sensor-alert.entity.ts` | 엔티티 |
| N13 | `backend/src/modules/sensor-alerts/sensor-alert-rules.ts` | 감지 룰 상수 |
| N14 | `frontend/src/api/sensor-alerts.api.ts` | API 클라이언트 |
| N15 | `frontend/src/views/Alerts.vue` | 화면 (인박스 + 상세) |

---

## 5. 구현 순서

### Phase 1: DB 스키마 (crop_batches + sensor_alerts 테이블 추가)
### Phase 2: 수확 예측 백엔드 (N1~N5)
### Phase 3: 수확 예측 프론트엔드 (N6~N8 + 라우터/네비)
### Phase 4: 센서 이상 감지 백엔드 (N9~N13)
### Phase 5: 센서 이상 감지 프론트엔드 (N14~N15 + 라우터/네비)
### Phase 6: 빌드 검증

---

## 6. 비기능 요구사항

| 항목 | 기준 |
|------|------|
| 기존 코드 영향 | Zero — 기존 모듈/컴포넌트 수정 없음 |
| 삭제 용이성 | 8단계 복원 절차로 완전 제거 가능 |
| 외부 의존성 | 없음 — 추가 npm 패키지 불필요 |
| 접근 제어 | JwtAuthGuard + getEffectiveUserId 패턴 |
| 반응형 | 모바일 1열 / 데스크탑 2~3열 |
| 센서 알림 크론 | 5분 주기, sensor_data 읽기만 (쓰기 없음) |
| 프리셋 | 프론트엔드 상수 — 서버 리소스 0 |

---

## 7. 리스크 및 대응

| 리스크 | 영향 | 대응 |
|--------|------|------|
| 센서 데이터 부족 (초기) | flatline 오탐 | 최소 24h 데이터 수집 후 감지 시작 |
| 센서 크론 지연 | no_data 오탐 | 30분 threshold 유지 (수집 5분 × 6 = 안전 마진) |
| 사용자가 기능 불필요 판단 | 삭제 필요 | 8단계 복원 절차 문서화 완료 |
| crop_batches 데이터 양 | 미미 | 농가당 10~50건 수준, 인덱스 불필요 |
