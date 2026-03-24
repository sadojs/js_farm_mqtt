# Plan: harvest-schedule-fix

**Feature**: 수확관리 스케줄 계산 수정 + 달력 뷰 추가
**Date**: 2026-02-24

---

## Problem Analysis

### Bug 1: anchorDate가 파종/정식 날짜 기준이 아님
- `calcAnchorDate()`가 `batch.stageStartedAt`(=배치 생성 시각)을 우선 사용
- 실제로는 **정식일(transplantDate)** 기준으로 각 단계 시작일을 계산해야 함
- 예) 정식일 3/1 + vegetative offset 7일 = 순따기 anchorDate 3/8

**현재 코드 (잘못됨)**:
```typescript
private calcAnchorDate(batch, template): string {
  const baseDate = batch.stageStartedAt        // ← 배치 생성시각 사용
    ? new Date(batch.stageStartedAt).toISOString().slice(0, 10)
    : batch.transplantDate || batch.sowDate;
  return this.addDays(baseDate, template.startOffsetDays);
}
```

### Bug 2: 배치 생성 시 항상 seedling 단계로 시작
- `harvest.service.ts`의 `create()`에서 `currentStage: 'seedling'` 고정
- 정식일이 이미 지났으면 vegetative 이상이어야 하는데 seedling으로 설정됨
- seedling 프리셋(육묘점검)이 적용되어 불필요한 작업이 생성됨

### Issue 3: 육묘는 종묘사 위탁이므로 불필요
- 사용자는 종묘사에 맡기기 때문에 seedling 단계 작업 불필요
- **정식일 이후** 스케줄만 보여주면 됨

### Feature Request: 달력 뷰 추가
- 현재 리스트 형태(overdue/today/upcoming)만 존재
- 월간 달력 그리드에서 날짜별 작업을 시각적으로 확인하고 싶음

---

## Functional Requirements

### FR-01: anchorDate를 정식일/파종일 기준으로 계산
- **vegetative**: anchorDate = `transplantDate` + startOffsetDays
- **flowering_fruit**: anchorDate = `transplantDate` + 30일 + startOffsetDays
- **harvest**: anchorDate = `transplantDate` + 65일 + startOffsetDays
- **seedling**: anchorDate = `sowDate` + startOffsetDays (유지하되 사용 안함)
- `stageStartedAt`은 anchorDate 계산에 사용하지 않음 (단계 추적용으로만 유지)

### FR-02: 배치 생성 시 정식일 기준 자동 단계 판정
- transplantDate가 있고 이미 지난 경우 → `determineStage()` 호출하여 올바른 단계 설정
- transplantDate 없으면 seedling (종묘사 위탁 중)
- transplantDate 있고 미래 → seedling (아직 정식 안함, 그러나 vegetative 템플릿을 미리 생성)

### FR-03: seedling 프리셋 스킵 + 정식일 이후만 표시
- 배치 생성 시 seedling 템플릿 적용 **안함** (종묘사 위탁)
- transplantDate가 있으면 **vegetative부터** 템플릿 적용
- transplantDate가 없으면 아무 템플릿도 적용하지 않음 (정식일 입력 시 적용)
- occurrences 조회 시 `transplantDate` 이전 날짜는 필터링

### FR-04: 작업 탭에 달력/리스트 전환 토글
- 기본: 리스트 뷰 (현재와 동일)
- 토글로 달력 뷰 전환 가능
- 달력 뷰: 월간 그리드 (42셀), 날짜 클릭 시 해당 날짜 작업 표시
- 달력 셀에 작업 개수 dot 표시 (overdue=빨강, today=파랑, planned=회색)
- 월 이동 (< 이전 / 다음 >)

### FR-05: occurrence 생성 시 과거 날짜도 포함 (transplantDate~today)
- 현재: `if (schedDate < today) continue;` → 과거 스킵
- 변경: `if (schedDate < transplantDate) continue;` → 정식일 이전만 스킵
- 과거~오늘 사이의 작업은 "지연(overdue)" 상태로 표시
- 이를 통해 정식 후 놓친 작업도 확인 가능

---

## Implementation Phases

### Phase 1: 백엔드 - calcAnchorDate 수정
- `calcAnchorDate()`: 단계별 기준일 계산 (transplantDate + stageOffset + templateOffset)
- 상수 추가: `STAGE_OFFSETS = { seedling: 0, vegetative: 0, flowering_fruit: 30, harvest: 65 }`
- anchorDate = transplantDate + stageOffset + startOffsetDays

### Phase 2: 백엔드 - 배치 생성 로직 수정
- `harvest.service.ts create()`: transplantDate가 있으면 `determineStage()` 호출
- `harvest.controller.ts create()`: seedling이면 applyStageTemplates 스킵, vegetative 이상이면 해당+이전 단계 모두 적용
- occurrence 생성에서 `schedDate < today` 대신 `schedDate < transplantDate` 기준

### Phase 3: 백엔드 - seedling 프리셋 제외
- `applyStageTemplates`: seedling 단계에서는 적용하지 않음
- 또는 seedling 프리셋 자체를 삭제 (종묘사 위탁)
- `STAGE_TASK_PRESETS`에서 seedling 제거

### Phase 4: 프론트엔드 - 달력/리스트 전환 토글
- `viewMode` ref: 'list' | 'calendar'
- 토글 UI 추가 (필터 행에)
- 달력 컴포넌트: 42셀 월간 그리드
- 달력 셀: 날짜 + 작업 dot (색상별)
- 날짜 클릭 → 선택일 작업 리스트 하단 표시
- 월 이동 화살표

### Phase 5: 빌드 검증 + E2E 테스트
- backend tsc + nest build
- frontend vue-tsc + vite build
- API 테스트: 배치 생성 → occurrence 날짜 확인 → 달력 뷰 확인

---

## Modified Files

| File | Change |
|------|--------|
| `backend/.../harvest-task.service.ts` | calcAnchorDate 전면 수정, STAGE_OFFSETS 추가, seedling 제외, occurrence 과거날짜 포함 |
| `backend/.../harvest.service.ts` | create()에서 determineStage 호출 |
| `backend/.../harvest.controller.ts` | seedling일 때 applyStageTemplates 스킵 |
| `frontend/src/views/Harvest.vue` | 달력/리스트 토글 + 달력 그리드 컴포넌트 |

---

## Verification (8 items)

1. 정식일 3/1 배치 생성 → 순따기 anchorDate = 3/8 (3/1 + 7일 offset)
2. 정식일 3/1 배치 생성 → 화방점검 anchorDate = 3/31 (3/1 + 30일)
3. 정식일 3/1 배치 생성 → 수확점검 anchorDate = 5/5 (3/1 + 65일)
4. 정식일 없이 배치 생성 → seedling, 템플릿 적용 안됨
5. seedling 프리셋(육묘점검) occurrence 생성 안됨
6. 달력 뷰에서 월 이동 가능
7. 달력 날짜 클릭 시 해당 날짜 작업 표시
8. 리스트 뷰 기존 기능 유지 (overdue/today/upcoming)
