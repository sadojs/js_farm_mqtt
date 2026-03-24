# Gap Analysis: 장비 관리 UI 개선 - 토글 변환 및 관수 상태 모달

## Feature ID
`equipment-ui-toggle-status`

## Date
2026-02-22

## Reference
- Design: `docs/02-design/features/equipment-ui-toggle-status.design.md`
- Plan: `docs/01-plan/features/equipment-ui-toggle-status.plan.md`

---

## Match Rate: 100%

---

## FR별 분석

### FR-01: 개폐기 ON/OFF 버튼 → 토글 스위치 (100%)

| 설계 항목 | 구현 상태 | 비고 |
|-----------|----------|------|
| `opener-btn` → `toggle-switch` 교체 | PASS | Devices.vue L62-81 |
| `@click.prevent` + `interlockControl()` 호출 | PASS | 열림/닫힘 각각 적용 |
| `interlocking` ref `:disabled` + `@click` 조건 | PASS | 양쪽 모두 확인 |
| `.opener-toggle-area.disabled` opacity 처리 | PASS | L912-916 CSS |
| 닫힘(close) 행 동일 패턴 | PASS | L72-80 동일 구조 |

### FR-02: 개폐기 "장비" 뱃지 추가 (100%)

| 설계 항목 | 구현 상태 | 비고 |
|-----------|----------|------|
| `<span class="type-badge actuator">장비</span>` 추가 | PASS | Devices.vue L58 |
| 제목과 삭제 버튼 사이 배치 | PASS | opener-title → 뱃지 → btn-icon-delete |
| 기존 `.type-badge.actuator` 클래스 재사용 | PASS | L617-625 스타일 존재 |

### FR-03: 관수 ON/OFF 버튼 → 토글 스위치 (100%)

| 설계 항목 | 구현 상태 | 비고 |
|-----------|----------|------|
| 타이머 전원/B접점 `toggle-switch` 교체 | PASS | Devices.vue L96-105 |
| 교반기/B접점 `toggle-switch` 교체 | PASS | L106-115 |
| `irrigation-toggle-area` 래퍼 + disabled | PASS | L908-916 CSS |
| `irrigationControlling` 제어 상태 관리 | PASS | `ref<string \| null>(null)` |
| `handleIrrigationControl()` 함수 | PASS | L296-309 |

### FR-04: 관수 상태 모달 - Devices.vue (100%)

| 설계 항목 | 구현 상태 | 비고 |
|-----------|----------|------|
| irrigation-header에 "상태" 버튼 | PASS | L91 `btn-status` |
| `IRRIGATION_SWITCH_LABELS` 8개 스위치 매핑 | PASS | L280-289 |
| `showIrrigationStatusModal` ref | PASS | L277 |
| `irrigationStatusDevice` ref | PASS | L278 |
| `openIrrigationStatusModal()` 함수 | PASS | L291-294 |
| 모달 template (overlay + status-modal) | PASS | L176-198 |
| `@click.self` 배경 클릭 닫기 | PASS | L176 |
| 8개 스위치 ON/OFF 읽기전용 표시 | PASS | v-for + switchStates 참조 |
| `.modal-overlay` CSS | PASS | L936-945 |
| `.status-modal` CSS | PASS | L947-953 |
| `.status-modal-header` CSS | PASS | L955-967 |
| `.close-btn` CSS | PASS | L969-980 |
| `.status-modal-body` CSS | PASS | L982-984 |
| `.status-row` CSS | PASS | L986-1001 |
| `.status-row-value.on/.off` CSS | PASS | L1009-1016 |
| `.btn-status` CSS | PASS | L918-933 |

### FR-05: 그룹 관리 관수 상태 모달 - Groups.vue (100%)

| 설계 항목 | 구현 상태 | 비고 |
|-----------|----------|------|
| 관수 카드 `btn-status-sm` 버튼 | PASS | Groups.vue L101 |
| `IRRIGATION_SWITCH_LABELS` 8개 매핑 | PASS | L366-375 |
| `showIrrigationStatusModal` ref | PASS | L363 |
| `irrigationStatusDevice` ref | PASS | L364 |
| `openIrrigationStatusModal()` 함수 | PASS | L377-380 |
| 모달 template | PASS | L207-229 |
| `.btn-status-sm` CSS | PASS | L953-968 |
| `.status-modal` 및 관련 CSS | PASS | L971-1027 |

---

## 빌드 검증

| 항목 | 결과 |
|------|------|
| `vue-tsc --noEmit` (TypeScript) | PASS |
| `vite build` (프로덕션 빌드) | PASS |

---

## Gap 목록

없음. 모든 FR이 설계 문서와 100% 일치.

---

## 추가 구현 사항 (설계 외)

구현 과정에서 발견한 버그를 추가 수정:

1. **StepDeviceAction.vue TS 에러 수정**: `a.command` 타입 에러 → nullish coalescing(`??`) 추가
2. **RuleWizardModal.vue noSensor 복원 버그 수정**: 관수 자동화 룰 편집 시 "센서 미선택 (시간 기반)" 미선택 문제 → `(rule.conditions as any)?.type === 'irrigation'` 조건 추가

---

## 결론

Match Rate **100%** 달성. 모든 요구사항이 설계대로 구현됨.
`/pdca report equipment-ui-toggle-status`로 완료 보고서 생성 가능.
