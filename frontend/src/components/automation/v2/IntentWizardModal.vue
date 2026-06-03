<template>
  <WizardFrame
    title="자동 제어 추가"
    :edit-mode="false"
    :step-index="wizard.stepIndex.value"
    :total-steps="wizard.totalSteps.value"
    :show-prev="showPrev"
    :show-next="showNext"
    :can-proceed="wizard.canProceed.value"
    :can-proceed-hint="canProceedHint"
    :next-label="nextLabel"
    :saving="saving"
    @close="handleClose"
    @prev="wizard.prev()"
    @next="handleNext"
  >
    <StepFarmAdminSelect
            v-if="wizard.currentStep.value === 'farm-admin'"
            :modelValue="wizard.state.value.farmUserId"
            @update:modelValue="v => { wizard.state.value.farmUserId = v; wizard.state.value.groupId = null }"
            @proceed="wizard.next()"
          />

          <StepFarmSelect
            v-else-if="wizard.currentStep.value === 'zone'"
            :modelValue="wizard.state.value.groupId"
            :farmUserId="wizard.state.value.farmUserId"
            @update:modelValue="wizard.state.value.groupId = $event"
            @proceed="wizard.next()"
          />

          <StepIntentSelect
            v-else-if="wizard.currentStep.value === 'intent'"
            :modelValue="wizard.state.value.intent"
            @update:modelValue="wizard.setIntent($event)"
            @proceed="wizard.next()"
            @switch-to-legacy="emit('switch-to-legacy')"
          />

          <StepIrrigationDevice
            v-else-if="wizard.currentStep.value === 'irrigation-device'"
            :groupId="wizard.state.value.groupId ?? ''"
            :farmUserId="wizard.state.value.farmUserId"
            :modelValue="wizard.state.value.irrigation?.controllerDeviceId ?? null"
            @update:modelValue="setIrrigationController"
            @select="applyControllerInfo"
            @proceed="wizard.next()"
          />

          <StepIrrigationValve
            v-else-if="wizard.currentStep.value === 'irrigation-valve' && wizard.state.value.irrigation"
            :controllerChannels="wizard.state.value.irrigation.controllerChannels"
            :valves="wizard.state.value.irrigation.valves"
            :mixerEnabled="wizard.state.value.irrigation.mixerEnabled"
            :useFertilizer="wizard.state.value.irrigation.useFertilizer"
            :fertilizer="wizard.state.value.irrigation.fertilizer"
            @update:valves="v => setIrrigationField('valves', v)"
            @update:mixerEnabled="v => setIrrigationField('mixerEnabled', v)"
            @update:useFertilizer="v => { setIrrigationField('useFertilizer', v); setIrrigationField('fertilizer', { ...wizard.state.value.irrigation!.fertilizer, enabled: v }) }"
            @update:fertilizer="v => setIrrigationField('fertilizer', v)"
            @go-back="wizard.goTo('irrigation-device')"
          />

          <StepDeviceByIntent
            v-else-if="wizard.currentStep.value === 'device-by-intent'"
            :intent="wizard.state.value.intent as 'opener' | 'fan'"
            :groupId="wizard.state.value.groupId ?? ''"
            :farmUserId="wizard.state.value.farmUserId"
            :modelValue="currentTrigger?.deviceIds ?? []"
            @update:modelValue="v => setTriggerField('deviceIds', v)"
          />

          <StepTimingByIntent
            v-else-if="wizard.currentStep.value === 'timing'"
            :intent="wizard.state.value.intent ?? 'fan'"
            :groupId="wizard.state.value.groupId"
            :schedule="wizard.state.value.irrigation?.schedule ?? []"
            :triggerType="currentTrigger?.triggerType ?? 'time'"
            :timeRange="currentTrigger?.timeRange"
            :timeRanges="currentTrigger?.timeRanges"
            :temperature="currentTrigger?.temperature"
            :sensorDeviceId="currentTrigger?.sensorDeviceId"
            :sensorField="currentTrigger?.sensorField"
            :extraConditions="currentTrigger?.extraConditions ?? []"
            :relayEnabled="currentTrigger?.relayEnabled ?? false"
            :relayOnMin="currentTrigger?.relayOnMin ?? 50"
            :relayOffMin="currentTrigger?.relayOffMin ?? 10"
            @update:schedule="v => setIrrigationField('schedule', v)"
            @update:triggerType="v => setTriggerField('triggerType', v)"
            @update:timeRange="v => setTriggerField('timeRange', v)"
            @update:timeRanges="v => setTriggerField('timeRanges', v)"
            @update:temperature="v => setTriggerField('temperature', v)"
            @update:sensorDeviceId="v => setTriggerField('sensorDeviceId', v)"
            @update:sensorField="v => setTriggerField('sensorField', v)"
            @update:extraConditions="v => setTriggerField('extraConditions', v)"
            @update:relayEnabled="v => setTriggerField('relayEnabled', v)"
            @update:relayOnMin="v => setTriggerField('relayOnMin', v)"
            @update:relayOffMin="v => setTriggerField('relayOffMin', v)"
          />

          <StepReviewSummary
            v-else-if="wizard.currentStep.value === 'review'"
            :state="wizard.state.value"
            :groups="groupStore.groups"
            :devices="deviceStore.devices"
            :ruleName="wizard.state.value.ruleName"
            :activateNow="wizard.state.value.activateNow"
            @update:ruleName="wizard.state.value.ruleName = $event"
            @update:activateNow="wizard.state.value.activateNow = $event"
            @jump-to="wizard.goTo($event)"
            @save="handleSave"
          />
  </WizardFrame>
</template>

<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { useRuleWizardV2 } from '@/composables/useRuleWizardV2'
import { useAutomationStore } from '@/stores/automation.store'
import { useGroupStore } from '@/stores/group.store'
import { useDeviceStore } from '@/stores/device.store'
import { useNotificationStore } from '@/stores/notification.store'
import { useAuthStore } from '@/stores/auth.store'
import { transformV2ToLegacy } from './transformV2ToLegacy'
import { generateRuleName } from '@/utils/ruleNameGenerator'
import type { WizardStep } from './types'
import StepFarmAdminSelect from './StepFarmAdminSelect.vue'
import StepFarmSelect from './StepFarmSelect.vue'
import StepIntentSelect from './StepIntentSelect.vue'
import StepIrrigationDevice from './StepIrrigationDevice.vue'
import StepIrrigationValve from './StepIrrigationValve.vue'
import StepDeviceByIntent from './StepDeviceByIntent.vue'
import StepTimingByIntent from './StepTimingByIntent.vue'
import StepReviewSummary from './StepReviewSummary.vue'
import WizardFrame from '../WizardFrame.vue'

const emit = defineEmits<{
  close: []
  'switch-to-legacy': []
  saved: [ruleName: string]
}>()

const authStore = useAuthStore()
const wizard = useRuleWizardV2(authStore.isAdmin)
const automationStore = useAutomationStore()
const groupStore = useGroupStore()
const deviceStore = useDeviceStore()
const notify = useNotificationStore()
const saving = ref(false)



const currentTrigger = computed(() => {
  const { intent, opener, fan } = wizard.state.value
  return intent === 'opener' ? opener : fan
})

// 스텝 표시 조건
const STEPS_WITH_PREV = new Set<WizardStep>(['zone', 'device-by-intent', 'irrigation-device', 'irrigation-valve', 'timing', 'review'])
const STEPS_WITH_NEXT = new Set<WizardStep>(['device-by-intent', 'irrigation-valve', 'timing', 'review'])

const showPrev = computed(() => STEPS_WITH_PREV.has(wizard.currentStep.value))
const showNext = computed(() => STEPS_WITH_NEXT.has(wizard.currentStep.value))

const nextLabel = computed(() => {
  const step = wizard.currentStep.value
  if (step === 'review') return '✓ 만들기'
  if (step === 'device-by-intent') return '장치 선택 완료'
  if (step === 'irrigation-valve') return '관수 설정 완료'
  if (step === 'timing') return '설정 완료'
  return '다음'
})

const canProceedHint = computed(() => {
  const step = wizard.currentStep.value
  if (step === 'irrigation-device') return '관수 장치를 선택해주세요'
  if (step === 'irrigation-valve') return '활성화된 밸브의 관주 시간을 1분 이상으로 설정해주세요 (액비 활성 시 투여+종료전대기 ≤ 관주 시간)'
  if (step === 'device-by-intent') return '장치를 하나 이상 선택해주세요'
  if (step === 'timing') return '시간/온도 조건을 설정해주세요'
  if (step === 'review') return '룰 이름을 입력해주세요'
  return ''
})

// 관수 컨트롤러 정보 적용
function setIrrigationController(deviceId: string) {
  if (!wizard.state.value.irrigation) return
  wizard.state.value.irrigation.controllerDeviceId = deviceId
}

function applyControllerInfo(info: { deviceId: string; channelCount: 8 | 12; canMixFertilizer: boolean; activeZones?: number[] }) {
  if (!wizard.state.value.irrigation) return
  const irr = wizard.state.value.irrigation
  irr.controllerDeviceId = info.deviceId
  irr.controllerChannels = info.channelCount
  irr.valveZones = []
  // 환경 설정에서 활성화된 zone만 valves에 포함.
  // activeZones가 비어있으면(레거시 device, channelMapping 없음) 채널 수 기준 fallback.
  const zonesToShow = (info.activeZones && info.activeZones.length > 0)
    ? info.activeZones
    : Array.from({ length: info.channelCount === 12 ? 8 : 4 }, (_, i) => i + 1)
  irr.valves = zonesToShow.map(zone => ({
    zone, enabled: true, duration: irr.durationMin, waitTime: irr.waitTimeBetweenZones,
  }))
}

function setIrrigationField<K extends keyof NonNullable<typeof wizard.state.value.irrigation>>(
  key: K, val: NonNullable<typeof wizard.state.value.irrigation>[K]
) {
  if (!wizard.state.value.irrigation) return
  ;(wizard.state.value.irrigation as any)[key] = val
}

function setTriggerField<K extends 'deviceIds' | 'triggerType' | 'timeRange' | 'timeRanges' | 'temperature' | 'sensorDeviceId' | 'sensorField' | 'extraConditions' | 'relayEnabled' | 'relayOnMin' | 'relayOffMin'>(
  key: K, val: any
) {
  const { intent } = wizard.state.value
  if (intent === 'opener' && wizard.state.value.opener) {
    ;(wizard.state.value.opener as any)[key] = val
  } else if (intent === 'fan' && wizard.state.value.fan) {
    ;(wizard.state.value.fan as any)[key] = val
  }
}

// 다음 버튼 처리
function handleNext() {
  if (wizard.currentStep.value === 'review') {
    handleSave()
    return
  }
  // timing → review: 룰 이름 자동 생성
  if (wizard.currentStep.value === 'timing' && !wizard.state.value.ruleName) {
    wizard.state.value.ruleName = generateRuleName(wizard.state.value)
  }
  wizard.next()
}

// 저장
async function handleSave() {
  if (saving.value) return
  saving.value = true
  try {
    const dto: any = transformV2ToLegacy(wizard.state.value)
    if (authStore.isAdmin && wizard.state.value.farmUserId) {
      dto.targetUserId = wizard.state.value.farmUserId
    }
    const result = await automationStore.createRule(dto)
    if (!wizard.state.value.activateNow && result?.id) {
      await automationStore.toggleRule(result.id)
    }
    notify.success('룰 생성 완료', `"${wizard.state.value.ruleName}" 룰이 추가되었습니다.`)
    emit('saved', wizard.state.value.ruleName)
    emit('close')
  } catch (err) {
    console.error('[V2 Wizard] 룰 생성 실패:', err)
    notify.error('저장 실패', '룰 생성에 실패했습니다. 다시 시도해주세요.')
  } finally {
    saving.value = false
  }
}

// 닫기 처리 — WizardFrame이 Esc/overlay click도 emit('close')로 전달
function handleClose() {
  if (wizard.currentStep.value === 'review') {
    if (!confirm('입력 내용이 사라집니다. 닫을까요?')) return
  }
  emit('close')
}

onMounted(async () => {
  if (groupStore.groups.length === 0) await groupStore.fetchGroups()
})
</script>

<style scoped>
/* IntentWizardModal — 컨테이너/푸터 스타일은 WizardFrame이 담당. 별도 스타일 불필요. */
</style>
