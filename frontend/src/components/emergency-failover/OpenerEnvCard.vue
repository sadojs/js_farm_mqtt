<script setup lang="ts">
import { computed } from 'vue'
import type { OpenerTriggerType } from '../../types/emergency-failover.types'

const props = defineProps<{
  openerTriggerType: OpenerTriggerType
  openerOnValue: number
  openerOffValue: number
  sensorTimeoutSeconds: number
}>()
const emit = defineEmits<{
  (e: 'update:openerTriggerType', v: OpenerTriggerType): void
  (e: 'update:openerOnValue', v: number): void
  (e: 'update:openerOffValue', v: number): void
  (e: 'update:sensorTimeoutSeconds', v: number): void
}>()

const unit = computed(() => (props.openerTriggerType === 'humidity' ? '%' : '°C'))
const step = computed(() => (props.openerTriggerType === 'humidity' ? 1 : 0.1))
const min = computed(() => (props.openerTriggerType === 'humidity' ? 0 : -10))
const max = computed(() => (props.openerTriggerType === 'humidity' ? 100 : 60))

const valid = computed(() => {
  if (props.openerOnValue <= props.openerOffValue) return false
  if (props.openerTriggerType === 'humidity') {
    return props.openerOnValue >= 0 && props.openerOnValue <= 100
      && props.openerOffValue >= 0 && props.openerOffValue <= 100
  }
  return true
})

const triggerLabel = computed(() =>
  props.openerTriggerType === 'humidity' ? '습도 (높을수록 개방)' : '온도 (높을수록 개방)',
)

// 초 ↔ 분 표시
const timeoutMinutes = computed({
  get: () => Math.round((props.sensorTimeoutSeconds || 600) / 60),
  set: (m: number) => emit('update:sensorTimeoutSeconds', Math.max(2, Math.min(60, Math.round(m))) * 60),
})

function changeTriggerType(next: OpenerTriggerType) {
  if (next === props.openerTriggerType) return
  emit('update:openerTriggerType', next)
  // 단위가 바뀌면 임계값도 합리적 기본값으로 자동 재설정
  if (next === 'humidity') {
    if (props.openerOnValue > 100 || props.openerOnValue < 0) emit('update:openerOnValue', 85)
    if (props.openerOffValue > 100 || props.openerOffValue < 0) emit('update:openerOffValue', 70)
  } else {
    if (props.openerOnValue > 60) emit('update:openerOnValue', 30)
    if (props.openerOffValue > 60) emit('update:openerOffValue', 25)
  }
}
</script>

<template>
  <section class="card">
    <h3>개폐기 온습도 조건 <span class="primary-badge">주 제어</span></h3>
    <p class="hint" style="margin-bottom: 12px;">
      ※ 폴백 모드(서버 단절) 동안 개폐기를 <strong>온도/습도</strong> 로 자동 제어합니다(유동팬과 동일 방식).
      측정값이 높으면 <strong>개방</strong>, 낮으면 <strong>닫힘</strong>.
      <br>
      ※ <strong>온습도계가 동작하지 않으면</strong>(측정값 없음/오래됨) 아래 「백업 스케줄」의
      월별 시간 스케줄로 자동 전환됩니다.
    </p>

    <div class="form-group" style="margin-bottom: 12px;">
      <label>트리거 측정값</label>
      <div class="seg-control">
        <button
          type="button"
          :class="['seg-btn', { active: openerTriggerType === 'temperature' }]"
          @click="changeTriggerType('temperature')"
        >🌡️ 온도</button>
        <button
          type="button"
          :class="['seg-btn', { active: openerTriggerType === 'humidity' }]"
          @click="changeTriggerType('humidity')"
        >💧 습도</button>
      </div>
      <p class="seg-hint">{{ triggerLabel }}</p>
    </div>

    <div class="grid-2">
      <div class="form-group">
        <label>개방 임계값 ({{ unit }})</label>
        <input
          type="number" :step="step" :min="min" :max="max"
          :value="openerOnValue"
          @input="emit('update:openerOnValue', Number(($event.target as HTMLInputElement).value))"
        />
      </div>
      <div class="form-group">
        <label>닫힘 임계값 ({{ unit }})</label>
        <input
          type="number" :step="step" :min="min" :max="max"
          :value="openerOffValue"
          @input="emit('update:openerOffValue', Number(($event.target as HTMLInputElement).value))"
        />
      </div>
    </div>
    <p v-if="!valid" class="error-msg">
      ⚠ 개방 임계값은 닫힘 임계값보다 커야 합니다
      <template v-if="openerTriggerType === 'humidity'"> · 습도는 0~100% 범위</template>
    </p>

    <div class="form-group" style="margin-top: 14px; max-width: 320px;">
      <label>온습도계 이상 판정 시간 (분)</label>
      <input type="number" min="2" max="60" step="1" v-model.number="timeoutMinutes" />
      <p class="seg-hint">
        마지막 측정값 수신 후 이 시간이 지나면 온습도계 이상으로 보고 백업 스케줄로 전환합니다. (기본 10분)
      </p>
    </div>
  </section>
</template>

<style scoped>
.card {
  background: var(--card-bg, #fff); border-radius: 12px;
  padding: 16px 20px; margin-bottom: 16px;
  border: 1px solid var(--border-color, #e5e5e5);
}
.card h3 { margin: 0 0 12px 0; font-size: 16px; display: flex; align-items: center; gap: 8px; }
.primary-badge {
  font-size: 11px; font-weight: 700; color: #fff; background: var(--accent, #2e7d32);
  border-radius: 6px; padding: 2px 8px;
}
.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.form-group { display: flex; flex-direction: column; gap: 6px; }
.form-group label { font-size: 14px; font-weight: 500; }
.form-group input {
  padding: 8px; border: 1px solid var(--border-color, #ccc);
  border-radius: 6px; font-size: 14px;
}
.hint {
  background: var(--info-bg, #f0f4f8); padding: 8px 12px; border-radius: 6px;
  font-size: 13px; color: var(--text-secondary, #555); margin: 0; line-height: 1.5;
}
.error-msg { color: var(--danger, #d32f2f); font-size: 13px; margin: 8px 0 0 0; }
.seg-control {
  display: inline-flex; border: 1px solid var(--border-color, #ccc); border-radius: 8px;
  overflow: hidden; background: var(--bg-secondary, #f5f5f5); width: fit-content;
}
.seg-btn {
  padding: 8px 14px; background: transparent; border: none; font-size: 14px; font-weight: 500;
  color: var(--text-secondary, #555); cursor: pointer; transition: background 0.15s, color 0.15s;
}
.seg-btn:not(:last-child) { border-right: 1px solid var(--border-color, #ccc); }
.seg-btn.active { background: var(--accent, #2e7d32); color: #fff; }
.seg-hint { font-size: 12px; color: var(--text-muted, #888); margin: 4px 0 0 0; }

@media (max-width: 768px) { .grid-2 { grid-template-columns: 1fr; } }
</style>
