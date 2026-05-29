<template>
  <div v-if="visible && device" class="modal-overlay" @click.self="$emit('close')">
    <div class="status-modal">
      <div class="status-modal-header">
        <h3>{{ device.name }} - 스위치 상태</h3>
        <button class="close-btn" @click="$emit('close')">✕</button>
      </div>
      <div class="status-modal-body">
        <!-- 컬럼 헤더 -->
        <div class="status-header-row">
          <span class="col-label">구역</span>
          <span class="col-auto">자동화</span>
          <span class="col-state">상태</span>
        </div>
        <div
          v-for="fnKey in mappingKeys"
          :key="fnKey"
          class="status-row"
        >
          <span class="status-row-label">{{ FUNCTION_LABELS[fnKey] || fnKey }}</span>
          <span class="status-row-auto">
            <template v-if="isZoneOrControl(fnKey)">
              <span v-if="getAutoState(fnKey) === 'on'" class="badge-auto on">ON</span>
              <span v-else-if="getAutoState(fnKey) === 'off'" class="badge-auto off">OFF</span>
              <span v-else class="badge-auto none">-</span>
            </template>
          </span>
          <div class="status-row-right">
            <span
              v-if="device.switchStates?.[mapping[fnKey] ?? ''] && deviceStatus?.isRunning"
              class="badge-running"
            >가동중</span>
            <span
              class="status-row-value"
              :class="device.switchStates?.[mapping[fnKey] ?? ''] ? 'on' : 'off'"
            >
              {{ device.switchStates?.[mapping[fnKey] ?? ''] ? 'ON' : 'OFF' }}
            </span>
          </div>
        </div>
      </div>
      <!-- 자동화 요약 섹션 -->
      <div v-if="deviceStatus" class="automation-summary">
        <div class="summary-row">
          <span class="summary-icon">🤖</span>
          <span v-if="deviceStatus.enabledRuleCount > 0" class="summary-text">
            자동 제어: 활성 ({{ deviceStatus.enabledRuleCount }}개 설정)
          </span>
          <span v-else class="summary-text summary-inactive">자동 제어: 비활성</span>
        </div>
        <div v-if="deviceStatus.isRunning && deviceStatus.runningRule" class="summary-row">
          <span class="summary-icon">⏱</span>
          <span class="summary-text summary-running">
            현재: "{{ deviceStatus.runningRule.ruleName }}" 가동중
            <template v-if="remainingMinutes > 0">({{ remainingMinutes }}분 남음)</template>
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import type { Device } from '@/types/device.types'
import { FUNCTION_LABELS } from '@/types/device.types'
import { useDeviceStore } from '@/stores/device.store'
import { useAutomationStore } from '@/stores/automation.store'

const props = defineProps<{
  visible: boolean
  device: Device | null
}>()
defineEmits<{ close: [] }>()

const deviceStore = useDeviceStore()
const automationStore = useAutomationStore()

const mapping = computed<Record<string, string | undefined>>(() =>
  props.device ? deviceStore.getEffectiveMapping(props.device) : {}
)
// 비활성 채널 제외 — disabledChannels(zigbee 토글) 또는 빈 매핑 모두 제외
const mappingKeys = computed(() => {
  const disabled = new Set<string>((props.device as any)?.disabledChannels ?? [])
  return Object.keys(FUNCTION_LABELS).filter(key => {
    if (disabled.has(key)) return false
    const v = mapping.value[key]
    return v !== undefined && v !== ''
  })
})

const deviceStatus = computed(() =>
  props.device ? automationStore.getDeviceIrrigationStatus(props.device.id) : null
)

const remainingMinutes = computed(() => {
  if (!deviceStatus.value?.runningRule) return 0
  const remaining = deviceStatus.value.runningRule.estimatedEndAt - Date.now()
  return Math.max(0, Math.ceil(remaining / 60000))
})

// 자동화 상태 = 환경설정 채널 활성 여부.
// (각 룰별 zone enabled는 별개로 관리되므로 룰 검사하지 않음 — 단순히 게이트웨이 환경설정의
//  채널 활성화/비활성화만 반영. 비활성 채널은 mappingKeys 필터에서 이미 제외됨.)
const zoneAutoMap = computed<Record<string, 'on' | 'off'>>(() => {
  if (!props.device) return {}
  const disabled = new Set<string>((props.device as any).disabledChannels ?? [])
  const result: Record<string, 'on' | 'off'> = {}
  for (const key of mappingKeys.value) {
    result[key] = disabled.has(key) ? 'off' : 'on'
  }
  return result
})

// 자동화 설정 표시 대상 여부
function isZoneOrControl(fnKey: string): boolean {
  return fnKey.startsWith('zone_') || fnKey === 'mixer' || fnKey === 'fertilizer_motor'
}

// 자동 제어 설정에서의 해당 구역 ON/OFF 상태
function getAutoState(fnKey: string): 'on' | 'off' | null {
  return zoneAutoMap.value[fnKey] || null
}

onMounted(() => {
  automationStore.fetchIrrigationStatus()
  if (automationStore.rules.length === 0) {
    automationStore.fetchRules()
  }
})
</script>

<style scoped>
.modal-overlay {
  position: fixed; top: 0; left: 0; right: 0; bottom: 0;
  background: var(--overlay); display: flex; align-items: center;
  justify-content: center; z-index: 1000; padding: 20px;
}
.status-modal {
  background: var(--bg-card); border-radius: 16px; width: 100%;
  max-width: 460px; box-shadow: var(--shadow-modal);
  max-height: calc(100vh - 40px); display: flex; flex-direction: column;
}
.status-modal-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 20px 24px; border-bottom: 1px solid var(--border-color);
}
.status-modal-header h3 { font-size: calc(18px * var(--content-scale, 1)); font-weight: 600; margin: 0; }
.close-btn {
  background: none; border: none; font-size: 20px; color: var(--text-muted);
  cursor: pointer; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;
}
.status-modal-body { padding: 16px 24px 0; }

.status-header-row {
  display: flex; align-items: center; padding: 0 0 8px;
  border-bottom: 2px solid var(--border-color);
  font-size: calc(12px * var(--content-scale, 1)); font-weight: 600; color: var(--text-muted);
}
.col-label { flex: 1; }
.col-auto { width: 56px; text-align: center; }
.col-state { width: 100px; text-align: right; }

.status-row {
  display: flex; align-items: center;
  padding: 10px 0; border-bottom: 1px solid var(--border-light);
}
.status-row:last-child { border-bottom: none; }
.status-row-label { flex: 1; font-size: calc(14px * var(--content-scale, 1)); font-weight: 500; color: var(--text-primary); }
.status-row-auto { width: 56px; text-align: center; }
.status-row-right { width: 100px; display: flex; align-items: center; justify-content: flex-end; gap: 6px; }

.badge-auto {
  display: inline-block; font-size: calc(11px * var(--content-scale, 1)); font-weight: 600;
  padding: 2px 8px; border-radius: 4px;
}
.badge-auto.on { background: #e8f5e9; color: #2e7d32; }
.badge-auto.off { background: var(--bg-badge); color: var(--text-muted); }
.badge-auto.none { color: var(--text-disabled); }

.status-row-value { font-size: calc(14px * var(--content-scale, 1)); font-weight: 600; padding: 4px 12px; border-radius: 6px; }
.status-row-value.on { background: var(--accent-bg); color: var(--accent); }
.status-row-value.off { background: var(--bg-badge); color: var(--text-muted); }
.badge-running {
  font-size: calc(11px * var(--content-scale, 1)); font-weight: 600; padding: 2px 8px;
  border-radius: 4px; background: #e3f2fd; color: #1565c0;
}

.automation-summary {
  padding: 16px 24px 20px;
  border-top: 1px solid var(--border-light);
}
.summary-row {
  display: flex; align-items: center; gap: 8px; padding: 4px 0;
}
.summary-icon { font-size: calc(15px * var(--content-scale, 1)); }
.summary-text { font-size: calc(13px * var(--content-scale, 1)); font-weight: 500; color: var(--text-primary); }
.summary-inactive { color: var(--text-muted); }
.summary-running { color: #1565c0; }
</style>
