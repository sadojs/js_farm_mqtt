<template>
  <WizardFrame
    v-if="visible"
    :title="editRule ? '자동 제어 수정' : copyRule ? '자동 제어 복사' : '새 자동 제어 설정'"
    :edit-mode="!!editRule"
    :step-index="currentStep - minStep"
    :total-steps="stepList.length - minStep + 1"
    :show-prev="currentStep > minStep"
    :show-next="true"
    :can-proceed="currentStep < 4 ? canNext : (canSave && !saving)"
    :can-proceed-hint="canProceedHint"
    :next-label="currentStep < 4 ? '다음' : (editRule ? '✓ 수정 완료' : '✓ 만들기')"
    :saving="saving"
    @close="$emit('close')"
    @prev="currentStep--"
    @next="currentStep < 4 ? currentStep++ : handleSave()"
  >
    <!-- 수정: 구역·장치는 고정 (다른 장치로 만들려면 복사) -->
    <div v-if="editRule && currentStep >= 3" class="locked-target">
      <span class="locked-icon" aria-hidden="true">📌</span>
      <div class="locked-body">
        <b>{{ lockedTargetLabel }}</b>
        <span>수정에서는 구역과 장치를 바꾸지 않습니다. 다른 장치로 만들려면 목록의 ⋮ 메뉴에서 "복사"를 쓰세요.</span>
      </div>
    </div>
    <StepTargetSelect
      v-if="currentStep === 1"
      v-model="formData.groupId"
    />
    <StepActuatorSelect
      v-if="currentStep === 2"
      v-model:selectedIds="formData.actuatorDeviceIds"
      :groupId="formData.groupId"
      :include-opener="true"
    />
    <StepIrrigationCondition
      v-if="currentStep === 3 && isIrrigation"
      v-model="irrigationForm"
      :channelMapping="localChannelMapping"
      :editableMapping="canEditMapping"
      @update:channelMapping="handleMappingUpdate"
    />
    <StepConditionBuilder
      v-if="currentStep === 3 && !isIrrigation"
      v-model="formData.conditions"
      :timeOnly="false"
      :equipmentType="selectedEquipmentType"
      :groupId="formData.groupId"
    />
    <StepReview
      v-if="currentStep === 4"
      :formData="formData"
      :irrigationConditions="isIrrigation ? irrigationForm : undefined"
      @update:name="formData.name = $event"
      @update:description="formData.description = $event"
    />
  </WizardFrame>
</template>

<script setup lang="ts">
import { notify } from '../../utils/dialogs'
import { confirmRuleConflicts } from '../../utils/ruleConflicts'
import { ref, computed, watch, onBeforeUnmount, shallowRef } from 'vue'
import type { AutomationRule, WizardFormData, CreateRuleRequest, IrrigationConditions } from '../../types/automation.types'
import { createEmptyWizardForm, createDefaultIrrigationConditions } from '../../utils/automation-helpers'
import { useAutomationStore } from '../../stores/automation.store'
import { useGroupStore } from '../../stores/group.store'
import { useDeviceStore } from '../../stores/device.store'
import { useAuthStore } from '../../stores/auth.store'
import type { ChannelMapping } from '../../types/device.types'
import StepTargetSelect from './StepTargetSelect.vue'
import StepActuatorSelect from './StepActuatorSelect.vue'
import StepConditionBuilder from './StepConditionBuilder.vue'
import StepIrrigationCondition from './StepIrrigationCondition.vue'
import StepReview from './StepReview.vue'
import WizardFrame from './WizardFrame.vue'

const props = defineProps<{ visible: boolean; editRule?: AutomationRule | null; copyRule?: AutomationRule | null }>()
const emit = defineEmits<{ close: []; saved: [rule: any] }>()

const automationStore = useAutomationStore()
const groupStore = useGroupStore()
const deviceStore = useDeviceStore()
const { isAdmin, isFarmAdmin } = useAuthStore()
const currentStep = ref(1)
const saving = ref(false)
const formData = ref<WizardFormData>(createEmptyWizardForm())
const irrigationForm = ref<IrrigationConditions>(createDefaultIrrigationConditions())

const stepList = [
  { num: 1, label: '구역' },
  { num: 2, label: '장치' },
  { num: 3, label: '조건' },
  { num: 4, label: '확인' },
]

watch(() => props.visible, (open) => {
  document.body.style.overflow = open ? 'hidden' : ''
  if (!open) return
  groupStore.fetchGroups().catch(() => undefined)
  currentStep.value = minStep.value
  const sourceRule = props.editRule ?? props.copyRule
  if (sourceRule) {
    const rule = sourceRule
    const actions = rule.actions || {} as any
    const sensorIds = actions.sensorDeviceIds || []
    const deviceIds = actions.targetDeviceIds?.length
      ? actions.targetDeviceIds
      : actions.targetDeviceId ? [actions.targetDeviceId] : []
    // 레거시 룰: description에 JSON 메타데이터(channelMapping, originalV2State, hysteresisOffAt 등)가
    // 저장된 경우 사용자에게 노출하지 않음 — 사용자가 직접 JSON을 설명으로 쓰는 경우는 거의 없으므로
    // 트림 후 '{'로 시작하고 JSON 파싱이 성공하면 메타데이터로 간주.
    const rawDesc = rule.description || ''
    let isJsonMeta = false
    const trimmed = rawDesc.trim()
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        JSON.parse(trimmed)
        isJsonMeta = true
      } catch { /* 파싱 실패 → 일반 텍스트로 간주 */ }
    }
    formData.value = {
      groupId: rule.groupId,
      sensorDeviceIds: sensorIds,
      actuatorDeviceIds: deviceIds,
      conditions: rule.conditions && 'groups' in rule.conditions && Array.isArray(rule.conditions.groups)
        ? rule.conditions
        : createEmptyWizardForm().conditions,
      name: props.editRule ? rule.name : `${rule.name} (복사)`,
      description: isJsonMeta ? '' : rawDesc,
      priority: rule.priority,
    }
    // 관수 조건 복원
    if (rule.conditions && (rule.conditions as any).type === 'irrigation') {
      irrigationForm.value = JSON.parse(JSON.stringify(rule.conditions))
    } else {
      irrigationForm.value = createDefaultIrrigationConditions()
    }
  } else {
    formData.value = createEmptyWizardForm()
    irrigationForm.value = createDefaultIrrigationConditions()
  }
})

// 수정은 조건 단계부터 (구역·장치 고정), 새로 만들기·복사는 처음부터
const minStep = computed(() => (props.editRule ? 3 : 1))

const lockedTargetLabel = computed(() => {
  const group = groupStore.groups.find(g => g.id === formData.value.groupId)
  const names = formData.value.actuatorDeviceIds
    .map(id => group?.devices?.find((d: any) => d.id === id)?.name ?? deviceStore.devices.find(d => d.id === id)?.name)
    .filter(Boolean)
  return `${group?.name ?? '구역'} · ${names.length ? names.join(', ') : '장치'}`
})

// 선택된 장치의 equipmentType (첫 번째 선택 장치 기준)
const selectedEquipmentType = computed(() => {
  if (formData.value.actuatorDeviceIds.length === 0) return undefined
  const deviceId = formData.value.actuatorDeviceIds[0]
  const group = formData.value.groupId
    ? groupStore.groups.find(g => g.id === formData.value.groupId)
    : undefined
  const device = group?.devices?.find((d: any) => d.id === deviceId)
    ?? deviceStore.devices.find(d => d.id === deviceId)
  return (device as any)?.equipmentType as string | undefined
})

const isIrrigation = computed(() => selectedEquipmentType.value === 'irrigation')

// 로컬 채널 매핑 — UI 즉시 반영용 (API 응답 대기 없이 동작)
const localChannelMapping = shallowRef<ChannelMapping | undefined>(undefined)

// 장치 선택이 바뀌면 로컬 매핑 초기화
watch(
  () => formData.value.actuatorDeviceIds[0],
  async (deviceId) => {
    if (!deviceId || !isIrrigation.value) { localChannelMapping.value = undefined; return }
    let device = deviceStore.devices.find(d => d.id === deviceId)
      ?? groupStore.groups.find(g => g.id === formData.value.groupId)?.devices?.find((d: any) => d.id === deviceId)
    // switchStates 미로드 상태면 API 호출해서 포트 수 확정
    if (device && !(device as any).switchStates) {
      await deviceStore.fetchDeviceStatus(deviceId)
      device = deviceStore.devices.find(d => d.id === deviceId)
    }
    localChannelMapping.value = device ? { ...deviceStore.getEffectiveMapping(device as any) } : undefined
  },
  { immediate: true },
)

// admin/farm_admin만 채널 매핑 편집 가능 + onboard device는 자동 매핑이라 UI 숨김
const canEditMapping = computed(() => {
  if (!(isAdmin || isFarmAdmin)) return false
  // 선택된 actuator device가 onboard source면 채널 매핑 UI 표시 안 함
  const firstId = formData.value.actuatorDeviceIds[0]
  if (firstId) {
    const dev = deviceStore.devices.find(d => d.id === firstId)
    if (dev?.source === 'onboard') return false
  }
  return true
})

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
  if (currentStep.value === 2) return formData.value.actuatorDeviceIds.length > 0
  if (currentStep.value === 3) {
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
        g.conditions.every(cond => cond.value !== null && cond.value !== undefined
          && !(Number((cond as any).deviation) < 0)) // 켜기 기준이 끄기 기준보다 낮으면 막음
      )
  }
  return true
})

const canSave = computed(() => {
  return !!formData.value.name.trim() && formData.value.actuatorDeviceIds.length > 0
})

const canProceedHint = computed(() => {
  if (currentStep.value === 1) return '구역을 선택해주세요'
  if (currentStep.value === 2) return '장치를 하나 이상 선택해주세요'
  if (currentStep.value === 3) return isIrrigation.value
    ? '관수 일정·구역을 설정해주세요 (액비 활성 시 관주시간 ≥ 투여+종료전대기)'
    : '조건을 모두 입력해주세요'
  if (currentStep.value === 4) return '룰 이름을 입력해주세요'
  return ''
})

onBeforeUnmount(() => { document.body.style.overflow = '' })

async function handleSave() {
  if (saving.value) return
  saving.value = true
  try {
    // sensorDeviceIds는 더 이상 별도 단계로 받지 않고 conditions의 sensor_device_id에서 자동 파생
    // (활동 로그/표시 목적; 비어 있어도 정상)
    const derivedSensorIds = isIrrigation.value
      ? []
      : Array.from(new Set(
          formData.value.conditions.groups.flatMap(g =>
            (g.conditions || []).map((c: any) => c?.sensor_device_id).filter(Boolean)
          )
        ))
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
        sensorDeviceIds: derivedSensorIds,
      } as any,
      priority: formData.value.priority,
    }

    // 켜진 채로 저장되는 규칙이면, 같은 장치를 움직이는 다른 규칙이 있는지 먼저 확인
    const willBeOn = props.editRule ? props.editRule.enabled : true
    if (willBeOn) {
      const disableRuleIds = await confirmRuleConflicts({
        ruleId: props.editRule?.id,
        groupId: payload.groupId,
        conditions: payload.conditions,
        actions: payload.actions,
      }, props.editRule ? 'update' : 'create')
      if (disableRuleIds === null) return
      if (disableRuleIds.length) payload.disableRuleIds = disableRuleIds
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
    notify('저장에 실패했습니다. 다시 시도해주세요.')
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
/* RuleWizardModal — 컨테이너/푸터 스타일은 WizardFrame이 담당. */
.locked-target {
  display: flex; gap: 10px; align-items: flex-start;
  padding: 12px 14px; margin-bottom: 14px;
  background: var(--bg-hover); border: 1px solid var(--border-light); border-radius: 10px;
}
.locked-icon { font-size: calc(16px * var(--content-scale, 1)); line-height: 1.3; }
.locked-body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.locked-body b { font-size: calc(14px * var(--content-scale, 1)); color: var(--text-primary); }
.locked-body span { font-size: calc(12px * var(--content-scale, 1)); color: var(--text-muted); line-height: 1.5; }
</style>
