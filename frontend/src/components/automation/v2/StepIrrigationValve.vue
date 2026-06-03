<template>
  <div class="step-valve">
    <h3 class="step-title">관수 설정</h3>
    <p class="step-sub">각 구역의 관수 시간 / 쉬는 시간을 설정해주세요</p>

    <!-- 구역별 행: 수정 화면과 동일한 UX -->
    <div class="section-block">
      <label class="section-label">💧 구역별 설정</label>
      <div class="valve-list">
        <div
          v-for="valve in valves"
          :key="valve.zone"
          class="valve-row"
          :class="{ active: valve.enabled }"
        >
          <div class="zone-label">{{ valve.zone }}번 밸브</div>
          <!-- (zone-label 색상 fix: var(--text)로 명시적 지정 — 다크 테마/배경에서도 보이게) -->
          <div class="field">
            <label>관주 시간</label>
            <div class="num-unit">
              <input
                type="number" min="0" max="240"
                :value="valve.duration"
                @input="updateValve(valve.zone, 'duration', +($event.target as HTMLInputElement).value)"
              />
              <span>분</span>
            </div>
          </div>
          <div class="field">
            <label>쉬는 시간</label>
            <div class="num-unit">
              <input
                type="number" min="0" max="60"
                :value="valve.waitTime"
                @input="updateValve(valve.zone, 'waitTime', +($event.target as HTMLInputElement).value)"
              />
              <span>분</span>
            </div>
          </div>
          <button
            class="toggle-btn"
            :class="{ active: valve.enabled }"
            @click="updateValve(valve.zone, 'enabled', !valve.enabled)"
          >{{ valve.enabled ? 'ON' : 'OFF' }}</button>
        </div>
      </div>
    </div>

    <!-- 액비모터 (교반기는 액비모터에 종속되므로 액비 먼저 배치) -->
    <div class="section-block">
      <label class="section-label">🧪 액비모터</label>
      <div class="toggle-row">
        <span class="toggle-desc">관수 시 액비를 함께 투여합니다</span>
        <button
          class="toggle-btn"
          :class="{ active: useFertilizer }"
          @click="toggleFertilizer"
        >{{ useFertilizer ? 'ON' : 'OFF' }}</button>
      </div>

      <template v-if="useFertilizer">
        <div class="field-row">
          <label class="field-label">투여 시간</label>
          <div class="input-unit-row">
            <input type="number" min="1" max="60" class="num-input"
              :value="fertilizer.duration"
              @input="updateFert('duration', +($event.target as HTMLInputElement).value)" />
            <span class="unit-label">분</span>
          </div>
        </div>
        <div class="field-row">
          <label class="field-label">종료 전 대기</label>
          <div class="input-unit-row">
            <input type="number" min="0" max="30" class="num-input"
              :value="fertilizer.preStopWait"
              @input="updateFert('preStopWait', +($event.target as HTMLInputElement).value)" />
            <span class="unit-label">분</span>
          </div>
        </div>

        <div v-if="fertWarnings.length > 0" class="fert-warning">
          <p v-for="(w, i) in fertWarnings" :key="i">⚠️ {{ w }}</p>
        </div>
      </template>
    </div>

    <!-- 교반기 (액비모터 종속 — 액비 ON 시 자동 ON, 토글 비활성) -->
    <div class="section-block">
      <label class="section-label">🔄 교반기</label>
      <div class="toggle-row">
        <span class="toggle-desc">
          {{ useFertilizer
              ? '액비를 물에 잘 녹이기 위해 각 밸브 동작 시 자동 함께 작동합니다.'
              : '액비모터가 비활성화되어 교반기는 동작하지 않습니다.' }}
        </span>
        <button
          class="toggle-btn"
          :class="{ active: mixerEnabled, disabled: true }"
          :disabled="true"
          aria-label="교반기 상태 (액비모터에 의해 자동 결정)"
        >{{ mixerEnabled ? 'ON' : 'OFF' }}</button>
      </div>
    </div>

    <button class="btn-link-sm" @click="emit('go-back')">← 다른 관수 장치로 변경</button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { FertilizerConfig, IrrigationValve } from './types'

const props = defineProps<{
  controllerChannels: 8 | 12
  valves: IrrigationValve[]
  mixerEnabled: boolean
  useFertilizer: boolean
  fertilizer: FertilizerConfig
}>()

const emit = defineEmits<{
  'update:valves': [valves: IrrigationValve[]]
  'update:mixerEnabled': [v: boolean]
  'update:useFertilizer': [v: boolean]
  'update:fertilizer': [v: FertilizerConfig]
  'go-back': []
}>()

// 액비모터 토글 — 교반기와 항상 동기화 (사용자 요구: 액비 활성 시에만 각 밸브 ON 시간 동안 교반기 함께 ON)
function toggleFertilizer() {
  const next = !props.useFertilizer
  emit('update:useFertilizer', next)
  // 교반기를 액비 상태에 항상 동기화 — 별도 토글로 분리 불가
  emit('update:mixerEnabled', next)
}

// 채널 수 변경 시 valves 길이 보정 (props에서 받아온 그대로 사용 — IntentWizardModal에서 초기화)
const valves = computed<IrrigationValve[]>(() => props.valves || [])

function updateValve<K extends keyof IrrigationValve>(zone: number, key: K, val: IrrigationValve[K]) {
  const next = valves.value.map(v => v.zone === zone ? { ...v, [key]: val } : v)
  emit('update:valves', next)
}

function updateFert<K extends keyof FertilizerConfig>(key: K, val: FertilizerConfig[K]) {
  emit('update:fertilizer', { ...props.fertilizer, [key]: val })
}

// 액비 시간 vs 총 관주 시간 검증 경고
const fertWarnings = computed<string[]>(() => {
  if (!props.useFertilizer) return []
  const totalDuration = valves.value.filter(v => v.enabled).reduce((s, v) => s + v.duration, 0)
  const fertTotal = props.fertilizer.duration + props.fertilizer.preStopWait
  const warnings: string[] = []
  if (totalDuration > 0 && fertTotal > totalDuration) {
    warnings.push(`액비 투여시간(${props.fertilizer.duration}분) + 종료전 대기(${props.fertilizer.preStopWait}분) = ${fertTotal}분이 활성 구역 총 관수시간 ${totalDuration}분보다 깁니다.`)
  }
  return warnings
})
</script>

<style scoped>
.step-valve { display: flex; flex-direction: column; gap: 20px; }
.step-title { font-size: calc(18px * var(--content-scale, 1)); font-weight: 700; letter-spacing: -0.02em; margin: 0; }
.step-sub { color: var(--text-secondary, #666); margin: 0; font-size: 13px; }

.section-block {
  background: var(--card-bg, #fff); border: 1px solid var(--border-color, #e5e5e5);
  border-radius: 10px; padding: 16px; display: flex; flex-direction: column; gap: 12px;
}
.section-label { font-weight: 600; font-size: 14px; color: var(--text, #1f2937); }
.sub-hint { font-weight: normal; color: var(--text-secondary, #888); font-size: 12px; margin-left: 4px; }

/* 밸브 row */
.valve-list { display: flex; flex-direction: column; gap: 8px; }
.valve-row {
  display: grid;
  grid-template-columns: 80px 1fr 1fr 70px;
  gap: 12px;
  align-items: center;
  background: var(--bg-secondary, #f8f9fa);
  border: 1px solid var(--border-color, #e5e5e5);
  border-radius: 8px;
  padding: 10px 12px;
  transition: background 0.15s;
}
.valve-row.active { background: var(--card-bg, #fff); border-color: #4caf50; }
/* 명시적 색상 — 다크 배경/테마에서도 가독성 보장 */
.zone-label {
  font-weight: 700; font-size: 14px;
  color: var(--text, #1f2937);
  white-space: nowrap;
}
.valve-row .field { display: flex; flex-direction: column; gap: 4px; }
.valve-row .field label { font-size: 11px; color: var(--text-secondary, #888); }
.num-unit { display: flex; align-items: center; gap: 4px; }
.num-unit input {
  width: 60px; padding: 6px 8px;
  border: 1px solid var(--border-color, #ccc); border-radius: 6px; font-size: 13px;
}
.num-unit span { color: var(--text-secondary, #666); font-size: 12px; }

/* 토글 */
.toggle-row { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.toggle-desc { color: var(--text-secondary, #666); font-size: 13px; }
.toggle-btn {
  padding: 6px 16px; border-radius: 16px;
  border: 1px solid var(--border-color, #ccc);
  background: var(--card-bg, #fff); color: var(--text-secondary, #666);
  font-weight: 600; cursor: pointer; min-width: 60px;
  transition: all 0.15s;
}
.toggle-btn.active { background: #4caf50; color: #fff; border-color: #4caf50; }
.toggle-btn.disabled,
.toggle-btn:disabled {
  cursor: not-allowed; opacity: 0.7;
}
.toggle-btn.disabled:not(.active) { background: #e5e7eb; color: #9ca3af; border-color: #d1d5db; }

/* 액비 필드 */
.field-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.field-label { font-size: 13px; color: var(--text-secondary, #555); }
.input-unit-row { display: flex; align-items: center; gap: 4px; }
.input-unit-row .num-input {
  width: 70px; padding: 6px 8px;
  border: 1px solid var(--border-color, #ccc); border-radius: 6px; font-size: 13px;
}
.unit-label { color: var(--text-secondary, #666); font-size: 12px; }

.fert-warning {
  background: #fff3cd; border: 1px solid #ffeeba; border-radius: 6px;
  padding: 8px 12px; font-size: 12px; color: #856404;
}
.fert-warning p { margin: 0; }

.btn-link-sm {
  background: none; border: none; color: #4caf50;
  text-decoration: underline; cursor: pointer; font-size: 13px;
  padding: 4px 0; align-self: flex-start;
}

@media (max-width: 600px) {
  .valve-row { grid-template-columns: 1fr 1fr 1fr 60px; gap: 8px; }
  .zone-label { grid-column: 1 / -1; }
}
</style>
