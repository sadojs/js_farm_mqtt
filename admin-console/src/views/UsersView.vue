<template>
  <div class="c-body">
    <div class="c-head">
      <div>
        <h1 class="c-h1">사용자</h1>
        <p class="c-sub">플랫폼 계정과 농장별 구성원, 기능 권한을 관리합니다</p>
      </div>
      <div class="c-actions">
        <button class="c-btn" type="button" :disabled="platform.loading" @click="reload"><CIcon name="refresh" :size="14" />새로고침</button>
        <button class="c-btn c-btn-pri" type="button" @click="openNew"><CIcon name="plus" :size="14" />새 사용자</button>
      </div>
    </div>

    <div class="c-row-wrap">
      <div class="c-card" style="flex:3 1 600px">
        <div class="c-card-h">
          <div class="c-tabs" role="tablist" aria-label="역할">
            <button v-for="t in tabs" :key="t.key" class="c-tab" :class="{ on: tab === t.key }" role="tab" :aria-selected="tab === t.key" type="button" @click="tab = t.key">
              {{ t.label }} <span class="c-n">{{ t.count }}</span>
            </button>
          </div>
          <label class="c-search c-search-inline"><CIcon name="search" :size="13" /><input v-model="query" placeholder="이름, 아이디 필터" aria-label="사용자 필터" /></label>
        </div>
        <div class="c-tbl-wrap">
          <table class="c-tbl">
            <thead><tr><th>이름</th><th>아이디</th><th>역할</th><th>소속 농장</th><th>게이트웨이</th><th>상태</th></tr></thead>
            <tbody>
              <tr v-for="r in rows" :key="r.user.id" class="c-click" :class="{ 'c-sel': r.user.id === selectedId, 'c-child': r.child }" tabindex="0"
                @click="select(r.user.id)" @keydown.enter="select(r.user.id)">
                <td>
                  <div style="display:flex;align-items:center;gap:8px">
                    <span v-if="r.child" class="c-muted">└</span>
                    <div v-else class="c-av c-av-s" :style="{ background: avatarColor(r.user.role) }">{{ initial(r.user.name) }}</div>
                    <b :style="r.child ? 'font-weight:500' : ''">{{ r.user.name }}</b>
                  </div>
                </td>
                <td class="c-mono">@{{ r.user.username }}</td>
                <td><span class="c-pill" :class="roleClass(r.user.role)">{{ roleLabel(r.user.role) }}</span></td>
                <td :class="{ 'c-muted': !farmNameOf(r.user) }">{{ farmNameOf(r.user) || '—' }}</td>
                <td class="c-mono" :class="{ 'c-muted': r.user.role === 'farm_user' }">{{ r.user.role === 'farm_user' ? '—' : platform.gatewaysOfFarm(r.user.id).length }}</td>
                <td><span class="c-pill" :class="r.user.status === 'active' ? 'c-p-ok' : 'c-p-off'"><span class="c-led" :class="r.user.status === 'active' ? 'c-led-ok' : 'c-led-off'" />{{ r.user.status === 'active' ? '활성' : '비활성' }}</span></td>
              </tr>
              <tr v-if="!rows.length"><td colspan="6" class="c-empty">{{ platform.loading ? '불러오는 중…' : '조건에 맞는 사용자가 없습니다' }}</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- 상세 패널 -->
      <div class="c-card c-detail" style="flex:1 1 340px">
        <template v-if="selected">
          <div class="c-detail-h">
            <div class="c-av" style="width:44px;height:44px;font-size:18px" :style="{ background: avatarColor(selected.role) }">{{ initial(selected.name) }}</div>
            <div style="flex:1;min-width:0">
              <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                <b style="font-size:16px">{{ selected.name }}</b>
                <span class="c-pill" :class="roleClass(selected.role)">{{ roleLabel(selected.role) }}</span>
                <span v-if="selected.status !== 'active'" class="c-pill c-p-off">비활성</span>
              </div>
              <div class="c-mono c-muted" style="margin-top:2px">@{{ selected.username }} · 가입 {{ fmtDate(selected.createdAt) }}</div>
            </div>
          </div>
          <div class="c-detail-actions">
            <button class="c-btn c-btn-sm" type="button" @click="openEdit(selected)">편집</button>
            <button class="c-btn c-btn-sm" type="button" @click="openEdit(selected)">비밀번호 재설정</button>
            <button v-if="selected.id !== auth.user?.id" class="c-btn c-btn-sm c-btn-danger-outline" style="margin-left:auto" type="button" @click="removeUser(selected)">삭제</button>
          </div>
          <div class="c-fields">
            <div class="c-field"><span class="c-k">이름</span><span class="c-v">{{ selected.name }}</span></div>
            <div class="c-field"><span class="c-k">역할</span><span class="c-v">{{ roleLabel(selected.role) }}</span></div>
            <div v-if="selected.role === 'farm_user'" class="c-field" style="grid-column:1 / -1"><span class="c-k">소속 농장</span><span class="c-v">{{ selected.parentUserName || platform.userById(selected.parentUserId)?.name || '미지정' }}</span></div>
            <div class="c-field" style="grid-column:1 / -1"><span class="c-k">주소 (날씨 기준 위치)</span><span class="c-v">{{ selected.address || '—' }}</span></div>
          </div>

          <div class="c-sub-h">기능 권한</div>
          <div style="padding:0 16px 12px">
            <p v-if="selected.role === 'admin'" class="c-note">플랫폼 관리자는 모든 기능에 접근할 수 있습니다.</p>
            <p v-else-if="selected.role === 'farm_user'" class="c-note">소속 농장({{ selected.parentUserName || '미지정' }}) 관리자의 설정을 상속합니다.</p>
            <template v-else>
              <div class="c-perm">
                <div><div class="c-t">생육관리</div><div class="c-d">GDD 생육 추적 모듈</div></div>
                <button class="c-sw" :class="{ off: cropMap[selected.id] === false }" type="button" role="switch" :aria-checked="cropMap[selected.id] !== false"
                  :aria-label="`생육관리 ${cropMap[selected.id] !== false ? '켜짐' : '꺼짐'}`" :disabled="permBusy === 'crop'" @click="toggleCrop(selected.id)" />
              </div>
              <div v-for="f in FEATURE_META" :key="f.key" class="c-perm">
                <div>
                  <div class="c-t">{{ f.label }}</div>
                  <div class="c-d">{{ f.desc }}<template v-if="featureStates[f.key]?.platformEnabled === false"> · 플랫폼 전체 꺼짐</template></div>
                </div>
                <button class="c-sw" :class="{ off: featureStates[f.key]?.userEnabled === false }" type="button" role="switch" :aria-checked="featureStates[f.key]?.userEnabled !== false"
                  :aria-label="`${f.label} ${featureStates[f.key]?.userEnabled !== false ? '켜짐' : '꺼짐'}`" :disabled="permBusy === f.key" @click="toggleFeature(selected.id, f.key)" />
              </div>
            </template>
          </div>

          <template v-if="selected.role === 'farm_admin'">
            <div class="c-sub-h">소속 농장 사용자 ({{ children.length }}) <button class="c-link-btn" type="button" @click="openNew">+ 추가</button></div>
            <div v-for="c in children" :key="c.id" class="c-li c-click" @click="select(c.id)">
              <div class="c-av c-av-s" :style="{ background: avatarColor(c.role) }">{{ initial(c.name) }}</div>
              <div style="flex:1;min-width:0"><b style="font-weight:500">{{ c.name }}</b> <span class="c-mono c-muted">@{{ c.username }}</span></div>
              <span class="c-pill" :class="c.status === 'active' ? 'c-p-ok' : 'c-p-off'">{{ c.status === 'active' ? '활성' : '비활성' }}</span>
            </div>
            <div v-if="!children.length" class="c-li c-muted">소속된 농장 사용자가 없습니다.</div>
          </template>

          <template v-if="selected.role !== 'farm_user'">
            <div class="c-sub-h">게이트웨이 ({{ userGateways.length }}) <button class="c-link-btn" type="button" @click="openGatewayNew">+ 추가</button></div>
            <div v-for="gw in userGateways" :key="gw.id" class="c-li">
              <span class="c-led" :class="agentOnline(gw) ? 'c-led-ok' : 'c-led-warn'" />
              <div style="flex:1;min-width:0">
                <b style="font-weight:500">{{ gw.name }}</b> <span class="c-mono c-muted">{{ gw.gatewayId }}</span>
                <div v-if="gw.location || gw.lastSeen" class="c-muted" style="font-size:12px">{{ [gw.location, gw.lastSeen ? '최근 ' + ago(gw.lastSeen) : ''].filter(Boolean).join(' · ') }}</div>
              </div>
              <button class="c-btn c-btn-sm" type="button" @click="openGatewayEdit(gw)">편집</button>
              <button class="c-btn c-btn-sm c-btn-danger-outline" type="button" @click="removeGateway(gw)">삭제</button>
            </div>
            <div v-if="!userGateways.length" class="c-li c-muted">등록된 게이트웨이가 없습니다.</div>
          </template>
        </template>
        <div v-else class="c-empty">왼쪽 목록에서 사용자를 선택하세요</div>
      </div>
    </div>

    <UserFormModal :show="userModalOpen" :user="formUser" @close="userModalOpen = false" @save="saveUser" />
    <GatewayFormModal :show="gwModalOpen" :gateway="gwEditing" :default-user-id="selected?.id" @close="gwModalOpen = false" @saved="onGatewaySaved" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import apiClient from '@/api/client'
import { userApi } from '@/api/user.api'
import { gatewayApi } from '@/api/gateway.api'
import { useAuthStore } from '@/stores/auth.store'
import { useNotificationStore } from '@/stores/notification.store'
import { useConfirm } from '@/composables/useConfirm'
import { FEATURE_META, type FeatureKey, type FeatureState } from '@/composables/useFeatureFlags'
import type { User } from '@/types/auth.types'
import UserFormModal from '@/components/admin/UserFormModal.vue'
import CIcon from '@console/components/CIcon.vue'
import GatewayFormModal from '@console/components/GatewayFormModal.vue'
import { usePlatformStore, agentOnline, type ConsoleGateway } from '@console/stores/platform.store'

type Tab = 'all' | 'admin' | 'farm_admin' | 'farm_user'

const platform = usePlatformStore()
const auth = useAuthStore()
const notif = useNotificationStore()
const { confirm } = useConfirm()
const route = useRoute()
const router = useRouter()

const tab = ref<Tab>('all')
const query = ref('')
const selectedId = ref<string | null>(null)

const roleLabel = (r: string) => (r === 'admin' ? '플랫폼 관리자' : r === 'farm_admin' ? '농장 관리자' : r === 'farm_user' ? '농장 사용자' : r)
const roleClass = (r: string) => (r === 'admin' ? 'c-p-admin' : r === 'farm_admin' ? 'c-p-role' : 'c-p-off')
const avatarColor = (r: string) => (r === 'admin' ? '#3B4A63' : r === 'farm_admin' ? '#5B4B8A' : '#6B7280')
const initial = (n: string) => (n ? n.charAt(0).toUpperCase() : '?')
const fmtDate = (raw?: string) => {
  if (!raw) return '—'
  const d = new Date(raw)
  return isNaN(d.getTime()) ? raw : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function ago(iso: string): string {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (min < 1) return '방금 전'
  if (min < 60) return `${min}분 전`
  const h = Math.floor(min / 60)
  return h < 24 ? `${h}시간 전` : `${Math.floor(h / 24)}일 전`
}
function farmNameOf(u: User): string {
  if (u.role === 'farm_admin') return u.name
  if (u.role === 'farm_user') return u.parentUserName || platform.userById(u.parentUserId)?.name || ''
  return ''
}

const tabs = computed(() => [
  { key: 'all' as Tab, label: '전체', count: platform.counts.users },
  { key: 'admin' as Tab, label: '플랫폼 관리자', count: platform.counts.admins },
  { key: 'farm_admin' as Tab, label: '농장 관리자', count: platform.counts.farmAdmins },
  { key: 'farm_user' as Tab, label: '농장 사용자', count: platform.counts.farmUsers },
])

function matches(u: User): boolean {
  const q = query.value.trim().toLowerCase()
  return !q || u.name.toLowerCase().includes(q) || u.username.toLowerCase().includes(q)
}

/** 트리 행: 관리자 → 농장 관리자(아래 소속 농장 사용자) → 소속 없는 농장 사용자. 역할 탭에서는 평면 목록. */
const rows = computed(() => {
  const all = platform.users
  if (tab.value !== 'all') return all.filter((u) => u.role === tab.value && matches(u)).map((user) => ({ user, child: false }))
  const out: Array<{ user: User; child: boolean }> = []
  for (const u of all.filter((x) => x.role === 'admin' && matches(x))) out.push({ user: u, child: false })
  const shownParents = new Set<string>()
  for (const fa of all.filter((x) => x.role === 'farm_admin')) {
    const kids = all.filter((c) => c.role === 'farm_user' && c.parentUserId === fa.id)
    const faHit = matches(fa)
    const kidHits = faHit ? kids : kids.filter(matches)
    if (!faHit && !kidHits.length) continue
    shownParents.add(fa.id)
    out.push({ user: fa, child: false })
    for (const k of kidHits) out.push({ user: k, child: true })
  }
  for (const u of all.filter((x) => x.role === 'farm_user' && (!x.parentUserId || !shownParents.has(x.parentUserId)) && matches(x))) {
    out.push({ user: u, child: false })
  }
  return out
})

const selected = computed(() => platform.userById(selectedId.value))
const children = computed(() => (selected.value ? platform.users.filter((u) => u.parentUserId === selected.value!.id) : []))
const userGateways = computed(() => (selected.value ? platform.gatewaysOfFarm(selected.value.id) : []))

function select(id: string) {
  selectedId.value = id
  if (route.query.select !== id) router.replace({ query: { ...route.query, select: id } })
}

// ── 기능 권한 (기존 UserManagement.vue 와 동일 API) ──
const cropMap = ref<Record<string, boolean>>({})
const featureStates = ref<Partial<Record<FeatureKey, FeatureState>>>({})
const permBusy = ref<string | null>(null)

async function loadCropMap() {
  try {
    cropMap.value = (await apiClient.get<Record<string, boolean>>('/crop-management/feature/all')).data
  } catch {
    cropMap.value = {}
  }
}
async function loadFeatureStates(userId: string) {
  try {
    featureStates.value = (await apiClient.get<Record<FeatureKey, FeatureState>>(`/features/users/${userId}`)).data
  } catch {
    featureStates.value = {}
  }
}
async function toggleCrop(userId: string) {
  const next = !(cropMap.value[userId] !== false)
  permBusy.value = 'crop'
  try {
    await apiClient.patch(`/crop-management/feature/users/${userId}`, { enabled: next })
    cropMap.value = { ...cropMap.value, [userId]: next }
  } catch (e: any) {
    notif.error('변경 실패', e?.response?.data?.message || '생육관리 설정 변경에 실패했습니다.')
  } finally {
    permBusy.value = null
  }
}
async function toggleFeature(userId: string, key: FeatureKey) {
  const next = !(featureStates.value[key]?.userEnabled !== false)
  permBusy.value = key
  try {
    await apiClient.patch(`/features/${key}/users/${userId}`, { enabled: next })
    await loadFeatureStates(userId)
  } catch (e: any) {
    notif.error('변경 실패', e?.response?.data?.message || '기능 설정 변경에 실패했습니다.')
  } finally {
    permBusy.value = null
  }
}
watch(selected, (u) => {
  if (u && u.role === 'farm_admin') loadFeatureStates(u.id)
  else featureStates.value = {}
}, { immediate: true })

// ── 사용자 생성/편집/삭제 (기존 saveUser 와 동일 페이로드) ──
const userModalOpen = ref(false)
// 기존 UserFormModal 의 UserFormData(parentUserId?: string) 와 User(parentUserId: string | null) 차이 — 기존 화면과 동일하게 복제본을 그대로 넘긴다
const formUser = ref<any>(null)

function openNew() {
  formUser.value = null
  userModalOpen.value = true
}
function openEdit(u: User) {
  formUser.value = { ...u }
  userModalOpen.value = true
}
async function saveUser(data: any) {
  try {
    if (formUser.value?.id) {
      const payload: any = { name: data.name, address: data.address }
      if (data.role) payload.role = data.role
      if (data.status) payload.status = data.status
      if (data.password) payload.password = data.password
      if (data.parentUserId !== undefined) payload.parentUserId = data.parentUserId || null
      if (formUser.value.id === auth.user?.id) {
        await userApi.updateMe(payload)
        await auth.fetchUser()
      } else {
        await userApi.update(formUser.value.id, payload)
      }
      notif.success('저장 완료', '사용자 정보가 수정되었습니다.')
    } else {
      await userApi.create({
        username: data.username,
        password: data.password,
        name: data.name,
        role: data.role || 'farm_admin',
        address: data.address,
        parentUserId: data.parentUserId,
      } as any)
      notif.success('생성 완료', `${data.name} 사용자가 추가되었습니다.`)
    }
    userModalOpen.value = false
    formUser.value = null
    await reload()
  } catch (e: any) {
    notif.error('저장 실패', e?.response?.data?.message || '저장에 실패했습니다.')
  }
}
async function removeUser(u: User) {
  const ok = await confirm({ title: '사용자 삭제', message: `${u.name}(@${u.username}) 사용자를 삭제하시겠습니까?`, confirmText: '삭제', variant: 'danger' })
  if (!ok) return
  try {
    await userApi.remove(u.id)
    notif.success('삭제 완료', `${u.name} 사용자가 삭제되었습니다.`)
    selectedId.value = null
    await reload()
  } catch (e: any) {
    notif.error('삭제 실패', e?.response?.data?.message || '삭제에 실패했습니다.')
  }
}

// ── 사용자 상세 내 게이트웨이 (B8) ──
const gwModalOpen = ref(false)
const gwEditing = ref<ConsoleGateway | null>(null)
function openGatewayNew() {
  gwEditing.value = null
  gwModalOpen.value = true
}
function openGatewayEdit(gw: ConsoleGateway) {
  gwEditing.value = gw
  gwModalOpen.value = true
}
async function onGatewaySaved() {
  gwModalOpen.value = false
  gwEditing.value = null
  await platform.load(true)
}
async function removeGateway(gw: ConsoleGateway) {
  const ok = await confirm({ title: '게이트웨이 삭제', message: `게이트웨이 "${gw.name}" (${gw.gatewayId})를 삭제하시겠습니까?`, confirmText: '삭제', variant: 'danger' })
  if (!ok) return
  try {
    await gatewayApi.remove(gw.id)
    notif.success('삭제 완료', '게이트웨이가 삭제되었습니다.')
    await platform.load(true)
  } catch (e: any) {
    notif.error('삭제 실패', e?.response?.data?.message || '게이트웨이 삭제에 실패했습니다.')
  }
}

async function reload() {
  await Promise.all([platform.load(true), loadCropMap()])
}

onMounted(async () => {
  await reload()
  const q = route.query.select
  selectedId.value = (typeof q === 'string' && platform.userById(q) ? q : null) ?? platform.users[0]?.id ?? null
  if (route.query.new === '1') {
    router.replace({ query: { ...route.query, new: undefined } })
    openNew()
  }
})
watch(() => route.query.select, (q) => {
  if (typeof q === 'string' && q !== selectedId.value && platform.userById(q)) selectedId.value = q
})
watch(() => platform.users, (list) => {
  if (selectedId.value && !list.some((u) => u.id === selectedId.value)) selectedId.value = list[0]?.id ?? null
})
</script>
