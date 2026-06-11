<template>
  <div class="sheet-overlay" @click.self="$emit('close')">
    <div class="sheet">
      <div class="sheet-handle"></div>
      <div class="sheet-head">
        <h3 class="sheet-title">
          {{ monthDay }}<span class="dow">{{ weekdayLabel }}</span>
        </h3>
        <button class="sheet-close" @click="$emit('close')" aria-label="닫기">✕</button>
      </div>

      <!-- 근무 / 휴일 토글 -->
      <div class="seg">
        <button
          class="seg-btn"
          :class="{ active: localStatus === 'work' }"
          :disabled="!editable"
          @click="localStatus = 'work'"
        >{{ t(lang, 'work') }}</button>
        <button
          class="seg-btn"
          :class="{ active: localStatus === 'off' }"
          :disabled="!editable"
          @click="localStatus = 'off'"
        >{{ t(lang, 'holiday') }}</button>
      </div>

      <!-- 근무 시간 -->
      <div v-if="localStatus === 'work'" class="hours-block">
        <span class="block-label">{{ t(lang, 'totalHours') }}</span>
        <div class="stepper">
          <button :disabled="!editable" @click="step(-0.5)">−</button>
          <span class="num">{{ fmtH(localHours) }}<small>h</small></span>
          <button :disabled="!editable" @click="step(0.5)">+</button>
        </div>
      </div>
      <p v-else class="off-note">{{ t(lang, 'holiday') }} · {{ t(lang, 'netPay') }} 0</p>

      <div v-if="advance" class="adv-line">
        {{ t(lang, 'advance') }} · {{ formatMoney(advance, lang) }}
      </div>

      <button v-if="editable" class="btn-save" @click="save">저장</button>
      <p v-else class="readonly-note">{{ t(lang, 'readonly') }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { type PayrollLang, t, formatMoney } from '../i18n/payroll-i18n'
import type { DayStatus } from '../types/worker-payroll.types'

const props = defineProps<{
  date: string
  dow: number
  status: DayStatus
  hours: number
  advance: number
  dailyHours: number
  editable: boolean
  lang: PayrollLang
}>()
const emit = defineEmits<{
  (e: 'save', payload: { status: DayStatus; hours?: number }): void
  (e: 'close'): void
}>()

const weekdays = ['일', '월', '화', '수', '목', '금', '토']
const localStatus = ref<DayStatus>(props.status === 'off' ? 'off' : 'work')
const localHours = ref<number>(props.status === 'off' ? props.dailyHours : (props.hours || props.dailyHours))

const monthDay = (() => {
  const d = new Date(`${props.date}T00:00:00.000Z`)
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일`
})()
const weekdayLabel = weekdays[props.dow] + '요일'

function fmtH(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}
function step(delta: number) {
  localHours.value = Math.max(0, Math.round((localHours.value + delta) * 2) / 2)
}
function save() {
  if (localStatus.value === 'off') emit('save', { status: 'off' })
  else emit('save', { status: 'work', hours: localHours.value })
}
</script>

<style scoped>
.sheet-overlay {
  position: fixed;
  inset: 0;
  background: var(--overlay);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  z-index: 1000;
}
.sheet {
  background: var(--bg-card);
  width: 100%;
  max-width: 480px;
  border-radius: 18px 18px 0 0;
  padding: 12px 20px calc(24px + env(safe-area-inset-bottom, 0px));
  display: flex;
  flex-direction: column;
  gap: 14px;
  box-shadow: var(--shadow-modal);
}
@media (min-width: 600px) {
  .sheet-overlay { align-items: center; }
  .sheet { border-radius: 16px; margin-bottom: 0; }
}
.sheet-handle {
  width: 40px;
  height: 4px;
  border-radius: 2px;
  background: var(--border-color);
  align-self: center;
}
.sheet-head { display: flex; align-items: center; justify-content: space-between; }
.sheet-title { font-size: var(--font-size-subtitle); font-weight: 700; color: var(--text-primary); }
.dow { margin-left: 8px; font-size: var(--font-size-label); font-weight: 500; color: var(--text-muted); }
.sheet-close {
  width: 36px; height: 36px; border: none; background: var(--bg-hover);
  border-radius: 50%; color: var(--text-muted); cursor: pointer; font-size: 16px;
}
.seg { display: flex; gap: 10px; }
.seg-btn {
  flex: 1;
  min-height: 48px;
  border: 1px solid var(--border-input);
  background: var(--bg-input);
  border-radius: 10px;
  font-weight: 700;
  color: var(--text-secondary);
  cursor: pointer;
}
.seg-btn.active { border-color: var(--accent); background: var(--accent-bg); color: var(--accent); }
.seg-btn:disabled { cursor: default; }
.hours-block { display: flex; flex-direction: column; gap: 8px; }
.block-label { font-size: var(--font-size-caption); color: var(--text-secondary); font-weight: 600; }
.stepper {
  display: flex;
  align-items: center;
  border: 1px solid var(--border-input);
  border-radius: 10px;
  overflow: hidden;
}
.stepper button {
  width: 56px; min-height: 48px; border: none; background: var(--bg-hover);
  color: var(--text-secondary); font-size: 22px; cursor: pointer;
}
.stepper button:disabled { opacity: 0.4; cursor: default; }
.stepper .num {
  flex: 1; text-align: center; font-weight: 800; font-size: 20px;
  color: var(--text-primary); font-variant-numeric: tabular-nums;
}
.stepper .num small { font-size: 14px; color: var(--text-muted); margin-left: 2px; }
.off-note { color: var(--text-muted); font-size: var(--font-size-label); }
.adv-line { color: var(--sensor-accent); font-weight: 600; font-size: var(--font-size-label); }
.btn-save {
  min-height: 48px;
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 10px;
  font-weight: 700;
  font-size: var(--font-size-body);
  cursor: pointer;
}
.btn-save:hover { background: var(--accent-hover); }
.readonly-note { text-align: center; color: var(--text-muted); font-weight: 600; }
</style>
