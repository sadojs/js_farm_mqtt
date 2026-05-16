# Design: gateway-env-ux

- **작성일**: 2026-05-09
- **참조 Plan**: `docs/01-plan/features/gateway-env-ux.plan.md`

---

## 1. 현황 분석

### 1.1 접근 경로 (현재)

```
GatewayManagement.vue
  └─ "⚙ 환경 설정" 버튼 → /gateways/:id/env
                           ↓
                   GatewayEnvSettings.vue
```

### 1.2 접근 경로 (변경 후)

```
Groups.vue (구역 관리)
  └─ 그룹 카드 내 "게이트웨이" 섹션
       └─ "⚙ 환경 설정" 버튼 → /gateways/:id/env?houseName=:houseName
                                ↓
                        GatewayEnvSettings.vue
                        (상단에 하우스 컨텍스트 표시)

GatewayManagement.vue (관리자 fallback)
  └─ 할당된 경우: "구역 관리에서 설정하세요" 안내
     미할당 경우: "⚙ 환경 설정" 버튼 (admin only, 기존 동작)
```

### 1.3 버그 원인 분석

#### [BUG-01] 온보드 탭 렌더링 오류
- **원인**: `gateway_onboard_devices` 마이그레이션(`012_platform_v2_upgrade.sql`)이 미적용인 경우 DB 오류 발생 → API 500 → `catch`에서 알림 표시
- **추가 원인**: Vue 템플릿 내 `group.open!.id` 사용 — `open` 필드가 Optional 타입이므로 런타임 `TypeError` 가능
- **수정**: null 가드 추가, 마이그레이션 상태를 에러 메시지로 안내

#### [BUG-02] Zigbee 스캔 — "장치 없음"
- **원인**: `scanZigbeeDevices()` → `mqttService.getZigbeeDevices(gw.gatewayId)` → `deviceCache.get(gatewayId) || []`
- 게이트웨이가 `bridge/devices` MQTT 토픽을 아직 발행하지 않은 경우 캐시가 비어 있음
- 실제 오류가 아닌 정상 케이스이나, UX 메시지가 불명확

#### [BUG-03] Zigbee 재스캔 — 오류 발생
- **원인**: MQTT 캐시가 비어 있는 상태에서 재스캔 시, 스캔 결과가 `[]`여도 정상 처리돼야 함
- 그러나 `scanZigbee` → `assertGatewayOwner` 에서 게이트웨이 상태가 `offline`이면 일부 로직에서 예외 가능
- **수정**: 빈 배열 케이스를 오류로 처리하지 않도록, `catch` 메시지 구분

---

## 2. FR-01: Groups.vue — 게이트웨이 섹션 추가

### 2.1 데이터 로딩

```typescript
// Groups.vue <script setup>에 추가
import { gatewayApi } from '@/api/gateway.api'
import type { Gateway } from '@/types/gateway.types'   // 또는 GatewayWithTunnel

const gateways = ref<Gateway[]>([])

async function loadGateways() {
  try {
    const res = await gatewayApi.getAll()
    gateways.value = res.data as Gateway[]
  } catch { /* ignore */ }
}

// onMounted 내 기존 loadData()와 함께 호출
onMounted(() => { loadData(); loadGateways() })
```

### 2.2 그룹 내 게이트웨이 조회 함수

```typescript
// Groups.vue <script setup>에 추가
function getGroupGateways(group: HouseGroup): Gateway[] {
  const houseIds = new Set(group.houses.map(h => h.id))
  return gateways.value.filter(gw => gw.houseId && houseIds.has(gw.houseId))
}
```

> **주의**: `HouseGroup.houses`가 현재 그룹 데이터에 포함돼 있지 않으면 API 응답 확인 필요.  
> 포함되지 않으면 `groupStore.getAll()` 응답에 `houses` 배열을 포함하도록 백엔드 수정 필요.

### 2.3 템플릿 — 그룹 바디에 게이트웨이 섹션 추가

```html
<!-- 그룹 바디 내 (자동 제어 섹션 위에 삽입) -->
<template v-if="getGroupGateways(group).length > 0">
  <div class="section-label gateway">게이트웨이</div>
  <div class="device-sub-grid">
    <div
      v-for="gw in getGroupGateways(group)"
      :key="gw.id"
      class="sub-card gateway-card"
    >
      <div class="sub-card-top">
        <span :class="['status-dot', gw.status === 'online' ? 'online' : 'offline']"></span>
        <span class="sub-card-name">{{ gw.name }}</span>
        <span class="type-tag gateway">게이트웨이</span>
      </div>
      <div v-if="!isFarmUser" class="sub-card-actions">
        <button
          class="btn-sm btn-env"
          @click="router.push(`/gateways/${gw.id}/env?houseName=${getGatewayHouseName(gw, group)}`)"
        >
          ⚙ 환경 설정
        </button>
      </div>
    </div>
  </div>
</template>
```

```typescript
function getGatewayHouseName(gw: Gateway, group: HouseGroup): string {
  const house = group.houses.find(h => h.id === gw.houseId)
  return encodeURIComponent(house?.name ?? group.name)
}
```

---

## 3. FR-02: GatewayManagement.vue — 환경 설정 버튼 변경

### 3.1 현재 코드 (line 92)

```html
<button class="btn-env btn-sm" @click="router.push(`/gateways/${gw.id}/env`)">⚙ 환경 설정</button>
```

### 3.2 변경 후

```html
<!-- houseId 할당된 경우 -->
<template v-if="gw.houseId">
  <span class="env-info-text">구역 관리에서 환경 설정</span>
</template>
<!-- 미할당 또는 admin fallback -->
<template v-else>
  <button class="btn-env btn-sm" @click="router.push(`/gateways/${gw.id}/env`)">⚙ 환경 설정</button>
</template>
```

```css
.env-info-text {
  font-size: 12px;
  color: var(--text-muted);
  padding: 6px 10px;
}
```

---

## 4. FR-03: GatewayEnvSettings.vue — 하우스 컨텍스트 표시 + 버그 수정

### 4.1 houseName 쿼리 파라미터 처리

```typescript
// <script setup> 내
const route = useRoute()
const gatewayId = route.params.id as string
const houseName = computed(() => route.query.houseName as string | undefined)
```

```html
<!-- 헤더 변경 -->
<div>
  <h2>환경 설정</h2>
  <p class="page-description">
    <span v-if="houseName">{{ houseName }} ·</span> 온보드 장치 및 Zigbee 장치 관리
  </p>
</div>
```

### 4.2 온보드 탭 null 가드 수정

```html
<!-- 변경 전 -->
<span v-if="!editingId" class="device-name">{{ group.name }}</span>
<input v-else-if="editingId === group.open!.id" ...>
<button v-if="editingId !== group.open!.id" ...>

<!-- 변경 후 -->
<span v-if="!editingId || editingId !== group.open?.id" class="device-name">{{ group.name }}</span>
<input v-else v-model="editName" ...>
<button v-if="group.open && editingId !== group.open.id" ...>
```

### 4.3 온보드 API 오류 시 에러 상태 표시

```typescript
const loadError = ref<string | null>(null)

onMounted(async () => {
  loading.value = true
  try {
    const [onRes, zbRes] = await Promise.all([
      gatewayEnvApi.getOnboard(gatewayId),
      gatewayEnvApi.getZigbee(gatewayId),
    ])
    onboardGroups.value = onRes.data
    zigbeeDevices.value = zbRes.data
  } catch (e: any) {
    const status = e?.response?.status
    if (status === 404) {
      loadError.value = '게이트웨이를 찾을 수 없습니다.'
    } else if (status === 403) {
      loadError.value = '접근 권한이 없습니다.'
    } else {
      loadError.value = '데이터를 불러오지 못했습니다. 서버 로그를 확인하거나 마이그레이션이 적용됐는지 확인하세요.'
    }
    notif.error('오류', loadError.value)
  } finally {
    loading.value = false
  }
})
```

```html
<!-- 템플릿에 에러 상태 추가 -->
<div v-if="loadError" class="error-state">
  <p>⚠ {{ loadError }}</p>
</div>
<div v-else-if="loading" class="loading-state">불러오는 중...</div>
```

### 4.4 Zigbee 스캔 UX 개선

```typescript
// runScan 개선
async function runScan() {
  scanning.value = true
  scannedDevices.value = []  // 이전 결과 초기화
  try {
    const res = await gatewayEnvApi.scanZigbee(gatewayId)
    scannedDevices.value = Array.isArray(res.data) ? res.data : []
  } catch (e: any) {
    const status = e?.response?.status
    const msg = status === 403 ? '접근 권한이 없습니다.' : '스캔에 실패했습니다. 게이트웨이가 온라인인지 확인하세요.'
    notif.error('스캔 오류', msg)
  } finally {
    scanning.value = false
  }
}
```

```html
<!-- 스캔 빈 결과 메시지 개선 -->
<div v-else-if="scannedDevices.length === 0" class="empty-state" style="padding:20px">
  <p>Zigbee2MQTT가 아직 장치 목록을 전송하지 않았습니다.</p>
  <p class="hint">게이트웨이가 온라인 상태이면 잠시 후 재스캔을 시도하세요.</p>
</div>
```

---

## 5. FR-05: Devices.vue — 장치 추가 제거

### 5.1 제거 항목

| 위치 | 항목 | 처리 |
|------|------|------|
| `line 10` | `<button @click="showRegistrationModal = true">+ 장치 추가</button>` | 제거 |
| 하단 | `<DeviceRegistration ...>` 컴포넌트 | 제거 |
| `<script>` | `showRegistrationModal`, `handleDeviceRegistered` 등 등록 관련 ref/함수 | 제거 |
| `imports` | `DeviceRegistration` import | 제거 |

### 5.2 추가 항목

```html
<!-- 헤더 내 버튼 자리에 안내 추가 -->
<div class="header-actions">
  <p class="add-hint">장치는 <router-link to="/groups">구역 관리</router-link>의 게이트웨이 환경 설정에서 활성화됩니다.</p>
</div>
```

```css
.add-hint {
  font-size: 13px;
  color: var(--text-muted);
  margin: 0;
}
.add-hint a { color: var(--text-link); text-decoration: underline; }
```

---

## 6. 백엔드 — 마이그레이션 확인

마이그레이션이 적용되지 않아 오류가 발생하는 경우를 방지하기 위해:
- `012_platform_v2_upgrade.sql` 에 `CREATE TABLE IF NOT EXISTS` 패턴 확인
- 이미 적용됐다면 `backend/database/schema.sql`에 최종 스키마 반영

```sql
-- 마이그레이션 멱등성 보장 (이미 IF NOT EXISTS 패턴이면 OK)
CREATE TABLE IF NOT EXISTS gateway_onboard_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gateway_id UUID NOT NULL,
  slot_key VARCHAR NOT NULL,
  slot_type VARCHAR NOT NULL,
  pair_key VARCHAR,
  name VARCHAR NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 7. 구현 순서

| 단계 | 작업 | 파일 |
|------|------|------|
| 1 | 마이그레이션 `IF NOT EXISTS` 확인 및 실행 | `012_platform_v2_upgrade.sql` |
| 2 | `GatewayEnvSettings.vue` null 가드 + 에러 상태 + houseName | `GatewayEnvSettings.vue` |
| 3 | `GatewayEnvSettings.vue` Zigbee 스캔 UX 개선 | `GatewayEnvSettings.vue` |
| 4 | `Groups.vue` 게이트웨이 섹션 + 데이터 로딩 | `Groups.vue` |
| 5 | `GatewayManagement.vue` 버튼 조건 분기 | `GatewayManagement.vue` |
| 6 | `Devices.vue` 장치 추가 제거 + 안내 추가 | `Devices.vue` |

---

## 8. 완료 기준 (체크리스트)

- [ ] 구역 관리 → 게이트웨이가 할당된 그룹에 "게이트웨이" 섹션 표시
- [ ] "⚙ 환경 설정" 클릭 시 houseName이 GatewayEnvSettings 헤더에 표시
- [ ] 온보드 탭 null 가드 — 렌더링 오류 없음
- [ ] 온보드 API 실패 시 명확한 에러 메시지 표시 (빈 화면 대신)
- [ ] Zigbee 스캔 빈 결과: "Zigbee2MQTT가 아직 장치 목록을 전송하지 않았습니다." 표시
- [ ] Zigbee 재스캔 오류 시 구체적인 메시지 표시
- [ ] GatewayManagement 환경 설정 버튼: houseId 있으면 안내 텍스트, 없으면 기존 버튼
- [ ] Devices.vue 장치 추가 버튼 제거, 구역 관리 링크 안내 표시
- [ ] farm_admin 사용자도 구역 관리에서 게이트웨이 환경 설정 접근 가능
