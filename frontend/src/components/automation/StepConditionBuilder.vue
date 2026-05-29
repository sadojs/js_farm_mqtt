<template>
  <div class="step-condition">
    <h3 class="step-title">작동 조건</h3>
    <p class="step-desc">{{ timeOnly ? '시간 설정 조건을 설정하세요.' : '측정 데이터 조건을 설정하세요.' }} 조건에 맞으면 장치가 동작합니다.</p>

    <div class="condition-groups">
      <div
        v-for="(group, gi) in modelValue.groups"
        :key="gi"
        class="condition-group"
      >
        <!-- 그룹 헤더 -->
        <div v-if="gi > 0" class="group-logic">
          <select
            :value="modelValue.logic"
            @change="updateGroupLogic(($event.target as HTMLSelectElement).value as 'AND' | 'OR')"
            class="logic-select"
          >
            <option value="AND">모두 맞을 때</option>
            <option value="OR">하나만 맞아도</option>
          </select>
        </div>

        <div class="group-box">
          <div
            v-for="(cond, ci) in group.conditions"
            :key="ci"
            class="condition-row"
          >
            <!-- 조건 간 로직 -->
            <div v-if="ci > 0" class="row-logic">
              <select
                :value="group.logic"
                @change="updateSetLogic(gi, ($event.target as HTMLSelectElement).value as 'AND' | 'OR')"
                class="logic-select small"
              >
                <option value="AND">AND</option>
                <option value="OR">OR</option>
              </select>
            </div>

            <div class="row-fields" :class="{ 'row-fields-time': cond.type === 'time' || cond.field === 'time' || cond.field === 'hour' }">
              <!-- 특정 센서 디바이스 선택 (왼쪽) — 시간 조건이 아니고 센서 조건일 때만 -->
              <select
                v-if="!timeOnly && isSensorCondition(cond) && sensorDevices.length > 0"
                :value="cond.sensor_device_id || ''"
                @change="changeSensorDevice(gi, ci, ($event.target as HTMLSelectElement).value)"
                class="device-select"
                title="특정 센서 장치 선택 (선택 안하면 그룹 평균 사용)"
              >
                <option value="">그룹 평균</option>
                <option v-for="d in sensorDevices" :key="d.id" :value="d.id">{{ d.name }}</option>
              </select>

              <!-- 필드(센서값) 선택 (오른쪽) — 시간 단일 옵션일 때는 라벨로 표시 -->
              <span
                v-if="(cond.type === 'time' || cond.field === 'time' || cond.field === 'hour') && availableFields.length <= 1"
                class="field-label-static"
              >🕐 시간</span>
              <select
                v-else
                :value="cond.field"
                @change="changeField(gi, ci, ($event.target as HTMLSelectElement).value)"
                class="field-select"
              >
                <option v-for="f in fieldsForCondition(cond)" :key="f.value" :value="f.value">
                  {{ f.displayLabel }}
                </option>
              </select>

              <!-- 히스테리시스 UI (FR-02): fan + temperature/humidity 관련 역할 -->
              <template v-if="isFanHysteresis(cond)">
                <div class="hysteresis-row">
                  <label>기준값</label>
                  <input
                    type="number"
                    :value="cond.value"
                    @input="changeValue(gi, ci, Number(($event.target as HTMLInputElement).value))"
                    class="value-input small"
                  />
                  <span class="unit">{{ getUnit(cond.field) }}</span>
                  <label>허용 범위</label>
                  <input
                    type="number"
                    :value="cond.deviation || 0"
                    min="0"
                    @input="changeDeviation(gi, ci, Number(($event.target as HTMLInputElement).value))"
                    class="value-input small"
                  />
                  <span class="unit">{{ getUnit(cond.field) }}</span>
                </div>
                <div v-if="cond.deviation" class="hysteresis-preview">
                  ON: {{ Number(cond.value) + Number(cond.deviation) }}{{ getUnit(cond.field) }} 이상 /
                  OFF: {{ Number(cond.value) - Number(cond.deviation) }}{{ getUnit(cond.field) }} 이하
                </div>
              </template>

              <!-- 일반 조건 -->
              <template v-else>
                <!-- 연산자 선택 -->
                <select
                  :value="cond.operator"
                  @change="changeOperator(gi, ci, ($event.target as HTMLSelectElement).value)"
                  class="op-select"
                >
                  <option v-for="op in getOperators(cond.field)" :key="op" :value="op">
                    {{ OPERATOR_LABELS_KR[op] || op }}
                  </option>
                </select>

                <!-- 값 입력 -->
                <template v-if="cond.field === 'rainfall'">
                  <select
                    :value="cond.value ? 'true' : 'false'"
                    @change="changeValue(gi, ci, ($event.target as HTMLSelectElement).value === 'true')"
                    class="value-input"
                  >
                    <option value="true">예 (비 감지)</option>
                    <option value="false">아니오</option>
                  </select>
                </template>
                <template v-else-if="(cond.field === 'hour' || cond.field === 'time') && cond.operator === 'between'">
                  <input
                    type="time"
                    :value="hhmmFromCondValue(cond, 0)"
                    @input="changeTimeRangeHHMM(gi, ci, 0, ($event.target as HTMLInputElement).value)"
                    class="value-input time-input"
                  />
                  <span class="range-sep">~</span>
                  <input
                    type="time"
                    :value="hhmmFromCondValue(cond, 1)"
                    @input="changeTimeRangeHHMM(gi, ci, 1, ($event.target as HTMLInputElement).value)"
                    class="value-input time-input"
                  />
                </template>
                <template v-else-if="cond.field === 'hour' || cond.field === 'time'">
                  <input
                    type="time"
                    :value="hhmmFromCondValue(cond)"
                    @input="changeValueHHMM(gi, ci, ($event.target as HTMLInputElement).value)"
                    class="value-input time-input"
                  />
                </template>
                <template v-else>
                  <input
                    type="number"
                    :value="cond.value"
                    @input="changeValue(gi, ci, Number(($event.target as HTMLInputElement).value))"
                    class="value-input"
                  />
                  <span v-if="getUnit(cond.field)" class="unit">{{ getUnit(cond.field) }}</span>
                </template>
              </template>

              <!-- 삭제 -->
              <button
                v-if="group.conditions.length > 1"
                class="btn-remove"
                @click="removeCondition(gi, ci)"
              >✕</button>
            </div>

            <!-- 릴레이 동작대기 옵션 (FR-04): fan인 경우 -->
            <div v-if="isFan" class="relay-option">
              <label class="relay-toggle">
                <input type="checkbox" :checked="cond.relay" @change="toggleRelay(gi, ci)" />
                동작대기 ({{ cond.relayOnMinutes || 50 }}분 ON / {{ cond.relayOffMinutes || 10 }}분 OFF 반복)
              </label>
            </div>
          </div>

          <!-- 조건 추가 -->
          <button class="btn-add-condition" @click="addCondition(gi)">+ 조건 추가</button>
        </div>
      </div>
    </div>

    <!-- 시간대 스케줄러 (선택): timeOnly + fan에서만 사용 가능, 사용자가 명시적으로 활성화한 경우에만 노출 -->
    <!-- 단일 시간 조건일 때도 요일 선택 표시 (사용자 요청 — 수정 페이지 요일 누락 fix) -->
    <div v-if="hasTimeCondition && !useMultiTimeSlots" class="day-selector-single">
      <label class="day-selector-label">📅 요일 선택</label>
      <div class="day-selector">
        <button
          v-for="d in DAYS"
          :key="d.value"
          class="day-btn"
          :class="{ active: selectedDays.includes(d.value) }"
          @click="toggleDay(d.value)"
        >{{ d.label }}</button>
      </div>
      <label class="repeat-toggle">
        <input type="checkbox" v-model="repeatWeekly" />
        매주 반복
      </label>
    </div>

    <div v-if="timeOnly && isFan && useMultiTimeSlots" class="time-scheduler">
      <div class="scheduler-header">
        <h4 class="scheduler-title">시간대 일정 (다중 구간)</h4>
        <button class="btn-remove-section" @click="disableMultiTimeSlots" title="시간대 일정 비활성화">✕ 닫기</button>
      </div>
      <p class="scheduler-hint">기본 시간 조건 외에 여러 구간을 추가로 적용하고 싶을 때 사용하세요.</p>
      <div v-for="(slot, i) in timeSlots" :key="i" class="time-slot">
        <input
          type="time"
          :value="minutesToHHMMLocal(slot.start)"
          @input="slot.start = hhmmToMinutesLocal(($event.target as HTMLInputElement).value)"
          class="value-input time-input"
        />
        <span class="range-sep">~</span>
        <input
          type="time"
          :value="minutesToHHMMLocal(slot.end)"
          @input="slot.end = hhmmToMinutesLocal(($event.target as HTMLInputElement).value)"
          class="value-input time-input"
        />
        <button class="btn-remove" @click="removeTimeSlot(i)" title="이 시간대 삭제">✕</button>
      </div>
      <button class="btn-add-condition" @click="addTimeSlot">+ 시간대 추가</button>

      <div class="day-selector">
        <button
          v-for="d in DAYS"
          :key="d.value"
          class="day-btn"
          :class="{ active: selectedDays.includes(d.value) }"
          @click="toggleDay(d.value)"
        >
          {{ d.label }}
        </button>
      </div>

      <label class="repeat-toggle">
        <input type="checkbox" v-model="repeatWeekly" />
        매주 반복
      </label>
    </div>

    <!-- 시간대 일정 opt-in 버튼 (timeOnly + fan + 비활성 상태) -->
    <button
      v-if="timeOnly && isFan && !useMultiTimeSlots"
      class="btn-add-scheduler"
      @click="enableMultiTimeSlots"
    >
      + 시간대 일정 추가 (선택)
    </button>

    <!-- 그룹 추가 -->
    <button class="btn-add-group" @click="addGroup">+ 조건 그룹 추가</button>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import type { ConditionGroup, Condition } from '../../types/automation.types'
import {
  SENSOR_CONDITION_FIELDS,
  OPERATOR_LABELS_KR,
  FIELD_UNITS,
  ENV_ROLE_FIELD_CONFIG,
  createEmptyCondition,
  createEmptyConditionSet,
} from '../../utils/automation-helpers'
import { envConfigApi } from '../../api/env-config.api'
import type { EnvRole, ResolvedValue } from '../../api/env-config.api'
import { deviceApi } from '../../api/device.api'
import type { Device } from '../../types/device.types'

const DAYS = [
  { value: 1, label: '월' }, { value: 2, label: '화' },
  { value: 3, label: '수' }, { value: 4, label: '목' },
  { value: 5, label: '금' }, { value: 6, label: '토' },
  { value: 7, label: '일' },
]

// 온도/습도 관련 역할 (히스테리시스 대상)
const TEMP_HUMIDITY_ROLES = ['internal_temp', 'external_temp', 'internal_humidity', 'external_humidity', 'temperature', 'humidity']

const props = defineProps<{
  modelValue: ConditionGroup
  timeOnly?: boolean
  equipmentType?: string
  groupId?: string
}>()
const emit = defineEmits<{
  'update:modelValue': [value: ConditionGroup]
  'update:canProceed': [value: boolean]
}>()

const isFan = computed(() => props.equipmentType === 'fan')

// 시간 조건이 하나라도 존재하면 요일 선택 UI 표시 (단일 시간대 모드)
const hasTimeCondition = computed(() => {
  const groups = (props.modelValue as any)?.groups || []
  for (const g of groups) {
    for (const c of (g.conditions || [])) {
      if (c.type === 'time' || c.field === 'time' || c.field === 'hour') return true
    }
  }
  return false
})

// env roles 및 resolved values
const envRoles = ref<EnvRole[]>([])
const resolvedValues = ref<Record<string, ResolvedValue>>({})

const sensorDevices = ref<Device[]>([])

async function loadEnvData() {
  if (!props.groupId) return
  try {
    const [rolesRes, resolvedRes] = await Promise.all([
      envConfigApi.getRoles(),
      envConfigApi.getResolved(props.groupId),
    ])
    envRoles.value = rolesRes.data
    resolvedValues.value = resolvedRes.data
  } catch {
    // fallback to empty
  }
}

async function loadSensorDevices() {
  try {
    const res = await deviceApi.getAll()
    sensorDevices.value = (res.data as Device[]).filter(d => d.deviceType === 'sensor')
  } catch {
    // ignore
  }
}

// 디바이스별 측정 채널 캐시: deviceId → [{field, lastValue, unit}]
const channelCache = ref<Map<string, { field: string; lastValue: number | null; unit: string }[]>>(new Map())

async function loadChannelsForDevice(deviceId: string | undefined | null) {
  if (!deviceId || channelCache.value.has(deviceId)) return
  try {
    const { data } = await deviceApi.getSensorChannels(deviceId)
    const next = new Map(channelCache.value)
    next.set(deviceId, data)
    channelCache.value = next
  } catch {
    // ignore
  }
}

function syncChannelCacheFromModel() {
  const ids = new Set<string>()
  for (const g of (props.modelValue?.groups || [])) {
    for (const c of (g.conditions || [])) {
      if ((c as any).sensor_device_id) ids.add((c as any).sensor_device_id)
    }
  }
  for (const id of ids) loadChannelsForDevice(id)
}

onMounted(() => {
  loadEnvData()
  loadSensorDevices()
  syncChannelCacheFromModel()
  // 편집 모드에서 기존 시간 조건의 timeSlots/일정 정보 복원
  hydrateTimeSchedulerFromModel()
})
watch(() => props.groupId, loadEnvData)
watch(() => props.modelValue, () => {
  hydrateTimeSchedulerFromModel()
  syncChannelCacheFromModel()
}, { deep: false })

function hydrateTimeSchedulerFromModel() {
  // 시간 조건의 field 마이그레이션: 'hour' → 'time' (분 단위로 정규화)
  const next = clone()
  let changed = false
  for (const group of next.groups) {
    for (const c of group.conditions) {
      if (c.field === 'hour') {
        c.field = 'time'
        c.type = 'time'
        // hour(0~23) 값을 분 단위로 변환
        if (Array.isArray(c.value)) {
          c.value = [
            (c.value[0] as number) < 24 ? (c.value[0] as number) * 60 : (c.value[0] as number),
            (c.value[1] as number) < 24 ? (c.value[1] as number) * 60 : (c.value[1] as number),
          ] as [number, number]
        } else if (typeof c.value === 'number' && c.value < 24) {
          c.value = c.value * 60
        }
        changed = true
      }
    }
  }
  if (changed) emit('update:modelValue', next)

  if (!props.timeOnly || !isFan.value) return
  const first = props.modelValue?.groups?.[0]?.conditions?.[0]
  if (!first) return
  // 룰에 실제로 timeSlots가 저장된 경우에만 다중 시간대 일정을 활성화
  if (Array.isArray((first as any).timeSlots) && (first as any).timeSlots.length > 0) {
    useMultiTimeSlots.value = true
    timeSlots.value = (first as any).timeSlots.map((s: any) => ({
      start: Number(s.start) < 24 ? Number(s.start) * 60 : Number(s.start),
      end: Number(s.end) < 24 ? Number(s.end) * 60 : Number(s.end),
    }))
    if (Array.isArray((first as any).daysOfWeek) && (first as any).daysOfWeek.length > 0) {
      selectedDays.value = [...(first as any).daysOfWeek]
    }
    if (typeof (first as any).repeat === 'boolean') {
      repeatWeekly.value = (first as any).repeat
    }
  } else {
    // 룰에 없으면 다중 시간대 일정을 비활성 상태로 유지 (기본 9-17 주입 방지)
    useMultiTimeSlots.value = false
    timeSlots.value = []
  }
}

function changeSensorDevice(gi: number, ci: number, deviceId: string) {
  const next = clone()
  next.groups[gi].conditions[ci].sensor_device_id = deviceId || null
  emit('update:modelValue', next)
  if (deviceId) loadChannelsForDevice(deviceId)
}

// 채널 필드 한국어 라벨 폴백 (env-roles에 등록되지 않은 경우)
const FIELD_KR_LABEL: Record<string, string> = {
  temperature: '온도',
  humidity: '습도',
  pressure: '기압',
  co2: 'CO2',
  soil_moisture: '토양수분',
  soil_temperature: '토양온도',
  illuminance_lux: '조도',
  ec: 'EC',
  ph: 'pH',
  battery: '배터리',
  linkquality: '신호품질',
  wind_speed: '풍속',
  rainfall: '강우',
}

// 특정 condition의 sensor_device_id에 맞춘 field 옵션 목록 (없으면 envRoleFields)
function fieldsForCondition(cond: any): any[] {
  const did = cond?.sensor_device_id
  if (!did) return availableFields.value
  const channels = channelCache.value.get(did)
  if (!channels || channels.length === 0) return availableFields.value
  // 디바이스가 실제 발행하는 채널만 노출, 라벨에 최근 값 부착
  return channels.map(ch => {
    const role = envRoleFields.value.find(r => r.value === ch.field)
    const baseLabel = role?.label ?? FIELD_KR_LABEL[ch.field] ?? ch.field
    const valStr = ch.lastValue == null ? '값 없음' : `${ch.lastValue}${ch.unit}`
    return {
      value: ch.field,
      label: baseLabel,
      displayLabel: `${baseLabel} (${valStr})`,
      type: 'sensor' as const,
      operators: role?.operators ?? ['gte', 'lte', 'gt', 'lt', 'eq', 'between'],
      unit: ch.unit || role?.unit || '',
      defaultValue: role?.defaultValue ?? 0,
      icon: role?.icon ?? '📊',
    }
  })
}

function isSensorCondition(cond: Condition): boolean {
  return cond.type === 'sensor' || (cond.type !== 'time' && cond.field !== 'hour' && cond.field !== 'once_at' && cond.field !== 'rainfall')
}

function isFanHysteresis(cond: Condition): boolean {
  // 환풍기뿐 아니라 개폐기(opener_open)도 동일한 base+편차 hysteresis UI 사용
  const supportsHysteresis = isFan.value || props.equipmentType === 'opener_open'
  return supportsHysteresis && TEMP_HUMIDITY_ROLES.includes(cond.field)
}

// canProceed: 항상 true (모든 env role은 유효)
watch(() => props.modelValue, () => {
  emit('update:canProceed', true)
}, { deep: true, immediate: true })

// 시간대 스케줄러 state — minutes-from-midnight 단위 (예: 540=09:00, 1020=17:00)
// useMultiTimeSlots: 사용자가 명시적으로 다중 시간대 일정을 활성화한 경우에만 true.
//                    false인 동안은 기본 9-17 슬롯이 룰에 주입되지 않도록 watch 가드.
const useMultiTimeSlots = ref(false)
const timeSlots = ref<{ start: number; end: number }[]>([])
const selectedDays = ref<number[]>([1, 2, 3, 4, 5])
const repeatWeekly = ref(true)

function enableMultiTimeSlots() {
  useMultiTimeSlots.value = true
  if (timeSlots.value.length === 0) {
    timeSlots.value.push({ start: 9 * 60, end: 17 * 60 })
  }
}

function disableMultiTimeSlots() {
  useMultiTimeSlots.value = false
  timeSlots.value = []
  // 룰에서 timeSlots/daysOfWeek/repeat 필드 제거
  const next = clone()
  const first = next.groups?.[0]?.conditions?.[0] as any
  if (first) {
    delete first.timeSlots
    delete first.daysOfWeek
    delete first.repeat
  }
  emit('update:modelValue', next)
}

function addTimeSlot() {
  timeSlots.value.push({ start: 9 * 60, end: 17 * 60 })
}

function removeTimeSlot(i: number) {
  timeSlots.value.splice(i, 1)
  // 마지막 슬롯 제거 시 자동으로 다중 시간대 비활성화
  if (timeSlots.value.length === 0) {
    disableMultiTimeSlots()
  }
}

// ── 시:분 변환 헬퍼 ──────────────────────────────────────────────
function minutesToHHMMLocal(mins: number): string {
  // 0~23: legacy hour 단위 → 시 단위로 표시 (예: 9 → "09:00")
  // 24+: minutes 단위
  if (mins >= 0 && mins < 24) return `${String(mins).padStart(2, '0')}:00`
  const m = Math.max(0, Math.min(1439, Math.round(mins)))
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}
function hhmmToMinutesLocal(hhmm: string): number {
  if (!hhmm || !hhmm.includes(':')) return 0
  const [h, m] = hhmm.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}
// 조건의 시간 값을 HH:MM 문자열로 변환 (between 배열 또는 단일)
function hhmmFromCondValue(cond: Condition, idx?: number): string {
  const raw = idx != null && Array.isArray(cond.value) ? cond.value[idx] : (cond.value as number)
  return minutesToHHMMLocal(Number(raw) || 0)
}
function toggleDay(day: number) {
  const idx = selectedDays.value.indexOf(day)
  if (idx >= 0) selectedDays.value.splice(idx, 1)
  else selectedDays.value.push(day)
}

// 시간대 스케줄러가 변경되면 조건에 반영 — 사용자가 명시적으로 활성화한 경우에만
watch([timeSlots, selectedDays, repeatWeekly, useMultiTimeSlots], () => {
  // 다중 시간대 (환풍기 + multi-slots) 케이스
  if (props.timeOnly && isFan.value && useMultiTimeSlots.value) {
    const next = clone()
    if (next.groups[0]?.conditions[0]) {
      next.groups[0].conditions[0].timeSlots = JSON.parse(JSON.stringify(timeSlots.value))
      next.groups[0].conditions[0].daysOfWeek = [...selectedDays.value]
      next.groups[0].conditions[0].repeat = repeatWeekly.value
    }
    emit('update:modelValue', next)
    return
  }
  // 단일 시간대 케이스: 시간 조건이 있으면 daysOfWeek/repeat만 반영 (사용자 요청)
  if (!useMultiTimeSlots.value && hasTimeCondition.value) {
    const next = clone()
    for (const g of (next.groups || [])) {
      for (const c of (g.conditions || [])) {
        if (c.type === 'time' || c.field === 'time' || c.field === 'hour') {
          ;(c as any).daysOfWeek = [...selectedDays.value]
          ;(c as any).repeat = repeatWeekly.value
        }
      }
    }
    emit('update:modelValue', next)
  }
}, { deep: true })

const TIME_ONLY_FIELDS = SENSOR_CONDITION_FIELDS.filter(f => f.type === 'time')

// env role 기반 필드 목록 생성
const envRoleFields = computed(() => {
  if (envRoles.value.length === 0) {
    // fallback: 기존 SENSOR_CONDITION_FIELDS (시간 + 센서 모두 노출)
    return SENSOR_CONDITION_FIELDS.map(f => ({
      ...f,
      displayLabel: f.label,
    }))
  }

  const fields: {
    value: string; label: string; displayLabel: string;
    type: 'sensor' | 'time'; operators: string[];
    unit: string; defaultValue: number; icon: string;
  }[] = envRoles.value.map(role => {
    const config = ENV_ROLE_FIELD_CONFIG[role.roleKey]
    const resolved = resolvedValues.value[role.roleKey]
    const valueStr = resolved?.value != null
      ? `${resolved.value}${role.unit}`
      : '미설정'
    return {
      value: role.roleKey,
      label: role.label,
      displayLabel: `${role.label}(${valueStr})`,
      type: 'sensor' as const,
      operators: config?.operators || ['gte', 'lte', 'gt', 'lt', 'eq', 'between'],
      unit: role.unit,
      defaultValue: config?.defaultValue ?? 0,
      icon: config?.icon || '📊',
    }
  })

  // 시간 필드를 항상 포함 (위저드에서 Step 2가 통합되어 조건 단계에서 직접 선택)
  fields.push({
    value: 'time',
    label: '시간',
    displayLabel: '시간',
    type: 'time',
    operators: ['between', 'eq'],
    unit: '',
    defaultValue: 9 * 60,
    icon: '🕐',
  })

  return fields
})

const availableFields = computed(() => {
  if (props.timeOnly) return TIME_ONLY_FIELDS.map(f => ({ ...f, displayLabel: f.label }))
  return envRoleFields.value
})

// timeOnly 모드로 전환 시, 기존 센서 조건을 시간 조건으로 변경
watch(() => props.timeOnly, (isTimeOnly) => {
  if (!isTimeOnly) return
  const next = clone()
  let changed = false
  for (const group of next.groups) {
    for (let i = 0; i < group.conditions.length; i++) {
      if (group.conditions[i].type !== 'time') {
        group.conditions[i] = { type: 'time', field: 'time', operator: 'eq', value: 9 * 60, unit: '' }
        changed = true
      }
    }
  }
  if (changed) emit('update:modelValue', next)
})

function clone(): ConditionGroup {
  return JSON.parse(JSON.stringify(props.modelValue))
}

function getOperators(field: string): string[] {
  const envField = envRoleFields.value.find(f => f.value === field)
  if (envField) return envField.operators
  const def = SENSOR_CONDITION_FIELDS.find(f => f.value === field)
  return def?.operators || ['eq']
}

function getUnit(field: string): string {
  const envField = envRoleFields.value.find(f => f.value === field)
  if (envField) return envField.unit
  return FIELD_UNITS[field] || ''
}

function updateGroupLogic(logic: 'AND' | 'OR') {
  const next = clone()
  next.logic = logic
  emit('update:modelValue', next)
}

function updateSetLogic(gi: number, logic: 'AND' | 'OR') {
  const next = clone()
  next.groups[gi].logic = logic
  emit('update:modelValue', next)
}

function changeField(gi: number, ci: number, field: string) {
  const next = clone()
  const def = envRoleFields.value.find(f => f.value === field)
    || SENSOR_CONDITION_FIELDS.find(f => f.value === field)
  next.groups[gi].conditions[ci] = {
    type: def?.type || 'sensor',
    field,
    operator: (def?.operators[0] as Condition['operator']) || 'gte',
    value: def?.defaultValue ?? 0,
    unit: def?.unit || '',
  }
  emit('update:modelValue', next)
}

function changeOperator(gi: number, ci: number, operator: string) {
  const next = clone()
  const cond = next.groups[gi].conditions[ci]
  cond.operator = operator as Condition['operator']
  const isTimeCond = cond.field === 'hour' || cond.field === 'time' || cond.type === 'time'
  if (operator === 'between' && !Array.isArray(cond.value)) {
    if (isTimeCond) {
      // 시간 조건은 시 단위(9시) 또는 분 단위(540분) 모두 호환
      const baseMins = Number(cond.value) || 0
      const startMins = baseMins < 24 ? baseMins * 60 : baseMins
      cond.value = [startMins, Math.min(1439, startMins + 60)]
    } else {
      cond.value = [Number(cond.value) || 0, (Number(cond.value) || 0) + 10]
    }
  } else if (operator !== 'between' && Array.isArray(cond.value)) {
    cond.value = cond.value[0]
  }
  emit('update:modelValue', next)
}

function changeValue(gi: number, ci: number, value: any) {
  const next = clone()
  next.groups[gi].conditions[ci].value = value
  emit('update:modelValue', next)
}

function changeDeviation(gi: number, ci: number, value: number) {
  const next = clone()
  next.groups[gi].conditions[ci].deviation = value
  emit('update:modelValue', next)
}

function toggleRelay(gi: number, ci: number) {
  const next = clone()
  const cond = next.groups[gi].conditions[ci]
  cond.relay = !cond.relay
  if (cond.relay) {
    cond.relayOnMinutes = cond.relayOnMinutes || 50
    cond.relayOffMinutes = cond.relayOffMinutes || 10
  }
  emit('update:modelValue', next)
}

// HH:MM 문자열 입력 → minutes 저장 (between 한쪽)
function changeTimeRangeHHMM(gi: number, ci: number, idx: number, hhmm: string) {
  const next = clone()
  const cond = next.groups[gi].conditions[ci]
  if (!Array.isArray(cond.value)) cond.value = [0, 1439]
  ;(cond.value as [number, number])[idx] = hhmmToMinutesLocal(hhmm)
  // 시간 조건은 'time' field + 분 단위로 통일
  cond.field = 'time'
  cond.type = 'time'
  emit('update:modelValue', next)
}

// HH:MM 문자열 입력 → minutes 저장 (단일 eq)
function changeValueHHMM(gi: number, ci: number, hhmm: string) {
  const next = clone()
  const cond = next.groups[gi].conditions[ci]
  cond.value = hhmmToMinutesLocal(hhmm)
  cond.field = 'time'
  cond.type = 'time'
  emit('update:modelValue', next)
}

function addCondition(gi: number) {
  const next = clone()
  if (props.timeOnly) {
    next.groups[gi].conditions.push({ type: 'time', field: 'time', operator: 'eq', value: 9 * 60, unit: '' })
  } else {
    // 첫 번째 env role을 기본값으로 사용
    const firstRole = envRoleFields.value[0]
    if (firstRole && firstRole.value !== 'hour') {
      next.groups[gi].conditions.push({
        type: 'sensor',
        field: firstRole.value,
        operator: (firstRole.operators[0] as Condition['operator']) || 'gte',
        value: firstRole.defaultValue ?? 0,
        unit: firstRole.unit,
      })
    } else {
      next.groups[gi].conditions.push(createEmptyCondition())
    }
  }
  emit('update:modelValue', next)
}

function removeCondition(gi: number, ci: number) {
  const next = clone()
  next.groups[gi].conditions.splice(ci, 1)
  if (next.groups[gi].conditions.length === 0) {
    next.groups.splice(gi, 1)
  }
  if (next.groups.length === 0) {
    next.groups.push(createEmptyConditionSet())
  }
  emit('update:modelValue', next)
}

function addGroup() {
  const next = clone()
  next.groups.push(createEmptyConditionSet())
  emit('update:modelValue', next)
}
</script>

<style scoped>
.step-condition { display: flex; flex-direction: column; gap: 16px; }
.step-title { font-size: 18px; font-weight: 700; color: var(--text-primary); margin: 0; }
.step-desc { font-size: 14px; color: var(--text-muted); margin: 0; }

.condition-groups { display: flex; flex-direction: column; gap: 12px; }

.group-logic {
  display: flex; justify-content: center; padding: 4px 0;
}

.logic-select {
  padding: 6px 12px; border: 1px solid var(--border-input); border-radius: 8px;
  font-size: 13px; color: var(--text-secondary); background: var(--bg-input); cursor: pointer;
}
.logic-select.small { padding: 4px 8px; font-size: 12px; }

.group-box {
  border: 1px solid var(--border-input); border-radius: 12px; padding: 16px;
  background: var(--bg-secondary); display: flex; flex-direction: column; gap: 10px;
}

.condition-row { display: flex; flex-direction: column; gap: 6px; }

.row-logic { display: flex; justify-content: center; }

.row-fields {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
}
/* 시간 조건 행: 좁은 모달에서도 여러 줄로 자연스럽게 wrap (이전엔 nowrap+overflow-x:auto로 텍스트가 잘렸음) */
.row-fields-time {
  flex-wrap: wrap;
  align-items: center;
  row-gap: 10px;
}

.field-label-static {
  font-size: 14px; font-weight: 600; color: var(--text-primary);
  padding: 8px 12px; background: var(--bg-input); border-radius: 8px;
  white-space: nowrap;
}

/* 모든 자식은 압축되지 않도록 — 잘림 방지 */
.field-select, .op-select, .value-input, .device-select {
  padding: 8px 12px; border: 1px solid var(--border-input); border-radius: 8px;
  font-size: 14px; background: var(--bg-input); color: var(--text-primary);
  flex-shrink: 0;
}
.field-select { min-width: 140px; }
.op-select { min-width: 80px; }
.device-select { min-width: 130px; font-size: 13px; border-style: dashed; }
.value-input { min-width: 80px; max-width: 120px; }
.value-input.small { min-width: 60px; max-width: 80px; }
/* type="time" 입력: 시계 아이콘 + AM/PM + HH:MM 모두 잘리지 않도록 충분한 폭 확보 */
.value-input.time-input {
  min-width: 130px;
  max-width: 150px;
  font-family: monospace;
  padding-right: 8px; /* 브라우저가 자동으로 시계 아이콘 위치 결정하므로 별도 padding 불필요 */
  font-variant-numeric: tabular-nums;
}

.range-sep { color: var(--text-muted); font-size: 14px; flex-shrink: 0; }
.unit { font-size: 13px; color: var(--text-muted); }

.btn-remove {
  background: none; border: none; color: #f44336; font-size: 16px;
  cursor: pointer; padding: 4px 8px; border-radius: 6px;
}
.btn-remove:hover { background: rgba(244, 67, 54, 0.1); }

.btn-add-condition {
  background: none; border: 1px dashed var(--border-input); border-radius: 8px;
  padding: 8px; font-size: 13px; color: var(--text-muted); cursor: pointer;
}
.btn-add-condition:hover { border-color: var(--text-muted); color: var(--text-secondary); }

.btn-add-group {
  background: none; border: 1px dashed var(--border-input); border-radius: 10px;
  padding: 10px; font-size: 14px; color: var(--text-muted); cursor: pointer;
}
.btn-add-group:hover { border-color: var(--text-muted); color: var(--text-secondary); }

/* 히스테리시스 */
.hysteresis-row {
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
}
.hysteresis-row label {
  font-size: 13px; font-weight: 600; color: var(--text-secondary);
}
.hysteresis-preview {
  width: 100%; font-size: 12px; color: var(--accent); background: var(--accent-bg);
  padding: 6px 10px; border-radius: 6px; margin-top: 4px;
}

/* 릴레이 옵션 */
.relay-option {
  padding: 8px 0;
}
.relay-toggle {
  display: flex; align-items: center; gap: 8px;
  font-size: 14px; color: var(--text-secondary); cursor: pointer;
}
.relay-toggle input { width: 18px; height: 18px; cursor: pointer; }

/* 시간대 스케줄러 */
.time-scheduler {
  border: 1px solid var(--border-input); border-radius: 12px; padding: 16px;
  background: var(--bg-secondary); display: flex; flex-direction: column; gap: 12px;
}
.scheduler-header { display: flex; justify-content: space-between; align-items: center; }
.scheduler-title { font-size: 15px; font-weight: 700; color: var(--text-primary); margin: 0; }
.scheduler-hint { font-size: 12px; color: var(--text-muted); margin: 0; line-height: 1.5; }
.btn-remove-section {
  background: none; border: none; color: var(--text-muted); cursor: pointer;
  font-size: 13px; padding: 4px 8px; border-radius: 6px;
}
.btn-remove-section:hover { background: var(--bg-hover); color: var(--text-primary); }

.btn-add-scheduler {
  display: block; width: 100%; padding: 10px 14px;
  background: none; border: 1.5px dashed var(--border-input); border-radius: 8px;
  color: var(--text-muted); font-size: 13px; cursor: pointer;
  transition: all 0.15s;
}
.btn-add-scheduler:hover { border-color: var(--accent); color: var(--accent); }

.time-slot {
  display: flex; align-items: center; gap: 8px;
}

.day-selector {
  display: flex; gap: 4px; flex-wrap: wrap;
}
.day-btn {
  padding: 6px 12px; border: 1px solid var(--border-input); border-radius: 8px;
  background: var(--bg-card); font-size: 13px; cursor: pointer;
  color: var(--text-primary); transition: all 0.15s;
}
.day-btn.active {
  background: var(--accent); color: white; border-color: var(--accent);
}

.repeat-toggle {
  display: flex; align-items: center; gap: 8px;
  font-size: 14px; color: var(--text-secondary); cursor: pointer;
}
.repeat-toggle input { width: 18px; height: 18px; cursor: pointer; }

/* 단일 시간 조건일 때의 요일 선택 컨테이너 (수정 페이지 누락 fix) */
.day-selector-single {
  margin-top: 12px;
  padding: 12px 14px;
  background: var(--bg-card, #fff);
  border: 1px solid var(--border-input, #e5e7eb);
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.day-selector-label {
  font-weight: 600;
  font-size: 14px;
  color: var(--text-primary, #1f2937);
}
</style>
