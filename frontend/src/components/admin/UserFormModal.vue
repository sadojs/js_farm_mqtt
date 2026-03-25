<template>
  <div v-if="show" class="modal-overlay" @click.self="closeModal">
    <div class="modal-container">
      <div class="modal-header">
        <h2>{{ user ? '사용자 수정' : '새 사용자 추가' }}</h2>
        <button class="close-btn" @click="closeModal">✕</button>
      </div>

      <div class="modal-body">
        <form @submit.prevent="handleSubmit">
          <div class="form-group">
            <label>이름 *</label>
            <input
              v-model="formData.name"
              type="text"
              placeholder="사용자 이름"
              class="form-input"
              required
            />
          </div>

          <div class="form-group">
            <label>이메일 *</label>
            <input
              v-model="formData.email"
              type="email"
              placeholder="user@example.com"
              class="form-input"
              required
            />
          </div>

          <div class="form-group">
            <label>비밀번호 {{ user ? '(변경 시에만 입력)' : '*' }}</label>
            <input
              v-model="formData.password"
              type="password"
              placeholder="비밀번호"
              class="form-input"
              :required="!user"
            />
          </div>

          <div class="form-group">
            <label>역할 *</label>
            <select v-model="formData.role" class="form-select" required>
              <option value="farm_admin">농장 관리자</option>
              <option value="farm_user">농장 사용자</option>
              <option value="admin">플랫폼 관리자</option>
            </select>
          </div>

          <div v-if="formData.role === 'farm_user'" class="form-group">
            <label>소속 농장 (농장 관리자) *</label>
            <select v-model="formData.parentUserId" class="form-select" required>
              <option value="">선택하세요</option>
              <option v-for="admin in farmAdmins" :key="admin.id" :value="admin.id">
                {{ admin.name }} ({{ admin.email }})
              </option>
            </select>
            <p class="help-text">
              농장 사용자는 선택한 농장 관리자의 장비/센서/그룹 데이터를 공유합니다
            </p>
          </div>

          <div class="form-group">
            <label>주소</label>
            <div class="address-grid">
              <select v-model="selectedLevel1" class="form-select">
                <option value="">시/도 선택</option>
                <option v-for="item in level1Options" :key="item" :value="item">
                  {{ item }}
                </option>
              </select>
              <select
                v-model="selectedLevel2"
                class="form-select"
                :disabled="!selectedLevel1"
              >
                <option value="">시/군/구 선택</option>
                <option v-for="item in level2Options" :key="item" :value="item">
                  {{ item }}
                </option>
              </select>
            </div>
            <input
              v-model="addressDetail"
              type="text"
              placeholder="상세 주소 (선택, 예: 농업로 123)"
              class="form-input address-detail"
              :disabled="!selectedLevel2"
            />
            <div class="address-preview">
              저장 주소: <strong>{{ formData.address || '-' }}</strong>
            </div>
            <p class="help-text">
              오입력 방지를 위해 시/도, 시/군/구를 선택하세요. 상세 주소는 선택 입력입니다.
            </p>
          </div>

          <!-- 게이트웨이는 사용자 관리 페이지에서 별도로 등록합니다 -->
        </form>
      </div>

      <div class="modal-footer">
        <button class="btn-secondary" @click="closeModal">취소</button>
        <button class="btn-primary" @click="handleSubmit">
          {{ user ? '수정' : '추가' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { userApi } from '../../api/user.api'
import addressRegions from '../../data/address-regions.json'

interface UserFormData {
  id?: string
  name: string
  email: string
  role: 'admin' | 'farm_admin' | 'farm_user'
  parentUserId?: string
  address?: string
  password?: string
  [key: string]: any
}

interface AddressRegion {
  level1: string
  level2List: string[]
}

const regions = addressRegions as AddressRegion[]

const props = defineProps<{
  show: boolean
  user: UserFormData | null
}>()

const emit = defineEmits<{
  close: []
  save: [user: UserFormData]
}>()

const formData = ref<UserFormData>({
  name: '',
  email: '',
  role: 'farm_admin',
  address: '',
  password: ''
})

const farmAdmins = ref<{ id: string; name: string; email: string }[]>([])

watch(() => props.show, async (show) => {
  if (show) {
    try {
      const { data } = await userApi.getFarmAdmins()
      farmAdmins.value = data as any
    } catch { /* ignore */ }
  }
})

watch(() => formData.value.role, (role) => {
  if (role !== 'farm_user') {
    formData.value.parentUserId = undefined
  }
})

const selectedLevel1 = ref('')
const selectedLevel2 = ref('')
const addressDetail = ref('')
const isInitializingAddress = ref(false)

const level1Options = computed(() => regions.map(r => r.level1))
const level2Options = computed(() => {
  const found = regions.find(r => r.level1 === selectedLevel1.value)
  return found?.level2List || []
})

watch(selectedLevel1, () => {
  if (!selectedLevel1.value) {
    selectedLevel2.value = ''
    addressDetail.value = ''
    syncAddress()
    return
  }

  if (!level2Options.value.includes(selectedLevel2.value)) {
    selectedLevel2.value = ''
    addressDetail.value = ''
  }
  syncAddress()
})

watch(selectedLevel2, () => {
  if (!selectedLevel2.value) {
    addressDetail.value = ''
  }
  syncAddress()
})

watch(addressDetail, () => {
  syncAddress()
})

watch(
  () => props.user,
  (newUser) => {
    if (newUser) {
      formData.value = {
        ...newUser,
        password: '',
      }
    } else {
      formData.value = {
        name: '',
        email: '',
        role: 'farm_admin',
        address: '',
        password: ''
      }
    }
    initializeAddressSelector(formData.value.address || '')
  },
  { immediate: true }
)

function normalize(value: string) {
  return value.toLowerCase().replace(/\s+/g, '')
}

function initializeAddressSelector(address: string) {
  isInitializingAddress.value = true
  selectedLevel1.value = ''
  selectedLevel2.value = ''
  addressDetail.value = ''

  const normalizedAddress = normalize(address)
  const foundLevel1 = level1Options.value.find(l1 => normalizedAddress.includes(normalize(l1)))

  if (foundLevel1) {
    selectedLevel1.value = foundLevel1

    const candidates = [...level2Options.value].sort((a, b) => b.length - a.length)
    const foundLevel2 = candidates.find(l2 => normalizedAddress.includes(normalize(l2)))
    if (foundLevel2) {
      selectedLevel2.value = foundLevel2
      const base = `${foundLevel1} ${foundLevel2}`
      addressDetail.value = address.replace(base, '').trim()
    }
  }

  isInitializingAddress.value = false
}

function syncAddress() {
  if (isInitializingAddress.value) return

  if (!selectedLevel1.value && !selectedLevel2.value) {
    formData.value.address = ''
    return
  }

  const base = selectedLevel2.value
    ? `${selectedLevel1.value} ${selectedLevel2.value}`
    : selectedLevel1.value

  formData.value.address = addressDetail.value
    ? `${base} ${addressDetail.value.trim()}`
    : base
}

const handleSubmit = () => {
  if (selectedLevel1.value && !selectedLevel2.value) {
    alert('시/군/구를 선택해 주세요.')
    return
  }
  syncAddress()
  emit('save', { ...formData.value })
}

const closeModal = () => {
  emit('close')
}
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 20px;
}

.modal-container {
  background: var(--bg-card);
  border-radius: 16px;
  width: 100%;
  max-width: 600px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-modal);
  border: 1px solid var(--border-color);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 24px;
  border-bottom: 1px solid var(--border-input);
}

.modal-header h2 {
  font-size: 24px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
}

.close-btn {
  background: none;
  border: none;
  font-size: 24px;
  color: var(--text-muted);
  cursor: pointer;
  padding: 4px;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition: all 0.2s;
}

.close-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.modal-body {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
}

.form-group {
  margin-bottom: 20px;
}

.form-group:last-child {
  margin-bottom: 0;
}

.form-group label {
  display: block;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-secondary);
  margin-bottom: 8px;
}

.form-input,
.form-select {
  width: 100%;
  padding: 10px 12px;
  border: 2px solid var(--border-input);
  border-radius: 8px;
  font-size: 14px;
  transition: all 0.2s;
  font-family: inherit;
  background: var(--bg-input);
  color: var(--text-primary);
}

.form-input:focus,
.form-select:focus {
  outline: none;
  border-color: #4caf50;
  box-shadow: 0 0 0 3px rgba(76, 175, 80, 0.1);
}

.help-text {
  font-size: 12px;
  color: var(--text-muted);
  margin: 6px 0 0 0;
  line-height: 1.5;
}

.address-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.address-detail {
  margin-top: 10px;
}

.address-preview {
  margin-top: 8px;
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 13px;
  color: var(--text-primary);
  background: var(--bg-secondary);
  border: 1px solid var(--border-light);
}

.form-section {
  margin: 24px 0;
  padding: 20px;
  background: var(--bg-secondary);
  border-radius: 12px;
  border: 1px solid var(--border-light);
}

.section-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 8px 0;
}

.section-description {
  font-size: 13px;
  color: var(--text-secondary);
  margin: 0 0 20px 0;
  line-height: 1.6;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 20px 24px;
  border-top: 1px solid var(--border-light);
}

.btn-primary,
.btn-secondary {
  padding: 10px 24px;
  border: none;
  border-radius: 8px;
  font-weight: 500;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-primary {
  background: #4caf50;
  color: white;
}

.btn-primary:hover {
  background: #45a049;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(76, 175, 80, 0.3);
}

.btn-secondary {
  background: var(--bg-secondary);
  color: var(--text-primary);
}

.btn-secondary:hover {
  background: var(--bg-hover);
}

.btn-test {
  width: 100%;
  padding: 10px;
  background: #1976d2;
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-test:hover:not(:disabled) {
  background: #1565c0;
}

.btn-test:disabled {
  background: #ccc;
  cursor: not-allowed;
}

.test-result {
  margin-top: 8px;
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 13px;
}

.test-result.success {
  background: #e8f5e9;
  color: #2e7d32;
  border: 1px solid #a5d6a7;
}

.test-result.error {
  background: #ffebee;
  color: #c62828;
  border: 1px solid #ef9a9a;
}

.test-result p {
  margin: 2px 0;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.checkbox-label input[type="checkbox"] {
  width: 18px;
  height: 18px;
  cursor: pointer;
}

@media (max-width: 768px) {
  .modal-container {
    max-width: 100%;
    max-height: 100vh;
    border-radius: 0;
  }

  .address-grid {
    grid-template-columns: 1fr;
  }
}
</style>
