import { ref, computed } from 'vue'
import type { WizardStateV2, WizardStep, WizardIntent, OpenerFanState, IrrigationState } from '../components/automation/v2/types'

function makeOpenerFanState(): OpenerFanState {
  return {
    deviceIds: [],
    triggerType: 'time',
    timeRanges: [{ days: [0, 1, 2, 3, 4, 5, 6], start: '08:00', end: '18:00' }],
    extraConditions: [],
    relayEnabled: false,
    relayOnMin: 50,
    relayOffMin: 10,
  }
}

// 컨트롤러 채널 수(8/12)에 따라 기본 valves 배열 생성 — 모든 구역 기본 활성, 공통 시간 적용
function makeDefaultValves(channels: 8 | 12, duration = 15, waitTime = 0): Array<{ zone: number; enabled: boolean; duration: number; waitTime: number }> {
  const zoneCount = channels === 12 ? 8 : 4
  return Array.from({ length: zoneCount }, (_, i) => ({
    zone: i + 1, enabled: true, duration, waitTime,
  }))
}

function makeIrrigationState(): IrrigationState {
  return {
    controllerDeviceId: '',
    controllerChannels: 8,
    valves: makeDefaultValves(8, 15, 0),
    valveZones: [],
    durationMin: 15,
    waitTimeBetweenZones: 0,
    mixerEnabled: false,
    useFertilizer: false,
    fertilizer: { enabled: false, duration: 10, preStopWait: 2 },
    schedule: [{ days: [1, 2, 3, 4, 5], startTime: '08:00', durationMin: 15 }],
  }
}

// irrigation-valve step 재추가: 사용자 요청 — 밸브별 개별 관주 시간/쉬는 시간 설정
const STEP_ORDER_IRRIGATION_ADMIN: WizardStep[]    = ['farm-admin', 'zone', 'intent', 'irrigation-device', 'irrigation-valve', 'timing', 'review']
const STEP_ORDER_IRRIGATION_NORMAL: WizardStep[]   = ['zone',       'intent', 'irrigation-device', 'irrigation-valve', 'timing', 'review']
const STEP_ORDER_OPENER_FAN_ADMIN: WizardStep[]    = ['farm-admin', 'zone', 'intent', 'device-by-intent', 'timing', 'review']
const STEP_ORDER_OPENER_FAN_NORMAL: WizardStep[]   = ['zone',       'intent', 'device-by-intent', 'timing', 'review']
const STEP_ORDER_BASE_ADMIN: WizardStep[]          = ['farm-admin', 'zone', 'intent']
const STEP_ORDER_BASE_NORMAL: WizardStep[]         = ['zone',       'intent']

export function useRuleWizardV2(isAdmin = false) {
  const state = ref<WizardStateV2>({
    farmUserId: null,
    groupId: null,
    intent: null,
    ruleName: '',
    activateNow: true,
  })

  const currentStep = ref<WizardStep>(isAdmin ? 'farm-admin' : 'zone')

  const stepOrder = computed((): WizardStep[] => {
    switch (state.value.intent) {
      case 'irrigation':
        return isAdmin ? STEP_ORDER_IRRIGATION_ADMIN : STEP_ORDER_IRRIGATION_NORMAL
      case 'opener':
      case 'fan':
        return isAdmin ? STEP_ORDER_OPENER_FAN_ADMIN : STEP_ORDER_OPENER_FAN_NORMAL
      default:
        return isAdmin ? STEP_ORDER_BASE_ADMIN : STEP_ORDER_BASE_NORMAL
    }
  })

  const totalSteps = computed(() => stepOrder.value.length)

  const stepIndex = computed(() =>
    stepOrder.value.indexOf(currentStep.value)
  )

  function next() {
    const order = stepOrder.value
    const idx = order.indexOf(currentStep.value)
    if (idx >= 0 && idx < order.length - 1) {
      currentStep.value = order[idx + 1]
    }
  }

  function prev() {
    const order = stepOrder.value
    const idx = order.indexOf(currentStep.value)
    if (idx > 0) currentStep.value = order[idx - 1]
  }

  function goTo(step: WizardStep) {
    currentStep.value = step
  }

  function setIntent(intent: WizardIntent) {
    state.value.intent = intent
    if (intent === 'irrigation' && !state.value.irrigation) {
      state.value.irrigation = makeIrrigationState()
    }
    if (intent === 'opener' && !state.value.opener) {
      state.value.opener = makeOpenerFanState()
    }
    if (intent === 'fan' && !state.value.fan) {
      state.value.fan = makeOpenerFanState()
    }
  }

  function reset() {
    state.value = { farmUserId: null, groupId: null, intent: null, ruleName: '', activateNow: true }
    currentStep.value = isAdmin ? 'farm-admin' : 'zone'
  }

  const canProceed = computed((): boolean => {
    const s = state.value
    switch (currentStep.value) {
      case 'farm-admin':
        return !!s.farmUserId

      case 'zone':
        return !!s.groupId

      case 'intent':
        return !!s.intent

      case 'irrigation-device':
        return !!s.irrigation?.controllerDeviceId

      case 'irrigation-valve': {
        const irr = s.irrigation
        if (!irr) return false
        const enabledValves = irr.valves.filter(v => v.enabled)
        if (enabledValves.length === 0) return false
        // 모든 활성 valve의 관주 시간 > 0 + 액비 활성 시 합계 ≤ 관주 시간
        if (!enabledValves.every(v => v.duration > 0)) return false
        if (irr.useFertilizer && irr.fertilizer.enabled) {
          const minZoneDur = Math.min(...enabledValves.map(v => v.duration))
          if (irr.fertilizer.duration + irr.fertilizer.preStopWait > minZoneDur) return false
        }
        return true
      }

      case 'device-by-intent':
        if (s.intent === 'opener') return (s.opener?.deviceIds.length ?? 0) > 0
        if (s.intent === 'fan')    return (s.fan?.deviceIds.length ?? 0) > 0
        return false

      case 'timing': {
        if (s.intent === 'irrigation') {
          const sched = s.irrigation?.schedule ?? []
          return sched.length > 0 && sched.every(sc => sc.days.length > 0 && sc.durationMin > 0 && !!sc.startTime)
        }
        const trigger = s.intent === 'opener' ? s.opener : s.fan
        if (!trigger) return false
        if (trigger.triggerType === 'time') {
          const ranges = (trigger.timeRanges && trigger.timeRanges.length > 0)
            ? trigger.timeRanges
            : (trigger.timeRange ? [trigger.timeRange] : [])
          return ranges.length > 0 && ranges.every(r => r.days.length > 0 && r.start && r.end && r.start < r.end)
        }
        const temp = trigger.temperature
        const tempValid = !!(temp && temp.base != null && !isNaN(temp.base) && temp.hysteresis >= 0.5)
        // 온습도 트리거에는 (센서, 측정 채널) 모두 필수
        return tempValid && !!trigger.sensorDeviceId && !!trigger.sensorField
      }

      case 'review':
        return !!s.ruleName.trim()

      default:
        return false
    }
  })

  return { state, currentStep, stepIndex, totalSteps, stepOrder, canProceed, next, prev, goTo, setIntent, reset }
}
