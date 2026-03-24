<template>
  <div class="modal-overlay" v-if="isOpen" @click.self="closeModal">
    <div class="modal-container">
      <div class="modal-header">
        <h2>🔌 장비 등록</h2>
        <button class="btn-close" @click="closeModal">✕</button>
      </div>

      <div class="modal-body">
        <!-- Tuya 프로젝트 미설정 경고 -->
        <div v-if="!hasTuyaProject" class="warning-box">
          <div class="warning-icon">⚠️</div>
          <div class="warning-content">
            <h3>센서 프로젝트가 설정되지 않았습니다</h3>
            <p>사용자 관리에서 센서 클라우드 프로젝트 설정을 먼저 완료하세요.</p>
            <ul>
              <li>Access ID (Client ID)</li>
              <li>Access Secret (Client Secret)</li>
              <li>API Endpoint</li>
            </ul>
          </div>
        </div>

        <!-- Step 1: Tuya 기기 불러오기 -->
        <div class="step-section" v-if="step === 1 && hasTuyaProject">
          <div class="step-header">
            <span class="step-number">1</span>
            <h3>센서 클라우드 기기 불러오기</h3>
          </div>

          <div class="project-info-box">
            <p><strong>프로젝트:</strong> {{ authStore.user?.tuyaProject?.name }}</p>
            <p><strong>엔드포인트:</strong> {{ authStore.user?.tuyaProject?.endpoint }}</p>
          </div>

          <button
            class="btn-primary btn-block"
            @click="loadDevices"
            :disabled="loading"
          >
            <span v-if="loading">⏳ 센서 클라우드에서 불러오는 중...</span>
            <span v-else>📡 기기 목록 불러오기</span>
          </button>

          <!-- 에러 메시지 -->
          <div v-if="errorMessage" class="error-box">
            <p>{{ errorMessage }}</p>
          </div>

          <!-- 기기 없음 메시지 -->
          <div v-if="noDevicesFound" class="empty-devices-box">
            <div class="empty-icon">📭</div>
            <h3>등록된 장치가 없습니다</h3>
            <p>센서 클라우드에 연결된 장치가 없습니다.</p>
            <p class="help-text">센서 앱에서 장치를 먼저 추가한 후 다시 시도해주세요.</p>
          </div>
        </div>

        <!-- Step 2: Tuya 기기 선택 -->
        <div class="step-section" v-if="step === 2">
          <div class="step-header">
            <span class="step-number">2</span>
            <h3>센서 기기 선택</h3>
          </div>

          <div class="search-box">
            <input
              type="text"
              v-model="searchQuery"
              placeholder="🔍 기기 이름, ID 검색..."
              class="form-input"
            />
          </div>

          <div class="device-list">
            <div
              v-for="device in filteredTuyaDevices"
              :key="device.id"
              class="device-item"
              :class="{ selected: isDeviceSelected(device.id) }"
              @click="toggleDeviceSelection(device)"
            >
              <div class="device-item-top">
                <div class="device-checkbox">
                  <input
                    type="checkbox"
                    :checked="isDeviceSelected(device.id)"
                    @click.stop
                  />
                </div>
                <div class="device-icon">{{ getCategoryIcon(device.category) }}</div>
                <div class="device-info">
                  <h4>{{ device.name }}</h4>
                  <p class="device-id">ID: {{ device.id }}</p>
                  <p class="device-type">{{ device.product_name || device.category }}</p>
                </div>
                <div class="device-status">
                  <span :class="['status-badge', device.online ? 'online' : 'offline']">
                    {{ device.online ? '온라인' : '오프라인' }}
                  </span>
                </div>
              </div>
              <div class="device-item-bottom" v-if="isDeviceSelected(device.id)" @click.stop>
                <div class="device-type-select">
                  <button
                    class="type-btn"
                    :class="{ active: getDeviceType(device.id) === 'sensor' }"
                    @click="setDeviceType(device.id, 'sensor')"
                  >
                    🌡️ 센서
                  </button>
                  <button
                    class="type-btn"
                    :class="{ active: getDeviceType(device.id) === 'actuator' }"
                    @click="setDeviceType(device.id, 'actuator')"
                  >
                    ⚙️ 장비
                  </button>
                </div>
                <div class="equipment-type-select" v-if="getDeviceType(device.id) === 'actuator'">
                  <select
                    :value="getEquipmentType(device.id)"
                    @change="setEquipmentType(device.id, ($event.target as HTMLSelectElement).value as EquipmentType)"
                    class="equipment-select"
                  >
                    <option v-for="opt in EQUIPMENT_TYPE_OPTIONS" :key="opt.value" :value="opt.value">
                      {{ opt.label }}
                    </option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          <div class="selected-count">
            선택된 기기: <strong>{{ selectedDevices.length }}개</strong>
          </div>

          <!-- 개폐기 페어링 경고 -->
          <div v-if="hasOpenerType && !openerPairValid" class="error-box">
            <p>개폐기는 반드시 <strong>열림 1개 + 닫힘 1개</strong>를 함께 선택해야 합니다.</p>
          </div>

          <div class="button-group">
            <button class="btn-secondary" @click="step = 1">← 이전</button>
            <button
              class="btn-primary"
              @click="step = 3"
              :disabled="!canProceedStep2"
            >
              다음 →
            </button>
          </div>
        </div>

        <!-- Step 4: 그룹 설정 위저드 -->
        <div class="step-section" v-if="step === 4 && canManageGroups">

          <!-- Step 4 - ask: 그룹 추가 여부 -->
          <div v-if="wizardSubStep === 'ask'">
            <div class="wizard-success-icon">✅</div>
            <h3 class="wizard-success-title">장비 등록이 완료되었습니다!</h3>
            <p class="wizard-success-desc">등록한 장비를 그룹에 추가하시겠습니까?</p>
            <div class="wizard-ask-buttons">
              <button
                class="btn-wizard-option"
                :class="{ disabled: groupStore.groups.length === 0 }"
                :disabled="groupStore.groups.length === 0"
                @click="wizardSubStep = 'existing'"
              >
                <span class="wizard-option-icon">📁</span>
                <span class="wizard-option-label">기존 그룹에 추가</span>
                <span v-if="groupStore.groups.length === 0" class="wizard-option-hint">그룹 없음</span>
              </button>
              <button class="btn-wizard-option" @click="wizardSubStep = 'create'">
                <span class="wizard-option-icon">➕</span>
                <span class="wizard-option-label">새 그룹 생성</span>
              </button>
            </div>
            <button class="btn-skip" @click="closeModal">나중에</button>
          </div>

          <!-- Step 4a - existing: 기존 그룹 선택 -->
          <div v-if="wizardSubStep === 'existing'">
            <div class="step-header">
              <span class="step-number">4</span>
              <h3>그룹 선택</h3>
            </div>
            <div class="group-list">
              <label
                v-for="group in groupStore.groups"
                :key="group.id"
                class="group-radio-item"
                :class="{ selected: selectedGroupId === group.id }"
              >
                <input type="radio" :value="group.id" v-model="selectedGroupId" />
                <span class="group-radio-name">{{ group.name }}</span>
                <span class="group-radio-count">{{ group.devices?.length ?? 0 }}개 장비</span>
              </label>
            </div>
            <div v-if="groupWizardError" class="error-box"><p>{{ groupWizardError }}</p></div>
            <div class="button-group">
              <button class="btn-secondary" @click="wizardSubStep = 'ask'">← 이전</button>
              <button
                class="btn-primary"
                :disabled="!selectedGroupId || groupAssigning"
                @click="assignToExistingGroup"
              >
                {{ groupAssigning ? '추가 중...' : '선택 완료' }}
              </button>
            </div>
          </div>

          <!-- Step 4b - create: 새 그룹 생성 -->
          <div v-if="wizardSubStep === 'create'">
            <div class="step-header">
              <span class="step-number">4</span>
              <h3>새 그룹 생성</h3>
            </div>
            <div class="input-group">
              <label>그룹 이름 *</label>
              <input
                type="text"
                v-model="newGroupName"
                class="form-input"
                placeholder="예: 1동, 관수 구역 A"
              />
            </div>
            <div class="input-group">
              <label>설명 (선택)</label>
              <textarea
                v-model="newGroupDesc"
                class="form-textarea"
                rows="2"
                placeholder="그룹에 대한 설명을 입력하세요"
              ></textarea>
            </div>
            <div v-if="groupWizardError" class="error-box"><p>{{ groupWizardError }}</p></div>
            <div class="button-group">
              <button class="btn-secondary" @click="wizardSubStep = 'ask'">← 이전</button>
              <button
                class="btn-primary"
                :disabled="!newGroupName.trim() || groupAssigning"
                @click="createGroupAndAssign"
              >
                {{ groupAssigning ? '생성 중...' : '그룹 생성 및 장비 추가' }}
              </button>
            </div>
          </div>

        </div>

        <!-- Step 3: 장비 이름 설정 및 확인 -->
        <div class="step-section" v-if="step === 3">
          <div class="step-header">
            <span class="step-number">3</span>
            <h3>장비 이름 확인 및 등록</h3>
          </div>

          <p class="step-description">각 장비의 이름을 확인하고 필요시 수정하세요. 나중에 그룹에서 이 장비들을 할당합니다.</p>

          <!-- 개폐기 그룹 이름 입력 -->
          <div v-if="hasOpenerType && openerPairValid" class="opener-group-name-box">
            <label>개폐기 대표 이름</label>
            <input
              type="text"
              v-model="openerGroupName"
              class="form-input"
              placeholder="예: 1동 천창"
            />
            <p class="help-text">열림/닫힘 장비 이름이 자동 생성됩니다: <strong>{{ openerGroupName || '개폐기' }} (열림)</strong>, <strong>{{ openerGroupName || '개폐기' }} (닫힘)</strong></p>
          </div>

          <!-- 에러 메시지 -->
          <div v-if="errorMessage" class="error-box">
            <p>{{ errorMessage }}</p>
          </div>

          <div class="device-name-list">
            <div
              v-for="device in selectedDevices"
              :key="device.id"
              class="device-name-item"
            >
              <div class="device-name-left">
                <span class="device-name-icon">{{ getCategoryIcon(device.category) }}</span>
                <span :class="['type-badge', device.deviceType === 'sensor' ? 'sensor' : 'actuator']">
                  {{ device.deviceType === 'sensor' ? '센서' : getEquipmentLabel(device.equipmentType) }}
                </span>
              </div>
              <div class="device-name-input-wrap">
                <input
                  type="text"
                  v-model="device.name"
                  class="form-input"
                  placeholder="장비 이름 입력"
                />
                <p class="device-name-id">센서 ID: {{ device.id }}</p>
              </div>
              <div class="device-name-status">
                <span :class="['status-dot', device.online ? 'online' : 'offline']"></span>
                <span class="status-text">{{ device.online ? '온라인' : '오프라인' }}</span>
              </div>
              <button @click="removeDevice(device.id)" class="chip-remove">✕</button>
            </div>
          </div>

          <div class="register-summary">
            센서 <strong>{{ sensorCount }}개</strong> / 장비 <strong>{{ actuatorCount }}개</strong> - 총 <strong>{{ selectedDevices.length }}개</strong> 등록
          </div>

          <div class="button-group">
            <button class="btn-secondary" @click="step = 2">← 이전</button>
            <button
              class="btn-primary"
              @click="registerDevices"
              :disabled="registering || selectedDevices.length === 0"
            >
              <span v-if="registering">등록 중...</span>
              <span v-else>등록 완료</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useAuthStore } from '../../stores/auth.store'
import { useDeviceStore } from '../../stores/device.store'
import { useGroupStore } from '../../stores/group.store'
import apiClient from '../../api/client'

import type { EquipmentType } from '../../types/device.types'

interface TuyaDevice {
  id: string
  name: string
  category: string
  online: boolean
  product_name?: string
  deviceType?: 'sensor' | 'actuator'
  equipmentType?: EquipmentType
}

const SENSOR_CATEGORIES = ['wsdcg', 'co2bj', 'ldcg', 'mcs', 'ywbj', 'pm25', 'cz', 'qxj', 'hjjcy']
const guessDeviceType = (category: string): 'sensor' | 'actuator' => {
  return SENSOR_CATEGORIES.includes(category) ? 'sensor' : 'actuator'
}

const guessEquipmentType = (category: string): EquipmentType => {
  if (['cl', 'mc'].includes(category)) return 'opener_open'
  if (['wk', 'fs'].includes(category)) return 'fan'
  if (['bh', 'sfkzq'].includes(category)) return 'irrigation'
  return 'other'
}

const EQUIPMENT_TYPE_OPTIONS: { value: EquipmentType; label: string }[] = [
  { value: 'other', label: '기타' },
  { value: 'irrigation', label: '관수' },
  { value: 'fan', label: '환풍기(휀)' },
  { value: 'opener_open', label: '개폐기(열림)' },
  { value: 'opener_close', label: '개폐기(닫힘)' },
]

const props = defineProps<{ isOpen: boolean }>()
const emit = defineEmits<{
  close: []
  registered: [devices: TuyaDevice[]]
}>()

const authStore = useAuthStore()
const deviceStore = useDeviceStore()
const groupStore = useGroupStore()

const canManageGroups = computed(() => authStore.isAdmin || authStore.isFarmAdmin)

// 위저드 Step 4 상태
const wizardSubStep = ref<'ask' | 'existing' | 'create'>('ask')
const registeredDeviceIds = ref<string[]>([])
const selectedGroupId = ref<string | null>(null)
const newGroupName = ref('')
const newGroupDesc = ref('')
const groupAssigning = ref(false)
const groupWizardError = ref('')

const step = ref(1)
const loading = ref(false)
const searchQuery = ref('')
const errorMessage = ref('')
const noDevicesFound = ref(false)

const hasTuyaProject = computed(() => {
  const tp = authStore.user?.tuyaProject
  return tp && tp.enabled && tp.accessId && tp.endpoint
})

// 모달 열릴 때 상태 초기화
watch(() => props.isOpen, (open) => {
  if (open) {
    errorMessage.value = ''
    noDevicesFound.value = false
  }
})

const tuyaDevices = ref<TuyaDevice[]>([])
const selectedDevices = ref<TuyaDevice[]>([])

const getCategoryIcon = (category: string) => {
  const icons: Record<string, string> = {
    'wk': '💨', 'fs': '💨',     // 환풍기
    'cl': '🚪', 'mc': '🚪',     // 커튼/개폐기
    'dj': '💡', 'dd': '💡',     // 조명
    'bh': '💦', 'sfkzq': '💦',  // 펌프/관개
    'wsdcg': '🌡️',              // 온습도센서
    'co2bj': '🌫️',             // CO2센서
    'ldcg': '🌱',               // 토양센서
  }
  return icons[category] || '📦'
}

const filteredTuyaDevices = computed(() => {
  if (!searchQuery.value) return tuyaDevices.value
  const query = searchQuery.value.toLowerCase()
  return tuyaDevices.value.filter(device =>
    device.name.toLowerCase().includes(query) ||
    device.id.toLowerCase().includes(query) ||
    device.category.toLowerCase().includes(query)
  )
})

const loadDevices = async () => {
  loading.value = true
  errorMessage.value = ''
  noDevicesFound.value = false

  try {
    const { data } = await apiClient.get('/tuya/devices')
    const result = data as any

    if (!result.success) {
      errorMessage.value = result.message || '기기 목록을 불러오지 못했습니다.'
      loading.value = false
      return
    }

    const devices = result.devices || []
    if (devices.length === 0) {
      noDevicesFound.value = true
      loading.value = false
      return
    }

    // 이미 등록된 장비(tuyaDeviceId 기준) 필터링
    const registeredTuyaIds = new Set(deviceStore.devices.map(d => d.tuyaDeviceId))
    const available = devices.filter((d: TuyaDevice) => !registeredTuyaIds.has(d.id))

    if (available.length === 0 && devices.length > 0) {
      noDevicesFound.value = false
      errorMessage.value = `모든 기기(${devices.length}개)가 이미 등록되어 있습니다.`
      loading.value = false
      return
    }

    tuyaDevices.value = available
    loading.value = false
    step.value = 2
  } catch (err: any) {
    errorMessage.value = err.response?.data?.message || '기기 목록을 불러오는데 실패했습니다. 센서 프로젝트 설정을 확인하세요.'
    loading.value = false
  }
}

const isDeviceSelected = (deviceId: string) => {
  return selectedDevices.value.some(d => d.id === deviceId)
}

const toggleDeviceSelection = (device: TuyaDevice) => {
  const index = selectedDevices.value.findIndex(d => d.id === device.id)
  if (index > -1) {
    selectedDevices.value.splice(index, 1)
  } else {
    const dtype = guessDeviceType(device.category)
    selectedDevices.value.push({
      ...device,
      deviceType: dtype,
      equipmentType: dtype === 'actuator' ? guessEquipmentType(device.category) : undefined,
    })
  }
}

const getDeviceType = (deviceId: string): 'sensor' | 'actuator' => {
  const device = selectedDevices.value.find(d => d.id === deviceId)
  return device?.deviceType || 'actuator'
}

const setDeviceType = (deviceId: string, type: 'sensor' | 'actuator') => {
  const device = selectedDevices.value.find(d => d.id === deviceId)
  if (device) {
    device.deviceType = type
    device.equipmentType = type === 'actuator' ? guessEquipmentType(device.category) : undefined
  }
}

const getEquipmentType = (deviceId: string): EquipmentType => {
  const device = selectedDevices.value.find(d => d.id === deviceId)
  return device?.equipmentType || 'other'
}

const setEquipmentType = (deviceId: string, eqType: EquipmentType) => {
  const device = selectedDevices.value.find(d => d.id === deviceId)
  if (device) device.equipmentType = eqType
}

const getEquipmentLabel = (eqType?: EquipmentType): string => {
  const opt = EQUIPMENT_TYPE_OPTIONS.find(o => o.value === eqType)
  return opt?.label || '장비'
}

const sensorCount = computed(() => selectedDevices.value.filter(d => d.deviceType === 'sensor').length)
const actuatorCount = computed(() => selectedDevices.value.filter(d => d.deviceType === 'actuator').length)

// 개폐기 페어링 검증
const openerOpenDevices = computed(() => selectedDevices.value.filter(d => d.equipmentType === 'opener_open'))
const openerCloseDevices = computed(() => selectedDevices.value.filter(d => d.equipmentType === 'opener_close'))
const hasOpenerType = computed(() => openerOpenDevices.value.length > 0 || openerCloseDevices.value.length > 0)
const openerPairValid = computed(() => {
  if (!hasOpenerType.value) return true
  return openerOpenDevices.value.length === 1 && openerCloseDevices.value.length === 1
})
const canProceedStep2 = computed(() => {
  if (selectedDevices.value.length === 0) return false
  if (hasOpenerType.value) return openerPairValid.value
  return true
})
const openerGroupName = ref('')

const removeDevice = (deviceId: string) => {
  const index = selectedDevices.value.findIndex(d => d.id === deviceId)
  if (index > -1) {
    selectedDevices.value.splice(index, 1)
  }
}

const registering = ref(false)

const registerDevices = async () => {
  registering.value = true
  errorMessage.value = ''
  try {
    // 개폐기 그룹 이름이 있으면 자동으로 이름 생성
    if (hasOpenerType.value && openerPairValid.value && openerGroupName.value) {
      const gn = openerGroupName.value
      for (const d of selectedDevices.value) {
        if (d.equipmentType === 'opener_open') d.name = `${gn} (열림)`
        if (d.equipmentType === 'opener_close') d.name = `${gn} (닫힘)`
      }
    }

    const deviceList = selectedDevices.value.map(d => ({
      tuyaDeviceId: d.id,
      name: d.name,
      category: d.category,
      deviceType: d.deviceType || guessDeviceType(d.category),
      equipmentType: d.deviceType === 'actuator' ? (d.equipmentType || 'other') : undefined,
      online: d.online,
      ...(d.equipmentType?.startsWith('opener_') && openerGroupName.value ? { openerGroupName: openerGroupName.value } : {}),
    }))

    const result = await deviceStore.registerDevices(deviceList)
    registeredDeviceIds.value = (result as any[]).map((d: any) => d.id)
    emit('registered', selectedDevices.value)

    if (canManageGroups.value) {
      await groupStore.fetchGroups()
      step.value = 4
      wizardSubStep.value = 'ask'
    } else {
      closeModal()
    }
  } catch (err: any) {
    errorMessage.value = err.response?.data?.message || '장비 등록에 실패했습니다.'
  } finally {
    registering.value = false
  }
}

const assignToExistingGroup = async () => {
  if (!selectedGroupId.value) return
  groupAssigning.value = true
  groupWizardError.value = ''
  try {
    await groupStore.assignDevices(selectedGroupId.value, registeredDeviceIds.value)
    closeModal()
  } catch (err: any) {
    groupWizardError.value = err.response?.data?.message || '그룹 할당에 실패했습니다.'
  } finally {
    groupAssigning.value = false
  }
}

const createGroupAndAssign = async () => {
  if (!newGroupName.value.trim()) return
  groupAssigning.value = true
  groupWizardError.value = ''
  try {
    const newGroup = await groupStore.createGroup({ name: newGroupName.value.trim(), description: newGroupDesc.value.trim() || undefined })
    await groupStore.assignDevices(newGroup.id, registeredDeviceIds.value)
    closeModal()
  } catch (err: any) {
    groupWizardError.value = err.response?.data?.message || '그룹 생성에 실패했습니다.'
  } finally {
    groupAssigning.value = false
  }
}

const closeModal = () => {
  emit('close')
  step.value = 1
  selectedDevices.value = []
  tuyaDevices.value = []
  searchQuery.value = ''
  errorMessage.value = ''
  noDevicesFound.value = false
  openerGroupName.value = ''
  wizardSubStep.value = 'ask'
  registeredDeviceIds.value = []
  selectedGroupId.value = null
  newGroupName.value = ''
  newGroupDesc.value = ''
  groupWizardError.value = ''
}
</script>

<style scoped>
.warning-box {
  background: var(--automation-bg);
  border: 2px solid var(--warning);
  border-radius: 12px;
  padding: 24px;
  display: flex;
  gap: 16px;
  align-items: start;
}

.warning-icon {
  font-size: 32px;
  flex-shrink: 0;
}

.warning-content h3 {
  font-size: 18px;
  font-weight: 600;
  color: var(--automation-text);
  margin: 0 0 8px 0;
}

.warning-content p {
  font-size: 14px;
  color: var(--text-link);
  margin: 0 0 12px 0;
}

.warning-content ul {
  margin: 0;
  padding-left: 20px;
}

.warning-content li {
  font-size: 13px;
  color: var(--text-link);
  margin: 4px 0;
}

.project-info-box {
  padding: 12px 16px;
  background: var(--accent-bg);
  border-radius: 8px;
  margin-bottom: 16px;
}

.project-info-box p {
  margin: 4px 0;
  font-size: 14px;
  color: var(--text-primary);
}

.error-box {
  margin-top: 16px;
  padding: 12px 16px;
  background: var(--danger-bg);
  border: 1px solid var(--danger);
  border-radius: 8px;
  color: var(--danger);
  font-size: 14px;
}

.error-box p {
  margin: 0;
}

.empty-devices-box {
  margin-top: 24px;
  padding: 32px 24px;
  text-align: center;
  background: var(--bg-secondary);
  border-radius: 12px;
}

.empty-icon {
  font-size: 48px;
  margin-bottom: 12px;
}

.empty-devices-box h3 {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 8px 0;
}

.empty-devices-box p {
  font-size: 14px;
  color: var(--text-link);
  margin: 4px 0;
}

.empty-devices-box .help-text {
  font-size: 13px;
  color: var(--text-muted);
  margin-top: 12px;
}

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
  max-width: 700px;
  max-height: 90vh;
  overflow: hidden;
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
  margin: 0;
  color: var(--text-primary);
}

.btn-close {
  width: 36px;
  height: 36px;
  border: none;
  background: var(--bg-hover);
  border-radius: 8px;
  font-size: 20px;
  cursor: pointer;
  transition: background 0.2s;
  color: var(--text-muted);
}

.btn-close:hover {
  background: var(--border-input);
  color: var(--text-primary);
}

.modal-body {
  padding: 24px;
  overflow-y: auto;
  flex: 1;
}

.step-section {
  animation: fadeIn 0.3s;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

.step-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 24px;
}

.step-number {
  width: 32px;
  height: 32px;
  background: #2e7d32;
  color: white;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
}

.step-header h3 {
  font-size: 20px;
  font-weight: 600;
  margin: 0;
  color: var(--text-primary);
}

.input-group {
  margin-bottom: 16px;
}

.input-group label {
  display: block;
  font-weight: 600;
  font-size: 15px;
  margin-bottom: 8px;
  color: var(--text-primary);
}

.form-select,
.form-input,
.form-textarea {
  width: 100%;
  padding: 14px;
  border: 2px solid var(--border-input);
  border-radius: 8px;
  font-size: 16px;
  transition: border-color 0.2s;
  background: var(--bg-input);
  color: var(--text-primary);
}

.form-select:focus,
.form-input:focus,
.form-textarea:focus {
  outline: none;
  border-color: #2e7d32;
}

.form-textarea {
  resize: vertical;
  font-family: inherit;
}

.btn-block {
  width: 100%;
}

.btn-primary,
.btn-secondary {
  padding: 14px 24px;
  border: none;
  border-radius: 10px;
  font-weight: 600;
  font-size: 16px;
  cursor: pointer;
  transition: background 0.2s;
}

.btn-primary {
  background: #2e7d32;
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background: #1b5e20;
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-secondary {
  background: var(--bg-secondary);
  color: var(--text-primary);
}

.btn-secondary:hover {
  background: var(--bg-hover);
}

.search-box {
  margin-bottom: 16px;
}

.device-list {
  max-height: 400px;
  overflow-y: auto;
  margin-bottom: 16px;
}

.device-item {
  display: flex;
  flex-direction: column;
  gap: 0;
  padding: 14px;
  border: 2px solid var(--border-input);
  border-radius: 10px;
  margin-bottom: 10px;
  cursor: pointer;
  transition: border-color 0.2s, background 0.2s;
  background: var(--bg-secondary);
}

.device-item:hover {
  border-color: var(--accent);
  background: var(--bg-hover);
}

.device-item.selected {
  border-color: var(--accent);
  background: var(--accent-bg);
}

.device-item-top {
  display: flex;
  align-items: center;
  gap: 12px;
}

.device-item-bottom {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--border-light);
  flex-wrap: wrap;
}

.device-checkbox input {
  width: 20px;
  height: 20px;
  cursor: pointer;
}

.device-icon {
  font-size: 28px;
}

.device-info {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.device-status {
  flex-shrink: 0;
}

.device-info h4 {
  font-size: 17px;
  font-weight: 600;
  margin: 0 0 4px 0;
  color: var(--text-primary);
}

.device-id,
.device-type {
  font-size: 13px;
  color: var(--text-secondary);
  margin: 2px 0;
}

.status-badge {
  padding: 4px 12px;
  border-radius: 12px;
  font-size: 13px;
  font-weight: 500;
}

.status-badge.online {
  background: var(--accent-bg);
  color: var(--accent);
}

.status-badge.offline {
  background: var(--danger-bg);
  color: var(--danger);
}

.selected-count {
  text-align: center;
  padding: 12px;
  background: var(--accent-bg);
  border-radius: 8px;
  margin-bottom: 16px;
  color: var(--accent);
}

.button-group {
  display: flex;
  gap: 12px;
}

.button-group button {
  flex: 1;
}

.new-house-form {
  padding: 16px;
  background: var(--bg-secondary);
  border-radius: 8px;
  margin-top: 16px;
}

.selected-devices-preview {
  margin-bottom: 16px;
  padding: 16px;
  background: var(--bg-secondary);
  border-radius: 8px;
}

.selected-devices-preview h4 {
  font-size: 14px;
  font-weight: 600;
  margin: 0 0 12px 0;
}

.device-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.device-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: var(--bg-card);
  border: 2px solid var(--border-input);
  border-radius: 20px;
  font-size: 14px;
}

.chip-remove {
  width: 20px;
  height: 20px;
  border: none;
  background: #f44336;
  color: white;
  border-radius: 50%;
  font-size: 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}

.chip-remove:hover {
  background: #d32f2f;
}

.step-description {
  font-size: 15px;
  color: var(--text-secondary);
  margin: -12px 0 20px 0;
}

.device-name-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 16px;
}

.device-name-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-input);
  border-radius: 8px;
}

.device-name-left {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.device-name-icon {
  font-size: 24px;
}

.type-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 10px;
  white-space: nowrap;
}

.type-badge.sensor {
  background: var(--sensor-bg);
  color: var(--sensor-accent);
}

.type-badge.actuator {
  background: var(--automation-bg);
  color: #e65100;
}

.device-name-input-wrap {
  flex: 1;
  min-width: 0;
}

.device-name-input-wrap .form-input {
  font-size: 16px;
  font-weight: 500;
  padding: 10px 14px;
}

.device-name-id {
  font-size: 11px;
  color: var(--text-muted);
  margin: 4px 0 0 0;
}

.device-name-status {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.status-dot.online {
  background: #4caf50;
}

.status-dot.offline {
  background: #f44336;
}

.status-text {
  font-size: 12px;
  color: var(--text-link);
  white-space: nowrap;
}

.opener-group-name-box {
  padding: 16px;
  background: var(--accent-bg);
  border: 1px solid var(--accent);
  border-radius: 8px;
  margin-bottom: 16px;
}

.opener-group-name-box label {
  display: block;
  font-weight: 600;
  font-size: 15px;
  margin-bottom: 8px;
  color: var(--text-primary);
}

.opener-group-name-box .help-text {
  font-size: 13px;
  color: var(--text-secondary);
  margin: 8px 0 0 0;
}

.register-summary {
  text-align: center;
  padding: 12px;
  background: var(--accent-bg);
  border-radius: 8px;
  margin-bottom: 16px;
  color: var(--accent);
  font-size: 14px;
}

.device-type-select {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.type-btn {
  padding: 6px 14px;
  border: 2px solid var(--border-input);
  border-radius: 8px;
  background: var(--bg-card);
  font-size: 14px;
  cursor: pointer;
  transition: border-color 0.2s, background 0.2s, color 0.2s;
  white-space: nowrap;
  color: var(--text-primary);
}

.type-btn.active {
  border-color: var(--accent);
  background: var(--accent-bg);
  color: var(--accent);
  font-weight: 600;
}

.type-btn:hover:not(.active) {
  border-color: var(--border-color);
  background: var(--bg-hover);
}

.equipment-type-select {
  flex-shrink: 0;
}

.equipment-select {
  padding: 8px 12px;
  border: 2px solid var(--border-input);
  border-radius: 8px;
  font-size: 14px;
  cursor: pointer;
  background: var(--bg-input);
  color: var(--text-primary);
}
.equipment-select:focus {
  outline: none;
  border-color: #2e7d32;
}

/* Step 4 위저드 스타일 */
.wizard-success-icon {
  font-size: 48px;
  text-align: center;
  margin-bottom: 12px;
}

.wizard-success-title {
  font-size: 20px;
  font-weight: 700;
  color: var(--text-primary);
  text-align: center;
  margin: 0 0 8px 0;
}

.wizard-success-desc {
  font-size: 15px;
  color: var(--text-secondary);
  text-align: center;
  margin: 0 0 28px 0;
}

.wizard-ask-buttons {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
}

.btn-wizard-option {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 20px 16px;
  border: 2px solid var(--border-input);
  border-radius: 12px;
  background: var(--bg-secondary);
  cursor: pointer;
  transition: border-color 0.2s, background 0.2s;
  color: var(--text-primary);
}

.btn-wizard-option:hover:not(:disabled) {
  border-color: var(--accent);
  background: var(--accent-bg);
}

.btn-wizard-option.disabled,
.btn-wizard-option:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.wizard-option-icon {
  font-size: 28px;
}

.wizard-option-label {
  font-size: 14px;
  font-weight: 600;
}

.wizard-option-hint {
  font-size: 11px;
  color: var(--text-muted);
}

.btn-skip {
  display: block;
  width: 100%;
  padding: 12px;
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 14px;
  cursor: pointer;
  text-align: center;
  text-decoration: underline;
}

.btn-skip:hover {
  color: var(--text-secondary);
}

.group-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 20px;
  max-height: 300px;
  overflow-y: auto;
}

.group-radio-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border: 2px solid var(--border-input);
  border-radius: 10px;
  background: var(--bg-secondary);
  cursor: pointer;
  transition: border-color 0.2s, background 0.2s;
}

.group-radio-item:hover {
  border-color: var(--accent);
  background: var(--accent-bg);
}

.group-radio-item.selected {
  border-color: var(--accent);
  background: var(--accent-bg);
}

.group-radio-item input[type="radio"] {
  width: 18px;
  height: 18px;
  accent-color: var(--accent);
  flex-shrink: 0;
}

.group-radio-name {
  flex: 1;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}

.group-radio-count {
  font-size: 13px;
  color: var(--text-muted);
}

@media (max-width: 768px) {
  .modal-overlay {
    padding: 0;
  }

  .modal-container {
    border-radius: 0;
    max-width: 100%;
    max-height: 100%;
    height: 100vh;
    height: 100dvh;
  }

  .modal-header {
    padding: 16px 20px;
    padding-top: calc(16px + env(safe-area-inset-top, 0px));
  }

  .modal-body {
    padding: 16px 20px;
    padding-bottom: calc(16px + env(safe-area-inset-bottom, 0px));
  }
}

@media (max-width: 480px) {
  .device-item-top {
    gap: 8px;
  }
  .device-info h4 {
    font-size: 14px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .device-id {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .device-item-bottom {
    flex-direction: row;
    gap: 8px;
  }
  .type-btn {
    padding: 4px 8px;
    font-size: 11px;
  }
  .equipment-select {
    padding: 4px 6px;
    font-size: 12px;
  }
}
</style>
