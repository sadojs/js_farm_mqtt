<template>
  <div class="self-view">
    <div v-if="loaded && !worker" class="empty">
      <p>등록된 근무 프로필이 없습니다.</p>
      <p class="sub">농장 관리자에게 일꾼 계정 등록을 요청해 주세요.</p>
    </div>

    <template v-else-if="worker">
      <!-- 헤더 -->
      <header class="self-head">
        <div class="who">
          <span class="avatar">{{ worker.name.charAt(0) }}</span>
          <div>
            <h2>내 근무</h2>
            <p class="sub">{{ worker.name }} · 시급 {{ worker.hourlyWage.toLocaleString() }}원 · {{ Number(worker.dailyHours) }}h/일</p>
          </div>
        </div>
        <div class="head-right">
          <span class="readonly-chip">👁 {{ t(lang, 'readonly') }}</span>
          <div class="lang-toggle" role="group" aria-label="언어 선택">
            <button
              v-for="opt in LANG_OPTIONS"
              :key="opt.code"
              :class="['lang-btn', { active: lang === opt.code }]"
              @click="lang = opt.code"
            >{{ opt.label }}</button>
          </div>
        </div>
      </header>

      <!-- 실수령 히어로 -->
      <div v-if="settlement" class="hero">
        <span class="hero-label">
          {{ t(lang, 'expectedNet') }} ({{ shortMD(settlement.periodStart) }}~{{ shortMD(settlement.periodEnd) }})
        </span>
        <span class="hero-net">{{ formatMoney(settlement.netPay, lang) }}</span>
        <div class="hero-stats">
          <div><span class="hs-label">{{ t(lang, 'workDays') }}</span><span class="hs-val">{{ settlement.workDays }}{{ t(lang, 'daysUnit') }}</span></div>
          <div><span class="hs-label">{{ t(lang, 'totalHours') }}</span><span class="hs-val">{{ fmtH(settlement.totalHours) }}h</span></div>
          <div><span class="hs-label">{{ t(lang, 'perHour') }}</span><span class="hs-val">{{ formatMoney(settlement.hourlyWage, lang) }}</span></div>
        </div>
      </div>

      <!-- 읽기 전용 달력 -->
      <WorkerCalendar
        :key="worker.id"
        :worker-id="worker.id"
        :lang="lang"
        :editable="false"
        hide-kpi
        @period-change="onPeriodChange"
      />

      <!-- 정산 확정 요청 전 전체 내역 -->
      <WorkerSettlement
        :worker-id="worker.id"
        :lang="lang"
        :show-nav="false"
        :initial-period="period"
        @changed="loadSettlement"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { workerPayrollApi } from '../api/worker-payroll.api'
import type { Worker, SettlementResponse } from '../types/worker-payroll.types'
import { LANG_OPTIONS, type PayrollLang, t, formatMoney, shortMD } from '../i18n/payroll-i18n'
import WorkerCalendar from './WorkerCalendar.vue'
import WorkerSettlement from './WorkerSettlement.vue'

const worker = ref<Worker | null>(null)
const settlement = ref<SettlementResponse | null>(null)
const loaded = ref(false)
const period = ref<string | undefined>(undefined)
const lang = ref<PayrollLang>('ko')

function fmtH(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

async function loadSettlement() {
  if (!worker.value) return
  settlement.value = await workerPayrollApi.getSettlement(worker.value.id, period.value)
}

function onPeriodChange(ps: string) {
  if (ps !== period.value) {
    period.value = ps
    loadSettlement()
  }
}

onMounted(async () => {
  worker.value = await workerPayrollApi.getMe()
  loaded.value = true
  if (worker.value) await loadSettlement()
})
</script>

<style scoped>
.self-view { display: flex; flex-direction: column; gap: 16px; }
.empty { text-align: center; padding: 60px 20px; color: var(--text-muted); }
.empty .sub { font-size: var(--font-size-caption); margin-top: 6px; }
.self-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.who { display: flex; align-items: center; gap: 12px; }
.avatar {
  width: 44px; height: 44px; border-radius: 50%;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 18px;
}
.self-head h2 { font-size: var(--font-size-title); font-weight: 800; color: var(--text-primary); }
.sub { color: var(--text-muted); font-size: var(--font-size-label); }
.head-right { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.readonly-chip {
  background: var(--bg-badge); color: var(--text-secondary);
  border-radius: 20px; padding: 6px 12px; font-size: var(--font-size-caption); font-weight: 600;
}
.lang-toggle { display: flex; flex-wrap: wrap; gap: 2px; background: var(--bg-hover); border-radius: 10px; padding: 4px; }
.lang-btn {
  border: none; background: none; padding: 7px 12px; border-radius: 8px; cursor: pointer;
  font-weight: 600; color: var(--text-secondary); font-size: var(--font-size-caption);
}
.lang-btn.active { background: var(--bg-card); color: var(--accent); box-shadow: var(--shadow-card); }
.hero {
  background: linear-gradient(135deg, #2e7d32 0%, #1b5e20 100%);
  border-radius: 16px;
  padding: 22px;
  color: #fff;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.hero-label { font-size: var(--font-size-label); opacity: 0.92; }
.hero-net { font-size: 38px; font-weight: 800; font-variant-numeric: tabular-nums; line-height: 1.1; }
.hero-stats { display: flex; gap: 28px; margin-top: 8px; flex-wrap: wrap; }
.hero-stats > div { display: flex; flex-direction: column; gap: 2px; }
.hs-label { font-size: var(--font-size-caption); opacity: 0.85; }
.hs-val { font-size: var(--font-size-subtitle); font-weight: 700; font-variant-numeric: tabular-nums; }
@media (max-width: 768px) {
  .hero-net { font-size: 30px; }
  .hero-stats { gap: 18px; }
}
</style>
