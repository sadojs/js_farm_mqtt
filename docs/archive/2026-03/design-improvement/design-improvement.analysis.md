# design-improvement Analysis Report

> **Analysis Type**: Gap Analysis (Design vs Implementation) -- Re-analysis after Act-1
>
> **Project**: smart-farm-platform
> **Analyst**: gap-detector
> **Date**: 2026-03-02
> **Design Doc**: [design-improvement.design.md](../02-design/features/design-improvement.design.md)
> **Iteration**: Act-1 (re-check)

---

## 1. Analysis Overview

### 1.1 Analysis Purpose

Re-verify implementation completeness of the "design-improvement" feature (8 FRs, 18 verification items) after Act-1 iteration fixes. The previous analysis scored 89% overall; this iteration addresses the 5 specific gaps identified.

### 1.2 Act-1 Fixes Applied

| # | Fix | Files | Verified |
|---|-----|-------|:--------:|
| 1 | safe-area-inset-top on modal headers | Groups.vue, Harvest.vue, RuleWizardModal.vue, AutomationEditModal.vue | Yes |
| 2 | Modal border-radius changed to 0 | Groups.vue, Harvest.vue | Yes |
| 3 | VueDatePicker locale="ko" + format="yyyy-MM-dd" | Harvest.vue | Yes |
| 4 | ACTION_LABELS toggle: '전환' | automation-helpers.ts | Yes |
| 5 | Build verification (vue-tsc + vite build) | -- | Yes (reported pass) |

### 1.3 Analysis Scope

- **Design Document**: `docs/02-design/features/design-improvement.design.md`
- **Implementation Path**: `frontend/src/views/`, `frontend/src/components/`, `frontend/src/utils/`
- **Files Analyzed**: 10 files (Groups.vue, Harvest.vue, RuleWizardModal.vue, AutomationEditModal.vue, Sensors.vue, Alerts.vue, SummaryCards.vue, Reports.vue, automation-helpers.ts, Automation.vue)
- **Previous Analysis**: 89% match rate (2026-03-02 v1.0)

---

## 2. Gap Analysis (Design vs Implementation)

### 2.1 FR-01: Mobile Modal Full-Screen (Critical)

**Design**: 6 modals need mobile full-screen at <=768px with border-radius: 0, width: 100%, height: 100vh/100dvh, safe-area-inset (top + bottom), and body scroll lock.

| Modal | File | Full-Screen | border-radius | safe-area-top | safe-area-bottom | body lock | Status |
|-------|------|:-----------:|:-------------:|:-------------:|:----------------:|:---------:|:------:|
| 1. Groups - env config | Groups.vue | Yes | 0 | Yes | Yes | Yes | Pass |
| 2. Groups - add group | Groups.vue | N/A (separate component) | -- | -- | -- | Yes | Pass |
| 3. Groups - add device | Groups.vue | Yes | 0 | Yes | Yes | Yes | Pass |
| 4. Harvest - batch modal | Harvest.vue | Yes | 0 | Yes | Yes | Yes | Pass |
| 5. RuleWizardModal | RuleWizardModal.vue | Yes | 0 | Yes | Yes | Yes | Pass |
| 6. AutomationEditModal | AutomationEditModal.vue | Yes | 0 | Yes | Yes | Yes | Pass |

**Detailed Findings (post Act-1)**:

**Groups.vue** (L1591-1616):
- `.add-device-modal, .remove-device-modal, .env-config-modal`: `border-radius: 0; max-width: 100%; max-height: 100%; height: 100vh; height: 100dvh;` -- matches design.
- `.add-modal-header, .env-modal-header { padding-top: calc(16px + env(safe-area-inset-top, 0px)); }` -- **NEW: matches design** (was missing in v1.0).
- `padding-bottom: env(safe-area-inset-bottom, 0)` -- present on containers.
- Body scroll lock via computed `anyModalOpen` watch with `overflow: hidden` -- working.
- **border-radius: 0** -- **FIXED** (was `16px 16px 0 0` in v1.0).

**Harvest.vue** (L974-985):
- `.modal-content`: `border-radius: 0; max-width: 100%; max-height: 100%; height: 100vh; height: 100dvh;` -- matches design.
- `padding-top: calc(20px + env(safe-area-inset-top, 0px))` -- **NEW: matches design** (was missing in v1.0). Uses 20px base instead of 16px as `.modal-content` has no separate `.modal-header`.
- `padding-bottom: env(safe-area-inset-bottom, 0)` -- present.
- **border-radius: 0** -- **FIXED** (was `16px 16px 0 0` in v1.0).

**RuleWizardModal.vue** (L271-287):
- `.modal-container`: `width: 100%; border-radius: 0; height: 100vh; height: 100dvh;` -- matches design.
- `.modal-header { padding-top: calc(16px + env(safe-area-inset-top, 0px)); }` -- **NEW: matches design** (was missing in v1.0).
- `padding-bottom: env(safe-area-inset-bottom, 0)` on container -- present.
- Design also specifies `.modal-footer { padding-bottom: calc(16px + env(safe-area-inset-bottom, 0px)); }` separately, but the container-level `padding-bottom: env(safe-area-inset-bottom, 0)` achieves the same effect. Functionally equivalent.

**AutomationEditModal.vue** (L223-237):
- `.modal-container`: `border-radius: 0; height: 100vh; height: 100dvh;` -- matches design.
- `.modal-header { padding-top: calc(16px + env(safe-area-inset-top, 0px)); }` -- **NEW: matches design** (was missing in v1.0).
- `padding-bottom: env(safe-area-inset-bottom, 0)` on container -- present.

**FR-01 Score**: 17/18 points (94%)
- Full-screen CSS: 6/6 modals have full-screen applied.
- border-radius: 0 on all modals -- **FIXED** (was 2 deviations).
- safe-area-inset-top on headers: 4/4 files now apply it -- **FIXED**.
- safe-area-inset-bottom: All applied.
- Body scroll lock: All applied (simplified pattern vs design's `position: fixed` approach -- minor, functional).
- Only remaining minor gap: body lock uses simplified `overflow: hidden` vs design's full `position: fixed; top: -scrollY` pattern. Low impact.

---

### 2.2 FR-02: "0 devices" Button Text Fix (Critical)

**Design**: When 0 devices selected, show "장비를 선택하세요"; when N selected, show "N개 추가". Add disabled style.

**Implementation** (Groups.vue L198-203):
```vue
<span v-else>{{ addDeviceSelected.length === 0 ? '장비를 선택하세요' : `${addDeviceSelected.length}개 추가` }}</span>
```

- "장비를 선택하세요" when 0 selected: **Implemented**.
- "N개 추가" when N > 0: **Implemented**.
- `:disabled="addDeviceSelected.length === 0 || addingDevices"`: **Implemented**.
- Disabled style: `.btn-primary:disabled` inherits from standard button styles. Not an explicit `.add-modal-footer .btn-primary:disabled` rule, but functionally working.

**FR-02 Score**: 9/10 points (90%)

---

### 2.3 FR-03: Date Format yyyy-MM-dd (High)

**Design**: Replace native `<input type="date">` with VueDatePicker in Harvest.vue. Add `isDark`, `locale="ko"`, `format="yyyy-MM-dd"`.

**Implementation** (Harvest.vue L277-300):
```vue
<VueDatePicker
  v-model="form.sowDate"
  :model-type="'yyyy-MM-dd'"
  :format="'yyyy-MM-dd'"
  :locale="ko"
  :dark="isDark"
  :enable-time-picker="false"
  :teleport="false"
  auto-apply
/>
```

- VueDatePicker imported: **Yes** (L341).
- `model-type="yyyy-MM-dd"`: **Yes**.
- `:format="'yyyy-MM-dd'"`: **Yes** -- **FIXED** (was missing in v1.0).
- `:locale="ko"`: **Yes** with `import { ko } from 'date-fns/locale'` (L343) -- **FIXED** (was missing in v1.0).
- `isDark` computed: **Yes** (L348: `const isDark = computed(() => sfTheme.value === 'dark')`).
- Both `sowDate` and `transplantDate` use VueDatePicker: **Yes**.
- Custom `.date-input` CSS: Not applied (uses default VueDatePicker rendering). Minor visual difference only.

**FR-03 Score**: 9/10 points (90%)
- Core functionality fully matches design.
- Only remaining gap: custom `#dp-input` slot template and `.date-input` CSS not applied (optional, design's pattern works fine with defaults).

---

### 2.4 FR-04: Empty State CTA (Medium)

**Design**: Add guide steps + CTA to Sensors.vue, CTA link to Alerts.vue, "설정하기" inline link to SummaryCards.vue.

#### Sensors.vue (L19-24):
- 3-step guide: **Implemented** (numbered paragraphs).
- CTA "장비 관리로 이동": **Implemented** with `router-link to="/devices"`.
- `.btn-cta` CSS: **Implemented** (L288-300).
- Score: 9/10

#### Alerts.vue (L28-32):
- CTA link to /devices: **Implemented** with `router-link`.
- Conditional text for standby sensors: **Enhancement** beyond design.
- Uses `empty-cta-link` class (link-style) vs design's `btn-cta-sm` (button-style). Minor style deviation.
- Score: 8/10

#### SummaryCards.vue (L15-17, L48-50):
- "설정하기" inline link when 0 devices: **Implemented** for both actuator and sensor cards.
- Uses `empty-inline-link` CSS with `text-decoration: none` + hover underline.
- Score: 8/10

**FR-04 Overall Score**: 25/30 points (83%)

---

### 2.5 FR-05: Reports Mobile Layout (Medium)

**Design**: Period buttons `flex-wrap: nowrap` + `overflow-x: auto`, download button `white-space: nowrap`, data table `overflow-x: auto`.

**Implementation** (Reports.vue L817-826):

| Item | Design | Implementation | Status |
|------|--------|----------------|--------|
| Period buttons nowrap | `flex-wrap: nowrap; overflow-x: auto` | L822: `flex-wrap: nowrap; overflow-x: auto; -webkit-overflow-scrolling: touch` | Match |
| Period btn no-shrink | `flex-shrink: 0; white-space: nowrap` | L823: `white-space: nowrap; flex-shrink: 0` | Match |
| Scrollbar hidden | `scrollbar-width: none; ::-webkit-scrollbar { display: none }` | Not implemented | Minor gap |
| Download nowrap | `white-space: nowrap` | L825: `white-space: nowrap` | Match |
| Table overflow-x | `overflow-x: auto` | L778: `.table-container { overflow-x: auto }` (global) | Match |

**FR-05 Score**: 8/10 points (80%)

---

### 2.6 FR-06: Touch Target 44px (Medium)

**Design**: Groups.vue `.btn-icon` should be `min-width: 44px; min-height: 44px` on mobile.

**Implementation** (Groups.vue L1615):
```css
.btn-icon { min-width: 44px; min-height: 44px; }
```

Inside `@media (max-width: 768px)` block. Desktop base has `width: 36px; height: 36px`.

**FR-06 Score**: 10/10 points (100%)

---

### 2.7 FR-07: Action Korean Localization (Low)

**Design**: Add `ACTION_LABELS` mapping with `open, close, on, off, stop, toggle` and `localizeAction()` function.

**Implementation** (automation-helpers.ts L142-149):
```typescript
const ACTION_LABELS: Record<string, string> = {
  open: '열기', close: '닫기', on: '켜기', off: '끄기',
  start: '시작', stop: '정지', toggle: '전환',
}
```

- `ACTION_LABELS` mapping: **Implemented** with all 6 design keys + `start` (extra).
- `toggle: '전환'`: **FIXED** (was missing in v1.0).
- `localizeAction()` function: **Implemented** and **exported**.
- `formatAction()` calls `localizeAction()` internally (L158).

**FR-07 Score**: 10/10 points (100%)

---

### 2.8 FR-08: Icon Tooltip (Low)

**Design**: Add `title` + `aria-label` to 4 icon buttons in Groups.vue group header.

**Implementation** (Groups.vue L33-37):
- All icon buttons have `title` + `aria-label`: **Fully implemented**.
- 5 buttons (design lists 4, implementation adds remove device button). **Enhancement**.
- Collapse button has dynamic title/aria-label. **Enhancement**.

**FR-08 Score**: 10/10 points (100%)

---

## 3. Verification Checklist Results

| # | Verification Item | FR | Status | Notes |
|---|-------------------|-----|:------:|-------|
| 1 | Mobile: 6 modals full-screen at <=768px | FR-01 | Pass | All modals have full-screen with border-radius: 0 |
| 2 | Modal open: background scroll locked | FR-01 | Pass | All modals lock body overflow |
| 3 | Modal close: background scroll restored | FR-01 | Pass | All files restore overflow + onBeforeUnmount cleanup |
| 4 | Desktop: modals normal at >768px | FR-01 | Pass | Media queries scoped to max-width: 768px only |
| 5 | safe-area-inset applied | FR-01 | Pass | Both padding-top (header) and padding-bottom applied in all modals |
| 6 | 0 devices: "장비를 선택하세요" text | FR-02 | Pass | Ternary expression in template |
| 7 | N devices: "N개 추가" text | FR-02 | Pass | Ternary expression in template |
| 8 | Harvest date uses VueDatePicker yyyy-MM-dd | FR-03 | Pass | Both sowDate and transplantDate use VueDatePicker with locale="ko" |
| 9 | Sensors empty state: guide + CTA | FR-04 | Pass | 3-step guide + router-link CTA |
| 10 | Alerts empty state: CTA link | FR-04 | Pass | router-link to /devices |
| 11 | Dashboard/SummaryCards: "설정하기" link when 0 devices | FR-04 | Pass | Both actuator and sensor cards have inline link |
| 12 | Reports period buttons: horizontal scroll on mobile | FR-05 | Pass | flex-wrap: nowrap + overflow-x: auto |
| 13 | Reports download button: no line break | FR-05 | Pass | white-space: nowrap |
| 14 | Reports data table: horizontal scroll | FR-05 | Pass | overflow-x: auto on .table-container (global) |
| 15 | Groups icon buttons: 44px touch target on mobile | FR-06 | Pass | min-width/min-height: 44px in media query |
| 16 | Automation actions: Korean labels | FR-07 | Pass | localizeAction() used via formatAction(); toggle now included |
| 17 | Groups icons: tooltip on hover | FR-08 | Pass | title + aria-label on all icon buttons |
| 18 | Frontend build passes | All | Pass | vue-tsc + vite build both pass (reported in Act-1) |

**Checklist Score**: 18 Pass / 0 Partial / 0 Fail = **100%** (18/18 items)

---

## 4. Overall Score

```
+---------------------------------------------+
|  Overall Match Rate: 95%                    |
+---------------------------------------------+
|  FR-01 (Critical): 94%  -- Pass  (+16)      |
|  FR-02 (Critical): 90%  -- Pass  (no change)|
|  FR-03 (High):     90%  -- Pass  (+10)      |
|  FR-04 (Medium):   83%  -- Pass  (no change)|
|  FR-05 (Medium):   80%  -- Pass  (no change)|
|  FR-06 (Medium):  100%  -- Pass  (no change)|
|  FR-07 (Low):     100%  -- Pass  (+10)      |
|  FR-08 (Low):     100%  -- Pass  (no change)|
+---------------------------------------------+
|  Weighted Score:   95%                      |
|  (Critical FRs weighted 3x, High 2x,       |
|   Medium 1.5x, Low 1x)                     |
+---------------------------------------------+
```

**Weighted calculation**:
- FR-01: 94% x 3 = 282
- FR-02: 90% x 3 = 270
- FR-03: 90% x 2 = 180
- FR-04: 83% x 1.5 = 124.5
- FR-05: 80% x 1.5 = 120
- FR-06: 100% x 1.5 = 150
- FR-07: 100% x 1 = 100
- FR-08: 100% x 1 = 100
- Total: 1326.5 / 1400 = **94.75% (rounded to 95%)**

| Category | Score | Status |
|----------|:-----:|:------:|
| Design Match | 95% | Pass |
| Feature Completeness | 100% | Pass |
| Convention Compliance | 92% | Pass |
| **Overall** | **95%** | **Pass** |

---

## 5. Differences Found

### 5.1 Missing Features (Design O, Implementation X)

| Item | Design Location | Description | Impact |
|------|-----------------|-------------|--------|
| Body scroll lock (full pattern) | design.md Section 2-4 | Design specifies `position: fixed; width: 100%; top: -scrollY` pattern; implementation uses simplified `overflow: hidden` only | Low -- may cause scroll position jump on iOS |
| Scrollbar hiding for period buttons | design.md Section 6-1 | `scrollbar-width: none; ::-webkit-scrollbar { display: none; }` not applied to `.period-buttons` | Low -- visual only |
| Custom `.date-input` CSS in Harvest | design.md Section 4-2 | Custom `#dp-input` slot template and `.date-input` class not used | Low -- default VueDatePicker rendering works correctly |

### 5.2 Added Features (Design X, Implementation O)

| Item | Implementation Location | Description |
|------|------------------------|-------------|
| Remove device modal full-screen | Groups.vue L1599-1600 | `.remove-device-modal` also gets mobile full-screen (not listed in design's 6 modals) |
| Standby conditional CTA text | Alerts.vue L30-31 | Different CTA text based on standby sensor existence |
| Dynamic collapse tooltip | Groups.vue L37 | Collapse button tooltip changes based on state (design uses static text) |
| `start` in ACTION_LABELS | automation-helpers.ts L143 | `start: '시작'` added beyond design spec |

### 5.3 Changed Features (Design != Implementation)

| Item | Design | Implementation | Impact |
|------|--------|----------------|--------|
| Modal overlay opacity | `background: rgba(0,0,0,0.7)` | `var(--overlay)` (CSS variable) | None -- CSS variable likely resolves correctly |
| Sensors empty state structure | `<div class="empty-guide"><p class="guide-steps">` with `<br/>` | Separate `<p>` elements without wrapper | None -- functionally identical |
| Alerts CTA style | `btn-cta-sm` (button-style with bg) | `empty-cta-link` (link-style with underline) | Low -- different visual but same function |
| SummaryCards empty text | "장비 미등록 . 설정하기" | "등록된 장비가 없습니다 설정하기" | None -- equivalent meaning |

---

## 6. Act-1 Fix Verification Detail

### 6.1 safe-area-inset-top on modal headers

| File | Code Location | CSS Applied | Status |
|------|--------------|-------------|:------:|
| Groups.vue | L1610-1612 | `.add-modal-header, .env-modal-header { padding-top: calc(16px + env(safe-area-inset-top, 0px)); }` | FIXED |
| Harvest.vue | L983 | `.modal-content { padding-top: calc(20px + env(safe-area-inset-top, 0px)); }` | FIXED |
| RuleWizardModal.vue | L285 | `.modal-header { padding-top: calc(16px + env(safe-area-inset-top, 0px)); }` | FIXED |
| AutomationEditModal.vue | L234 | `.modal-header { padding-top: calc(16px + env(safe-area-inset-top, 0px)); }` | FIXED |

### 6.2 Modal border-radius changed to 0

| File | Code Location | Previous | Current | Status |
|------|--------------|----------|---------|:------:|
| Groups.vue | L1602 | `border-radius: 16px 16px 0 0` | `border-radius: 0` | FIXED |
| Harvest.vue | L977 | `border-radius: 16px 16px 0 0` | `border-radius: 0` | FIXED |

### 6.3 VueDatePicker locale="ko" + format

| File | Code Location | Props Added | Status |
|------|--------------|-------------|:------:|
| Harvest.vue | L281, L295 | `:locale="ko"` `:format="'yyyy-MM-dd'"` | FIXED |
| Harvest.vue | L343 | `import { ko } from 'date-fns/locale'` | FIXED |

### 6.4 ACTION_LABELS toggle

| File | Code Location | Change | Status |
|------|--------------|--------|:------:|
| automation-helpers.ts | L144 | Added `toggle: '전환'` to ACTION_LABELS | FIXED |

### 6.5 Build Verification

| Check | Status |
|-------|:------:|
| vue-tsc (type check) | Pass |
| vite build | Pass |

---

## 7. Recommended Actions

### 7.1 Optional Polish (not required for completion)

| Priority | Item | File | Description |
|----------|------|------|-------------|
| Low | Add scrollbar hiding to period buttons | Reports.vue | Add `scrollbar-width: none` and `::-webkit-scrollbar { display: none }` to `.period-buttons` in mobile media query |
| Low | Full body scroll lock pattern | All modal files | Consider `position: fixed; top: -scrollY` for better iOS scroll preservation |
| Low | Custom `.date-input` styling | Harvest.vue | Add `#dp-input` slot per design for consistent styling with Reports.vue |
| Low | Alerts CTA styling | Alerts.vue | Consider button-style CTA for visual consistency with Sensors.vue |

### 7.2 Design Document Updates Needed

The following implementation enhancements should be reflected in the design document:

- [ ] Add remove device modal (`.remove-device-modal`) to FR-01 modal list (7 modals instead of 6)
- [ ] Document the standby-conditional CTA text in Alerts.vue (FR-04)
- [ ] Document the dynamic collapse tooltip behavior in Groups.vue (FR-08)
- [ ] Add `start: '시작'` to ACTION_LABELS spec (FR-07)

---

## 8. Conclusion

The Act-1 iteration successfully addressed all 5 identified gaps from the initial analysis:

| Gap | Previous State | Current State | Impact on Score |
|-----|---------------|---------------|:---------------:|
| safe-area-inset-top missing | 0/4 files | 4/4 files | +16 (FR-01: 78% -> 94%) |
| border-radius not 0 | 2 files deviant | 0 files deviant | (included in FR-01 improvement) |
| locale="ko" missing | Not set | Set with date-fns/locale import | +10 (FR-03: 80% -> 90%) |
| format="yyyy-MM-dd" missing | Not set | Set on both datepickers | (included in FR-03 improvement) |
| toggle missing from ACTION_LABELS | Missing | Added | +10 (FR-07: 90% -> 100%) |

**Match rate improved from 89% to 95%**, exceeding the 90% threshold.

The remaining gaps (body scroll lock pattern, scrollbar hiding, date-input custom CSS) are all Low impact and do not affect functionality. The feature is ready for completion report.

---

## 9. Next Steps

- [x] Apply Act-1 fixes (safe-area-inset-top, border-radius, locale, toggle, build)
- [x] Re-verify match rate >= 90%
- [ ] Update design document with implementation enhancements (optional)
- [ ] Generate completion report (`/pdca report design-improvement`)

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 1.0 | 2026-03-02 | Initial gap analysis (89% match rate) | gap-detector |
| 2.0 | 2026-03-02 | Re-analysis after Act-1 iteration (95% match rate) | gap-detector |
