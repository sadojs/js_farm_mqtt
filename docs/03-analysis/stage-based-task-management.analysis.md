# Gap Analysis: stage-based-task-management

**Analysis Date**: 2026-02-24
**Overall Match Rate**: 94%
**Status**: PASS (>= 90%)

---

## Summary Scores

| Category | Score | Status |
|----------|:-----:|:------:|
| Design Match (FR Coverage) | 93% | PASS |
| Data Model Compliance | 95% | PASS |
| API Compliance | 95% | PASS |
| UI/UX Compliance | 92% | PASS |
| **Overall** | **94%** | **PASS** |

---

## FR-by-FR Results

| FR | Description | Score | Status |
|----|-------------|:-----:|:------:|
| FR-01 | Batch Management (group dropdown) | 95% | PASS |
| FR-02 | Growth Stage Management (4 stages) | 98% | PASS |
| FR-03 | Task Templates (7 presets) | 100% | PASS |
| FR-04 | Task Occurrence Generation (60d rolling) | 95% | PASS |
| FR-05 | Flexible Scheduling with window | 95% | PASS |
| FR-06 | Growth Feedback on Completion | 100% | PASS |
| FR-07 | Rescheduling Options (3 modes) | 90% | PASS |
| FR-08 | Calendar/Task View in Harvest.vue | 100% | PASS |
| FR-09 | Stage Badge UI | 92% | PASS |
| FR-10 | Backend Auto-Apply Templates | 98% | PASS |

---

## Gaps Found (Minor)

### 1. Duplicate stage field (Low)
- `crop-batch.entity.ts`: `stage` (line 36) and `currentStage` (line 38) redundancy
- `changeStage()` updates both, but could lead to inconsistency

### 2. Legacy house fields retained (Low)
- `houseName`, `houseId` still in entity/DTO (backward compatibility)
- UI correctly uses group dropdown as primary

### 3. Occurrence window display format (Low)
- Design: "Recommended today + Allowed window: +X days"
- Implementation: Date range format (MM-DD ~ MM-DD)

### 4. Fixed 60-day generation window (Low)
- Design: "Rolling 30-60 day"
- Implementation: Fixed 60 days (`OCCURRENCE_DAYS = 60`)

### 5. Reschedule mode naming (Low)
- Design: KEEP_CADENCE / SHIFT_SERIES / THIS_ONLY
- Implementation: anchor / shift / one_time (mapped equivalents)

---

## Added Features (Beyond Design)

| Feature | Location |
|---------|----------|
| BatchTask intermediary entity | batch-task.entity.ts |
| Batch clone | harvest.service.ts:clone() |
| Batch complete | harvest.service.ts:complete() |
| Task postpone (+1 day) | harvest-task.service.ts:postponeOccurrence() |
| Task skip | harvest-task.service.ts:skipOccurrence() |
| Crop presets (6 varieties) | harvest-presets.ts |
| Per-batch task summary | harvest-task.service.ts:getTaskSummary() |

---

## Recommendations

1. **Remove duplicate `stage` field** from CropBatch entity (keep only `currentStage`)
2. **Add database indexes** for performance optimization
3. Update design documentation to reflect BatchTask entity and additional features
