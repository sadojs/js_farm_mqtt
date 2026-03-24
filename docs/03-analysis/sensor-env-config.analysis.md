# Gap Analysis: sensor-env-config

> **Date**: 2026-02-28 (2차 분석)
> **Feature**: 센서 환경 설정 + 휀 멀티 선택 + 조건 센서 환경설정 항목 변경
> **Match Rate**: 100%
> **Status**: PASS

---

## 검증 결과 요약

| Section | Items | Pass | Changed | Fail | Score |
|---------|:-----:|:----:|:-------:|:----:|:-----:|
| A. 휀 멀티 선택 | 10 | 10 | 0 | 0 | 100% |
| B. 조건 센서 환경설정 항목 | 13 | 13 | 0 | 0 | 100% |
| C. 연관 컴포넌트 정합성 | 2 | 2 | 0 | 0 | 100% |
| **Total** | **25** | **25** | **0** | **0** | **100%** |

---

## A. 휀 멀티 선택 (10/10)

| ID | 항목 | 결과 | 근거 |
|----|------|:----:|------|
| A-01 | `WizardFormData.actuatorDeviceIds: string[]` | PASS | `automation.types.ts:69` |
| A-02 | 휀(fan) vs 기타 분리, 체크박스/라디오 | PASS | `StepActuatorSelect.vue:11-64` |
| A-03 | emit `'update:selectedIds': [string[]]` | PASS | `StepActuatorSelect.vue:77-79` |
| A-04 | `v-model:selectedIds="formData.actuatorDeviceIds"` | PASS | `RuleWizardModal.vue:33` |
| A-05 | canNext step 3: `actuatorDeviceIds.length > 0` | PASS | `RuleWizardModal.vue:150` |
| A-06 | canSave: `actuatorDeviceIds.length > 0` | PASS | `RuleWizardModal.vue:168` |
| A-07 | selectedEquipmentType: 첫 번째 장비 기준 | PASS | `RuleWizardModal.vue:138-143` |
| A-08 | handleSave: `targetDeviceIds` 배열 | PASS | `RuleWizardModal.vue:183-185` |
| A-09 | editRule 복원: targetDeviceIds 배열 변환 | PASS | `RuleWizardModal.vue:109-111` |
| A-10 | `createEmptyWizardForm()`: `actuatorDeviceIds: []` | PASS | `automation-helpers.ts:158` |

## B. 조건 센서 환경설정 항목 (13/13)

| ID | 항목 | 결과 | 근거 |
|----|------|:----:|------|
| B-01 | `ENV_ROLE_FIELD_CONFIG` 7개 roleKey | PASS | `automation-helpers.ts:8-20` |
| B-02 | `FIELD_LABELS` env role key 포함 | PASS | `automation-helpers.ts:35-41` |
| B-03 | `FIELD_UNITS` env role key 포함 | PASS | `automation-helpers.ts:52-58` |
| B-04 | `StepConditionBuilder` groupId prop | PASS | `StepConditionBuilder.vue:228` |
| B-05 | onMounted/watch: getRoles + getResolved | PASS | `StepConditionBuilder.vue:241-256` |
| B-06 | availableFields: env roles + hour | PASS | `StepConditionBuilder.vue:299-348` |
| B-07 | 드롭다운: `내부 온도(25.3°C)` 형식 | PASS | `StepConditionBuilder.vue:315-321` |
| B-08 | condition.field에 roleKey 저장 | PASS | `StepConditionBuilder.vue:319` |
| B-09 | RuleWizardModal: groupId 전달 | PASS | `RuleWizardModal.vue:45` |
| B-10 | AutomationEditModal: groupId 전달 | PASS | `AutomationEditModal.vue:28` |
| B-11 | `getEnvRoleMap(groupId)` sensor/weather 조회 | PASS | `automation-runner.service.ts:382-433` |
| B-12 | getLatestSensorMap에 envRoleMap 병합 | PASS | `automation-runner.service.ts:369-373` |
| B-13 | 하위 호환: 기존 field 동작 유지 | PASS | `automation-runner.service.ts:346-367` |

## C. 연관 컴포넌트 정합성 (2/2)

| ID | 항목 | 결과 | 근거 |
|----|------|:----:|------|
| C-01 | StepReview: actuatorDeviceIds 배열 표시 | PASS | `StepReview.vue:109-116` |
| C-02 | AutomationEditModal: reviewFormData 배열 | PASS | `AutomationEditModal.vue:104-117` |

---

## 추가 구현 (설계 외)

| 항목 | 위치 | 설명 |
|------|------|------|
| targetDeviceId 하위호환 | `RuleWizardModal.vue:183` | `targetDeviceIds` 외에 `targetDeviceId`도 설정 (기존 호환) |
| Hysteresis UI (FR-02) | `StepConditionBuilder.vue:55-78` | 이전 기능 유지 |
| Relay option (FR-04) | `StepConditionBuilder.vue:150-155` | 이전 기능 유지 |
| Time scheduler (FR-03) | `StepConditionBuilder.vue:165-193` | 이전 기능 유지 |

---

## 1차 분석 이력

- **2026-02-27**: Match Rate 97%, PASS 19 / CHANGED 1 (EnvMapping entity type:varchar)
- **2026-02-28**: Match Rate 100%, PASS 25 / CHANGED 0 / FAIL 0 (2차 분석 - 휀 멀티선택 + 조건 센서 환경설정 통합)
