<template>
  <div class="c-body">
    <div class="c-head">
      <div>
        <h1 class="c-h1">게이트웨이</h1>
        <p class="c-sub">라즈베리파이 게이트웨이의 연결 상태 · 원격 접속 · 설정을 관리합니다</p>
      </div>
      <div class="c-actions">
        <button class="c-btn" type="button" :disabled="loading" @click="refresh"><CIcon name="refresh" :size="14" />새로고침</button>
        <button class="c-btn c-btn-pri" type="button" @click="openNew"><CIcon name="plus" :size="14" />게이트웨이 등록</button>
      </div>
    </div>

    <div class="c-row-wrap">
      <div class="c-card" style="flex:3 1 600px">
        <div class="c-card-h">
          <div class="c-tabs" role="tablist" aria-label="상태 필터">
            <button v-for="t in tabs" :key="t.key" class="c-tab" :class="{ on: filter === t.key }" type="button" role="tab" :aria-selected="filter === t.key" @click="filter = t.key">
              {{ t.label }} <span class="c-n">{{ t.count }}</span>
            </button>
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;flex:1 1 260px;justify-content:flex-end">
            <label class="c-search c-search-inline"><CIcon name="search" :size="13" /><input v-model="query" placeholder="이름, ID, 농장, 위치" aria-label="게이트웨이 필터" /></label>
            <div class="c-seg" role="group" aria-label="묶어 보기">
              <button v-for="g in groupModes" :key="g.key" type="button" :class="{ on: groupMode === g.key }" :aria-pressed="groupMode === g.key" @click="groupMode = g.key">{{ g.label }}</button>
            </div>
          </div>
        </div>
        <div class="c-tbl-wrap">
          <table class="c-tbl">
            <thead><tr><th>게이트웨이</th><th>농장</th><th>연결 구역</th><th>Agent</th><th>Zigbee</th><th>SSH</th><th>페일오버</th></tr></thead>
            <tbody>
              <template v-for="sec in sections" :key="sec.key">
                <tr v-if="sec.label" class="c-grp"><td colspan="7">{{ sec.label }} · {{ sec.items.length }}</td></tr>
                <tr v-for="gw in sec.items" :key="gw.id" class="c-click" :class="{ 'c-sel': gw.id === selectedId }" tabindex="0" @click="select(gw.id)" @keydown.enter="select(gw.id)">
                  <td><b>{{ gw.name }}</b> <span class="c-mono c-muted">{{ gw.gatewayId }}</span></td>
                  <td>{{ ownerName(gw.userId) }}</td>
                  <td :class="{ 'c-muted': !gw.groupName }">{{ gw.groupName || '미할당' }}</td>
                  <td><span class="c-pill" :class="agentOnline(gw) ? 'c-p-ok' : 'c-p-bad'"><span class="c-led" :class="agentOnline(gw) ? 'c-led-ok' : 'c-led-warn'" />{{ agentOnline(gw) ? '온라인' : '오프라인' }}</span></td>
                  <td><span class="c-pill" :class="gw.zigbeeStatus === 'online' ? 'c-p-ok' : 'c-p-off'">{{ gw.zigbeeStatus === 'online' ? '연결' : '미연결' }}</span></td>
                  <td class="c-mono">{{ tunnelConnected(gw) && gw.tunnelPort ? ':' + gw.tunnelPort : '끊김' }}</td>
                  <td>
                    <span v-if="fo(gw)" class="c-pill" :class="fo(gw)!.mode === 'fallback' ? 'c-p-bad' : fo(gw)!.sync === 'synced' ? 'c-p-ok' : 'c-p-warn'">
                      {{ fo(gw)!.mode.toUpperCase() }} v{{ fo(gw)!.version }}{{ fo(gw)!.sync === 'synced' ? '' : fo(gw)!.sync === 'syncing' ? ' · 동기화 중' : ' · 미동기화' }}
                    </span>
                    <span v-else class="c-muted">—</span>
                  </td>
                </tr>
              </template>
              <tr v-if="!filtered.length"><td colspan="7" class="c-empty">{{ loading ? '불러오는 중…' : '조건에 맞는 게이트웨이가 없습니다' }}</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- 상세 -->
      <div class="c-card c-detail" style="flex:2 1 380px">
        <template v-if="gw">
          <div class="c-detail-h" style="flex-wrap:wrap">
            <div style="flex:1;min-width:0">
              <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                <b style="font-size:16px">{{ gw.name }}</b>
                <span class="c-pill" :class="gwOk(gw) ? 'c-p-ok' : 'c-p-warn'">{{ gwOk(gw) ? '정상' : '점검 필요' }}</span>
              </div>
              <div class="c-mono c-muted" style="margin-top:2px">{{ gw.gatewayId }}</div>
            </div>
            <button class="c-btn c-btn-sm" type="button" @click="openEdit(gw)">편집</button>
            <button class="c-btn c-btn-sm c-btn-danger-outline" type="button" @click="removeGateway(gw)">삭제</button>
          </div>
          <div v-if="gatewayIssue(gw)" class="c-li" style="background:var(--c-warn-bg);color:var(--c-warn-fg);border-top:0"><CIcon name="warn" :size="14" />{{ gatewayIssue(gw) }}</div>

          <div class="c-detail-actions">
            <button class="c-btn c-btn-sm c-btn-pri" type="button" :disabled="!tunnelConnected(gw)" :title="tunnelConnected(gw) ? '' : 'SSH 터널이 끊겨 있어 접속할 수 없습니다'" @click="terminalGw = gw"><CIcon name="terminal" :size="13" />터미널</button>
            <router-link class="c-btn c-btn-sm" :to="`/gateways/${gw.id}/env`"><CIcon name="settings" :size="13" />환경 설정</router-link>
            <router-link class="c-btn c-btn-sm" to="/config-deploy"><CIcon name="deploy" :size="13" />시스템 설정 배포</router-link>
            <router-link class="c-btn c-btn-sm" to="/emergency-failover"><CIcon name="warn" :size="13" />페일오버 설정</router-link>
          </div>

          <div class="c-kv">
            <div class="c-k">농장</div><div>{{ ownerName(gw.userId) }}</div>
            <div class="c-k">연결 구역</div>
            <div>
              <select class="c-select" :value="gw.groupId || ''" :disabled="zoneBusy" aria-label="연결 구역" @change="onZoneChange(gw, ($event.target as HTMLSelectElement))">
                <option value="">미할당</option>
                <option v-for="z in platform.groupsOfFarm(gw.userId)" :key="z.id" :value="z.id">{{ z.name }}</option>
              </select>
            </div>
            <div class="c-k">위치</div><div>{{ gw.location || '—' }}</div>
            <div class="c-k">라즈베리파이 IP</div><div class="c-mono">{{ gw.rpiIp || '—' }}</div>
            <div class="c-k">Agent</div><div>{{ agentOnline(gw) ? '온라인' : '오프라인' }} · 최근 {{ fmtDateTime(gw.lastSeen) }}</div>
            <div class="c-k">Zigbee</div><div>{{ gw.zigbeeStatus === 'online' ? '연결' : '미연결' }}</div>
            <div class="c-k">SSH 터널</div>
            <div>
              <template v-if="gw.tunnelPort">
                <span class="c-mono">:{{ gw.tunnelPort }}</span> · {{ tunnelConnected(gw) ? '연결' : '끊김' }}<template v-if="gw.tunnelLastSeen"> · {{ fmtDateTime(gw.tunnelLastSeen) }}</template>
                <button class="c-link-btn" type="button" style="margin-left:6px;font-size:12px" @click="copy(`ssh -p ${gw.tunnelPort} lgw-dev@localhost`, 'ssh')">{{ copied === 'ssh' ? '복사됨' : 'SSH 명령 복사' }}</button>
              </template>
              <span v-else class="c-muted">미설정</span>
            </div>
            <div class="c-k">페일오버</div>
            <div>
              <template v-if="fo(gw)">
                {{ fo(gw)!.mode === 'fallback' ? '폴백 동작 중' : fo(gw)!.mode === 'online' ? '서버 제어 (ONLINE)' : '상태 미상' }} · 서버 v{{ fo(gw)!.version }} / RPi v{{ fo(gw)!.appliedVersion ?? '—' }}
                <div class="c-muted" style="font-size:12px">{{ fo(gw)!.sync === 'synced' ? '동기화됨' : fo(gw)!.sync === 'syncing' ? `동기화 중 (RPi v${fo(gw)!.appliedVersion} → v${fo(gw)!.version})` : 'RPi 미동기화' }} · 하트비트 {{ fmtDateTime(fo(gw)!.lastHeartbeat) }}</div>
              </template>
              <span v-else class="c-muted">설정 없음</span>
            </div>
            <div class="c-k">등록일</div><div>{{ fmtDateTime(gw.createdAt) }}</div>
          </div>

          <div class="c-sub-h">Pi 설치 명령 <button class="c-link-btn" type="button" @click="showSetup = !showSetup">{{ showSetup ? '접기' : '펼치기' }}</button></div>
          <div v-if="showSetup" style="padding:0 16px 12px;display:flex;flex-direction:column;gap:6px">
            <pre class="c-cmd">{{ setupCommand(gw) }}</pre>
            <button class="c-btn c-btn-sm" type="button" style="align-self:flex-start" @click="copy(setupCommand(gw).replace(/\\\n  /g, ' '), 'setup')">{{ copied === 'setup' ? '복사됨' : '명령 복사' }}</button>
          </div>

          <div class="c-sub-h">페일오버 원격 조치</div>
          <div style="padding:0 16px 16px;display:flex;flex-direction:column;gap:8px">
            <div class="c-li" style="border:1px solid var(--c-border-soft);border-radius:6px">
              <div style="flex:1;min-width:180px;font-size:12px" class="c-muted">게이트웨이에 최신 페일오버 설정을 다시 보냅니다.</div>
              <button class="c-btn c-btn-sm" type="button" :disabled="actionBusy" @click="resync(gw)">재동기화</button>
            </div>
            <div class="c-danger-box">
              <div class="c-t"><b>비상 정지</b> — 이 게이트웨이의 모든 릴레이를 즉시 끕니다. 폴백 모드에서도 실행됩니다.</div>
              <button class="c-btn c-btn-sm c-btn-danger" type="button" :disabled="actionBusy" @click="startEmergencyStop(gw)">비상 정지…</button>
            </div>
          </div>
        </template>
        <div v-else class="c-empty">왼쪽 목록에서 게이트웨이를 선택하세요</div>
      </div>
    </div>

    <GatewayFormModal :show="formOpen" :gateway="editing" @close="formOpen = false" @saved="onSaved" />

    <!-- 비상 정지 2단계 확인: (1) 확인 다이얼로그 → (2) 게이트웨이 ID 직접 입력 -->
    <div v-if="stopTarget" class="c-modal-back" @click.self="stopTarget = null">
      <div class="c-modal" role="alertdialog" aria-modal="true" aria-label="비상 정지 최종 확인">
        <div class="c-modal-h" style="color:var(--c-bad-fg)">비상 정지 — 최종 확인</div>
        <div class="c-modal-b">
          <p style="margin:0">“{{ stopTarget.name }}” 게이트웨이의 <b>모든 릴레이가 즉시 꺼집니다</b>. 관수 · 환기 · 개폐기 동작이 멈춥니다.</p>
          <div class="c-form-row">
            <label for="estop-confirm">계속하려면 게이트웨이 ID <b class="c-mono">{{ stopTarget.gatewayId }}</b> 를 그대로 입력하세요</label>
            <input id="estop-confirm" v-model="stopTyped" class="c-input" autocomplete="off" spellcheck="false" />
          </div>
        </div>
        <div class="c-modal-f">
          <button class="c-btn" type="button" @click="stopTarget = null">취소</button>
          <button class="c-btn c-btn-danger" type="button" :disabled="stopTyped !== stopTarget.gatewayId || actionBusy" @click="executeEmergencyStop">비상 정지 실행</button>
        </div>
      </div>
    </div>

    <!-- 웹 터미널 (기존 컴포넌트) -->
    <div v-if="terminalGw" class="c-term-back" @click.self="terminalGw = null">
      <div class="c-term-panel">
        <WebTerminal :gateway-id="terminalGw.gatewayId" :gateway-name="terminalGw.name" @close="terminalGw = null" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { gatewayApi } from '@/api/gateway.api'
import { emergencyFailoverApi } from '@/api/emergency-failover.api'
import { useAuthStore } from '@/stores/auth.store'
import { useNotificationStore } from '@/stores/notification.store'
import { useConfirm } from '@/composables/useConfirm'
import WebTerminal from '@/components/gateway/WebTerminal.vue'
import CIcon from '@console/components/CIcon.vue'
import GatewayFormModal from '@console/components/GatewayFormModal.vue'
import { useFailoverSummary, fmtDateTime } from '@console/composables/useFailoverSummary'
import { usePlatformStore, agentOnline, tunnelConnected, gatewayOk as gwOk, gatewayIssue, type ConsoleGateway } from '@console/stores/platform.store'

type Filter = 'all' | 'ok' | 'warn'
type GroupMode = 'farm' | 'status' | 'none'

const platform = usePlatformStore()
const auth = useAuthStore()
const notif = useNotificationStore()
const { confirm } = useConfirm()
const failover = useFailoverSummary()
const route = useRoute()
const router = useRouter()

const loading = ref(false)
const filter = ref<Filter>('all')
const groupMode = ref<GroupMode>('farm')
const query = ref('')
const selectedId = ref<string | null>(null)

const ownerName = (uid: string) => platform.userById(uid)?.name || '알 수 없음'
const fo = (g: ConsoleGateway) => failover.byGatewayId.value[g.gatewayId]

const tabs = computed(() => [
  { key: 'all' as Filter, label: '전체', count: platform.gateways.length },
  { key: 'ok' as Filter, label: '정상', count: platform.gateways.filter(gwOk).length },
  { key: 'warn' as Filter, label: '점검 필요', count: platform.gateways.filter((g) => !gwOk(g)).length },
])
const groupModes = [
  { key: 'farm' as GroupMode, label: '농장별' },
  { key: 'status' as GroupMode, label: '상태별' },
  { key: 'none' as GroupMode, label: '묶지 않음' },
]

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  return platform.gateways.filter((g) => {
    if (filter.value === 'ok' && !gwOk(g)) return false
    if (filter.value === 'warn' && gwOk(g)) return false
    if (!q) return true
    return [g.name, g.gatewayId, g.location, ownerName(g.userId), g.groupName].some((s) => (s || '').toLowerCase().includes(q))
  })
})

const sections = computed(() => {
  const list = filtered.value
  if (groupMode.value === 'none') return [{ key: 'all', label: '', items: list }]
  if (groupMode.value === 'status') {
    return [
      { key: 'warn', label: '점검 필요', items: list.filter((g) => !gwOk(g)) },
      { key: 'ok', label: '정상', items: list.filter(gwOk) },
    ].filter((s) => s.items.length)
  }
  const byOwner = new Map<string, ConsoleGateway[]>()
  for (const g of list) byOwner.set(g.userId, [...(byOwner.get(g.userId) || []), g])
  return [...byOwner.entries()]
    .map(([uid, items]) => ({ key: uid, label: ownerName(uid), items }))
    .sort((a, b) => a.label.localeCompare(b.label, 'ko'))
})

const gw = computed(() => platform.gateways.find((g) => g.id === selectedId.value) ?? null)

function select(id: string) {
  selectedId.value = id
  if (route.query.select !== id) router.replace({ query: { ...route.query, select: id, terminal: undefined } })
}

async function refresh() {
  loading.value = true
  try {
    await platform.load(true)
    await failover.load(platform.gateways.map((g) => g.gatewayId))
  } finally {
    loading.value = false
  }
}

// ── 등록/편집/삭제 (D3) ──
const formOpen = ref(false)
const editing = ref<ConsoleGateway | null>(null)
function openNew() {
  editing.value = null
  formOpen.value = true
}
function openEdit(g: ConsoleGateway) {
  editing.value = g
  formOpen.value = true
}
async function onSaved() {
  formOpen.value = false
  editing.value = null
  await platform.load(true)
}
async function removeGateway(g: ConsoleGateway) {
  const ok = await confirm({ title: '게이트웨이 삭제', message: `"${g.name}" 게이트웨이를 삭제할까요?`, confirmText: '삭제', variant: 'danger' })
  if (!ok) return
  try {
    await gatewayApi.remove(g.id)
    notif.success('삭제 완료', '게이트웨이가 삭제되었습니다.')
    selectedId.value = null
    await platform.load(true)
  } catch (e: any) {
    notif.error('오류', e?.response?.data?.message || '삭제 중 오류가 발생했습니다.')
  }
}

// ── 구역 할당 (D4) — 기존과 동일: 다른 구역으로 재할당 시 확인 ──
const zoneBusy = ref(false)
async function onZoneChange(g: ConsoleGateway, el: HTMLSelectElement) {
  const next = el.value || null
  if (next === (g.groupId || null)) return
  if (next && g.groupId) {
    const name = platform.groupsOfFarm(g.userId).find((z) => z.id === next)?.name
    const ok = await confirm({ title: '구역 재할당', message: `이 게이트웨이를 "${name}" 구역으로 재할당할까요?`, confirmText: '재할당', variant: 'warning' })
    if (!ok) {
      el.value = g.groupId || ''
      return
    }
  }
  zoneBusy.value = true
  try {
    const { data } = await gatewayApi.assignZone(g.id, next)
    const updated = data as { groupName?: string }
    notif.success('구역 할당', next ? `"${updated.groupName}" 구역에 할당되었습니다.` : '구역 할당이 해제되었습니다.')
  } catch (e: any) {
    notif.error('오류', e?.response?.data?.message || '구역 할당 중 오류가 발생했습니다.')
  } finally {
    await platform.load(true)
    zoneBusy.value = false
  }
}

// ── 터미널 · 설치 명령 (D5) ──
const terminalGw = ref<ConsoleGateway | null>(null)
const showSetup = ref(false)
const copied = ref<string | null>(null)
const SERVER_HOST = import.meta.env.VITE_SERVER_HOST || (window.location.hostname === 'localhost' ? '172.30.1.42' : window.location.hostname)
const SERVER_USER = import.meta.env.VITE_SERVER_USER || 'ohjeongseok'
function setupCommand(g: ConsoleGateway) {
  const backendUrl = `http://${SERVER_HOST}:3100`
  const scriptUrl = `${backendUrl}/api/gateways/setup/tunnel-setup.sh`
  return `curl -fsSL "${scriptUrl}" -o /tmp/tunnel-setup.sh && \\\nsudo env GATEWAY_ID=${g.gatewayId} \\\n  BACKEND_URL=${backendUrl} \\\n  SERVER_HOST=${SERVER_HOST} \\\n  SERVER_USER=${SERVER_USER} \\\n  bash /tmp/tunnel-setup.sh`
}
async function copy(text: string, key: string) {
  try {
    await navigator.clipboard.writeText(text)
    copied.value = key
    setTimeout(() => { if (copied.value === key) copied.value = null }, 2000)
  } catch {
    notif.error('복사 실패', '클립보드에 접근할 수 없습니다.')
  }
}

// ── 페일오버 원격 조치 (G7 · G8) ──
const actionBusy = ref(false)
async function resync(g: ConsoleGateway) {
  const ok = await confirm({ title: '재동기화', message: `"${g.name}" 게이트웨이에 페일오버 설정 재동기화 메시지를 발행할까요?`, confirmText: '재동기화', variant: 'info' })
  if (!ok) return
  actionBusy.value = true
  try {
    await emergencyFailoverApi.resync(g.gatewayId)
    notif.success('재동기화', '재동기화 메시지를 발행했습니다.')
    await failover.load(platform.gateways.map((x) => x.gatewayId))
  } catch (e: any) {
    notif.error('오류', e?.response?.data?.message || '재동기화에 실패했습니다.')
  } finally {
    actionBusy.value = false
  }
}

const stopTarget = ref<ConsoleGateway | null>(null)
const stopTyped = ref('')
async function startEmergencyStop(g: ConsoleGateway) {
  const ok = await confirm({ title: '비상 정지', message: `"${g.name}" 게이트웨이의 모든 릴레이를 비상 정지하시겠습니까? 폴백 모드에서도 즉시 실행됩니다.`, confirmText: '다음', variant: 'danger' })
  if (!ok) return
  stopTyped.value = ''
  stopTarget.value = g
}
async function executeEmergencyStop() {
  const g = stopTarget.value
  if (!g || stopTyped.value !== g.gatewayId) return
  actionBusy.value = true
  try {
    await emergencyFailoverApi.emergencyStop(g.gatewayId, 'manual-from-console', auth.user?.username || 'admin')
    notif.success('비상 정지', '비상 정지 명령을 발행했습니다.')
    stopTarget.value = null
  } catch (e: any) {
    notif.error('오류', e?.response?.data?.message || '비상 정지 명령 발행에 실패했습니다.')
  } finally {
    actionBusy.value = false
  }
}

onMounted(async () => {
  await refresh()
  const q = route.query.select
  selectedId.value = (typeof q === 'string' && platform.gateways.some((g) => g.id === q) ? q : null) ?? platform.gateways[0]?.id ?? null
  if (route.query.terminal === '1' && gw.value) {
    terminalGw.value = gw.value
    router.replace({ query: { ...route.query, terminal: undefined } })
  }
})
watch(() => route.query.select, (q) => {
  if (typeof q === 'string' && q !== selectedId.value && platform.gateways.some((g) => g.id === q)) selectedId.value = q
})
</script>

<style scoped>
.c-term-panel { width: min(1000px, 100%); height: min(640px, calc(100vh - 32px)); display: flex; flex-direction: column; border-radius: 10px; overflow: hidden; background: #0f172a; }
.c-term-panel :deep(.web-terminal-wrapper) { flex: 1; min-height: 0; }
</style>
