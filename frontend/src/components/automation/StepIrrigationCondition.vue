<template>
  <div class="step-irrigation">
    <h3 class="step-title">관수 조건 설정</h3>
    <p class="step-desc">관수 스케줄과 구역별 설정을 입력하세요.</p>

    <!-- 1. 시작시간 설정 -->
    <div class="section">
      <label class="section-label">시작시간</label>
      <button class="time-display" @click="openTimePicker">
        {{ form.startTime || '00:00' }}
      </button>
    </div>

    <!-- Time Picker Modal -->
    <Teleport to="body">
      <div v-if="showTimePicker" class="tp-overlay" @click.self="showTimePicker = false">
        <div class="tp-modal">
          <div class="tp-header">
            <button class="tp-cancel" @click="showTimePicker = false">취소</button>
            <span class="tp-title">시간 선택</span>
            <button class="tp-confirm" @click="confirmTime">확인</button>
          </div>
          <div class="tp-body">
            <div class="tp-highlight"></div>
            <div class="tp-column" ref="hourCol">
              <div class="tp-spacer"></div>
              <div v-for="h in 24" :key="h - 1" class="tp-item" @click="scrollTo(hourCol, h - 1)">
                {{ String(h - 1).padStart(2, '0') }}
              </div>
              <div class="tp-spacer"></div>
            </div>
            <div class="tp-colon">:</div>
            <div class="tp-column" ref="minCol">
              <div class="tp-spacer"></div>
              <div v-for="m in 60" :key="m - 1" class="tp-item" @click="scrollTo(minCol, m - 1)">
                {{ String(m - 1).padStart(2, '0') }}
              </div>
              <div class="tp-spacer"></div>
            </div>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 2. 상세 설정 -->
    <div class="section">
      <label class="section-label">상세 설정</label>

      <!-- 타이머 전원/B접점 -->
      <div class="setting-row compact">
        <span class="setting-name fixed">타이머 전원/B접점</span>
        <div class="setting-fields">
          <button
            class="toggle-btn"
            :class="{ active: form.timerSwitch }"
            @click="form.timerSwitch = !form.timerSwitch"
          >{{ form.timerSwitch ? 'ON' : 'OFF' }}</button>
        </div>
      </div>

      <!-- 구역 1~5 -->
      <div v-for="zone in form.zones" :key="zone.zone" class="setting-row zone-row">
        <div class="zone-name-wrap">
          <input
            type="text"
            v-model="zone.name"
            class="zone-name-input"
            :placeholder="`${zone.zone}구역`"
          />
        </div>
        <div class="setting-fields">
          <div class="field-group">
            <label class="field-label">관수시간</label>
            <div class="input-with-unit">
              <input type="number" v-model.number="zone.duration" min="1" class="num-input" />
              <span class="unit">분</span>
            </div>
          </div>
          <div class="field-group">
            <label class="field-label">대기시간</label>
            <div class="input-with-unit">
              <input type="number" v-model.number="zone.waitTime" min="0" class="num-input" />
              <span class="unit">분</span>
            </div>
          </div>
          <button
            class="toggle-btn"
            :class="{ active: zone.enabled }"
            @click="zone.enabled = !zone.enabled"
          >{{ zone.enabled ? 'ON' : 'OFF' }}</button>
        </div>
      </div>

      <!-- 교반기/접점 -->
      <div class="setting-row compact">
        <span class="setting-name fixed">교반기/접점</span>
        <div class="setting-fields">
          <button
            class="toggle-btn"
            :class="{ active: form.mixer.enabled }"
            @click="form.mixer.enabled = !form.mixer.enabled"
          >{{ form.mixer.enabled ? 'ON' : 'OFF' }}</button>
        </div>
      </div>

      <!-- 액비모터 -->
      <div class="setting-row zone-row">
        <div class="zone-name-wrap">
          <span class="setting-name fixed">액비모터</span>
        </div>
        <div class="setting-fields">
          <div class="field-group">
            <label class="field-label">투여시간</label>
            <div class="input-with-unit">
              <input type="number" v-model.number="form.fertilizer.duration" min="0" class="num-input" />
              <span class="unit">분</span>
            </div>
          </div>
          <div class="field-group">
            <label class="field-label">종료전대기</label>
            <div class="input-with-unit">
              <input type="number" v-model.number="form.fertilizer.preStopWait" min="0" class="num-input" />
              <span class="unit">분</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 3. 반복 설정 -->
    <div class="section">
      <label class="section-label">반복 설정</label>
      <div class="day-selector">
        <button
          v-for="d in DAYS"
          :key="d.value"
          class="day-btn"
          :class="{ active: form.schedule.days.includes(d.value) }"
          @click="toggleDay(d.value)"
        >{{ d.label }}</button>
      </div>
      <label class="repeat-toggle">
        <input type="checkbox" v-model="form.schedule.repeat" />
        매주 반복
      </label>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, watch, ref, nextTick } from 'vue'

export interface IrrigationZone {
  zone: number
  name: string
  duration: number
  waitTime: number
  enabled: boolean
}

export interface IrrigationFormData {
  type: 'irrigation'
  startTime: string
  timerSwitch: boolean
  zones: IrrigationZone[]
  mixer: { enabled: boolean }
  fertilizer: { duration: number; preStopWait: number }
  schedule: { days: number[]; repeat: boolean }
}

const props = defineProps<{
  modelValue: IrrigationFormData
}>()
const emit = defineEmits<{
  'update:modelValue': [value: IrrigationFormData]
}>()

const DAYS = [
  { value: 1, label: '월' }, { value: 2, label: '화' },
  { value: 3, label: '수' }, { value: 4, label: '목' },
  { value: 5, label: '금' }, { value: 6, label: '토' },
  { value: 0, label: '일' },
]

const form = reactive<IrrigationFormData>(JSON.parse(JSON.stringify(props.modelValue)))

/* ── Time Picker ── */
const showTimePicker = ref(false)
const hourCol = ref<HTMLElement | null>(null)
const minCol = ref<HTMLElement | null>(null)
const ITEM_H = 40

function openTimePicker() {
  showTimePicker.value = true
  const [h, m] = (form.startTime || '00:00').split(':').map(Number)
  nextTick(() => {
    setTimeout(() => {
      if (hourCol.value) hourCol.value.scrollTop = (h || 0) * ITEM_H
      if (minCol.value) minCol.value.scrollTop = (m || 0) * ITEM_H
    }, 50)
  })
}

function scrollTo(col: HTMLElement | null, index: number) {
  if (!col) return
  col.scrollTo({ top: index * ITEM_H, behavior: 'smooth' })
}

function confirmTime() {
  const h = Math.max(0, Math.min(23, Math.round((hourCol.value?.scrollTop || 0) / ITEM_H)))
  const m = Math.max(0, Math.min(59, Math.round((minCol.value?.scrollTop || 0) / ITEM_H)))
  form.startTime = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  showTimePicker.value = false
}

/* ── Watchers ── */
watch(() => props.modelValue, (val) => {
  Object.assign(form, JSON.parse(JSON.stringify(val)))
}, { deep: true })

watch(form, () => {
  emit('update:modelValue', JSON.parse(JSON.stringify(form)))
}, { deep: true })

function toggleDay(day: number) {
  const idx = form.schedule.days.indexOf(day)
  if (idx >= 0) form.schedule.days.splice(idx, 1)
  else form.schedule.days.push(day)
}
</script>

<style scoped>
.step-irrigation {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.step-title { font-size: 18px; font-weight: 700; color: var(--text-primary); margin: 0; }
.step-desc { font-size: 14px; color: var(--text-muted); margin: 0; }

.section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.section-label {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-primary);
  padding-bottom: 4px;
  border-bottom: 1px solid var(--border-light);
}

/* 시간 표시 버튼 */
.time-display {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  align-self: flex-start;
  padding: 10px 22px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-input);
  border-radius: 12px;
  font-size: calc(20px * var(--content-scale, 1));
  font-weight: 700;
  color: var(--text-primary);
  cursor: pointer;
  letter-spacing: 2px;
  transition: border-color 0.15s;
}

.time-display:active {
  border-color: var(--accent);
}

/* 설정 행 */
.setting-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  background: var(--bg-secondary);
  border-radius: 10px;
}

.setting-row.compact {
  justify-content: space-between;
}

.setting-row.zone-row {
  flex-wrap: wrap;
}

.setting-name.fixed {
  font-size: calc(16px * var(--content-scale, 1));
  font-weight: 600;
  color: var(--text-secondary);
  white-space: nowrap;
}

.zone-name-wrap {
  min-width: 90px;
}

.zone-name-input {
  width: 90px;
  padding: 6px 10px;
  border: 1px solid var(--border-input);
  border-radius: 6px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  background: var(--bg-input);
}

.setting-fields {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  flex: 1;
  justify-content: flex-end;
}

.field-group {
  display: flex;
  align-items: center;
  gap: 4px;
}

.field-label {
  font-size: calc(14px * var(--content-scale, 1));
  color: var(--text-muted);
  white-space: nowrap;
}

.input-with-unit {
  display: flex;
  align-items: center;
  gap: 2px;
}

.num-input {
  width: 60px;
  padding: 6px 8px;
  border: 1px solid var(--border-input);
  border-radius: 6px;
  font-size: calc(15px * var(--content-scale, 1));
  text-align: center;
  color: var(--text-primary);
  background: var(--bg-input);
}

.unit {
  font-size: calc(14px * var(--content-scale, 1));
  color: var(--text-muted);
}

.toggle-btn {
  padding: 4px 12px;
  border: 2px solid var(--border-input);
  border-radius: 6px;
  background: var(--bg-card);
  font-size: calc(13px * var(--content-scale, 1));
  font-weight: 600;
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.15s;
  min-width: 46px;
}

.toggle-btn.active {
  border-color: #4caf50;
  background: #4caf50;
  color: white;
}

/* 요일 선택 */
.day-selector {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.day-btn {
  padding: 8px 14px;
  border: 1px solid var(--border-input);
  border-radius: 8px;
  background: var(--bg-card);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  color: var(--text-primary);
  transition: all 0.15s;
}

.day-btn.active {
  background: var(--accent);
  color: white;
  border-color: var(--accent);
}

.repeat-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: var(--text-secondary);
  cursor: pointer;
}

.repeat-toggle input {
  width: 18px;
  height: 18px;
  cursor: pointer;
}
</style>

<!-- Time Picker Modal (Teleported to body, unscoped) -->
<style>
.tp-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

.tp-modal {
  background: var(--bg-card, #fff);
  border-radius: 14px;
  width: 280px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);
  overflow: hidden;
}

.tp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border-light, #eee);
}

.tp-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary, #333);
}

.tp-cancel,
.tp-confirm {
  background: none;
  border: none;
  font-size: 15px;
  cursor: pointer;
  padding: 4px 8px;
}

.tp-cancel {
  color: var(--text-muted, #999);
}

.tp-confirm {
  color: var(--accent, #4caf50);
  font-weight: 600;
}

.tp-body {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 200px;
  padding: 0 20px;
  overflow: hidden;
}

.tp-highlight {
  position: absolute;
  left: 16px;
  right: 16px;
  top: 50%;
  transform: translateY(-50%);
  height: 40px;
  background: var(--bg-secondary, #f5f5f5);
  border-radius: 10px;
  pointer-events: none;
  z-index: 0;
}

.tp-column {
  flex: 1;
  height: 100%;
  overflow-y: scroll;
  scroll-snap-type: y mandatory;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
  position: relative;
  z-index: 1;
  mask-image: linear-gradient(to bottom, transparent 0%, black 25%, black 75%, transparent 100%);
  -webkit-mask-image: linear-gradient(to bottom, transparent 0%, black 25%, black 75%, transparent 100%);
}

.tp-column::-webkit-scrollbar {
  display: none;
}

.tp-spacer {
  height: 80px;
}

.tp-item {
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  scroll-snap-align: center;
  font-size: 22px;
  font-weight: 600;
  color: var(--text-primary, #333);
  user-select: none;
}

.tp-colon {
  font-size: 24px;
  font-weight: 700;
  color: var(--text-primary, #333);
  padding: 0 4px;
  position: relative;
  z-index: 1;
}
</style>
