<template>
  <div class="c-body">
    <div class="c-head">
      <div>
        <h1 class="c-h1">농장</h1>
        <p class="c-sub">농장별 구역을 만들고 게이트웨이를 할당합니다</p>
      </div>
      <div class="c-actions">
        <button class="c-btn" type="button" :disabled="platform.loading" @click="platform.load(true)"><CIcon name="refresh" :size="14" />새로고침</button>
        <router-link class="c-btn" to="/users?new=1"><CIcon name="plus" :size="14" />새 농장 (농장 관리자 계정)</router-link>
      </div>
    </div>

    <div v-if="pickSeg" class="c-note" role="status" style="background:var(--c-warn-bg);color:var(--c-warn-fg)">
      농장 보기 화면을 열려면 먼저 농장을 선택하세요. 선택하면 “{{ pickTitle }}” 화면으로 이동합니다.
    </div>

    <div class="c-row-wrap">
      <div class="c-card" style="flex:3 1 560px">
        <div class="c-card-h">농장 목록 <small>{{ rows.length }}곳</small></div>
        <div class="c-tbl-wrap">
          <table class="c-tbl">
            <thead><tr><th>농장</th><th>관리자 계정</th><th>구역</th><th>게이트웨이</th><th>구성원</th><th>상태</th><th v-if="pickSeg" /></tr></thead>
            <tbody>
              <tr v-for="f in rows" :key="f.id" class="c-click" :class="{ 'c-sel': f.id === selectedId }" tabindex="0" @click="select(f.id)" @keydown.enter="select(f.id)">
                <td><b>{{ farmLabel(f) }}</b></td>
                <td>{{ f.name }} <span class="c-mono c-muted">@{{ f.username }}</span></td>
                <td class="c-mono">{{ f.zones.length }}</td>
                <td>
                  <span v-for="gw in f.gateways" :key="gw.id" class="c-pill" :class="gwOk(gw) ? 'c-p-ok' : 'c-p-warn'" style="margin-right:4px"><span class="c-led" :class="agentOnline(gw) ? 'c-led-ok' : 'c-led-warn'" />{{ gw.name }}</span>
                  <span v-if="!f.gateways.length" class="c-muted">미할당</span>
                </td>
                <td class="c-mono">{{ f.members.length }}</td>
                <td><span class="c-pill" :class="f.ready ? 'c-p-ok' : 'c-p-warn'">{{ f.ready ? '운영 중' : '설정 필요' }}</span></td>
                <td v-if="pickSeg" class="c-r"><button class="c-btn c-btn-sm c-btn-pri" type="button" @click.stop="openFarm(f.id)">열기</button></td>
              </tr>
              <tr v-if="!rows.length"><td :colspan="pickSeg ? 7 : 6" class="c-empty">{{ platform.loading ? '불러오는 중…' : '등록된 농장이 없습니다. 농장 관리자 계정을 만들면 농장이 생깁니다.' }}</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="c-card c-detail" style="flex:2 1 380px">
        <template v-if="farm">
          <div class="c-detail-h" style="flex-wrap:wrap">
            <div style="flex:1;min-width:0">
              <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap"><b style="font-size:16px">{{ farmLabel(farm) }}</b><span class="c-pill" :class="farm.ready ? 'c-p-ok' : 'c-p-warn'">{{ farm.ready ? '운영 중' : '설정 필요' }}</span></div>
              <div class="c-muted" style="margin-top:2px;font-size:12px">관리자 {{ farm.name }} <span class="c-mono">@{{ farm.username }}</span><template v-if="farmAddress"> · {{ farmAddress }}</template></div>
            </div>
            <router-link class="c-btn c-btn-sm" :to="`/users?select=${farm.id}`">계정</router-link>
            <button class="c-btn c-btn-pri" type="button" @click="openFarm(farm.id)"><CIcon name="eye" :size="14" />농장 보기</button>
          </div>
          <div v-if="!farmAddress" class="c-li" style="background:var(--c-warn-bg);color:var(--c-warn-fg);border-top:0;flex-wrap:wrap">
            <CIcon name="warn" :size="14" />
            <span style="flex:1;min-width:200px">농장 위치(주소)가 설정되지 않았습니다 — 날씨 표시와 날씨 조건 자동 제어가 동작하지 않습니다.</span>
            <router-link class="c-btn c-btn-sm" :to="`/users?select=${farm.id}&edit=1`">위치 설정</router-link>
          </div>
          <div class="c-fields c-3">
            <div class="c-stat"><span class="c-k">구역</span><span class="c-v">{{ farm.zones.length }}</span></div>
            <div class="c-stat"><span class="c-k">게이트웨이</span><span class="c-v">{{ farm.gateways.length }}</span></div>
            <div class="c-stat"><span class="c-k">구성원</span><span class="c-v">{{ farm.members.length }}</span></div>
          </div>

          <!-- 구역 (C2·C3·C4·C5) -->
          <div class="c-sub-h">구역 <button class="c-btn c-btn-sm" type="button" @click="openAddZone">구역 추가</button></div>
          <div v-if="addingZone" class="c-li">
            <input ref="zoneInput" v-model="newZoneName" class="c-input" style="flex:1;min-width:140px" placeholder="구역 이름 (예: 1번 하우스)" aria-label="새 구역 이름" @keydown.enter="submitAddZone" @keydown.esc="addingZone = false" />
            <button class="c-btn c-btn-sm c-btn-pri" type="button" :disabled="!newZoneName.trim() || busy" @click="submitAddZone">추가</button>
            <button class="c-btn c-btn-sm" type="button" @click="addingZone = false">취소</button>
          </div>
          <div v-for="z in farm.zones" :key="z.id" class="c-li" style="align-items:flex-start">
            <span class="c-led" style="margin-top:6px" :class="zoneGateways(z.id).length ? 'c-led-ok' : 'c-led-off'" />
            <div style="flex:1;min-width:0">
              <b style="font-weight:500">{{ z.name }}</b>
              <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">
                <span v-for="gw in zoneGateways(z.id)" :key="gw.id" class="c-pill c-p-ok">
                  {{ gw.name }}
                  <button class="c-link-btn" type="button" :aria-label="`${gw.name} 할당 해제`" style="color:inherit" @click="detach(gw)"><CIcon name="x" :size="11" /></button>
                </span>
                <select v-if="unassigned.length && !zoneGateways(z.id).length" class="c-select" :aria-label="`${z.name} 에 게이트웨이 할당`" :disabled="busy" @change="assign(z.id, ($event.target as HTMLSelectElement))">
                  <option value="">+ 게이트웨이 할당</option>
                  <option v-for="gw in unassigned" :key="gw.id" :value="gw.id">{{ gw.name }} ({{ gw.gatewayId }}){{ gw.userId !== farm.id ? ' · ' + ownerName(gw.userId) : '' }}</option>
                </select>
              </div>
            </div>
            <button class="c-btn c-btn-sm c-btn-danger-outline" type="button" :disabled="busy" @click="removeZone(z)">삭제</button>
          </div>
          <div v-if="!farm.zones.length && !addingZone" class="c-li c-muted">구역이 없습니다. “구역 추가”로 만드세요.</div>

          <div class="c-sub-h">게이트웨이 <router-link class="c-link-btn" to="/gateways">게이트웨이 관리 →</router-link></div>
          <div v-for="gw in farm.gateways" :key="gw.id" class="c-li">
            <span class="c-led" :class="agentOnline(gw) ? 'c-led-ok' : 'c-led-warn'" />
            <b style="font-weight:500">{{ gw.name }}</b>
            <span class="c-mono c-muted">{{ tunnelConnected(gw) && gw.tunnelPort ? ':' + gw.tunnelPort : gw.gatewayId }}</span>
            <span class="c-muted" style="font-size:12px">{{ gw.groupName ? gw.groupName + ' 연결' : '구역 미할당' }}</span>
            <router-link :to="`/gateways?select=${gw.id}`" style="margin-left:auto;font-size:12px">상세 →</router-link>
          </div>
          <div v-if="!farm.gateways.length" class="c-li c-muted">이 농장 소유 게이트웨이가 없습니다. 위 구역에서 할당하면 소유권이 이 농장으로 옮겨집니다.</div>

          <div class="c-sub-h">구성원 <router-link class="c-link-btn" :to="`/users?select=${farm.id}`">관리 →</router-link></div>
          <router-link v-for="m in farm.members" :key="m.id" class="c-li c-click" style="color:inherit;text-decoration:none" :to="`/users?select=${m.id}`">
            {{ m.name }} <span class="c-mono c-muted">@{{ m.username }}</span>
            <span v-if="m.status !== 'active'" class="c-pill c-p-off" style="margin-left:auto">비활성</span>
          </router-link>
          <div v-if="!farm.members.length" class="c-li c-muted" style="padding-bottom:14px">소속 농장 사용자가 없습니다.</div>
        </template>
        <div v-else class="c-empty">왼쪽 목록에서 농장을 선택하세요</div>
      </div>
    </div>

    <!-- 자동화 규칙에 묶인 구역 삭제 차단 안내 (기존 Groups.vue 와 동일 규칙) -->
    <div v-if="blocked" class="c-modal-back" @click.self="blocked = null">
      <div class="c-modal" role="alertdialog" aria-modal="true" aria-label="구역 삭제 불가">
        <div class="c-modal-h">구역을 삭제할 수 없습니다</div>
        <div class="c-modal-b">
          <p style="margin:0">“{{ blocked.name }}” 구역을 사용하는 자동 제어 규칙이 있습니다. 규칙을 먼저 삭제하거나 다른 구역으로 옮긴 뒤 다시 시도하세요.</p>
          <div v-for="r in blocked.rules" :key="r.id" class="c-field"><span class="c-v">{{ r.name }}</span><span class="c-k">{{ r.enabled ? '사용 중' : '꺼짐' }}</span></div>
        </div>
        <div class="c-modal-f"><button class="c-btn" type="button" @click="blocked = null">닫기</button></div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { groupApi } from '@/api/group.api'
import { gatewayApi } from '@/api/gateway.api'
import { useNotificationStore } from '@/stores/notification.store'
import { useConfirm } from '@/composables/useConfirm'
import type { HouseGroupWithOwner } from '@/types/group.types'
import CIcon from '@console/components/CIcon.vue'
import { FARM_PAGES } from '@console/router'
import { rememberFarm } from '@console/farm/farmContext'
import { usePlatformStore, farmLabel, agentOnline, tunnelConnected, gatewayOk as gwOk, type ConsoleGateway } from '@console/stores/platform.store'

const platform = usePlatformStore()
const notif = useNotificationStore()
const { confirm } = useConfirm()
const route = useRoute()
const router = useRouter()

const selectedId = ref<string | null>(null)
const busy = ref(false)

const pickSeg = computed(() => {
  const p = route.query.pick
  return typeof p === 'string' && FARM_PAGES.some((x) => x.seg === p) ? p : null
})
const pickTitle = computed(() => FARM_PAGES.find((x) => x.seg === pickSeg.value)?.title || '')

const rows = computed(() => platform.farms.map((f) => {
  const zones = platform.groupsOfFarm(f.id)
  const gateways = platform.gatewaysOfFarm(f.id)
  return { ...f, zones, gateways, members: platform.membersOfFarm(f.id), ready: zones.length > 0 && gateways.length > 0 }
}))
const farm = computed(() => rows.value.find((f) => f.id === selectedId.value) ?? null)
const farmAddress = computed(() => platform.userById(farm.value?.id)?.address || '')

/** 기존 AdminFarmManagement 와 동일: 미할당 게이트웨이 전체(다른 농장 소유 포함) — 할당 시 소유권이 이 농장으로 이관됨 */
const unassigned = computed(() => platform.gateways.filter((gw) => !gw.groupId))
const zoneGateways = (zoneId: string) => platform.gateways.filter((gw) => gw.groupId === zoneId)
const ownerName = (uid: string) => platform.ownerLabel(uid)

function select(id: string) {
  selectedId.value = id
  if (route.query.select !== id) router.replace({ query: { ...route.query, select: id } })
}
function openFarm(id: string) {
  const f = platform.farmById(id)
  if (f) rememberFarm({ id: f.id, name: farmLabel(f), username: f.username })
  router.push(`/farm/${id}/${pickSeg.value || 'dashboard'}`)
}

// ── 구역 추가/삭제 ──
const addingZone = ref(false)
const newZoneName = ref('')
const zoneInput = ref<HTMLInputElement | null>(null)
const blocked = ref<{ name: string; rules: Array<{ id: string; name: string; enabled: boolean }> } | null>(null)

async function openAddZone() {
  newZoneName.value = ''
  addingZone.value = true
  await nextTick()
  zoneInput.value?.focus()
}
async function submitAddZone() {
  const name = newZoneName.value.trim()
  if (!name || !farm.value || busy.value) return
  busy.value = true
  try {
    await groupApi.adminCreateGroup({ name, targetUserId: farm.value.id })
    addingZone.value = false
    notif.success('완료', '구역이 추가되었습니다.')
    await platform.load(true)
  } catch (e: any) {
    notif.error('오류', e?.response?.data?.message || '구역 추가에 실패했습니다.')
  } finally {
    busy.value = false
  }
}
async function removeZone(zone: HouseGroupWithOwner) {
  busy.value = true
  try {
    const { data: deps } = await groupApi.getDependencies(zone.id)
    if (!deps.canDelete) {
      blocked.value = { name: zone.name, rules: deps.automationRules }
      return
    }
  } catch {
    // 의존성 조회 실패 시에도 삭제 요청은 서버가 다시 검증한다
  } finally {
    busy.value = false
  }
  const ok = await confirm({ title: '구역 삭제', message: `"${zone.name}" 구역을 삭제하시겠습니까?`, confirmText: '삭제', variant: 'danger' })
  if (!ok) return
  busy.value = true
  try {
    await groupApi.removeGroup(zone.id)
    notif.success('완료', '구역이 삭제되었습니다.')
    await platform.load(true)
  } catch (e: any) {
    notif.error('오류', e?.response?.data?.message ?? '삭제에 실패했습니다.')
  } finally {
    busy.value = false
  }
}

// ── 게이트웨이 할당/해제 ──
async function assign(zoneId: string, el: HTMLSelectElement) {
  const gwId = el.value
  el.value = ''
  if (!gwId) return
  busy.value = true
  try {
    await gatewayApi.assignZone(gwId, zoneId)
    notif.success('완료', '게이트웨이가 구역에 추가되었습니다.')
  } catch (e: any) {
    const msg = e?.response?.data?.message
    if (e?.response?.status === 409) notif.error('중복 할당', msg ?? '이미 다른 구역에 할당된 게이트웨이입니다.')
    else notif.error('오류', msg ?? '할당에 실패했습니다.')
  } finally {
    await platform.load(true)
    busy.value = false
  }
}
async function detach(gw: ConsoleGateway) {
  const ok = await confirm({ title: '할당 해제', message: `"${gw.name}" 게이트웨이를 구역에서 해제할까요?`, confirmText: '해제', variant: 'warning' })
  if (!ok) return
  busy.value = true
  try {
    await gatewayApi.assignZone(gw.id, null)
    notif.success('완료', '게이트웨이 할당이 해제되었습니다.')
    await platform.load(true)
  } catch (e: any) {
    notif.error('오류', e?.response?.data?.message ?? '해제에 실패했습니다.')
  } finally {
    busy.value = false
  }
}

onMounted(async () => {
  await platform.load(true)
  const q = route.query.select
  selectedId.value = (typeof q === 'string' && platform.farmById(q) ? q : null) ?? platform.farms[0]?.id ?? null
})
watch(() => route.query.select, (q) => {
  if (typeof q === 'string' && q !== selectedId.value && platform.farmById(q)) selectedId.value = q
})
</script>
