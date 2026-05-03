<template>
  <div class="step-timing">

    <!-- ── 관수: 시간 전용 ─────────────────────── -->
    <template v-if="intent === 'irrigation'">
      <h3 class="step-title">언제 물을 줄까요?</h3>

      <div v-for="(sched, idx) in schedule" :key="idx" class="schedule-block">
        <div v-if="schedule.length > 1" class="sched-header">
          <span class="sched-num">시간대 {{ idx + 1 }}</span>
          <button v-if="idx > 0" class="btn-remove-sm" @click="removeSchedule(idx)">삭제</button>
        </div>

        <div class="field-section">
          <label class="field-label">🗓️ 요일</label>
          <label class="everyday-toggle">
            <input type="checkbox" :checked="isEveryDay(sched.days)" @change="toggleEveryDay(idx)" />
            매일
          </label>
          <div class="day-chips">
            <label v-for="(dName, dIdx) in DAY_NAMES" :key="dIdx"
              class="day-chip" :class="{ active: sched.days.includes(dIdx) }" :aria-label="`${dName}요일`">
              <input type="checkbox" :checked="sched.days.includes(dIdx)" class="sr-only" @change="toggleDay(idx, dIdx)" />
              {{ dName }}
            </label>
          </div>
        </div>

        <div class="field-section">
          <label class="field-label">⏰ 시작 시각</label>
          <input type="time" class="time-input" :value="sched.startTime"
            @change="updateSched(idx, 'startTime', ($event.target as HTMLInputElement).value)" />
        </div>
      </div>

      <button class="btn-add-sched" @click="addSchedule">＋ 시간대 추가 (하루 여러 번)</button>
    </template>

    <!-- ── 개폐기 / 환풍기 ───────────────────── -->
    <template v-else>
      <h3 class="step-title">언제 작동할까요?</h3>

      <!-- 트리거 탭 -->
      <div class="trigger-tabs" role="tablist">
        <button class="trigger-tab" role="tab"
          :class="{ active: tab === 'time' }"
          :aria-selected="tab === 'time'"
          @click="setTab('time')">⏰ 시간으로</button>
        <button class="trigger-tab" role="tab"
          :class="{ active: tab === 'temperature' }"
          :aria-selected="tab === 'temperature'"
          @click="setTab('temperature')">🌡️ 온도로</button>
      </div>

      <!-- 시간 탭 -->
      <div v-show="tab === 'time'" class="tab-panel">
        <div class="field-section">
          <label class="field-label">🗓️ 요일</label>
          <label class="everyday-toggle">
            <input type="checkbox" :checked="isEveryDay(sharedDays)" @change="toggleRangeDayAll" />
            매일
          </label>
          <div class="day-chips">
            <label v-for="(dName, dIdx) in DAY_NAMES" :key="dIdx"
              class="day-chip" :class="{ active: sharedDays.includes(dIdx) }">
              <input type="checkbox" :checked="sharedDays.includes(dIdx)" class="sr-only" @change="toggleRangeDay(dIdx)" />
              {{ dName }}
            </label>
          </div>
        </div>

        <div v-for="(range, rIdx) in localTimeRanges" :key="rIdx" class="time-range-block">
          <div class="time-range-row">
            <div class="field-group">
              <label class="field-label">시작</label>
              <input type="time" class="time-input" :value="range.start"
                @change="updateRange(rIdx, 'start', ($event.target as HTMLInputElement).value)" />
            </div>
            <span class="tilde">~</span>
            <div class="field-group">
              <label class="field-label">종료</label>
              <input type="time" class="time-input" :value="range.end"
                @change="updateRange(rIdx, 'end', ($event.target as HTMLInputElement).value)" />
            </div>
            <button v-if="localTimeRanges.length > 1" class="btn-remove-sm" @click="removeRange(rIdx)">✕</button>
          </div>
          <p v-if="range.start && range.end && range.start >= range.end" class="error-msg">
            시작 시각은 종료 시각보다 앞이어야 합니다.
          </p>
        </div>

        <button class="btn-add-sched" @click="addRange">＋ 시간대 추가</button>

        <div v-if="timePreview" class="preview-box">
          <span class="preview-label">✨ 미리보기</span>
          <p class="preview-text">{{ timePreview }}</p>
        </div>

        <!-- 동작대기 (환풍기만) -->
        <div v-if="intent === 'fan'" class="relay-section">
          <div class="relay-header">
            <label class="relay-toggle-label">
              <input type="checkbox" :checked="relayEnabled" @change="emit('update:relayEnabled', !relayEnabled)" />
              동작대기 (ON/OFF 반복)
            </label>
          </div>
          <p class="relay-desc">설정한 시간대 동안 ON/OFF를 반복합니다. 예: 50분 ON → 10분 OFF → 반복</p>
          <div v-if="relayEnabled" class="relay-inputs">
            <input type="number" min="1" max="120" class="num-input-sm"
              :value="relayOnMin"
              @input="emit('update:relayOnMin', +($event.target as HTMLInputElement).value)" />
            <span class="unit-label">분 ON</span>
            <span class="range-sep">/</span>
            <input type="number" min="1" max="120" class="num-input-sm"
              :value="relayOffMin"
              @input="emit('update:relayOffMin', +($event.target as HTMLInputElement).value)" />
            <span class="unit-label">분 OFF 반복</span>
          </div>
        </div>
      </div>

      <!-- 온도 탭 -->
      <div v-show="tab === 'temperature'" class="tab-panel">
        <div class="field-row">
          <label class="field-label">🌡️ 기준 온도</label>
          <div class="input-unit-row">
            <input type="number" class="num-input" min="-20" max="60" step="0.5"
              placeholder="예: 28"
              :value="localTemp.base ?? ''"
              @input="updateTemp('base', +($event.target as HTMLInputElement).value)" />
            <span class="unit-label">°C</span>
          </div>
        </div>

        <div class="field-row">
          <label class="field-label">↕️ 편차 (허용 범위)</label>
          <div class="input-unit-row">
            <input type="number" class="num-input" min="0.5" max="10" step="0.5"
              :value="localTemp.hysteresis"
              @input="updateTemp('hysteresis', +($event.target as HTMLInputElement).value)" />
            <span class="unit-label">°C</span>
          </div>
        </div>
        <p class="field-hint">잦은 ON/OFF 방지를 위한 여유값이에요</p>

        <div v-if="tempPreview" class="preview-box">
          <span class="preview-label">✨ 미리보기</span>
          <p class="preview-line green">🟢 {{ onAt.toFixed(1) }}°C 이상이면 → {{ intent === 'opener' ? '열림' : '켜짐' }}</p>
          <p class="preview-line red">🔴 {{ offAt.toFixed(1) }}°C 이하면 → {{ intent === 'opener' ? '닫힘' : '꺼짐' }}</p>
          <p class="preview-line gray">⚪ {{ offAt.toFixed(1) }}~{{ onAt.toFixed(1) }}°C 사이 → 현재 상태 유지</p>
        </div>

        <!-- 추가 조건 (습도/CO2 등) -->
        <button class="btn-add-cond" @click="showExtraCond = !showExtraCond">
          {{ showExtraCond ? '− 추가 조건 닫기' : '＋ 습도/CO2 조건도 추가하기 (선택)' }}
        </button>
        <div v-if="showExtraCond" class="extra-conds">
          <div v-for="(ec, i) in localExtraConds" :key="i" class="extra-cond-row">
            <select class="form-select-sm" v-model="ec.field" @change="emitExtra">
              <option value="humidity">습도</option>
              <option value="co2">CO2</option>
              <option value="soil_moisture">토양수분</option>
              <option value="light">조도</option>
            </select>
            <select class="form-select-sm" v-model="ec.operator" @change="emitExtra">
              <option value="gte">이상</option>
              <option value="lte">이하</option>
            </select>
            <input type="number" class="num-input-sm" v-model.number="ec.value" @input="emitExtra" />
            <button class="btn-remove-sm" @click="removeExtra(i)">✕</button>
          </div>
          <button class="btn-add-sched" @click="addExtra">＋ 조건 추가</button>
        </div>

        <!-- 동작대기 (환풍기만, 온도 모드에서도) -->
        <div v-if="intent === 'fan'" class="relay-section">
          <div class="relay-header">
            <label class="relay-toggle-label">
              <input type="checkbox" :checked="relayEnabled" @change="emit('update:relayEnabled', !relayEnabled)" />
              동작대기 (ON/OFF 반복)
            </label>
          </div>
          <p class="relay-desc">조건이 유지되는 동안 ON/OFF를 반복합니다.</p>
          <div v-if="relayEnabled" class="relay-inputs">
            <input type="number" min="1" max="120" class="num-input-sm"
              :value="relayOnMin"
              @input="emit('update:relayOnMin', +($event.target as HTMLInputElement).value)" />
            <span class="unit-label">분 ON</span>
            <span class="range-sep">/</span>
            <input type="number" min="1" max="120" class="num-input-sm"
              :value="relayOffMin"
              @input="emit('update:relayOffMin', +($event.target as HTMLInputElement).value)" />
            <span class="unit-label">분 OFF 반복</span>
          </div>
        </div>
      </div>

    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive } from 'vue'
import type { WizardIntent, IrrigationSchedule, TimeRange, TemperatureTrigger, SensorCondition } from './types'

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토']

const props = defineProps<{
  intent: WizardIntent
  schedule: IrrigationSchedule[]
  triggerType: 'time' | 'temperature'
  timeRange: TimeRange | undefined
  timeRanges: TimeRange[] | undefined
  temperature: TemperatureTrigger | undefined
  extraConditions: SensorCondition[]
  relayEnabled: boolean
  relayOnMin: number
  relayOffMin: number
}>()

const emit = defineEmits<{
  'update:schedule': [v: IrrigationSchedule[]]
  'update:triggerType': [v: 'time' | 'temperature']
  'update:timeRange': [v: TimeRange]
  'update:timeRanges': [v: TimeRange[]]
  'update:temperature': [v: TemperatureTrigger]
  'update:extraConditions': [v: SensorCondition[]]
  'update:relayEnabled': [v: boolean]
  'update:relayOnMin': [v: number]
  'update:relayOffMin': [v: number]
}>()

// 탭 상태 (v-show 사용 → DOM 항상 존재해 사라짐 방지)
const tab = ref<'time' | 'temperature'>(props.triggerType)
function setTab(t: 'time' | 'temperature') {
  tab.value = t
  emit('update:triggerType', t)
}

// 시간 범위 로컬 상태 (다중 지원)
const defaultRanges = (props.timeRanges && props.timeRanges.length > 0)
  ? props.timeRanges
  : (props.timeRange ? [props.timeRange] : [{ days: [0, 1, 2, 3, 4, 5, 6], start: '08:00', end: '18:00' }])
const localTimeRanges = ref<TimeRange[]>(defaultRanges.map(r => ({ ...r })))

const sharedDays = computed(() => localTimeRanges.value[0]?.days ?? [0, 1, 2, 3, 4, 5, 6])

// 온도 로컬 상태
const localTemp = reactive<TemperatureTrigger>({
  base: props.temperature?.base ?? ('' as any),
  hysteresis: props.temperature?.hysteresis ?? 2,
})

const localExtraConds = ref<SensorCondition[]>([...props.extraConditions])
const showExtraCond = ref(false)

// ── 관수 스케줄 헬퍼 ────────────────────────────────
function isEveryDay(days: number[]) { return days.length === 7 }

function toggleEveryDay(idx: number) {
  const sched = [...props.schedule]
  sched[idx] = { ...sched[idx], days: isEveryDay(sched[idx].days) ? [1, 2, 3, 4, 5] : [0, 1, 2, 3, 4, 5, 6] }
  emit('update:schedule', sched)
}

function toggleDay(schedIdx: number, dayIdx: number) {
  const sched = [...props.schedule]
  const days = [...sched[schedIdx].days]
  const i = days.indexOf(dayIdx)
  if (i === -1) days.push(dayIdx)
  else days.splice(i, 1)
  sched[schedIdx] = { ...sched[schedIdx], days: days.sort((a, b) => a - b) }
  emit('update:schedule', sched)
}

function updateSched(idx: number, key: keyof IrrigationSchedule, val: any) {
  const sched = [...props.schedule]
  sched[idx] = { ...sched[idx], [key]: val }
  emit('update:schedule', sched)
}

function addSchedule() {
  const last = props.schedule[props.schedule.length - 1]
  emit('update:schedule', [...props.schedule, {
    days: last?.days ?? [1, 2, 3, 4, 5],
    startTime: '14:00',
    durationMin: last?.durationMin ?? 15,
  }])
}

function removeSchedule(idx: number) {
  emit('update:schedule', props.schedule.filter((_, i) => i !== idx))
}

// ── 시간 범위 헬퍼 ────────────────────────────────
function toggleRangeDayAll() {
  const newDays = isEveryDay(sharedDays.value) ? [1, 2, 3, 4, 5] : [0, 1, 2, 3, 4, 5, 6]
  localTimeRanges.value = localTimeRanges.value.map(r => ({ ...r, days: newDays }))
  emitTimeRanges()
}

function toggleRangeDay(dIdx: number) {
  const days = [...sharedDays.value]
  const i = days.indexOf(dIdx)
  if (i === -1) days.push(dIdx)
  else days.splice(i, 1)
  const sorted = days.sort((a, b) => a - b)
  localTimeRanges.value = localTimeRanges.value.map(r => ({ ...r, days: sorted }))
  emitTimeRanges()
}

function updateRange(idx: number, key: 'start' | 'end', val: string) {
  const ranges = [...localTimeRanges.value]
  ranges[idx] = { ...ranges[idx], [key]: val }
  localTimeRanges.value = ranges
  emitTimeRanges()
}

function addRange() {
  const last = localTimeRanges.value[localTimeRanges.value.length - 1]
  localTimeRanges.value = [...localTimeRanges.value, {
    days: last?.days ?? [0, 1, 2, 3, 4, 5, 6],
    start: '20:00',
    end: '22:00',
  }]
  emitTimeRanges()
}

function removeRange(idx: number) {
  localTimeRanges.value = localTimeRanges.value.filter((_, i) => i !== idx)
  emitTimeRanges()
}

function emitTimeRanges() {
  const ranges = localTimeRanges.value
  emit('update:timeRanges', ranges)
  if (ranges.length > 0) emit('update:timeRange', ranges[0])
}

// ── 온도 헬퍼 ────────────────────────────────────
function updateTemp(key: keyof TemperatureTrigger, val: number) {
  (localTemp as any)[key] = val
  emit('update:temperature', { ...localTemp })
}

const onAt = computed(() => (localTemp.base ?? 0) + (localTemp.hysteresis ?? 2))
const offAt = computed(() => (localTemp.base ?? 0) - (localTemp.hysteresis ?? 2))
const tempPreview = computed(() => localTemp.base != null && !isNaN(Number(localTemp.base)) && String(localTemp.base) !== '')

// ── 시간 미리보기 ─────────────────────────────────
const timePreview = computed(() => {
  const ranges = localTimeRanges.value
  if (ranges.length === 0) return ''
  const first = ranges[0]
  if (!first.start || !first.end || first.start >= first.end || first.days.length === 0) return ''
  const dayStr = isEveryDay(sharedDays.value) ? '매일' : sharedDays.value.map(d => DAY_NAMES[d]).join('·')
  const action = props.intent === 'opener' ? '닫힙니다' : '꺼집니다'
  const timeStr = ranges.map(r => `${r.start}~${r.end}`).join(', ')
  return `${dayStr} ${timeStr} 사이에만 작동합니다.\n그 외 시간엔 자동으로 ${action}.`
})

// ── 추가 조건 ─────────────────────────────────────
function addExtra() {
  localExtraConds.value.push({ field: 'humidity', operator: 'gte', value: 70 })
  emitExtra()
}
function removeExtra(i: number) {
  localExtraConds.value.splice(i, 1)
  emitExtra()
}
function emitExtra() {
  emit('update:extraConditions', [...localExtraConds.value])
}

// 개폐기/환풍기인 경우에만 초기 timeRanges emit
if (props.intent !== 'irrigation') {
  emitTimeRanges()
}
</script>

<style scoped>
.step-timing { display: flex; flex-direction: column; gap: 18px; }
.step-title { font-size: calc(17px * var(--content-scale, 1)); font-weight: 600; color: var(--text-primary); margin: 0; }

.schedule-block { display: flex; flex-direction: column; gap: 14px; padding: 14px; background: var(--bg-secondary); border-radius: var(--radius-md, 10px); }
.sched-header { display: flex; justify-content: space-between; align-items: center; }
.sched-num { font-size: calc(13px * var(--content-scale, 1)); font-weight: 600; color: var(--text-muted); }

.field-section { display: flex; flex-direction: column; gap: 8px; }
.field-label { font-size: calc(14px * var(--content-scale, 1)); font-weight: 500; color: var(--text-primary); }

.everyday-toggle {
  display: flex; align-items: center; gap: 6px;
  font-size: calc(13px * var(--content-scale, 1)); color: var(--text-primary); cursor: pointer;
}

.day-chips { display: flex; gap: 6px; flex-wrap: wrap; }
.day-chip {
  min-width: 36px; min-height: 36px; display: flex; align-items: center; justify-content: center;
  border: 1.5px solid var(--border-color); border-radius: 50%;
  font-size: calc(13px * var(--content-scale, 1)); cursor: pointer;
  transition: border-color 0.12s, background 0.12s;
}
.day-chip.active { border-color: var(--color-primary); background: var(--color-primary); color: #fff; font-weight: 700; }

.time-input {
  padding: 8px 12px; border: 1px solid var(--border-color);
  border-radius: var(--radius-sm, 6px); background: var(--bg-card); color: var(--text-primary);
  font-size: calc(14px * var(--content-scale, 1));
}

.btn-add-sched {
  display: inline-flex; align-items: center; justify-content: center;
  padding: 10px 16px; border: 1.5px dashed var(--border-color);
  border-radius: var(--radius-sm, 6px); background: none;
  color: var(--text-muted); font-size: calc(13px * var(--content-scale, 1)); cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
}
.btn-add-sched:hover { border-color: var(--color-primary); color: var(--color-primary); }

.trigger-tabs { display: flex; gap: 8px; }
.trigger-tab {
  flex: 1; padding: 10px; border: 2px solid var(--border-color);
  border-radius: var(--radius-sm, 6px); background: var(--bg-card); cursor: pointer;
  font-size: calc(14px * var(--content-scale, 1)); color: var(--text-muted);
  transition: border-color 0.15s, color 0.15s;
}
.trigger-tab.active { border-color: var(--color-primary); color: var(--color-primary); font-weight: 600; background: color-mix(in srgb, var(--color-primary) 6%, var(--bg-card)); }

.tab-panel { display: flex; flex-direction: column; gap: 16px; }

.time-range-block { display: flex; flex-direction: column; gap: 6px; }
.time-range-row { display: flex; align-items: flex-end; gap: 8px; }
.field-group { display: flex; flex-direction: column; gap: 4px; flex: 1; }
.tilde { font-size: 18px; color: var(--text-muted); padding-bottom: 8px; }

.error-msg { color: var(--color-error); font-size: calc(12px * var(--content-scale, 1)); margin: -8px 0 0; }

.field-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.field-hint { font-size: calc(12px * var(--content-scale, 1)); color: var(--text-muted); margin: -10px 0 0; }
.input-unit-row { display: flex; align-items: center; gap: 6px; }
.num-input {
  width: 80px; padding: 8px 10px; text-align: center;
  border: 1px solid var(--border-color); border-radius: var(--radius-sm, 6px);
  background: var(--bg-card); color: var(--text-primary);
  font-size: calc(14px * var(--content-scale, 1));
}

.unit-label { font-size: calc(13px * var(--content-scale, 1)); color: var(--text-muted); }

.preview-box {
  padding: 12px 14px; background: var(--bg-secondary);
  border-radius: var(--radius-sm, 6px);
  border-left: 3px solid var(--color-primary);
  display: flex; flex-direction: column; gap: 4px;
}
.preview-label { font-size: calc(12px * var(--content-scale, 1)); font-weight: 600; color: var(--color-primary); }
.preview-text { font-size: calc(13px * var(--content-scale, 1)); color: var(--text-primary); margin: 0; white-space: pre-line; }
.preview-line { font-size: calc(13px * var(--content-scale, 1)); margin: 0; }
.preview-line.green { color: var(--color-success, #16a34a); }
.preview-line.red { color: var(--color-error, #dc2626); }
.preview-line.gray { color: var(--text-muted); }

.btn-add-cond {
  background: none; border: none; color: var(--color-primary);
  font-size: calc(13px * var(--content-scale, 1)); cursor: pointer; padding: 4px 0; text-align: left;
}
.extra-conds { display: flex; flex-direction: column; gap: 8px; }
.extra-cond-row { display: flex; gap: 6px; align-items: center; }
.form-select-sm, .num-input-sm {
  padding: 6px 8px; border: 1px solid var(--border-color);
  border-radius: var(--radius-sm, 6px); background: var(--bg-card); color: var(--text-primary);
  font-size: calc(13px * var(--content-scale, 1));
}
.num-input-sm { width: 64px; text-align: center; }

/* 동작대기 */
.relay-section {
  display: flex; flex-direction: column; gap: 8px;
  padding: 12px 14px;
  background: var(--bg-secondary);
  border-radius: var(--radius-sm, 6px);
  border-top: 1px solid var(--border-color);
}
.relay-header { display: flex; align-items: center; }
.relay-toggle-label {
  display: flex; align-items: center; gap: 8px;
  font-size: calc(13px * var(--content-scale, 1)); font-weight: 500; color: var(--text-primary); cursor: pointer;
}
.relay-toggle-label input { width: 18px; height: 18px; cursor: pointer; }
.relay-desc { font-size: calc(12px * var(--content-scale, 1)); color: var(--text-muted); margin: 0; line-height: 1.5; }
.relay-inputs { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.range-sep { color: var(--text-muted); }

.btn-remove-sm {
  background: none; border: none; color: var(--text-muted); cursor: pointer;
  font-size: 14px; padding: 4px; line-height: 1;
}
.btn-remove-sm:hover { color: var(--color-error); }

.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0,0,0,0); }
</style>
