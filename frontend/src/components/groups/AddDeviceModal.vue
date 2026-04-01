<template>
  <div v-if="show && targetGroup" class="modal-overlay" @click.self="$emit('close')">
    <div class="add-device-modal">
      <div class="add-modal-header">
        <h3>{{ targetGroup?.name }}에 장비 추가</h3>
        <button class="close-btn" @click="$emit('close')">✕</button>
      </div>
      <div class="add-modal-body">
        <div v-if="unassignedDevices.length === 0" class="empty-state-sm">
          <p>추가할 수 있는 장비가 없습니다.</p>
        </div>
        <template v-else>
          <div
            v-for="device in unassignedDevices"
            :key="device.id"
            class="device-row clickable"
            :class="{ selected: selected.includes(device.id) }"
            @click="toggleDevice(device.id)"
          >
            <input type="checkbox" :checked="selected.includes(device.id)" @click.stop />
            <span class="device-row-icon">{{ getCategoryIcon(device.category) }}</span>
            <span :class="['type-tag', device.deviceType === 'sensor' ? 'sensor' : 'actuator']">
              {{ device.deviceType === 'sensor' ? '센서' : '장비' }}
            </span>
            <span class="device-row-name">{{ device.name }}</span>
            <span :class="['status-indicator', device.online ? 'online' : 'offline']">
              {{ device.online ? '온라인' : '오프라인' }}
            </span>
          </div>
        </template>
      </div>
      <div class="add-modal-footer">
        <button class="btn-secondary" @click="$emit('close')">취소</button>
        <button
          class="btn-primary"
          :disabled="selected.length === 0 || adding"
          @click="confirmAdd"
        >
          <span v-if="adding">추가 중...</span>
          <span v-else>{{ selected.length === 0 ? '장비를 선택하세요' : `${selected.length}개 추가` }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useGroupStore } from '../../stores/group.store'
import { useDeviceStore } from '../../stores/device.store'
import type { HouseGroup } from '../../types/group.types'
import type { Device } from '../../types/device.types'

const props = defineProps<{
  show: boolean
  targetGroup: HouseGroup | null
  unassignedDevices: Device[]
}>()

const emit = defineEmits<{
  close: []
  added: []
}>()

const groupStore = useGroupStore()
const deviceStore = useDeviceStore()
const selected = ref<string[]>([])
const adding = ref(false)

watch(() => props.show, (val) => {
  if (val) selected.value = []
})

const getCategoryIcon = (category: string) => {
  const icons: Record<string, string> = {
    'wk': '💨',
    'fs': '💨',
    'cl': '🚪',
    'mc': '🚪',
    'dj': '💡',
    'dd': '💡',
    'bh': '💦',
    'sfkzq': '💦',
    'wsdcg': '🌡️',
    'co2bj': '🌫️',
    'ldcg': '🌱',
  }
  return icons[category] || '📦'
}

const toggleDevice = (deviceId: string) => {
  const idx = selected.value.indexOf(deviceId)
  if (idx === -1) selected.value.push(deviceId)
  else selected.value.splice(idx, 1)
}

const confirmAdd = async () => {
  if (!props.targetGroup) return
  adding.value = true
  try {
    const idsToAdd = [...selected.value]
    for (const id of selected.value) {
      const dev = deviceStore.devices.find(d => d.id === id)
      if (dev?.equipmentType === 'opener_open' && dev.pairedDeviceId && !idsToAdd.includes(dev.pairedDeviceId)) {
        idsToAdd.push(dev.pairedDeviceId)
      }
    }
    await groupStore.assignDevices(props.targetGroup.id, idsToAdd)
    emit('added')
    emit('close')
  } catch (err) {
    console.error('장비 추가 실패:', err)
    alert('장비 추가에 실패했습니다.')
  } finally {
    adding.value = false
  }
}
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 20px;
}

.add-device-modal {
  background: var(--bg-card);
  border-radius: 16px;
  width: 100%;
  max-width: 550px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-modal);
}

.add-modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 24px;
  border-bottom: 1px solid var(--border-color);
}

.add-modal-header h3 {
  font-size: calc(18px * var(--content-scale, 1));
  font-weight: 600;
  margin: 0;
}

.add-modal-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px 24px;
  max-height: 400px;
}

.add-modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 24px;
  border-top: 1px solid var(--border-color);
}

.close-btn {
  background: none;
  border: none;
  font-size: 20px;
  color: var(--text-muted);
  cursor: pointer;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.close-btn:hover {
  color: var(--text-primary);
}

.btn-primary {
  padding: 14px 28px;
  background: var(--accent);
  color: white;
  border: none;
  border-radius: 8px;
  font-weight: 600;
  font-size: calc(16px * var(--content-scale, 1));
  cursor: pointer;
  transition: background 0.2s;
}

.btn-primary:hover:not(:disabled) {
  background: var(--accent-hover);
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-secondary {
  padding: 10px 20px;
  background: var(--bg-hover);
  color: var(--text-primary);
  border: none;
  border-radius: 8px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s;
}

.btn-secondary:hover {
  background: var(--border-color);
}

.device-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  font-size: calc(14px * var(--content-scale, 1));
  border-bottom: 1px solid var(--border-light);
}

.device-row:last-child {
  border-bottom: none;
}

.device-row.clickable {
  cursor: pointer;
}

.device-row.clickable:hover {
  background: var(--bg-hover);
}

.device-row.selected {
  background: var(--accent-bg);
}

.device-row input[type="checkbox"] {
  width: 16px;
  height: 16px;
  cursor: pointer;
  flex-shrink: 0;
}

.device-row-icon {
  font-size: calc(18px * var(--content-scale, 1));
  flex-shrink: 0;
}

.device-row-name {
  flex: 1;
}

.type-tag {
  font-size: calc(13px * var(--content-scale, 1));
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 6px;
  flex-shrink: 0;
}

.type-tag.sensor {
  background: var(--sensor-bg);
  color: var(--sensor-accent);
}

.type-tag.actuator {
  background: var(--accent-bg);
  color: var(--accent);
}

.status-indicator {
  font-size: calc(13px * var(--content-scale, 1));
  font-weight: 500;
  flex-shrink: 0;
  padding: 2px 8px;
  border-radius: 8px;
}

.status-indicator.online {
  background: var(--accent-bg);
  color: var(--accent);
}

.status-indicator.offline {
  background: var(--danger-bg);
  color: var(--danger);
}

.empty-state-sm {
  padding: 32px;
  text-align: center;
  color: var(--text-muted);
}

@media (max-width: 768px) {
  .modal-overlay {
    padding: 0;
  }

  .add-device-modal {
    border-radius: 0;
    max-width: 100%;
    max-height: 100%;
    height: 100vh;
    height: 100dvh;
    overflow-y: auto;
    padding-bottom: env(safe-area-inset-bottom, 0);
  }

  .add-modal-header {
    padding-top: calc(16px + env(safe-area-inset-top, 0px));
  }
}
</style>
