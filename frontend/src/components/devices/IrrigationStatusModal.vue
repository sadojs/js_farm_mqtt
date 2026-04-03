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
          <span class="col-label">채널</span>
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
            자동화: 활성 ({{ deviceStatus.enabledRuleCount }}개 룰)
          </span>
          <span v-else class="summary-text summary-inactive">자동화: 비활성</span>
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
import type { Device, ChannelMapping } from '@/types/device.types'
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
const mappingKeys = computed(() =>
  (Object.keys(FUNCTION_LABELS) as (keyof ChannelMapping)[]).filter(key => key in mapping.value)
)

const deviceStatus = computed(() =>
  props.device ? automationStore.getDeviceIrrigationStatus(props.device.id) : null
)

const remainingMinutes = computed(() => {
  if (!deviceStatus.value?.runningRule) return 0
  const remaining = deviceStatus.value.runningRule.estimatedEndAt - Date.now()
  return Math.max(0, Math.ceil(remaining / 60000))
})

// 해당 장치의 활성 자동화 룰에서 구역별 ON/OFF 설정 추출
const zoneAutoMap = computed<Record<string, 'on' | 'off'>>(() => {
  if (!props.device) return {}
  const deviceId = props.device.id
  const result: Record<string, 'on' | 'off'> = {}

  // 해당 장치의 모든 활성 irrigation 룰에서 구역 설정 수집
  for (const rule of automationStore.rules) {
    if (!rule.enabled) continue
    const cond = rule.conditions as any
    if (cond?.type !== 'irrigation') continue
    const actions = rule.actions as any
    const ruleDeviceIds: string[] = []
    if (actions?.targetDeviceId) ruleDeviceIds.push(actions.targetDeviceId)
    if (Array.isArray(actions?.targetDeviceIds)) ruleDeviceIds.push(...actions.targetDeviceIds)
    if (!ruleDeviceIds.includes(deviceId)) continue

    // zones 배열에서 각 구역의 enabled 상태
    for (const zone of (cond.zones || [])) {
      const fnKey = `zone_${zone.zone}`
      // 여러 룰에서 하나라도 enabled이면 'on'
      if (zone.enabled) result[fnKey] = 'on'
      else if (!result[fnKey]) result[fnKey] = 'off'
    }

    // mixer
    if (cond.mixer?.enabled) result['mixer'] = 'on'
    else if (!result['mixer']) result['mixer'] = 'off'

    // fertilizer_motor (enabled 필드 체크, 하위호환: enabled 없으면 duration > 0으로 판단)
    const fertEnabled = cond.fertilizer?.enabled !== false && cond.fertilizer?.duration > 0
    if (fertEnabled) result['fertilizer_motor'] = 'on'
    else if (!result['fertilizer_motor']) result['fertilizer_motor'] = 'off'
  }

  return result
})

// 자동화 설정 표시 대상 여부
function isZoneOrControl(fnKey: string): boolean {
  return fnKey.startsWith('zone_') || fnKey === 'mixer' || fnKey === 'fertilizer_motor'
}

// 자동화 룰에서의 해당 채널 ON/OFF 상태
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
