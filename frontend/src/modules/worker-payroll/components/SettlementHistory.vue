<template>
  <div class="history">
    <header class="hist-head">
      <h3>정산 이력</h3>
      <p class="sub">확정된 정산은 당시 시급·공제·가불이 그대로 보존됩니다 (이후 설정 변경 무관)</p>
    </header>

    <!-- 확정 요청 대기 배너 -->
    <div v-for="req in pending" :key="req.id" class="request-banner">
      <div class="rb-icon">⏳</div>
      <div class="rb-text">
        <strong>{{ req.workerName }}님의 {{ monthOf(req.settleDate) }}월 정산 확정 요청</strong>
        <span>{{ fmtDateTime(req.requestedAt) }} 요청 · 실수령 {{ req.netPay.toLocaleString() }}원</span>
      </div>
      <button class="btn-approve" :disabled="busyId === req.id" @click="approve(req)">
        {{ busyId === req.id ? '…' : '승인' }}
      </button>
    </div>

    <!-- 표 -->
    <div v-if="items.length" class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>정산일</th>
            <th>일꾼</th>
            <th>기간</th>
            <th class="num">근무</th>
            <th class="num">지급액</th>
            <th class="num">공제</th>
            <th class="num">실수령</th>
            <th>상태</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="it in items" :key="it.id">
            <td class="strong">{{ it.settleDate }}</td>
            <td>{{ it.workerName }}</td>
            <td class="muted">{{ it.periodStart }} ~ {{ it.periodEnd }}</td>
            <td class="num">{{ it.snapshot.workDays }}일 · {{ fmtH(it.snapshot.totalHours) }}h</td>
            <td class="num">{{ it.snapshot.grossPay.toLocaleString() }}</td>
            <td class="num minus">−{{ it.snapshot.deductionTotal.toLocaleString() }}</td>
            <td class="num strong">{{ it.netPay.toLocaleString() }}</td>
            <td>
              <span class="status" :class="it.status">{{ it.status === 'confirmed' ? '확정' : '요청됨' }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-else class="empty">아직 정산 이력이 없습니다.</p>

    <VariableDeductionModal
      v-if="varModal"
      :items="varModal.items"
      :month-label="varModal.month + '월'"
      @submit="onVarSubmit"
      @cancel="varModal = null"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useNotificationStore } from '../../../stores/notification.store'
import { workerPayrollApi } from '../api/worker-payroll.api'
import type { SettlementHistoryItem, VariableDeductionDef } from '../types/worker-payroll.types'
import VariableDeductionModal from './VariableDeductionModal.vue'

const notify = useNotificationStore()
const items = ref<SettlementHistoryItem[]>([])
const busyId = ref<string | null>(null)
const varModal = ref<{ req: SettlementHistoryItem; items: VariableDeductionDef[]; month: number } | null>(null)

const pending = computed(() => items.value.filter((i) => i.status === 'requested'))

function fmtH(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}
function monthOf(iso: string): number {
  return new Date(`${iso.slice(0, 10)}T00:00:00.000Z`).getUTCMonth() + 1
}
function fmtDateTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

async function load() {
  items.value = await workerPayrollApi.listSettlements()
}

async function approve(req: SettlementHistoryItem) {
  // 변동 공제가 있으면 금액 입력 모달 먼저
  try {
    const s = await workerPayrollApi.getSettlement(req.workerId, req.periodStart)
    if ((s.variableDeductions?.length ?? 0) > 0) {
      varModal.value = { req, items: s.variableDeductions, month: monthOf(req.periodEnd) }
      return
    }
  } catch {
    /* 조회 실패 시 그냥 승인 시도 */
  }
  await doApprove(req)
}

async function doApprove(req: SettlementHistoryItem, variableAmounts?: Record<string, number>) {
  busyId.value = req.id
  varModal.value = null
  try {
    await workerPayrollApi.approveSettlement(req.workerId, req.periodStart, variableAmounts)
    notify.success('일꾼 관리', `${req.workerName}님의 정산을 승인했습니다.`)
    await load()
  } catch {
    notify.error('일꾼 관리', '정산 승인에 실패했습니다.')
  } finally {
    busyId.value = null
  }
}

function onVarSubmit(amounts: Record<string, number>) {
  if (varModal.value) doApprove(varModal.value.req, amounts)
}

onMounted(load)
defineExpose({ reload: load })
</script>

<style scoped>
.history { display: flex; flex-direction: column; gap: 16px; }
.hist-head h3 { font-size: var(--font-size-title); font-weight: 800; color: var(--text-primary); }
.hist-head .sub { color: var(--text-muted); font-size: var(--font-size-label); margin-top: 4px; }
.request-banner {
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--warning-bg);
  border: 1px solid var(--warning-border);
  border-radius: 12px;
  padding: 14px 16px;
}
.rb-icon { font-size: 22px; }
.rb-text { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
.rb-text strong { color: var(--text-primary); }
.rb-text span { color: var(--warning-text); font-size: var(--font-size-caption); }
.btn-approve {
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 10px 20px;
  font-weight: 700;
  cursor: pointer;
  min-height: 44px;
}
.btn-approve:hover { background: var(--accent-hover); }
.btn-approve:disabled { opacity: 0.6; }
.table-wrap {
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: 14px;
  box-shadow: var(--shadow-card);
  overflow-x: auto;
}
table { width: 100%; border-collapse: collapse; min-width: 640px; }
th, td { padding: 14px 16px; text-align: left; border-bottom: 1px solid var(--border-light); white-space: nowrap; }
th { font-size: var(--font-size-caption); color: var(--text-muted); font-weight: 600; }
td { color: var(--text-secondary); font-size: var(--font-size-label); }
td.strong { color: var(--text-primary); font-weight: 700; }
td.muted { color: var(--text-muted); }
.num { text-align: right; font-variant-numeric: tabular-nums; }
.minus { color: var(--danger); }
tbody tr:last-child td { border-bottom: none; }
.status { font-weight: 700; font-size: var(--font-size-caption); border-radius: 6px; padding: 2px 8px; }
.status.confirmed { background: var(--success-bg); color: var(--success-text); }
.status.requested { background: var(--warning-bg); color: var(--warning-text); }
.empty { text-align: center; padding: 40px; color: var(--text-muted); }
</style>
