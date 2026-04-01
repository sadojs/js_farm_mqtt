<template>
  <div v-if="visible && device" class="modal-overlay" @click.self="$emit('close')">
    <div class="status-modal">
      <div class="status-modal-header">
        <h3>{{ device.name }} - 스위치 상태</h3>
        <button class="close-btn" @click="$emit('close')">✕</button>
      </div>
      <div class="status-modal-body">
        <div
          v-for="sw in AVAILABLE_SWITCH_CODES"
          :key="sw"
          class="status-row"
        >
          <span class="status-row-label">{{ getMappingLabel(sw) }}</span>
          <span
            class="status-row-value"
            :class="device.switchStates?.[sw] ? 'on' : 'off'"
          >
            {{ device.switchStates?.[sw] ? 'ON' : 'OFF' }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useDeviceStore } from '@/stores/device.store'
import type { Device, ChannelMapping } from '@/types/device.types'
import { FUNCTION_LABELS, AVAILABLE_SWITCH_CODES } from '@/types/device.types'

const props = defineProps<{
  visible: boolean
  device: Device | null
}>()

defineEmits<{
  close: []
}>()

const deviceStore = useDeviceStore()

function getMappingLabel(switchCode: string): string {
  if (!props.device) return switchCode
  const mapping = deviceStore.getEffectiveMapping(props.device)
  const found = (Object.entries(mapping) as [keyof ChannelMapping, string][]).find(([, sw]) => sw === switchCode)
  return found ? FUNCTION_LABELS[found[0]] : switchCode
}
</script>

<style scoped>
.modal-overlay {
  position: fixed; top: 0; left: 0; right: 0; bottom: 0;
  background: var(--overlay);
  display: flex; align-items: center; justify-content: center;
  z-index: 1000; padding: 20px;
}
.status-modal {
  background: var(--bg-card); border-radius: 16px; width: 100%; max-width: 420px;
  box-shadow: var(--shadow-modal);
}
.status-modal-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 20px 24px; border-bottom: 1px solid var(--border-color);
}
.status-modal-header h3 { font-size: calc(18px * var(--content-scale, 1)); font-weight: 600; margin: 0; }
.status-modal-body { padding: 16px 24px 24px; }
.status-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 0; border-bottom: 1px solid var(--border-light);
}
.status-row:last-child { border-bottom: none; }
.status-row-label { font-size: calc(15px * var(--content-scale, 1)); font-weight: 500; color: var(--text-primary); }
.status-row-value { font-size: calc(14px * var(--content-scale, 1)); font-weight: 600; padding: 4px 12px; border-radius: 6px; }
.status-row-value.on { background: var(--accent-bg); color: var(--accent); }
.status-row-value.off { background: var(--bg-badge); color: var(--text-muted); }
.close-btn {
  background: none; border: none; font-size: 20px; color: var(--text-muted);
  cursor: pointer; width: 32px; height: 32px;
  display: flex; align-items: center; justify-content: center;
}
</style>
