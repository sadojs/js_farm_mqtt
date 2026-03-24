<template>
  <div class="page-container">
    <header class="page-header">
      <h2>👥 사용자 관리</h2>
      <p class="page-description">사용자 계정을 생성하고 센서 프로젝트를 할당하세요</p>
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
            <th>센서 프로젝트</th>
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
              <span v-if="user.tuyaProject?.enabled && user.tuyaProject?.name" class="project-badge">
                {{ user.tuyaProject.name }}
              </span>
              <span v-else class="text-muted">미설정</span>
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
                  class="btn-icon"
                  title="센서 프로젝트 할당"
                  @click="assignProject(user)"
                >
                  🔗
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

    <!-- 사용자 추가/수정 모달 -->
    <UserFormModal
      :show="showUserModal"
      :user="selectedUser"
      @close="closeUserModal"
      @save="saveUser"
    />

    <!-- Tuya 프로젝트 할당 모달 -->
    <ProjectAssignModal
      :show="showProjectModal"
      :user="selectedUser"
      @close="showProjectModal = false"
      @assign="handleProjectAssign"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import UserFormModal from '@/components/admin/UserFormModal.vue'
import ProjectAssignModal from '@/components/admin/ProjectAssignModal.vue'
import { userApi } from '../api/user.api'
import type { UpdateTuyaRequest } from '../api/user.api'
import { useAuthStore } from '../stores/auth.store'

interface User {
  id: string
  name: string
  email: string
  role: 'admin' | 'farm_admin' | 'farm_user'
  parentUserId?: string
  parentUserName?: string
  address?: string
  tuyaProject?: any
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
const showProjectModal = ref(false)
const selectedUser = ref<User | null>(null)

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

onMounted(() => {
  fetchUsers()
})

const editUser = (user: User) => {
  selectedUser.value = { ...user }
  showUserModal.value = true
}

const assignProject = (user: User) => {
  selectedUser.value = user
  showProjectModal.value = true
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

      // Tuya 프로젝트 정보가 있으면 함께 업데이트 (farm_user는 parent 것을 사용하므로 제외)
      if (userData.role !== 'farm_user' && userData.tuyaProject?.name && userData.tuyaProject?.accessId && userData.tuyaProject?.endpoint) {
        const tuyaPayload: UpdateTuyaRequest = {
          name: userData.tuyaProject.name,
          accessId: userData.tuyaProject.accessId,
          accessSecret: userData.tuyaProject.accessSecret || '',
          endpoint: userData.tuyaProject.endpoint,
          projectId: userData.tuyaProject.projectId,
          enabled: userData.tuyaProject.enabled ?? true,
        }
        if (selectedUser.value.id === authStore.user?.id) {
          await userApi.updateMyTuya(tuyaPayload)
        } else {
          await userApi.updateTuya(selectedUser.value.id, tuyaPayload)
        }
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

      // 신규 사용자의 Tuya 프로젝트 정보 저장
      if (userData.role !== 'farm_user' && userData.tuyaProject?.name && userData.tuyaProject?.accessId && userData.tuyaProject?.endpoint) {
        const tuyaPayload: UpdateTuyaRequest = {
          name: userData.tuyaProject.name,
          accessId: userData.tuyaProject.accessId,
          accessSecret: userData.tuyaProject.accessSecret || '',
          endpoint: userData.tuyaProject.endpoint,
          projectId: userData.tuyaProject.projectId,
          enabled: userData.tuyaProject.enabled ?? true,
        }
        await userApi.updateTuya((newUser as any).id, tuyaPayload)
      }

      await fetchUsers()
    }
    closeUserModal()
  } catch (err: any) {
    console.error('저장 실패:', err)
    alert(err.response?.data?.message || '저장에 실패했습니다.')
  }
}

const handleProjectAssign = async (project: any) => {
  if (!selectedUser.value) return
  try {
    const tuyaPayload: UpdateTuyaRequest = {
      name: project.name || '',
      accessId: project.accessId || '',
      accessSecret: project.accessSecret || '',
      endpoint: project.endpoint || '',
      projectId: project.projectId,
    }
    if (selectedUser.value.id === authStore.user?.id) {
      await userApi.updateMyTuya(tuyaPayload)
    } else {
      await userApi.updateTuya(selectedUser.value.id, tuyaPayload)
    }
    await fetchUsers()
  } catch (err) {
    console.error('프로젝트 할당 실패:', err)
    alert('프로젝트 할당에 실패했습니다.')
  }
  showProjectModal.value = false
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

@media (max-width: 1024px) {
  .users-table-container {
    overflow-x: auto;
  }

  .users-table {
    min-width: 1100px;
  }
}
</style>
