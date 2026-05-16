---
template: design
version: 1.0
feature: opener-actuator-label-i18n
date: 2026-05-15
author: ohgane
project: smart-farm-mqtt
plan_ref: docs/01-plan/features/opener-actuator-label-i18n.plan.md
status: Draft
---

# opener-actuator-label-i18n Design Document

> **Plan**: [opener-actuator-label-i18n.plan.md](../../01-plan/features/opener-actuator-label-i18n.plan.md)
>
> **Goal**: 자동제어 위저드에서 영문 노출되는 장비 타입 라벨(`opener`, `fan` 등)을 한국어로 통일

---

## 1. Architecture

### 1.1 Component Diagram

```
┌──────────────────────────────────────────────────────────┐
│ frontend/src/utils/device-labels.ts (신규)                │
│  - EQUIPMENT_TYPE_LABEL_KR: Record<equipmentType, string> │
│  - getEquipmentLabel(device): string                      │
└──────────────────────────────────────────────────────────┘
              ▲                              ▲
              │                              │
   ┌──────────┴──────────┐         ┌────────┴───────────┐
   │ StepActuatorSelect  │         │ StepDeviceByIntent │
   │ (legacy EDIT)       │         │ (v2 CREATE)        │
   └─────────────────────┘         └────────────────────┘
```

### 1.2 Data Model (변경 없음)

- 백엔드 `devices.equipment_type` enum 영문 유지: `'fan' | 'irrigation' | 'opener_open' | 'opener_close' | 'other'`
- 라벨은 프론트엔드 표시 계층에서만 한국어 변환

---

## 2. API / Interface

### 2.1 신규 유틸 모듈

**File**: `frontend/src/utils/device-labels.ts`

```ts
import type { Device } from '@/types/device.types'

export const EQUIPMENT_TYPE_LABEL_KR: Record<string, string> = {
  fan: '환풍기',
  irrigation: '관수',
  opener_open: '개폐기 (열기)',
  opener_close: '개폐기 (닫기)',
  other: '기타',
}

/**
 * 장치의 표시용 한국어 장비 라벨 반환.
 * - 개폐기 페어 대표(opener_open) 단독 노출 시: "개폐기" (열기/닫기 표기 생략)
 * - 그 외: 매핑 라벨 반환, 매핑 없으면 영문 그대로
 */
export function getEquipmentLabel(
  device: Pick<Device, 'equipmentType' | 'deviceType'>,
  opts?: { openerPaired?: boolean },
): string {
  const t = device.equipmentType
  if (!t) return device.deviceType === 'sensor' ? '측정기' : '장치'
  // 페어 대표만 단독 노출 시 "개폐기"
  if (t === 'opener_open' && opts?.openerPaired === false) return '개폐기'
  return EQUIPMENT_TYPE_LABEL_KR[t] ?? t
}
```

### 2.2 사용처

| 컴포넌트 | 노출 위치 | opts.openerPaired |
|---------|----------|-------------------|
| `StepActuatorSelect.vue` | 개폐기 섹션 카드의 메타 라벨 (currently `opener`) | `false` (단독 카드) |
| `StepActuatorSelect.vue` | 휀/기타 섹션 카드의 카테고리/장비 라벨 | undefined |
| `StepDeviceByIntent.vue` (v2) | 카드 메타 라벨 | `false` (개폐기는 페어 대표만 노출) |

---

## 3. UI Changes

### 3.1 StepActuatorSelect.vue (EDIT 위저드 Step 2)

**Before**:
```html
<div class="device-meta">
  <span class="category">{{ device.category }}</span>
  <span class="status" :class="{ online: device.online }">…</span>
</div>
```
→ `device.category`가 비어있는 경우 (e.g. 'other') 빈 칸 발생

**After**:
```html
<div class="device-meta">
  <span class="category">{{ getEquipmentLabel(device, { openerPaired: false }) }}</span>
  <span class="status" :class="{ online: device.online }">…</span>
</div>
```
→ 항상 한국어 라벨 노출

### 3.2 StepDeviceByIntent.vue (v2 CREATE)

동일 패턴 적용. 메타 영역에 `getEquipmentLabel(device, { openerPaired: false })`.

### 3.3 디자인 회귀 비교

| 화면 | Before | After |
|------|--------|-------|
| EDIT Step 2 개폐기 카드 | "opener · 온라인" | "개폐기 · 온라인" |
| EDIT Step 2 휀 카드 | "fan · 온라인" | "환풍기 · 온라인" |
| v2 CREATE 장치 카드 | (category 또는 영문) | "개폐기 / 환풍기" |

---

## 4. Implementation Order

1. **[15 min]** `frontend/src/utils/device-labels.ts` 신규 생성 (FR-01, FR-04)
2. **[10 min]** `StepActuatorSelect.vue` 메타 라벨을 `getEquipmentLabel()` 호출로 교체 (FR-02, FR-05)
3. **[10 min]** `StepDeviceByIntent.vue` 동일 적용 (FR-03)
4. **[10 min]** `Device` 타입에 영향 없음 확인 + `npx vue-tsc --noEmit` 통과
5. **[10 min]** Playwright 회귀 테스트 `tests/e2e/verify-actuator-labels.ts`
   - EDIT Step 2: "개폐기", "환풍기" 라벨 노출 확인
   - v2 CREATE 장치 단계: 동일

총 예상: ~55분

---

## 5. Test Cases

### 5.1 단위 행위

| Input | Output |
|-------|--------|
| `getEquipmentLabel({equipmentType:'fan'})` | `'환풍기'` |
| `getEquipmentLabel({equipmentType:'opener_open'}, {openerPaired:false})` | `'개폐기'` |
| `getEquipmentLabel({equipmentType:'opener_open'})` | `'개폐기 (열기)'` |
| `getEquipmentLabel({equipmentType:'other'})` | `'기타'` |
| `getEquipmentLabel({equipmentType:undefined, deviceType:'sensor'})` | `'측정기'` |

### 5.2 E2E 회귀

- **시나리오 A**: EDIT 위저드 진입 → Step 2 actuator 단계 → 개폐기 카드 메타가 "개폐기"로 표시되는지 검증
- **시나리오 B**: 휀 카드는 "환풍기"
- **시나리오 C**: v2 CREATE → device-by-intent 단계 → 동일

---

## 6. Out of Scope (Plan 그대로)

- 백엔드 enum 영문 유지
- 활동 로그/장치 관리 페이지 외 영역의 영문 라벨 (별도 사이클)
- 시스템 전반 i18n 도입 — 한국어 단일 락인 유지

---

## 7. Dependencies

- 신규 NPM 패키지 없음
- 기존 `Device` 타입 활용

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 1.0 | 2026-05-15 | Initial design | ohgane |
