<template>
  <div v-if="visible" class="modal-overlay" @click.self="$emit('close')">
    <div class="modal-container">
      <!-- 헤더 -->
      <div class="modal-header">
        <h2 class="modal-title">자동화 룰 수정</h2>
        <button class="btn-close" @click="$emit('close')">✕</button>
      </div>

      <!-- 탭 -->
      <div class="edit-tabs">
        <button class="edit-tab" :class="{ active: step === 'condition' }" @click="step = 'condition'">조건</button>
        <button class="edit-tab" :class="{ active: step === 'review' }" @click="step = 'review'">확인</button>
      </div>

      <!-- 본문 -->
      <div class="modal-body">
        <template v-if="step === 'condition'">
          <StepIrrigationCondition
            v-if="isIrrigation"
            v-model="irrigationForm"
          />
          <StepConditionBuilder
            v-else
            v-model="conditionForm"
            :timeOnly="isTimeOnly"
            :equipmentType="equipmentType"
            :groupId="rule?.groupId"
          />
        </template>
        <template v-if="step === 'review'">
          <StepReview
            :formData="reviewFormData"
            :irrigationConditions="isIrrigation ? irrigationForm : undefined"
            @update:name="ruleName = $event"
            @update:description="ruleDescription = $event"
          />
        </template>
      </div>

      <!-- 푸터 -->
      <div class="modal-footer">
        <button class="btn-secondary" @click="$emit('close')">취소</button>
        <div class="spacer" />
        <button class="btn-primary" :disabled="!canSave || saving" @click="handleSave">
          {{ saving ? '저장 중...' : '저장' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import type {
  AutomationRule, ConditionGroup, IrrigationConditions,
  CreateRuleRequest, WizardFormData,
} from '../../types/automation.types'
import { createEmptyWizardForm, createDefaultIrrigationConditions } from '../../utils/automation-helpers'
import { useAutomationStore } from '../../stores/automation.store'
import { useDeviceStore } from '../../stores/device.store'
import StepConditionBuilder from './StepConditionBuilder.vue'
import StepIrrigationCondition from './StepIrrigationCondition.vue'
import StepReview from './StepReview.vue'

const props = defineProps<{
  visible: boolean
  rule: AutomationRule | null
}>()
const emit = defineEmits<{ close: []; saved: [] }>()

const automationStore = useAutomationStore()
const deviceStore = useDeviceStore()

const step = ref<'condition' | 'review'>('condition')
const saving = ref(false)
const ruleName = ref('')
const ruleDescription = ref('')
const conditionForm = ref<ConditionGroup>(createEmptyWizardForm().conditions)
const irrigationForm = ref<IrrigationConditions>(createDefaultIrrigationConditions())

// 장비 타입 감지
const equipmentType = computed(() => {
  if (!props.rule) return undefined
  const actions = props.rule.actions as any
  const deviceIds: string[] = actions?.targetDeviceIds || []
  for (const id of deviceIds) {
    const device = deviceStore.devices.find(d => d.id === id)
    if (device?.equipmentType) return device.equipmentType
  }
  return undefined
})

const isIrrigation = computed(() => {
  if (props.rule?.conditions && (props.rule.conditions as any).type === 'irrigation') return true
  return equipmentType.value === 'irrigation'
})

const isTimeOnly = computed(() => {
  return props.rule?.ruleType === 'time'
})

// StepReview에 전달할 formData
const reviewFormData = computed<WizardFormData>(() => {
  const actions = props.rule?.actions as any
  return {
    groupId: props.rule?.groupId,
    sensorDeviceIds: actions?.sensorDeviceIds || [],
    actuatorDeviceIds: actions?.targetDeviceIds?.length
      ? actions.targetDeviceIds
      : actions?.targetDeviceId ? [actions.targetDeviceId] : [],
    conditions: isIrrigation.value ? createEmptyWizardForm().conditions : conditionForm.value,
    name: ruleName.value,
    description: ruleDescription.value,
    priority: props.rule?.priority || 5,
  }
})

const canSave = computed(() => !!ruleName.value.trim())

// visible 변경 시 폼 초기화
watch(() => props.visible, (open) => {
  document.body.style.overflow = open ? 'hidden' : ''
  if (!open || !props.rule) return
  step.value = 'condition'
  ruleName.value = props.rule.name
  ruleDescription.value = props.rule.description || ''

  if (isIrrigation.value && props.rule.conditions) {
    irrigationForm.value = JSON.parse(JSON.stringify(props.rule.conditions))
  } else {
    irrigationForm.value = createDefaultIrrigationConditions()
  }

  if (!isIrrigation.value && props.rule.conditions && 'groups' in props.rule.conditions) {
    conditionForm.value = JSON.parse(JSON.stringify(props.rule.conditions))
  } else {
    conditionForm.value = createEmptyWizardForm().conditions
  }
})

onBeforeUnmount(() => { document.body.style.overflow = '' })

async function handleSave() {
  if (saving.value || !props.rule) return
  saving.value = true
  try {
    const payload: Partial<CreateRuleRequest> = {
      name: ruleName.value.trim(),
      description: ruleDescription.value || undefined,
      conditions: isIrrigation.value ? irrigationForm.value : conditionForm.value,
      priority: props.rule.priority,
    }
    await automationStore.updateRule(props.rule.id, payload)
    emit('saved')
    emit('close')
  } catch (err) {
    console.error('룰 수정 실패:', err)
    alert('저장에 실패했습니다.')
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.modal-overlay {
  position: fixed; top: 0; left: 0; right: 0; bottom: 0;
  background: var(--overlay); display: flex; align-items: center; justify-content: center;
  z-index: 1000; padding: 20px;
}
.modal-container {
  background: var(--bg-card); border-radius: 20px;
  width: 100%; max-width: 600px; max-height: 90vh;
  display: flex; flex-direction: column;
  box-shadow: var(--shadow-modal);
}
.modal-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 20px 24px 12px;
}
.modal-title { font-size: 20px; font-weight: 700; color: var(--text-primary); }
.btn-close {
  width: 32px; height: 32px; border-radius: 50%; border: none;
  background: var(--bg-hover); cursor: pointer; font-size: 16px;
  display: flex; align-items: center; justify-content: center;
  color: var(--text-secondary);
}

.edit-tabs {
  display: flex; gap: 4px; padding: 0 24px; margin-bottom: 8px;
  background: var(--bg-badge); margin: 0 24px 12px; border-radius: 10px; padding: 4px;
}
.edit-tab {
  flex: 1; padding: 8px 16px; border: none; border-radius: 8px;
  background: none; font-size: 14px; font-weight: 600;
  color: var(--text-muted); cursor: pointer; transition: all 0.2s;
}
.edit-tab.active {
  background: var(--bg-secondary); color: var(--text-primary);
  box-shadow: var(--shadow-card);
}

.modal-body {
  flex: 1; overflow-y: auto; padding: 0 24px 16px;
}

.modal-footer {
  display: flex; align-items: center; padding: 16px 24px;
  border-top: 1px solid var(--border-light);
}
.spacer { flex: 1; }
.btn-secondary {
  padding: 10px 20px; background: var(--bg-hover); color: var(--text-secondary);
  border: none; border-radius: 10px; font-weight: 600; cursor: pointer;
}
.btn-primary {
  padding: 10px 24px; background: var(--accent); color: white;
  border: none; border-radius: 10px; font-weight: 600; cursor: pointer;
}
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

@media (max-width: 768px) {
  .modal-overlay { padding: 0; }
  .modal-container {
    max-width: 100%;
    max-height: 100%;
    height: 100vh;
    height: 100dvh;
    border-radius: 0;
    padding-bottom: env(safe-area-inset-bottom, 0);
  }
  .modal-body { padding: 0 16px 16px; }
  .modal-header { padding: 16px 16px 8px; padding-top: calc(16px + env(safe-area-inset-top, 0px)); }
  .modal-footer { padding: 12px 16px; }
  .edit-tabs { margin: 0 16px 12px; }
}
</style>
