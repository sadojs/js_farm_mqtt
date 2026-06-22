<template>
  <div class="page-container">
    <header class="page-header">
      <div class="page-title">
        <h2>사용자 관리</h2>
        <p class="page-description">플랫폼 사용자와 농장 계정을 관리합니다</p>
      </div>
      <div class="header-actions">
        <button class="btn-ghost" @click="refreshAll" title="새로고침">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="23 4 23 10 17 10"/>
            <polyline points="1 20 1 14 7 14"/>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
          </svg>
          새로고침
        </button>
        <button class="btn-primary" @click="openNewUser">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"/>
            <line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          새 사용자 추가
        </button>
      </div>
    </header>

    <div v-if="loading" class="empty-state-card">
      <p>사용자 목록을 불러오는 중...</p>
    </div>

    <div v-else class="layout">
      <!-- ───────────────── 좌측: 사용자 트리 (마스터) ───────────────── -->
      <aside class="master-pane">
        <div class="search-box">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            v-model="searchQuery"
            type="text"
            placeholder="이름, 사용자명 검색..."
            class="search-input"
          />
        </div>

        <!-- 플랫폼 관리자 섹션 -->
        <div v-if="filteredAdmins.length" class="tree-section">
          <div class="section-title">플랫폼 관리자</div>
          <button
            v-for="u in filteredAdmins"
            :key="u.id"
            type="button"
            :class="['tree-row', { selected: selectedUserId === u.id, inactive: u.status !== 'active' }]"
            @click="selectedUserId = u.id"
          >
            <span class="row-avatar" :data-role="u.role">{{ initialOf(u.name) }}</span>
            <span class="row-text">
              <span class="row-name">{{ u.name }}</span>
              <span class="row-username">@{{ u.username }}</span>
            </span>
            <span v-if="u.status === 'active'" class="row-dot" aria-label="활성"></span>
          </button>
        </div>

        <!-- 농장 (관리자 + 소속 사용자 들여쓰기) -->
        <div v-if="filteredFarmAdmins.length" class="tree-section">
          <div class="section-title">농장</div>
          <template v-for="admin in filteredFarmAdmins" :key="admin.id">
            <button
              type="button"
              :class="['tree-row', { selected: selectedUserId === admin.id, inactive: admin.status !== 'active' }]"
              @click="selectedUserId = admin.id"
            >
              <span class="row-avatar" :data-role="admin.role">{{ initialOf(admin.name) }}</span>
              <span class="row-text">
                <span class="row-name">{{ admin.name }}</span>
                <span class="row-username">@{{ admin.username }}</span>
              </span>
              <span v-if="admin.status === 'active'" class="row-dot"></span>
            </button>
            <button
              v-for="child in childrenOf(admin.id)"
              :key="child.id"
              type="button"
              :class="['tree-row', 'nested', { selected: selectedUserId === child.id, inactive: child.status !== 'active' }]"
              @click="selectedUserId = child.id"
            >
              <span class="row-avatar small" :data-role="child.role">{{ initialOf(child.name) }}</span>
              <span class="row-text">
                <span class="row-name">{{ child.name }}</span>
                <span class="row-username">@{{ child.username }}</span>
              </span>
              <span v-if="child.status === 'active'" class="row-dot"></span>
            </button>
          </template>
        </div>

        <!-- 검색에 부모 없이 매치된 farm_user 도 표시 -->
        <div v-if="orphanFarmUsers.length" class="tree-section">
          <div class="section-title">기타 농장 사용자</div>
          <button
            v-for="u in orphanFarmUsers"
            :key="u.id"
            type="button"
            :class="['tree-row', { selected: selectedUserId === u.id, inactive: u.status !== 'active' }]"
            @click="selectedUserId = u.id"
          >
            <span class="row-avatar" :data-role="u.role">{{ initialOf(u.name) }}</span>
            <span class="row-text">
              <span class="row-name">{{ u.name }}</span>
              <span class="row-username">@{{ u.username }}</span>
            </span>
            <span v-if="u.status === 'active'" class="row-dot"></span>
          </button>
        </div>

        <div v-if="filteredAdmins.length === 0 && filteredFarmAdmins.length === 0 && orphanFarmUsers.length === 0" class="empty-tree">
          검색 결과가 없습니다
        </div>
      </aside>

      <!-- ───────────────── 우측: 상세 (디테일) ───────────────── -->
      <section class="detail-pane">
        <template v-if="selectedUser">
          <header class="detail-header">
            <div class="detail-identity">
              <div class="detail-avatar" :data-role="selectedUser.role">{{ initialOf(selectedUser.name) }}</div>
              <div class="detail-name-block">
                <div class="detail-name-row">
                  <h3>{{ selectedUser.name }}</h3>
                  <span :class="['role-badge', selectedUser.role]">{{ roleLabel(selectedUser.role) }}</span>
                  <span :class="['status-pill', selectedUser.status]">
                    <span class="status-pill-dot"></span>
                    {{ selectedUser.status === 'active' ? '활성' : '비활성' }}
                  </span>
                </div>
                <div class="detail-meta">
                  <span>@{{ selectedUser.username }}</span>
                  <span class="dot-sep">·</span>
                  <span>가입 {{ formatDate(selectedUser.createdAt) }}</span>
                </div>
              </div>
            </div>
            <div class="detail-actions">
              <button class="btn-ghost" @click="editUser(selectedUser)" title="편집">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
                편집
              </button>
              <button class="btn-ghost" @click="editUser(selectedUser)" title="비밀번호 재설정">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                  <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                </svg>
                비밀번호 재설정
              </button>
              <button class="btn-ghost danger" @click="deleteUser(selectedUser)" title="삭제">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/>
                  <path d="M10 11v6M14 11v6"/>
                  <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/>
                </svg>
                삭제
              </button>
            </div>
          </header>

          <!-- 프로필 -->
          <div class="detail-section">
            <h4 class="section-heading">프로필</h4>
            <div class="profile-grid">
              <div class="profile-field">
                <span class="field-label">이름</span>
                <span class="field-value">{{ selectedUser.name }}</span>
              </div>
              <div class="profile-field">
                <span class="field-label">역할</span>
                <span class="field-value">{{ roleLabel(selectedUser.role) }}</span>
              </div>
              <div class="profile-field">
                <span class="field-label">사용자명</span>
                <span class="field-value">@{{ selectedUser.username }}</span>
              </div>
              <div class="profile-field">
                <span class="field-label">주소</span>
                <span class="field-value">{{ selectedUser.address || '—' }}</span>
              </div>
              <div v-if="selectedUser.parentUserName" class="profile-field">
                <span class="field-label">소속 농장</span>
                <span class="field-value">{{ selectedUser.parentUserName }}</span>
              </div>
            </div>
          </div>

          <!-- 기능 권한 -->
          <div class="detail-section">
            <h4 class="section-heading">기능 권한</h4>
            <div v-if="selectedUser.role === 'admin'" class="info-note">
              플랫폼 관리자는 모든 기능에 접근할 수 있습니다.
            </div>
            <div v-else-if="selectedUser.role === 'farm_user'" class="info-note">
              소속 농장({{ selectedUser.parentUserName || '미지정' }}) 관리자의 설정을 상속합니다.
            </div>
            <div v-else class="feature-card">
              <div class="feature-info">
                <span class="feature-icon" aria-hidden="true">🌱</span>
                <div class="feature-text">
                  <span class="feature-title">생육관리</span>
                  <span class="feature-desc">GDD 생육 추적 모듈</span>
                </div>
              </div>
              <button
                type="button"
                class="toggle-btn"
                :class="{ on: cropFeatureMap[selectedUser.id] !== false }"
                @click="toggleUserCropFeature(selectedUser)"
                :aria-pressed="cropFeatureMap[selectedUser.id] !== false"
                :title="cropFeatureMap[selectedUser.id] !== false ? '끄기' : '켜기'"
              >
                <span class="toggle-knob" />
              </button>
            </div>
          </div>

          <!-- 소속 농장 사용자 (farm_admin) -->
          <div v-if="selectedUser.role === 'farm_admin'" class="detail-section">
            <div class="section-heading-row">
              <h4 class="section-heading">소속 농장 사용자 ({{ childrenOfSelected.length }})</h4>
              <button class="btn-ghost small" @click="openNewUserUnder(selectedUser)">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19"/>
                  <line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
                추가
              </button>
            </div>
            <div v-if="childrenOfSelected.length === 0" class="empty-row">
              소속된 농장 사용자가 없습니다.
            </div>
            <div v-else class="child-grid">
              <div
                v-for="child in childrenOfSelected"
                :key="child.id"
                class="child-card"
                @click="selectedUserId = child.id"
              >
                <div class="child-avatar" :data-role="child.role">{{ initialOf(child.name) }}</div>
                <div class="child-body">
                  <div class="child-name">{{ child.name }}</div>
                  <div class="child-username">@{{ child.username }}</div>
                </div>
                <span :class="['status-pill', child.status, 'compact']">
                  <span class="status-pill-dot"></span>
                  {{ child.status === 'active' ? '활성' : '비활성' }}
                </span>
              </div>
            </div>
          </div>

          <!-- 게이트웨이 -->
          <div v-if="selectedUser.role !== 'farm_user'" class="detail-section">
            <div class="section-heading-row">
              <h4 class="section-heading">게이트웨이 ({{ userGateways.length }})</h4>
              <button class="btn-ghost small" @click="openNewGatewayForSelected">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19"/>
                  <line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
                추가
              </button>
            </div>
            <div v-if="userGateways.length === 0" class="empty-row">
              등록된 게이트웨이가 없습니다.
            </div>
            <ul v-else class="gateway-list">
              <li v-for="gw in userGateways" :key="gw.id" class="gateway-row">
                <span :class="['gw-status-dot', gatewayAgentClass(gw)]"></span>
                <div class="gw-body">
                  <code class="gw-id">{{ gw.gatewayId }}</code>
                  <span class="gw-name">{{ gw.name }}</span>
                  <span v-if="gw.location" class="gw-location">{{ gw.location }}</span>
                </div>
                <span :class="['status-pill', 'compact', gatewayAgentClass(gw) === 'online' ? 'active' : 'inactive']">
                  <span class="status-pill-dot"></span>
                  {{ gatewayAgentClass(gw) === 'online' ? '온라인' : '오프라인' }}
                </span>
                <span v-if="gw.lastSeen" class="gw-last-seen">최근 {{ formatLastSeen(gw.lastSeen) }}</span>
                <div class="gw-actions">
                  <button class="btn-icon" title="편집" @click="editGateway(gw)">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                  </button>
                  <button class="btn-icon danger" title="삭제" @click="deleteGateway(gw)">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="3 6 5 6 21 6"/>
                      <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/>
                    </svg>
                  </button>
                </div>
              </li>
            </ul>
          </div>
        </template>

        <div v-else class="detail-empty">
          <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
            <circle cx="12" cy="7" r="4"/>
          </svg>
          <p>좌측에서 사용자를 선택하세요</p>
        </div>
      </section>
    </div>

    <!-- 게이트웨이 등록/수정 모달 (보존) -->
    <div v-if="showGatewayModal" class="modal-overlay" @click.self="showGatewayModal = false">
      <div class="modal-card">
        <div class="modal-header">
          <h3>{{ editingGateway ? '게이트웨이 수정' : '게이트웨이 등록' }}</h3>
          <button class="modal-close" @click="showGatewayModal = false" aria-label="닫기">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>게이트웨이 ID *</label>
            <input v-model="gwForm.gatewayId" type="text" placeholder="예: farm01" class="form-input" :disabled="!!editingGateway" />
            <p class="help-text">라즈베리파이 setup.sh에서 입력할 값과 동일하게 설정하세요</p>
          </div>
          <div class="form-group">
            <label>이름 *</label>
            <input v-model="gwForm.name" type="text" placeholder="예: 석문리 하우스" class="form-input" />
          </div>
          <div class="form-group">
            <label>소유자 *</label>
            <select v-model="gwForm.userId" class="form-input">
              <option value="" disabled>소유자를 선택하세요</option>
              <option v-for="user in farmAdminUsers" :key="user.id" :value="user.id">
                {{ user.name }} ({{ user.username }})
              </option>
            </select>
          </div>
          <div class="form-group">
            <label>위치</label>
            <input v-model="gwForm.location" type="text" placeholder="예: 경기도 화성시..." class="form-input" />
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-secondary" @click="showGatewayModal = false">취소</button>
          <button class="btn-primary" @click="saveGateway" :disabled="!gwForm.gatewayId || !gwForm.name || !gwForm.userId">
            {{ editingGateway ? '수정' : '등록' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 사용자 추가/수정 모달 -->
    <UserFormModal
      :show="showUserModal"
      :user="selectedUserForForm"
      @close="closeUserModal"
      @save="saveUser"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import UserFormModal from '@/components/admin/UserFormModal.vue'
import { userApi } from '../api/user.api'
import { gatewayApi } from '../api/gateway.api'
import { useAuthStore } from '../stores/auth.store'
import apiClient from '../api/client'

const cropFeatureMap = ref<Record<string, boolean>>({})

async function fetchCropFeatureMap(): Promise<Record<string, boolean>> {
  try {
    const { data } = await apiClient.get<Record<string, boolean>>('/crop-management/feature/all')
    return data
  } catch {
    return {}
  }
}

async function toggleUserCropFeature(user: { id: string }) {
  const current = cropFeatureMap.value[user.id] !== false
  const next = !current
  try {
    await apiClient.patch(`/crop-management/feature/users/${user.id}`, { enabled: next })
    cropFeatureMap.value = { ...cropFeatureMap.value, [user.id]: next }
  } catch (err) {
    console.error('생육관리 설정 변경 실패:', err)
  }
}

interface User {
  id: string
  name: string
  username: string
  role: 'admin' | 'farm_admin' | 'farm_user'
  parentUserId?: string
  parentUserName?: string
  address?: string
  gateways?: any[]
  createdAt: string
  status: 'active' | 'inactive'
}

function roleLabel(role: string): string {
  switch (role) {
    case 'admin': return '플랫폼 관리자'
    case 'farm_admin': return '농장 관리자'
    case 'farm_user': return '농장 사용자'
    default: return role
  }
}

const authStore = useAuthStore()
const users = ref<User[]>([])
const loading = ref(false)

const showUserModal = ref(false)
// UserFormModal 에 넘기는 user — 편집 시 복제본 또는 신규 시 null/parent 초기값.
// 좌측 트리 선택과 분리하기 위해 별도 ref 사용.
const selectedUserForForm = ref<User | null>(null)

// 좌측 트리에서 선택된 사용자 (표시용)
const selectedUserId = ref<string | null>(null)

// 검색
const searchQuery = ref('')

// 게이트웨이 관리 — 기능 보존
const gatewayList = ref<any[]>([])
const showGatewayModal = ref(false)
const editingGateway = ref<any>(null)
const gwForm = ref({ gatewayId: '', name: '', userId: '', location: '' })

const farmAdminUsers = computed(() =>
  users.value.filter(u => u.role === 'admin' || u.role === 'farm_admin')
)

async function fetchUsers() {
  loading.value = true
  try {
    const [{ data }, featureMap] = await Promise.all([
      userApi.getAll(),
      fetchCropFeatureMap(),
    ])
    users.value = data as any
    cropFeatureMap.value = featureMap
  } catch (err) {
    console.error('사용자 목록 조회 실패:', err)
  } finally {
    loading.value = false
  }
}

async function fetchGateways() {
  try {
    const { data } = await gatewayApi.getAll()
    gatewayList.value = data as any[]
  } catch {
    gatewayList.value = []
  }
}

function formatLastSeen(lastSeen: string | null): string {
  if (!lastSeen) return '-'
  const diff = Date.now() - new Date(lastSeen).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return '방금 전'
  if (min < 60) return `${min}분 전`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour}시간 전`
  return `${Math.floor(hour / 24)}일 전`
}

function formatDate(raw: string | null | undefined): string {
  if (!raw) return '-'
  const d = new Date(raw)
  if (isNaN(d.getTime())) return raw
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 모든 데이터 새로고침 */
async function refreshAll() {
  await Promise.all([fetchUsers(), fetchGateways()])
}

function getUserName(userId: string): string {
  const user = users.value.find(u => u.id === userId)
  return user ? user.name : userId
}

function openNewGatewayModal() {
  editingGateway.value = null
  gwForm.value = { gatewayId: '', name: '', userId: '', location: '' }
  showGatewayModal.value = true
}

function openNewGatewayForSelected() {
  editingGateway.value = null
  gwForm.value = {
    gatewayId: '',
    name: '',
    userId: selectedUser.value?.id || '',
    location: '',
  }
  showGatewayModal.value = true
}

function editGateway(gw: any) {
  editingGateway.value = gw
  gwForm.value = {
    gatewayId: gw.gatewayId,
    name: gw.name,
    userId: gw.userId,
    location: gw.location || '',
  }
  showGatewayModal.value = true
}

async function saveGateway() {
  try {
    if (editingGateway.value) {
      await gatewayApi.update(editingGateway.value.id, {
        name: gwForm.value.name,
        location: gwForm.value.location || undefined,
        userId: gwForm.value.userId,
      })
    } else {
      await gatewayApi.create({
        gatewayId: gwForm.value.gatewayId,
        name: gwForm.value.name,
        location: gwForm.value.location || undefined,
        userId: gwForm.value.userId,
      })
    }
    showGatewayModal.value = false
    editingGateway.value = null
    gwForm.value = { gatewayId: '', name: '', userId: '', location: '' }
    await refreshAll()
  } catch (err: any) {
    alert(err.response?.data?.message || '게이트웨이 저장에 실패했습니다.')
  }
}

async function deleteGateway(gw: any) {
  if (!confirm(`게이트웨이 "${gw.name}" (${gw.gatewayId})를 삭제하시겠습니까?`)) return
  try {
    await gatewayApi.remove(gw.id)
    await refreshAll()
  } catch {
    alert('게이트웨이 삭제에 실패했습니다.')
  }
}

onMounted(async () => {
  await refreshAll()
  // 첫 사용자 자동 선택 (있으면)
  if (!selectedUserId.value && users.value.length > 0) {
    selectedUserId.value = users.value[0].id
  }
})

// 사용자 목록이 갱신될 때 선택이 사라지면 첫 사용자로 복구
watch(users, (list) => {
  if (selectedUserId.value && !list.some(u => u.id === selectedUserId.value)) {
    selectedUserId.value = list[0]?.id ?? null
  }
})

const editUser = (user: User) => {
  selectedUserForForm.value = { ...user }
  showUserModal.value = true
}

function openNewUser() {
  selectedUserForForm.value = null
  showUserModal.value = true
}

function openNewUserUnder(_parent: User) {
  // UserFormModal 은 prop.user 가 falsy 일 때 "추가" 타이틀을 보이므로 null 로 호출한다.
  // 부모 선택은 모달 내 select 에서 지정 (UserFormModal 내부 변경 없이 동작 유지).
  openNewUser()
}

const deleteUser = async (user: User) => {
  if (!confirm(`${user.name} 사용자를 삭제하시겠습니까?`)) return
  try {
    await userApi.remove(user.id)
    users.value = users.value.filter(u => u.id !== user.id)
  } catch (err) {
    console.error('삭제 실패:', err)
    alert('삭제에 실패했습니다.')
  }
}

const closeUserModal = () => {
  showUserModal.value = false
  selectedUserForForm.value = null
}

const saveUser = async (userData: any) => {
  try {
    if (selectedUserForForm.value && selectedUserForForm.value.id) {
      const payload: any = { name: userData.name, address: userData.address }
      if (userData.role) payload.role = userData.role
      if (userData.status) payload.status = userData.status
      if (userData.password) payload.password = userData.password
      if (userData.parentUserId !== undefined) payload.parentUserId = userData.parentUserId || null

      // 자기 자신이면 /users/me, 아니면 관리자 경로
      if (selectedUserForForm.value.id === authStore.user?.id) {
        await userApi.updateMe(payload)
        await authStore.fetchUser()
      } else {
        await userApi.update(selectedUserForForm.value.id, payload)
      }

      await refreshAll()
    } else {
      // 신규 추가
      await userApi.create({
        username: userData.username,
        password: userData.password,
        name: userData.name,
        role: userData.role || 'farm_admin',
        address: userData.address,
        parentUserId: userData.parentUserId,
      })

      await refreshAll()
    }
    closeUserModal()
  } catch (err: any) {
    console.error('저장 실패:', err)
    alert(err.response?.data?.message || '저장에 실패했습니다.')
  }
}

// ───────── 트리/디테일 helpers ─────────

const selectedUser = computed<User | null>(() => {
  if (!selectedUserId.value) return null
  return users.value.find(u => u.id === selectedUserId.value) ?? null
})

const childrenOfSelected = computed<User[]>(() => {
  if (!selectedUser.value) return []
  return users.value.filter(u => u.parentUserId === selectedUser.value!.id)
})

const userGateways = computed<any[]>(() => {
  if (!selectedUser.value) return []
  // 1순위: user.gateways (백엔드가 임베드한 목록)
  // 2순위: 전체 gatewayList 에서 userId 매칭 — user.gateways 비어있을 때 폴백
  const embedded = selectedUser.value.gateways ?? []
  if (embedded.length > 0) return embedded
  return gatewayList.value.filter(gw => gw.userId === selectedUser.value!.id)
})

function gatewayAgentClass(gw: any): 'online' | 'offline' {
  return gw.agentStatus === 'online' || gw.status === 'online' ? 'online' : 'offline'
}

function initialOf(name: string): string {
  if (!name) return '?'
  return name.charAt(0).toUpperCase()
}

function childrenOf(parentId: string): User[] {
  return users.value.filter(u => u.parentUserId === parentId)
}

function matchesSearch(u: User): boolean {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return true
  return u.name.toLowerCase().includes(q) || u.username.toLowerCase().includes(q)
}

const filteredAdmins = computed(() =>
  users.value.filter(u => u.role === 'admin' && matchesSearch(u))
)

const filteredFarmAdmins = computed(() => {
  // 검색어가 있으면: farm_admin 본인 매치 OR 소속 farm_user 매치 시 노출
  const q = searchQuery.value.trim().toLowerCase()
  const admins = users.value.filter(u => u.role === 'farm_admin')
  if (!q) return admins
  return admins.filter(adm => {
    if (matchesSearch(adm)) return true
    return users.value.some(c => c.parentUserId === adm.id && matchesSearch(c))
  })
})

// 검색 시 부모(farm_admin) 가 매치 안 됐지만 farm_user 만 매치된 케이스도
// 좌측에서 사라지지 않도록 별도 섹션으로 노출.
const orphanFarmUsers = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return []
  const adminIds = new Set(filteredFarmAdmins.value.map(a => a.id))
  return users.value.filter(u =>
    u.role === 'farm_user'
    && matchesSearch(u)
    && (!u.parentUserId || !adminIds.has(u.parentUserId)),
  )
})

// 안 쓰이는 헬퍼지만 외부 컴포넌트가 참조할 수 있어 보존 (게이트웨이 페이지 등)
void getUserName
void openNewGatewayModal
</script>

<style scoped>
.page-container {
  padding: 24px;
  max-width: 1400px;
  margin: 0 auto;
}

.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 24px;
  flex-wrap: wrap;
}
.page-title h2 {
  font-size: calc(28px * var(--content-scale, 1));
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
}
.page-description {
  color: var(--text-secondary);
  font-size: calc(14px * var(--content-scale, 1));
  margin: 4px 0 0;
}
.header-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

/* ────────── 버튼 ────────── */
.btn-primary,
.btn-secondary,
.btn-ghost {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 9px 16px;
  border-radius: 10px;
  font-size: calc(14px * var(--content-scale, 1));
  font-weight: 600;
  border: 1px solid transparent;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.btn-primary {
  background: var(--accent);
  color: #fff;
}
.btn-primary:hover:not(:disabled) { background: var(--accent-hover); }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

.btn-secondary {
  background: var(--bg-hover);
  color: var(--text-primary);
  border-color: var(--border-color);
}
.btn-secondary:hover { background: var(--border-light); }

.btn-ghost {
  background: transparent;
  color: var(--text-primary);
  border-color: var(--border-color);
}
.btn-ghost:hover { background: var(--bg-hover); }
.btn-ghost.danger { color: #b71c1c; border-color: rgba(244, 67, 54, 0.4); }
.btn-ghost.danger:hover { background: rgba(244, 67, 54, 0.08); }
.btn-ghost.small {
  padding: 5px 10px;
  font-size: calc(12px * var(--content-scale, 1));
  gap: 4px;
}

.btn-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 7px;
  background: transparent;
  color: var(--text-muted);
  border: 1px solid var(--border-light);
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.btn-icon:hover { background: var(--bg-hover); color: var(--text-primary); }
.btn-icon.danger:hover { background: rgba(244, 67, 54, 0.1); color: #c62828; border-color: rgba(244, 67, 54, 0.3); }

/* ────────── 레이아웃 ────────── */
.layout {
  display: grid;
  grid-template-columns: 312px 1fr;
  gap: 16px;
  align-items: start;
}

.empty-state-card {
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: 12px;
  padding: 48px 20px;
  text-align: center;
  color: var(--text-secondary);
  box-shadow: var(--shadow-card);
}

/* ────────── 좌측 마스터 ────────── */
.master-pane {
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: 14px;
  box-shadow: var(--shadow-card);
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  position: sticky;
  top: 16px;
  max-height: calc(100vh - 64px);
  overflow-y: auto;
}

.search-box {
  position: relative;
  display: flex;
  align-items: center;
  background: var(--bg-secondary, var(--bg-hover));
  border: 1px solid var(--border-light);
  border-radius: 10px;
  padding: 0 10px;
  gap: 8px;
  color: var(--text-muted);
}
.search-box:focus-within {
  border-color: var(--accent);
}
.search-input {
  flex: 1;
  border: none;
  background: transparent;
  padding: 9px 0;
  font-size: calc(13px * var(--content-scale, 1));
  color: var(--text-primary);
  outline: none;
}
.search-input::placeholder { color: var(--text-muted); }

.tree-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.section-title {
  padding: 6px 10px;
  font-size: calc(11px * var(--content-scale, 1));
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  background: var(--bg-secondary, var(--bg-hover));
  border-radius: 8px;
  margin-bottom: 2px;
}
.empty-tree {
  padding: 24px 8px;
  text-align: center;
  color: var(--text-muted);
  font-size: calc(13px * var(--content-scale, 1));
}

.tree-row {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  background: transparent;
  border: none;
  border-radius: 9px;
  cursor: pointer;
  text-align: left;
  width: 100%;
  position: relative;
  transition: background 0.15s;
}
.tree-row:hover { background: var(--bg-hover); }
.tree-row.selected {
  background: var(--accent-bg);
}
.tree-row.selected::before {
  content: '';
  position: absolute;
  left: 0;
  top: 6px;
  bottom: 6px;
  width: 3px;
  border-radius: 2px;
  background: var(--accent);
}
.tree-row.nested {
  padding-left: 32px;
}
.tree-row.inactive { opacity: 0.65; }

.row-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  color: #fff;
  font-size: 13px;
  background: linear-gradient(135deg, #667eea, #764ba2);
  flex-shrink: 0;
}
.row-avatar.small { width: 28px; height: 28px; font-size: 12px; }
.row-avatar[data-role="admin"] { background: linear-gradient(135deg, #4a90e2, #2563eb); }
.row-avatar[data-role="farm_admin"] { background: linear-gradient(135deg, #667eea, #764ba2); }
.row-avatar[data-role="farm_user"] { background: linear-gradient(135deg, #a18cd1, #fbc2eb); }

.row-text {
  display: flex;
  flex-direction: column;
  gap: 0;
  min-width: 0;
}
.row-name {
  font-size: calc(14px * var(--content-scale, 1));
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.row-username {
  font-size: calc(11px * var(--content-scale, 1));
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.row-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #4caf50;
}

/* ────────── 우측 디테일 ────────── */
.detail-pane {
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: 14px;
  box-shadow: var(--shadow-card);
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 24px;
  min-height: 480px;
}

.detail-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  gap: 12px;
}
.detail-empty p { margin: 0; font-size: calc(14px * var(--content-scale, 1)); }

.detail-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.detail-identity {
  display: flex;
  align-items: center;
  gap: 14px;
}
.detail-avatar {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #667eea, #764ba2);
  color: #fff;
  font-weight: 700;
  font-size: 20px;
  flex-shrink: 0;
}
.detail-avatar[data-role="admin"] { background: linear-gradient(135deg, #4a90e2, #2563eb); }
.detail-avatar[data-role="farm_admin"] { background: linear-gradient(135deg, #667eea, #764ba2); }
.detail-avatar[data-role="farm_user"] { background: linear-gradient(135deg, #a18cd1, #fbc2eb); }

.detail-name-block { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.detail-name-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.detail-name-row h3 {
  margin: 0;
  font-size: calc(22px * var(--content-scale, 1));
  font-weight: 700;
  color: var(--text-primary);
}
.detail-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-muted);
  font-size: calc(13px * var(--content-scale, 1));
  flex-wrap: wrap;
}
.dot-sep { opacity: 0.5; }

.role-badge {
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: calc(11px * var(--content-scale, 1));
  font-weight: 700;
  border: 1px solid transparent;
}
.role-badge.admin {
  background: rgba(33, 150, 243, 0.12);
  color: #1565c0;
  border-color: rgba(33, 150, 243, 0.3);
}
.role-badge.farm_admin {
  background: rgba(255, 152, 0, 0.12);
  color: #b45309;
  border-color: rgba(255, 152, 0, 0.3);
}
.role-badge.farm_user {
  background: rgba(76, 175, 80, 0.12);
  color: #2e7d32;
  border-color: rgba(76, 175, 80, 0.3);
}

.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: calc(11px * var(--content-scale, 1));
  font-weight: 600;
  border: 1px solid transparent;
}
.status-pill .status-pill-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}
.status-pill.active {
  color: #2e7d32;
  background: rgba(76, 175, 80, 0.12);
  border-color: rgba(76, 175, 80, 0.3);
}
.status-pill.inactive {
  color: var(--text-muted);
  background: var(--bg-badge);
  border-color: var(--border-light);
}
.status-pill.compact {
  padding: 2px 8px;
  font-size: calc(10px * var(--content-scale, 1));
}

.detail-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

/* 섹션 */
.detail-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.section-heading {
  margin: 0;
  font-size: calc(13px * var(--content-scale, 1));
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.section-heading-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.info-note {
  padding: 14px 16px;
  background: var(--bg-secondary, var(--bg-hover));
  border: 1px solid var(--border-light);
  border-radius: 10px;
  color: var(--text-secondary);
  font-size: calc(13px * var(--content-scale, 1));
}

/* 프로필 그리드 */
.profile-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}
.profile-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px;
  background: var(--bg-secondary, var(--bg-hover));
  border: 1px solid var(--border-light);
  border-radius: 10px;
}
.field-label {
  font-size: calc(11px * var(--content-scale, 1));
  font-weight: 600;
  color: var(--text-muted);
}
.field-value {
  font-size: calc(14px * var(--content-scale, 1));
  font-weight: 600;
  color: var(--text-primary);
  word-break: break-word;
}

/* 기능 카드 */
.feature-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  background: var(--bg-secondary, var(--bg-hover));
  border: 1px solid var(--border-light);
  border-radius: 10px;
  gap: 12px;
}
.feature-info { display: flex; align-items: center; gap: 12px; min-width: 0; }
.feature-icon {
  font-size: 20px;
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(76, 175, 80, 0.15);
  border-radius: 8px;
  flex-shrink: 0;
}
.feature-text { display: flex; flex-direction: column; gap: 1px; }
.feature-title {
  font-size: calc(14px * var(--content-scale, 1));
  font-weight: 700;
  color: var(--text-primary);
}
.feature-desc {
  font-size: calc(12px * var(--content-scale, 1));
  color: var(--text-muted);
}

.toggle-btn {
  position: relative;
  width: 44px;
  height: 24px;
  border-radius: 999px;
  background: var(--border-color);
  border: none;
  cursor: pointer;
  transition: background 0.2s;
  flex-shrink: 0;
}
.toggle-btn.on { background: var(--accent); }
.toggle-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  transition: transform 0.2s;
}
.toggle-btn.on .toggle-knob { transform: translateX(20px); }

/* 소속 사용자 카드 */
.child-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}
.child-card {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  background: var(--bg-secondary, var(--bg-hover));
  border: 1px solid var(--border-light);
  border-radius: 10px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.child-card:hover {
  background: var(--bg-hover);
  border-color: var(--accent);
}
.child-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #a18cd1, #fbc2eb);
  color: #fff;
  font-weight: 700;
  font-size: 13px;
  flex-shrink: 0;
}
.child-body { display: flex; flex-direction: column; min-width: 0; }
.child-name {
  font-size: calc(14px * var(--content-scale, 1));
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.child-username {
  font-size: calc(11px * var(--content-scale, 1));
  color: var(--text-muted);
}

.empty-row {
  padding: 18px;
  text-align: center;
  color: var(--text-muted);
  font-size: calc(13px * var(--content-scale, 1));
  background: var(--bg-secondary, var(--bg-hover));
  border: 1px dashed var(--border-color);
  border-radius: 10px;
}

/* 게이트웨이 */
.gateway-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.gateway-row {
  display: grid;
  grid-template-columns: auto 1fr auto auto auto;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: var(--bg-secondary, var(--bg-hover));
  border: 1px solid var(--border-light);
  border-radius: 10px;
}
.gw-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.gw-status-dot.online { background: #4caf50; }
.gw-status-dot.offline { background: #9e9e9e; }

.gw-body { display: flex; align-items: baseline; gap: 8px; min-width: 0; flex-wrap: wrap; }
.gw-id {
  font-family: 'JetBrains Mono', 'Menlo', monospace;
  font-size: calc(13px * var(--content-scale, 1));
  font-weight: 700;
  color: var(--text-primary);
}
.gw-name {
  font-size: calc(13px * var(--content-scale, 1));
  color: var(--text-secondary);
}
.gw-location {
  font-size: calc(11px * var(--content-scale, 1));
  color: var(--text-muted);
}
.gw-last-seen {
  font-size: calc(11px * var(--content-scale, 1));
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}
.gw-actions { display: flex; gap: 4px; }

/* ────────── 게이트웨이 모달 ────────── */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 20px;
}
.modal-card {
  background: var(--bg-card);
  border-radius: 14px;
  max-width: 500px;
  width: 100%;
  display: flex;
  flex-direction: column;
  max-height: 90vh;
  border: 1px solid var(--border-card);
}
.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 18px 22px;
  border-bottom: 1px solid var(--border-light);
}
.modal-header h3 { margin: 0; font-size: 18px; color: var(--text-primary); }
.modal-close {
  background: none;
  border: none;
  font-size: 24px;
  cursor: pointer;
  color: var(--text-muted);
  line-height: 1;
}
.modal-body {
  padding: 20px 22px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.form-group { display: flex; flex-direction: column; gap: 6px; }
.form-group label { font-size: 13px; font-weight: 600; color: var(--text-secondary); }
.form-input {
  padding: 10px 12px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-secondary, var(--bg-card));
  color: var(--text-primary);
  font-size: 14px;
}
.form-input:focus { outline: none; border-color: var(--accent); }
.help-text { font-size: 12px; color: var(--text-muted); margin: 0; }
.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 16px 22px;
  border-top: 1px solid var(--border-light);
}

/* ────────── 반응형 ────────── */
@media (max-width: 1024px) {
  .layout {
    grid-template-columns: 1fr;
  }
  .master-pane {
    position: static;
    max-height: 420px;
  }
}

@media (max-width: 768px) {
  .page-container { padding: 4px 0; }
  .detail-pane { padding: 18px; }
  .profile-grid { grid-template-columns: 1fr; }
  .child-grid { grid-template-columns: 1fr; }
  .gateway-row {
    grid-template-columns: auto 1fr auto;
    grid-template-areas:
      "dot body actions"
      ". status seen";
  }
  .gw-status-dot { grid-area: dot; }
  .gw-body { grid-area: body; }
  .gw-actions { grid-area: actions; }
  .gw-last-seen { grid-area: seen; text-align: right; }
}
</style>
