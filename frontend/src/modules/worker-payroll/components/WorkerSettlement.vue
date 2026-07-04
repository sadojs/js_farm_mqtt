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

      <!-- 고정 공제 -->
      <div v-for="(d, i) in fixedDeductions" :key="'f' + i" class="rcpt-row deduction-line">
        <span class="rcpt-label">
          {{ t(lang, 'deduction') }} · {{ translateLabel(d.label, lang) }}
          <span v-if="d.prorationReason" class="proration-reason">{{ formatProrationReason(d.prorationReason, lang) }}</span>
        </span>
        <span class="rcpt-amount minus">−{{ formatMoney(d.amount, lang) }}</span>
      </div>

      <!-- 변동 공제: 관리자가 정산 시 그 달 금액 직접 입력 -->
      <template v-if="editableVariable">
        <div v-for="def in data.variableDeductions" :key="'ve' + def.id" class="rcpt-row rcpt-variable">
          <span class="rcpt-label">
            ⚡ {{ t(lang, 'variable') }} · {{ translateLabel(def.label, lang) }}
            <span class="bill-src">({{ billMonth }}월 고지서)</span>
          </span>
          <span class="var-edit">
            <input
              v-model.number="variableInputs[def.id]"
              type="number"
              min="0"
              step="1000"
              class="var-amt-input"
              placeholder="0"
            /><span class="won-u">원</span>
          </span>
        </div>
      </template>
      <template v-else>
        <div v-for="(d, i) in variableDeductions" :key="'v' + i" class="rcpt-row rcpt-variable">
          <span class="rcpt-label">
            ⚡ {{ t(lang, 'variable') }} · {{ translateLabel(d.label, lang) }}
            <span class="bill-src">({{ billMonth }}월 고지서)</span>
          </span>
          <span class="rcpt-amount minus">−{{ formatMoney(d.amount, lang) }}</span>
        </div>
      </template>

      <div v-for="(a, i) in data.advances" :key="'a' + i" class="rcpt-row">
        <span class="rcpt-label">
          {{ t(lang, 'advance') }} · {{ shortMD(a.date) }}<template v-if="a.note"> {{ translateLabel(a.note, lang) }}</template>
        </span>
        <span class="rcpt-amount minus">−{{ formatMoney(a.amount, lang) }}</span>
      </div>
      <div v-if="data.advances.length > 0" class="rcpt-row subtotal">
        <span class="rcpt-label">{{ t(lang, 'advanceTotal') }}</span>
        <span class="rcpt-amount minus">−{{ formatMoney(data.advanceTotal, lang) }}</span>
      </div>

      <div class="rcpt-row net">
        <span class="rcpt-label">{{ t(lang, 'netPay') }}</span>
        <span class="rcpt-amount">{{ formatMoney(netPreview, lang) }}</span>
      </div>
    </div>

    <p v-if="editableVariable" class="var-hint">⚡ 변동 공제는 이번 {{ billMonth }}월 정산에만 적용됩니다. 그 달 고지서 금액을 입력 후 승인해 주세요.</p>

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
        @click="approve"
      >{{ busy ? '…' : t(lang, 'approve') }}</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted } from 'vue'
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
// 변동 공제 인라인 입력값 (def.id → 금액)
const variableInputs = reactive<Record<string, number>>({})

function fmtH(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

// 변동 공제 출처 표기용 — 정산 기간의 마감 월(고지서 월)
const billMonth = computed(() => {
  const iso = data.value?.periodEnd ?? ''
  return iso ? new Date(`${iso.slice(0, 10)}T00:00:00.000Z`).getUTCMonth() + 1 : 0
})

const fixedDeductions = computed(() =>
  (data.value?.deductions ?? []).filter((d) => d.kind !== 'variable'),
)
const variableDeductions = computed(() =>
  (data.value?.deductions ?? []).filter((d) => d.kind === 'variable'),
)
// 관리자가 정산 확정(승인) 가능한 시점에 변동 공제 금액을 직접 입력
const editableVariable = computed(
  () => !!data.value?.canApprove && (data.value?.variableDeductions?.length ?? 0) > 0,
)
const fixedTotal = computed(() => fixedDeductions.value.reduce((s, d) => s + d.amount, 0))
const variableInputTotal = computed(() =>
  (data.value?.variableDeductions ?? []).reduce(
    (s, def) => s + (Number(variableInputs[def.id]) || 0),
    0,
  ),
)
// 편집 중에는 입력값으로 실수령 미리 계산, 아니면 서버 값
const netPreview = computed(() => {
  if (!data.value) return 0
  if (editableVariable.value) {
    return data.value.grossPay - fixedTotal.value - variableInputTotal.value - data.value.advanceTotal
  }
  return data.value.netPay
})

async function reload() {
  data.value = await workerPayrollApi.getSettlement(props.workerId, period.value)
  emit('period-change', data.value.periodStart)
  // 변동 입력값 초기화 (편집 가능 시 0으로)
  for (const k of Object.keys(variableInputs)) delete variableInputs[k]
  for (const def of data.value.variableDeductions ?? []) variableInputs[def.id] = 0
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

async function approve() {
  busy.value = true
  const variableAmounts = editableVariable.value ? { ...variableInputs } : undefined
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

/**
 * 백엔드가 보낸 JSON 형태의 prorationReason 을 현재 언어로 조합.
 * 예: 월 80,000원 × 15/31일 (5/17 입사)
 */
function formatProrationReason(json: string | null | undefined, lng: PayrollLang): string {
  if (!json) return ''
  try {
    const d = JSON.parse(json)
    if (d.noOverlap) return ''
    const base = (d.base ?? 0).toLocaleString()
    let txt = t(lng, 'prorationLineMain')
      .replace('{base}', base)
      .replace('{days}', String(d.days))
      .replace('{total}', String(d.total))
    if (d.entryInMonth) {
      txt += ' ' + t(lng, 'entryNote').replace('{date}', shortMD(d.entryInMonth))
    }
    if (d.exitInMonth) {
      txt += ' ' + t(lng, 'exitNote').replace('{date}', shortMD(d.exitInMonth))
    }
    return txt
  } catch {
    return ''
  }
}
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
  font-size: var(--font-size-subtitle);
  cursor: pointer;
}
.nav-btn:disabled { opacity: 0.4; cursor: default; }
.period-label { font-weight: 700; color: var(--text-primary); font-variant-numeric: tabular-nums; font-size: var(--font-size-label); }
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
.rcpt-amount { font-weight: 700; color: var(--text-primary); font-variant-numeric: tabular-nums; white-space: nowrap; font-size: var(--font-size-label); }
.rcpt-amount.minus { color: var(--danger); }
.rcpt-row.rcpt-variable { background: var(--warning-bg); }
.rcpt-row.rcpt-variable .rcpt-label { color: var(--warning-text); font-weight: 600; }
.bill-src { color: var(--warning-text); font-size: var(--font-size-caption); opacity: 0.85; }
.var-edit { display: inline-flex; align-items: center; gap: 4px; }
.var-amt-input {
  width: 120px;
  padding: 8px 10px;
  border: 1px solid var(--warning-border);
  border-radius: 8px;
  background: var(--bg-input);
  color: var(--text-primary);
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  font-size: var(--font-size-label);
}
.var-amt-input:focus-visible { outline: 2px solid var(--warning); outline-offset: 1px; }
.won-u { color: var(--warning-text); font-weight: 600; font-size: var(--font-size-label); }
.var-hint {
  background: var(--warning-bg);
  color: var(--warning-text);
  border: 1px solid var(--warning-border);
  border-radius: 10px;
  padding: 10px 14px;
  font-size: var(--font-size-caption);
}
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
.status-chip { font-weight: 700; font-size: var(--font-size-label); }
.status-chip.done { color: var(--success-text); }
.status-chip.pending { color: var(--warning-text); }
.btn-primary {
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 12px 22px;
  font-weight: 600;
  font-size: var(--font-size-label);
  cursor: pointer;
  min-height: 44px;
}
.btn-primary:hover { background: var(--accent-hover); }
.btn-primary:disabled { opacity: 0.6; }

/* 가불 소계 — 가불 행들 다음에 굵게 표시 */
.rcpt-row.subtotal {
  background: var(--bg-hover);
  font-weight: 700;
}
.rcpt-row.subtotal .rcpt-label,
.rcpt-row.subtotal .rcpt-amount { font-weight: 700; }

/* 일할 계산 사유 — 공제 항목 라벨 아래에 보조 텍스트로 작게 */
.proration-reason {
  display: block;
  margin-top: 2px;
  font-size: var(--font-size-tiny);
  color: var(--text-muted);
  font-weight: 400;
  line-height: 1.35;
}
</style>
