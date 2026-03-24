<template>
  <div class="step-condition">
    <h3 class="step-title">조건 설정</h3>
    <p class="step-desc">{{ timeOnly ? '시간 기반 조건을 설정하세요.' : '센서 데이터 조건을 설정하세요.' }} 조건 충족 시 장비가 동작합니다.</p>

    <div class="condition-groups">
      <div
        v-for="(group, gi) in modelValue.groups"
        :key="gi"
        class="condition-group"
      >
        <!-- 그룹 헤더 -->
        <div v-if="gi > 0" class="group-logic">
          <select
            :value="modelValue.logic"
            @change="updateGroupLogic(($event.target as HTMLSelectElement).value as 'AND' | 'OR')"
            class="logic-select"
          >
            <option value="AND">AND (모두 만족)</option>
            <option value="OR">OR (하나 이상 만족)</option>
          </select>
        </div>

        <div class="group-box">
          <div
            v-for="(cond, ci) in group.conditions"
            :key="ci"
            class="condition-row"
          >
            <!-- 조건 간 로직 -->
            <div v-if="ci > 0" class="row-logic">
              <select
                :value="group.logic"
                @change="updateSetLogic(gi, ($event.target as HTMLSelectElement).value as 'AND' | 'OR')"
                class="logic-select small"
              >
                <option value="AND">AND</option>
                <option value="OR">OR</option>
              </select>
            </div>

            <div class="row-fields">
              <!-- 필드 선택 -->
              <select
                :value="cond.field"
                @change="changeField(gi, ci, ($event.target as HTMLSelectElement).value)"
                class="field-select"
              >
                <option v-for="f in availableFields" :key="f.value" :value="f.value">
                  {{ f.displayLabel }}
                </option>
              </select>

              <!-- 히스테리시스 UI (FR-02): fan + temperature/humidity 관련 역할 -->
              <template v-if="isFanHysteresis(cond)">
                <div class="hysteresis-row">
                  <label>기준값</label>
                  <input
                    type="number"
                    :value="cond.value"
                    @input="changeValue(gi, ci, Number(($event.target as HTMLInputElement).value))"
                    class="value-input small"
                  />
                  <span class="unit">{{ getUnit(cond.field) }}</span>
                  <label>편차</label>
                  <input
                    type="number"
                    :value="cond.deviation || 0"
                    min="0"
                    @input="changeDeviation(gi, ci, Number(($event.target as HTMLInputElement).value))"
                    class="value-input small"
                  />
                  <span class="unit">{{ getUnit(cond.field) }}</span>
                </div>
                <div v-if="cond.deviation" class="hysteresis-preview">
                  ON: {{ Number(cond.value) + Number(cond.deviation) }}{{ getUnit(cond.field) }} 이상 /
                  OFF: {{ Number(cond.value) - Number(cond.deviation) }}{{ getUnit(cond.field) }} 이하
                </div>
              </template>

              <!-- 일반 조건 -->
              <template v-else>
                <!-- 연산자 선택 -->
                <select
                  :value="cond.operator"
                  @change="changeOperator(gi, ci, ($event.target as HTMLSelectElement).value)"
                  class="op-select"
                >
                  <option v-for="op in getOperators(cond.field)" :key="op" :value="op">
                    {{ OPERATOR_LABELS_KR[op] || op }}
                  </option>
                </select>

                <!-- 값 입력 -->
                <template v-if="cond.field === 'rainfall'">
                  <select
                    :value="cond.value ? 'true' : 'false'"
                    @change="changeValue(gi, ci, ($event.target as HTMLSelectElement).value === 'true')"
                    class="value-input"
                  >
                    <option value="true">예 (비 감지)</option>
                    <option value="false">아니오</option>
                  </select>
                </template>
                <template v-else-if="cond.field === 'hour' && cond.operator === 'between'">
                  <input
                    type="number" min="0" max="23"
                    :value="Array.isArray(cond.value) ? cond.value[0] : 0"
                    @input="changeTimeRange(gi, ci, 0, Number(($event.target as HTMLInputElement).value))"
                    class="value-input small"
                  />
                  <span class="range-sep">~</span>
                  <input
                    type="number" min="0" max="23"
                    :value="Array.isArray(cond.value) ? cond.value[1] : 23"
                    @input="changeTimeRange(gi, ci, 1, Number(($event.target as HTMLInputElement).value))"
                    class="value-input small"
                  />
                  <span class="unit">시</span>
                </template>
                <template v-else-if="cond.field === 'hour'">
                  <input
                    type="number" min="0" max="23"
                    :value="cond.value"
                    @input="changeValue(gi, ci, Number(($event.target as HTMLInputElement).value))"
                    class="value-input small"
                  />
                  <span class="unit">시</span>
                </template>
                <template v-else>
                  <input
                    type="number"
                    :value="cond.value"
                    @input="changeValue(gi, ci, Number(($event.target as HTMLInputElement).value))"
                    class="value-input"
                  />
                  <span v-if="getUnit(cond.field)" class="unit">{{ getUnit(cond.field) }}</span>
                </template>
              </template>

              <!-- 삭제 -->
              <button
                v-if="group.conditions.length > 1"
                class="btn-remove"
                @click="removeCondition(gi, ci)"
              >✕</button>
            </div>

            <!-- 릴레이 동작대기 옵션 (FR-04): fan인 경우 -->
            <div v-if="isFan" class="relay-option">
              <label class="relay-toggle">
                <input type="checkbox" :checked="cond.relay" @change="toggleRelay(gi, ci)" />
                동작대기 ({{ cond.relayOnMinutes || 50 }}분 ON / {{ cond.relayOffMinutes || 10 }}분 OFF 반복)
              </label>
            </div>
          </div>

          <!-- 조건 추가 -->
          <button class="btn-add-condition" @click="addCondition(gi)">+ 조건 추가</button>
        </div>
      </div>
    </div>

    <!-- 시간대 스케줄러 (FR-03): timeOnly + fan -->
    <div v-if="timeOnly && isFan" class="time-scheduler">
      <h4 class="scheduler-title">시간대 스케줄러</h4>
      <div v-for="(slot, i) in timeSlots" :key="i" class="time-slot">
        <input type="number" v-model.number="slot.start" min="0" max="23" class="value-input small" />
        <span class="unit">시</span>
        <span class="range-sep">~</span>
        <input type="number" v-model.number="slot.end" min="0" max="23" class="value-input small" />
        <span class="unit">시</span>
        <button class="btn-remove" @click="removeTimeSlot(i)">✕</button>
      </div>
      <button class="btn-add-condition" @click="addTimeSlot">+ 시간대 추가</button>

      <div class="day-selector">
        <button
          v-for="d in DAYS"
          :key="d.value"
          class="day-btn"
          :class="{ active: selectedDays.includes(d.value) }"
          @click="toggleDay(d.value)"
        >
          {{ d.label }}
        </button>
      </div>

      <label class="repeat-toggle">
        <input type="checkbox" v-model="repeatWeekly" />
        매주 반복
      </label>
    </div>

    <!-- 그룹 추가 -->
    <button class="btn-add-group" @click="addGroup">+ 조건 그룹 추가</button>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import type { ConditionGroup, Condition } from '../../types/automation.types'
import {
  SENSOR_CONDITION_FIELDS,
  OPERATOR_LABELS_KR,
  FIELD_UNITS,
  ENV_ROLE_FIELD_CONFIG,
  createEmptyCondition,
  createEmptyConditionSet,
} from '../../utils/automation-helpers'
import { envConfigApi } from '../../api/env-config.api'
import type { EnvRole, ResolvedValue } from '../../api/env-config.api'

const DAYS = [
  { value: 1, label: '월' }, { value: 2, label: '화' },
  { value: 3, label: '수' }, { value: 4, label: '목' },
  { value: 5, label: '금' }, { value: 6, label: '토' },
  { value: 7, label: '일' },
]

// 온도/습도 관련 역할 (히스테리시스 대상)
const TEMP_HUMIDITY_ROLES = ['internal_temp', 'external_temp', 'internal_humidity', 'external_humidity', 'temperature', 'humidity']

const props = defineProps<{
  modelValue: ConditionGroup
  timeOnly?: boolean
  equipmentType?: string
  groupId?: string
}>()
const emit = defineEmits<{
  'update:modelValue': [value: ConditionGroup]
  'update:canProceed': [value: boolean]
}>()

const isFan = computed(() => props.equipmentType === 'fan')

// env roles 및 resolved values
const envRoles = ref<EnvRole[]>([])
const resolvedValues = ref<Record<string, ResolvedValue>>({})

async function loadEnvData() {
  if (!props.groupId) return
  try {
    const [rolesRes, resolvedRes] = await Promise.all([
      envConfigApi.getRoles(),
      envConfigApi.getResolved(props.groupId),
    ])
    envRoles.value = rolesRes.data
    resolvedValues.value = resolvedRes.data
  } catch {
    // fallback to empty
  }
}

onMounted(loadEnvData)
watch(() => props.groupId, loadEnvData)

function isFanHysteresis(cond: Condition): boolean {
  return isFan.value && TEMP_HUMIDITY_ROLES.includes(cond.field)
}

// canProceed: 항상 true (모든 env role은 유효)
watch(() => props.modelValue, () => {
  emit('update:canProceed', true)
}, { deep: true, immediate: true })

// 시간대 스케줄러 state
const timeSlots = ref<{ start: number; end: number }[]>([{ start: 9, end: 17 }])
const selectedDays = ref<number[]>([1, 2, 3, 4, 5])
const repeatWeekly = ref(true)

function addTimeSlot() {
  timeSlots.value.push({ start: 9, end: 17 })
}
function removeTimeSlot(i: number) {
  if (timeSlots.value.length > 1) timeSlots.value.splice(i, 1)
}
function toggleDay(day: number) {
  const idx = selectedDays.value.indexOf(day)
  if (idx >= 0) selectedDays.value.splice(idx, 1)
  else selectedDays.value.push(day)
}

// 시간대 스케줄러가 변경되면 조건에 반영
watch([timeSlots, selectedDays, repeatWeekly], () => {
  if (!props.timeOnly || !isFan.value) return
  const next = clone()
  if (next.groups[0]?.conditions[0]) {
    next.groups[0].conditions[0].timeSlots = JSON.parse(JSON.stringify(timeSlots.value))
    next.groups[0].conditions[0].daysOfWeek = [...selectedDays.value]
    next.groups[0].conditions[0].repeat = repeatWeekly.value
  }
  emit('update:modelValue', next)
}, { deep: true })

const TIME_ONLY_FIELDS = SENSOR_CONDITION_FIELDS.filter(f => f.type === 'time')

// env role 기반 필드 목록 생성
const envRoleFields = computed(() => {
  if (envRoles.value.length === 0) {
    // fallback: 기존 SENSOR_CONDITION_FIELDS
    return SENSOR_CONDITION_FIELDS.map(f => ({
      ...f,
      displayLabel: f.label,
    }))
  }

  const fields: {
    value: string; label: string; displayLabel: string;
    type: 'sensor' | 'time'; operators: string[];
    unit: string; defaultValue: number; icon: string;
  }[] = envRoles.value.map(role => {
    const config = ENV_ROLE_FIELD_CONFIG[role.roleKey]
    const resolved = resolvedValues.value[role.roleKey]
    const valueStr = resolved?.value != null
      ? `${resolved.value}${role.unit}`
      : '미설정'
    return {
      value: role.roleKey,
      label: role.label,
      displayLabel: `${role.label}(${valueStr})`,
      type: 'sensor' as const,
      operators: config?.operators || ['gte', 'lte', 'gt', 'lt', 'eq', 'between'],
      unit: role.unit,
      defaultValue: config?.defaultValue ?? 0,
      icon: config?.icon || '📊',
    }
  })

  // 시간 필드 추가
  fields.push({
    value: 'hour',
    label: '시간',
    displayLabel: '시간',
    type: 'time',
    operators: ['eq', 'between'],
    unit: '',
    defaultValue: 9,
    icon: '🕐',
  })

  return fields
})

const availableFields = computed(() => {
  if (props.timeOnly) return TIME_ONLY_FIELDS.map(f => ({ ...f, displayLabel: f.label }))
  return envRoleFields.value
})

// timeOnly 모드로 전환 시, 기존 센서 조건을 시간 조건으로 변경
watch(() => props.timeOnly, (isTimeOnly) => {
  if (!isTimeOnly) return
  const next = clone()
  let changed = false
  for (const group of next.groups) {
    for (let i = 0; i < group.conditions.length; i++) {
      if (group.conditions[i].type !== 'time') {
        group.conditions[i] = { type: 'time', field: 'hour', operator: 'eq', value: 9, unit: '' }
        changed = true
      }
    }
  }
  if (changed) emit('update:modelValue', next)
})

function clone(): ConditionGroup {
  return JSON.parse(JSON.stringify(props.modelValue))
}

function getOperators(field: string): string[] {
  const envField = envRoleFields.value.find(f => f.value === field)
  if (envField) return envField.operators
  const def = SENSOR_CONDITION_FIELDS.find(f => f.value === field)
  return def?.operators || ['eq']
}

function getUnit(field: string): string {
  const envField = envRoleFields.value.find(f => f.value === field)
  if (envField) return envField.unit
  return FIELD_UNITS[field] || ''
}

function updateGroupLogic(logic: 'AND' | 'OR') {
  const next = clone()
  next.logic = logic
  emit('update:modelValue', next)
}

function updateSetLogic(gi: number, logic: 'AND' | 'OR') {
  const next = clone()
  next.groups[gi].logic = logic
  emit('update:modelValue', next)
}

function changeField(gi: number, ci: number, field: string) {
  const next = clone()
  const def = envRoleFields.value.find(f => f.value === field)
    || SENSOR_CONDITION_FIELDS.find(f => f.value === field)
  next.groups[gi].conditions[ci] = {
    type: def?.type || 'sensor',
    field,
    operator: (def?.operators[0] as Condition['operator']) || 'gte',
    value: def?.defaultValue ?? 0,
    unit: def?.unit || '',
  }
  emit('update:modelValue', next)
}

function changeOperator(gi: number, ci: number, operator: string) {
  const next = clone()
  const cond = next.groups[gi].conditions[ci]
  cond.operator = operator as Condition['operator']
  if (operator === 'between' && !Array.isArray(cond.value)) {
    cond.value = [Number(cond.value) || 0, (Number(cond.value) || 0) + 10]
  } else if (operator !== 'between' && Array.isArray(cond.value)) {
    cond.value = cond.value[0]
  }
  emit('update:modelValue', next)
}

function changeValue(gi: number, ci: number, value: any) {
  const next = clone()
  next.groups[gi].conditions[ci].value = value
  emit('update:modelValue', next)
}

function changeDeviation(gi: number, ci: number, value: number) {
  const next = clone()
  next.groups[gi].conditions[ci].deviation = value
  emit('update:modelValue', next)
}

function toggleRelay(gi: number, ci: number) {
  const next = clone()
  const cond = next.groups[gi].conditions[ci]
  cond.relay = !cond.relay
  if (cond.relay) {
    cond.relayOnMinutes = cond.relayOnMinutes || 50
    cond.relayOffMinutes = cond.relayOffMinutes || 10
  }
  emit('update:modelValue', next)
}

function changeTimeRange(gi: number, ci: number, idx: number, value: number) {
  const next = clone()
  const cond = next.groups[gi].conditions[ci]
  if (!Array.isArray(cond.value)) cond.value = [0, 23]
  ;(cond.value as [number, number])[idx] = value
  emit('update:modelValue', next)
}

function addCondition(gi: number) {
  const next = clone()
  if (props.timeOnly) {
    next.groups[gi].conditions.push({ type: 'time', field: 'hour', operator: 'eq', value: 9, unit: '' })
  } else {
    // 첫 번째 env role을 기본값으로 사용
    const firstRole = envRoleFields.value[0]
    if (firstRole && firstRole.value !== 'hour') {
      next.groups[gi].conditions.push({
        type: 'sensor',
        field: firstRole.value,
        operator: (firstRole.operators[0] as Condition['operator']) || 'gte',
        value: firstRole.defaultValue ?? 0,
        unit: firstRole.unit,
      })
    } else {
      next.groups[gi].conditions.push(createEmptyCondition())
    }
  }
  emit('update:modelValue', next)
}

function removeCondition(gi: number, ci: number) {
  const next = clone()
  next.groups[gi].conditions.splice(ci, 1)
  if (next.groups[gi].conditions.length === 0) {
    next.groups.splice(gi, 1)
  }
  if (next.groups.length === 0) {
    next.groups.push(createEmptyConditionSet())
  }
  emit('update:modelValue', next)
}

function addGroup() {
  const next = clone()
  next.groups.push(createEmptyConditionSet())
  emit('update:modelValue', next)
}
</script>

<style scoped>
.step-condition { display: flex; flex-direction: column; gap: 16px; }
.step-title { font-size: 18px; font-weight: 700; color: var(--text-primary); margin: 0; }
.step-desc { font-size: 14px; color: var(--text-muted); margin: 0; }

.condition-groups { display: flex; flex-direction: column; gap: 12px; }

.group-logic {
  display: flex; justify-content: center; padding: 4px 0;
}

.logic-select {
  padding: 6px 12px; border: 1px solid var(--border-input); border-radius: 8px;
  font-size: 13px; color: var(--text-secondary); background: var(--bg-input); cursor: pointer;
}
.logic-select.small { padding: 4px 8px; font-size: 12px; }

.group-box {
  border: 1px solid var(--border-input); border-radius: 12px; padding: 16px;
  background: var(--bg-secondary); display: flex; flex-direction: column; gap: 10px;
}

.condition-row { display: flex; flex-direction: column; gap: 6px; }

.row-logic { display: flex; justify-content: center; }

.row-fields {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
}

.field-select, .op-select, .value-input {
  padding: 8px 12px; border: 1px solid var(--border-input); border-radius: 8px;
  font-size: 14px; background: var(--bg-input); color: var(--text-primary);
}
.field-select { min-width: 160px; }
.op-select { min-width: 80px; }
.value-input { min-width: 80px; max-width: 120px; }
.value-input.small { min-width: 60px; max-width: 80px; }

.range-sep { color: var(--text-muted); font-size: 14px; }
.unit { font-size: 13px; color: var(--text-muted); }

.btn-remove {
  background: none; border: none; color: #f44336; font-size: 16px;
  cursor: pointer; padding: 4px 8px; border-radius: 6px;
}
.btn-remove:hover { background: rgba(244, 67, 54, 0.1); }

.btn-add-condition {
  background: none; border: 1px dashed var(--border-input); border-radius: 8px;
  padding: 8px; font-size: 13px; color: var(--text-muted); cursor: pointer;
}
.btn-add-condition:hover { border-color: var(--text-muted); color: var(--text-secondary); }

.btn-add-group {
  background: none; border: 1px dashed var(--border-input); border-radius: 10px;
  padding: 10px; font-size: 14px; color: var(--text-muted); cursor: pointer;
}
.btn-add-group:hover { border-color: var(--text-muted); color: var(--text-secondary); }

/* 히스테리시스 */
.hysteresis-row {
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
}
.hysteresis-row label {
  font-size: 13px; font-weight: 600; color: var(--text-secondary);
}
.hysteresis-preview {
  width: 100%; font-size: 12px; color: var(--accent); background: var(--accent-bg);
  padding: 6px 10px; border-radius: 6px; margin-top: 4px;
}

/* 릴레이 옵션 */
.relay-option {
  padding: 8px 0;
}
.relay-toggle {
  display: flex; align-items: center; gap: 8px;
  font-size: 14px; color: var(--text-secondary); cursor: pointer;
}
.relay-toggle input { width: 18px; height: 18px; cursor: pointer; }

/* 시간대 스케줄러 */
.time-scheduler {
  border: 1px solid var(--border-input); border-radius: 12px; padding: 16px;
  background: var(--bg-secondary); display: flex; flex-direction: column; gap: 12px;
}
.scheduler-title { font-size: 15px; font-weight: 700; color: var(--text-primary); margin: 0; }

.time-slot {
  display: flex; align-items: center; gap: 8px;
}

.day-selector {
  display: flex; gap: 4px; flex-wrap: wrap;
}
.day-btn {
  padding: 6px 12px; border: 1px solid var(--border-input); border-radius: 8px;
  background: var(--bg-card); font-size: 13px; cursor: pointer;
  color: var(--text-primary); transition: all 0.15s;
}
.day-btn.active {
  background: var(--accent); color: white; border-color: var(--accent);
}

.repeat-toggle {
  display: flex; align-items: center; gap: 8px;
  font-size: 14px; color: var(--text-secondary); cursor: pointer;
}
.repeat-toggle input { width: 18px; height: 18px; cursor: pointer; }
</style>
