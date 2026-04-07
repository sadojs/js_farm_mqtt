<template>
  <div class="step-irrigation">
    <h3 class="step-title">관주 작동 조건</h3>
    <p class="step-desc">관주 일정과 구역별 설정을 입력하세요.</p>

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
      <label class="section-label">관주 구역 설정</label>

      <!-- 구역 1~4 (zone > 4는 미지원으로 표시 제외) -->
      <div v-for="zone in form.zones.filter(z => `zone_${z.zone}` in effectiveMapping)" :key="zone.zone" class="setting-row zone-row">
        <div class="zone-header-row">
          <input
            type="text"
            v-model="zone.name"
            class="zone-name-input"
            :placeholder="getZoneLabel(zone.zone)"
          />
          <select
            v-if="editableMapping"
            class="switch-select"
            :value="getZoneSwitch(zone.zone)"
            @change="updateZoneSwitch(zone.zone, ($event.target as HTMLSelectElement).value)"
          >
            <option value="" disabled>-- 선택 --</option>
            <option v-for="sw in AVAILABLE_SWITCH_CODES" :key="sw" :value="sw">{{ sw }}</option>
          </select>
          <span v-else class="switch-hint">{{ getZoneSwitch(zone.zone) }}</span>
        </div>
        <div class="setting-fields">
          <div class="field-group">
            <label class="field-label">관주 시간</label>
            <div class="input-with-unit">
              <input type="number" v-model.number="zone.duration" min="1" class="num-input" />
              <span class="unit">분</span>
            </div>
          </div>
          <div class="field-group">
            <label class="field-label">쉬는 시간</label>
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

      <!-- 교반기 -->
      <div class="setting-row compact">
        <div class="zone-header-row">
          <span class="setting-name fixed">교반기</span>
          <select v-if="editableMapping" class="switch-select"
            :value="effectiveMapping['mixer']"
            @change="updateFnSwitch('mixer', ($event.target as HTMLSelectElement).value)">
            <option value="" disabled>-- 선택 --</option>
            <option v-for="sw in AVAILABLE_SWITCH_CODES" :key="sw" :value="sw">{{ sw }}</option>
          </select>
          <span v-else class="switch-hint">{{ effectiveMapping['mixer'] }}</span>
        </div>
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
        <div class="zone-header-row">
          <span class="setting-name fixed">액비모터</span>
          <select v-if="editableMapping" class="switch-select"
            :value="effectiveMapping['fertilizer_motor']"
            @change="updateFnSwitch('fertilizer_motor', ($event.target as HTMLSelectElement).value)">
            <option value="" disabled>-- 선택 --</option>
            <option v-for="sw in AVAILABLE_SWITCH_CODES" :key="sw" :value="sw">{{ sw }}</option>
          </select>
          <span v-else class="switch-hint">{{ effectiveMapping['fertilizer_motor'] }}</span>
        </div>
        <div class="setting-fields">
          <template v-if="form.fertilizer.enabled">
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
          </template>
          <button
            class="toggle-btn"
            :class="{ active: form.fertilizer.enabled }"
            @click="form.fertilizer.enabled = !form.fertilizer.enabled"
          >{{ form.fertilizer.enabled ? 'ON' : 'OFF' }}</button>
        </div>
        <!-- 액비 시간 초과 경고 -->
        <div v-if="fertilizerWarnings.length > 0" class="fertilizer-warning">
          <p v-for="(warn, i) in fertilizerWarnings" :key="i">{{ warn }}</p>
        </div>
      </div>
    </div>

    <!-- 3. 채널 매핑 (admin/farm_admin + editableMapping 시에만 표시) -->
    <div v-if="editableMapping" class="section">
      <label class="section-label">원격제어 구역 설정</label>
      <p class="mapping-desc">각 기능에 연결된 물리 스위치 구역을 설정합니다.</p>

      <div class="mapping-row">
        <span class="mapping-label">원격제어 ON/OFF</span>
        <select class="switch-select-full"
          :value="effectiveMapping['remote_control']"
          @change="updateFnSwitch('remote_control', ($event.target as HTMLSelectElement).value)">
          <option value="" disabled>-- 선택 --</option>
          <option v-for="sw in AVAILABLE_SWITCH_CODES" :key="sw" :value="sw">{{ sw }}</option>
        </select>
      </div>

      <div class="mapping-row">
        <span class="mapping-label">액비/교반기 B접점</span>
        <select class="switch-select-full"
          :value="effectiveMapping['fertilizer_b_contact']"
          @change="updateFnSwitch('fertilizer_b_contact', ($event.target as HTMLSelectElement).value)">
          <option value="" disabled>-- 선택 --</option>
          <option v-for="sw in AVAILABLE_SWITCH_CODES" :key="sw" :value="sw">{{ sw }}</option>
        </select>
      </div>
    </div>

    <!-- 4. 반복 설정 -->
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
import { reactive, watch, ref, nextTick, computed } from 'vue'
import type { ChannelMapping } from '../../types/device.types'
import { DEFAULT_CHANNEL_MAPPING, FUNCTION_LABELS, getAvailableSwitchCodesByCount, detectChannelCount } from '../../types/device.types'

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
  zones: IrrigationZone[]
  mixer: { enabled: boolean }
  fertilizer: { enabled: boolean; duration: number; preStopWait: number }
  schedule: { days: number[]; repeat: boolean }
}

const props = defineProps<{
  modelValue: IrrigationFormData
  channelMapping?: ChannelMapping
  editableMapping?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: IrrigationFormData]
  'update:channelMapping': [mapping: ChannelMapping]
}>()

const effectiveMapping = computed(() => props.channelMapping ?? DEFAULT_CHANNEL_MAPPING)

const AVAILABLE_SWITCH_CODES = computed(() => {
  const values = Object.values(effectiveMapping.value).filter((v): v is string => !!v)
  const count = detectChannelCount(values)
  return getAvailableSwitchCodesByCount(count)
})

// 액비모터 ON 시: 각 활성 구역의 관주시간 ≥ 투여시간 + 종료전대기
const fertilizerWarnings = computed(() => {
  if (!form.fertilizer.enabled) return []
  const fertTotal = (form.fertilizer.duration || 0) + (form.fertilizer.preStopWait || 0)
  if (fertTotal <= 0) return []
  const warnings: string[] = []
  for (const zone of form.zones) {
    if (!zone.enabled) continue
    if ((zone.duration || 0) < fertTotal) {
      const name = zone.name || zone.zone + '구역'
      warnings.push(
        `${name}의 관주시간(${zone.duration}분)이 너무 짧습니다. 액비 투여(${form.fertilizer.duration}분) + 종료전 대기(${form.fertilizer.preStopWait}분) = 최소 ${fertTotal}분 이상이어야 합니다.`
      )
    }
  }
  return warnings
})

const mappingRecord = computed(() => effectiveMapping.value as unknown as Record<string, string>)
const labelsRecord = FUNCTION_LABELS as unknown as Record<string, string>

function getZoneLabel(zoneNum: number): string {
  return labelsRecord[`zone_${zoneNum}`] || `${zoneNum}구역`
}
function getZoneSwitch(zoneNum: number): string {
  return mappingRecord.value[`zone_${zoneNum}`] || ''
}

// switch 코드 변경 시 기존 보유자를 빈 값으로 밀어냄
function applySwitch(targetKey: string, switchCode: string) {
  const next = { ...mappingRecord.value }
  // 동일한 switch 코드를 갖고 있던 다른 키를 초기화
  for (const k of Object.keys(next)) {
    if (k !== targetKey && next[k] === switchCode) {
      next[k] = ''
    }
  }
  next[targetKey] = switchCode
  emit('update:channelMapping', next as unknown as ChannelMapping)
}

function updateZoneSwitch(zoneNum: number, switchCode: string) {
  applySwitch(`zone_${zoneNum}`, switchCode)
}

function updateFnSwitch(fnKey: string, switchCode: string) {
  applySwitch(fnKey, switchCode)
}

const DAYS = [
  { value: 1, label: '월' }, { value: 2, label: '화' },
  { value: 3, label: '수' }, { value: 4, label: '목' },
  { value: 5, label: '금' }, { value: 6, label: '토' },
  { value: 0, label: '일' },
]

const raw = JSON.parse(JSON.stringify(props.modelValue))
// 기존 룰 호환: fertilizer.enabled 기본값 (duration > 0이면 enabled)
if (raw.fertilizer && raw.fertilizer.enabled === undefined) {
  raw.fertilizer.enabled = raw.fertilizer.duration > 0
}
const form = reactive<IrrigationFormData>(raw)

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
let ignoreFormWatch = false
watch(() => props.modelValue, (val) => {
  const next = JSON.parse(JSON.stringify(val))
  if (JSON.stringify(next) === JSON.stringify(form)) return
  ignoreFormWatch = true
  Object.assign(form, next)
  nextTick(() => { ignoreFormWatch = false })
}, { deep: true })

watch(form, () => {
  if (ignoreFormWatch) return
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

.step-title { font-size: var(--font-size-subtitle); font-weight: 700; color: var(--text-primary); margin: 0; }
.step-desc { font-size: var(--font-size-label); color: var(--text-muted); margin: 0; }

.section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.section-label {
  font-size: var(--font-size-label);
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
  font-size: var(--font-size-subtitle);
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
  font-size: var(--font-size-label);
  font-weight: 600;
  color: var(--text-secondary);
  white-space: nowrap;
}

.zone-name-wrap {
  min-width: 90px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.name-hint-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
}

/* 구역명 + 채널 선택을 한 행에 배치 */
.zone-header-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  flex-wrap: nowrap;
}

.switch-hint {
  font-size: var(--font-size-caption);
  color: var(--text-muted);
  background: var(--bg-input);
  border: 1px solid var(--border-light);
  border-radius: 6px;
  padding: 3px 8px;
  font-family: monospace;
  white-space: nowrap;
  flex-shrink: 0;
}

.switch-select {
  font-size: var(--font-size-caption);
  padding: 5px 8px;
  border: 1px solid var(--border-input);
  border-radius: 8px;
  background: var(--bg-input);
  color: var(--text-primary);
  cursor: pointer;
  min-width: 110px;
  flex-shrink: 0;
}

/* 채널 매핑 섹션 */
.mapping-desc {
  font-size: var(--font-size-caption);
  color: var(--text-muted);
  margin: 0 0 8px 0;
}

.mapping-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: var(--bg-secondary);
  border-radius: 8px;
  gap: 12px;
}

.mapping-label {
  font-size: var(--font-size-label);
  font-weight: 500;
  color: var(--text-secondary);
  white-space: nowrap;
}

.switch-select-full {
  font-size: var(--font-size-caption);
  padding: 6px 10px;
  border: 1px solid var(--border-input);
  border-radius: 8px;
  background: var(--bg-input);
  color: var(--text-primary);
  cursor: pointer;
  min-width: 120px;
}

.zone-name-input {
  width: 90px;
  padding: 6px 10px;
  border: 1px solid var(--border-input);
  border-radius: 6px;
  font-size: var(--font-size-label);
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
  font-size: var(--font-size-label);
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
  font-size: var(--font-size-label);
  text-align: center;
  color: var(--text-primary);
  background: var(--bg-input);
}

.unit {
  font-size: var(--font-size-label);
  color: var(--text-muted);
}

.toggle-btn {
  padding: 4px 12px;
  border: 2px solid var(--border-input);
  border-radius: 6px;
  background: var(--bg-card);
  font-size: var(--font-size-caption);
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
  font-size: var(--font-size-label);
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
  font-size: var(--font-size-label);
  color: var(--text-secondary);
  cursor: pointer;
}

.repeat-toggle input {
  width: 18px;
  height: 18px;
  cursor: pointer;
}
.fertilizer-warning {
  margin-top: 8px;
  padding: 8px 12px;
  background: #fef3c7;
  border: 1px solid #f59e0b;
  border-radius: 6px;
  font-size: var(--font-size-sm, 12px);
  color: #92400e;
  line-height: 1.5;
}
.fertilizer-warning p {
  margin: 2px 0;
}
:root[data-theme='dark'] .fertilizer-warning {
  background: #451a03;
  border-color: #b45309;
  color: #fbbf24;
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
  font-size: var(--font-size-body);
  font-weight: 600;
  color: var(--text-primary, #333);
}

.tp-cancel,
.tp-confirm {
  background: none;
  border: none;
  font-size: var(--font-size-label);
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
  font-size: var(--font-size-title);
  font-weight: 600;
  color: var(--text-primary, #333);
  user-select: none;
}

.tp-colon {
  font-size: var(--font-size-title);
  font-weight: 700;
  color: var(--text-primary, #333);
  padding: 0 4px;
  position: relative;
  z-index: 1;
}
</style>
