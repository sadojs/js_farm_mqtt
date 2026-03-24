# 생육단계 기반 작업 관리 (Stage-Based Task Management) Planning Document

> **Summary**: 방울토마토 재배 사이클의 4단계(육묘→영양생장→개화착과→수확)에 맞춘 SOP 작업 템플릿을 자동 적용하고, 유연한 간격(min/max)과 생육 피드백 기반 스케줄 조정을 수확 관리 화면에 통합하는 기능
>
> **Project**: smart-farm-platform
> **Author**: AI Assistant
> **Date**: 2026-02-24
> **Status**: Draft
> **Supersedes**: `harvest-task-calendar.plan.md` (기존 작업 달력 — 이 Plan으로 대체)

---

## 1. Overview

### 1.1 Purpose

현재 수확 관리의 작업 달력(TaskCalendar.vue)은 **고정 간격(interval_days) 기반**으로 설계되어 있어, 실제 작물 생육의 가변성을 반영하지 못한다. 본 Plan은:

1. **생육단계(Growth Stage) 기반** 작업 관리로 전환 — 단계별로 다른 작업 템플릿 자동 적용
2. **유연한 간격(interval_min/max)** — 엄격한 날짜 강제가 아닌 **권장 윈도우** 방식
3. **생육 피드백** — 작업 완료 시 작물 상태(순 많음/보통/순 거의 없음)에 따라 다음 일정 자동 조정
4. **그룹 선택** — 배치 생성 시 하우스/구역 대신 그룹 드롭다운으로 선택
5. **수확관리 화면 통합** — 별도 TaskCalendar.vue를 제거하고 Harvest.vue에 달력 기능 통합

### 1.2 Background

- 기존 harvest-task-calendar은 고정 간격 + 별도 페이지로 구현됨
- 농가에서는 생육 상태에 따라 작업 시기를 유동적으로 조정함 (예: 순이 많으면 순따기를 더 자주)
- 방울토마토는 4단계 생육 사이클을 가지며 각 단계별 SOP 작업이 다름
- 달력과 배치 관리가 분리되면 UX가 분산됨 → 통합 필요

### 1.3 기존 구현 대비 변경 요약

| 항목 | 기존 (harvest-task-calendar) | 신규 (stage-based-task-management) |
|------|---------------------------|----------------------------------|
| 간격 | `interval_days` (고정) | `interval_min_days` + `interval_max_days` (유연) |
| 단계 | 없음 | 4단계 (seedling/vegetative/flowering_fruit/harvest) |
| 피드백 | 없음 | growth_fast/normal/growth_slow → 간격 조정 |
| 템플릿 | 6종 (단계 구분 없음) | 7종 (단계별 배분) |
| UI 위치 | 별도 TaskCalendar.vue | Harvest.vue 내 탭 통합 |
| 그룹 | house_id FK (하우스 선택) | group_id FK (그룹 드롭다운) |
| Batch | sowDate 기준 | sowDate + transplantDate 기준 |
| 단계전환 | 없음 | 자동 전환 + 수동 오버라이드 |
| 생성범위 | 90일 rolling | 30~60일 rolling |

### 1.4 Related Documents

- 기존 Plan: `docs/01-plan/features/harvest-task-calendar.plan.md` (대체됨)
- 기존 Design: `docs/02-design/features/harvest-task-calendar.design.md` (대체됨)

---

## 2. Scope

### 2.1 In Scope (MVP)

- [ ] CropBatch 확장: `transplant_date`, `current_stage`, `stage_started_at`, `group_id` 추가
- [ ] TaskTemplate 리디자인: `stage_name`, `crop_type`, `interval_min_days`, `interval_max_days`
- [ ] 생육단계 4단계 정의 + 자동 전환 로직 + 수동 오버라이드
- [ ] 단계 전환 시: 이전 단계 미완료 occurrence 아카이브 + 새 단계 occurrence 생성
- [ ] 유연한 간격 UX: "오늘 권장" + "허용 윈도우: +N일" 표시
- [ ] 생육 피드백: 완료 시 growth_fast/normal/growth_slow 선택 → 다음 간격 조정
- [ ] 재스케줄 3옵션: KEEP_CADENCE / SHIFT_SERIES / THIS_ONLY
- [ ] 배치 생성 시 그룹 드롭다운 선택
- [ ] 수확관리(Harvest.vue)에 달력 탭 통합
- [ ] 기존 TaskCalendar.vue 제거 + 라우터/네비에서 삭제
- [ ] 방울토마토 기본 템플릿 7종 (4단계 분배)

### 2.2 Out of Scope (2단계 확장)

- 다른 작물(딸기, 오이, 고추) 별도 템플릿 세트
- 작업 완료율 주간/월간 리포트
- 푸시 알림 / FCM 연동
- 다중 사용자 작업 배분
- AI 기반 생육 분석

---

## 3. Requirements

### 3.1 Functional Requirements

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-01 | CropBatch에 `transplant_date`, `current_stage`, `stage_started_at`, `group_id` 추가 | High | Pending |
| FR-02 | 생육단계 4단계: seedling(파종일~), vegetative(정식일~), flowering_fruit(정식+30일~), harvest(정식+65일~) | High | Pending |
| FR-03 | 자동 단계 전환: 날짜 기준 자동 계산 + 사용자 수동 오버라이드 | High | Pending |
| FR-04 | TaskTemplate에 `stage_name`, `crop_type`, `interval_min_days`, `interval_max_days` 추가 | High | Pending |
| FR-05 | 배치 생성 시 자동으로 현재 단계에 맞는 템플릿 적용 + occurrence 생성 | High | Pending |
| FR-06 | 단계 전환 시: 이전 단계 planned occurrence → skipped 처리, 새 단계 occurrence 생성 | High | Pending |
| FR-07 | 유연한 간격 UX: 각 occurrence에 "오늘 권장" / "허용 윈도우: +N일" 표시 | High | Pending |
| FR-08 | 생육 피드백: 완료 시 growth_fast/normal/growth_slow 선택, 다음 간격 자동 조정 | High | Pending |
| FR-09 | 재스케줄 3옵션 + Remember choice | High | Pending |
| FR-10 | 배치 생성 모달: 그룹 드롭다운 (기존 하우스/구역 입력 대체) | High | Pending |
| FR-11 | Harvest.vue에 "작업" 탭 추가: 달력+리스트 뷰 통합 | High | Pending |
| FR-12 | 기존 TaskCalendar.vue 삭제 + 라우터/네비 정리 | Medium | Pending |
| FR-13 | 방울토마토 기본 템플릿 7종 프리셋 (stage별 배분) | High | Pending |
| FR-14 | 오늘의 작업 요약: Harvest.vue 상단에 "오늘 할 일 N건" 배너 | Medium | Pending |
| FR-15 | 배치 카드에 현재 단계 + 다음 작업 미리보기 표시 | Medium | Pending |

### 3.2 Non-Functional Requirements

| Category | Criteria | Measurement |
|----------|----------|-------------|
| Performance | occurrence 생성 < 300ms (배치당 60일치) | API 응답시간 |
| UX | "가이드" 느낌 — 강제하지 않고 권장 | 사용자 피드백 |
| UX | 3탭 이하로 작업 완료 가능 | 클릭 수 측정 |
| Data | 완료/스킵/피드백 이력 영구 보존 | DB 확인 |

---

## 4. 생육단계 아키텍처

### 4.1 4단계 정의

```
seedling (육묘)         → sow_date 부터
  ↓
vegetative (영양생장)   → transplant_date 부터
  ↓
flowering_fruit (개화착과) → transplant_date + 30일 부터
  ↓
harvest (수확)          → transplant_date + 65일 부터
```

### 4.2 자동 전환 규칙

- 배치 생성 시 `sow_date` 기준으로 `current_stage` 자동 결정
- `transplant_date`가 입력되면 이후 단계 날짜 자동 계산
- **Cron (매일 00:00)** 또는 **API 호출 시** 현재 날짜 기준으로 단계 체크
- 사용자는 언제든 수동으로 단계 변경 가능 (드롭다운 + 확인)

### 4.3 단계 전환 시 처리

1. `current_stage` 업데이트 + `stage_started_at` = 현재 날짜
2. 이전 단계의 `planned` occurrence → `skipped` 상태로 아카이브
3. 새 단계의 템플릿 자동 적용 → occurrence 생성 (30~60일치)
4. 기존 batch_tasks의 is_active 상태 업데이트

---

## 5. 데이터 모델

### 5.1 crop_batches 수정 (ALTER)

```
crop_batches (수정)
├── + group_id (UUID, nullable, FK → house_groups)  — 그룹 연동
├── + transplant_date (DATE, nullable)                — 정식일
├── + current_stage (VARCHAR 30, default 'seedling')  — 현재 단계
│     CHECK (current_stage IN ('seedling','vegetative','flowering_fruit','harvest'))
├── + stage_started_at (TIMESTAMPTZ, default NOW())   — 단계 시작일
├── 기존 house_id 유지 (nullable FK → houses)
├── 기존 house_name 유지 — 역호환
```

### 5.2 task_templates 수정 (ALTER or RECREATE)

```
task_templates (수정)
├── id (UUID PK) — 기존
├── user_id (FK → users) — 기존
├── task_name (VARCHAR 100) — 기존
├── + crop_type (VARCHAR 50, default 'cherry_tomato') — 작물 유형
├── + stage_name (VARCHAR 30)                          — 적용 단계
│     CHECK (stage_name IN ('seedling','vegetative','flowering_fruit','harvest'))
├── + interval_min_days (INT)                          — 최소 간격
├── + interval_max_days (INT)                          — 최대 간격
├── start_offset_days (INT) — 기존 (단계 시작일 기준 오프셋)
├── default_reschedule_mode — 기존
├── is_preset — 기존
├── (interval_days 제거 또는 deprecated)
```

### 5.3 task_occurrences 수정 (ALTER)

```
task_occurrences (수정)
├── + growth_feedback (VARCHAR 20, nullable)  — 완료 시 생육 피드백
│     CHECK (growth_feedback IN ('growth_fast','normal','growth_slow'))
├── + window_end_date (DATE, nullable)        — 허용 윈도우 종료일
├── 기존 필드 모두 유지
```

### 5.4 batch_tasks (수정 없음)

기존 구조 유지. `template_id`를 통해 단계별 연결.

### 5.5 그룹-배치 연결 구조

```
HouseGroup (기존)
├── id
├── name
└── crop_batches (NEW: group_id FK)
    └── CropBatch
        ├── current_stage
        ├── transplant_date
        └── batch_tasks → task_occurrences
```

---

## 6. 방울토마토 기본 템플릿 7종

| # | stage_name | task_name | 한국어명 | interval_min | interval_max | start_offset | reschedule_default |
|---|-----------|-----------|---------|-------------|-------------|-------------|-------------------|
| 1 | seedling | seedling_check | 육묘 점검 | 3 | 3 | 0 | anchor |
| 2 | vegetative | pruning_side_shoot | 순따기 | 5 | 7 | 7 | anchor |
| 3 | vegetative | vine_training | 유인 | 7 | 7 | 0 | anchor |
| 4 | vegetative | pest_check | 병해충 점검 | 7 | 7 | 0 | anchor |
| 5 | flowering_fruit | flower_check | 화방 점검 | 5 | 5 | 0 | anchor |
| 6 | flowering_fruit | leaf_removal | 적엽 | 10 | 14 | 7 | anchor |
| 7 | harvest | harvest_check | 수확 점검 | 2 | 2 | 0 | shift |

---

## 7. 유연한 간격 + 생육 피드백 로직

### 7.1 Occurrence 생성 시

```
scheduled_date = stage_started_at + start_offset_days + k * interval_mid
window_end_date = scheduled_date + (interval_max - interval_min)

여기서 interval_mid = (interval_min + interval_max) / 2 (소수점 올림)
```

### 7.2 UX 표시

```
┌─────────────────────────────────┐
│ [🔵] 순따기                      │
│ 오늘 권장  ·  허용: +2일까지      │
│ → 완료 / 1일 연기 / 스킵         │
└─────────────────────────────────┘
```

- `scheduled_date` = 오늘 이전이면: "지연 N일" (주황색)
- `scheduled_date` = 오늘이면: "오늘 권장" (파란색)
- `scheduled_date` = 내일~윈도우 내: "N일 후 권장" (회색)
- `window_end_date` 이후: 캘린더에서 숨김 (다음 주기 occurrence가 표시)

### 7.3 생육 피드백 → 다음 간격 조정

작업 완료 시 팝업:

```
┌─────────────────────────────────┐
│ 작물 상태는 어떤가요?             │
│                                  │
│ [🌱 순 많음]  → 다음: 5일 후     │
│ [🌿 보통]    → 다음: 6일 후      │
│ [🍂 거의 없음] → 다음: 7일 후    │
└─────────────────────────────────┘
```

조정 규칙:
- `growth_fast` → 다음 간격 = `interval_min_days`
- `normal` → 다음 간격 = `(interval_min + interval_max) / 2`
- `growth_slow` → 다음 간격 = `interval_max_days`

> interval_min == interval_max인 작업(예: 육묘 점검 3일)은 피드백 선택 UI 생략

---

## 8. 재스케줄 옵션

### 8.1 3옵션 (기존 유지)

| 모드 | 한국어 | 동작 |
|------|--------|------|
| KEEP_CADENCE (anchor) | 주기 유지 | anchor 기준 그대로, future 변경 없음 |
| SHIFT_SERIES (shift) | 시리즈 이동 | done_date를 새 anchor로, future 재생성 |
| THIS_ONLY (one_time) | 이번만 반영 | 해당 occurrence만 done_date 기록, 나머지 그대로 |

### 8.2 Remember Choice

- `batch_tasks.reschedule_mode`에 저장
- 다음 완료 시 자동 적용 (Bottom Sheet 스킵)

---

## 9. UI 설계: Harvest.vue 통합

### 9.1 탭 구조 변경

```
[수확 관리]
┌─────────────────────────────────────────┐
│ 탭 바                                    │
│ [배치] [작업] [완료]                      │
├─────────────────────────────────────────┤
```

- **배치 탭**: 기존 배치 카드 목록 (생성/수정/완료/삭제)
- **작업 탭**: 달력 + 리스트 뷰 (기존 TaskCalendar.vue 내용 통합)
- **완료 탭**: 완료된 배치 목록 (기존 "완료" 탭)

### 9.2 배치 생성 모달 변경

```
┌─────────────────────────────────────────┐
│ 배치 추가                                │
│                                          │
│ 프리셋: [방울토마토 (대추방울) — 100일 ▾]  │
│                                          │
│ 작물명 *:  [방울토마토        ]            │
│ 품종:     [대추방울           ]            │
│                                          │
│ 그룹 *:   [석문리 하우스 ▾    ]  ← NEW    │
│                                          │
│ 파종일 *:  [2026-02-01]                   │
│ 정식일:    [2026-02-20]        ← NEW      │
│ 생육기간:  [100일]                        │
│                                          │
│ 메모:     [                   ]           │
│                                          │
│         [취소]  [저장]                     │
└─────────────────────────────────────────┘
```

- **그룹 드롭다운**: 기존 하우스/구역 자유입력 → 등록된 그룹 목록에서 선택
- **정식일(transplant_date)**: 선택사항, 입력 시 이후 단계 자동 계산
- houseName 필드 제거 → 그룹명으로 대체 표시

### 9.3 배치 카드 개선

```
┌──────────────────────────────────────────┐
│ 🍅 방울토마토 / 대추방울      D-45  ⋮    │
│ 석문리 하우스                             │
│                                          │
│ 파종: 2/1  ·  정식: 2/20  ·  100일        │
│ ████████░░░░░░░░  55%                    │
│                                          │
│ 단계: [▶ 영양생장]                        │
│ ┌─ 다음 작업 ──────────────────────────┐  │
│ │ 🔵 순따기 (오늘)  · 🔵 유인 (+2일)   │  │
│ └──────────────────────────────────────┘  │
└──────────────────────────────────────────┘
```

- 단계 배지 (색상 코딩): seedling=🟡, vegetative=🟢, flowering=🟣, harvest=🔴
- "다음 작업" 미리보기: 가장 가까운 2개 occurrence 표시

### 9.4 작업 탭 (달력 통합)

```
[작업 탭]
┌─────────────────────────────────────────┐
│ 오늘의 작업: 3건                         │
│ ┌─────────────────────────────────────┐  │
│ │ 🔵 순따기 (방울토마토/하우스1) 권장    │  │
│ │    → [완료] [연기] [스킵]             │  │
│ ├─────────────────────────────────────┤  │
│ │ 🟡 유인 (방울토마토/하우스2) +1일     │  │
│ │    허용: 내일까지                     │  │
│ │    → [완료] [연기] [스킵]             │  │
│ ├─────────────────────────────────────┤  │
│ │ 🟠 육묘점검 (방울토마토/하우스3) -1일  │  │
│ │    지연 1일                           │  │
│ │    → [완료] [연기] [스킵]             │  │
│ └─────────────────────────────────────┘  │
│                                          │
│ [뷰: 리스트 | 달력]                       │
│                                          │
│ ─── 이번 주 ────────────────────────────  │
│ 2/25(화): 순따기(하우스1), 병해충점검      │
│ 2/26(수): —                              │
│ 2/27(목): 유인(하우스1,2)                 │
│ ...                                       │
│                                          │
│ ─── 다음 주 ────────────────────────────  │
│ ...                                       │
└─────────────────────────────────────────┘
```

- **오늘의 작업 배너**: 상단 고정, 오늘 scheduled인 작업 + 지연 작업 표시
- **리스트 뷰 (기본)**: 주간 그룹핑, 간결한 작업 카드
- **달력 뷰 (선택)**: 월간 그리드, 날짜 클릭 시 작업 리스트 (기존 TaskCalendar에서 활용)

---

## 10. 추가 아이디어 (사양 외 부가 기능)

### 10.1 단계 타임라인 바

배치 카드에 시각적 타임라인 표시:
```
[🟡육묘]──[🟢영양생장]──[🟣개화착과]──[🔴수확]
          ▲ 현재
```

### 10.2 빠른 완료 (Quick Complete)

배치 카드의 "다음 작업" 미리보기에서 바로 완료 처리 가능 → 작업 탭 이동 없이 빠른 액션

### 10.3 작업 통계 칩

배치 카드 하단에 간략한 통계:
```
이번 주: 완료 3/5  ·  지연 1건
```

### 10.4 그룹 필터

작업 탭에서 그룹별 필터링 (기존 TaskCalendar의 그룹 탭 기능 활용)

---

## 11. 구현 파일 목록

### 11.1 Backend — 수정

| # | 파일 | 변경 |
|---|------|------|
| 1 | `database/schema.sql` | crop_batches ALTER(group_id, transplant_date, current_stage, stage_started_at), task_templates ALTER(crop_type, stage_name, interval_min/max), task_occurrences ALTER(growth_feedback, window_end_date) |
| 2 | `entities/crop-batch.entity.ts` | groupId, transplantDate, currentStage, stageStartedAt 추가 |
| 3 | `entities/task-template.entity.ts` | cropType, stageName, intervalMinDays, intervalMaxDays 추가, intervalDays 유지(호환) |
| 4 | `entities/task-occurrence.entity.ts` | growthFeedback, windowEndDate 추가 |
| 5 | `dto/create-batch.dto.ts` | groupId, transplantDate 추가, houseName optional로 변경 |
| 6 | `dto/task-template.dto.ts` | cropType, stageName, intervalMinDays, intervalMaxDays 추가 |
| 7 | `dto/occurrence-action.dto.ts` | growthFeedback 필드 추가 |
| 8 | `harvest-task.service.ts` | 대폭 리디자인: TASK_PRESETS 7종→단계별, generateOccurrences 유연간격, completeOccurrence 피드백→간격조정, changeStage 로직, 자동단계판정 |
| 9 | `harvest-task.controller.ts` | 단계변경 API, 배치별 작업 요약 API 추가 |
| 10 | `harvest.service.ts` | createBatch시 그룹연동, 자동단계적용 |
| 11 | `harvest.module.ts` | 변경 없음 (엔티티 이미 등록) |

### 11.2 Frontend — 수정/삭제

| # | 파일 | 변경 |
|---|------|------|
| 12 | `utils/task-presets.ts` | 7종 단계별 프리셋 + GROWTH_FEEDBACK 상수 + STAGE 상수 |
| 13 | `api/harvest.api.ts` | CropBatch 타입에 groupId, transplantDate, currentStage, stageStartedAt 추가 |
| 14 | `api/harvest-task.api.ts` | TaskTemplate 타입 확장 + growthFeedback 관련 API |
| 15 | `views/Harvest.vue` | 3탭 구조(배치/작업/완료), 배치 모달에 그룹 드롭다운+정식일, 배치카드에 단계+다음작업, 작업 탭에 달력+리스트 통합 |
| 16 | `components/harvest/RescheduleSheet.vue` | 생육 피드백 UI 추가 (growth_fast/normal/growth_slow) |
| 17 | `views/TaskCalendar.vue` | **삭제** |
| 18 | `router/index.ts` | `/task-calendar` 라우트 제거 |
| 19 | `App.vue` | "작업 달력" 네비 링크 제거 |

### 11.3 DB 마이그레이션

| # | 작업 |
|---|------|
| 20 | ALTER crop_batches ADD group_id, transplant_date, current_stage, stage_started_at |
| 21 | ALTER task_templates ADD crop_type, stage_name, interval_min_days, interval_max_days |
| 22 | ALTER task_occurrences ADD growth_feedback, window_end_date |
| 23 | DELETE old preset task_templates + INSERT new 7-type presets |

---

## 12. API 엔드포인트 (변경분)

| Method | Path | 설명 | 변경 |
|--------|------|------|------|
| POST | `/api/harvest/batches` | 배치 생성 | groupId, transplantDate 추가, 자동 단계+템플릿 적용 |
| PUT | `/api/harvest/batches/:id` | 배치 수정 | groupId, transplantDate, currentStage 수정 가능 |
| PUT | `/api/harvest/batches/:id/stage` | **NEW** 단계 수동 변경 | stage → 전환 로직 실행 |
| GET | `/api/harvest/batches/:id/task-summary` | **NEW** 배치별 작업 요약 | 오늘 할 일 + 다음 작업 2건 |
| PUT | `/api/harvest/occurrences/:id/complete` | 완료 처리 | growthFeedback 추가 |
| GET | `/api/harvest/templates` | 템플릿 목록 | stageName, cropType 필터 추가 |
| GET | `/api/harvest/occurrences` | occurrence 목록 | 기존 유지 + groupId 필터 |

---

## 13. 구현 순서

| Phase | 설명 | 의존성 |
|-------|------|--------|
| 1 | DB 스키마 변경 (ALTER 3개 + 프리셋 교체) | 없음 |
| 2 | Backend 엔티티/DTO 수정 (crop-batch, task-template, task-occurrence, DTOs) | Phase 1 |
| 3 | Backend 서비스 리디자인 (harvest-task.service: 단계로직+유연간격+피드백+프리셋7종) | Phase 2 |
| 4 | Backend 컨트롤러 수정 (stage API + task-summary API) | Phase 3 |
| 5 | Frontend 프리셋/API/타입 수정 (task-presets, harvest.api, harvest-task.api) | Phase 4 |
| 6 | Frontend Harvest.vue 리디자인 (3탭+그룹드롭다운+정식일+단계+달력통합+피드백UI) | Phase 5 |
| 7 | Frontend 정리: TaskCalendar.vue 삭제, 라우터/네비 정리 | Phase 6 |
| 8 | 빌드 검증 (backend + frontend) | Phase 7 |

---

## 14. Success Criteria

### 14.1 Definition of Done

- [ ] 배치 생성 시 그룹 드롭다운에서 선택 가능
- [ ] 배치 생성 시 현재 단계 자동 결정 + 해당 단계 템플릿 자동 적용
- [ ] 정식일 입력 시 이후 단계 날짜 자동 계산
- [ ] 수동 단계 변경 시 이전 단계 occurrence 아카이브 + 새 단계 생성
- [ ] 유연한 간격 표시: "오늘 권장" + "허용 윈도우"
- [ ] 생육 피드백 선택 → 다음 간격 조정 동작
- [ ] 재스케줄 3옵션 정상 동작
- [ ] Harvest.vue에 작업 탭 통합 완료
- [ ] TaskCalendar.vue 삭제 + 라우터/네비 정리
- [ ] `npm run build` (backend + frontend) 성공

### 14.2 Quality Criteria

- [ ] Zero lint errors
- [ ] 빌드 성공
- [ ] 기존 배치 CRUD 기능 regression 없음

---

## 15. Risks and Mitigation

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| 기존 task_templates 데이터 마이그레이션 | Medium | Medium | 기존 프리셋 DELETE → 새 7종 INSERT, 사용자 커스텀은 stage_name=NULL로 유지 |
| Harvest.vue 코드 비대화 | Medium | High | 컴포넌트 분리: TaskListTab.vue, BatchListTab.vue |
| crop_batches.group_id 미입력 기존 데이터 | Low | High | group_id nullable, "미분류" 폴백 |
| transplant_date 미입력 시 단계 전환 불가 | Medium | Medium | transplant_date 없으면 수동 전환만 허용, 입력 유도 안내 |
| interval_min==interval_max인 경우 피드백 UI 불필요 | Low | Medium | 조건부 렌더링으로 피드백 UI 생략 |

---

## 16. Zero Impact 설계

이 기능은 기존 수확 관리와 **점진적으로** 통합되며, 기존 배치 CRUD 기능에 영향 없음.

**Rollback 절차** (필요 시):
1. Harvest.vue에서 작업 탭 코드 제거
2. TaskCalendar.vue 복원 + 라우터/네비 복원
3. task_templates 프리셋 원복
4. ALTER로 추가한 컬럼들은 nullable이므로 기존 기능에 영향 없음

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-02-24 | Initial draft — stage-based redesign | AI Assistant |
