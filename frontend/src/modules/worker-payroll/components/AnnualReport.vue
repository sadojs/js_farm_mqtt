<template>
  <div class="annual">
    <header class="an-head">
      <div>
        <h3>{{ year }}년 인건비 결산</h3>
        <p class="sub">
          확정된 정산 기준
          <template v-if="report && report.unsettled.count > 0"> · 미확정 {{ report.unsettled.count }}건</template>
        </p>
      </div>
      <button class="btn-outline" :disabled="!report" @click="downloadCsv">엑셀 내려받기 (CSV)</button>
    </header>

    <p v-if="loading && !report" class="empty">불러오는 중…</p>

    <template v-else-if="report">
      <div v-if="report.unsettled.count > 0" class="unsettled-banner">
        <strong>미확정 정산 {{ report.unsettled.count }}건 (예상 실수령 {{ won(report.unsettled.estimatedNetPay) }})</strong>은 합계에 포함되지 않았습니다.
        <span class="ub-items">
          <span v-for="u in report.unsettled.items.slice(0, 6)" :key="u.workerId + u.periodStart">
            {{ u.workerName }} {{ md(u.periodStart) }}~ ({{ STATUS_LABEL[u.status] }})
          </span>
          <span v-if="report.unsettled.items.length > 6">외 {{ report.unsettled.items.length - 6 }}건</span>
        </span>
      </div>

      <!-- KPI -->
      <div class="kpis">
        <div class="kpi primary">
          <span class="kpi-label">총 고용비용</span>
          <span class="kpi-val">{{ won(report.totals.totalCost) }}</span>
          <span v-if="yoy !== null" class="kpi-sub">전년 대비 {{ yoy >= 0 ? '+' : '' }}{{ yoy.toFixed(1) }}%</span>
          <span v-else class="kpi-sub">급여{{ report.totals.extraCostTotal ? ' + 기타 비용' : '' }}</span>
        </div>
        <div class="kpi">
          <span class="kpi-label">급여 총액(세전)</span>
          <span class="kpi-val">{{ won(report.totals.grossPay) }}</span>
        </div>
        <div class="kpi">
          <span class="kpi-label">공제 회수</span>
          <span class="kpi-val">{{ won(report.totals.deductionTotal) }}</span>
          <span class="kpi-sub">숙소·식비 등</span>
        </div>
        <div class="kpi">
          <span class="kpi-label">실제 지급</span>
          <span class="kpi-val">{{ won(report.totals.cashOut) }}</span>
          <span class="kpi-sub">실수령 + 가불</span>
        </div>
        <div class="kpi">
          <span class="kpi-label">인원 · 근무시간</span>
          <span class="kpi-val">{{ report.totals.headcount }}명 · {{ fmtH(report.totals.totalHours) }}h</span>
          <span class="kpi-sub" v-if="report.totals.totalHours > 0">시간당 {{ won(report.totals.grossPay / report.totals.totalHours) }}</span>
        </div>
      </div>

      <!-- 월별 -->
      <div class="card">
        <h4 class="card-title">월별 인건비</h4>
        <div class="chart-box">
          <Bar :data="chartData" :options="chartOptions" />
        </div>
      </div>

      <div class="two-col">
        <!-- 일꾼별 -->
        <div class="card wide">
          <h4 class="card-title">일꾼별 합계</h4>
          <div v-if="report.byWorker.length" class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>일꾼</th>
                  <th>근무기간</th>
                  <th class="num">일수</th>
                  <th class="num">시간</th>
                  <th class="num">급여</th>
                  <th class="num">공제</th>
                  <th class="num">실수령</th>
                  <th>비중</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="w in report.byWorker" :key="w.workerId + (w.seasonId ?? '')">
                  <td class="strong">{{ w.workerName }}</td>
                  <td class="muted">{{ w.seasonYear }} 시즌 {{ md(w.seasonStart) }}~{{ md(w.seasonEnd) }}</td>
                  <td class="num">{{ w.workDays }}</td>
                  <td class="num">{{ fmtH(w.totalHours) }}</td>
                  <td class="num">{{ w.grossPay.toLocaleString() }}</td>
                  <td class="num minus">−{{ w.deductionTotal.toLocaleString() }}</td>
                  <td class="num strong">{{ w.netPay.toLocaleString() }}</td>
                  <td>
                    <span class="share"><i :style="{ width: (w.share * 100).toFixed(1) + '%' }"></i></span>
                    <small>{{ (w.share * 100).toFixed(0) }}%</small>
                  </td>
                </tr>
              </tbody>
              <tfoot>
                <tr>
                  <td class="strong">합계</td>
                  <td></td>
                  <td class="num">{{ report.totals.workDays }}</td>
                  <td class="num">{{ fmtH(report.totals.totalHours) }}</td>
                  <td class="num">{{ report.totals.grossPay.toLocaleString() }}</td>
                  <td class="num minus">−{{ report.totals.deductionTotal.toLocaleString() }}</td>
                  <td class="num strong">{{ report.totals.netPay.toLocaleString() }}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p v-else class="empty">{{ year }}년에 확정된 정산이 없습니다.</p>
        </div>

        <div class="side">
          <slot name="side" :report="report" :reload="load" />
          <div class="card">
            <h4 class="card-title">공제 항목별 회수액</h4>
            <ul v-if="report.deductionsByLabel.length" class="label-list">
              <li v-for="d in report.deductionsByLabel" :key="d.label">
                <span>{{ d.label }}</span><b>{{ won(d.amount) }}</b>
              </li>
            </ul>
            <p v-else class="muted small">공제 내역이 없습니다.</p>
          </div>
        </div>
      </div>

      <p class="compare">
        <template v-if="report.previousYear">
          {{ report.previousYear.year }}년 급여 총액 {{ won(report.previousYear.grossPay) }} · {{ report.previousYear.headcount }}명
          → {{ year }}년 {{ won(report.totals.grossPay) }} · {{ report.totals.headcount }}명
          <template v-if="yoy !== null">({{ yoy >= 0 ? '+' : '' }}{{ yoy.toFixed(1) }}%)</template>
        </template>
        <template v-else>{{ year - 1 }}년 확정 정산이 없어 비교할 수 없습니다.</template>
      </p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { Bar } from 'vue-chartjs'
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend } from 'chart.js'
import { useNotificationStore } from '../../../stores/notification.store'
import { workerPayrollApi } from '../api/worker-payroll.api'
import type { AnnualReport } from '../types/worker-payroll.types'
import { md, won } from '../utils/payroll-utils'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend)

const props = defineProps<{ year: number }>()
const notify = useNotificationStore()
const report = ref<AnnualReport | null>(null)
const loading = ref(false)
const STATUS_LABEL = { open: '정산일 전', pending: '정산 대기', requested: '승인 대기' } as const

function fmtH(n: number): string {
  return Number.isInteger(n) ? n.toLocaleString() : n.toFixed(1)
}

const yoy = computed(() => {
  const prev = report.value?.previousYear?.grossPay
  if (!prev) return null
  return ((report.value!.totals.grossPay - prev) / prev) * 100
})

/** 차트 색은 테마 강조색(--accent)에서 투명도만 달리해 파생 */
function accentRgba(alpha: number): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
  let r = 46, g = 125, b = 50
  const hex = raw.match(/^#([0-9a-f]{6})$/i)
  const rgb = raw.match(/rgba?\((\d+)[ ,]+(\d+)[ ,]+(\d+)/i)
  if (hex) {
    r = parseInt(hex[1].slice(0, 2), 16); g = parseInt(hex[1].slice(2, 4), 16); b = parseInt(hex[1].slice(4, 6), 16)
  } else if (rgb) {
    r = Number(rgb[1]); g = Number(rgb[2]); b = Number(rgb[3])
  }
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
function cssVar(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

const chartData = computed(() => {
  const m = report.value?.monthly ?? []
  return {
    labels: m.map((x) => `${x.month}월`),
    datasets: [
      { label: '실수령', data: m.map((x) => x.netPay), backgroundColor: accentRgba(0.9), stack: 'pay' },
      { label: '공제', data: m.map((x) => x.deductionTotal), backgroundColor: accentRgba(0.5), stack: 'pay' },
      { label: '가불', data: m.map((x) => x.advanceTotal), backgroundColor: accentRgba(0.25), stack: 'pay' },
    ],
  }
})
const chartOptions = computed(() => {
  const text = cssVar('--text-secondary', '#666')
  const grid = cssVar('--border-light', '#eee')
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'bottom' as const, labels: { color: text } },
      tooltip: { callbacks: { label: (c: any) => `${c.dataset.label}: ${Number(c.raw).toLocaleString()}원` } },
    },
    scales: {
      x: { stacked: true, ticks: { color: text }, grid: { display: false } },
      y: {
        stacked: true,
        ticks: { color: text, callback: (v: any) => `${Math.round(Number(v) / 10000).toLocaleString()}만` },
        grid: { color: grid },
      },
    },
  }
})

async function load() {
  loading.value = true
  try {
    report.value = await workerPayrollApi.getAnnual(props.year)
  } catch (e: any) {
    notify.error('일꾼 관리', e?.response?.data?.message ?? '연간 결산을 불러오지 못했습니다.')
  } finally {
    loading.value = false
  }
}

/** 의존성 없이 CSV (UTF-8 BOM — 엑셀에서 한글 깨짐 방지). 요약 / 월별 / 일꾼별 3개 구역 */
function downloadCsv() {
  const r = report.value
  if (!r) return
  const esc = (v: unknown) => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const rows: unknown[][] = [
    [`${r.year}년 인건비 결산 (확정 정산 기준)`],
    [],
    ['[요약]'],
    ['총 고용비용', r.totals.totalCost],
    ['급여 총액(세전)', r.totals.grossPay],
    ['공제 회수', r.totals.deductionTotal],
    ['가불', r.totals.advanceTotal],
    ['실수령', r.totals.netPay],
    ['실제 지급(실수령+가불)', r.totals.cashOut],
    ['기타 고용비용', r.totals.extraCostTotal],
    ['인원', r.totals.headcount],
    ['근무일수', r.totals.workDays],
    ['근무시간', r.totals.totalHours],
    ['미확정 정산(건)', r.unsettled.count],
    ['미확정 예상 실수령', r.unsettled.estimatedNetPay],
    [],
    ['[월별]'],
    ['월', '급여', '공제', '가불', '실수령'],
    ...r.monthly.map((m) => [`${m.month}월`, m.grossPay, m.deductionTotal, m.advanceTotal, m.netPay]),
    [],
    ['[일꾼별]'],
    ['일꾼', '시즌', '시작', '종료', '근무일수', '근무시간', '급여', '공제', '가불', '실수령', '비중(%)'],
    ...r.byWorker.map((w) => [
      w.workerName, w.seasonYear, w.seasonStart ?? '', w.seasonEnd ?? '', w.workDays, w.totalHours,
      w.grossPay, w.deductionTotal, w.advanceTotal, w.netPay, (w.share * 100).toFixed(1),
    ]),
    [],
    ['[공제 항목별]'],
    ['항목', '금액'],
    ...r.deductionsByLabel.map((d) => [d.label, d.amount]),
  ]
  const csv = '﻿' + rows.map((row) => row.map(esc).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `인건비결산_${r.year}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

watch(() => props.year, load)
onMounted(load)
defineExpose({ reload: load })
</script>

<style scoped>
.annual { display: flex; flex-direction: column; gap: 16px; }
.an-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.an-head h3 { font-size: var(--font-size-title); font-weight: 800; color: var(--text-primary); }
.sub { color: var(--text-muted); font-size: var(--font-size-label); margin-top: 4px; }
.btn-outline {
  border: 1px solid var(--accent); background: var(--bg-card); color: var(--accent);
  border-radius: 8px; padding: 9px 16px; font-weight: 700; cursor: pointer; min-height: 40px;
}
.btn-outline:hover:not(:disabled) { background: var(--accent-bg); }
.btn-outline:disabled { opacity: 0.5; }
.unsettled-banner {
  background: var(--warning-bg); color: var(--warning-text); border: 1px solid var(--warning-border);
  border-radius: 12px; padding: 12px 16px; font-size: var(--font-size-label);
  display: flex; flex-direction: column; gap: 6px;
}
.ub-items { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: var(--font-size-caption); }
.kpis { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; }
.kpi {
  background: var(--bg-card); border: 1px solid var(--border-card); border-radius: 12px;
  box-shadow: var(--shadow-card); padding: 12px 14px; display: flex; flex-direction: column; gap: 3px; min-width: 0;
}
.kpi.primary { background: var(--accent); border-color: var(--accent); }
.kpi.primary .kpi-label, .kpi.primary .kpi-val, .kpi.primary .kpi-sub { color: #fff; }
.kpi-label { font-size: var(--font-size-caption); color: var(--text-muted); font-weight: 600; }
.kpi-val { font-size: calc(18px * var(--content-scale, 1)); font-weight: 800; color: var(--text-primary); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.kpi-sub { font-size: var(--font-size-caption); color: var(--text-muted); }
.card {
  background: var(--bg-card); border: 1px solid var(--border-card); border-radius: 14px;
  box-shadow: var(--shadow-card); padding: 16px; display: flex; flex-direction: column; gap: 10px; min-width: 0;
}
.card-title { font-size: var(--font-size-label); font-weight: 700; color: var(--text-primary); }
.chart-box { position: relative; height: 260px; }
.two-col { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); gap: 16px; align-items: start; }
.side { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; min-width: 680px; }
th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid var(--border-light); white-space: nowrap; }
th { font-size: var(--font-size-caption); color: var(--text-muted); font-weight: 600; }
td { color: var(--text-secondary); font-size: var(--font-size-label); }
tfoot td { border-bottom: none; background: var(--bg-hover); font-weight: 700; }
.strong { color: var(--text-primary); font-weight: 700; }
.muted { color: var(--text-muted); }
.small { font-size: var(--font-size-caption); }
.num { text-align: right; font-variant-numeric: tabular-nums; }
.minus { color: var(--danger); }
.share { display: inline-block; width: 60px; height: 6px; border-radius: 3px; background: var(--bg-hover); vertical-align: middle; margin-right: 6px; overflow: hidden; }
.share i { display: block; height: 100%; background: var(--accent); }
.label-list { display: flex; flex-direction: column; gap: 6px; }
.label-list li { display: flex; justify-content: space-between; gap: 8px; color: var(--text-secondary); font-size: var(--font-size-label); }
.label-list b { color: var(--text-primary); font-variant-numeric: tabular-nums; }
.compare { color: var(--text-secondary); font-size: var(--font-size-label); }
.empty { text-align: center; padding: 30px; color: var(--text-muted); }
@media (max-width: 1100px) {
  .kpis { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
@media (max-width: 768px) {
  .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .kpi.primary { grid-column: 1 / -1; }
  .two-col { grid-template-columns: minmax(0, 1fr); }
  .chart-box { height: 220px; }
}
</style>
