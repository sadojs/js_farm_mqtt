<template>
  <div class="step-valve">
    <h3 class="step-title">관수 설정</h3>
    <p class="step-sub">구역과 시간, 액비를 설정해주세요</p>

    <!-- 구역 선택 -->
    <div class="section-block">
      <label class="section-label">💧 구역 선택 <span class="sub-hint">여러 개 선택 가능</span></label>
      <div class="valve-grid" role="group" aria-label="구역 선택">
        <label
          v-for="zone in zoneCount"
          :key="zone"
          class="valve-card"
          :class="{ selected: selectedZones.includes(zone) }"
          :aria-label="`${zone}구역`"
        >
          <input
            type="checkbox"
            :value="zone"
            :checked="selectedZones.includes(zone)"
            class="sr-only"
            @change="toggleZone(zone)"
          />
          <span class="valve-num">{{ zone }}구역</span>
        </label>
      </div>
    </div>

    <!-- 관수 시간 -->
    <div class="section-block">
      <label class="section-label">⏱️ 관수 시간</label>
      <div class="field-row">
        <label class="field-label">구역당 관수</label>
        <div class="input-unit-row">
          <input type="number" min="1" max="240" class="num-input"
            :value="durationMin"
            @input="emit('update:durationMin', +($event.target as HTMLInputElement).value)" />
          <span class="unit-label">분</span>
        </div>
      </div>
      <div class="field-row">
        <label class="field-label">구역 간 쉬는 시간</label>
        <div class="input-unit-row">
          <input type="number" min="0" max="60" class="num-input"
            :value="waitTimeBetweenZones"
            @input="emit('update:waitTimeBetweenZones', +($event.target as HTMLInputElement).value)" />
          <span class="unit-label">분</span>
        </div>
      </div>
    </div>

    <!-- 교반기 -->
    <div class="section-block">
      <label class="section-label">🔄 교반기 (교반기/혼합기)</label>
      <div class="toggle-row">
        <span class="toggle-desc">관수 시 교반기를 함께 동작시킵니다</span>
        <button
          class="toggle-btn"
          :class="{ active: mixerEnabled }"
          @click="emit('update:mixerEnabled', !mixerEnabled)"
        >{{ mixerEnabled ? 'ON' : 'OFF' }}</button>
      </div>
    </div>

    <!-- 액비모터 -->
    <div class="section-block">
      <label class="section-label">🧪 액비 혼합</label>
      <div class="toggle-row">
        <span class="toggle-desc">액비모터를 함께 동작시킵니다</span>
        <button
          class="toggle-btn"
          :class="{ active: useFertilizer }"
          @click="emit('update:useFertilizer', !useFertilizer)"
        >{{ useFertilizer ? 'ON' : 'OFF' }}</button>
      </div>

      <template v-if="useFertilizer">
        <div class="field-row">
          <label class="field-label">액비 투여 시간</label>
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

        <!-- 액비 시간 경고 -->
        <div v-if="fertWarnings.length > 0" class="fert-warning">
          <p v-for="(w, i) in fertWarnings" :key="i">⚠️ {{ w }}</p>
        </div>
      </template>
    </div>

    <!-- 장치 변경 -->
    <button class="btn-link-sm" @click="emit('go-back')">← 다른 관수 장치로 변경</button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { FertilizerConfig } from './types'

const props = defineProps<{
  controllerChannels: 8 | 12
  modelValue: number[]
  durationMin: number
  waitTimeBetweenZones: number
  mixerEnabled: boolean
  useFertilizer: boolean
  fertilizer: FertilizerConfig
}>()

const emit = defineEmits<{
  'update:modelValue': [zones: number[]]
  'update:durationMin': [v: number]
  'update:waitTimeBetweenZones': [v: number]
  'update:mixerEnabled': [v: boolean]
  'update:useFertilizer': [v: boolean]
  'update:fertilizer': [v: FertilizerConfig]
  'go-back': []
}>()

// 8CH → 4구역(zone_1~4), 12CH → 8구역(zone_1~8)
const zoneCount = computed(() => props.controllerChannels === 12 ? 8 : 4)

const selectedZones = computed(() => props.modelValue)

function toggleZone(zone: number) {
  const current = [...props.modelValue]
  const idx = current.indexOf(zone)
  if (idx === -1) current.push(zone)
  else current.splice(idx, 1)
  emit('update:modelValue', current.sort((a, b) => a - b))
}

function updateFert(key: keyof FertilizerConfig, val: number | boolean) {
  emit('update:fertilizer', { ...props.fertilizer, [key]: val })
}

const fertWarnings = computed(() => {
  if (!props.useFertilizer) return []
  const fertTotal = (props.fertilizer.duration || 0) + (props.fertilizer.preStopWait || 0)
  if (fertTotal <= 0 || props.durationMin <= 0) return []
  if (props.durationMin < fertTotal) {
    return [`관수 시간(${props.durationMin}분)이 너무 짧습니다. 액비 투여(${props.fertilizer.duration}분) + 종료 전 대기(${props.fertilizer.preStopWait}분) = 최소 ${fertTotal}분 이상이어야 합니다.`]
  }
  return []
})
</script>

<style scoped>
.step-valve { display: flex; flex-direction: column; gap: 16px; }
.step-title { font-size: calc(17px * var(--content-scale, 1)); font-weight: 600; color: var(--text-primary); margin: 0; }
.step-sub { font-size: calc(13px * var(--content-scale, 1)); color: var(--text-muted); margin: -10px 0 0; }

.section-block {
  display: flex; flex-direction: column; gap: 10px;
  padding: 14px; background: var(--bg-secondary);
  border-radius: var(--radius-md, 10px);
}
.section-label {
  font-size: calc(14px * var(--content-scale, 1)); font-weight: 600; color: var(--text-primary);
  display: flex; align-items: center; gap: 6px;
}
.sub-hint { font-size: calc(12px * var(--content-scale, 1)); color: var(--text-muted); font-weight: 400; }

.valve-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
@media (max-width: 400px) { .valve-grid { grid-template-columns: repeat(3, 1fr); } }

.valve-card {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  min-height: 56px; gap: 2px;
  border: 2px solid var(--border-color);
  border-radius: var(--radius-md, 10px);
  background: var(--bg-card);
  cursor: pointer; padding: 8px 4px;
  transition: border-color 0.15s, background 0.15s;
}
.valve-card:hover { border-color: var(--color-primary); }
.valve-card:focus-within { outline: 2px solid var(--color-primary); }
.valve-card.selected { border-color: var(--color-primary); background: color-mix(in srgb, var(--color-primary) 12%, var(--bg-card)); }
.valve-num { font-size: calc(14px * var(--content-scale, 1)); font-weight: 700; color: var(--text-primary); }

.field-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.field-label { font-size: calc(13px * var(--content-scale, 1)); color: var(--text-primary); font-weight: 500; }
.input-unit-row { display: flex; align-items: center; gap: 6px; }
.num-input {
  width: 72px; padding: 8px 10px; text-align: center;
  border: 1px solid var(--border-color); border-radius: var(--radius-sm, 6px);
  background: var(--bg-card); color: var(--text-primary);
  font-size: calc(14px * var(--content-scale, 1));
}
.unit-label { font-size: calc(13px * var(--content-scale, 1)); color: var(--text-muted); }

.toggle-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.toggle-desc { font-size: calc(13px * var(--content-scale, 1)); color: var(--text-muted); flex: 1; }

.toggle-btn {
  padding: 6px 16px; border: 2px solid var(--border-color);
  border-radius: var(--radius-sm, 6px); background: var(--bg-card);
  font-size: calc(13px * var(--content-scale, 1)); font-weight: 600;
  color: var(--text-muted); cursor: pointer; min-width: 52px;
  transition: all 0.15s;
}
.toggle-btn.active { border-color: var(--color-success, #16a34a); background: var(--color-success, #16a34a); color: #fff; }

.fert-warning {
  padding: 8px 12px;
  background: color-mix(in srgb, var(--color-warning, #f59e0b) 12%, var(--bg-secondary));
  border: 1px solid var(--color-warning, #f59e0b);
  border-radius: var(--radius-sm, 6px);
  font-size: calc(12px * var(--content-scale, 1)); color: var(--text-primary); line-height: 1.5;
}
.fert-warning p { margin: 2px 0; }

.btn-link-sm {
  background: none; border: none; color: var(--text-muted);
  font-size: calc(13px * var(--content-scale, 1)); cursor: pointer; padding: 4px 0;
  text-align: left; text-decoration: underline;
}
.btn-link-sm:hover { color: var(--text-primary); }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0,0,0,0); }
</style>
