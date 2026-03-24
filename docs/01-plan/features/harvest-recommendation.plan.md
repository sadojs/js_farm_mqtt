# Plan: 수확관리 추천 시스템 (harvest-recommendation)

## 1. 개요

현재 수확 관리 페이지(Harvest.vue)를 **단순 작업 리스트/달력**에서 **수확 품질 유지를 위한 환경 기반 관리 추천 시스템**으로 전면 개편한다.

### 핵심 컨셉

- 작업 = 수확 품질 유지 행동
- 점수 = 수확 위험도 대응 우선순위
- 환경 센서 데이터 + 작업 이력 + 생육 단계를 교차 분석하여 실시간 추천

## 2. 현재 문제점 (AS-IS)

| 항목 | 현재 | 문제 |
|------|------|------|
| 화면 구조 | 배치탭 + 작업탭(리스트/달력) + 완료탭 | 복잡한 3탭 구조, 핵심 행동이 묻힘 |
| 작업 표시 | 날짜 기반 스케줄 나열 | "왜" 해야 하는지 이유 없음 |
| 우선순위 | 없음 (날짜순 정렬) | 긴급한 작업 판단 불가 |
| 환경 연동 | 없음 | 고습/결로 위험이 높아도 작업 추천 안 됨 |
| 완료 효과 | 다음 일정 재스케줄만 | 작업 효과(병해 위험 감소 등) 피드백 없음 |

## 3. 변경 후 (TO-BE)

### 3.1 화면 구조

```
[수확 관리 화면]
├── 헤더: "수확 관리" + 배치 설정 버튼
├── 환경 요약 배너 (센서 기반 실시간 상태)
│   ├── 현재 상태: 🟡 수확 품질 주의
│   ├── 요약 메시지 (예: "병해 위험 상승 경향 감지")
│   └── 부가 정보 (예: "최근 6시간 고습 지속")
├── 추천 작업 카드 3개
│   ├── 🍃 하엽 제거
│   ├── 🌿 유인 작업
│   └── 🧴 농약(방제)
└── 배치 관리 (접이식 하단 영역)
    ├── 활성 배치 표시
    └── + 배치 추가 버튼
```

### 3.2 삭제 대상

- ❌ 달력 뷰 (calendar)
- ❌ 리스트 뷰 (작업 occurrence 나열)
- ❌ 탭 네비게이션 (batches / tasks / completed)
- ❌ 완료 배치 탭
- ❌ RescheduleSheet 컴포넌트 (완료 시 간소화된 처리로 대체)

### 3.3 유지 대상

- ✅ 배치 추가/편집 모달 (파종일, 정식일 → 추천 계산의 기반)
- ✅ 배치 생육 단계 자동 계산 (vegetative/flowering_fruit/harvest)
- ✅ 기존 API 구조 (하위 호환)

## 4. 추천 카드 설계

### 4.1 작업 타입 정의

| 작업 | 코드 | 아이콘 | 기본 주기 | 설명 |
|------|------|--------|-----------|------|
| 하엽 제거 | leaf_removal | 🍃 | 7~14일 | 하부 노엽 제거로 통풍 개선, 병해 예방 |
| 유인 작업 | training | 🌿 | 5~10일 | 줄기 유인으로 통풍·수광 확보 |
| 농약(방제) | pesticide | 🧴 | 10~14일 | 예방적 방제로 병해충 억제 |

### 4.2 카드 데이터 구조

```typescript
interface RecommendationCard {
  taskType: 'leaf_removal' | 'training' | 'pesticide';
  taskName: string;          // "하엽 제거"
  icon: string;              // "🍃"
  priorityScore: number;     // 0~100
  riskScore: number;         // 0~100
  delayRatio: number;        // 0.0~1.0+
  daysSinceLast: number;     // 마지막 완료 후 경과 일수
  recommendedWindowStart: string; // "2026-02-26"
  recommendedWindowEnd: string;   // "2026-02-28"
  status: 'NORMAL' | 'UPCOMING' | 'DELAYED' | 'URGENT';
  reasons: string[];         // 추천 이유 (복수)
  effectRemaining: number | null; // 이전 작업 효과 잔여 일수
}
```

### 4.3 상태 판정

| 조건 | 상태 | 한국어 문구 | 색상 |
|------|------|-------------|------|
| delay_ratio >= 0.5 | DELAYED | 작업 지연됨 | 🟡 |
| recommended_window_start = 내일 | UPCOMING | 곧 작업 권장 | 🟡 |
| risk_score >= 75 | URGENT | 즉시 작업 권장 | 🔴 |
| else | NORMAL | 관리 적정 상태 | 🟢 |
| 우선순위: URGENT > DELAYED > UPCOMING > NORMAL |

### 4.4 점수 색상

| 범위 | 색상 | 의미 |
|------|------|------|
| 0~39 | 🟢 Green | 안정 |
| 40~69 | 🟡 Yellow | 주의 |
| 70~100 | 🔴 Red | 긴급 |

## 5. 점수 계산 엔진

### 5.1 priority_score 계산

```
priority_score = clamp(
  base_cycle_score        // 0~35: 주기 기반 기본 점수
  + env_modifier          // 0~35: 환경 위험 가중
  + stage_modifier        // 0~10: 생육 단계 가중
  - effect_modifier       // 0~20: 최근 작업 효과 감경
, 0, 100)
```

#### base_cycle_score (주기 기반)
```
ratio = days_since_last / recommended_interval
if ratio < 0.5 → 0~10 (비례)
if ratio 0.5~1.0 → 10~25 (비례)
if ratio > 1.0 → 25~35 (초과 비례, cap 35)
```

#### env_modifier (환경 기반 — 작업 타입별 다름)

**하엽 제거:**
```
high_humidity_hours = count(trend6h humidity > 80%) * (6h/datapoints)
condensation_bonus = { critical: 15, danger: 10, warning: 5, safe: 0 }
env_mod = min(35, high_humidity_hours * 5 + condensation_bonus)
```

**유인 작업:**
```
// 통풍 관련: VPD LOW + 습도 높으면 유인이 더 급함
vpd_bonus = vpd_status === 'LOW' ? 15 : 0
humidity_bonus = humidity > 80 ? 10 : humidity > 70 ? 5 : 0
env_mod = min(35, vpd_bonus + humidity_bonus)
```

**농약(방제):**
```
// 병해 위험 직접 연동
disease_risk = high_humidity_hours * 8 + condensation_bonus * 1.5
env_mod = min(35, disease_risk)
```

#### stage_modifier (생육 단계)
```
vegetative: 0
flowering_fruit: +5  (착과기 관리 중요)
harvest: +10         (수확기 품질 직결)
```

#### effect_modifier (최근 작업 효과 감경)
```
if effect_remaining > 0:
  effect_mod = 15 * (effect_remaining / effect_duration)
else:
  effect_mod = 0
```

### 5.2 risk_score 계산

```
risk_score = clamp(
  humidity_risk           // 0~40
  + condensation_risk     // 0~30
  + vpd_risk              // 0~15
  + delay_risk            // 0~15
, 0, 100)
```

```
humidity_risk = min(40, high_humidity_hours * 7)
condensation_risk = { critical: 30, danger: 20, warning: 10, safe: 0 }
vpd_risk = { LOW: 15, OK: 0, HIGH: 10 }
delay_risk = min(15, days_overdue * 3)
```

### 5.3 추천 사유 생성

환경 조건에 따라 자연어 사유를 조합:

| 조건 | 사유 문구 |
|------|-----------|
| high_humidity_hours >= 3 | "최근 6시간 고습 {n}시간 지속" |
| condensation.level = critical/danger | "결로 위험 증가 감지" |
| vpd.status = LOW | "과습으로 곰팡이 위험 상승" |
| vpd.status = HIGH | "건조 스트레스 감지" |
| days_since_last > interval * 1.2 | "작업 주기 초과 ({n}일 경과)" |
| currentStage changed recently | "생장 단계 변화 감지 ({stage})" |
| 환경 양호 + 주기 정상 | "정기 관리 권장" |

## 6. 완료 처리 & 효과 시스템

### 6.1 완료 처리 플로우

```
사용자 "완료" 클릭
  → POST /harvest/task-logs { batchId, taskType }
  → 서버: harvest_task_logs INSERT
  → 클라이언트: 추천 데이터 재계산
  → 점수 즉시 반영 (effect_modifier 적용)
```

### 6.2 작업 효과 (Effect Modifiers)

| 작업 | 효과 기간 | 환경 점수 영향 | 설명 |
|------|-----------|---------------|------|
| 하엽 제거 | 7일 | humidity_penalty × 0.88, condensation_penalty × 0.9 | 통풍 개선 → 습도/결로 감소 |
| 유인 작업 | 5일 | airflow_penalty × 0.92 | 통풍 확보 → 환기 효율 상승 |
| 농약(방제) | 12일 | disease_risk × 0.80 | 병해 억제 → 위험도 감소 |

효과는 DB 테이블 없이 **마지막 완료일 + 효과 기간**으로 계산:
```typescript
const effectRemaining = Math.max(0, effectDuration - daysSinceLast);
const isEffectActive = effectRemaining > 0;
```

### 6.3 "1일 미루기" 처리

- 프론트엔드 `localStorage`에 스누즈 기록: `snooze:{batchId}:{taskType}:{date}`
- 해당 날짜 동안 카드 우선순위 시각적으로 낮춤 (점수 계산에는 영향 없음)
- 다음 날 자동 해제

## 7. 환경 요약 배너

### 7.1 상태 판정

```typescript
type HarvestQualityStatus = 'good' | 'caution' | 'warning';

// 3개 카드 중 최대 priority_score 기준
if (maxPriorityScore >= 70) → 'warning'  // 🔴 수확 품질 위험
if (maxPriorityScore >= 40) → 'caution'  // 🟡 수확 품질 주의
else → 'good'                            // 🟢 수확 품질 양호
```

### 7.2 배너 표시 내용

```
[상태 아이콘] 현재 상태: {상태 문구}
{주요 원인 1줄 요약}
{부가 환경 정보}
```

예시:
```
🟡 현재 상태: 수확 품질 주의
  병해 위험 상승 경향 감지
  최근 6시간 고습 3.2시간 지속
```

## 8. 데이터 흐름 설계

### 8.1 백엔드 변경

#### 새 테이블: `harvest_task_logs`

```sql
CREATE TABLE harvest_task_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES crop_batches(id) ON DELETE CASCADE,
  task_type VARCHAR(30) NOT NULL,  -- 'leaf_removal' | 'training' | 'pesticide'
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_task_logs_batch_type ON harvest_task_logs(batch_id, task_type);
```

#### 새 API 엔드포인트

| Method | Path | 설명 |
|--------|------|------|
| GET | `/harvest/recommendations` | 추천 카드 3개 + 환경 요약 |
| POST | `/harvest/task-logs` | 작업 완료 기록 |

#### GET /harvest/recommendations 응답

```typescript
{
  summary: {
    status: 'good' | 'caution' | 'warning';
    statusLabel: string;   // "수확 품질 주의"
    mainReason: string;    // "병해 위험 상승 경향 감지"
    subInfo: string;       // "최근 6시간 고습 3.2시간 지속"
  };
  cards: RecommendationCard[];  // 3개, priority_score DESC 정렬
  environment: {
    temperature: number | null;
    humidity: number | null;
    dewPoint: number | null;
    vpdValue: number | null;
    vpdStatus: string | null;
    condensationLevel: string | null;
    highHumidityHours: number;  // 최근 6시간 중 습도 80%+ 시간
    currentStage: string | null;
  };
  activeBatch: {
    id: string;
    cropName: string;
    currentStage: string;
    sowDate: string;
    transplantDate: string | null;
  } | null;
}
```

### 8.2 서비스 구현

```
harvest-recommendation.service.ts (NEW)
├── getRecommendations(userId)
│   ├── 1) 활성 배치 조회 (batchRepo)
│   ├── 2) 최근 작업 이력 조회 (taskLogRepo)
│   ├── 3) 센서 데이터 조회 (dataSource — 재사용 dashboard 쿼리)
│   ├── 4) 점수 계산 (3개 작업 타입별)
│   ├── 5) 추천 사유 생성
│   └── 6) 환경 요약 배너 생성
└── createTaskLog(userId, batchId, taskType)
    ├── 1) 배치 소유권 확인
    └── 2) INSERT harvest_task_logs
```

### 8.3 프론트엔드 변경

```
Harvest.vue (전면 개편)
├── 헤더 영역 (제목 + 배치 설정)
├── HarvestSummaryBanner (환경 요약)
├── RecommendationCards (3개 카드)
│   └── RecommendationCard × 3
└── BatchSection (접이식 배치 관리)
    ├── 활성 배치 표시
    └── 배치 추가 모달 (기존 유지)
```

## 9. 수정 대상 파일

### 9.1 새 파일

| 파일 | 설명 |
|------|------|
| `backend/src/modules/harvest/entities/harvest-task-log.entity.ts` | 작업 완료 로그 엔티티 |
| `backend/src/modules/harvest/harvest-recommendation.service.ts` | 추천 엔진 서비스 |
| `frontend/src/api/harvest-recommendation.api.ts` | 추천 API 클라이언트 |

### 9.2 수정 파일

| 파일 | 변경 내용 |
|------|-----------|
| `frontend/src/views/Harvest.vue` | 전면 개편 (달력 삭제, 추천 카드 UI) |
| `backend/src/modules/harvest/harvest.module.ts` | HarvestTaskLog 엔티티 + RecommendationService 등록 |
| `backend/src/modules/harvest/harvest-task.controller.ts` | 추천 엔드포인트 추가 |

### 9.3 삭제/미사용 처리

| 파일 | 처리 |
|------|------|
| `frontend/src/components/harvest/RescheduleSheet.vue` | 사용하지 않음 (import 제거) |

## 10. 구현 순서

1. **DB 마이그레이션** — `harvest_task_logs` 테이블 생성
2. **백엔드 엔티티/서비스** — `HarvestTaskLog` 엔티티 + `HarvestRecommendationService`
3. **백엔드 API** — `GET /harvest/recommendations` + `POST /harvest/task-logs`
4. **프론트엔드 API** — `harvest-recommendation.api.ts`
5. **프론트엔드 UI** — `Harvest.vue` 전면 개편
6. **빌드 & 통합 테스트**

## 11. 추가 의견 (구현 시 고려사항)

### 11.1 센서 데이터 미수신 시 Fallback
센서 데이터가 없거나 QXJ 장비가 미등록인 경우에도 **주기 기반 기본 추천**은 동작해야 합니다.
- env_modifier = 0 (환경 가중 없음)
- 주기 초과 여부만으로 점수 계산
- 배너: "환경 센서 미연결 — 주기 기반 추천 중"

### 11.2 효과 잔여 표시
카드 하단에 "방제 효과 7일 남음 ━━━━━━━░░░" 같은 프로그레스 바로 효과 잔여 기간을 시각화하면 사용자가 "지금 안 해도 되는 이유"를 직관적으로 이해합니다.

### 11.3 주/야간 기준 반영
이미 `getDayNightParams()` 함수가 구현되어 있으므로, 추천 사유에서도 "야간 고습(85%+) 지속"과 "주간 고습(75%+) 지속"을 구분하여 더 정확한 코칭을 제공합니다.

### 11.4 최근 완료 이력 표시
각 카드에 "마지막 완료: 3일 전" 표시로 사용자가 작업 이력을 한눈에 파악할 수 있게 합니다.

### 11.5 기존 occurrence 시스템과의 공존
기존 `task_occurrences` 테이블과 `batch_tasks` 시스템은 삭제하지 않습니다. 추천 시스템은 독립적인 `harvest_task_logs`를 사용하므로 기존 API와 충돌 없이 공존합니다. 향후 고급 스케줄링이 필요하면 두 시스템을 연동할 수 있습니다.

### 11.6 배치가 없을 때 가이드
활성 배치가 없으면 추천 카드를 표시할 수 없으므로, 친절한 Empty State를 제공합니다:
"작물 배치를 등록하면 환경 기반 관리 추천이 시작됩니다. 파종일과 정식일 정보가 필요합니다."

### 11.7 점수 투명성
카드를 터치/클릭하면 점수 산출 근거를 간단히 볼 수 있는 확장 영역을 고려합니다:
```
점수 82 = 주기 25 + 환경 30 + 단계 10 - 효과 0 + 지연 17
```
이를 통해 사용자가 "왜 이 점수인지" 이해하고 신뢰할 수 있습니다.

## 12. 영향 범위

- **수확 관리 페이지**: 전면 개편 (UI 완전 교체)
- **대시보드**: 영향 없음 (독립적)
- **환경 모니터링**: 센서 데이터를 읽기만 함 (변경 없음)
- **API 하위 호환**: 기존 occurrence/template API 유지, 새 endpoint만 추가
- **DB**: `harvest_task_logs` 테이블 1개 추가 (기존 테이블 변경 없음)
