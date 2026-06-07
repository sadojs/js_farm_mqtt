<script setup lang="ts">
import { computed } from 'vue'
import type { FanTriggerType } from '../../types/emergency-failover.types'

const props = defineProps<{
  fanEnabled: boolean
  fanTriggerType: FanTriggerType
  fanOnTemp: number
  fanOffTemp: number
}>()
const emit = defineEmits<{
  (e: 'update:fanEnabled', v: boolean): void
  (e: 'update:fanTriggerType', v: FanTriggerType): void
  (e: 'update:fanOnTemp', v: number): void
  (e: 'update:fanOffTemp', v: number): void
}>()

const unit = computed(() => (props.fanTriggerType === 'humidity' ? '%' : '°C'))
const step = computed(() => (props.fanTriggerType === 'humidity' ? 1 : 0.1))
const min = computed(() => (props.fanTriggerType === 'humidity' ? 0 : -10))
const max = computed(() => (props.fanTriggerType === 'humidity' ? 100 : 60))

const valid = computed(() => {
  if (props.fanOnTemp <= props.fanOffTemp) return false
  if (props.fanTriggerType === 'humidity') {
    return props.fanOnTemp >= 0 && props.fanOnTemp <= 100
      && props.fanOffTemp >= 0 && props.fanOffTemp <= 100
  }
  return true
})

const triggerLabel = computed(() =>
  props.fanTriggerType === 'humidity' ? '습도 (높을수록 ON)' : '온도 (높을수록 ON)',
)

function changeTriggerType(next: FanTriggerType) {
  if (next === props.fanTriggerType) return
  emit('update:fanTriggerType', next)
  // 단위가 바뀌면 임계값도 합리적 기본값으로 자동 재설정
  // (이전 값이 새 단위 범위 밖일 수 있어 사용자가 헷갈리지 않게)
  if (next === 'humidity') {
    if (props.fanOnTemp > 100 || props.fanOnTemp < 0) emit('update:fanOnTemp', 85)
    if (props.fanOffTemp > 100 || props.fanOffTemp < 0) emit('update:fanOffTemp', 70)
  } else {
    if (props.fanOnTemp > 60) emit('update:fanOnTemp', 35)
    if (props.fanOffTemp > 60) emit('update:fanOffTemp', 28)
  }
}
</script>

<template>
  <section class="card">
    <h3>5. 환기팬 / 유동팬</h3>
    <p class="hint" style="margin-bottom: 12px;">
      ※ 환기팬과 유동팬은 동일 장치를 가리킵니다. 기본 비활성.
      <br>
      ※ 폴백 모드(서버 단절) 동안 게이트웨이가 수신한 모든 온/습도 측정기의
      <strong>가장 최근 값</strong> 으로 동작합니다. 측정기를 1대로 좁히려면
      해당 게이트웨이에 측정기를 한 종류만 연결하세요.
    </p>

    <div class="toggle-row">
      <label>
        <input
          type="checkbox"
          :checked="fanEnabled"
          @change="emit('update:fanEnabled', ($event.target as HTMLInputElement).checked)"
        />
        폴백 활성
      </label>
    </div>

    <div class="form-group" style="margin-bottom: 12px;">
      <label>트리거 측정값</label>
      <div class="seg-control">
        <button
          type="button"
          :class="['seg-btn', { active: fanTriggerType === 'temperature' }]"
          @click="changeTriggerType('temperature')"
        >🌡️ 온도</button>
        <button
          type="button"
          :class="['seg-btn', { active: fanTriggerType === 'humidity' }]"
          @click="changeTriggerType('humidity')"
        >💧 습도</button>
      </div>
      <p class="seg-hint">{{ triggerLabel }}</p>
    </div>

    <div class="grid-2">
      <div class="form-group">
        <label>ON 임계값 ({{ unit }})</label>
        <input
          type="number" :step="step" :min="min" :max="max"
          :value="fanOnTemp"
          @input="emit('update:fanOnTemp', Number(($event.target as HTMLInputElement).value))"
        />
      </div>
      <div class="form-group">
        <label>OFF 임계값 ({{ unit }})</label>
        <input
          type="number" :step="step" :min="min" :max="max"
          :value="fanOffTemp"
          @input="emit('update:fanOffTemp', Number(($event.target as HTMLInputElement).value))"
        />
      </div>
    </div>
    <p v-if="!valid" class="error-msg">
      ⚠ ON 임계값은 OFF 임계값보다 커야 합니다
      <template v-if="fanTriggerType === 'humidity'"> · 습도는 0~100% 범위</template>
    </p>
  </section>
</template>

<style scoped>
.card {
  background: var(--card-bg, #fff); border-radius: 12px;
  padding: 16px 20px; margin-bottom: 16px;
  border: 1px solid var(--border-color, #e5e5e5);
}
.card h3 { margin: 0 0 12px 0; font-size: 16px; }
.toggle-row { display: flex; gap: 24px; margin-bottom: 12px; flex-wrap: wrap; }
.toggle-row label { display: flex; align-items: center; gap: 6px; cursor: pointer; }
.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.form-group { display: flex; flex-direction: column; gap: 6px; }
.form-group label { font-size: 14px; font-weight: 500; }
.form-group input {
  padding: 8px; border: 1px solid var(--border-color, #ccc);
  border-radius: 6px; font-size: 14px;
}
.hint {
  background: var(--info-bg, #f0f4f8); padding: 8px 12px; border-radius: 6px;
  font-size: 13px; color: var(--text-secondary, #555); margin: 0;
  line-height: 1.5;
}
.error-msg { color: var(--danger, #d32f2f); font-size: 13px; margin: 8px 0 0 0; }

.seg-control {
  display: inline-flex;
  border: 1px solid var(--border-color, #ccc);
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg-secondary, #f5f5f5);
  width: fit-content;
}
.seg-btn {
  padding: 8px 14px;
  background: transparent;
  border: none;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-secondary, #555);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.seg-btn:not(:last-child) {
  border-right: 1px solid var(--border-color, #ccc);
}
.seg-btn.active {
  background: var(--accent, #2e7d32);
  color: #fff;
}
.seg-hint {
  font-size: 12px;
  color: var(--text-muted, #888);
  margin: 4px 0 0 0;
}

@media (max-width: 768px) { .grid-2 { grid-template-columns: 1fr; } }
</style>
