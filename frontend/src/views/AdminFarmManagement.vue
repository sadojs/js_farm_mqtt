<template>
  <div class="admin-farm-page">
    <div class="page-header">
      <div>
        <h2 class="page-title">농장 관리</h2>
        <p class="page-desc">
          농장별 구역을 생성하고 게이트웨이를 할당합니다.
          <router-link to="/users" class="link-to-users">농장(사용자) 관리 →</router-link>
        </p>
      </div>
    </div>

    <div class="two-panel">
      <!-- 좌측: 농장(farm_admin) 목록 -->
      <aside class="farm-list-panel">
        <div class="panel-header">농장 목록</div>

        <div v-if="loading" class="panel-empty">로딩 중...</div>

        <div v-else-if="farmAdmins.length === 0" class="panel-empty">
          <p>등록된 농장이 없습니다.</p>
          <router-link to="/users" class="btn-link">사용자 관리에서 농장 관리자를 추가하세요</router-link>
        </div>

        <div
          v-for="farm in farmAdmins"
          :key="farm.id"
          class="farm-card"
          :class="{ 'farm-card--active': selectedFarmId === farm.id }"
          @click="selectFarm(farm.id)"
        >
          <div class="farm-card-name">{{ farm.name }}</div>
          <div class="farm-card-meta">
            <span class="farm-username">@{{ farm.username }}</span>
            <span class="farm-badge">구역 {{ zoneCountOf(farm.id) }}개</span>
          </div>
        </div>
      </aside>

      <!-- 우측: 선택된 농장 상세 -->
      <main class="farm-detail-panel">
        <div v-if="!selectedFarmId" class="detail-empty">
          좌측에서 농장을 선택하세요.
        </div>

        <template v-else>
          <div class="detail-header">
            <div>
              <h3 class="detail-title">{{ selectedFarm?.name }}</h3>
              <span class="detail-username">@{{ selectedFarm?.username }}</span>
            </div>
            <button class="btn-add-zone" @click="openAddZone">+ 구역 추가</button>
          </div>

          <div v-if="selectedZones.length === 0" class="detail-empty">
            구역이 없습니다. 추가 버튼을 눌러 시작하세요.
          </div>

          <div v-for="zone in selectedZones" :key="zone.id" class="zone-block">
            <div class="zone-header">
              <span class="zone-name">{{ zone.name }}</span>
              <div class="zone-header-actions">
                <select
                  class="gw-select"
                  value=""
                  @change="onGatewayAssign(zone, ($event.target as HTMLSelectElement).value); ($event.target as HTMLSelectElement).value = ''"
                >
                  <option value="">+ 게이트웨이 추가</option>
                  <option
                    v-for="gw in unassignedFarmGateways(zone.id)"
                    :key="gw.id"
                    :value="gw.id"
                  >{{ gw.name }} ({{ gw.agentStatus === 'online' ? '온라인' : '오프라인' }})</option>
                </select>
                <button class="btn-sm btn-danger" @click="removeZone(zone)">삭제</button>
              </div>
            </div>

            <!-- 할당된 게이트웨이 목록 -->
            <div class="gw-list-in-zone">
              <div v-if="gatewaysOfZone(zone.id).length === 0" class="gw-empty">게이트웨이 미할당</div>
              <div v-for="gw in gatewaysOfZone(zone.id)" :key="gw.id" class="gw-item">
                <span class="gw-dot" :class="gw.agentStatus === 'online' ? 'dot-on' : 'dot-off'"></span>
                <span class="gw-item-name">{{ gw.name }}</span>
                <span class="gw-item-id">{{ gw.gatewayId }}</span>
                <button class="btn-gw-detach" @click="onGatewayDetach(gw)">해제</button>
              </div>
            </div>
          </div>
        </template>
      </main>
    </div>

    <!-- 구역 추가 모달 -->
    <div v-if="showAddZone" class="modal-overlay" @click.self="showAddZone = false">
      <div class="modal-card">
        <div class="modal-header">
          <span>구역 추가 — {{ selectedFarm?.name }}</span>
          <button class="modal-close" @click="showAddZone = false">✕</button>
        </div>
        <div class="modal-body">
          <label class="form-label">구역명 *</label>
          <input v-model="newZoneName" class="form-input" placeholder="예: 1동, A구역" @keyup.enter="submitAddZone" />
        </div>
        <div class="modal-footer">
          <button class="btn-cancel" @click="showAddZone = false">취소</button>
          <button class="btn-primary" :disabled="!newZoneName.trim()" @click="submitAddZone">추가</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { groupApi } from '@/api/group.api'
import { gatewayApi } from '@/api/gateway.api'
import { useNotificationStore } from '@/stores/notification.store'
import type { HouseGroupWithOwner, FarmAdmin } from '@/types/group.types'

interface GatewayItem {
  id: string
  name: string
  userId: string
  gatewayId: string
  groupId?: string | null
  agentStatus: string
}

const notif = useNotificationStore()

const loading = ref(true)
const farmAdmins = ref<FarmAdmin[]>([])
const allZones = ref<HouseGroupWithOwner[]>([])
const allGateways = ref<GatewayItem[]>([])
const selectedFarmId = ref<string | null>(null)

const showAddZone = ref(false)
const newZoneName = ref('')

const selectedFarm = computed(() => farmAdmins.value.find(f => f.id === selectedFarmId.value) ?? null)

const selectedZones = computed(() =>
  allZones.value.filter(z => z.userId === selectedFarmId.value)
)

const farmGateways = computed(() =>
  allGateways.value.filter(gw => gw.userId === selectedFarmId.value)
)

function zoneCountOf(farmId: string) {
  return allZones.value.filter(z => z.userId === farmId).length
}

function gatewaysOfZone(zoneId: string): GatewayItem[] {
  return allGateways.value.filter(gw => gw.groupId === zoneId)
}

function unassignedFarmGateways(_zoneId: string): GatewayItem[] {
  return farmGateways.value.filter(gw => !gw.groupId)
}

async function loadAll() {
  loading.value = true
  try {
    const [farmsRes, zonesRes, gwRes] = await Promise.all([
      groupApi.getFarmAdmins(),
      groupApi.adminGetAllGroups(),
      gatewayApi.getAll(),
    ])
    farmAdmins.value = farmsRes.data
    allZones.value = zonesRes.data
    allGateways.value = gwRes.data as unknown as GatewayItem[]
  } catch {
    notif.error('오류', '데이터를 불러오지 못했습니다.')
  } finally {
    loading.value = false
  }
}

function selectFarm(id: string) {
  selectedFarmId.value = id
}

function openAddZone() {
  newZoneName.value = ''
  showAddZone.value = true
}

async function submitAddZone() {
  if (!newZoneName.value.trim() || !selectedFarmId.value) return
  try {
    const res = await groupApi.adminCreateGroup({
      name: newZoneName.value.trim(),
      targetUserId: selectedFarmId.value,
    })
    allZones.value.push({ ...res.data, ownerName: selectedFarm.value?.name, ownerUsername: selectedFarm.value?.username })
    showAddZone.value = false
    notif.success('완료', '구역이 추가되었습니다.')
  } catch {
    notif.error('오류', '구역 추가에 실패했습니다.')
  }
}

async function removeZone(zone: HouseGroupWithOwner) {
  if (!confirm(`"${zone.name}" 구역을 삭제하시겠습니까?`)) return
  try {
    await groupApi.removeGroup(zone.id)
    allZones.value = allZones.value.filter(z => z.id !== zone.id)
    notif.success('완료', '구역이 삭제되었습니다.')
  } catch (e: any) {
    const msg = e?.response?.data?.message ?? '삭제에 실패했습니다.'
    notif.error('오류', msg)
  }
}

async function onGatewayAssign(zone: HouseGroupWithOwner, gatewayId: string) {
  if (!gatewayId) return
  try {
    await gatewayApi.assignZone(gatewayId, zone.id)
    const gwRes = await gatewayApi.getAll()
    allGateways.value = gwRes.data as unknown as GatewayItem[]
    notif.success('완료', '게이트웨이가 구역에 추가되었습니다.')
  } catch (e: any) {
    const status = e?.response?.status
    const msg = e?.response?.data?.message
    if (status === 409) {
      notif.error('중복 할당', msg ?? '이미 다른 구역에 할당된 게이트웨이입니다.')
    } else {
      notif.error('오류', msg ?? '할당에 실패했습니다.')
    }
    const gwRes = await gatewayApi.getAll()
    allGateways.value = gwRes.data as unknown as GatewayItem[]
  }
}

async function onGatewayDetach(gw: GatewayItem) {
  if (!confirm(`"${gw.name}" 게이트웨이를 구역에서 해제할까요?`)) return
  try {
    await gatewayApi.assignZone(gw.id, null)
    const gwRes = await gatewayApi.getAll()
    allGateways.value = gwRes.data as unknown as GatewayItem[]
    notif.success('완료', '게이트웨이 할당이 해제되었습니다.')
  } catch (e: any) {
    notif.error('오류', e?.response?.data?.message ?? '해제에 실패했습니다.')
  }
}

onMounted(loadAll)
</script>

<style scoped>
.admin-farm-page {
  padding: 24px;
  max-width: 1200px;
  margin: 0 auto;
}
.page-header { margin-bottom: 24px; }
.page-title { font-size: 22px; font-weight: 700; color: var(--text-primary); margin: 0 0 4px; }
.page-desc { font-size: 13px; color: var(--text-muted); margin: 0; }
.link-to-users { color: #6366f1; text-decoration: none; margin-left: 8px; font-weight: 600; }
.link-to-users:hover { text-decoration: underline; }

.two-panel { display: flex; gap: 20px; min-height: 600px; }

.farm-list-panel {
  width: 240px; flex-shrink: 0;
  background: var(--bg-card); border-radius: 12px;
  border: 1px solid var(--border-color); overflow-y: auto;
}
.panel-header {
  padding: 14px 16px 10px; font-size: 12px; font-weight: 700;
  color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em;
  border-bottom: 1px solid var(--border-color);
}
.panel-empty { padding: 24px 16px; font-size: 13px; color: var(--text-muted); text-align: center; }

.farm-card {
  padding: 12px 16px; cursor: pointer;
  border-bottom: 1px solid var(--border-light); transition: background 0.15s;
}
.farm-card:hover { background: var(--bg-hover, rgba(99,102,241,0.06)); }
.farm-card--active { background: rgba(99,102,241,0.1); border-left: 3px solid #6366f1; }
.farm-card-name { font-size: 14px; font-weight: 600; color: var(--text-primary); }
.farm-card-meta { display: flex; gap: 8px; margin-top: 4px; align-items: center; flex-wrap: wrap; }
.farm-username { font-size: 12px; color: var(--text-muted); }
.farm-badge { font-size: 11px; background: var(--bg-badge, #f3f4f6); color: var(--text-muted); padding: 1px 7px; border-radius: 10px; }

.farm-detail-panel {
  flex: 1; background: var(--bg-card); border-radius: 12px;
  border: 1px solid var(--border-color); overflow-y: auto; padding: 0;
}
.detail-empty { padding: 60px 24px; text-align: center; color: var(--text-muted); font-size: 14px; }
.detail-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 20px; border-bottom: 1px solid var(--border-color);
}
.detail-title { font-size: 18px; font-weight: 700; margin: 0; color: var(--text-primary); }
.detail-username { font-size: 13px; color: var(--text-muted); }

.btn-add-zone {
  padding: 7px 16px; border-radius: 8px; border: none;
  background: #6366f1; color: #fff; font-size: 13px; font-weight: 600;
  cursor: pointer; transition: background 0.15s;
}
.btn-add-zone:hover { background: #4f46e5; }

.zone-block {
  border-bottom: 1px solid var(--border-light);
}
.zone-block:last-child { border-bottom: none; }

.zone-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 20px 8px;
}
.zone-name { font-size: 14px; font-weight: 700; color: var(--text-primary); }
.zone-header-actions { display: flex; align-items: center; gap: 8px; }

.gw-list-in-zone {
  padding: 0 20px 12px 32px;
  display: flex; flex-direction: column; gap: 4px;
}
.gw-empty { font-size: 12px; color: var(--text-muted); padding: 4px 0; }
.gw-item {
  display: flex; align-items: center; gap: 8px;
  padding: 5px 10px; border-radius: 6px;
  background: var(--bg-hover, rgba(0,0,0,0.03));
  font-size: 13px;
}
.gw-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.dot-on { background: #22c55e; }
.dot-off { background: #d1d5db; }
.gw-item-name { font-weight: 600; color: var(--text-primary); }
.gw-item-id { font-size: 11px; color: var(--text-muted); font-family: monospace; flex: 1; }
.btn-gw-detach {
  padding: 2px 8px; border-radius: 4px; font-size: 11px; cursor: pointer;
  border: 1px solid #fca5a5; color: #dc2626; background: transparent;
}
.btn-gw-detach:hover { background: #fef2f2; }

.gw-select {
  padding: 4px 8px; border-radius: 6px; border: 1px solid var(--border-color);
  background: var(--bg-card); color: var(--text-secondary); font-size: 12px; cursor: pointer;
}
.btn-sm { padding: 4px 10px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; border: 1px solid; transition: all 0.15s; background: transparent; }
.btn-danger { color: #ef4444; border-color: #ef4444; }
.btn-danger:hover { background: #ef4444; color: #fff; }

.modal-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.45);
  display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 16px;
}
.modal-card {
  background: var(--bg-card); border-radius: 14px; width: 100%;
  max-width: 400px; box-shadow: 0 20px 60px rgba(0,0,0,0.25);
}
.modal-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 20px; border-bottom: 1px solid var(--border-color);
  font-size: 15px; font-weight: 700; color: var(--text-primary);
}
.modal-close { background: none; border: none; font-size: 16px; cursor: pointer; color: var(--text-muted); }
.modal-body { padding: 20px; display: flex; flex-direction: column; gap: 12px; }
.modal-footer { display: flex; justify-content: flex-end; gap: 8px; padding: 14px 20px; border-top: 1px solid var(--border-color); }
.form-label { font-size: 13px; font-weight: 600; color: var(--text-secondary); margin-bottom: 4px; }
.form-input {
  width: 100%; padding: 8px 12px; border-radius: 8px;
  border: 1px solid var(--border-color); background: var(--bg-input, #fff);
  color: var(--text-primary); font-size: 14px; box-sizing: border-box;
}
.form-input:focus { outline: none; border-color: #6366f1; }
.btn-cancel { padding: 8px 18px; border-radius: 8px; border: 1px solid var(--border-color); background: var(--bg-card); color: var(--text-secondary); font-size: 13px; cursor: pointer; }
.btn-primary { padding: 8px 18px; border-radius: 8px; border: none; background: #6366f1; color: #fff; font-size: 13px; font-weight: 600; cursor: pointer; }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-link { color: #6366f1; font-size: 13px; text-decoration: none; display: block; margin-top: 8px; }
.btn-link:hover { text-decoration: underline; }

@media (max-width: 640px) {
  .two-panel { flex-direction: column; }
  .farm-list-panel { width: 100%; }
}
</style>
