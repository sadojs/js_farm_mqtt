<template>
  <div class="modal-overlay" @click.self="$emit('cancel')">
    <div class="modal">
      <h3 class="modal-title">변동 공제 금액 입력</h3>
      <p class="modal-desc">
        {{ monthLabel }} 정산에만 적용됩니다. 그 달 고지서 금액을 입력해 주세요.
      </p>

      <div class="var-rows">
        <label v-for="d in items" :key="d.id" class="var-row">
          <span class="var-label">⚡ {{ d.label }}</span>
          <span class="amt-wrap">
            <input
              v-model.number="amounts[d.id]"
              type="number"
              min="0"
              step="1000"
              class="amt-input"
              placeholder="0"
            />
            <span class="won">원</span>
          </span>
        </label>
      </div>

      <p v-if="hasZero" class="warn">⚠ 미입력(0원) 항목이 있습니다. 그대로 확정하면 0원으로 처리됩니다.</p>

      <div class="modal-actions">
        <button class="btn-ghost" @click="$emit('cancel')">취소</button>
        <button class="btn-primary" @click="submit">입력 완료 · 정산 승인</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, computed } from 'vue'
import type { VariableDeductionDef } from '../types/worker-payroll.types'

const props = defineProps<{ items: VariableDeductionDef[]; monthLabel: string }>()
const emit = defineEmits<{
  (e: 'submit', amounts: Record<string, number>): void
  (e: 'cancel'): void
}>()

const amounts = reactive<Record<string, number>>(
  Object.fromEntries(props.items.map((d) => [d.id, 0])),
)

const hasZero = computed(() => props.items.some((d) => !Number(amounts[d.id])))

function submit() {
  const out: Record<string, number> = {}
  for (const d of props.items) out[d.id] = Math.max(0, Math.round(Number(amounts[d.id]) || 0))
  emit('submit', out)
}
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: var(--overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 16px;
}
.modal {
  background: var(--bg-card);
  border-radius: 14px;
  box-shadow: var(--shadow-modal);
  padding: 22px;
  width: 100%;
  max-width: 440px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.modal-title { font-size: var(--font-size-subtitle); font-weight: 700; color: var(--text-primary); }
.modal-desc { color: var(--text-secondary); font-size: var(--font-size-label); }
.var-rows { display: flex; flex-direction: column; gap: 10px; }
.var-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  background: var(--warning-bg);
  border: 1px solid var(--warning-border);
  border-radius: 10px;
  padding: 10px 14px;
}
.var-label { font-weight: 600; color: var(--warning-text); }
.amt-wrap { display: inline-flex; align-items: center; gap: 4px; }
.amt-input {
  width: 130px;
  padding: 9px 12px;
  border: 1px solid var(--border-input);
  border-radius: 8px;
  background: var(--bg-input);
  color: var(--text-primary);
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.won { color: var(--text-muted); }
.warn { color: var(--warning-text); font-size: var(--font-size-caption); }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; flex-wrap: wrap; }
.btn-ghost {
  background: var(--bg-hover);
  border: none;
  border-radius: 8px;
  padding: 10px 16px;
  color: var(--text-secondary);
  cursor: pointer;
  font-weight: 600;
}
.btn-primary {
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 10px 18px;
  cursor: pointer;
  font-weight: 600;
}
.btn-primary:hover { background: var(--accent-hover); }
</style>
