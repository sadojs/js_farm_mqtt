<template>
  <div class="c-root" :class="{ 'nav-open': navOpen }">
    <div class="c-scrim" aria-hidden="true" @click="navOpen = false" />

    <!-- ───────── 사이드바 ───────── -->
    <aside class="c-side" aria-label="콘솔 메뉴">
      <router-link to="/" class="c-brand">
        <div class="c-logo"><CIcon name="leaf" /></div>
        <div class="c-brand-t"><b>스마트팜 콘솔</b><span>Platform Admin</span></div>
      </router-link>

      <div class="c-sec">콘솔</div>
      <router-link to="/" class="c-link" :class="{ on: route.name === 'overview' }"><CIcon name="overview" />플랫폼 개요</router-link>

      <div class="c-sec">플랫폼 운영</div>
      <router-link to="/users" class="c-link" :class="{ on: route.name === 'users' }"><CIcon name="user" />사용자<span class="c-cnt">{{ platform.loaded ? platform.counts.users : '' }}</span></router-link>
      <router-link to="/farms" class="c-link" :class="{ on: route.name === 'farms' }"><CIcon name="home" />농장<span class="c-cnt">{{ platform.loaded ? platform.counts.farms : '' }}</span></router-link>
      <router-link to="/gateways" class="c-link" :class="{ on: route.name === 'gateways' || route.name === 'gateway-env' }"><CIcon name="gateway" />게이트웨이<span class="c-cnt">{{ platform.loaded ? platform.counts.gateways : '' }}</span></router-link>
      <router-link to="/config-deploy" class="c-link" :class="{ on: route.name === 'config-deploy' }"><CIcon name="deploy" />설정 배포</router-link>
      <router-link to="/emergency-failover" class="c-link" :class="{ on: route.name === 'emergency-failover' }"><CIcon name="warn" />이머전시 페일오버</router-link>

      <div class="c-sec">농장 보기</div>
      <button class="c-farmpick" :class="{ active: !!activeFarm }" type="button" :aria-expanded="pickerOpen" @click="togglePicker">
        <template v-if="pickerFarm">
          <span class="c-led" :class="activeFarm ? 'c-led-ok' : 'c-led-off'" />
          <b>{{ pickerFarm.name }}</b><span class="c-mono" style="font-size:11px;color:var(--c-side-muted)">@{{ pickerFarm.username }}</span>
        </template>
        <template v-else><CIcon name="search" :size="14" />농장을 선택하세요</template>
        <span class="c-chev">▾</span>
      </button>
      <div v-if="pickerOpen" class="c-farmlist" role="listbox">
        <input ref="pickerInput" v-model="pickerQuery" placeholder="농장 이름·아이디 필터" aria-label="농장 필터" @keydown.esc="pickerOpen = false" />
        <button v-for="f in pickerResults" :key="f.id" type="button" :class="{ on: f.id === activeFarmId }" @click="enterFarm(f.id)">
          <span class="c-led c-led-ok" />{{ f.name }}<span class="c-mono" style="margin-left:auto;font-size:11px;color:var(--c-side-muted)">@{{ f.username }}</span>
        </button>
        <div v-if="!pickerResults.length" class="c-mono" style="padding:8px 10px;font-size:12px;color:var(--c-side-muted)">결과 없음</div>
      </div>
      <template v-for="m in farmMenu" :key="m.seg">
        <router-link v-if="menuFarmId && m.visible" :to="`/farm/${menuFarmId}/${m.seg}`" class="c-link"
                     :class="{ on: route.meta.farmMenu === m.seg }"><CIcon :name="m.icon" />{{ m.title }}</router-link>
        <span v-else-if="!menuFarmId && m.primary" class="c-link dis"><CIcon :name="m.icon" />{{ m.title }}</span>
      </template>

      <div class="c-side-foot">
        <div class="c-row"><span class="c-led" :class="apiOk ? 'c-led-ok' : 'c-led-warn'" />API {{ apiOk ? '정상' : '확인 필요' }} · MQTT {{ mqttOk ? '연결' : '미연결' }}</div>
        <div class="c-row"><span class="c-led" :class="socket.connected.value ? 'c-led-ok' : 'c-led-warn'" />실시간 {{ socket.connected.value ? '연결' : (socket.reconnecting.value ? '재연결 중' : '끊김') }}</div>
        <div class="c-row c-mono" style="font-size:11px">v{{ version }} · {{ clock }} KST</div>
      </div>
    </aside>

    <!-- ───────── 본문 ───────── -->
    <main class="c-main">
      <div v-if="activeFarmId" class="c-ctxbar" role="status">
        <CIcon name="eye" :size="14" />
        <span><b>{{ activeFarm?.name || '농장' }}</b> 농장을 관리자 권한으로 보는 중 — 여기서 하는 제어는 이 농장에 실제로 적용됩니다</span>
        <span v-if="farmSocketNote" class="c-mono" style="font-size:11px;opacity:.8">{{ farmSocketNote }}</span>
        <span class="c-ctx-act">
          <button type="button" @click="openPickerFromCtx">농장 변경</button>
          <button type="button" @click="exitFarm">농장 보기 종료</button>
        </span>
      </div>

      <div class="c-top">
        <button class="c-icon-btn c-burger" type="button" aria-label="메뉴 열기" @click="navOpen = !navOpen"><CIcon name="menu" /></button>
        <div class="c-crumb">
          <template v-for="(c, i) in crumbs" :key="i"><span v-if="i > 0">/</span><b v-if="i === crumbs.length - 1">{{ c }}</b><template v-else>{{ c }}</template></template>
        </div>

        <div class="c-search" @click="focusSearch">
          <CIcon name="search" :size="14" />
          <input ref="searchInput" v-model="searchQuery" :placeholder="activeFarmId ? '사용자, 농장, 게이트웨이 검색 (플랫폼 전체)' : '사용자, 농장, 게이트웨이 검색'"
                 aria-label="전체 검색" @focus="paletteOpen = true" @keydown="onSearchKey" />
          <span class="c-kbd">⌘K</span>
          <div v-if="paletteOpen && searchQuery.trim()" class="c-palette" role="listbox">
            <template v-for="grp in searchGroups" :key="grp.label">
              <div class="c-pal-h">{{ grp.label }}</div>
              <button v-for="item in grp.items" :key="item.key" type="button" :class="{ on: item.idx === paletteIndex }"
                      @mousedown.prevent="goSearch(item)">
                <CIcon :name="item.icon" :size="14" /><span>{{ item.title }}</span><span class="c-mono c-muted" style="margin-left:auto">{{ item.sub }}</span>
              </button>
            </template>
            <div v-if="!searchFlat.length" class="c-empty" style="padding:12px">검색 결과가 없습니다</div>
          </div>
        </div>

        <NotificationCenter placement="bottom" />

        <div style="position:relative">
          <button class="c-user" type="button" aria-haspopup="menu" :aria-expanded="userMenuOpen" @click="userMenuOpen = !userMenuOpen">
            <div class="c-av">{{ userInitial }}</div>
            <div class="c-user-t">{{ auth.user?.name || '관리자' }}<span>플랫폼 관리자</span></div>
          </button>
          <div v-if="userMenuOpen" class="c-menu" role="menu" style="right:0;top:42px">
            <div class="c-menu-h">@{{ auth.user?.username }}</div>
            <button type="button" role="menuitem" @click="openMyInfo"><CIcon name="user" :size="14" />내 정보</button>
            <button type="button" role="menuitem" @click="openFeatures"><CIcon name="settings" :size="14" />기능 설정</button>
            <a :href="legacyAppUrl" target="_blank" rel="noopener" role="menuitem"><CIcon name="arrow" :size="14" />기존 앱 열기</a>
            <div class="c-menu-sep" />
            <button type="button" role="menuitem" @click="logout"><CIcon name="logout" :size="14" />로그아웃</button>
          </div>
        </div>
      </div>

      <div class="c-narrow-note">관리자 콘솔은 PC·태블릿(가로 768px 이상)에 맞춰져 있습니다. 휴대폰에서는 기존 앱을 이용하세요.</div>

      <router-view v-slot="{ Component }">
        <component :is="Component" :key="route.path" />
      </router-view>
    </main>

    <!-- 내 정보 (A10) — 기존 UserFormModal 재사용, 저장은 기존과 동일하게 /users/me -->
    <UserFormModal :show="myInfoOpen" :user="myInfoUser" @close="myInfoOpen = false" @save="saveMyInfo" />

    <!-- 기능 설정 (A11) — 본인 부가기능 개인 토글 -->
    <div v-if="featuresOpen" class="c-modal-back" @click.self="featuresOpen = false">
      <div class="c-modal" role="dialog" aria-label="기능 설정">
        <div class="c-modal-h">기능 설정 <button class="c-icon-btn" type="button" aria-label="닫기" @click="featuresOpen = false"><CIcon name="x" /></button></div>
        <div class="c-modal-b">
          <p class="c-muted" style="margin:0">관리자 본인 계정의 부가기능 표시 설정입니다. 사용자별 권한은 사용자 화면에서 관리합니다.</p>
          <div class="c-perm">
            <div><div class="c-t">생육관리</div><div class="c-d">GDD 생육 추적 모듈</div></div>
            <button class="c-sw" :class="{ off: !mySettings.cropFeature.value.userEnabled }" type="button" role="switch"
                    :aria-checked="mySettings.cropFeature.value.userEnabled" aria-label="생육관리" @click="mySettings.toggleCrop()" />
          </div>
          <div v-for="f in FEATURE_META" :key="f.key" class="c-perm">
            <div><div class="c-t">{{ f.label }}</div><div class="c-d">{{ f.desc }}</div></div>
            <button class="c-sw" :class="{ off: mySettings.featureFlags.value[f.key]?.userEnabled === false }" type="button" role="switch"
                    :disabled="mySettings.featureFlags.value[f.key]?.lockedByAdmin" :aria-checked="mySettings.featureFlags.value[f.key]?.userEnabled !== false"
                    :aria-label="f.label" @click="mySettings.toggleFeature(f.key)" />
          </div>
        </div>
        <div class="c-modal-f"><button class="c-btn" type="button" @click="featuresOpen = false">닫기</button></div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth.store'
import { useNotificationStore } from '@/stores/notification.store'
import { useWebSocket, socketStatus } from '@/composables/useWebSocket'
import { userApi } from '@/api/user.api'
import { FEATURE_META } from '@/composables/useFeatureFlags'
import NotificationCenter from '@/components/common/NotificationCenter.vue'
import UserFormModal from '@/components/admin/UserFormModal.vue'
import apiClient from '@/api/client'
import CIcon from '@console/components/CIcon.vue'
import { usePlatformStore } from '@console/stores/platform.store'
import { farmState, rememberFarm, PLATFORM_REQUEST } from '@console/farm/farmContext'
import { useMySettings, useFarmMenuFlags } from '@console/composables/useConsoleFeatures'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const notify = useNotificationStore()
const platform = usePlatformStore()
const ws = useWebSocket()
const socket = { connected: computed(() => socketStatus.connected), reconnecting: computed(() => socketStatus.reconnecting) }
const version = '0.1.0'

const navOpen = ref(false)
watch(() => route.fullPath, () => { navOpen.value = false; paletteOpen.value = false; userMenuOpen.value = false; pickerOpen.value = false })

// ── 플랫폼 데이터 + 실시간 게이트웨이 상태 ──
function onGatewayStatus(p: { gatewayId: string; agentStatus: string }) { platform.patchGatewayStatus(p.gatewayId, p.agentStatus) }
onMounted(() => {
  void platform.load()
  ws.on('gateway:status', onGatewayStatus)
})
onBeforeUnmount(() => ws.off('gateway:status', onGatewayStatus))

// ── 농장 보기 ──
const activeFarmId = computed(() => farmState.activeFarmId)
const activeFarm = computed(() => platform.farmById(activeFarmId.value))
/** 사이드바 메뉴 링크 대상: 현재 농장 보기 중인 농장, 아니면 마지막 선택 농장 */
const menuFarmId = computed(() => activeFarmId.value || farmState.selected?.id || null)
const pickerFarm = computed(() => activeFarm.value || (farmState.selected ? platform.farmById(farmState.selected.id) || farmState.selected : null))

// 진입한 농장이 실제 농장 관리자 계정인지 확인 + 마지막 선택 기억
watch([activeFarmId, () => platform.loaded], ([id, loaded]) => {
  if (!id || !loaded) return
  const farm = platform.farmById(id)
  if (!farm) {
    notify.warning('농장을 찾을 수 없음', '선택한 농장(농장 관리자 계정)이 없거나 비활성입니다. 농장 목록에서 다시 선택하세요.')
    void router.replace('/farms')
    return
  }
  rememberFarm({ id: farm.id, name: farm.name, username: farm.username })
}, { immediate: true })

const menuFlags = useFarmMenuFlags()
watch(activeFarmId, (id) => { if (id) void menuFlags.load() }, { immediate: true })
const farmMenu = computed(() => {
  const f = menuFlags.flags.value
  return [
    { seg: 'dashboard', title: '대시보드', icon: 'grid', primary: true, visible: true },
    { seg: 'groups', title: '구역 관리', icon: 'zone', primary: true, visible: true },
    { seg: 'automation', title: '자동 제어', icon: 'auto', primary: true, visible: true },
    { seg: 'spray-schedule', title: '방재 일정', icon: 'check', primary: true, visible: f.spray_schedule !== false },
    { seg: 'worker-payroll', title: '일꾼 관리', icon: 'users', primary: true, visible: f.worker_payroll !== false },
    { seg: 'sensors', title: '농장 환경', icon: 'thermo', primary: false, visible: true },
    { seg: 'reports', title: '기록 보기', icon: 'chart', primary: false, visible: true },
    { seg: 'alerts', title: '이상 알림', icon: 'bell', primary: false, visible: true },
    { seg: 'activity-log', title: '동작 이력', icon: 'history', primary: false, visible: true },
    { seg: 'work-log', title: '농작업 일정', icon: 'calendar', primary: false, visible: f.work_log !== false },
    { seg: 'crop-management', title: '생육관리', icon: 'sprout', primary: false, visible: f.crop !== false },
  ]
})

const farmSocketNote = computed(() => {
  switch (farmState.socket) {
    case 'joined': return '실시간: 이 농장 이벤트만 수신'
    case 'joining': return '실시간: 농장 채널 연결 중'
    case 'unsupported': return '실시간: 서버 농장 채널 미지원(전체 수신)'
    case 'error': return `실시간: 농장 채널 오류(${farmState.socketError})`
    default: return ''
  }
})

const pickerOpen = ref(false)
const pickerQuery = ref('')
const pickerInput = ref<HTMLInputElement | null>(null)
const pickerResults = computed(() => {
  const q = pickerQuery.value.trim().toLowerCase()
  return platform.farms.filter((f) => !q || f.name.toLowerCase().includes(q) || f.username.toLowerCase().includes(q))
})
function togglePicker() {
  pickerOpen.value = !pickerOpen.value
  pickerQuery.value = ''
  if (pickerOpen.value) void nextTick(() => pickerInput.value?.focus())
}
function openPickerFromCtx() {
  navOpen.value = true
  pickerOpen.value = true
  pickerQuery.value = ''
  void nextTick(() => pickerInput.value?.focus())
}
function enterFarm(farmId: string) {
  pickerOpen.value = false
  // 같은 메뉴를 유지하며 농장만 바꾼다 (농장 보기 밖이면 대시보드로)
  const seg = typeof route.meta.farmMenu === 'string' ? route.meta.farmMenu : 'dashboard'
  void router.push(`/farm/${farmId}/${seg}`)
}
function exitFarm() {
  void router.push('/')
}

// ── 브레드크럼 ──
const crumbs = computed(() => {
  const title = route.meta.title || ''
  switch (route.meta.section) {
    case 'farm': return ['농장 보기', activeFarm.value?.name || '농장', title]
    case 'platform': return ['플랫폼 운영', title]
    default: return ['콘솔', title]
  }
})

// ── 전체 검색 (⌘K): 사용자·농장·게이트웨이 즉시 검색 ──
const searchInput = ref<HTMLInputElement | null>(null)
const searchQuery = ref('')
const paletteOpen = ref(false)
const paletteIndex = ref(0)
interface SearchItem { key: string; idx: number; icon: string; title: string; sub: string; to: string }
const searchGroups = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return []
  let idx = 0
  const roleLabel: Record<string, string> = { admin: '플랫폼 관리자', farm_admin: '농장 관리자', farm_user: '농장 사용자' }
  const users = platform.users.filter((u) => u.name.toLowerCase().includes(q) || u.username.toLowerCase().includes(q)).slice(0, 6)
    .map<SearchItem>((u) => ({ key: 'u' + u.id, idx: idx++, icon: 'user', title: u.name, sub: `@${u.username} · ${roleLabel[u.role] || u.role}`, to: `/users?select=${u.id}` }))
  const farms = platform.farms.filter((f) => f.name.toLowerCase().includes(q) || f.username.toLowerCase().includes(q)).slice(0, 6)
    .map<SearchItem>((f) => ({ key: 'f' + f.id, idx: idx++, icon: 'home', title: f.name, sub: `@${f.username}`, to: `/farms?select=${f.id}` }))
  const gws = platform.gateways.filter((g) => g.name.toLowerCase().includes(q) || g.gatewayId.toLowerCase().includes(q) || (g.location || '').toLowerCase().includes(q)).slice(0, 6)
    .map<SearchItem>((g) => ({ key: 'g' + g.id, idx: idx++, icon: 'gateway', title: g.name, sub: g.gatewayId, to: `/gateways?select=${g.id}` }))
  return [
    { label: '사용자', items: users },
    { label: '농장', items: farms },
    { label: '게이트웨이', items: gws },
  ].filter((g) => g.items.length)
})
const searchFlat = computed(() => searchGroups.value.flatMap((g) => g.items))
watch(searchQuery, () => { paletteIndex.value = 0 })
function focusSearch() { searchInput.value?.focus() }
function goSearch(item: SearchItem) {
  paletteOpen.value = false
  searchQuery.value = ''
  searchInput.value?.blur()
  void router.push(item.to)
}
function onSearchKey(e: KeyboardEvent) {
  const n = searchFlat.value.length
  if (e.key === 'ArrowDown' && n) { paletteIndex.value = (paletteIndex.value + 1) % n; e.preventDefault() }
  else if (e.key === 'ArrowUp' && n) { paletteIndex.value = (paletteIndex.value - 1 + n) % n; e.preventDefault() }
  else if (e.key === 'Enter' && n) { goSearch(searchFlat.value[paletteIndex.value]); e.preventDefault() }
  else if (e.key === 'Escape') { paletteOpen.value = false; searchInput.value?.blur() }
}
function onGlobalKey(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    searchInput.value?.focus()
    paletteOpen.value = true
  }
}
function onDocClick(e: MouseEvent) {
  const t = e.target as HTMLElement
  if (!t.closest('.c-search')) paletteOpen.value = false
  if (!t.closest('.c-user') && !t.closest('.c-menu')) userMenuOpen.value = false
}
onMounted(() => {
  window.addEventListener('keydown', onGlobalKey)
  document.addEventListener('click', onDocClick)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKey)
  document.removeEventListener('click', onDocClick)
})

// ── 사용자 메뉴 ──
const userMenuOpen = ref(false)
const userInitial = computed(() => (auth.user?.name || '관').charAt(0))
const legacyAppUrl = computed(() => (location.port === '5175' ? `https://${location.hostname}:5174/` : `${location.protocol}//${location.hostname}:8443/`))

const myInfoOpen = ref(false)
const myInfoUser = ref<any>(null)
function openMyInfo() {
  userMenuOpen.value = false
  myInfoUser.value = auth.user ? { ...auth.user } : null
  myInfoOpen.value = true
}
/** 기존 UserManagement.saveUser 의 "자기 자신" 경로와 동일: name·address(+password) → /users/me */
async function saveMyInfo(data: any) {
  try {
    const payload: Record<string, unknown> = { name: data.name, address: data.address }
    if (data.password) payload.password = data.password
    await userApi.updateMe(payload as any)
    await auth.fetchUser()
    myInfoOpen.value = false
    notify.success('저장 완료', '내 정보가 수정되었습니다.')
  } catch (err: any) {
    notify.error('저장 실패', err?.response?.data?.message || '내 정보 저장에 실패했습니다.')
  }
}

const mySettings = useMySettings()
const featuresOpen = ref(false)
function openFeatures() {
  userMenuOpen.value = false
  featuresOpen.value = true
  void mySettings.load()
}

async function logout() {
  userMenuOpen.value = false
  await auth.logout()
  notify.info('로그아웃', '정상적으로 로그아웃되었습니다.')
  void router.replace('/login')
}

// ── 상태 표시 (API·MQTT 헬스, 시계) ──
const apiOk = ref(true)
const mqttOk = ref(true)
const clock = ref('')
async function checkHealth() {
  try {
    const { data } = await apiClient.get('/health', PLATFORM_REQUEST)
    apiOk.value = data?.status === 'ok'
    mqttOk.value = data?.checks?.mqtt?.status === 'ok'
  } catch {
    apiOk.value = false
    mqttOk.value = false
  }
}
function tick() { clock.value = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false }) }
let healthTimer: ReturnType<typeof setInterval> | null = null
let clockTimer: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  tick(); void checkHealth()
  clockTimer = setInterval(tick, 15000)
  healthTimer = setInterval(checkHealth, 60000)
})
onBeforeUnmount(() => {
  if (clockTimer) clearInterval(clockTimer)
  if (healthTimer) clearInterval(healthTimer)
})
</script>
