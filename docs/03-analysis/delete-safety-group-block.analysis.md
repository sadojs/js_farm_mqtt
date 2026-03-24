# delete-safety-group-block Analysis Report

> **Analysis Type**: Gap Analysis (Design vs Implementation)
>
> **Project**: smart-farm-platform
> **Analyst**: bkit-gap-detector
> **Date**: 2026-03-02
> **Plan Doc**: [delete-safety-group-block.plan.md](../01-plan/features/delete-safety-group-block.plan.md)
> **Design Doc**: [delete-dependency-safety.design.md](../02-design/features/delete-dependency-safety.design.md)

---

## 1. Analysis Overview

### 1.1 Analysis Purpose

Plan `delete-safety-group-block`(FR-01 ~ FR-03)과 Design `delete-dependency-safety`를 기준으로 실제 구현 코드의 일치도를 검증한다.
Plan은 "그룹 포함 장비 삭제 시 차단" 기능의 버그 수정 요구사항이며, Design은 장비/그룹 의존성 안전 삭제의 전체 설계를 포괄한다.

### 1.2 Analysis Scope

**Design Documents:**
- `docs/01-plan/features/delete-safety-group-block.plan.md`
- `docs/02-design/features/delete-dependency-safety.design.md`

**Implementation Files:**
- Backend: `backend/src/modules/devices/devices.service.ts`, `devices.controller.ts`, `devices.module.ts`
- Backend: `backend/src/modules/groups/groups.service.ts`, `groups.controller.ts`, `groups.module.ts`
- Frontend: `frontend/src/api/device.api.ts`, `frontend/src/api/group.api.ts`
- Frontend: `frontend/src/types/device.types.ts`, `frontend/src/types/group.types.ts`
- Frontend: `frontend/src/views/Devices.vue`, `frontend/src/views/Groups.vue`
- Frontend: `frontend/src/components/common/DeleteBlockingModal.vue`

---

## 2. Verification Checklist

### 2.1 Backend (FR-01 + Design)

| # | Checklist Item | Status | Evidence |
|---|----------------|:------:|----------|
| 1 | `getDependencies()` includes `groups.length === 0` in `canDelete` | PASS | `devices.service.ts:190` -- `const canDelete = automationRules.length === 0 && pairedDeviceAutomationRules.length === 0 && groups.length === 0` |
| 2 | `getDependencies()` returns `groups` array in response | PASS | `devices.service.ts:200` -- `groups` field included in return object |
| 3 | `GET /devices/:id/dependencies` endpoint exists | PASS | `devices.controller.ts:45-48` -- `@Get(':id/dependencies')` |
| 4 | `GET /groups/:id/dependencies` endpoint exists | PASS | `groups.controller.ts:20-23` -- `@Get(':id/dependencies')` |
| 5 | `DELETE /devices/:id/opener-pair` endpoint exists | PASS | `devices.controller.ts:50-54` -- `@Delete(':id/opener-pair')` |
| 6 | `removeOpenerPair()` does atomic pair deletion | PASS | `devices.service.ts:204-238` -- group_devices cleanup + `In(ids)` delete in sequence |
| 7 | `remove()` blocks opener devices (BadRequestException) | PASS | `devices.service.ts:246-248` -- throws `BadRequestException` for opener types |
| 8 | `removeGroup()` checks automation rules before deletion | PASS | `groups.service.ts:85-106` -- queries rules, throws `ConflictException` if any |
| 9 | DevicesModule imports AutomationRule entity | PASS | `devices.module.ts:7,13` -- `import AutomationRule`, `TypeOrmModule.forFeature([..., AutomationRule])` |
| 10 | GroupsModule imports AutomationRule entity | PASS | `groups.module.ts:8,11` -- `import AutomationRule`, `TypeOrmModule.forFeature([..., AutomationRule])` |

**Backend Score: 10/10 (100%)**

---

### 2.2 Frontend (FR-02 + FR-03 + Design)

| # | Checklist Item | Status | Evidence |
|---|----------------|:------:|----------|
| 11 | `deviceApi.getDependencies()` exists | PASS | `device.api.ts:29-30` -- `getDependencies: (id) => apiClient.get<DeviceDependenciesResponse>(...)` |
| 12 | `deviceApi.removeOpenerPair()` exists | PASS | `device.api.ts:32-33` -- `removeOpenerPair: (id) => apiClient.delete(...)` |
| 13 | `groupApi.getDependencies()` exists | PASS | `group.api.ts:38-39` -- `getDependencies: (id) => apiClient.get<GroupDependenciesResponse>(...)` |
| 14 | `DeviceDependenciesResponse` type defined | PASS | `device.types.ts:61-72` -- includes `canDelete`, `isOpenerPair`, `pairedDevice`, `automationRules`, `pairedDeviceAutomationRules`, `groups` |
| 15 | `GroupDependenciesResponse` type defined | PASS | `group.types.ts:44-47` -- includes `canDelete`, `automationRules` |
| 16 | `handleRemoveDevice` calls `getDependencies` before deletion | PASS | `Devices.vue:444` -- `const { data: deps } = await deviceApi.getDependencies(id)` |
| 17 | `handleRemoveDevice` shows blocking modal when `canDelete === false` | PASS | `Devices.vue:447-456` -- `if (!deps.canDelete)` sets `blockingModal.value` with rules + groups |
| 18 | `handleRemoveOpenerGroup` calls `getDependencies` and uses `removeOpenerPair` | PASS | `Devices.vue:474,499` -- calls `getDependencies(group.openDevice.id)`, then `deviceApi.removeOpenerPair(...)` |
| 19 | `Groups.vue deleteGroup` calls `getDependencies` before deletion | PASS | `Groups.vue:755` -- `const { data: deps } = await groupApi.getDependencies(group.id)` |
| 20 | `DeleteBlockingModal.vue` supports 3 cases | PASS | See detailed analysis below |
| 21 | `DeleteBlockingModal` receives `groups` prop (for group-only case) | PASS | `DeleteBlockingModal.vue:70` -- `groups?: { id: string; name: string }[]` |
| 22 | `Devices.vue` passes `groups: deps.groups` to blocking modal | PASS | `Devices.vue:211` -- `:groups="blockingModal.groups"`, `Devices.vue:453` -- `groups: deps.groups` |
| 23 | `vue-tsc` + `vite build` passes | PASS | Confirmed in prior session |

**Frontend Score: 13/13 (100%)**

---

### 2.3 DeleteBlockingModal 3-Case Verification (Checklist #20 Detail)

| Case | Condition | Expected Behavior | Implementation | Status |
|------|-----------|-------------------|----------------|:------:|
| automation-only | `rules.length > 0, groups.length === 0` | Shows "자동화 룰에서 사용 중", button "자동화 관리로 이동" | `v-if="rules.length > 0"` renders automation section; `navigateLabel` returns "자동화 관리로 이동"; navigates to `/automation` | PASS |
| group-only | `rules.length === 0, groups.length > 0` | Shows "그룹에 포함되어 있음", button "그룹 관리로 이동" | `groupsOnly` computed returns true; group section renders "다음 그룹에 포함되어 있습니다:"; `navigateLabel` returns "그룹 관리로 이동"; navigates to `/groups` | PASS |
| both | `rules.length > 0, groups.length > 0` | Shows both sections, button "자동화 관리로 이동" | Both template sections render; group section shows "또한 다음 그룹에도 속해 있습니다:" with `mt-section` spacing; `navigateLabel` defaults to "자동화 관리로 이동" | PASS |

---

## 3. Gap Analysis (Design vs Implementation)

### 3.1 API Endpoints

| Design Endpoint | Implementation | Status | Notes |
|----------------|----------------|:------:|-------|
| `GET /devices/:id/dependencies` | `devices.controller.ts:45` | PASS | Exact match |
| `DELETE /devices/:id/opener-pair` | `devices.controller.ts:50` | PASS | Exact match |
| `DELETE /devices/:id` (opener block) | `devices.service.ts:246` | PASS | BadRequestException for opener types |
| `GET /groups/:id/dependencies` | `groups.controller.ts:20` | PASS | Exact match |
| `DELETE /groups/:id` (dependency check) | `groups.service.ts:85` | PASS | ConflictException when rules exist |

### 3.2 Data Model / Response Schema

| Design Field | Type | Implementation | Status | Notes |
|-------------|------|----------------|:------:|-------|
| `DeviceDependenciesResponse.canDelete` | `boolean` | `device.types.ts:62` | PASS | |
| `DeviceDependenciesResponse.isOpenerPair` | `boolean` | `device.types.ts:63` | PASS | |
| `DeviceDependenciesResponse.pairedDevice` | `object?` | `device.types.ts:64-68` | PASS | |
| `DeviceDependenciesResponse.automationRules` | `array` | `device.types.ts:69` | PASS | |
| `DeviceDependenciesResponse.pairedDeviceAutomationRules` | `array?` | `device.types.ts:70` | PASS | |
| `DeviceDependenciesResponse.groups` | `array` | `device.types.ts:71` | PASS | Added by plan FR-01 (not in original design) |
| `GroupDependenciesResponse.canDelete` | `boolean` | `group.types.ts:45` | PASS | |
| `GroupDependenciesResponse.automationRules` | `array` | `group.types.ts:46` | PASS | |

### 3.3 Business Logic Comparison

| Design Logic | Implementation | Status | Notes |
|-------------|----------------|:------:|-------|
| `canDelete = allRules.length === 0` (design) | `canDelete = automationRules.length === 0 && pairedDeviceAutomationRules.length === 0 && groups.length === 0` (impl) | DELTA | Design only checks rules; Plan FR-01 adds `groups.length === 0`. Implementation correctly follows Plan. |
| `removeOpenerPair` -- ConflictException on dependency | ConflictException thrown | PASS | |
| `remove` -- BadRequestException for opener | BadRequestException thrown | PASS | |
| `removeGroup` -- ConflictException on dependency | ConflictException thrown | PASS | |

### 3.4 Frontend Component Comparison

| Design Component | Implementation File | Status | Notes |
|-----------------|---------------------|:------:|-------|
| `DeleteBlockingModal.vue` | `frontend/src/components/common/DeleteBlockingModal.vue` | PASS | Design specified `components/devices/`, impl uses `components/common/` -- better reusability |
| `blockingModal` state in `Devices.vue` | `Devices.vue:236-247` | PASS | Includes `groups` field beyond design spec |
| `blockingModal` state in `Groups.vue` | `Groups.vue:488-498` | PASS | |
| `handleRemoveDevice` dependency flow | `Devices.vue:442-470` | PASS | |
| `handleRemoveOpenerGroup` atomic deletion | `Devices.vue:472-505` | PASS | |
| `deleteGroup` dependency flow | `Groups.vue:754-780` | PASS | |

---

## 4. Differences Found

### 4.1 Missing Features (Design O, Implementation X)

None found. All design items are implemented.

### 4.2 Added Features (Design X, Implementation O)

| # | Item | Implementation Location | Description | Impact |
|---|------|------------------------|-------------|--------|
| A1 | `groups` field in `DeviceDependenciesResponse` | `device.types.ts:71`, `devices.service.ts:183-188,200` | Plan FR-01 requirement: `getDependencies` returns groups array. Not in original design doc. | Low -- intentional Plan extension |
| A2 | `groups` prop in `DeleteBlockingModal` | `DeleteBlockingModal.vue:70` | Plan FR-02 requirement: group-only case support. Not in original design doc (design only covered automation rules). | Low -- intentional Plan extension |

### 4.3 Changed Features (Design != Implementation)

| # | Item | Design | Implementation | Impact |
|---|------|--------|----------------|--------|
| C1 | `canDelete` logic | `allRules.length === 0` | `automationRules.length === 0 && pairedDeviceAutomationRules.length === 0 && groups.length === 0` | None -- Plan FR-01 intentionally extends design |
| C2 | `DeleteBlockingModal` path | `components/devices/DeleteBlockingModal.vue` | `components/common/DeleteBlockingModal.vue` | None -- better placement since it's used in both Devices.vue and Groups.vue |
| C3 | `navigate` emit | Design defines `navigate` emit on `DeleteBlockingModal` | Implementation handles navigation internally via `handleNavigate()` without emitting `navigate` | Low -- component is self-contained, parent only needs `close` emit |
| C4 | Groups.vue `blockingModal` -- no `groups` prop binding | Design has no group dep check for Groups.vue DeleteBlockingModal | Implementation does not pass `:groups` to modal in Groups.vue (only in Devices.vue) | None -- Groups.vue only blocks on automation rules, not sub-groups |

---

## 5. Design Document Update Recommendations

The following items reflect intentional divergences where the design document should be updated to match the Plan + Implementation:

- [ ] **Update `DeviceDependenciesResponse` schema** in design to include `groups: { id: string; name: string }[]` field
- [ ] **Update `canDelete` logic** in design from `allRules.length === 0` to include `groups.length === 0`
- [ ] **Update `DeleteBlockingModal` Props** to include `groups?: { id: string; name: string }[]`
- [ ] **Update `DeleteBlockingModal` location** from `components/devices/` to `components/common/`
- [ ] **Update `DeleteBlockingModal` emits** to remove `navigate` emit (component handles navigation internally)
- [ ] **Add group-only case** to `DeleteBlockingModal` UI design section (3 cases instead of automation-only)

---

## 6. Overall Scores

```
+---------------------------------------------+
|  Overall Match Rate: 100% (23/23)            |
+---------------------------------------------+
|  Backend (FR-01 + Design):   10/10  (100%)   |
|  Frontend (FR-02/03 + Design): 13/13 (100%)  |
+---------------------------------------------+
|  Status: PASS                                |
+---------------------------------------------+
```

| Category | Score | Status |
|----------|:-----:|:------:|
| Design Match (core features) | 100% | PASS |
| Plan FR-01 (canDelete + groups) | 100% | PASS |
| Plan FR-02 (DeleteBlockingModal 3 cases) | 100% | PASS |
| Plan FR-03 (handleRemoveDevice simplification) | 100% | PASS |
| Architecture (module imports, dependency direction) | 100% | PASS |
| **Overall** | **100%** | **PASS** |

---

## 7. Summary

All 23 verification items pass. The implementation fully satisfies both the Plan (`delete-safety-group-block` FR-01 ~ FR-03) and the Design (`delete-dependency-safety`).

The only differences found are:

1. **Intentional Plan extensions** (A1, A2, C1): The design was written before the group-block Plan was created. Implementation correctly extends the design per Plan requirements.
2. **Improved placement** (C2): `DeleteBlockingModal` placed in `components/common/` instead of `components/devices/` for better reusability.
3. **Simplified interface** (C3): Navigation handled internally in the component rather than via parent emit.

All differences are beneficial improvements over the original design and do not constitute regressions.

**Recommendation**: Update the design document (`delete-dependency-safety.design.md`) to reflect the Plan extensions (groups in dependencies, 3-case modal) so future developers have a single source of truth.

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 1.0 | 2026-03-02 | Initial gap analysis -- 23/23 items pass | bkit-gap-detector |
