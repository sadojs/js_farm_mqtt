<template>
  <div v-if="authStore.isAdmin || authStore.isFarmAdmin" class="channel-mapping-panel">
    <label class="mapping-section-label">구역 매핑 설정</label>
    <div v-for="fnKey in MAPPING_FUNCTION_KEYS" :key="fnKey" class="mapping-row">
      <span class="mapping-fn-label">{{ FUNCTION_LABELS[fnKey as keyof ChannelMapping] }}</span>
      <select
        class="mapping-select"
        :value="effectiveMapping[fnKey as keyof ChannelMapping]"
        @change="handleMappingChange(fnKey, ($event.target as HTMLSelectElement).value)"
      >
        <option v-for="sw in AVAILABLE_SWITCH_CODES" :key="sw" :value="sw">{{ sw }}</option>
      </select>
    </div>
    <div class="mapping-actions">
      <button class="btn-mapping-save" @click="saveMapping">저장</button>
      <button class="btn-mapping-reset" @click="resetMapping">기본값</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useDeviceStore } from '@/stores/device.store'
import { useAuthStore } from '@/stores/auth.store'
import { useNotificationStore } from '@/stores/notification.store'
import type { Device, ChannelMapping } from '@/types/device.types'
import { DEFAULT_CHANNEL_MAPPING, FUNCTION_LABELS, AVAILABLE_SWITCH_CODES } from '@/types/device.types'

const props = defineProps<{
  device: Device
}>()

const deviceStore = useDeviceStore()
const authStore = useAuthStore()
const notify = useNotificationStore()

const MAPPING_FUNCTION_KEYS = Object.keys(DEFAULT_CHANNEL_MAPPING) as (keyof ChannelMapping)[]

const pendingMapping = ref<Record<string, string> | null>(null)

const effectiveMapping = computed(() => {
  if (pendingMapping.value) return pendingMapping.value as unknown as ChannelMapping
  return deviceStore.getEffectiveMapping(props.device)
})

function handleMappingChange(fnKey: string, switchCode: string) {
  const current = pendingMapping.value ?? { ...deviceStore.getEffectiveMapping(props.device) }
  // 중복 시 기존 보유자 초기화
  for (const k of Object.keys(current)) {
    if (k !== fnKey && current[k] === switchCode) current[k] = ''
  }
  current[fnKey] = switchCode
  pendingMapping.value = current
  // 즉시 UI 반영
  const storeDevice = deviceStore.devices.find(d => d.id === props.device.id)
  if (storeDevice) {
    if (!storeDevice.channelMapping) storeDevice.channelMapping = { ...DEFAULT_CHANNEL_MAPPING }
    Object.assign(storeDevice.channelMapping, current)
  }
}

async function saveMapping() {
  const mapping = pendingMapping.value ?? deviceStore.getEffectiveMapping(props.device)
  try {
    await deviceStore.updateChannelMapping(props.device.id, mapping as ChannelMapping)
    pendingMapping.value = null
    notify.success('저장 완료', '구역 매핑이 저장되었습니다')
  } catch {
    notify.error('저장 실패', '구역 매핑 저장에 실패했습니다')
  }
}

function resetMapping() {
  const storeDevice = deviceStore.devices.find(d => d.id === props.device.id)
  if (storeDevice) storeDevice.channelMapping = { ...DEFAULT_CHANNEL_MAPPING }
  pendingMapping.value = null
}
</script>
