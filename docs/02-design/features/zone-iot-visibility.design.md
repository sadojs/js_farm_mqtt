# Design — zone-iot-visibility (v2)

**Feature**: zone-iot-visibility
**Updated**: 2026-06-21
**Phase**: Design — depends on `zone-iot-visibility.plan.md` (v2)

---

## 1. 전체 아키텍처

```
구역 관리(Groups) ─┬─ 메인 카드 그리드 = iotGroups (활성만)
                  │   └─ 카드 우측: ● IoT 사용 배지
                  │
                  ├─ 우측 상단:
                  │   ├─ 👁 구역 표시 설정 · 숨김 N  → ZoneVisibilityModal
                  │   └─ + 구역 추가                  (기존)
                  │
                  └─ 하단 안내 배너 (숨김 N>0 일 때만)

ZoneVisibilityModal
  ├─ 전체 House 목록 (활성+비활성)
  ├─ 각 행: 토글 + 메타(측정기/장치/작물)
  ├─ [닫기] [저장]
  └─ 저장 시:
       1) 변경분 추출
       2) OFF 로 바뀌는 구역 중 연결자원>0 → 확인 다이얼로그
       3) PATCH /api/groups/houses/iot-enabled (bulk)
       4) fetchGroups + fetchIotGroups 재조회

IoT 화면 (Dashboard / Devices / Automation / Sensors / Reports /
          Env-config / Sensor-alerts / Gateway-manager + 자식)
  └─ groupStore.iotGroups (활성 구역만)

비-IoT 모듈 (spray-schedule / work-log / crop-management /
            worker-payroll / zone-notes)
  └─ groupStore.groups (전체, 변경 없음)
```

---

## 2. DB 스키마

### 2.1 마이그레이션 `033_zone_iot_visibility.sql`

```sql
ALTER TABLE houses
  ADD COLUMN IF NOT EXISTS iot_enabled BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN houses.iot_enabled IS
  '구역 IoT 사용 여부. false 시 구역관리 메인·자동제어·게이트웨이·장치등록·대시보드·리포트·알림 등 IoT 화면에서 숨김. 방재·농작업·생육관리는 그대로 표시.';

CREATE INDEX IF NOT EXISTS idx_houses_iot_enabled
  ON houses (user_id) WHERE iot_enabled = TRUE;
```

### 2.2 엔티티

```typescript
// house.entity.ts
@Column({ name: 'iot_enabled', type: 'boolean', default: true })
iotEnabled: boolean;
```

---

## 3. Backend API

### 3.1 GET /api/groups?iotOnly=true

```typescript
@Get()
findAll(@CurrentUser() user, @Query('iotOnly') iotOnly?: string) {
  return this.groupsService.findAllGroups(user.id, user.role, {
    iotOnly: iotOnly === 'true',
  });
}
```

service:
```typescript
async findAllGroups(userId, role, opts = {}) {
  const groups = await this.groupsRepo.find({ ... });
  if (opts.iotOnly) {
    for (const g of groups) g.houses = g.houses.filter(h => h.iotEnabled);
  }
  return groups;
}
```

### 3.2 PATCH /api/groups/houses/iot-enabled (bulk)

```typescript
// dto/bulk-iot-enabled.dto.ts
export class BulkIotEnabledItemDto {
  @IsUUID() id: string;
  @IsBoolean() enabled: boolean;
}
export class BulkIotEnabledDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => BulkIotEnabledItemDto)
  updates: BulkIotEnabledItemDto[];
}

// controller
@Patch('houses/iot-enabled')
@Roles('admin', 'farm_admin')
async bulkUpdateIotEnabled(@Body() dto: BulkIotEnabledDto, @CurrentUser() user) {
  return this.groupsService.bulkUpdateIotEnabled(dto.updates, user);
}
```

service:
```typescript
async bulkUpdateIotEnabled(updates, user) {
  // 권한: admin 외에는 본인 소유 구역만
  const ids = updates.map(u => u.id);
  const houses = await this.housesRepo.find({ where: { id: In(ids) } });
  if (user.role !== 'admin') {
    if (houses.some(h => h.userId !== user.id)) throw new ForbiddenException();
  }
  const byId = new Map(updates.map(u => [u.id, u.enabled]));
  for (const h of houses) {
    if (byId.has(h.id)) h.iotEnabled = byId.get(h.id)!;
  }
  await this.housesRepo.save(houses);
  return { updated: houses.length };
}
```

### 3.3 GET /api/groups/houses/iot-related-counts?ids=a,b,c

저장 직전 OFF 로 바뀌는 구역들의 영향 카운트를 일괄 조회.

```typescript
@Get('houses/iot-related-counts')
async getIotRelatedCounts(@Query('ids') ids: string) {
  const idList = (ids ?? '').split(',').filter(Boolean);
  return this.groupsService.getIotRelatedCounts(idList);
  // → { totals: { device, rule, gateway }, perHouse: [{ id, name, device, rule, gateway }] }
}
```

```typescript
async getIotRelatedCounts(houseIds: string[]) {
  if (!houseIds.length) return { totals: { device: 0, rule: 0, gateway: 0 }, perHouse: [] };
  const houses = await this.housesRepo.find({ where: { id: In(houseIds) } });
  const gws = await this.gatewayRepo.find({ where: { houseId: In(houseIds) } });
  const gwByHouse = new Map<string, string[]>();
  for (const gw of gws) {
    const arr = gwByHouse.get(gw.houseId!) ?? [];
    arr.push(gw.id);
    gwByHouse.set(gw.houseId!, arr);
  }
  const allGwIds = gws.map(g => g.id);
  const devices = allGwIds.length
    ? await this.devicesRepo.find({ where: { gatewayId: In(allGwIds) }, select: ['id', 'gatewayId'] })
    : [];
  const devCntByHouse = new Map<string, number>();
  for (const d of devices) {
    const hId = gws.find(g => g.id === d.gatewayId)?.houseId;
    if (hId) devCntByHouse.set(hId, (devCntByHouse.get(hId) ?? 0) + 1);
  }
  const rules = await this.rulesRepo.find({ where: { houseId: In(houseIds) }, select: ['id', 'houseId'] });
  const ruleCntByHouse = new Map<string, number>();
  for (const r of rules) ruleCntByHouse.set(r.houseId, (ruleCntByHouse.get(r.houseId) ?? 0) + 1);

  const perHouse = houses.map(h => ({
    id: h.id, name: h.name,
    device: devCntByHouse.get(h.id) ?? 0,
    rule: ruleCntByHouse.get(h.id) ?? 0,
    gateway: (gwByHouse.get(h.id) ?? []).length,
  }));
  const totals = perHouse.reduce(
    (acc, x) => ({ device: acc.device + x.device, rule: acc.rule + x.rule, gateway: acc.gateway + x.gateway }),
    { device: 0, rule: 0, gateway: 0 },
  );
  return { totals, perHouse };
}
```

---

## 4. Frontend

### 4.1 타입

```typescript
// types/group.types.ts
export interface House {
  id: string;
  name: string;
  // ...
  iotEnabled: boolean;       // 신규
}

export interface IotRelatedCounts {
  totals: { device: number; rule: number; gateway: number };
  perHouse: Array<{ id: string; name: string; device: number; rule: number; gateway: number }>;
}
```

### 4.2 API

```typescript
// api/group.api.ts
export const groupApi = {
  getGroups: (opts?: { iotOnly?: boolean }) =>
    apiClient.get('/groups', { params: opts?.iotOnly ? { iotOnly: 'true' } : {} }),
  bulkUpdateIotEnabled: (updates: Array<{ id: string; enabled: boolean }>) =>
    apiClient.patch('/groups/houses/iot-enabled', { updates }),
  getIotRelatedCounts: (ids: string[]) =>
    apiClient.get<IotRelatedCounts>('/groups/houses/iot-related-counts', {
      params: ids.length ? { ids: ids.join(',') } : {},
    }),
  // ... 기존
}
```

### 4.3 Pinia store

```typescript
// stores/group.store.ts
const groups = ref<HouseGroupWithOwner[]>([])             // 전체
const iotGroups = ref<HouseGroupWithOwner[]>([])          // 활성만
const loading = ref(false)

const allHouses = computed(() => /* groups 기반 */)
const iotHouses = computed(() => allHouses.value.filter(h => h.iotEnabled))
const hiddenZoneCount = computed(() => allHouses.value.filter(h => !h.iotEnabled).length)

async function fetchGroups() {
  loading.value = true
  try {
    const { data } = await groupApi.getGroups()
    groups.value = data
  } finally { loading.value = false }
}
async function fetchIotGroups() {
  const { data } = await groupApi.getGroups({ iotOnly: true })
  iotGroups.value = data
}
async function bulkUpdateIotEnabled(updates) {
  await groupApi.bulkUpdateIotEnabled(updates)
  await Promise.all([fetchGroups(), fetchIotGroups()])
}
```

부트스트랩(`auth.store` 로그인 직후) 에서 둘 다 호출:
```typescript
await Promise.all([groupStore.fetchGroups(), groupStore.fetchIotGroups()])
```

### 4.4 Groups.vue — 메인

```vue
<header class="page-header">
  <div>
    <h2>구역 관리</h2>
    <p>IoT 장치를 구역으로 묶어 관리합니다</p>
  </div>
  <div class="header-actions">
    <button class="btn-ghost" @click="showVisibility = true">
      👁 구역 표시 설정 <span v-if="hiddenZoneCount" class="badge">· 숨김 {{ hiddenZoneCount }}</span>
    </button>
    <button class="btn-primary" @click="openAddGroup">+ 구역 추가</button>
  </div>
</header>

<!-- 메인 그리드: 활성 구역만 -->
<GroupCardList :groups="groupStore.iotGroups" ... />

<!-- 안내 배너 -->
<div v-if="hiddenZoneCount > 0" class="hint-banner">
  👁‍🗨 IoT 미사용 구역 <strong>{{ hiddenZoneCount }}개</strong> 가 숨겨져 있습니다
  (방재·농작업 일정에는 계속 표시됨).
  <button class="link-btn" @click="showVisibility = true">"구역 표시 설정"</button>에서 변경
</div>

<ZoneVisibilityModal
  v-if="showVisibility"
  :groups="groupStore.groups"
  :can-edit="canEdit"
  @close="showVisibility = false"
  @saved="onVisibilitySaved"
/>
```

카드 우측 배지:
```vue
<span class="iot-badge" :class="{ off: !house.iotEnabled }">
  ● {{ house.iotEnabled ? 'IoT 사용' : 'IoT 미사용' }}
</span>
```
(메인 그리드는 활성만이므로 항상 "IoT 사용" 으로 보임)

### 4.5 ZoneVisibilityModal.vue (신규)

구조:
```vue
<template>
  <div class="modal-overlay" @click.self="onCloseAttempt">
    <div class="visibility-modal">
      <div class="modal-head">
        <h3>구역 표시 설정</h3>
        <button class="close-btn" @click="onCloseAttempt">✕</button>
      </div>

      <p class="modal-desc">
        IoT 사용을 끄면 구역 관리·게이트웨이 환경 설정·자동 제어 대상에서 제외됩니다.
        방재 일정·농작업 일정·생육관리에는 계속 표시됩니다.
      </p>

      <ul class="house-list">
        <li v-for="h in flatHouses" :key="h.id" class="house-row">
          <span class="row-icon">⛶</span>
          <div class="row-main">
            <div class="row-title">{{ h.name }}</div>
            <div class="row-sub">{{ formatMeta(h) }}</div>
          </div>
          <label class="toggle-wrap">
            <input
              type="checkbox"
              v-model="draft[h.id]"
              :disabled="!canEdit"
              role="switch"
              :aria-label="`${h.name} IoT 사용`"
            />
            <span class="toggle-label">{{ draft[h.id] ? 'IoT 사용' : '미사용' }}</span>
          </label>
        </li>
      </ul>

      <div class="modal-foot">
        <button class="btn-ghost" @click="onCloseAttempt">닫기</button>
        <button class="btn-primary" :disabled="!canEdit || !hasChanges" @click="onSave">저장</button>
      </div>
    </div>
  </div>

  <!-- 영향 카운트 확인 -->
  <ConfirmHideModal
    v-if="confirm"
    :counts="confirm"
    @cancel="confirm = null"
    @confirm="commitSave"
  />
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { groupApi } from '@/api/group.api'
import { useGroupStore } from '@/stores/group.store'

const props = defineProps<{
  groups: HouseGroupWithOwner[]
  canEdit: boolean
}>()
const emit = defineEmits<{ close: []; saved: [] }>()
const groupStore = useGroupStore()

const flatHouses = computed(() => props.groups.flatMap(g => g.houses ?? []))

// draft state: { houseId → iotEnabled }
const draft = ref<Record<string, boolean>>(
  Object.fromEntries(flatHouses.value.map(h => [h.id, h.iotEnabled]))
)
const original = Object.fromEntries(flatHouses.value.map(h => [h.id, h.iotEnabled]))

const changed = computed(() =>
  Object.keys(draft.value).filter(id => draft.value[id] !== original[id])
)
const hasChanges = computed(() => changed.value.length > 0)
const turningOff = computed(() => changed.value.filter(id => !draft.value[id]))
const confirm = ref<IotRelatedCounts | null>(null)

async function onSave() {
  if (!hasChanges.value) return
  if (turningOff.value.length === 0) return commitSave()  // ON 만 있으면 바로
  // 영향 카운트 사전 조회
  const { data } = await groupApi.getIotRelatedCounts(turningOff.value)
  const t = data.totals
  if (t.device + t.rule + t.gateway === 0) return commitSave()  // 연결 자원 없으면 바로
  confirm.value = data
}

async function commitSave() {
  const updates = changed.value.map(id => ({ id, enabled: draft.value[id] }))
  await groupStore.bulkUpdateIotEnabled(updates)
  emit('saved')
  emit('close')
}

function onCloseAttempt() {
  if (hasChanges.value && !window.confirm('저장하지 않은 변경이 있습니다. 닫으시겠습니까?')) return
  emit('close')
}

function formatMeta(h) {
  const parts = []
  if (h.sensorCount != null) parts.push(`측정기 ${h.sensorCount}`)
  if (h.deviceCount != null) parts.push(`장치 ${h.deviceCount}`)
  if (h.cropLabel) parts.push(h.cropLabel)
  return parts.join(' · ')
}
</script>

<style scoped>
.modal-overlay { /* 동일 패턴 */ }
.visibility-modal { max-width: 560px; max-height: 88vh; display: flex; flex-direction: column; }
.modal-desc { font-size: 13px; color: var(--text-muted); padding: 0 20px 12px; line-height: 1.5; }
.house-list { overflow-y: auto; padding: 0 12px; }
.house-row {
  display: flex; align-items: center; gap: 12px;
  padding: 14px 8px; border-bottom: 1px solid var(--border-light);
}
.house-row:last-child { border-bottom: none; }
.row-icon { width: 36px; height: 36px; border-radius: 10px;
  background: var(--bg-hover); display: flex; align-items: center; justify-content: center; }
.row-main { flex: 1; min-width: 0; }
.row-title { font-weight: 700; font-size: 15px; }
.row-sub { font-size: 12px; color: var(--text-muted); margin-top: 2px; }
.toggle-wrap { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.toggle-label { font-size: 11px; color: var(--text-muted); font-weight: 600; }

@media (max-width: 600px) {
  .modal-overlay { align-items: flex-end; padding: 0; }
  .visibility-modal { max-width: 100%; border-radius: 18px 18px 0 0;
    padding-bottom: env(safe-area-inset-bottom, 0px); max-height: 90vh; }
}
</style>
```

### 4.6 ConfirmHideModal

```vue
<template>
  <div class="modal-overlay" @click.self="$emit('cancel')">
    <div class="confirm-modal">
      <h3>⚠️ IoT 화면에서 숨기시겠습니까?</h3>
      <p>아래 구역들에는 다음 자원이 연결되어 있습니다.</p>
      <ul>
        <li v-for="h in counts.perHouse.filter(x => x.device + x.rule + x.gateway > 0)" :key="h.id">
          <strong>{{ h.name }}</strong> — 장치 {{ h.device }} · 룰 {{ h.rule }} · 게이트웨이 {{ h.gateway }}
        </li>
      </ul>
      <p class="note">IoT 화면에서만 숨겨지며, 실제 자동제어/알림은 그대로 동작합니다.</p>
      <div class="actions">
        <button class="btn-ghost" @click="$emit('cancel')">취소</button>
        <button class="btn-danger" @click="$emit('confirm')">숨기기</button>
      </div>
    </div>
  </div>
</template>
```

### 4.7 IoT 화면 교체 매트릭스

| 파일 | Before | After |
|------|--------|-------|
| `views/Dashboard.vue` | `groupStore.groups` | `groupStore.iotGroups` |
| `views/Devices.vue` | `groupStore.groups` | `groupStore.iotGroups` |
| `views/Automation.vue` | `groupStore.groups` | `groupStore.iotGroups` |
| `views/Sensors.vue` | `groupStore.groups` | `groupStore.iotGroups` |
| `views/Reports.vue` | `groupStore.groups` | `groupStore.iotGroups` |
| `views/Groups.vue` 메인 그리드 | `groups` | **`iotGroups`** |
| `views/Groups.vue` 모달 prop | — | **`groups` (전체)** |
| `components/dashboard/SummaryCards.vue` | `groups` | `iotGroups` |
| `components/dashboard/DeviceStatusCards.vue` | `groups` | `iotGroups` |
| `components/devices/DeviceRegistration.vue` | `groups` | `iotGroups` |
| `components/groups/AddDeviceModal.vue` | `groups` | `iotGroups` |
| `components/automation/AutomationEditModal.vue` | `groups` | `iotGroups` |
| `components/automation/RuleWizardModal.vue` | `groups` | `iotGroups` |
| `components/automation/StepSensorSelect.vue` 외 step | `groups` | `iotGroups` |
| `components/automation/v2/StepFarmSelect.vue` 등 | `groups` | `iotGroups` |
| `components/reports/SensorCompareChart.vue` | `groups` | `iotGroups` |
| **게이트웨이 구역 할당** (`gateway-manager` UI) | `groups` | `iotGroups` |
| **env-config** 매핑 화면 | `groups` | `iotGroups` |
| **sensor-alerts** 임계값 화면 | `groups` | `iotGroups` |

**비-IoT 모듈(변경 없음)**:
- `modules/spray-schedule/**`
- `modules/work-log/**`
- `modules/crop-management/**`
- `modules/worker-payroll/**`
- `modules/zone-notes/**`

---

## 5. UI 와이어프레임

### 5.1 구역 관리 메인

```
┌─ 스마트팜 ─┐ ┌── 구역 관리 ────────────────────────────── 👁 구역 표시 설정 · 숨김 2  [+ 구역 추가] ┐
│ 우리 농장   │ │ IoT 장치를 구역으로 묶어 관리합니다                                                  │
│ 구역 관리   │ │                                                                                      │
│ 자동제어 ⚙ │ │ ┌─ ⛶ HK-1동 토마토 ────────────────────────────────── ● IoT 사용 ─┐                 │
│ ...          │ │ │ 측정기 3 · 장치 2                                                  │                 │
│              │ │ └────────────────────────────────────────────────────────────────────┘                 │
│              │ │ ┌─ ⛶ HK-2동 오이   ──────────────────────────────── ● IoT 사용 ─┐                 │
│              │ │ │ 측정기 2 · 장치 2                                                  │                 │
│              │ │ └────────────────────────────────────────────────────────────────────┘                 │
│              │ │ ┌─ ⛶ HK-3동 육묘  ──────────────────────────────── ● IoT 사용 ─┐                 │
│              │ │ │ 측정기 1 · 장치 0                                                  │                 │
│              │ │ └────────────────────────────────────────────────────────────────────┘                 │
│              │ │ ┌─ 👁‍🗨 IoT 미사용 구역 2개가 숨겨져 있습니다 (방재·농작업 일정에는 계속 표시됨).     │
│              │ │ │   "구역 표시 설정"에서 변경                                                          │
│              │ │ └──────────────────────────────────────────────────────────────────────────────────┘  │
└──────────────┘ └──────────────────────────────────────────────────────────────────────────────────────┘
```

### 5.2 구역 표시 설정 모달

```
┌─────────────────────────────────────────────────┐
│ 구역 표시 설정                               ✕  │
│ IoT 사용을 끄면 구역 관리·게이트웨이 환경 설정· │
│ 자동 제어 대상에서 제외됩니다.                  │
│ 방재 일정·농작업 일정·생육관리에는 계속 표시됨. │
├─────────────────────────────────────────────────┤
│ ⛶ HK-1동 토마토                       [●━━]    │
│   측정기 3 · 장치 2 · 방울토마토 정식 28일     │ IoT 사용 │
│ ─────────────────────────────────────────────── │
│ ⛶ HK-2동 오이                         [●━━]    │
│   측정기 2 · 장치 2 · 오이 수확기                │ IoT 사용 │
│ ─────────────────────────────────────────────── │
│ ⛶ HK-3동 육묘                         [●━━]    │
│   측정기 1 · 장치 0 · 딸기 육묘                  │ IoT 사용 │
│ ─────────────────────────────────────────────── │
│ ⛶ 노지 A 밭                          [━━○]    │
│   등록된 IoT 장치 없음 · 대파                    │   미사용  │
│ ─────────────────────────────────────────────── │
│ ⛶ 노지 B 밭                          [━━○]    │
│   등록된 IoT 장치 없음 · 배추                    │   미사용  │
├─────────────────────────────────────────────────┤
│                              [닫기]    [저장]    │
└─────────────────────────────────────────────────┘
```

### 5.3 영향 카운트 확인 (저장 클릭 시)

```
┌──────────────────────────────────────────┐
│ ⚠️  IoT 화면에서 숨기시겠습니까?           │
├──────────────────────────────────────────┤
│ 아래 구역들에는 다음 자원이 연결돼 있습니다│
│                                            │
│ • HK-2동 오이 — 장치 5 · 룰 2 · 게이트웨이 1│
│ • HK-3동 육묘 — 장치 1 · 룰 0 · 게이트웨이 0│
│                                            │
│ IoT 화면에서만 숨겨지며,                   │
│ 실제 자동제어/알림은 그대로 동작합니다.    │
├──────────────────────────────────────────┤
│                       [취소]   [숨기기]    │
└──────────────────────────────────────────┘
```

---

## 6. 권한 (RBAC)

| 작업 | admin | farm_admin | farm_user |
|------|-------|-----------|----------|
| 모달 열기 (보기) | ✅ | ✅ | ✅ (readonly) |
| 토글 변경 + 저장 | ✅ (모든 구역) | ✅ (본인 구역) | ❌ (토글 disabled) |
| IoT 화면에서 비-IoT 구역 안 보임 | ✅ | ✅ | ✅ |

컨트롤러 `@Roles('admin','farm_admin')` + 서비스에서 `userId` 검사.
프론트는 `canEdit = role !== 'farm_user'` 로 토글 disabled.

---

## 7. 구현 순서 (Do 체크리스트)

### 7.1 DB & Entity
- [ ] `033_zone_iot_visibility.sql` 작성·적용
- [ ] `house.entity.ts` `iotEnabled` 추가

### 7.2 Backend
- [ ] `findAllGroups({ iotOnly })` 옵션
- [ ] `bulkUpdateIotEnabled()` 서비스 + DTO + 컨트롤러
- [ ] `getIotRelatedCounts(ids[])` 서비스 + 컨트롤러
- [ ] Devices/Automation/Gateway 화면 영향 카운트용 join 검증

### 7.3 Frontend 공통
- [ ] `types/group.types.ts` `iotEnabled` + `IotRelatedCounts`
- [ ] `api/group.api.ts` `bulkUpdateIotEnabled`, `getIotRelatedCounts`, `getGroups({ iotOnly })`
- [ ] `group.store.ts` `iotGroups`, `iotHouses`, `hiddenZoneCount`, `fetchIotGroups()`, `bulkUpdateIotEnabled()`
- [ ] 부트스트랩에서 fetchIotGroups 호출

### 7.4 Frontend — 구역관리
- [ ] `Groups.vue` 메인 그리드 → `iotGroups`
- [ ] 우측 상단 "구역 표시 설정 · 숨김 N" 버튼
- [ ] 하단 안내 배너 (숨김 N>0)
- [ ] `ZoneVisibilityModal.vue` 신규
- [ ] `ConfirmHideModal.vue` 신규 (또는 인라인)
- [ ] farm_user readonly 처리

### 7.5 Frontend — IoT 화면 교체 (4.7 매트릭스 따라)
- [ ] Dashboard, Devices, Automation, Sensors, Reports
- [ ] Env-config, Sensor-alerts, Gateway-manager
- [ ] 자식 컴포넌트 (AddDeviceModal, RuleWizardModal, IntentWizard, 모든 v2 step)

### 7.6 검증
- [ ] vue-tsc EXIT 0
- [ ] nest build EXIT 0
- [ ] 회귀: 방재/농작업/작물/일꾼/메모는 모든 구역 노출
- [ ] 모달 일괄 저장 → 메인·드롭다운 즉시 반영
- [ ] 영향 카운트 모달 동작 확인
- [ ] farm_user readonly 확인

---

## 8. Open Questions

- [ ] HouseGroup(상위 그룹) 차원의 토글 필요? → **현재는 House 단위만**. 차후 별도 PDCA.
- [ ] iot_enabled=false 구역에 새 장치 등록 강제 차단? → **차단 X**. UI 에서 보이지 않으니 자연스럽게 막힘.
- [ ] 토글 변경 이력 activity_logs? → **남김 권장**. 액션명: `zone.iot_visibility.changed`. Do 단계에서 결정.

---

## 9. PDCA 다음

→ `/pdca do zone-iot-visibility` — 위 7장 체크리스트 순서대로
