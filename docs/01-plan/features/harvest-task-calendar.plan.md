# 수확관리 작업 달력 (Harvest Task Calendar) Planning Document

> **Summary**: 배치에 SOP 작업 템플릿을 연결하여 달력에 자동 일정을 생성하고, 재스케줄 옵션을 제공하는 기능
>
> **Project**: smart-farm-platform
> **Author**: AI Assistant
> **Date**: 2026-02-24
> **Status**: Draft

---

## 1. Overview

### 1.1 Purpose

현재 수확 관리는 배치(재배 사이클)의 D-Day와 진행률만 추적한다. 실제 농가에서는 배치 기간 중 **반복적인 SOP 작업**(순따기, 유도 등)이 있으며, 이를 달력으로 관리하고 작업 완료 시 이후 일정을 유연하게 재스케줄할 필요가 있다.

### 1.2 Background

- 농가는 정식일 기준으로 순따기(7일 간격), 유도(7일 간격) 등 반복 작업을 수행
- 작업을 예정일보다 일찍/늦게 완료하면 이후 일정을 어떻게 할지 판단이 필요
- 하우스 그룹 단위로 작업 일정을 한눈에 보고 싶은 니즈가 있음
- 기존 수확 관리 모듈에 확장하여 일관된 UX 유지

### 1.3 Related Documents

- 기존 Plan: `docs/01-plan/features/harvest-sensor-alerts.plan.md`
- 기존 Design: `docs/02-design/features/harvest-sensor-alerts.design.md`

---

## 2. Scope

### 2.1 In Scope (MVP)

- [ ] 작업 템플릿(Task Template) CRUD — 프리셋 + 사용자 정의
- [ ] 배치에 템플릿 적용 시 occurrence(작업 일정) 자동 생성 (90일치 rolling)
- [ ] 달력 뷰 + 리스트 뷰 (하루 클릭 → 오늘 할 일 리스트)
- [ ] 작업 상태 관리: 완료 / 1일 연기 / 스킵
- [ ] 재스케줄 3옵션: 주기 유지 / 시리즈 이동 / 이번만 반영
- [ ] "기본값 저장" (작업별 Remember choice)
- [ ] 하우스 그룹별 달력 필터/뷰
- [ ] crop_batches에 house_id FK 추가 (그룹 연동 기반)

### 2.2 Out of Scope (2단계 확장)

- 일정 겹침 자동 정리 (같은 날 작업 묶기)
- 완료율/미이행 주간 리포트
- 푸시 알림 / FCM 연동
- 다중 사용자 작업 배분

---

## 3. Requirements

### 3.1 Functional Requirements

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-01 | 작업 템플릿 CRUD: 작업명, 반복 간격(일), 시작 오프셋(정식일 기준), 기본 재스케줄 모드 | High | Pending |
| FR-02 | SOP 프리셋: 순따기, 유도, 관수, 시비, 방제, 적엽 6종 기본 제공 | High | Pending |
| FR-03 | 배치에 템플릿 적용 시 90일치 occurrence 자동 생성 | High | Pending |
| FR-04 | 달력 뷰: 월간 달력에 occurrence 표시, 하루 클릭 시 작업 리스트 | High | Pending |
| FR-05 | 작업 완료/연기/스킵 처리 | High | Pending |
| FR-06 | 재스케줄 3옵션 Bottom Sheet: 주기 유지 / 시리즈 이동 / 이번만 반영 | High | Pending |
| FR-07 | "앞으로 항상 이 방식으로" Remember choice 토글 | Medium | Pending |
| FR-08 | 하우스 그룹별 필터: 그룹 > 하우스 > 배치 계층 필터 | High | Pending |
| FR-09 | crop_batches에 house_id (optional FK) 추가 + 기존 houseName 유지 | Medium | Pending |
| FR-10 | 리스트 뷰: 날짜순 작업 목록 (달력 대안 뷰) | Medium | Pending |

### 3.2 Non-Functional Requirements

| Category | Criteria | Measurement Method |
|----------|----------|-------------------|
| Performance | occurrence 생성 < 500ms (배치당 90건) | API 응답시간 |
| UX | 달력 렌더링 < 200ms (월간 100건 이내) | 브라우저 렌더 |
| Data | 완료/스킵 이력 영구 보존 | DB 확인 |

---

## 4. 데이터 모델

### 4.1 신규 테이블

```
task_templates
├── id (UUID PK)
├── user_id (FK → users)
├── task_name (VARCHAR 100)       — 예: "순따기", "유도"
├── interval_days (INT)            — 반복 간격 (예: 7)
├── start_offset_days (INT)        — 정식일 기준 오프셋 (예: 7 = 정식+7일)
├── default_reschedule_mode (ENUM) — 'anchor' | 'shift' | 'one_time'
├── is_preset (BOOLEAN)            — 시스템 프리셋 여부
├── created_at, updated_at

batch_tasks (배치-템플릿 연결)
├── id (UUID PK)
├── batch_id (FK → crop_batches)
├── template_id (FK → task_templates)
├── anchor_date (DATE)             — 첫 기준일 (= sowDate + offset)
├── reschedule_mode (ENUM)         — 현재 적용 중인 모드
├── is_active (BOOLEAN)            — 활성 여부
├── created_at

task_occurrences (개별 작업 일정)
├── id (UUID PK)
├── batch_task_id (FK → batch_tasks)
├── batch_id (FK → crop_batches)     — 조회 편의 역정규화
├── scheduled_date (DATE)
├── status (ENUM)                    — 'planned' | 'done' | 'skipped'
├── done_date (DATE, nullable)
├── memo (TEXT, nullable)
├── created_at
```

### 4.2 기존 테이블 수정

```
crop_batches (수정)
├── + house_id (UUID, nullable, FK → houses)  — 그룹 연동용
   (기존 house_name은 유지 — 역호환 + 그룹 미사용 농가 지원)
```

### 4.3 하우스 그룹-배치 연결 구조

```
HouseGroup (기존)
├── houses: House[]
│   └── House.id ← crop_batches.house_id (NEW FK)
│       └── CropBatch
│           └── batch_tasks → task_occurrences
```

- `house_id`가 있는 배치: 그룹별 달력에 자동 포함
- `house_id`가 없는 배치: "미분류" 그룹으로 표시
- 배치 생성 UI에서 하우스 선택 드롭다운 추가 (기존 자유 입력도 유지)

---

## 5. 하우스 그룹별 달력 UX 설계

### 5.1 달력 페이지 구조

```
[작업 달력]
┌─────────────────────────────────────────┐
│ 필터 바                                  │
│ [전체] [석문리 하우스▾] [하우스1▾] [배치▾] │
│ [뷰: 달력 | 리스트]                       │
├─────────────────────────────────────────┤
│ 그룹 탭 (가로 스크롤)                     │
│ [전체] [석문리 하우스] [둔내 비닐하우스]    │
├─────────────────────────────────────────┤
│ 월간 달력                                │
│ ┌─────┬─────┬─────┬─────┬─────┐        │
│ │  1  │  2  │  3  │  4  │  5  │        │
│ │     │ 🟢2 │     │ 🟡1 │     │        │
│ └─────┴─────┴─────┴─────┴─────┘        │
│                                          │
│ (숫자 = 해당 날짜 작업 수, 색상 = 상태)   │
│ 🟢 완료  🔵 예정  🟡 임박  🔴 미수행       │
├─────────────────────────────────────────┤
│ 선택된 날짜: 2월 24일 (월)                │
│                                          │
│ ┌─ 석문리 하우스 / 하우스1 ──────────────┐ │
│ │ 🍅 방울토마토 배치                      │ │
│ │ ┌──────────────────────────────────┐  │ │
│ │ │ [🔵] 순따기  D-0                  │  │ │
│ │ │ → 완료 / 1일 연기 / 스킵          │  │ │
│ │ ├──────────────────────────────────┤  │ │
│ │ │ [🟢] 관수    완료 (09:30)         │  │ │
│ │ └──────────────────────────────────┘  │ │
│ └────────────────────────────────────────┘ │
│                                          │
│ ┌─ 미분류 ───────────────────────────────┐ │
│ │ 🫑 오이 배치 (하우스 3 — 그룹 미지정)   │ │
│ │ ┌──────────────────────────────────┐  │ │
│ │ │ [🔵] 적엽  D-2                    │  │ │
│ │ └──────────────────────────────────┘  │ │
│ └────────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

### 5.2 그룹별 표시 규칙

| 조건 | 표시 방식 |
|------|----------|
| batch.house_id 있음 → house.groupId 있음 | 그룹명 / 하우스명 하위에 배치 표시 |
| batch.house_id 있음 → house.groupId 없음 | "독립 하우스" 섹션에 표시 |
| batch.house_id 없음 (기존 데이터) | "미분류" 섹션에 houseName 문자열 표시 |

### 5.3 그룹 탭 동작

- **전체**: 모든 그룹의 occurrence 표시
- **특정 그룹**: 해당 그룹 하위 하우스의 배치만 필터
- 그룹이 1개뿐이면 탭 숨기고 바로 표시
- 그룹이 없으면 탭 자체 미노출, 배치 목록만 표시

---

## 6. 재스케줄 옵션 상세

### 6.1 Bottom Sheet UI

```
┌─────────────────────────────────────┐
│ 📋 "순따기"를 1일 빨리 완료했습니다   │
│                                     │
│ 이후 일정은 어떻게 할까요?            │
│                                     │
│ ✅ 주기 유지 (권장)                   │
│    원래 7일 간격 그대로 유지           │
│    → 다음: 3/3                       │
│                                     │
│ ⏩ 시리즈 이동                        │
│    완료일 기준으로 전체 이동           │
│    → 다음: 3/2 (1일 앞당겨짐)         │
│                                     │
│ 📌 이번만 반영                        │
│    이번 작업만 날짜 변경               │
│    → 다음: 3/3 (원래대로)             │
│                                     │
│ ─────────────────────────────────── │
│ □ 이 작업은 앞으로 항상 이 방식으로    │
│                                     │
│         [확인]                       │
└─────────────────────────────────────┘
```

### 6.2 재스케줄 로직

| 모드 | anchor_date 변경 | future occurrence 처리 |
|------|-----------------|----------------------|
| **주기 유지 (anchor)** | 변경 없음 | scheduled_date = anchor + k*interval (그대로) |
| **시리즈 이동 (shift)** | done_date로 갱신 | 전체 재생성: new_anchor + k*interval |
| **이번만 반영 (one_time)** | 변경 없음 | 해당 occurrence만 done_date 기록, 나머지 그대로 |

### 6.3 Remember Choice

- `batch_tasks.reschedule_mode`에 저장
- "앞으로 항상 이 방식으로" 토글 ON 시 해당 batch_task의 mode 업데이트
- 이후 같은 batch_task의 작업 완료 시 Bottom Sheet 스킵 → 자동 적용
- 설정 리셋: 템플릿 관리에서 기본값 변경 가능

---

## 7. 구현 파일 목록

### 7.1 Backend (NestJS)

| # | 파일 | 설명 |
|---|------|------|
| 1 | `database/schema.sql` | task_templates, batch_tasks, task_occurrences DDL + crop_batches ALTER |
| 2 | `modules/harvest/entities/task-template.entity.ts` | TaskTemplate 엔티티 |
| 3 | `modules/harvest/entities/batch-task.entity.ts` | BatchTask 엔티티 |
| 4 | `modules/harvest/entities/task-occurrence.entity.ts` | TaskOccurrence 엔티티 |
| 5 | `modules/harvest/entities/crop-batch.entity.ts` | houseId 컬럼 추가 |
| 6 | `modules/harvest/dto/task-template.dto.ts` | 템플릿 CRUD DTO |
| 7 | `modules/harvest/dto/occurrence-action.dto.ts` | 완료/연기/스킵 + 재스케줄 DTO |
| 8 | `modules/harvest/harvest-task.service.ts` | 템플릿 CRUD, occurrence 생성/재스케줄 로직 |
| 9 | `modules/harvest/harvest-task.controller.ts` | 작업 관련 API 엔드포인트 |
| 10 | `modules/harvest/harvest.module.ts` | 엔티티 + 서비스 등록 추가 |

### 7.2 Frontend (Vue 3)

| # | 파일 | 설명 |
|---|------|------|
| 11 | `utils/task-presets.ts` | SOP 프리셋 6종 상수 |
| 12 | `api/harvest-task.api.ts` | 작업 API 클라이언트 |
| 13 | `views/TaskCalendar.vue` | 달력 + 리스트 뷰 메인 페이지 |
| 14 | `components/harvest/RescheduleSheet.vue` | 재스케줄 Bottom Sheet 컴포넌트 |
| 15 | `router/index.ts` | /task-calendar 라우트 추가 |
| 16 | `App.vue` | 네비게이션에 "작업 달력" 추가 |
| 17 | `views/Harvest.vue` | 배치 생성 시 하우스 선택 드롭다운 추가 |

### 7.3 DB 마이그레이션

| # | 작업 | 설명 |
|---|------|------|
| 18 | ALTER crop_batches | house_id 컬럼 추가 (nullable FK) |
| 19 | CREATE task_templates | 신규 테이블 |
| 20 | CREATE batch_tasks | 신규 테이블 |
| 21 | CREATE task_occurrences | 신규 테이블 |

---

## 8. API 엔드포인트

| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/harvest/templates` | 작업 템플릿 목록 (프리셋 포함) |
| POST | `/api/harvest/templates` | 사용자 정의 템플릿 생성 |
| PUT | `/api/harvest/templates/:id` | 템플릿 수정 |
| DELETE | `/api/harvest/templates/:id` | 템플릿 삭제 (프리셋 불가) |
| POST | `/api/harvest/batches/:batchId/apply-template` | 배치에 템플릿 적용 → occurrence 생성 |
| DELETE | `/api/harvest/batches/:batchId/tasks/:batchTaskId` | 배치에서 템플릿 분리 |
| GET | `/api/harvest/occurrences` | occurrence 목록 (날짜 범위 + 필터) |
| PUT | `/api/harvest/occurrences/:id/complete` | 완료 처리 + 재스케줄 |
| PUT | `/api/harvest/occurrences/:id/postpone` | 1일 연기 |
| PUT | `/api/harvest/occurrences/:id/skip` | 스킵 |

---

## 9. Success Criteria

### 9.1 Definition of Done

- [ ] 작업 템플릿 6종 프리셋 + 사용자 정의 CRUD 동작
- [ ] 배치에 템플릿 적용 시 90일치 occurrence 자동 생성 확인
- [ ] 달력에서 날짜별 작업 표시 + 완료/연기/스킵 동작
- [ ] 재스케줄 3옵션이 올바르게 future occurrence에 반영
- [ ] Remember choice 토글이 batch_task에 저장되어 이후 자동 적용
- [ ] 하우스 그룹별 필터링 동작
- [ ] `npm run build` (backend + frontend) 성공

### 9.2 Quality Criteria

- [ ] Zero lint errors
- [ ] 빌드 성공
- [ ] 기존 수확 관리 기능 정상 동작 (regression 없음)

---

## 10. Risks and Mitigation

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| occurrence 대량 생성 시 DB 부하 | Medium | Low | 90일 rolling + batch insert |
| 시리즈 이동 시 모든 future occurrence 재생성 비용 | Medium | Medium | batch_task당 occurrence 수 제한 (90건) |
| houseName↔house_id 불일치 (기존 데이터) | Low | Medium | house_id nullable, "미분류" 폴백 |
| 재스케줄 로직 복잡도 | Medium | Medium | 서비스 메서드 분리 + 단위 테스트 |

---

## 11. Zero Impact 설계

이 기능은 기존 수확 관리와 **독립적으로** 삭제 가능하게 설계:

**삭제 절차** (기능 제거 시):
1. `TaskCalendar.vue` 삭제
2. `RescheduleSheet.vue` 삭제
3. `harvest-task.api.ts`, `task-presets.ts` 삭제
4. `harvest-task.service.ts`, `harvest-task.controller.ts` 삭제
5. 3개 엔티티 파일 삭제
6. `harvest.module.ts`에서 엔티티/서비스 등록 제거
7. 라우터/네비게이션에서 제거
8. DROP TABLE task_occurrences, batch_tasks, task_templates
9. crop_batches.house_id 컬럼은 유지 (그룹 연동은 독립 가치)

---

## 12. 구현 순서

| Phase | 설명 | 의존성 |
|-------|------|--------|
| 1 | DB 스키마 (4개 DDL + ALTER) | 없음 |
| 2 | Backend 엔티티 + DTO (4개) | Phase 1 |
| 3 | Backend 서비스 + 컨트롤러 | Phase 2 |
| 4 | Frontend 프리셋 + API 클라이언트 | Phase 3 |
| 5 | Frontend 달력 페이지 + 재스케줄 시트 | Phase 4 |
| 6 | Harvest.vue 하우스 선택 연동 | Phase 1 |
| 7 | 빌드 검증 | Phase 5, 6 |

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-02-24 | Initial draft | AI Assistant |
