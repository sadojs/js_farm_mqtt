<template>
  <div v-if="visible" class="modal-overlay" @click.self="$emit('close')">
    <div class="pin-modal">

      <!-- 헤더 -->
      <div class="modal-header">
        <div class="modal-title-row">
          <span class="modal-icon">🔌</span>
          <div>
            <h3 class="modal-title">{{ mode === 'onboard' ? 'GPIO 핀 테스트' : '채널 테스트' }}</h3>
            <p class="modal-subtitle">{{ mode === 'onboard' ? `게이트웨이: ${gatewayId}` : zigbeeDevice?.name }}</p>
          </div>
        </div>
        <button class="btn-close" @click="$emit('close')">✕</button>
      </div>

      <!-- 경고 배너 -->
      <div class="warn-banner">
        ⚠ 관리자 전용 — 명령 전달 시 실제 릴레이/장치가 동작합니다
      </div>

      <!-- 자동 해제 설정 -->
      <div class="auto-off-row">
        <span class="ao-label">자동 해제</span>
        <div class="ao-btns">
          <button
            v-for="opt in AUTO_OPTS"
            :key="opt.label"
            class="ao-btn"
            :class="{ 'ao-active': autoMs === opt.ms }"
            @click="autoMs = opt.ms"
          >{{ opt.label }}</button>
        </div>
      </div>

      <!-- 핀/채널 목록 -->
      <div class="pin-list">

        <!-- ── 온보드 모드: BCM 26핀 ── -->
        <template v-if="mode === 'onboard'">
          <div v-for="pin in BCM_PINS" :key="pin" class="pin-row" :class="{ 'pin-active': pinStates[pin] }">
            <div class="pin-num">
              <span class="pin-badge">BCM {{ pin }}</span>
            </div>
            <div class="pin-state">
              <span class="state-dot" :class="pinStates[pin] ? 'dot-on' : 'dot-off'"></span>
              <span class="state-label">{{ pinStates[pin] ? 'HIGH' : 'LOW' }}</span>
            </div>
            <div class="pin-btns">
              <button
                class="btn-on"
                :class="{ 'btn-busy': busyPins.has(`pin-${pin}`) }"
                :disabled="busyPins.has(`pin-${pin}`)"
                @click="sendGpioCmd(pin, true)"
              >ON</button>
              <button
                class="btn-off"
                :class="{ 'btn-busy': busyPins.has(`pin-${pin}`) }"
                :disabled="busyPins.has(`pin-${pin}`)"
                @click="sendGpioCmd(pin, false)"
              >OFF</button>
            </div>
          </div>
        </template>

        <!-- ── Zigbee 모드: 채널 목록 ── -->
        <template v-else-if="mode === 'zigbee' && zigbeeDevice">
          <div v-if="zigbeeChannels.length === 0" class="empty-channels">
            채널 정보가 없습니다. 채널 매핑을 먼저 설정하세요.
          </div>
          <div
            v-for="ch in zigbeeChannels"
            :key="ch.switchCode"
            class="pin-row"
            :class="{ 'pin-active': zigbeeStates[ch.switchCode] }"
          >
            <div class="pin-num">
              <span class="pin-badge ch-badge">{{ ch.switchCode }}</span>
            </div>
            <div class="pin-label-col">{{ ch.label }}</div>
            <div class="pin-state">
              <span class="state-dot" :class="zigbeeStates[ch.switchCode] ? 'dot-on' : 'dot-off'"></span>
              <span class="state-label">{{ zigbeeStates[ch.switchCode] ? 'ON' : 'OFF' }}</span>
            </div>
            <div class="pin-btns">
              <button
                class="btn-on"
                :class="{ 'btn-busy': busyPins.has(ch.switchCode) }"
                :disabled="busyPins.has(ch.switchCode)"
                @click="sendZigbeeCmd(ch.switchCode, true)"
              >ON</button>
              <button
                class="btn-off"
                :class="{ 'btn-busy': busyPins.has(ch.switchCode) }"
                :disabled="busyPins.has(ch.switchCode)"
                @click="sendZigbeeCmd(ch.switchCode, false)"
              >OFF</button>
            </div>
          </div>
        </template>

      </div>

      <!-- 전체 OFF 버튼 -->
      <div class="modal-footer">
        <button class="btn-all-off" @click="allOff">⏹ 전체 OFF</button>
        <button class="btn-close-footer" @click="$emit('close')">닫기</button>
      </div>

    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import { gatewayEnvApi, type ZigbeeDevice } from '@/api/gateway-env.api'
import { onGpioStatus } from '@/composables/useWebSocket'
import { useNotificationStore } from '@/stores/notification.store'
import { FUNCTION_LABELS } from '@/types/device.types'
import { USABLE_BCM_PINS } from '@/utils/gpio-pins'

const props = defineProps<{
  visible: boolean
  gatewayId: string
  mode: 'onboard' | 'zigbee'
  zigbeeDevice?: ZigbeeDevice | null
}>()
defineEmits<{ close: [] }>()

const notif = useNotificationStore()

// 릴레이 제어용 안전 GPIO 핀 (I2C/SPI/UART 핀 제외)
const BCM_PINS = USABLE_BCM_PINS

const AUTO_OPTS = [
  { label: '없음', ms: 0 },
  { label: '1초', ms: 1000 },
  { label: '3초', ms: 3000 },
  { label: '5초', ms: 5000 },
]
const autoMs = ref(0)

// 핀/채널 상태 (실시간 피드백)
const pinStates = ref<Record<number, boolean>>({})
const zigbeeStates = ref<Record<string, boolean>>({})
const busyPins = ref<Set<string>>(new Set())
// 자동해제 UI 타이머 (누적 방지용)
const uiTimers = ref<Map<string, ReturnType<typeof setTimeout>>>(new Map())

// GPIO 실시간 피드백 구독
const unsubGpio = onGpioStatus((data) => {
  if (data.gatewayId !== props.gatewayId) return
  if (props.mode === 'onboard') {
    pinStates.value[data.pin] = data.state
  }
})
onUnmounted(() => {
  unsubGpio()
  clearAllTimers()
})

function clearAllTimers() {
  uiTimers.value.forEach(t => clearTimeout(t))
  uiTimers.value = new Map()
}

// 모달 닫힐 때 상태 초기화
watch(() => props.visible, (v) => {
  if (!v) {
    clearAllTimers()
    pinStates.value = {}
    zigbeeStates.value = {}
    busyPins.value = new Set()
  }
})

onUnmounted(clearAllTimers)

// Zigbee 채널 목록 계산
const zigbeeChannels = computed(() => {
  if (!props.zigbeeDevice?.channelMapping) return []
  return Object.entries(props.zigbeeDevice.channelMapping)
    .filter(([, sw]) => !!sw)
    .map(([fnKey, switchCode]) => ({
      switchCode,
      label: FUNCTION_LABELS[fnKey] ?? fnKey,
    }))
    .sort((a, b) => a.switchCode.localeCompare(b.switchCode))
})

async function sendGpioCmd(pin: number, state: boolean) {
  const key = `pin-${pin}`
  if (busyPins.value.has(key)) return

  // 이전 자동해제 UI 타이머 취소
  if (uiTimers.value.has(key)) {
    clearTimeout(uiTimers.value.get(key))
    uiTimers.value.delete(key)
  }

  busyPins.value = new Set([...busyPins.value, key])
  pinStates.value[pin] = state
  try {
    await gatewayEnvApi.testGpioPin(props.gatewayId, {
      pin,
      state,
      durationMs: state && autoMs.value > 0 ? autoMs.value : undefined,
    })
    if (state && autoMs.value > 0) {
      const t = setTimeout(() => {
        pinStates.value[pin] = false
        uiTimers.value.delete(key)
      }, autoMs.value)
      uiTimers.value.set(key, t)
    }
  } catch {
    pinStates.value[pin] = !state
    notif.error('오류', `BCM ${pin} 명령 실패`)
  } finally {
    busyPins.value = new Set([...busyPins.value].filter(k => k !== key))
  }
}

async function sendZigbeeCmd(switchCode: string, state: boolean) {
  if (!props.zigbeeDevice) return
  if (busyPins.value.has(switchCode)) return

  // 이전 자동해제 UI 타이머 취소
  if (uiTimers.value.has(switchCode)) {
    clearTimeout(uiTimers.value.get(switchCode))
    uiTimers.value.delete(switchCode)
  }

  busyPins.value = new Set([...busyPins.value, switchCode])
  zigbeeStates.value[switchCode] = state
  try {
    await gatewayEnvApi.testZigbeeChannel(props.gatewayId, {
      friendlyName: props.zigbeeDevice.friendlyName,
      switchCode,
      state,
      durationMs: state && autoMs.value > 0 ? autoMs.value : undefined,
    })
    if (state && autoMs.value > 0) {
      const t = setTimeout(() => {
        zigbeeStates.value[switchCode] = false
        uiTimers.value.delete(switchCode)
      }, autoMs.value)
      uiTimers.value.set(switchCode, t)
    }
  } catch {
    zigbeeStates.value[switchCode] = !state
    notif.error('오류', `채널 ${switchCode} 명령 실패`)
  } finally {
    busyPins.value = new Set([...busyPins.value].filter(k => k !== switchCode))
  }
}

async function allOff() {
  if (props.mode === 'onboard') {
    for (const pin of BCM_PINS) {
      if (pinStates.value[pin]) {
        await sendGpioCmd(pin, false)
      }
    }
  } else {
    for (const ch of zigbeeChannels.value) {
      if (zigbeeStates.value[ch.switchCode]) {
        await sendZigbeeCmd(ch.switchCode, false)
      }
    }
  }
}
</script>

<style scoped>
.modal-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.6);
  display: flex; align-items: center; justify-content: center;
  z-index: 1200; padding: 16px;
}
.pin-modal {
  background: var(--bg-card); border-radius: 16px; width: 100%;
  max-width: 540px; max-height: 90vh; display: flex; flex-direction: column;
  box-shadow: 0 20px 60px rgba(0,0,0,0.3);
}
.modal-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 20px 24px 16px; border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}
.modal-title-row { display: flex; align-items: center; gap: 12px; }
.modal-icon { font-size: 28px; }
.modal-title { font-size: 18px; font-weight: 700; margin: 0; color: var(--text-primary); }
.modal-subtitle { font-size: 12px; color: var(--text-muted); margin: 2px 0 0; }
.btn-close {
  background: none; border: none; font-size: 18px; color: var(--text-muted);
  cursor: pointer; width: 32px; height: 32px;
}
.warn-banner {
  background: #fef3c7; color: #92400e; padding: 10px 20px;
  font-size: 13px; font-weight: 600; flex-shrink: 0;
}
.auto-off-row {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 20px; border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}
.ao-label { font-size: 13px; color: var(--text-muted); white-space: nowrap; font-weight: 500; }
.ao-btns { display: flex; gap: 6px; flex-wrap: wrap; }
.ao-btn {
  padding: 4px 12px; border-radius: 6px; border: 1px solid var(--border-color);
  background: var(--bg-card); color: var(--text-secondary); font-size: 13px;
  cursor: pointer; transition: all 0.15s;
}
.ao-btn:hover { border-color: #6366f1; }
.ao-active { background: #6366f1; color: #fff; border-color: #6366f1; }

.pin-list {
  flex: 1; overflow-y: auto; padding: 8px 0;
}
.pin-row {
  display: flex; align-items: center; gap: 12px;
  padding: 9px 20px; border-bottom: 1px solid var(--border-light);
  transition: background 0.15s;
}
.pin-row:last-child { border-bottom: none; }
.pin-active { background: rgba(34,197,94,0.06); }
.pin-num { width: 70px; flex-shrink: 0; }
.pin-badge {
  display: inline-block; padding: 3px 8px; border-radius: 6px;
  background: var(--bg-badge); color: var(--text-muted);
  font-size: 12px; font-weight: 600; font-family: monospace;
}
.ch-badge { background: #ede9fe; color: #6d28d9; }
.pin-label-col { flex: 1; font-size: 13px; color: var(--text-secondary); min-width: 0; }
.pin-state { display: flex; align-items: center; gap: 5px; width: 52px; flex-shrink: 0; }
.state-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.dot-on { background: #22c55e; box-shadow: 0 0 6px #22c55e88; }
.dot-off { background: var(--text-disabled, #d1d5db); }
.state-label { font-size: 11px; font-weight: 600; color: var(--text-muted); }
.pin-btns { display: flex; gap: 6px; margin-left: auto; flex-shrink: 0; }
.btn-on, .btn-off {
  padding: 5px 14px; border-radius: 6px; border: none;
  font-size: 12px; font-weight: 700; cursor: pointer; transition: all 0.15s;
}
.btn-on { background: #22c55e; color: #fff; }
.btn-on:hover:not(:disabled) { background: #16a34a; }
.btn-off { background: #6b7280; color: #fff; }
.btn-off:hover:not(:disabled) { background: #4b5563; }
.btn-on:disabled, .btn-off:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-busy { animation: pulse 0.6s infinite; }
@keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.5; } }

.empty-channels {
  padding: 32px; text-align: center; color: var(--text-muted); font-size: 14px;
}

.modal-footer {
  display: flex; justify-content: space-between; align-items: center;
  padding: 14px 20px; border-top: 1px solid var(--border-color); flex-shrink: 0;
}
.btn-all-off {
  padding: 8px 18px; border-radius: 8px; border: 1px solid #ef4444;
  background: #fef2f2; color: #ef4444; font-size: 13px; font-weight: 600;
  cursor: pointer;
}
.btn-all-off:hover { background: #ef4444; color: #fff; }
.btn-close-footer {
  padding: 8px 20px; border-radius: 8px; border: 1px solid var(--border-color);
  background: var(--bg-card); color: var(--text-secondary); font-size: 13px;
  cursor: pointer;
}
</style>
