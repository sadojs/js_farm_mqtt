<template>
  <div class="page-container">
    <header class="page-header">
      <h2>👥 사용자 관리</h2>
      <p class="page-description">사용자 계정을 생성하고 게이트웨이를 관리하세요</p>
      <button class="btn-primary" @click="showUserModal = true">
        + 새 사용자 추가
      </button>
    </header>

    <!-- 사용자 목록 -->
    <div v-if="loading" class="empty-state"><p>사용자 목록을 불러오는 중...</p></div>
    <div v-else class="users-table-container">
      <table class="users-table">
        <thead>
          <tr>
            <th>이름</th>
            <th>이메일</th>
            <th>역할</th>
            <th>주소</th>
            <th>게이트웨이</th>
            <th>등록일</th>
            <th>상태</th>
            <th>작업</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="user in users" :key="user.id">
            <td>
              <div class="user-name">
                <div class="user-avatar">{{ user.name.charAt(0) }}</div>
                <span>{{ user.name }}</span>
              </div>
            </td>
            <td>{{ user.email }}</td>
            <td>
              <span class="role-badge" :class="user.role">
                {{ roleLabel(user.role) }}
              </span>
              <span v-if="user.parentUserName" class="parent-badge">
                {{ user.parentUserName }}
              </span>
            </td>
            <td>
              <span class="address-text">{{ user.address || '-' }}</span>
            </td>
            <td>
              <span v-if="user.gateways?.length" class="project-badge">
                {{ user.gateways.length }}개 게이트웨이
              </span>
              <span v-else class="text-muted">미등록</span>
            </td>
            <td>{{ user.createdAt }}</td>
            <td>
              <span class="status-badge" :class="user.status">
                {{ user.status === 'active' ? '활성' : '비활성' }}
              </span>
            </td>
            <td>
              <div class="action-buttons">
                <button
                  class="btn-icon"
                  title="편집"
                  @click="editUser(user)"
                >
                  ✏️
                </button>
                <button
                  class="btn-icon danger"
                  title="삭제"
                  @click="deleteUser(user)"
                >
                  🗑️
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      <div v-if="users.length === 0" class="empty-state">
        <p>등록된 사용자가 없습니다</p>
      </div>
    </div>

    <!-- 게이트웨이 관리 섹션 -->
    <header class="page-header" style="margin-top: 40px;">
      <h2>📡 게이트웨이 관리</h2>
      <p class="page-description">라즈베리파이 Zigbee 게이트웨이를 등록하고 관리하세요</p>
      <button class="btn-primary" @click="showGatewayModal = true">
        + 게이트웨이 등록
      </button>
    </header>

    <div class="users-table-container">
      <table class="users-table">
        <thead>
          <tr>
            <th>게이트웨이 ID</th>
            <th>이름</th>
            <th>소유자</th>
            <th>위치</th>
            <th>라즈베리파이 IP</th>
            <th>상태</th>
            <th>작업</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="gw in gatewayList" :key="gw.id">
            <td><code class="gateway-id">{{ gw.gatewayId }}</code></td>
            <td>{{ gw.name }}</td>
            <td>{{ getUserName(gw.userId) }}</td>
            <td>{{ gw.location || '-' }}</td>
            <td>{{ gw.rpiIp || '-' }}</td>
            <td>
              <span class="status-badge" :class="gw.status === 'online' ? 'active' : 'inactive'">
                {{ gw.status === 'online' ? '🟢 온라인' : '🔴 오프라인' }}
              </span>
            </td>
            <td>
              <div class="action-buttons">
                <button class="btn-icon" title="편집" @click="editGateway(gw)">✏️</button>
                <button class="btn-icon danger" title="삭제" @click="deleteGateway(gw)">🗑️</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="gatewayList.length === 0" class="empty-state">
        <p>등록된 게이트웨이가 없습니다. 라즈베리파이 setup.sh 실행 전에 먼저 등록하세요.</p>
      </div>
    </div>

    <!-- 게이트웨이 등록/수정 모달 -->
    <div v-if="showGatewayModal" class="modal-overlay" @click.self="showGatewayModal = false">
      <div class="modal-card">
        <div class="modal-header">
          <h3>{{ editingGateway ? '게이트웨이 수정' : '게이트웨이 등록' }}</h3>
          <button class="modal-close" @click="showGatewayModal = false">&times;</button>
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
                {{ user.name }} ({{ user.email }})
              </option>
            </select>
          </div>
          <div class="form-group">
            <label>위치</label>
            <input v-model="gwForm.location" type="text" placeholder="예: 경기도 화성시..." class="form-input" />
          </div>
          <div class="form-group">
            <label>라즈베리파이 IP</label>
            <input v-model="gwForm.rpiIp" type="text" placeholder="예: 192.168.0.50" class="form-input" />
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
      :user="selectedUser"
      @close="closeUserModal"
      @save="saveUser"
    />

  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import UserFormModal from '@/components/admin/UserFormModal.vue'
import { userApi } from '../api/user.api'
import { gatewayApi } from '../api/gateway.api'
import { useAuthStore } from '../stores/auth.store'

interface User {
  id: string
  name: string
  email: string
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
const selectedUser = ref<User | null>(null)

// 게이트웨이 관리
const gatewayList = ref<any[]>([])
const showGatewayModal = ref(false)
const editingGateway = ref<any>(null)
const gwForm = ref({ gatewayId: '', name: '', userId: '', location: '', rpiIp: '' })

const farmAdminUsers = computed(() =>
  users.value.filter(u => u.role === 'admin' || u.role === 'farm_admin')
)

async function fetchUsers() {
  loading.value = true
  try {
    const { data } = await userApi.getAll()
    users.value = data as any
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

function getUserName(userId: string): string {
  const user = users.value.find(u => u.id === userId)
  return user ? user.name : userId
}

function editGateway(gw: any) {
  editingGateway.value = gw
  gwForm.value = {
    gatewayId: gw.gatewayId,
    name: gw.name,
    userId: gw.userId,
    location: gw.location || '',
    rpiIp: gw.rpiIp || '',
  }
  showGatewayModal.value = true
}

async function saveGateway() {
  try {
    if (editingGateway.value) {
      await gatewayApi.update(editingGateway.value.id, {
        name: gwForm.value.name,
        location: gwForm.value.location || undefined,
        rpiIp: gwForm.value.rpiIp || undefined,
      })
    } else {
      await gatewayApi.create({
        gatewayId: gwForm.value.gatewayId,
        name: gwForm.value.name,
        location: gwForm.value.location || undefined,
        rpiIp: gwForm.value.rpiIp || undefined,
      })
    }
    showGatewayModal.value = false
    editingGateway.value = null
    gwForm.value = { gatewayId: '', name: '', userId: '', location: '', rpiIp: '' }
    await fetchGateways()
  } catch (err: any) {
    alert(err.response?.data?.message || '게이트웨이 저장에 실패했습니다.')
  }
}

async function deleteGateway(gw: any) {
  if (!confirm(`게이트웨이 "${gw.name}" (${gw.gatewayId})를 삭제하시겠습니까?`)) return
  try {
    await gatewayApi.remove(gw.id)
    await fetchGateways()
  } catch {
    alert('게이트웨이 삭제에 실패했습니다.')
  }
}

onMounted(() => {
  fetchUsers()
  fetchGateways()
})

const editUser = (user: User) => {
  selectedUser.value = { ...user }
  showUserModal.value = true
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
  selectedUser.value = null
}

const saveUser = async (userData: any) => {
  try {
    if (selectedUser.value) {
      const payload: any = { name: userData.name, address: userData.address }
      if (userData.role) payload.role = userData.role
      if (userData.status) payload.status = userData.status
      if (userData.password) payload.password = userData.password
      if (userData.parentUserId !== undefined) payload.parentUserId = userData.parentUserId || null

      // 자기 자신이면 /users/me, 아니면 관리자 경로
      if (selectedUser.value.id === authStore.user?.id) {
        await userApi.updateMe(payload)
        await authStore.fetchUser()
      } else {
        await userApi.update(selectedUser.value.id, payload)
      }

      await fetchUsers()
    } else {
      // 신규 추가
      const { data: newUser } = await userApi.create({
        email: userData.email,
        password: userData.password,
        name: userData.name,
        role: userData.role || 'farm_admin',
        address: userData.address,
        parentUserId: userData.parentUserId,
      })

      await fetchUsers()
    }
    closeUserModal()
  } catch (err: any) {
    console.error('저장 실패:', err)
    alert(err.response?.data?.message || '저장에 실패했습니다.')
  }
}

</script>

<style scoped>
.page-container {
  padding: 24px;
  max-width: 1400px;
  margin: 0 auto;
}

.page-header {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 24px;
  flex-wrap: wrap;
}

.page-header h2 {
  font-size: 28px;
  font-weight: 700;
  color: var(--text-primary);
}

.page-description {
  flex: 1;
  color: var(--text-link);
  font-size: 14px;
}

.btn-primary {
  padding: 10px 20px;
  background: #2e7d32;
  color: white;
  border: none;
  border-radius: 8px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-primary:hover {
  background: #256029;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(46, 125, 50, 0.3);
}

.users-table-container {
  background: var(--bg-card);
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  overflow: hidden;
}

.users-table {
  width: 100%;
  border-collapse: collapse;
}

.users-table thead {
  background: var(--bg-secondary);
}

.users-table th {
  padding: 16px;
  text-align: left;
  font-weight: 600;
  color: var(--text-primary);
  font-size: 14px;
  border-bottom: 2px solid var(--border-input);
}

.users-table td {
  padding: 16px;
  border-bottom: 1px solid var(--border-light);
  font-size: 14px;
  color: var(--text-secondary);
}

.users-table tbody tr:hover {
  background: var(--bg-hover);
}

.user-name {
  display: flex;
  align-items: center;
  gap: 12px;
}

.user-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 14px;
}

.role-badge {
  display: inline-block;
  padding: 4px 12px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
}

.role-badge.admin {
  background: #e3f2fd;
  color: #1976d2;
}

.role-badge.farm_admin {
  background: #fff3e0;
  color: #e65100;
}

.role-badge.farm_user {
  background: #e8f5e9;
  color: #2e7d32;
}

.parent-badge {
  display: inline-block;
  margin-left: 6px;
  padding: 2px 8px;
  border-radius: 8px;
  font-size: 11px;
  background: var(--bg-badge);
  color: var(--text-muted);
}

.address-text {
  font-size: 13px;
  color: var(--text-link);
}

.project-badge {
  display: inline-block;
  padding: 4px 10px;
  background: #e8f5e9;
  color: #2e7d32;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 500;
  font-family: monospace;
  white-space: nowrap;
}

.text-muted {
  color: var(--text-muted);
  font-style: italic;
  font-size: 13px;
}

.status-badge {
  display: inline-block;
  padding: 4px 12px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
}

.status-badge.active {
  background: #e8f5e9;
  color: #2e7d32;
}

.status-badge.inactive {
  background: #ffebee;
  color: #c62828;
}

.action-buttons {
  display: flex;
  gap: 8px;
}

.btn-icon {
  background: none;
  border: none;
  font-size: 18px;
  cursor: pointer;
  padding: 6px;
  border-radius: 6px;
  transition: all 0.2s;
}

.btn-icon:hover {
  background: var(--bg-hover);
}

.btn-icon.danger:hover {
  background: #ffebee;
}

.empty-state {
  padding: 60px 20px;
  text-align: center;
}

.empty-state p {
  color: var(--text-muted);
  font-size: 16px;
}

.gateway-id {
  background: var(--bg-secondary);
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 13px;
}

.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-card {
  background: var(--bg-card, #fff);
  border-radius: 16px;
  width: 90%;
  max-width: 500px;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 24px;
  border-bottom: 1px solid var(--border-light, #eee);
}

.modal-header h3 {
  font-size: 18px;
  font-weight: 600;
}

.modal-close {
  background: none;
  border: none;
  font-size: 24px;
  cursor: pointer;
  color: var(--text-muted);
}

.modal-body {
  padding: 24px;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 24px;
  border-top: 1px solid var(--border-light, #eee);
}

.form-group {
  margin-bottom: 16px;
}

.form-group label {
  display: block;
  font-size: 14px;
  font-weight: 500;
  margin-bottom: 6px;
  color: var(--text-primary);
}

.form-input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--border-input, #ddd);
  border-radius: 8px;
  font-size: 14px;
  background: var(--bg-input, #fff);
  color: var(--text-primary);
  box-sizing: border-box;
}

.form-input:focus {
  outline: none;
  border-color: #2e7d32;
  box-shadow: 0 0 0 3px rgba(46, 125, 50, 0.1);
}

.help-text {
  font-size: 12px;
  color: var(--text-muted);
  margin-top: 4px;
}

.btn-secondary {
  padding: 10px 20px;
  background: var(--bg-secondary, #f5f5f5);
  color: var(--text-primary);
  border: 1px solid var(--border-input, #ddd);
  border-radius: 8px;
  cursor: pointer;
}

@media (max-width: 1024px) {
  .users-table-container {
    overflow-x: auto;
  }

  .users-table {
    min-width: 1100px;
  }
}
</style>
