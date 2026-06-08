<template>
  <div v-if="data" class="worker-calendar">
    <!-- KPI -->
    <div class="kpi-row">
      <div class="kpi">
        <span class="kpi-label">{{ t(lang, 'workDays') }}</span>
        <span class="kpi-value">{{ data.kpi.workDays }}<small>{{ t(lang, 'daysUnit') }}</small></span>
      </div>
      <div class="kpi">
        <span class="kpi-label">{{ t(lang, 'totalHours') }}</span>
        <span class="kpi-value">{{ fmtH(data.kpi.totalHours) }}<small>h</small></span>
        <span v-if="data.kpi.overtimeHours" class="kpi-sub">
          {{ t(lang, 'overtime') }} {{ data.kpi.overtimeHours > 0 ? '+' : '' }}{{ fmtH(data.kpi.overtimeHours) }}h
        </span>
      </div>
      <div class="kpi">
        <span class="kpi-label">{{ t(lang, 'expectedTotal') }}</span>
        <span class="kpi-value money">{{ formatMoney(data.kpi.grossPay, lang) }}</span>
      </div>
    </div>

    <!-- 월 네비 -->
    <div class="period-nav">
      <button class="nav-btn" :disabled="!data.prevPeriodStart" @click="go(data.prevPeriodStart)">‹</button>
      <span class="period-label">{{ shortMD(data.periodStart) }} ~ {{ shortMD(data.periodEnd) }}</span>
      <button class="nav-btn" @click="go(data.nextPeriodStart)">›</button>
    </div>

    <!-- 범례 -->
    <div class="legend">
      <span class="lg"><i class="sw work"></i>{{ t(lang, 'legendWork') }}</span>
      <span class="lg"><i class="sw ot"></i>{{ t(lang, 'legendOvertime') }}</span>
      <span class="lg"><i class="sw holiday"></i>{{ t(lang, 'legendHoliday') }}</span>
      <span class="lg"><i class="sw advance"></i>{{ t(lang, 'legendAdvance') }}</span>
    </div>

    <!-- 그리드 -->
    <div class="grid-head">
      <span v-for="(d, i) in weekdays" :key="d" :class="{ sun: i === 0, sat: i === 6 }">{{ d }}</span>
    </div>
    <div class="grid">
      <div v-for="cell in cells" :key="cell.date" class="cell" :class="{ blank: !cell.day, 'next-month': cell.nextMonth, 'month-start': cell.showMonth && cell.day !== undefined }">
        <template v-if="cell.day">
          <div class="cell-head">
            <span class="day-num" :class="{ sun: cell.dow === 0, sat: cell.dow === 6, 'with-month': cell.showMonth }">
              <template v-if="cell.showMonth">{{ cell.month }}/{{ cell.day }}</template>
              <template v-else>{{ cell.day }}</template>
            </span>
            <span v-if="cell.isSettleDay" class="settle-badge">{{ t(lang, 'settleDay') }}</span>
          </div>

          <div v-if="cell.beforeStart" class="muted-cell"></div>
          <template v-else>
            <div v-if="cell.holiday" class="holiday-cell">
              <span class="holiday-label">{{ t(lang, 'holiday') }}</span>
              <button class="work-btn" @click="toggleHoliday(cell)">{{ t(lang, 'work') }}</button>
            </div>
            <template v-else>
              <span class="hours-chip" :class="{ ot: cell.deltaHours > 0, early: cell.deltaHours < 0 }">
                {{ fmtH(cell.hours) }}h
              </span>
              <div class="day-actions">
                <button @click="adjust(cell, -0.5)">−</button>
                <button @click="adjust(cell, 0.5)">+</button>
                <button class="holiday-btn" @click="toggleHoliday(cell)">{{ t(lang, 'holiday') }}</button>
              </div>
            </template>
            <span v-if="cell.advance" class="advance-chip">
              {{ t(lang, 'advance') }} {{ (cell.advance / 10000).toLocaleString() }}만
            </span>
          </template>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useNotificationStore } from '../../../stores/notification.store'
import { workerPayrollApi } from '../api/worker-payroll.api'
import type { CalendarResponse, CalendarDay } from '../types/worker-payroll.types'
import { type PayrollLang, t, formatMoney, shortMD } from '../i18n/payroll-i18n'

const props = defineProps<{ workerId: string; lang: PayrollLang }>()

const notify = useNotificationStore()
const weekdays = ['일', '월', '화', '수', '목', '금', '토']
const data = ref<CalendarResponse | null>(null)
const period = ref<string | undefined>(undefined)

function fmtH(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

function parse(iso: string): Date {
  return new Date(`${iso.slice(0, 10)}T00:00:00.000Z`)
}

const cells = computed(() => {
  if (!data.value) return []
  const days = data.value.days
  if (days.length === 0) return []
  const anchor = data.value.periodStart
  const first = parse(days[0].date)
  const firstMonth = first.getUTCMonth() + 1
  const startDow = first.getUTCDay()
  const out: any[] = []
  for (let i = 0; i < startDow; i++) out.push({ day: 0 })
  days.forEach((d, idx) => {
    const dt = parse(d.date)
    const month = dt.getUTCMonth() + 1
    out.push({
      ...d,
      day: dt.getUTCDate(),
      dow: dt.getUTCDay(),
      month,
      // 첫 칸이거나 1일이면 '월/일'로 표기해 달 경계를 명확히
      showMonth: idx === 0 || dt.getUTCDate() === 1,
      nextMonth: month !== firstMonth,
      isSettleDay: d.date === anchor, // 정산 기준일(근무시작일과 같은 날)
    })
  })
  return out
})

async function reload() {
  data.value = await workerPayrollApi.getCalendar(props.workerId, period.value)
}

function go(p: string | null) {
  if (!p) return
  period.value = p
  reload()
}

async function adjust(cell: CalendarDay, delta: number) {
  const newDelta = Math.round((cell.deltaHours + delta) * 2) / 2
  try {
    await workerPayrollApi.setDayOverride(props.workerId, {
      date: cell.date,
      holiday: false,
      deltaHours: newDelta,
    })
    await reload()
  } catch {
    notify.error('일꾼 관리', '근무시간 조정에 실패했습니다.')
  }
}

async function toggleHoliday(cell: CalendarDay) {
  try {
    await workerPayrollApi.setDayOverride(props.workerId, {
      date: cell.date,
      holiday: !cell.holiday,
      deltaHours: 0,
    })
    await reload()
  } catch {
    notify.error('일꾼 관리', '휴일 처리에 실패했습니다.')
  }
}

watch(() => props.workerId, () => { period.value = undefined; reload() })
onMounted(reload)
defineExpose({ reload })
</script>

<style scoped>
.worker-calendar { display: flex; flex-direction: column; gap: 14px; }
.kpi-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.kpi {
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: 12px;
  box-shadow: var(--shadow-card);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.kpi-label { color: var(--text-muted); font-size: var(--font-size-caption); font-weight: 600; }
.kpi-value { font-size: 28px; font-weight: 800; color: var(--accent); font-variant-numeric: tabular-nums; }
.kpi-value small { font-size: 15px; color: var(--text-muted); margin-left: 2px; }
.kpi-value.money { font-size: 22px; }
.kpi-sub { font-size: var(--font-size-caption); color: var(--warning); font-weight: 600; }
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
.legend { display: flex; gap: 14px; flex-wrap: wrap; }
.lg { display: inline-flex; align-items: center; gap: 6px; font-size: var(--font-size-caption); color: var(--text-secondary); }
.sw { width: 12px; height: 12px; border-radius: 3px; display: inline-block; }
.sw.work { background: var(--success-text); }
.sw.ot { background: var(--warning); }
.sw.holiday { background: var(--text-muted); }
.sw.advance { background: var(--sensor-accent); }
.grid-head, .grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
.grid-head span { text-align: center; font-size: var(--font-size-caption); font-weight: 600; color: var(--text-muted); padding: 4px 0; }
.grid-head .sun { color: var(--danger); }
.grid-head .sat { color: var(--text-info-banner); }
.cell {
  min-height: 96px;
  background: var(--bg-card);
  border: 1px solid var(--border-light);
  border-radius: 8px;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.cell.blank { background: transparent; border: none; }
/* 다음 달 칸은 옅은 음영 + 좌측 강조선으로 구분 */
.cell.next-month { background: var(--bg-primary); }
.cell.month-start { border-left: 3px solid var(--accent); }
.day-num.with-month {
  background: var(--accent-bg);
  color: var(--accent);
  border-radius: 6px;
  padding: 1px 6px;
}
.cell-head { display: flex; align-items: center; justify-content: space-between; }
.day-num { font-size: var(--font-size-caption); font-weight: 600; color: var(--text-secondary); font-variant-numeric: tabular-nums; }
.day-num.sun { color: var(--danger); }
.day-num.sat { color: var(--text-info-banner); }
.settle-badge {
  background: var(--accent-bg);
  color: var(--accent);
  font-size: 10px;
  font-weight: 700;
  border-radius: 6px;
  padding: 1px 6px;
}
.muted-cell { flex: 1; }
.holiday-cell {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: var(--text-muted);
  font-weight: 600;
  font-size: var(--font-size-caption);
}
.holiday-label { color: var(--text-muted); }
.work-btn {
  border: 1px solid var(--accent);
  background: var(--accent-bg);
  color: var(--accent);
  border-radius: 6px;
  padding: 3px 10px;
  cursor: pointer;
  font-size: 11px;
  font-weight: 600;
}
.work-btn:hover { background: var(--accent); color: #fff; }
.hours-chip {
  align-self: flex-start;
  background: var(--success-bg);
  color: var(--success-text);
  font-weight: 700;
  border-radius: 6px;
  padding: 2px 8px;
  font-variant-numeric: tabular-nums;
}
.hours-chip.ot { background: var(--warning-bg); color: var(--warning-text); }
.hours-chip.early { background: var(--danger-bg); color: var(--danger); }
.day-actions { display: flex; gap: 3px; margin-top: auto; }
.day-actions button {
  flex: 1;
  border: 1px solid var(--border-input);
  background: var(--bg-input);
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  color: var(--text-secondary);
  padding: 3px 0;
  min-width: 0;
}
.day-actions .holiday-btn { flex: 1.4; font-size: 11px; }
.day-actions button:hover { background: var(--bg-hover); }
.advance-chip {
  background: var(--sensor-bg);
  color: var(--sensor-accent);
  font-size: 10px;
  font-weight: 700;
  border-radius: 6px;
  padding: 1px 6px;
  align-self: flex-start;
}
@media (max-width: 768px) {
  .kpi-row { grid-template-columns: 1fr; }
  .cell { min-height: 80px; }
}
</style>
