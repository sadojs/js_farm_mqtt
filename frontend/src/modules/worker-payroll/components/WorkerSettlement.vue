<template>
  <div v-if="data" class="settlement">
    <header class="settle-head">
      <h3 class="settle-title">{{ formatLongDate(data.settleDate, lang) }} · {{ t(lang, 'settlementTitle') }}</h3>
      <p class="settle-sub">
        {{ data.worker.name }} · {{ shortMD(data.periodStart) }} ~ {{ shortMD(data.periodEnd) }}
        ({{ t(lang, 'cycleNote') }})
      </p>
    </header>

    <div v-if="showNav" class="period-nav">
      <button class="nav-btn" :disabled="!data.prevPeriodStart" @click="go(data.prevPeriodStart)">‹</button>
      <span class="period-label">{{ shortMD(data.periodStart) }} ~ {{ shortMD(data.periodEnd) }}</span>
      <button class="nav-btn" @click="go(data.nextPeriodStart)">›</button>
    </div>

    <!-- 영수증 (확정 요청 전 전체 내역 표시) -->
    <div class="receipt">
      <div class="rcpt-row gross">
        <div class="rcpt-main">
          <span class="rcpt-label">
            {{ t(lang, 'work') }} {{ data.workDays }}{{ t(lang, 'daysUnit') }} ·
            {{ fmtH(data.totalHours) }}{{ t(lang, 'hoursUnit') }} × {{ formatMoney(data.hourlyWage, lang) }}
          </span>
        </div>
        <span class="rcpt-amount">{{ formatMoney(data.grossPay, lang) }}</span>
      </div>

      <div
        v-for="(d, i) in data.deductions"
        :key="'d' + i"
        class="rcpt-row"
        :class="{ 'rcpt-variable': d.kind === 'variable' }"
      >
        <span class="rcpt-label">
          <template v-if="d.kind === 'variable'">
            ⚡ {{ t(lang, 'variable') }} · {{ translateLabel(d.label, lang) }}
            <span class="bill-src">({{ billMonth }}월 고지서)</span>
          </template>
          <template v-else>{{ t(lang, 'deduction') }} · {{ translateLabel(d.label, lang) }}</template>
        </span>
        <span class="rcpt-amount minus">−{{ formatMoney(d.amount, lang) }}</span>
      </div>

      <div v-for="(a, i) in data.advances" :key="'a' + i" class="rcpt-row">
        <span class="rcpt-label">
          {{ t(lang, 'advance') }} · {{ shortMD(a.date) }}<template v-if="a.note"> {{ translateLabel(a.note, lang) }}</template>
        </span>
        <span class="rcpt-amount minus">−{{ formatMoney(a.amount, lang) }}</span>
      </div>

      <div class="rcpt-row net">
        <span class="rcpt-label">{{ t(lang, 'netPay') }}</span>
        <span class="rcpt-amount">{{ formatMoney(data.netPay, lang) }}</span>
      </div>
    </div>

    <!-- 박제 안내 -->
    <p v-if="data.frozen" class="immutable-note">
      이 정산은 당시 시급 {{ data.hourlyWage.toLocaleString() }}원 기준으로 보존됩니다 — 현재 시급으로 재계산되지 않습니다.
    </p>

    <!-- 상태/액션 -->
    <div class="settle-actions">
      <span v-if="data.status === 'confirmed'" class="status-chip done">✓ {{ t(lang, 'confirmed') }}</span>
      <span v-else-if="data.status === 'requested'" class="status-chip pending">
        {{ t(lang, 'requested') }}<template v-if="!data.canApprove"> · {{ t(lang, 'waitingApproval') }}</template>
      </span>

      <button
        v-if="data.canRequest"
        class="btn-primary"
        :disabled="busy"
        @click="request"
      >{{ busy ? '…' : t(lang, 'requestConfirm') }}</button>

      <button
        v-if="data.canApprove"
        class="btn-primary"
        :disabled="busy"
        @click="tryApprove"
      >{{ busy ? '…' : t(lang, 'approve') }}</button>
    </div>

    <VariableDeductionModal
      v-if="showVarModal && data"
      :items="data.variableDeductions"
      :month-label="billMonth + '월'"
      @submit="approve"
      @cancel="showVarModal = false"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useNotificationStore } from '../../../stores/notification.store'
import { workerPayrollApi } from '../api/worker-payroll.api'
import type { SettlementResponse } from '../types/worker-payroll.types'
import {
  type PayrollLang,
  t,
  formatMoney,
  formatLongDate,
  shortMD,
  translateLabel,
} from '../i18n/payroll-i18n'
import VariableDeductionModal from './VariableDeductionModal.vue'

const props = defineProps<{
  workerId: string
  lang: PayrollLang
  showNav?: boolean
  initialPeriod?: string
}>()
const emit = defineEmits<{ (e: 'changed'): void; (e: 'period-change', p: string): void }>()
const notify = useNotificationStore()

const data = ref<SettlementResponse | null>(null)
const period = ref<string | undefined>(props.initialPeriod)
const busy = ref(false)
const showVarModal = ref(false)

function fmtH(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

// 변동 공제 출처 표기용 — 정산 기간의 마감 월(고지서 월)
const billMonth = computed(() => {
  const iso = data.value?.periodEnd ?? ''
  return iso ? new Date(`${iso.slice(0, 10)}T00:00:00.000Z`).getUTCMonth() + 1 : 0
})

async function reload() {
  data.value = await workerPayrollApi.getSettlement(props.workerId, period.value)
  emit('period-change', data.value.periodStart)
}

function go(p: string | null) {
  if (!p) return
  period.value = p
  reload()
}

async function request() {
  busy.value = true
  try {
    await workerPayrollApi.requestSettlement(props.workerId, data.value?.periodStart)
    notify.success('일꾼 관리', '정산 확정을 요청했습니다.')
    await reload()
    emit('changed')
  } catch (e: any) {
    notify.error('일꾼 관리', e?.response?.data?.message ?? '정산 요청에 실패했습니다.')
  } finally {
    busy.value = false
  }
}

// 변동 공제가 있으면 금액 입력 모달 먼저, 없으면 바로 승인
function tryApprove() {
  if ((data.value?.variableDeductions?.length ?? 0) > 0) {
    showVarModal.value = true
  } else {
    approve()
  }
}

async function approve(variableAmounts?: Record<string, number>) {
  busy.value = true
  showVarModal.value = false
  try {
    await workerPayrollApi.approveSettlement(props.workerId, data.value?.periodStart, variableAmounts)
    notify.success('일꾼 관리', '정산을 승인했습니다.')
    await reload()
    emit('changed')
  } catch (e: any) {
    notify.error('일꾼 관리', e?.response?.data?.message ?? '정산 승인에 실패했습니다.')
  } finally {
    busy.value = false
  }
}

watch(() => props.workerId, () => { period.value = props.initialPeriod; reload() })
watch(() => props.initialPeriod, (p) => { if (p !== period.value) { period.value = p; reload() } })
onMounted(reload)
defineExpose({ reload })
</script>

<style scoped>
.settlement { display: flex; flex-direction: column; gap: 14px; max-width: 620px; }
.settle-title { font-size: var(--font-size-title); font-weight: 800; color: var(--text-primary); }
.settle-sub { color: var(--text-muted); font-size: var(--font-size-label); margin-top: 4px; }
.period-nav {
  display: flex;
  align-items: center;
  gap: 10px;
  align-self: flex-start;
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: 10px;
  padding: 6px 12px;
}
.nav-btn {
  width: 30px;
  height: 30px;
  border: none;
  background: var(--bg-hover);
  border-radius: 8px;
  color: var(--text-secondary);
  font-size: 18px;
  cursor: pointer;
}
.nav-btn:disabled { opacity: 0.4; cursor: default; }
.period-label { font-weight: 700; color: var(--text-primary); font-variant-numeric: tabular-nums; }
.receipt {
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: 14px;
  box-shadow: var(--shadow-card);
  overflow: hidden;
}
.rcpt-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-light);
}
.rcpt-row:last-child { border-bottom: none; }
.rcpt-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.rcpt-label { color: var(--text-secondary); font-size: var(--font-size-label); }
.rcpt-amount { font-weight: 700; color: var(--text-primary); font-variant-numeric: tabular-nums; white-space: nowrap; }
.rcpt-amount.minus { color: var(--danger); }
.rcpt-row.rcpt-variable { background: var(--warning-bg); }
.rcpt-row.rcpt-variable .rcpt-label { color: var(--warning-text); font-weight: 600; }
.bill-src { color: var(--warning-text); font-size: var(--font-size-caption); opacity: 0.85; }
.rcpt-row.gross .rcpt-amount { font-size: var(--font-size-subtitle); }
.rcpt-row.net { background: var(--accent-bg); }
.rcpt-row.net .rcpt-label { font-weight: 800; color: var(--accent); font-size: var(--font-size-subtitle); }
.rcpt-row.net .rcpt-amount { color: var(--accent); font-size: var(--font-size-title); }
.immutable-note {
  background: var(--warning-bg);
  color: var(--warning-text);
  border: 1px solid var(--warning-border);
  border-radius: 10px;
  padding: 10px 14px;
  font-size: var(--font-size-caption);
}
.settle-actions { display: flex; align-items: center; justify-content: flex-end; gap: 12px; flex-wrap: wrap; }
.status-chip { font-weight: 700; }
.status-chip.done { color: var(--success-text); }
.status-chip.pending { color: var(--warning-text); }
.btn-primary {
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 12px 22px;
  font-weight: 600;
  cursor: pointer;
  min-height: 44px;
}
.btn-primary:hover { background: var(--accent-hover); }
.btn-primary:disabled { opacity: 0.6; }
</style>
