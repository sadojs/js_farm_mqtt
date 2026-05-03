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

function makeIrrigationState(): IrrigationState {
  return {
    controllerDeviceId: '',
    controllerChannels: 8,
    valveZones: [],
    durationMin: 15,
    waitTimeBetweenZones: 0,
    mixerEnabled: false,
    useFertilizer: false,
    fertilizer: { enabled: false, duration: 10, preStopWait: 2 },
    schedule: [{ days: [1, 2, 3, 4, 5], startTime: '08:00', durationMin: 15 }],
  }
}

const STEP_ORDER_IRRIGATION: WizardStep[] = ['farm', 'intent', 'irrigation-device', 'irrigation-valve', 'timing', 'review']
const STEP_ORDER_OPENER_FAN: WizardStep[] = ['farm', 'intent', 'device-by-intent', 'timing', 'review']
const STEP_ORDER_BASE: WizardStep[] = ['farm', 'intent']

export function useRuleWizardV2() {
  const state = ref<WizardStateV2>({
    groupId: null,
    intent: null,
    ruleName: '',
    activateNow: true,
  })

  const currentStep = ref<WizardStep>('farm')

  const stepOrder = computed((): WizardStep[] => {
    switch (state.value.intent) {
      case 'irrigation': return STEP_ORDER_IRRIGATION
      case 'opener':
      case 'fan':        return STEP_ORDER_OPENER_FAN
      default:           return STEP_ORDER_BASE
    }
  })

  const totalSteps = computed(() =>
    state.value.intent === 'irrigation' ? 5 : 4
  )

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
    state.value = { groupId: null, intent: null, ruleName: '', activateNow: true }
    currentStep.value = 'farm'
  }

  const canProceed = computed((): boolean => {
    const s = state.value
    switch (currentStep.value) {
      case 'farm':
        return !!s.groupId

      case 'intent':
        return !!s.intent

      case 'irrigation-device':
        return !!s.irrigation?.controllerDeviceId

      case 'irrigation-valve':
        return (s.irrigation?.valveZones.length ?? 0) > 0

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
        return !!(temp && temp.base != null && !isNaN(temp.base) && temp.hysteresis >= 0.5)
      }

      case 'review':
        return !!s.ruleName.trim()

      default:
        return false
    }
  })

  return { state, currentStep, stepIndex, totalSteps, stepOrder, canProceed, next, prev, goTo, setIntent, reset }
}
