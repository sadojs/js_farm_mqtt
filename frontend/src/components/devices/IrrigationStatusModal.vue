<template>
  <div v-if="visible && device" class="modal-overlay" @click.self="$emit('close')">
    <div class="status-modal">
      <div class="status-modal-header">
        <h3>{{ device.name }} - 스위치 상태</h3>
        <span v-if="timerSummary" class="hdr-timer-badge">
          <span class="timer-dot"></span>⏱ 타이머 {{ timerSummary.count }}
        </span>
        <button class="close-btn" @click="$emit('close')">✕</button>
      </div>
      <div class="status-modal-body">
        <!-- 컬럼 헤더 -->
        <div class="status-header-row">
          <span class="col-label">구역</span>
          <span class="col-auto">자동화</span>
          <span class="col-state">상태 · 타이머</span>
        </div>
        <div
          v-for="fnKey in mappingKeys"
          :key="fnKey"
          class="status-row"
          :class="{ 'timer-active': isActive(channelUntil(fnKey)) }"
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
            <!-- 타이머 활성: 카운트다운 + 해제 -->
            <span v-if="isActive(channelUntil(fnKey))" class="timer-badge" @click="cancelChannelTimer(fnKey)" title="타이머 해제 → 자동제어 복귀">
              <span class="timer-dot"></span>{{ formatCountdown(channelUntil(fnKey)) }}<span class="timer-x">✕</span>
            </span>
            <template v-else>
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
              <!-- 타이머 설정 (zone_* 만 — 원격제어·액비·교반기 제외) -->
              <button
                v-if="isTimerable(fnKey) && device.online"
                class="btn-timer-sm"
                :title="`${FUNCTION_LABELS[fnKey] || fnKey} 타이머 설정`"
                @click="openChannelSheet(fnKey)"
              >⏱</button>
            </template>
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

    <!-- 채널 타이머 시트 -->
    <DeviceTimerSheet
      :visible="channelSheetOpen"
      :title="channelSheetTitle"
      subtitle="설정 시간 동안 이 채널만 강제 관수하고, 만료 시 자동제어로 복귀합니다."
      :submitting="channelSubmitting"
      @close="channelSheetOpen = false"
      @start="onChannelTimerStart"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { Device } from '@/types/device.types'
import { FUNCTION_LABELS } from '@/types/device.types'
import { useDeviceStore } from '@/stores/device.store'
import { useAutomationStore } from '@/stores/automation.store'
import { useNotificationStore } from '@/stores/notification.store'
import { deviceApi } from '@/api/device.api'
import { useTimerTick } from '@/composables/useTimerTick'
import DeviceTimerSheet from './DeviceTimerSheet.vue'

const props = defineProps<{
  visible: boolean
  device: Device | null
}>()
const emit = defineEmits<{ close: []; changed: [] }>()

const deviceStore = useDeviceStore()
const automationStore = useAutomationStore()
const notify = useNotificationStore()
const { formatCountdown, isActive } = useTimerTick()

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
// 타이머 가능 채널 — zone_* 만 (원격제어·액비/교반기·모터 제외)
function isTimerable(fnKey: string): boolean {
  return fnKey.startsWith('zone_')
}

function getAutoState(fnKey: string): 'on' | 'off' | null {
  return zoneAutoMap.value[fnKey] || null
}

// ── 채널별 타이머 ──
function channelUntil(fnKey: string): string | null {
  const ov = (props.device as any)?.channelOverrides as Record<string, { until: string }> | undefined
  return ov?.[fnKey]?.until ?? null
}
const timerSummary = computed(() => {
  const ov = (props.device as any)?.channelOverrides as Record<string, { until: string }> | undefined
  if (!ov) return null
  const count = Object.keys(ov).filter(k => isActive(ov[k]?.until)).length
  return count > 0 ? { count } : null
})

const channelSheetOpen = ref(false)
const channelSheetKey = ref<string | null>(null)
const channelSheetTitle = ref('')
const channelSubmitting = ref(false)

function openChannelSheet(fnKey: string) {
  channelSheetKey.value = fnKey
  channelSheetTitle.value = `${FUNCTION_LABELS[fnKey] || fnKey} 타이머`
  channelSheetOpen.value = true
}

async function onChannelTimerStart(payload: { durationMinutes: number }) {
  if (!props.device || !channelSheetKey.value) return
  channelSubmitting.value = true
  try {
    await deviceApi.setTimer(props.device.id, {
      channelKey: channelSheetKey.value,
      durationMinutes: payload.durationMinutes,
    })
    channelSheetOpen.value = false
    notify.success('타이머 시작', `${FUNCTION_LABELS[channelSheetKey.value] || channelSheetKey.value} — ${payload.durationMinutes}분`)
    await deviceStore.fetchDevices()
    emit('changed')
  } catch (err: any) {
    notify.error('타이머 실패', err?.response?.data?.message || '타이머 설정에 실패했습니다')
  } finally {
    channelSubmitting.value = false
  }
}

async function cancelChannelTimer(fnKey: string) {
  if (!props.device) return
  try {
    await deviceApi.cancelTimer(props.device.id, { channelKey: fnKey })
    notify.info('타이머 해제', `${FUNCTION_LABELS[fnKey] || fnKey} — 자동제어로 복귀`)
    await deviceStore.fetchDevices()
    emit('changed')
  } catch {
    notify.error('해제 실패', '타이머 해제에 실패했습니다')
  }
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
  display: flex; justify-content: space-between; align-items: center; gap: 8px;
  padding: 20px 24px; border-bottom: 1px solid var(--border-color);
}
.status-modal-header h3 { font-size: calc(18px * var(--content-scale, 1)); font-weight: 600; margin: 0; flex: 1; }
.hdr-timer-badge {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: calc(11px * var(--content-scale, 1)); font-weight: 800;
  padding: 3px 9px; border-radius: 999px;
  background: #ecfeff; color: #0e7490; border: 1px solid #67e8f9; white-space: nowrap;
}
.close-btn {
  background: none; border: none; font-size: 20px; color: var(--text-muted);
  cursor: pointer; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;
}
.status-modal-body { padding: 16px 24px 0; overflow-y: auto; }

.status-header-row {
  display: flex; align-items: center; padding: 0 0 8px;
  border-bottom: 2px solid var(--border-color);
  font-size: calc(12px * var(--content-scale, 1)); font-weight: 600; color: var(--text-muted);
}
.col-label { flex: 1; }
.col-auto { width: 56px; text-align: center; }
.col-state { width: 128px; text-align: right; }

.status-row {
  display: flex; align-items: center;
  padding: 10px 0; border-bottom: 1px solid var(--border-light);
}
.status-row:last-child { border-bottom: none; }
.status-row.timer-active { background: #ecfeff; border-radius: 8px; padding-left: 6px; padding-right: 6px; }
.status-row-label { flex: 1; font-size: calc(14px * var(--content-scale, 1)); font-weight: 500; color: var(--text-primary); }
.status-row-auto { width: 56px; text-align: center; }
.status-row-right { width: 128px; display: flex; align-items: center; justify-content: flex-end; gap: 6px; }

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

/* 타이머(시안) */
.btn-timer-sm {
  width: 26px; height: 26px; border-radius: 7px; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  background: #fff; border: 1px solid #dfe3e8; color: #9aa1ab; cursor: pointer;
  font-size: 13px; transition: all 0.15s;
}
.btn-timer-sm:hover { background: #ecfeff; border-color: #06b6d4; color: #0e7490; }
.timer-badge {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: calc(11px * var(--content-scale, 1)); font-weight: 800;
  padding: 2px 6px 2px 7px; border-radius: 999px;
  background: #ecfeff; color: #0e7490; border: 1px solid #67e8f9;
  white-space: nowrap; cursor: pointer; font-variant-numeric: tabular-nums;
}
.timer-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: #06b6d4; flex-shrink: 0;
  animation: timer-blink 1s steps(1) infinite;
}
@keyframes timer-blink { 50% { opacity: 0.25; } }
.timer-x {
  width: 15px; height: 15px; border-radius: 5px;
  background: #fff; border: 1px solid #06b6d4; color: #0e7490;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 9px; margin-left: 1px;
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
