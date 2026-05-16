---
template: analysis
version: 1.0
feature: opener-actuator-label-i18n
date: 2026-05-15
author: gap-detector
project: smart-farm-mqtt
plan_ref: docs/01-plan/features/opener-actuator-label-i18n.plan.md
design_ref: docs/02-design/features/opener-actuator-label-i18n.design.md
match_rate: 100
status: Complete
---

# opener-actuator-label-i18n Gap Analysis Report

## Analysis Overview

- **Analysis Target**: opener-actuator-label-i18n
- **Plan Document**: [opener-actuator-label-i18n.plan.md](../01-plan/features/opener-actuator-label-i18n.plan.md)
- **Design Document**: [opener-actuator-label-i18n.design.md](../02-design/features/opener-actuator-label-i18n.design.md)
- **Implementation Paths**:
  - [frontend/src/utils/device-labels.ts](../../frontend/src/utils/device-labels.ts)
  - [frontend/src/components/automation/StepActuatorSelect.vue](../../frontend/src/components/automation/StepActuatorSelect.vue)
  - [frontend/src/components/automation/v2/StepDeviceByIntent.vue](../../frontend/src/components/automation/v2/StepDeviceByIntent.vue)
- **Analysis Date**: 2026-05-15
- **Analyzed By**: gap-detector agent

---

## Overall Scores

| Category | Score | Status |
|----------|:-----:|:------:|
| Design Match (FR 충족률) | **100%** | ✅ OK |
| Architecture Compliance | 100% | ✅ OK |
| Convention Compliance | 100% | ✅ OK |
| **Overall** | **100%** | **✅ OK** |

---

## FR별 매트릭스

| FR | 요구사항 | 충족 | 구현 위치 |
|----|----------|:---:|-----------|
| FR-01 | `EQUIPMENT_TYPE_LABEL_KR` 상수 모듈 (`device-labels.ts`) | ✅ | `frontend/src/utils/device-labels.ts:7-13` |
| FR-02 | StepActuatorSelect.vue device-meta에서 category 없을 시 폴백 | ✅ | `StepActuatorSelect.vue:25,53,81` — 모든 섹션에서 `getEquipmentLabel()` 직접 사용, category 의존 제거 |
| FR-03 | StepDeviceByIntent.vue (v2) 카드 메타에 동일 매핑 사용 | ✅ | `StepDeviceByIntent.vue:33` — `getEquipmentLabel(d, { openerPaired: false })` |
| FR-04 | 5개 매핑 일치 (opener_open/close, fan, irrigation, other) | ✅ | `device-labels.ts:7-13` |
| FR-05 | 개폐기 페어 카드 단독 노출 시 "개폐기"로 단순화 | ✅ | `device-labels.ts:34` — `openerPaired === false` 분기 |

**Match Rate: 5 / 5 = 100%**

---

## 세부 확인

### EQUIPMENT_TYPE_LABEL_KR 매핑 일치 여부

| Key | Design 명세 | 구현 값 | 일치 |
|-----|-------------|---------|:----:|
| `fan` | `'환풍기'` | `'환풍기'` | ✅ |
| `irrigation` | `'관수'` | `'관수'` | ✅ |
| `opener_open` | `'개폐기 (열기)'` | `'개폐기 (열기)'` | ✅ |
| `opener_close` | `'개폐기 (닫기)'` | `'개폐기 (닫기)'` | ✅ |
| `other` | `'기타'` | `'기타'` | ✅ |

5개 매핑 전체 일치 (공백·괄호 포함 동일).

### `getEquipmentLabel`의 openerPaired:false 분기

Design 명세와 구현 모두 동일:
```ts
if (t === 'opener_open' && opts?.openerPaired === false) return '개폐기'
```

`openerPaired`가 `undefined`일 때는 분기에 진입하지 않아 `EQUIPMENT_TYPE_LABEL_KR['opener_open']` = `'개폐기 (열기)'`를 반환 — 의도 그대로.

### TypeScript 타입 (`DeviceLike`)

Design은 `Pick<Device, 'equipmentType' | 'deviceType'>` 시그니처를 제시했으나, 구현은 인라인 `interface DeviceLike`를 별도 정의:
```ts
interface DeviceLike {
  equipmentType?: string | null
  deviceType?: string | null
}
```

기능 의도는 동일하게 충족. Device 타입 import 불필요 → 유틸 모듈 독립성 증가. Plan 6.2 "타입과 라벨 분리" 방침과 부합. **의도적 개선이며 Gap 아님.**

### 백엔드 enum 변경 없음 (Out of Scope)

Plan §2.2, Design §6 모두 Out of Scope로 명시. 구현 파일 어디에도 백엔드 수정 흔적 없음. ✅

---

## Gaps

**없음.** 모든 FR 충족. 의도적 Out-of-Scope 항목은 미달성으로 카운트하지 않음.

---

## Out-of-Scope 항목 (미달성 카운트 제외)

| 항목 | 근거 |
|------|-----|
| 백엔드 `equipment_type` enum 영문 유지 | Plan 2.2, Design 6 |
| 활동 로그·장치 관리 페이지 영문 라벨 | Plan 2.2, Design 6 |
| 시스템 전반 i18n 도입 | Plan 2.2, Design 6 |

---

## Recommendation

**Match Rate 100%** — 설계-구현 간 완전한 정합. 즉시 조치 필요 사항 없음.

**선택적 후속 작업**:
1. Design 명세의 `Pick<Device, ...>` 시그니처를 실제 구현(`DeviceLike` 인터페이스)으로 문서 업데이트 (동작 동일, 가독성 목적)
2. Plan §4.1 DoD에 명시된 Playwright E2E 회귀 테스트(`tests/e2e/verify-actuator-labels.ts`)는 이미 Do 단계에서 작성됨 — 회귀 안전성 확보

**다음 단계**: `/pdca report opener-actuator-label-i18n` (matchRate ≥ 90% 임계 충족, report 단계 진입 가능)

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 1.0 | 2026-05-15 | 초기 분석 생성 (gap-detector agent) | system |
