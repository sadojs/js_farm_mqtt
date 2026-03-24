<template>
  <div class="sequence-builder">
    <label class="field-label">관수 순서 설정</label>

    <div v-for="(step, idx) in steps" :key="idx" class="seq-step">
      <div class="step-header">
        <span class="step-num">Step {{ idx + 1 }}</span>
        <button v-if="steps.length > 1" class="btn-remove" @click="removeStep(idx)">삭제</button>
      </div>
      <div class="step-row">
        <select class="form-select" v-model="step.type" @change="emitSteps()">
          <option value="water">물</option>
          <option value="fertilizer">비료</option>
        </select>
        <input type="number" class="form-input num-input" v-model.number="step.value" min="1" @input="emitSteps()" />
        <select class="form-select unit-select" v-model="step.unit" @change="emitSteps()">
          <option value="minutes">분</option>
          <option value="liters">L</option>
        </select>
      </div>
      <div v-if="idx < steps.length - 1" class="step-arrow">↓</div>
    </div>

    <button class="btn-add" @click="addStep">+ 단계 추가</button>

    <div class="total-summary">
      총 소요: {{ totalSummary }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { IrrigationStep } from '../../types/automation.types'
import { createEmptyIrrigationStep } from '../../utils/automation-helpers'

const props = defineProps<{ modelValue: IrrigationStep[] }>()
const emit = defineEmits<{ 'update:modelValue': [val: IrrigationStep[]] }>()

const steps = ref<IrrigationStep[]>([...props.modelValue])

watch(() => props.modelValue, (val) => {
  if (JSON.stringify(val) !== JSON.stringify(steps.value)) {
    steps.value = [...val]
  }
}, { deep: true })

function emitSteps() {
  emit('update:modelValue', [...steps.value])
}

function addStep() {
  steps.value.push(createEmptyIrrigationStep())
  emitSteps()
}

function removeStep(idx: number) {
  steps.value.splice(idx, 1)
  emitSteps()
}

const totalSummary = computed(() => {
  const minTotal = steps.value.filter(s => s.unit === 'minutes').reduce((sum, s) => sum + (s.value || 0), 0)
  const litTotal = steps.value.filter(s => s.unit === 'liters').reduce((sum, s) => sum + (s.value || 0), 0)
  const parts: string[] = []
  if (minTotal > 0) parts.push(`${minTotal}분`)
  if (litTotal > 0) parts.push(`${litTotal}L`)
  return parts.length ? parts.join(' + ') : '0분'
})
</script>

<style scoped>
.sequence-builder { margin-top: 8px; }
.field-label { display: block; font-weight: 600; font-size: 14px; color: var(--text-secondary); margin-bottom: 12px; }

.seq-step { background: var(--bg-card); border: 1px solid var(--border-input); border-radius: 10px; padding: 12px; margin-bottom: 8px; }
.step-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.step-num { font-weight: 600; font-size: 13px; color: #4caf50; }
.btn-remove {
  background: none; border: 1px solid #ef5350; color: #ef5350; border-radius: 6px;
  padding: 2px 10px; font-size: 12px; cursor: pointer;
}
.btn-remove:hover { background: #ef5350; color: white; }

.step-row { display: flex; gap: 8px; align-items: center; }
.form-select {
  padding: 8px 10px; border: 1px solid var(--border-input); border-radius: 8px;
  font-size: 14px; color: var(--text-primary); background: var(--bg-input);
}
.form-input {
  padding: 8px 10px; border: 1px solid var(--border-input); border-radius: 8px;
  font-size: 14px; color: var(--text-primary);
}
.num-input { width: 80px; }
.unit-select { width: 70px; }

.step-arrow { text-align: center; color: #aaa; font-size: 18px; margin: 4px 0; }

.btn-add {
  width: 100%; padding: 10px; border: 2px dashed #ccc; border-radius: 10px;
  background: transparent; color: #888; font-size: 14px; font-weight: 500;
  cursor: pointer; margin-top: 4px;
}
.btn-add:hover { border-color: #4caf50; color: #4caf50; }

.total-summary {
  margin-top: 12px; padding: 8px 12px; background: #e8f5e9; border-radius: 8px;
  font-size: 13px; font-weight: 600; color: #2e7d32; text-align: center;
}
</style>
