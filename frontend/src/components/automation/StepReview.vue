<template>
  <div class="step-review">
    <h3 class="step-title">최종 확인</h3>
    <p class="step-desc">룰 정보를 확인하고 이름을 입력하세요</p>

    <!-- 룰 이름 -->
    <div class="form-field">
      <label class="field-label">룰 이름 *</label>
      <input
        type="text"
        :value="formData.name"
        @input="$emit('update:name', ($event.target as HTMLInputElement).value)"
        placeholder="예: 고온 시 개폐기 ON"
        class="field-input"
      />
    </div>

    <!-- 설명 -->
    <div class="form-field">
      <label class="field-label">설명 (선택)</label>
      <textarea
        :value="formData.description"
        @input="$emit('update:description', ($event.target as HTMLTextAreaElement).value)"
        placeholder="자동화 룰에 대한 설명을 입력하세요"
        class="field-textarea"
        rows="2"
      />
    </div>

    <!-- 요약 -->
    <div class="summary">
      <h4 class="summary-title">설정 요약</h4>

      <div class="summary-row">
        <span class="summary-label">그룹</span>
        <span class="summary-value">{{ groupName }}</span>
      </div>

      <div class="summary-row">
        <span class="summary-label">센서</span>
        <span class="summary-value">{{ sensorNames }}</span>
      </div>

      <div class="summary-row">
        <span class="summary-label">장비</span>
        <span class="summary-value">{{ actuatorName }}</span>
      </div>

      <!-- 관수 조건 요약 -->
      <template v-if="irrigationConditions">
        <div class="summary-row">
          <span class="summary-label">시작시간</span>
          <span class="summary-value">{{ irrigationConditions.startTime }}</span>
        </div>
        <div class="summary-row">
          <span class="summary-label">활성 구역</span>
          <span class="summary-value">{{ activeZonesSummary }}</span>
        </div>
        <div class="summary-row">
          <span class="summary-label">스케줄</span>
          <span class="summary-value">{{ scheduleSummary }}</span>
        </div>
      </template>

      <!-- 일반 조건 요약 -->
      <div v-else class="summary-row">
        <span class="summary-label">조건</span>
        <span class="summary-value">{{ conditionSummary }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { WizardFormData, IrrigationConditions } from '../../types/automation.types'
import { useGroupStore } from '../../stores/group.store'
import { formatConditionGroup } from '../../utils/automation-helpers'

const DAY_LABELS: Record<number, string> = {
  0: '일', 1: '월', 2: '화', 3: '수', 4: '목', 5: '금', 6: '토',
}

const props = defineProps<{
  formData: WizardFormData
  irrigationConditions?: IrrigationConditions
}>()
defineEmits<{
  'update:name': [value: string]
  'update:description': [value: string]
}>()

const groupStore = useGroupStore()

const selectedGroup = computed(() =>
  groupStore.groups.find(g => g.id === props.formData.groupId)
)

const groupName = computed(() => selectedGroup.value?.name || '-')

const sensorNames = computed(() => {
  if (props.formData.sensorDeviceIds.length === 0) return '미선택 (시간 기반)'
  const devices = selectedGroup.value?.devices || []
  return props.formData.sensorDeviceIds
    .map(id => devices.find(d => d.id === id)?.name || id)
    .join(', ') || '-'
})

const actuatorName = computed(() => {
  const ids = props.formData.actuatorDeviceIds
  if (!ids || ids.length === 0) return '-'
  const devices = selectedGroup.value?.devices || []
  return ids
    .map(id => devices.find(d => d.id === id)?.name || id)
    .join(', ')
})

const conditionSummary = computed(() => formatConditionGroup(props.formData.conditions))

const activeZonesSummary = computed(() => {
  if (!props.irrigationConditions) return '-'
  const active = props.irrigationConditions.zones.filter(z => z.enabled)
  return active.map(z => `${z.name}(${z.duration}분)`).join(', ') || '없음'
})

const scheduleSummary = computed(() => {
  if (!props.irrigationConditions) return '-'
  const { days, repeat } = props.irrigationConditions.schedule
  const dayStr = days
    .sort((a, b) => (a === 0 ? 7 : a) - (b === 0 ? 7 : b))
    .map(d => DAY_LABELS[d] || d)
    .join(',')
  return `${dayStr} ${repeat ? '(매주 반복)' : '(1회)'}`
})
</script>

<style scoped>
.step-review { display: flex; flex-direction: column; gap: 16px; }
.step-title { font-size: 18px; font-weight: 700; color: var(--text-primary); margin: 0; }
.step-desc { font-size: 14px; color: var(--text-muted); margin: 0; }

.form-field { display: flex; flex-direction: column; gap: 6px; }
.field-label { font-size: 14px; font-weight: 600; color: var(--text-secondary); }
.field-input {
  padding: 10px 14px; border: 1px solid var(--border-input); border-radius: 10px;
  font-size: 15px; background: var(--bg-input); color: var(--text-primary);
}
.field-input:focus { outline: none; border-color: #4caf50; }
.field-textarea {
  padding: 10px 14px; border: 1px solid var(--border-input); border-radius: 10px;
  font-size: 14px; resize: vertical; background: var(--bg-input); color: var(--text-primary);
}
.field-textarea:focus { outline: none; border-color: #4caf50; }

.summary {
  background: var(--bg-secondary); border-radius: 12px; padding: 16px;
  border: 1px solid var(--border-light);
}
.summary-title { font-size: 15px; font-weight: 700; color: var(--text-primary); margin: 0 0 12px; }

.summary-row {
  display: flex; justify-content: space-between; align-items: flex-start;
  padding: 8px 0; border-bottom: 1px solid var(--border-light);
}
.summary-row:last-child { border-bottom: none; }
.summary-label { font-size: 14px; color: var(--text-muted); min-width: 60px; }
.summary-value { font-size: 14px; color: var(--text-primary); font-weight: 500; text-align: right; flex: 1; }
.summary-value.cmd.on { color: #4caf50; font-weight: 700; }
.summary-value.cmd.off { color: #f44336; font-weight: 700; }
</style>
