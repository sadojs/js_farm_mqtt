<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal" role="dialog" aria-modal="true" :aria-label="`${worker.name} ${targetYear} 시즌 시작`">
      <h3 class="modal-title">{{ worker.name }} · {{ targetYear }} 시즌 시작</h3>
      <p class="modal-desc">계정·연락처는 그대로 쓰고, 지난 시즌 조건을 불러왔어요.</p>

      <div class="grid2">
        <label class="field">
          <span>입국일 (근무 시작)</span>
          <input v-model="form.startDate" type="date" class="inp" />
        </label>
        <label class="field">
          <span>예정 귀국일 (선택)</span>
          <input v-model="form.endDate" type="date" class="inp" :min="form.startDate || undefined" />
        </label>
      </div>

      <div class="grid2">
        <label v-if="form.salaryType === 'hourly'" class="field">
          <span>시급 (원)</span>
          <input v-model.number="form.hourlyWage" type="number" min="0" step="10" class="inp wage" />
          <span v-if="lastSeason" class="hint">지난 시즌 {{ lastSeason.hourlyWage.toLocaleString() }}원 · {{ targetYear }}년 최저임금을 확인하세요</span>
        </label>
        <label v-else class="field">
          <span>고정 월급 (원)</span>
          <input v-model.number="form.fixedMonthlySalary" type="number" min="0" step="10000" class="inp wage" />
          <span v-if="lastSeason" class="hint">지난 시즌 {{ lastSeason.fixedMonthlySalary.toLocaleString() }}원</span>
        </label>
        <label class="field">
          <span>하루 기본 근무 (시간)</span>
          <input v-model.number="form.dailyHours" type="number" min="0" step="0.5" class="inp" />
        </label>
      </div>

      <div v-if="deductions.length" class="ded-box">
        <span class="ded-title">공제 항목 (지난 시즌에서 가져오기)</span>
        <label v-for="(d, i) in deductions" :key="i" class="ded-row">
          <input v-model="d.checked" type="checkbox" />
          <span class="ded-label">{{ d.kind === 'variable' ? '⚡ ' : '' }}{{ d.label }}</span>
          <template v-if="d.kind !== 'variable'">
            <input v-model.number="d.amount" type="number" min="0" step="1000" class="inp amt" :disabled="!d.checked" />
            <span class="won">원</span>
          </template>
          <span v-else class="var-note">정산 때 입력</span>
        </label>
      </div>

      <p class="safe-note">
        ✓ {{ lastSeason ? `${lastSeason.seasonYear} 시즌 기록은 바뀌지 않아요. ` : '' }}새 조건은 {{ form.startDate || '입국일' }}부터만 적용됩니다.
      </p>
      <p v-if="error" class="error">{{ error }}</p>

      <div class="modal-actions">
        <button class="btn-ghost" @click="$emit('close')">취소</button>
        <button class="btn-primary" :disabled="busy" @click="submit">{{ busy ? '…' : `${targetYear} 시즌 시작` }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, computed } from 'vue'
import { useNotificationStore } from '../../../stores/notification.store'
import { workerPayrollApi } from '../api/worker-payroll.api'
import type { Worker, WorkerSeason, SalaryType, SettlementCycleType } from '../types/worker-payroll.types'

const props = defineProps<{
  worker: Worker
  /** 조건을 불러올 지난 시즌 (보통 가장 최근 시즌) */
  lastSeason: WorkerSeason | null
  targetYear: number
}>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'created', seasonId: string): void }>()
const notify = useNotificationStore()

const last = props.lastSeason
// 입국일 기본값: 지난 시즌과 같은 월·일 (예: 3/20) — 대상 연도로
const defaultStart = last ? `${props.targetYear}-${last.startDate.slice(5, 10)}` : `${props.targetYear}-03-01`

const form = reactive({
  startDate: defaultStart,
  endDate: '',
  salaryType: (last?.salaryType ?? 'hourly') as SalaryType,
  hourlyWage: last?.hourlyWage ?? 0,
  fixedMonthlySalary: last?.fixedMonthlySalary ?? 0,
  dailyHours: last ? Number(last.dailyHours) : 8,
  settlementCycleType: (last?.settlementCycleType ?? 'calendar_month') as SettlementCycleType,
})
const deductions = reactive(
  (last?.deductions ?? []).map((d) => ({
    checked: true,
    label: d.label,
    kind: d.kind ?? 'fixed',
    amount: d.amount,
    prorate: d.prorate !== false,
  })),
)
const busy = ref(false)
const error = ref('')
const lastEnd = computed(() => last?.endDate?.slice(0, 10) ?? '')

async function submit() {
  error.value = ''
  if (!form.startDate) {
    error.value = '입국일을 입력해 주세요.'
    return
  }
  if (lastEnd.value && form.startDate <= lastEnd.value) {
    error.value = `입국일은 지난 시즌 종료일(${lastEnd.value}) 이후여야 합니다.`
    return
  }
  if (form.endDate && form.endDate < form.startDate) {
    error.value = '귀국일은 입국일 이후여야 합니다.'
    return
  }
  busy.value = true
  try {
    const created = await workerPayrollApi.createSeason(props.worker.id, {
      startDate: form.startDate,
      endDate: form.endDate || null,
      salaryType: form.salaryType,
      hourlyWage: form.salaryType === 'hourly' ? form.hourlyWage : 0,
      fixedMonthlySalary: form.salaryType === 'fixed_monthly' ? form.fixedMonthlySalary : 0,
      dailyHours: form.dailyHours,
      settlementCycleType: form.settlementCycleType,
      deductions: deductions
        .filter((d) => d.checked && d.label.trim())
        .map((d, i) => ({
          label: d.label,
          kind: d.kind,
          amount: d.kind === 'variable' ? 0 : Number(d.amount) || 0,
          prorate: d.prorate,
          sortOrder: i,
        })),
    })
    notify.success(
      '일꾼 관리',
      `${props.worker.name} ${created.seasonYear} 시즌을 시작했습니다.${created.accountReactivated ? ' (로그인 계정도 다시 활성화)' : ''}`,
    )
    emit('created', created.id)
  } catch (e: any) {
    error.value = e?.response?.data?.message ?? '시즌을 만들지 못했습니다.'
  } finally {
    busy.value = false
  }
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
  max-width: 520px;
  max-height: calc(100vh - 32px);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.modal-title { font-size: var(--font-size-subtitle); font-weight: 800; color: var(--text-primary); }
.modal-desc { color: var(--text-secondary); font-size: var(--font-size-label); }
.grid2 { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; }
.field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.field > span { font-size: var(--font-size-caption); color: var(--text-secondary); font-weight: 600; }
.field .hint { font-weight: 500; color: var(--warning-text); }
.inp {
  padding: 10px 12px;
  border: 1px solid var(--border-input);
  border-radius: 8px;
  background: var(--bg-input);
  color: var(--text-primary);
  min-width: 0;
  width: 100%;
  box-sizing: border-box;
}
.inp.wage { border: 2px solid var(--warning-border); font-weight: 700; }
.inp:disabled { background: var(--bg-hover); color: var(--text-muted); }
.ded-box { display: flex; flex-direction: column; gap: 8px; border: 1px solid var(--border-light); border-radius: 12px; padding: 12px; }
.ded-title { font-weight: 700; color: var(--text-primary); font-size: var(--font-size-label); }
.ded-row { display: flex; align-items: center; gap: 8px; }
.ded-label { flex: 1 1 auto; min-width: 0; color: var(--text-secondary); }
.ded-row .amt { width: 120px; flex: 0 0 auto; text-align: right; font-variant-numeric: tabular-nums; }
.won { color: var(--text-muted); font-size: var(--font-size-caption); }
.var-note { color: var(--warning-text); font-size: var(--font-size-caption); }
.safe-note {
  background: var(--success-bg);
  color: var(--success-text);
  border-radius: 10px;
  padding: 10px 14px;
  font-size: var(--font-size-caption);
  font-weight: 600;
}
.error { color: var(--danger); font-size: var(--font-size-caption); font-weight: 600; }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
.btn-ghost {
  border: 1px solid var(--border-input);
  background: var(--bg-card);
  color: var(--text-secondary);
  border-radius: 8px;
  padding: 10px 18px;
  font-weight: 600;
  cursor: pointer;
}
.btn-primary {
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 10px 20px;
  font-weight: 700;
  cursor: pointer;
  min-height: 44px;
}
.btn-primary:hover { background: var(--accent-hover); }
.btn-primary:disabled { opacity: 0.6; }
@media (max-width: 768px) {
  .grid2 { grid-template-columns: 1fr; }
}
</style>
