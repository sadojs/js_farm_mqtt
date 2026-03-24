<template>
  <div class="step-sensor">
    <h3 class="step-title">센서 선택</h3>
    <p class="step-desc">조건으로 사용할 센서를 선택하거나, 시간 기반 자동화를 설정하세요</p>

    <!-- 센서 미선택 (시간 기반) 옵션 -->
    <div
      class="device-card no-sensor-card"
      :class="{ selected: noSensorMode }"
      @click="selectNoSensor"
    >
      <div class="device-icon">🕐</div>
      <div class="device-info">
        <div class="device-name">센서 미선택 (시간 기반)</div>
        <div class="device-meta">
          <span class="category">시간 조건만으로 자동화를 설정합니다</span>
        </div>
      </div>
      <div class="check-box" :class="{ checked: noSensorMode }">
        <span v-if="noSensorMode">✓</span>
      </div>
    </div>

    <div v-if="sensors.length === 0 && !noSensorMode" class="empty">
      선택한 그룹에 센서가 없습니다.
    </div>
    <div v-if="sensors.length > 0" class="device-list">
      <div
        v-for="device in sensors"
        :key="device.id"
        class="device-card"
        :class="{ selected: modelValue.includes(device.id) }"
        @click="toggle(device.id)"
      >
        <div class="device-icon">🌡️</div>
        <div class="device-info">
          <div class="device-name">{{ device.name }}</div>
          <div class="device-meta">
            <span class="category">{{ device.category }}</span>
            <span class="status" :class="{ online: device.online }">
              {{ device.online ? '온라인' : '오프라인' }}
            </span>
          </div>
        </div>
        <div class="check-box" :class="{ checked: modelValue.includes(device.id) }">
          <span v-if="modelValue.includes(device.id)">✓</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useGroupStore } from '../../stores/group.store'

const props = defineProps<{
  modelValue: string[]
  groupId?: string
  noSensor?: boolean
}>()
const emit = defineEmits<{
  'update:modelValue': [value: string[]]
  'update:noSensor': [value: boolean]
}>()

const groupStore = useGroupStore()

const noSensorMode = computed(() => props.noSensor === true)

const sensors = computed(() => {
  if (!props.groupId) return []
  const group = groupStore.groups.find(g => g.id === props.groupId)
  if (!group) return []
  return (group.devices || []).filter(d => d.deviceType === 'sensor')
})

function selectNoSensor() {
  if (noSensorMode.value) {
    // 센서 미선택 해제
    emit('update:noSensor', false)
  } else {
    // 센서 미선택 활성화 → 센서 목록 초기화
    emit('update:modelValue', [])
    emit('update:noSensor', true)
  }
}

function toggle(deviceId: string) {
  // 센서 선택 시 미선택 모드 해제
  if (noSensorMode.value) {
    emit('update:noSensor', false)
  }
  const current = [...props.modelValue]
  const idx = current.indexOf(deviceId)
  if (idx >= 0) {
    current.splice(idx, 1)
  } else {
    current.push(deviceId)
  }
  emit('update:modelValue', current)
}
</script>

<style scoped>
.step-sensor { display: flex; flex-direction: column; gap: 16px; }
.step-title { font-size: 18px; font-weight: 700; color: var(--text-primary); margin: 0; }
.step-desc { font-size: 14px; color: var(--text-muted); margin: 0; }

.empty {
  text-align: center; padding: 32px; color: var(--text-muted); font-size: 14px;
}

.device-list { display: flex; flex-direction: column; gap: 8px; }

.device-card {
  display: flex; align-items: center; gap: 12px;
  padding: 14px 16px; border: 2px solid var(--border-input); border-radius: 12px;
  cursor: pointer; transition: all 0.15s;
}
.device-card:hover { border-color: #bbdefb; background: var(--bg-hover); }
.device-card.selected { border-color: #2196f3; background: rgba(33, 150, 243, 0.1); }

.no-sensor-card { border-style: dashed; }
.no-sensor-card.selected { border-style: solid; border-color: #ff9800; background: rgba(255, 152, 0, 0.1); }

.device-icon { font-size: 24px; }
.device-info { flex: 1; }
.device-name { font-size: 15px; font-weight: 600; color: var(--text-primary); }
.device-meta { display: flex; gap: 8px; align-items: center; margin-top: 2px; }
.category { font-size: 13px; color: var(--text-muted); }
.status { font-size: 12px; padding: 2px 8px; border-radius: 10px; background: var(--bg-secondary); color: var(--text-muted); }
.status.online { background: #e8f5e9; color: #4caf50; }

.check-box {
  width: 22px; height: 22px; border-radius: 6px; border: 2px solid var(--border-input);
  display: flex; align-items: center; justify-content: center;
  font-size: 13px; font-weight: 700; color: white; transition: all 0.15s;
}
.check-box.checked { background: #2196f3; border-color: #2196f3; }
.no-sensor-card .check-box.checked { background: #ff9800; border-color: #ff9800; }
</style>
