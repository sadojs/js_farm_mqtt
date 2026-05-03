<template>
  <Teleport to="#app">
    <div
      class="iwm-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="자동 제어 룰 만들기"
      @click.self="handleOverlayClick"
      @keydown.esc="handleClose"
    >
      <div class="iwm-container" @click.stop>
        <!-- 헤더 -->
        <div class="iwm-header">
          <button class="btn-close" aria-label="닫기" @click="handleClose">✕</button>
          <div class="iwm-dots" role="progressbar" :aria-label="`진행률 ${wizard.stepIndex.value + 1}/${wizard.totalSteps.value}`">
            <span
              v-for="i in wizard.totalSteps.value"
              :key="i"
              class="iwm-dot"
              :class="{ active: i - 1 <= wizard.stepIndex.value }"
              aria-hidden="true"
            />
          </div>
          <div class="header-spacer" />
        </div>

        <!-- 본문 -->
        <div class="iwm-body">
          <StepFarmSelect
            v-if="wizard.currentStep.value === 'farm'"
            :modelValue="wizard.state.value.groupId"
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
            :modelValue="wizard.state.value.irrigation?.controllerDeviceId ?? null"
            @update:modelValue="setIrrigationController"
            @select="applyControllerInfo"
            @proceed="wizard.next()"
          />

          <StepIrrigationValve
            v-else-if="wizard.currentStep.value === 'irrigation-valve'"
            :controllerChannels="wizard.state.value.irrigation?.controllerChannels ?? 8"
            :modelValue="wizard.state.value.irrigation?.valveZones ?? []"
            :durationMin="wizard.state.value.irrigation?.durationMin ?? 15"
            :waitTimeBetweenZones="wizard.state.value.irrigation?.waitTimeBetweenZones ?? 0"
            :mixerEnabled="wizard.state.value.irrigation?.mixerEnabled ?? false"
            :useFertilizer="wizard.state.value.irrigation?.useFertilizer ?? false"
            :fertilizer="wizard.state.value.irrigation?.fertilizer ?? defaultFert"
            @update:modelValue="v => setIrrigationField('valveZones', v)"
            @update:durationMin="v => setIrrigationField('durationMin', v)"
            @update:waitTimeBetweenZones="v => setIrrigationField('waitTimeBetweenZones', v)"
            @update:mixerEnabled="v => setIrrigationField('mixerEnabled', v)"
            @update:useFertilizer="v => setIrrigationField('useFertilizer', v)"
            @update:fertilizer="v => setIrrigationField('fertilizer', v)"
            @go-back="wizard.goTo('irrigation-device')"
          />

          <StepDeviceByIntent
            v-else-if="wizard.currentStep.value === 'device-by-intent'"
            :intent="wizard.state.value.intent as 'opener' | 'fan'"
            :groupId="wizard.state.value.groupId ?? ''"
            :modelValue="currentTrigger?.deviceIds ?? []"
            @update:modelValue="v => setTriggerField('deviceIds', v)"
          />

          <StepTimingByIntent
            v-else-if="wizard.currentStep.value === 'timing'"
            :intent="wizard.state.value.intent ?? 'fan'"
            :schedule="wizard.state.value.irrigation?.schedule ?? []"
            :triggerType="currentTrigger?.triggerType ?? 'time'"
            :timeRange="currentTrigger?.timeRange"
            :timeRanges="currentTrigger?.timeRanges"
            :temperature="currentTrigger?.temperature"
            :extraConditions="currentTrigger?.extraConditions ?? []"
            :relayEnabled="currentTrigger?.relayEnabled ?? false"
            :relayOnMin="currentTrigger?.relayOnMin ?? 50"
            :relayOffMin="currentTrigger?.relayOffMin ?? 10"
            @update:schedule="v => setIrrigationField('schedule', v)"
            @update:triggerType="v => setTriggerField('triggerType', v)"
            @update:timeRange="v => setTriggerField('timeRange', v)"
            @update:timeRanges="v => setTriggerField('timeRanges', v)"
            @update:temperature="v => setTriggerField('temperature', v)"
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
        </div>

        <!-- 푸터 -->
        <div class="iwm-footer">
          <button
            v-if="showPrev"
            class="btn-prev"
            @click="wizard.prev()"
          >← 이전</button>

          <div class="spacer" />

          <button
            v-if="showNext"
            class="btn-next"
            :disabled="!wizard.canProceed.value || saving"
            :title="!wizard.canProceed.value ? canProceedHint : ''"
            @click="handleNext"
          >
            <span v-if="saving">저장 중...</span>
            <span v-else>{{ nextLabel }}</span>
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import { useRuleWizardV2 } from '@/composables/useRuleWizardV2'
import { useAutomationStore } from '@/stores/automation.store'
import { useGroupStore } from '@/stores/group.store'
import { useDeviceStore } from '@/stores/device.store'
import { useNotificationStore } from '@/stores/notification.store'
import { transformV2ToLegacy } from './transformV2ToLegacy'
import { generateRuleName } from '@/utils/ruleNameGenerator'
import type { WizardStep, FertilizerConfig } from './types'
import StepFarmSelect from './StepFarmSelect.vue'
import StepIntentSelect from './StepIntentSelect.vue'
import StepIrrigationDevice from './StepIrrigationDevice.vue'
import StepIrrigationValve from './StepIrrigationValve.vue'
import StepDeviceByIntent from './StepDeviceByIntent.vue'
import StepTimingByIntent from './StepTimingByIntent.vue'
import StepReviewSummary from './StepReviewSummary.vue'

const emit = defineEmits<{
  close: []
  'switch-to-legacy': []
  saved: [ruleName: string]
}>()

const wizard = useRuleWizardV2()
const automationStore = useAutomationStore()
const groupStore = useGroupStore()
const deviceStore = useDeviceStore()
const notify = useNotificationStore()
const saving = ref(false)

const defaultFert: FertilizerConfig = { enabled: false, duration: 10, preStopWait: 2 }

const currentTrigger = computed(() => {
  const { intent, opener, fan } = wizard.state.value
  return intent === 'opener' ? opener : fan
})

// 스텝 표시 조건
const STEPS_WITH_PREV = new Set<WizardStep>(['irrigation-valve', 'device-by-intent', 'timing', 'review'])
const STEPS_WITH_NEXT = new Set<WizardStep>(['irrigation-valve', 'device-by-intent', 'timing', 'review'])

const showPrev = computed(() => STEPS_WITH_PREV.has(wizard.currentStep.value))
const showNext = computed(() => STEPS_WITH_NEXT.has(wizard.currentStep.value))

const nextLabel = computed(() => {
  const step = wizard.currentStep.value
  if (step === 'review') return '✓ 만들기'
  if (step === 'device-by-intent') return '장치 선택 완료'
  if (step === 'timing') return '설정 완료'
  return '다음'
})

const canProceedHint = computed(() => {
  const step = wizard.currentStep.value
  if (step === 'irrigation-valve') return '밸브를 하나 이상 선택해주세요'
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

function applyControllerInfo(info: { deviceId: string; channelCount: 8 | 12; canMixFertilizer: boolean }) {
  if (!wizard.state.value.irrigation) return
  wizard.state.value.irrigation.controllerDeviceId = info.deviceId
  wizard.state.value.irrigation.controllerChannels = info.channelCount
  wizard.state.value.irrigation.valveZones = []
}

function setIrrigationField<K extends keyof NonNullable<typeof wizard.state.value.irrigation>>(
  key: K, val: NonNullable<typeof wizard.state.value.irrigation>[K]
) {
  if (!wizard.state.value.irrigation) return
  ;(wizard.state.value.irrigation as any)[key] = val
}

function setTriggerField<K extends 'deviceIds' | 'triggerType' | 'timeRange' | 'timeRanges' | 'temperature' | 'extraConditions' | 'relayEnabled' | 'relayOnMin' | 'relayOffMin'>(
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
    const dto = transformV2ToLegacy(wizard.state.value)
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

// 닫기 처리
function handleClose() {
  if (wizard.currentStep.value === 'review') {
    if (!confirm('입력 내용이 사라집니다. 닫을까요?')) return
  }
  emit('close')
}

function handleOverlayClick() {
  handleClose()
}

// ESC 키
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') handleClose()
}

onMounted(async () => {
  document.body.style.overflow = 'hidden'
  document.addEventListener('keydown', onKeydown)
  if (groupStore.groups.length === 0) await groupStore.fetchGroups()
})

onBeforeUnmount(() => {
  document.body.style.overflow = ''
  document.removeEventListener('keydown', onKeydown)
})
</script>

<style scoped>
.iwm-overlay {
  position: fixed; inset: 0;
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  z-index: 1100;
  display: flex; align-items: center; justify-content: center;
}

.iwm-container {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 16px;
  width: 100%; max-width: 560px;
  max-height: 90vh;
  display: flex; flex-direction: column;
  box-shadow: var(--shadow-modal, 0 20px 60px rgba(0,0,0,0.4));
  overflow: hidden;
}

/* 모바일: 풀스크린 바텀 시트 */
@media (max-width: 600px) {
  .iwm-overlay { align-items: flex-end; }
  .iwm-container {
    max-width: 100%; width: 100%;
    max-height: 92vh;
    border-radius: 20px 20px 0 0;
    padding-bottom: env(safe-area-inset-bottom);
  }
}

.iwm-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 20px 12px;
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

.btn-close {
  background: none; border: none; font-size: 20px;
  color: var(--text-muted); cursor: pointer;
  padding: 4px 8px; border-radius: var(--radius-sm, 6px);
  min-width: 44px; min-height: 44px;
  display: flex; align-items: center; justify-content: center;
  transition: color 0.12s, background 0.12s;
}
.btn-close:hover { color: var(--text-primary); background: var(--bg-secondary); }
.btn-close:focus-visible { outline: 2px solid var(--color-primary); }

.iwm-dots { display: flex; gap: 8px; }
.iwm-dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--border-color);
  transition: background 0.2s;
}
.iwm-dot.active { background: var(--color-primary); }

.header-spacer { width: 60px; }

.iwm-body {
  flex: 1; overflow-y: auto; padding: 20px;
  -webkit-overflow-scrolling: touch;
  background: var(--bg-secondary);
}

.iwm-footer {
  display: flex; align-items: center;
  padding: 14px 20px;
  border-top: 1px solid var(--border-color);
  flex-shrink: 0;
  background: var(--bg-card); /* 헤더/푸터는 카드색으로 body와 구분 */
  position: sticky; bottom: 0;
}

.spacer { flex: 1; }

.btn-prev {
  background: none; border: 1.5px solid var(--border-color);
  border-radius: var(--radius-sm, 6px);
  color: var(--text-primary); cursor: pointer;
  padding: 10px 18px; font-size: calc(14px * var(--content-scale, 1));
  min-height: 44px;
  transition: border-color 0.12s;
}
.btn-prev:hover { border-color: var(--color-primary); }
.btn-prev:focus-visible { outline: 2px solid var(--color-primary); }

.btn-next {
  background: var(--color-primary); border: none;
  border-radius: var(--radius-sm, 6px);
  color: #fff; cursor: pointer;
  padding: 10px 24px; font-size: calc(14px * var(--content-scale, 1));
  font-weight: 600; min-height: 44px;
  transition: opacity 0.12s;
}
.btn-next:disabled { opacity: 0.45; cursor: not-allowed; }
.btn-next:not(:disabled):hover { opacity: 0.9; }
.btn-next:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
</style>
