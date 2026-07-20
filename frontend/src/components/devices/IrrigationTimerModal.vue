<template>
  <div v-if="visible && device" class="modal-overlay" @click.self="$emit('close')">
    <div class="timer-modal">
      <div class="timer-modal-header">
        <span class="hdr-ic">⏱</span>
        <h3>{{ device.name }} 타이머</h3>
        <span v-if="activeCount > 0" class="hdr-count"><span class="timer-dot"></span>{{ activeCount }}</span>
        <button class="close-btn" @click="$emit('close')">✕</button>
      </div>
      <p class="timer-modal-desc">
        채널별 <b>독립 타이머</b> — 설정 시간 동안 강제 관수하고 만료 시 자동제어로 복귀합니다.
        (원격제어·액비/교반기 B접점은 제외)
      </p>
      <div class="timer-modal-body">
        <div v-if="timerableKeys.length === 0" class="empty">타이머 가능한 채널이 없습니다.</div>
        <div
          v-for="fnKey in timerableKeys"
          :key="fnKey"
          class="ch-row"
          :class="{ 'timer-on': isActive(channelUntil(fnKey)) }"
        >
          <span class="ch-icon" :class="chIconClass(fnKey)">{{ chIconText(fnKey) }}</span>
          <span class="ch-main">
            <span class="ch-label">{{ FUNCTION_LABELS[fnKey] || fnKey }}</span>
            <span class="ch-state" :class="{ on: isActive(channelUntil(fnKey)) }">
              {{ chStateText(fnKey) }}
            </span>
          </span>
          <span v-if="isActive(channelUntil(fnKey))" class="timer-badge" @click="cancelChannelTimer(fnKey)" title="타이머 해제 → 자동제어 복귀">
            <span class="timer-dot"></span>{{ formatCountdown(channelUntil(fnKey)) }}<span class="timer-x">✕</span>
          </span>
          <button v-else class="btn-timer-sm" :disabled="!device.online" @click="openChannelSheet(fnKey)">⏱ 설정</button>
        </div>
      </div>
    </div>

    <!-- 채널 타이머 시트 (분 단위) -->
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
import { computed, ref, watch } from 'vue'
import { FUNCTION_LABELS } from '@/types/device.types'
import { useDeviceStore } from '@/stores/device.store'
import { useNotificationStore } from '@/stores/notification.store'
import { deviceApi } from '@/api/device.api'
import { useTimerTick } from '@/composables/useTimerTick'
import DeviceTimerSheet from './DeviceTimerSheet.vue'

const props = defineProps<{
  visible: boolean
  deviceId: string | null
}>()
const emit = defineEmits<{ close: []; changed: [] }>()

const deviceStore = useDeviceStore()
const notify = useNotificationStore()
const { formatCountdown, isActive } = useTimerTick()

// store 에서 ID 로 실시간 조회 — set/cancel 후 fetchDevices 하면 자동 반영(stale ref 없음)
const device = computed(() => deviceStore.devices.find(d => d.id === props.deviceId) || null)

// ⚠️ getEffectiveMapping 은 기본매핑(zone_1~4 등)을 채워 넣으므로 게이트웨이에서 실제
//    활성화되지 않은 채널까지 보인다. 표시는 장치의 "실제(raw) channelMapping" 기준으로 한다.
const mapping = computed<Record<string, string | undefined>>(() =>
  (device.value?.channelMapping || {}) as Record<string, string | undefined>
)

// 타이머 제외 채널 — 원격제어·액비/교반기 B접점
const EXCLUDED = new Set(['remote_control', 'fertilizer_b_contact'])
// 타이머 가능 채널 — 게이트웨이 활성(raw 매핑에 존재)·비활성 아님·제외 아님
const timerableKeys = computed(() => {
  if (!device.value) return []
  const disabled = new Set<string>((device.value as any).disabledChannels ?? [])
  return Object.keys(FUNCTION_LABELS).filter(key => {
    if (EXCLUDED.has(key)) return false
    if (disabled.has(key)) return false
    const v = mapping.value[key]
    return v !== undefined && v !== ''
  })
})

function channelUntil(fnKey: string): string | null {
  const ov = (device.value as any)?.channelOverrides as Record<string, { until: string }> | undefined
  return ov?.[fnKey]?.until ?? null
}
const activeCount = computed(() => {
  const ov = (device.value as any)?.channelOverrides as Record<string, { until: string }> | undefined
  if (!ov) return 0
  return Object.keys(ov).filter(k => isActive(ov[k]?.until)).length
})

// 채널 아이콘/상태 표시
function chIconClass(fnKey: string): string {
  if (fnKey === 'mixer') return 'mixer'
  if (fnKey === 'fertilizer_motor') return 'nutrient'
  return isActive(channelUntil(fnKey)) ? 'zone on' : 'zone'
}
function chIconText(fnKey: string): string {
  if (fnKey === 'mixer') return '⚙'
  if (fnKey === 'fertilizer_motor') return '💧'
  const m = fnKey.match(/^zone_(\d+)$/)
  return m ? m[1] : '·'
}
function chStateText(fnKey: string): string {
  if (isActive(channelUntil(fnKey))) return '타이머 · 강제 관수 중'
  const on = (device.value as any)?.switchStates?.[mapping.value[fnKey] ?? '']
  return on ? '동작중' : '대기'
}

// ── 채널 타이머 시트 ──
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
  if (!device.value || !channelSheetKey.value) return
  channelSubmitting.value = true
  try {
    await deviceApi.setTimer(device.value.id, {
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
  if (!device.value) return
  try {
    await deviceApi.cancelTimer(device.value.id, { channelKey: fnKey })
    notify.info('타이머 해제', `${FUNCTION_LABELS[fnKey] || fnKey} — 자동제어로 복귀`)
    await deviceStore.fetchDevices()
    emit('changed')
  } catch {
    notify.error('해제 실패', '타이머 해제에 실패했습니다')
  }
}

// 닫힐 때 시트도 정리
watch(() => props.visible, (v) => { if (!v) channelSheetOpen.value = false })
</script>

<style scoped>
.modal-overlay {
  position: fixed; inset: 0; background: var(--overlay);
  display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 20px;
}
.timer-modal {
  background: var(--bg-card); border-radius: 16px; width: 100%; max-width: 440px;
  box-shadow: var(--shadow-modal); max-height: calc(100vh - 40px); display: flex; flex-direction: column;
  border-top: 3px solid #06b6d4;
}
.timer-modal-header {
  display: flex; align-items: center; gap: 8px;
  padding: 18px 22px 10px;
}
.hdr-ic { color: #0e7490; font-size: 18px; }
.timer-modal-header h3 { font-size: calc(17px * var(--content-scale, 1)); font-weight: 700; margin: 0; flex: 1; }
.hdr-count {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 12px; font-weight: 800; color: #0e7490;
  background: #ecfeff; border: 1px solid #67e8f9; border-radius: 999px; padding: 2px 9px;
}
.close-btn {
  background: none; border: none; font-size: 20px; color: var(--text-muted);
  cursor: pointer; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center;
}
.timer-modal-desc { font-size: calc(12px * var(--content-scale, 1)); color: var(--text-muted); margin: 0; padding: 0 22px 12px; line-height: 1.5; }
.timer-modal-body { padding: 0 18px 18px; overflow-y: auto; }
.empty { text-align: center; color: var(--text-muted); padding: 24px 0; font-size: 13px; }

.ch-row {
  display: flex; align-items: center; gap: 10px;
  padding: 9px 10px; margin-bottom: 7px;
  border: 1px solid var(--border-light); border-radius: 12px; background: var(--bg-card);
}
.ch-row.timer-on { border-color: #06b6d4; background: #ecfeff; }
.ch-icon {
  width: 28px; height: 28px; border-radius: 8px; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 13px; font-weight: 800;
  background: var(--bg-badge); color: var(--text-muted);
}
.ch-icon.zone.on, .ch-row.timer-on .ch-icon { background: #06b6d4; color: #fff; }
.ch-icon.mixer { background: #ede7f6; color: #5e35b1; }
.ch-icon.nutrient { background: #e0f2f1; color: #00897b; }
.ch-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.ch-label { font-size: calc(13.5px * var(--content-scale, 1)); font-weight: 700; color: var(--text-primary); }
.ch-state { font-size: calc(11px * var(--content-scale, 1)); font-weight: 600; color: var(--text-muted); }
.ch-state.on { color: #0e7490; }

.btn-timer-sm {
  flex-shrink: 0; font-size: 12px; font-weight: 700; padding: 6px 11px; border-radius: 8px;
  background: #fff; border: 1px solid #67e8f9; color: #0e7490; cursor: pointer;
}
.btn-timer-sm:hover { background: #ecfeff; }
.btn-timer-sm:disabled { opacity: 0.4; cursor: not-allowed; }

.timer-badge {
  display: inline-flex; align-items: center; gap: 4px; flex-shrink: 0;
  font-size: calc(11.5px * var(--content-scale, 1)); font-weight: 800;
  padding: 3px 6px 3px 8px; border-radius: 999px;
  background: #fff; color: #0e7490; border: 1px solid #67e8f9;
  white-space: nowrap; cursor: pointer; font-variant-numeric: tabular-nums;
}
.timer-dot { width: 6px; height: 6px; border-radius: 50%; background: #06b6d4; flex-shrink: 0; animation: timer-blink 1s steps(1) infinite; }
@keyframes timer-blink { 50% { opacity: 0.25; } }
.timer-x {
  width: 16px; height: 16px; border-radius: 5px; background: #ecfeff;
  border: 1px solid #06b6d4; color: #0e7490;
  display: inline-flex; align-items: center; justify-content: center; font-size: 9px; margin-left: 1px;
}
</style>
