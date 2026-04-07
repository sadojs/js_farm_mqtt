<template>
    <div v-if="visible" class="modal-overlay" @click.self="$emit('close')">
      <div class="modal-container">
        <!-- 헤더 -->
        <div class="modal-header">
          <h2 class="modal-title">{{ editRule ? '자동 제어 설정 수정' : '새 자동 제어 설정' }}</h2>
          <button class="btn-close" @click="$emit('close')">✕</button>
        </div>

        <!-- 스텝 인디케이터 -->
        <div class="stepper">
          <div v-for="s in stepList" :key="s.num" class="step-item" :class="{ active: currentStep === s.num, done: currentStep > s.num }">
            <span class="step-circle">{{ currentStep > s.num ? '✓' : s.num }}</span>
            <span class="step-name">{{ s.label }}</span>
          </div>
        </div>

        <!-- 스텝 본문 -->
        <div class="modal-body">
          <StepTargetSelect
            v-if="currentStep === 1"
            v-model="formData.groupId"
          />
          <StepSensorSelect
            v-if="currentStep === 2"
            v-model="formData.sensorDeviceIds"
            :groupId="formData.groupId"
            :noSensor="noSensor"
            @update:noSensor="noSensor = $event"
          />
          <StepActuatorSelect
            v-if="currentStep === 3"
            v-model:selectedIds="formData.actuatorDeviceIds"
            :groupId="formData.groupId"
            :noSensor="noSensor"
          />
          <StepIrrigationCondition
            v-if="currentStep === 4 && isIrrigation"
            v-model="irrigationForm"
            :channelMapping="localChannelMapping"
            :editableMapping="canEditMapping"
            @update:channelMapping="handleMappingUpdate"
          />
          <StepConditionBuilder
            v-if="currentStep === 4 && !isIrrigation"
            v-model="formData.conditions"
            :timeOnly="noSensor"
            :equipmentType="selectedEquipmentType"
            :groupId="formData.groupId"
          />
          <StepReview
            v-if="currentStep === 5"
            :formData="formData"
            :irrigationConditions="isIrrigation ? irrigationForm : undefined"
            @update:name="formData.name = $event"
            @update:description="formData.description = $event"
          />
        </div>

        <!-- 푸터 -->
        <div class="modal-footer">
          <button v-if="currentStep > 1" class="btn-secondary" @click="currentStep--">이전</button>
          <div class="spacer" />
          <button v-if="currentStep < 5" class="btn-primary" :disabled="!canNext" @click="currentStep++">다음</button>
          <button v-else class="btn-primary" :disabled="!canSave || saving" @click="handleSave">
            {{ saving ? '저장 중...' : '저장' }}
          </button>
        </div>
      </div>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount, shallowRef } from 'vue'
import type { AutomationRule, WizardFormData, CreateRuleRequest, IrrigationConditions } from '../../types/automation.types'
import { createEmptyWizardForm, createDefaultIrrigationConditions } from '../../utils/automation-helpers'
import { useAutomationStore } from '../../stores/automation.store'
import { useGroupStore } from '../../stores/group.store'
import { useDeviceStore } from '../../stores/device.store'
import { useAuthStore } from '../../stores/auth.store'
import type { ChannelMapping } from '../../types/device.types'
import StepTargetSelect from './StepTargetSelect.vue'
import StepSensorSelect from './StepSensorSelect.vue'
import StepActuatorSelect from './StepActuatorSelect.vue'
import StepConditionBuilder from './StepConditionBuilder.vue'
import StepIrrigationCondition from './StepIrrigationCondition.vue'
import StepReview from './StepReview.vue'

const props = defineProps<{ visible: boolean; editRule?: AutomationRule | null }>()
const emit = defineEmits<{ close: []; saved: [rule: any] }>()

const automationStore = useAutomationStore()
const groupStore = useGroupStore()
const deviceStore = useDeviceStore()
const { isAdmin, isFarmAdmin } = useAuthStore()
const currentStep = ref(1)
const saving = ref(false)
const noSensor = ref(false)
const formData = ref<WizardFormData>(createEmptyWizardForm())
const irrigationForm = ref<IrrigationConditions>(createDefaultIrrigationConditions())

const stepList = [
  { num: 1, label: '구역' },
  { num: 2, label: '측정기' },
  { num: 3, label: '장치' },
  { num: 4, label: '조건' },
  { num: 5, label: '확인' },
]

watch(() => props.visible, (open) => {
  document.body.style.overflow = open ? 'hidden' : ''
  if (!open) return
  groupStore.fetchGroups().catch(() => undefined)
  currentStep.value = 1
  if (props.editRule) {
    const rule = props.editRule
    const actions = rule.actions || {} as any
    const sensorIds = actions.sensorDeviceIds || []
    const deviceIds = actions.targetDeviceIds?.length
      ? actions.targetDeviceIds
      : actions.targetDeviceId ? [actions.targetDeviceId] : []
    formData.value = {
      groupId: rule.groupId,
      sensorDeviceIds: sensorIds,
      actuatorDeviceIds: deviceIds,
      conditions: rule.conditions && 'groups' in rule.conditions && Array.isArray(rule.conditions.groups)
        ? rule.conditions
        : createEmptyWizardForm().conditions,
      name: rule.name,
      description: rule.description || '',
      priority: rule.priority,
    }
    // 관수 조건 복원
    if (rule.conditions && (rule.conditions as any).type === 'irrigation') {
      irrigationForm.value = JSON.parse(JSON.stringify(rule.conditions))
    } else {
      irrigationForm.value = createDefaultIrrigationConditions()
    }
    noSensor.value = sensorIds.length === 0 && (rule.ruleType === 'time' || (rule.conditions as any)?.type === 'irrigation')
  } else {
    formData.value = createEmptyWizardForm()
    irrigationForm.value = createDefaultIrrigationConditions()
    noSensor.value = false
  }
})

// 선택된 장치의 equipmentType (첫 번째 선택 장치 기준)
const selectedEquipmentType = computed(() => {
  if (formData.value.actuatorDeviceIds.length === 0 || !formData.value.groupId) return undefined
  const group = groupStore.groups.find(g => g.id === formData.value.groupId)
  const device = group?.devices?.find((d: any) => d.id === formData.value.actuatorDeviceIds[0])
  return (device as any)?.equipmentType as string | undefined
})

const isIrrigation = computed(() => selectedEquipmentType.value === 'irrigation')

// 로컬 채널 매핑 — UI 즉시 반영용 (API 응답 대기 없이 동작)
const localChannelMapping = shallowRef<ChannelMapping | undefined>(undefined)

// 장치 선택이 바뀌면 로컬 매핑 초기화
watch(
  () => formData.value.actuatorDeviceIds[0],
  (deviceId) => {
    if (!deviceId || !isIrrigation.value) { localChannelMapping.value = undefined; return }
    const group = groupStore.groups.find(g => g.id === formData.value.groupId)
    const device = group?.devices?.find((d: any) => d.id === deviceId)
    localChannelMapping.value = device ? { ...deviceStore.getEffectiveMapping(device as any) } : undefined
  },
  { immediate: true },
)

// admin/farm_admin만 채널 매핑 편집 가능
const canEditMapping = computed(() => isAdmin || isFarmAdmin)

// 채널 매핑 변경 → 로컬 즉시 반영 + API 저장
async function handleMappingUpdate(mapping: ChannelMapping) {
  localChannelMapping.value = { ...mapping }   // UI 즉시 반영
  const deviceId = formData.value.actuatorDeviceIds[0]
  if (!deviceId) return
  try {
    await deviceStore.updateChannelMapping(deviceId, mapping)
  } catch {
    // 저장 실패 시 무시
  }
}

const canNext = computed(() => {
  if (currentStep.value === 1) return !!formData.value.groupId
  if (currentStep.value === 2) return formData.value.sensorDeviceIds.length > 0 || noSensor.value
  if (currentStep.value === 3) return formData.value.actuatorDeviceIds.length > 0
  if (currentStep.value === 4) {
    if (isIrrigation.value) {
      // 관수: 시작시간과 활성 구역 최소 1개
      const baseValid = !!irrigationForm.value.startTime &&
        irrigationForm.value.zones.some(z => z.enabled) &&
        irrigationForm.value.schedule.days.length > 0
      if (!baseValid) return false
      // 액비모터 ON 시: 각 활성 구역의 관주시간 ≥ 투여시간 + 종료전대기
      const f = irrigationForm.value.fertilizer
      if (f.enabled) {
        const fertTotal = (f.duration || 0) + (f.preStopWait || 0)
        const hasViolation = irrigationForm.value.zones
          .filter(z => z.enabled)
          .some(z => (z.duration || 0) < fertTotal)
        if (hasViolation) return false
      }
      return true
    }
    return formData.value.conditions.groups.length > 0 &&
      formData.value.conditions.groups.every(g => g.conditions.length > 0) &&
      formData.value.conditions.groups.every(g =>
        g.conditions.every(cond => cond.value !== null && cond.value !== undefined)
      )
  }
  return true
})

const canSave = computed(() => {
  return !!formData.value.name.trim() && formData.value.actuatorDeviceIds.length > 0
})

onBeforeUnmount(() => { document.body.style.overflow = '' })

async function handleSave() {
  if (saving.value) return
  saving.value = true
  try {
    const payload: CreateRuleRequest = {
      name: formData.value.name.trim(),
      description: formData.value.description || undefined,
      groupId: formData.value.groupId,
      conditions: isIrrigation.value
        ? irrigationForm.value
        : formData.value.conditions,
      actions: {
        targetDeviceId: formData.value.actuatorDeviceIds[0],
        targetDeviceIds: formData.value.actuatorDeviceIds,
        sensorDeviceIds: formData.value.sensorDeviceIds,
      } as any,
      priority: formData.value.priority,
    }

    let result
    if (props.editRule) {
      result = await automationStore.updateRule(props.editRule.id, payload)
    } else {
      result = await automationStore.createRule(payload)
    }
    emit('saved', result)
    emit('close')
  } catch (err) {
    console.error('룰 저장 실패:', err)
    alert('저장에 실패했습니다. 다시 시도해주세요.')
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.modal-overlay {
  position: fixed; inset: 0; background: rgba(0, 0, 0, 0.75); display: flex;
  align-items: center; justify-content: center; z-index: 1000;
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
}
.modal-container {
  background: var(--bg-card); border-radius: 16px; width: 560px; max-height: 90vh;
  display: flex; flex-direction: column; overflow: hidden;
  box-shadow: var(--shadow-modal); border: 1px solid var(--border-color);
  padding: 0;
}

.modal-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 20px 24px 12px;
}
.modal-title { font-size: var(--font-size-title); font-weight: 700; color: var(--text-primary); }
.btn-close {
  background: none; border: none; font-size: 20px; color: var(--text-muted); cursor: pointer;
  padding: 4px 8px;
}
.btn-close:hover { color: var(--text-primary); }

.stepper {
  display: flex; justify-content: center; gap: 32px; padding: 20px 24px 24px;
  border-bottom: 1px solid var(--border-light);
}
.step-item { display: flex; flex-direction: column; align-items: center; gap: 8px; }
.step-circle {
  width: 44px; height: 44px; border-radius: 50%; border: 2.5px solid var(--border-input);
  display: flex; align-items: center; justify-content: center;
  font-size: var(--font-size-subtitle); font-weight: 700; color: var(--text-muted);
}
.step-item.active .step-circle { border-color: #4caf50; background: #4caf50; color: white; }
.step-item.done .step-circle { border-color: #4caf50; color: #4caf50; }
.step-name { font-size: var(--font-size-body); color: var(--text-muted); }
.step-item.active .step-name { color: #4caf50; font-weight: 600; }
.step-item.done .step-name { color: #4caf50; }

.modal-body { flex: 1; overflow-y: auto; padding: 24px; }

.modal-footer {
  display: flex; align-items: center; padding: 16px 24px;
  border-top: 1px solid var(--border-light);
}
.spacer { flex: 1; }

.btn-primary {
  padding: 10px 28px; background: #4caf50; color: white; border: none;
  border-radius: 10px; font-size: var(--font-size-label); font-weight: 600; cursor: pointer;
}
.btn-primary:hover { background: #43a047; }
.btn-primary:disabled { background: var(--text-muted); cursor: not-allowed; }

.btn-secondary {
  padding: 10px 28px; background: var(--bg-card); color: var(--text-link); border: 1px solid var(--border-input);
  border-radius: 10px; font-size: var(--font-size-label); font-weight: 500; cursor: pointer;
}
.btn-secondary:hover { background: var(--bg-hover); }

@media (max-width: 768px) {
  .modal-overlay { padding: 0; }
  .modal-container {
    width: 100%;
    max-height: 100%;
    height: 100vh;
    height: 100dvh;
    border-radius: 0;
    padding-bottom: env(safe-area-inset-bottom, 0);
  }
  .stepper { gap: 16px; padding: 12px 16px 16px; }
  .step-circle { width: 36px; height: 36px; font-size: var(--font-size-body); }
  .step-name { font-size: var(--font-size-caption); }
  .modal-body { padding: 16px; }
  .modal-header { padding: 16px 16px 8px; padding-top: calc(16px + env(safe-area-inset-top, 0px)); }
  .modal-footer { padding: 12px 16px; }
}
</style>
