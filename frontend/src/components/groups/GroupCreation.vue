<template>
  <div v-if="show" class="modal-overlay" @click.self="closeModal">
    <div class="modal-container">
      <div class="modal-header">
        <h2>하우스 그룹 만들기</h2>
        <button class="close-btn" @click="closeModal">✕</button>
      </div>

      <div class="modal-body">
        <!-- 그룹 정보 입력 -->
        <div class="form-section">
          <h3>그룹 정보</h3>
          <div class="form-group">
            <label>그룹 이름 *</label>
            <input
              v-model="groupData.name"
              type="text"
              placeholder="예: 우용리 하우스 그룹"
              class="form-input"
            />
          </div>

          <div class="form-group">
            <label>설명</label>
            <textarea
              v-model="groupData.description"
              placeholder="그룹에 대한 설명을 입력하세요"
              class="form-textarea"
              rows="2"
            />
          </div>

          <div class="form-group">
            <label>관리자</label>
            <input
              v-model="groupData.manager"
              type="text"
              placeholder="담당자 이름"
              class="form-input"
            />
          </div>
        </div>

        <!-- 장비 선택 -->
        <div class="form-section">
          <h3>장비 할당</h3>
          <p class="section-desc">이 그룹에 포함할 센서와 장비를 선택하세요.</p>

          <div v-if="availableDevices.length === 0" class="empty-devices">
            <p>등록된 장비가 없습니다. 먼저 장비를 등록하세요.</p>
          </div>

          <template v-else>
            <div class="search-box">
              <input
                v-model="searchQuery"
                type="text"
                placeholder="장비 검색..."
                class="search-input"
              />
            </div>

            <!-- 센서 목록 -->
            <div v-if="filteredSensors.length > 0" class="device-type-section">
              <div class="type-label sensor">센서 ({{ filteredSensors.length }})</div>
              <div class="devices-list">
                <div
                  v-for="device in filteredSensors"
                  :key="device.id"
                  class="device-item"
                  :class="{ selected: selectedDeviceIds.includes(device.id) }"
                  @click="toggleDevice(device.id)"
                >
                  <input
                    type="checkbox"
                    :checked="selectedDeviceIds.includes(device.id)"
                    @click.stop
                    @change="toggleDevice(device.id)"
                  />
                  <div class="device-icon">{{ getCategoryIcon(device.category) }}</div>
                  <div class="device-info">
                    <h4>{{ device.name }}</h4>
                    <p class="device-meta">{{ device.category }}</p>
                  </div>
                  <span :class="['status-dot', device.online ? 'online' : 'offline']"></span>
                </div>
              </div>
            </div>

            <!-- 장비(액추에이터) 목록 -->
            <div v-if="filteredActuators.length > 0" class="device-type-section">
              <div class="type-label actuator">장비 ({{ filteredActuators.length }})</div>
              <div class="devices-list">
                <div
                  v-for="device in filteredActuators"
                  :key="device.id"
                  class="device-item"
                  :class="{ selected: selectedDeviceIds.includes(device.id) }"
                  @click="toggleDevice(device.id)"
                >
                  <input
                    type="checkbox"
                    :checked="selectedDeviceIds.includes(device.id)"
                    @click.stop
                    @change="toggleDevice(device.id)"
                  />
                  <div class="device-icon">{{ getCategoryIcon(device.category) }}</div>
                  <div class="device-info">
                    <h4>{{ device.name }}</h4>
                    <p class="device-meta">{{ device.category }}</p>
                  </div>
                  <span :class="['status-dot', device.online ? 'online' : 'offline']"></span>
                </div>
              </div>
            </div>
          </template>
        </div>

        <!-- 선택된 장비 미리보기 -->
        <div v-if="selectedDeviceIds.length > 0" class="form-section">
          <h3>선택된 장비 ({{ selectedDeviceIds.length }})</h3>
          <div class="selected-devices">
            <div
              v-for="deviceId in selectedDeviceIds"
              :key="deviceId"
              class="device-chip"
              :class="getDeviceById(deviceId)?.deviceType === 'sensor' ? 'sensor' : 'actuator'"
            >
              <span>{{ getCategoryIcon(getDeviceById(deviceId)?.category || '') }}</span>
              <span>{{ getDeviceById(deviceId)?.name }}</span>
              <button @click="removeDevice(deviceId)">✕</button>
            </div>
          </div>
        </div>

      </div>

      <div class="modal-footer">
        <button class="btn-secondary" @click="closeModal">취소</button>
        <button
          class="btn-primary"
          :disabled="!isValid || creating"
          @click="handleCreate"
        >
          <span v-if="creating">생성 중...</span>
          <span v-else>그룹 만들기</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useDeviceStore } from '../../stores/device.store'
import { useGroupStore } from '../../stores/group.store'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{
  close: []
  created: []
}>()

const deviceStore = useDeviceStore()
const groupStore = useGroupStore()

const searchQuery = ref('')
const selectedDeviceIds = ref<string[]>([])
const creating = ref(false)

const groupData = ref({
  name: '',
  description: '',
  manager: '',
})

watch(() => props.show, (open) => {
  if (open) {
    deviceStore.fetchDevices()
  }
})

const availableDevices = computed(() => deviceStore.devices)

const filteredSensors = computed(() => {
  const sensors = availableDevices.value.filter(d => d.deviceType === 'sensor')
  if (!searchQuery.value) return sensors
  const q = searchQuery.value.toLowerCase()
  return sensors.filter(d => d.name.toLowerCase().includes(q) || d.category.toLowerCase().includes(q))
})

const filteredActuators = computed(() => {
  const actuators = availableDevices.value.filter(d => d.deviceType === 'actuator')
  if (!searchQuery.value) return actuators
  const q = searchQuery.value.toLowerCase()
  return actuators.filter(d => d.name.toLowerCase().includes(q) || d.category.toLowerCase().includes(q))
})

const isValid = computed(() => groupData.value.name.trim() !== '')

const getDeviceById = (id: string) => availableDevices.value.find(d => d.id === id)

const getCategoryIcon = (category: string) => {
  const icons: Record<string, string> = {
    'wk': '💨', 'fs': '💨',
    'cl': '🚪', 'mc': '🚪',
    'dj': '💡', 'dd': '💡',
    'bh': '💦', 'sfkzq': '💦',
    'wsdcg': '🌡️',
    'co2bj': '🌫️',
    'ldcg': '🌱',
  }
  return icons[category] || '📦'
}

const toggleDevice = (deviceId: string) => {
  const index = selectedDeviceIds.value.indexOf(deviceId)
  if (index === -1) {
    selectedDeviceIds.value.push(deviceId)
  } else {
    selectedDeviceIds.value.splice(index, 1)
  }
}

const removeDevice = (deviceId: string) => {
  const index = selectedDeviceIds.value.indexOf(deviceId)
  if (index !== -1) {
    selectedDeviceIds.value.splice(index, 1)
  }
}

const handleCreate = async () => {
  if (!isValid.value) return
  creating.value = true

  try {
    const group = await groupStore.createGroup({
      name: groupData.value.name,
      description: groupData.value.description,
      manager: groupData.value.manager,
    })

    if (selectedDeviceIds.value.length > 0 && group?.id) {
      await groupStore.assignDevices(group.id, selectedDeviceIds.value)
    }

    emit('created')
    closeModal()
  } catch (err) {
    console.error('그룹 생성 실패:', err)
    alert('그룹 생성에 실패했습니다.')
  } finally {
    creating.value = false
  }
}

const closeModal = () => {
  emit('close')
  setTimeout(() => {
    groupData.value = {
      name: '',
      description: '',
      manager: '',
    }
    selectedDeviceIds.value = []
    searchQuery.value = ''
  }, 300)
}
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
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

.form-section {
  margin-bottom: 28px;
}

.form-section:last-child {
  margin-bottom: 0;
}

.form-section h3 {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 12px;
}

.section-desc {
  font-size: 14px;
  color: var(--text-secondary);
  margin: -4px 0 16px 0;
}

.form-group {
  margin-bottom: 16px;
}

.form-group:last-child {
  margin-bottom: 0;
}

.form-group label {
  display: block;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 8px;
}

.form-input,
.form-textarea {
  width: 100%;
  padding: 12px 14px;
  border: 2px solid var(--border-input);
  border-radius: 8px;
  font-size: 16px;
  transition: all 0.2s;
  font-family: inherit;
  background: var(--bg-input);
  color: var(--text-primary);
}

.form-input:focus,
.form-textarea:focus {
  outline: none;
  border-color: #4caf50;
  box-shadow: 0 0 0 3px rgba(76, 175, 80, 0.1);
}

.form-textarea {
  resize: vertical;
  min-height: 60px;
}

.search-box {
  margin-bottom: 12px;
}

.search-input {
  width: 100%;
  padding: 12px 14px;
  border: 2px solid var(--border-input);
  border-radius: 8px;
  font-size: 16px;
  background: var(--bg-input);
  color: var(--text-primary);
}

.search-input:focus {
  outline: none;
  border-color: var(--accent);
}

.empty-devices {
  padding: 32px 20px;
  text-align: center;
  background: var(--bg-secondary);
  border-radius: 8px;
}

.empty-devices p {
  color: var(--text-secondary);
  font-size: 15px;
  margin: 0;
}

.device-type-section {
  margin-bottom: 12px;
}

.type-label {
  font-size: 14px;
  font-weight: 600;
  padding: 8px 14px;
  border-radius: 6px 6px 0 0;
}

.type-label.sensor {
  background: var(--sensor-bg);
  color: var(--sensor-accent);
}

.type-label.actuator {
  background: var(--automation-bg);
  color: var(--automation-text);
}

.devices-list {
  border: 1px solid var(--border-input);
  border-top: none;
  border-radius: 0 0 8px 8px;
  max-height: 200px;
  overflow-y: auto;
}

.device-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border-light);
  cursor: pointer;
  transition: all 0.15s;
}

.device-item:last-child {
  border-bottom: none;
}

.device-item:hover {
  background: var(--bg-hover);
}

.device-item.selected {
  background: var(--accent-bg);
}

.device-item input[type="checkbox"] {
  width: 18px;
  height: 18px;
  cursor: pointer;
  flex-shrink: 0;
}

.device-icon {
  font-size: 22px;
  flex-shrink: 0;
}

.device-info {
  flex: 1;
  min-width: 0;
}

.device-info h4 {
  font-size: 16px;
  font-weight: 500;
  color: var(--text-primary);
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.device-meta {
  font-size: 13px;
  color: var(--text-secondary);
  margin: 2px 0 0 0;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.status-dot.online {
  background: #4caf50;
}

.status-dot.offline {
  background: #f44336;
}

.selected-devices {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.device-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border-radius: 16px;
  font-size: 13px;
}

.device-chip.sensor {
  background: var(--sensor-bg);
  border: 1px solid var(--sensor-accent);
  color: var(--sensor-accent);
}

.device-chip.actuator {
  background: var(--automation-bg);
  border: 1px solid var(--warning);
  color: var(--automation-text);
}

.device-chip button {
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  font-size: 14px;
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  color: inherit;
}

.device-chip button:hover {
  background: rgba(0, 0, 0, 0.1);
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 20px 24px;
  border-top: 1px solid var(--border-input);
}

.btn-primary,
.btn-secondary {
  padding: 12px 24px;
  border: none;
  border-radius: 10px;
  font-weight: 600;
  font-size: 16px;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-primary {
  background: #4caf50;
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background: #45a049;
}

.btn-primary:disabled {
  background: var(--text-muted);
  cursor: not-allowed;
  opacity: 0.6;
}

.btn-secondary {
  background: var(--bg-secondary);
  color: var(--text-primary);
}

.btn-secondary:hover {
  background: var(--bg-hover);
}

@media (max-width: 768px) {
  .modal-container {
    max-width: 100%;
    max-height: 100vh;
    border-radius: 0;
  }
}
</style>
