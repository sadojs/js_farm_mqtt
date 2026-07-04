<template>
  <div v-if="data" class="worker-calendar">
    <!-- KPI (관리자 달력 탭) -->
    <div v-if="!hideKpi" class="kpi-row">
      <div class="kpi">
        <span class="kpi-label">{{ t(lang, 'workDays') }}</span>
        <span class="kpi-value">{{ data.kpi.workDays }}<small>{{ t(lang, 'daysUnit') }}</small></span>
      </div>
      <div class="kpi">
        <span class="kpi-label">{{ t(lang, 'totalHours') }}</span>
        <span class="kpi-value">{{ fmtH(data.kpi.totalHours) }}<small>h</small></span>
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
      <span class="lg"><i class="sw holiday"></i>{{ t(lang, 'legendHoliday') }}</span>
      <span class="lg"><i class="sw advance"></i>{{ t(lang, 'legendAdvance') }}</span>
    </div>

    <!-- 그리드 -->
    <div class="grid-head">
      <span v-for="(d, i) in weekdays" :key="d" :class="{ sun: i === 0, sat: i === 6 }">{{ d }}</span>
    </div>
    <div class="grid">
      <div
        v-for="cell in cells"
        :key="cell.date"
        class="cell"
        :class="{ blank: !cell.day, 'next-month': cell.nextMonth, terminated: cell.terminated, tappable: cell.day && !cell.beforeStart && !cell.terminated && (isMobile || !editable) }"
        @click="onCellClick(cell)"
      >
        <template v-if="cell.day">
          <div class="cell-head">
            <span class="day-num" :class="{ sun: cell.dow === 0, sat: cell.dow === 6, 'with-month': cell.showMonth }">
              <template v-if="cell.showMonth">{{ cell.month }}/{{ cell.day }}</template>
              <template v-else>{{ cell.day }}</template>
            </span>
            <span v-if="cell.isSettleDay" class="settle-badge">{{ t(lang, 'settleDay') }}</span>
          </div>

          <div v-if="cell.beforeStart" class="muted-cell"></div>
          <div v-else-if="cell.terminated" class="muted-cell terminated-label">{{ t(lang, 'terminated') }}</div>
          <template v-else>
            <div v-if="cell.status === 'off'" class="holiday-cell">
              <span class="holiday-label">{{ t(lang, 'holiday') }}</span>
              <button v-if="editable && !isMobile" class="work-btn" @click.stop="setWork(cell)">{{ t(lang, 'work') }}</button>
            </div>
            <template v-else>
              <span class="hours-chip">{{ fmtH(cell.hours) }}h</span>
              <div v-if="editable && !isMobile" class="day-actions">
                <button @click.stop="adjustHours(cell, -0.5)">−</button>
                <button @click.stop="adjustHours(cell, 0.5)">+</button>
                <button class="holiday-btn" @click.stop="setOff(cell)">{{ t(lang, 'holiday') }}</button>
              </div>
            </template>
            <span v-if="cell.advance" class="advance-chip">
              {{ t(lang, 'advance') }} {{ (cell.advance / 10000).toLocaleString() }}만
            </span>
          </template>
        </template>
      </div>
    </div>

    <DayModal
      v-if="modalCell"
      :date="modalCell.date"
      :dow="modalCell.dow"
      :status="modalCell.status"
      :hours="modalCell.hours"
      :advance="modalCell.advance"
      :daily-hours="data.worker.dailyHours"
      :editable="!!editable"
      :lang="lang"
      @save="onModalSave"
      @close="modalCell = null"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useNotificationStore } from '../../../stores/notification.store'
import { workerPayrollApi } from '../api/worker-payroll.api'
import type { CalendarResponse, CalendarDay, DayStatus } from '../types/worker-payroll.types'
import { type PayrollLang, t, formatMoney, shortMD } from '../i18n/payroll-i18n'
import DayModal from './DayModal.vue'

const props = defineProps<{
  workerId: string
  lang: PayrollLang
  editable?: boolean
  hideKpi?: boolean
}>()
const emit = defineEmits<{ (e: 'period-change', periodStart: string): void }>()

const notify = useNotificationStore()
const weekdays = ['일', '월', '화', '수', '목', '금', '토']
const data = ref<CalendarResponse | null>(null)
const period = ref<string | undefined>(undefined)
const modalCell = ref<any | null>(null)

// 모바일 여부 (반응형)
const isMobile = ref(false)
let mq: MediaQueryList | null = null
function syncMq() { isMobile.value = mq?.matches ?? false }

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
      showMonth: idx === 0 || dt.getUTCDate() === 1,
      nextMonth: month !== firstMonth,
      isSettleDay: d.date === anchor,
    })
  })
  return out
})

async function reload() {
  data.value = await workerPayrollApi.getCalendar(props.workerId, period.value)
  emit('period-change', data.value.periodStart)
}

function go(p: string | null) {
  if (!p) return
  period.value = p
  reload()
}

async function setDay(date: string, status: DayStatus, hours?: number) {
  if (!props.editable) return
  try {
    await workerPayrollApi.setDay(props.workerId, { date, status, hours })
    await reload()
  } catch {
    notify.error('일꾼 관리', '근무 설정에 실패했습니다.')
  }
}

function adjustHours(cell: CalendarDay, delta: number) {
  const next = Math.max(0, Math.round((cell.hours + delta) * 2) / 2)
  setDay(cell.date, 'work', next)
}
function setOff(cell: CalendarDay) {
  setDay(cell.date, 'off')
}
function setWork(cell: CalendarDay) {
  // 기본 근무시간으로 복원
  setDay(cell.date, 'work', data.value?.worker.dailyHours)
}

function onCellClick(cell: any) {
  if (!cell.day || cell.beforeStart || cell.terminated) return
  // 데스크탑 + 편집가능 = 인라인 컨트롤 사용 (모달 안 띄움)
  if (props.editable && !isMobile.value) return
  modalCell.value = cell
}

function onModalSave(payload: { status: DayStatus; hours?: number }) {
  if (modalCell.value) {
    setDay(modalCell.value.date, payload.status, payload.hours)
  }
  modalCell.value = null
}

watch(() => props.workerId, () => { period.value = undefined; reload() })
onMounted(() => {
  mq = window.matchMedia('(max-width: 768px)')
  syncMq()
  mq.addEventListener('change', syncMq)
  reload()
})
onUnmounted(() => mq?.removeEventListener('change', syncMq))
defineExpose({ reload })
</script>

<style scoped>
.worker-calendar { display: flex; flex-direction: column; gap: 14px; }
.kpi-row { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.kpi {
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: 12px;
  box-shadow: var(--shadow-card);
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.kpi-label { color: var(--text-muted); font-size: var(--font-size-caption); font-weight: 600; }
.kpi-value { font-size: 22px; font-weight: 800; color: var(--accent); font-variant-numeric: tabular-nums; }
.kpi-value small { font-size: 13px; color: var(--text-muted); margin-left: 2px; }
.kpi-value.money { font-size: 17px; }
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
.sw.holiday { background: var(--text-muted); }
.sw.advance { background: var(--sensor-accent); }
.grid-head, .grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 4px; }
.grid-head span { text-align: center; font-size: var(--font-size-caption); font-weight: 600; color: var(--text-muted); padding: 4px 0; }
.grid-head .sun { color: var(--danger); }
.grid-head .sat { color: var(--text-info-banner); }
.cell {
  min-width: 0;
  min-height: 96px;
  background: var(--bg-card);
  border: 1px solid var(--border-light);
  border-radius: 8px;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow: hidden;
}
.cell.blank { background: transparent; border: none; }
.cell.next-month { background: var(--bg-primary); }
.cell.tappable { cursor: pointer; }
.cell.tappable:hover { border-color: var(--accent); }
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
.cell.terminated { background: var(--bg-hover); opacity: 0.55; cursor: default; }
.terminated-label {
  display: flex; align-items: center; justify-content: center;
  font-size: 11px; color: var(--text-muted); font-weight: 600;
}
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
  max-width: 100%;
  background: var(--success-bg);
  color: var(--success-text);
  font-weight: 700;
  border-radius: 6px;
  padding: 2px 8px;
  font-variant-numeric: tabular-nums;
}
.day-actions { display: flex; flex-wrap: wrap; gap: 3px; margin-top: auto; }
.day-actions button {
  flex: 1 1 28px;
  border: 1px solid var(--border-input);
  background: var(--bg-input);
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  color: var(--text-secondary);
  padding: 4px 0;
  min-width: 0;
  min-height: 28px;
}
.day-actions .holiday-btn { flex: 1 1 100%; font-size: 11px; }
.day-actions button:hover { background: var(--bg-hover); }
.advance-chip {
  background: var(--sensor-bg);
  color: var(--sensor-accent);
  font-size: 10px;
  font-weight: 700;
  border-radius: 6px;
  padding: 1px 6px;
  align-self: flex-start;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
@media (max-width: 768px) {
  /* 모바일: 세로로 쌓지 않고 한 줄(3열) 컴팩트하게 — 세로 공간 절약 */
  .kpi-row { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
  .kpi { padding: 8px 10px; }
  .kpi-label { font-size: 11px; }
  .kpi-value { font-size: 17px; }
  .kpi-value small { font-size: 11px; }
  .kpi-value.money { font-size: 13px; }
  .cell { min-height: 72px; padding: 4px; }
  .day-num { font-size: 11px; }
  .day-num.with-month { padding: 1px 4px; }
  .settle-badge { font-size: 9px; padding: 1px 4px; }
  .hours-chip { font-size: 13px; padding: 2px 6px; }
}
</style>
