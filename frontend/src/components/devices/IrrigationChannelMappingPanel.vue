<template>
  <div v-if="authStore.isAdmin || authStore.isFarmAdmin" class="channel-mapping-panel">
    <label class="mapping-section-label">구역 매핑 설정</label>
    <div v-for="fnKey in MAPPING_FUNCTION_KEYS" :key="fnKey" class="mapping-row">
      <span class="mapping-fn-label">{{ FUNCTION_LABELS[fnKey as keyof ChannelMapping] }}</span>
      <select
        class="mapping-select"
        :value="effectiveMapping[fnKey as keyof ChannelMapping]"
        @change="handleMappingChange(String(fnKey), ($event.target as HTMLSelectElement).value)"
      >
        <option v-for="sw in AVAILABLE_SWITCH_CODES" :key="sw" :value="sw">{{ sw }}</option>
      </select>
    </div>
    <div class="mapping-actions">
      <button class="btn-mapping-save" @click="confirmSave">저장</button>
      <button class="btn-mapping-reset" @click="resetMapping">기본값</button>
    </div>
  </div>

  <!-- 저장 전 경고 확인 모달 -->
  <div v-if="showConfirm" class="mapping-confirm-overlay" @click.self="showConfirm = false">
    <div class="mapping-confirm-modal">
      <div class="confirm-icon">⚠️</div>
      <h4 class="confirm-title">구역 설정 변경 확인</h4>
      <div class="confirm-body">
        <p class="confirm-warning">
          <strong>주의:</strong> 컨트롤 박스의 각 스위치(포트)는 설치 시 특정 기능에 배선된 상태입니다.
        </p>
        <p class="confirm-warning">
          구역 설정을 변경하면 <strong>실제 배선과 불일치</strong>가 발생하여 <strong>오동작, 장치 손상 또는 안전 사고</strong>로 이어질 수 있습니다.
        </p>
        <p class="confirm-note">
          변경이 필요한 경우, 반드시 컨트롤 박스 배선 도면과 일치하는지 확인한 후 저장하세요.
        </p>
      </div>
      <div class="confirm-actions">
        <button class="btn-confirm-cancel" @click="showConfirm = false">취소</button>
        <button class="btn-confirm-ok" @click="saveMapping">배선 확인 완료 — 저장</button>
      </div>
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
const showConfirm = ref(false)

function confirmSave() {
  showConfirm.value = true
}

const effectiveMapping = computed(() => {
  if (pendingMapping.value) return pendingMapping.value as unknown as ChannelMapping
  return deviceStore.getEffectiveMapping(props.device)
})

function handleMappingChange(fnKey: string, switchCode: string) {
  const base = deviceStore.getEffectiveMapping(props.device)
  const current: Record<string, string> = pendingMapping.value
    ? { ...pendingMapping.value }
    : Object.fromEntries(Object.entries(base).map(([k, v]) => [k, v ?? '']))
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
  showConfirm.value = false
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

<style scoped>
.mapping-confirm-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
  padding: 16px;
}
.mapping-confirm-modal {
  background: var(--bg-card, #fff);
  border-radius: 16px;
  padding: 24px 20px;
  max-width: 400px;
  width: 100%;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);
}
.confirm-icon { font-size: 36px; text-align: center; margin-bottom: 8px; }
.confirm-title { font-size: 16px; font-weight: 700; color: #d32f2f; text-align: center; margin: 0 0 16px; }
.confirm-body { display: flex; flex-direction: column; gap: 10px; margin-bottom: 20px; }
.confirm-warning {
  font-size: 13px; line-height: 1.6; color: var(--text-primary, #333);
  background: #fff3e0; border-left: 3px solid #e65100;
  padding: 8px 12px; border-radius: 4px; margin: 0;
}
.confirm-note { font-size: 12px; color: var(--text-secondary, #666); margin: 0; line-height: 1.5; }
.confirm-actions { display: flex; gap: 8px; justify-content: flex-end; }
.btn-confirm-cancel {
  padding: 8px 18px; border: 1px solid var(--border-color, #ddd);
  background: none; border-radius: 8px; font-size: 13px; cursor: pointer; color: var(--text-secondary, #666);
}
.btn-confirm-cancel:hover { background: var(--bg-secondary); }
.btn-confirm-ok {
  padding: 8px 18px; background: #d32f2f; color: #fff;
  border: none; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer;
}
.btn-confirm-ok:hover { background: #b71c1c; }
#app.theme-dark .mapping-confirm-modal { background: var(--bg-card); }
#app.theme-dark .confirm-warning { background: #3e2723; }
</style>
