<template>
  <div class="condition-row">
    <select class="form-select field-select" :value="condition.field" @change="onFieldChange($event)">
      <option v-for="f in fields" :key="f.value" :value="f.value">{{ f.label }}</option>
    </select>

    <template v-if="condition.field === 'rain'">
      <div class="btn-group-sm">
        <button type="button" class="btn-sm" :class="{ active: condition.value === true }" @click="updateValue(true)">예</button>
        <button type="button" class="btn-sm" :class="{ active: condition.value === false }" @click="updateValue(false)">아니오</button>
      </div>
    </template>

    <template v-else-if="condition.field === 'hour'">
      <select
        v-if="currentOperators.length > 1"
        class="form-select op-select"
        :value="condition.operator"
        @change="onOperatorChange($event)"
      >
        <option v-for="op in currentOperators" :key="op" :value="op">{{ opLabel(op) }}</option>
      </select>

      <template v-if="condition.operator === 'between'">
        <select class="form-select hour-select" :value="String(rangeStart)" @change="onTimeRangeStart($event)">
          <option v-for="h in hourOptions" :key="`start-${h}`" :value="h">{{ hourLabel(h) }}</option>
        </select>
        <span class="sep">~</span>
        <select class="form-select hour-select" :value="String(rangeEnd)" @change="onTimeRangeEnd($event)">
          <option v-for="h in hourOptions" :key="`end-${h}`" :value="h">{{ hourLabel(h) }}</option>
        </select>
      </template>
      <template v-else>
        <select class="form-select hour-select" :value="String(condition.value)" @change="onSingleValue($event)">
          <option v-for="h in hourOptions" :key="`eq-${h}`" :value="h">{{ hourLabel(h) }}</option>
        </select>
      </template>

      <template v-if="isIrrigationHour">
        <div class="repeat-toggle">
          <button type="button" class="btn-sm" :class="{ active: isRepeat }" @click="setScheduleType('repeat')">반복</button>
          <button type="button" class="btn-sm" :class="{ active: !isRepeat }" @click="setScheduleType('once')">1회</button>
        </div>
        <div class="weekday-group">
          <button
            v-for="day in weekdayOptions"
            :key="day.value"
            type="button"
            class="weekday-btn"
            :class="{ active: isWeekdaySelected(day.value) }"
            @click="toggleWeekday(day.value)"
          >
            {{ day.label }}
          </button>
        </div>
      </template>
    </template>

    <template v-else>
      <select class="form-select op-select" :value="condition.operator" @change="onOperatorChange($event)">
        <option v-for="op in currentOperators" :key="op" :value="op">{{ opLabel(op) }}</option>
      </select>
      <template v-if="condition.operator === 'between'">
        <input type="number" class="form-input val-input" :value="rangeStart" @input="onRangeStart($event)" />
        <span class="sep">~</span>
        <input type="number" class="form-input val-input" :value="rangeEnd" @input="onRangeEnd($event)" />
      </template>
      <template v-else>
        <input type="number" class="form-input val-input" :value="condition.value" @input="onSingleValue($event)" />
      </template>
      <span v-if="currentUnit" class="unit-label">{{ currentUnit }}</span>
    </template>

    <button v-if="removable" type="button" class="btn-del" @click="$emit('remove')">✕</button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { Condition, DeviceType } from '../../types/automation.types'
import {
  OPERATOR_LABELS_KR,
  getAllowedConditionFields,
  getAllowedOperators,
  normalizeConditionByDevice,
} from '../../utils/automation-helpers'

const props = defineProps<{ modelValue: Condition; removable: boolean; deviceType: DeviceType | null }>()
const emit = defineEmits<{ 'update:modelValue': [val: Condition]; remove: [] }>()

const condition = computed(() => props.modelValue)
const fields = computed(() => getAllowedConditionFields(props.deviceType))

const currentFieldDef = computed(() => fields.value.find(f => f.value === condition.value.field))
const currentOperators = computed(() => getAllowedOperators(props.deviceType, condition.value.field))
const currentUnit = computed(() => currentFieldDef.value?.unit || '')
const isIrrigationHour = computed(() => props.deviceType === 'irrigation' && condition.value.field === 'hour')
const isRepeat = computed(() => condition.value.scheduleType !== 'once')

const rangeStart = computed(() => Array.isArray(condition.value.value) ? condition.value.value[0] : 0)
const rangeEnd = computed(() => Array.isArray(condition.value.value) ? condition.value.value[1] : 0)
const hourOptions = Array.from({ length: 24 }, (_, i) => i)
const weekdayOptions = [
  { value: 1, label: '월' },
  { value: 2, label: '화' },
  { value: 3, label: '수' },
  { value: 4, label: '목' },
  { value: 5, label: '금' },
  { value: 6, label: '토' },
  { value: 7, label: '일' },
]

function opLabel(op: string) {
  return OPERATOR_LABELS_KR[op] || op
}

function update(partial: Partial<Condition>) {
  const merged = { ...condition.value, ...partial }
  emit('update:modelValue', normalizeConditionByDevice(merged, props.deviceType))
}

function updateValue(val: number | boolean | [number, number]) {
  update({ value: val })
}

function onFieldChange(e: Event) {
  const field = (e.target as HTMLSelectElement).value
  const next = normalizeConditionByDevice(
    {
      ...condition.value,
      field,
    },
    props.deviceType,
  )
  emit('update:modelValue', next)
}

function onOperatorChange(e: Event) {
  const op = (e.target as HTMLSelectElement).value as Condition['operator']
  if (op === 'between') {
    const base = typeof condition.value.value === 'number' ? condition.value.value : 8
    update({ operator: op, value: [base, Math.min(23, base + 8)] })
    return
  }

  const val = Array.isArray(condition.value.value) ? condition.value.value[0] : condition.value.value
  update({ operator: op, value: typeof val === 'number' ? val : 10 })
}

function onSingleValue(e: Event) {
  const v = Number((e.target as HTMLInputElement | HTMLSelectElement).value)
  update({ value: v })
}

function onTimeRangeStart(e: Event) {
  const v = Number((e.target as HTMLInputElement | HTMLSelectElement).value)
  update({ value: [v, rangeEnd.value] })
}

function onTimeRangeEnd(e: Event) {
  const v = Number((e.target as HTMLInputElement | HTMLSelectElement).value)
  update({ value: [rangeStart.value, v] })
}

function onRangeStart(e: Event) {
  const v = Number((e.target as HTMLInputElement).value)
  update({ value: [v, rangeEnd.value] })
}

function onRangeEnd(e: Event) {
  const v = Number((e.target as HTMLInputElement).value)
  update({ value: [rangeStart.value, v] })
}

function hourLabel(hour: number) {
  return `${String(hour).padStart(2, '0')}:00`
}

function setScheduleType(type: 'repeat' | 'once') {
  const days = Array.isArray(condition.value.daysOfWeek) && condition.value.daysOfWeek.length > 0
    ? condition.value.daysOfWeek
    : [1, 2, 3, 4, 5, 6, 7]
  update({ scheduleType: type, daysOfWeek: days })
}

function isWeekdaySelected(day: number) {
  return Array.isArray(condition.value.daysOfWeek) && condition.value.daysOfWeek.includes(day)
}

function toggleWeekday(day: number) {
  const current = Array.isArray(condition.value.daysOfWeek) ? [...condition.value.daysOfWeek] : []
  const index = current.indexOf(day)
  if (index >= 0) current.splice(index, 1)
  else current.push(day)

  const sorted = current.sort((a, b) => a - b)
  update({ daysOfWeek: sorted.length > 0 ? sorted : [1] })
}
</script>

<style scoped>
.condition-row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }

.form-select {
  padding: 7px 8px; border: 1px solid var(--border-input); border-radius: 8px;
  font-size: 13px; color: var(--text-primary); background: var(--bg-input);
}
.field-select { min-width: 90px; }
.op-select { min-width: 70px; }
.hour-select { min-width: 92px; }

.form-input {
  padding: 7px 8px; border: 1px solid var(--border-input); border-radius: 8px;
  font-size: 13px; color: var(--text-primary);
}
.val-input { width: 70px; }

.sep { color: var(--text-muted); font-size: 14px; }
.unit-label { font-size: 13px; color: #888; white-space: nowrap; }

.btn-group-sm,
.repeat-toggle { display: flex; gap: 4px; }

.btn-sm {
  padding: 6px 14px; border: 1px solid var(--border-input); border-radius: 6px; background: var(--bg-card);
  font-size: 13px; cursor: pointer; color: var(--text-link);
}
.btn-sm.active { border-color: #4caf50; background: #4caf50; color: white; }

.weekday-group {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.weekday-btn {
  min-width: 34px;
  padding: 6px 8px;
  border: 1px solid var(--border-input);
  border-radius: 8px;
  background: var(--bg-card);
  color: var(--text-link);
  font-size: 12px;
  cursor: pointer;
}

.weekday-btn.active {
  background: #2e7d32;
  border-color: #2e7d32;
  color: #fff;
}

.btn-del {
  background: none; border: none; color: #ccc; font-size: 16px; cursor: pointer;
  padding: 4px; line-height: 1;
}
.btn-del:hover { color: #ef5350; }

@media (max-width: 768px) {
  .condition-row {
    align-items: stretch;
  }

  .field-select,
  .op-select,
  .hour-select {
    min-height: 40px;
  }
}
</style>
