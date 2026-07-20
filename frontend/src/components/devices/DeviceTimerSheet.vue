<template>
  <div v-if="visible" class="tmr-sheet-overlay" @click.self="$emit('close')">
    <div class="tmr-sheet">
      <div class="tmr-grip"></div>
      <div class="tmr-title"><span class="tmr-ic">⏱</span>{{ title }}</div>
      <p class="tmr-sub">{{ subtitle }}</p>

      <!-- 개폐기: 방향 선택 -->
      <template v-if="showDirection">
        <div class="tmr-section-label">동작</div>
        <div class="tmr-dir-row">
          <button
            v-for="d in dirOptions"
            :key="d.value"
            :class="['tmr-dir-chip', { active: direction === d.value }]"
            @click="direction = d.value"
          >{{ d.label }}</button>
        </div>
      </template>

      <!-- 프리셋 -->
      <div class="tmr-section-label">시간</div>
      <div class="tmr-preset-row">
        <button
          v-for="p in presets"
          :key="p.min"
          :class="['tmr-preset-chip', { active: totalMinutes === p.min }]"
          @click="applyPreset(p.min)"
        >{{ p.label }}</button>
      </div>

      <!-- 직접(시·분) -->
      <div class="tmr-fine">
        <div class="tmr-fine-col">
          <select v-model.number="hour" class="tmr-select">
            <option v-for="h in hourOptions" :key="h" :value="h">{{ h }}</option>
          </select>
          <span class="tmr-unit">시간</span>
        </div>
        <span class="tmr-colon">:</span>
        <div class="tmr-fine-col">
          <select v-model.number="minute" class="tmr-select">
            <option v-for="m in minuteOptions" :key="m" :value="m">{{ String(m).padStart(2, '0') }}</option>
          </select>
          <span class="tmr-unit">분</span>
        </div>
      </div>

      <div class="tmr-actions">
        <button class="tmr-btn-cancel" @click="$emit('close')">취소</button>
        <button
          class="tmr-btn-start"
          :disabled="totalMinutes < 1 || (showDirection && !direction) || submitting"
          @click="onStart"
        >
          {{ submitting ? '설정 중…' : `${label} 타이머 시작` }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'

const props = defineProps<{
  visible: boolean
  title: string
  subtitle: string
  /** 개폐기일 때 true — 닫기/열기 방향 선택 노출 */
  showDirection?: boolean
  submitting?: boolean
}>()

const emit = defineEmits<{
  close: []
  start: [payload: { durationMinutes: number; direction?: 'open' | 'close' }]
}>()

const dirOptions = [
  { value: 'close' as const, label: '닫기' },
  { value: 'open' as const, label: '열기' },
]
const presets = [
  { min: 30, label: '30분' },
  { min: 60, label: '1시간' },
  { min: 120, label: '2시간' },
  { min: 180, label: '3시간' },
]
const hourOptions = Array.from({ length: 13 }, (_, n) => n) // 0~12
const minuteOptions = Array.from({ length: 12 }, (_, n) => n * 5) // 0,5,...,55

const direction = ref<'open' | 'close' | null>(null)
const hour = ref(1)
const minute = ref(0)

const totalMinutes = computed(() => hour.value * 60 + minute.value)
const label = computed(() => {
  const h = hour.value
  const m = minute.value
  if (h && m) return `${h}시간 ${m}분`
  if (h) return `${h}시간`
  return `${m}분`
})

function applyPreset(min: number) {
  hour.value = Math.floor(min / 60)
  minute.value = min % 60
}

function onStart() {
  if (totalMinutes.value < 1) return
  emit('start', {
    durationMinutes: Math.min(720, totalMinutes.value),
    ...(props.showDirection && direction.value ? { direction: direction.value } : {}),
  })
}

// 열릴 때 기본값 초기화
watch(
  () => props.visible,
  (v) => {
    if (v) {
      hour.value = 1
      minute.value = 0
      direction.value = null
    }
  },
)
</script>

<style scoped>
.tmr-sheet-overlay {
  position: fixed; inset: 0; background: rgba(20, 22, 26, 0.34);
  display: flex; align-items: flex-end; justify-content: center; z-index: 1100;
}
.tmr-sheet {
  background: var(--bg-card, #fff); width: 100%; max-width: 460px;
  border-radius: 20px 20px 0 0; padding: 13px 18px calc(20px + env(safe-area-inset-bottom));
  border-top: 2px solid #06b6d4; box-shadow: 0 -8px 30px rgba(0, 0, 0, 0.16);
  animation: tmr-up 0.22s ease;
}
@keyframes tmr-up { from { transform: translateY(100%); } to { transform: translateY(0); } }
.tmr-grip { width: 38px; height: 4px; border-radius: 3px; background: #d7d9de; margin: 0 auto 12px; }
.tmr-title { font-size: 15px; font-weight: 800; display: flex; align-items: center; gap: 6px; color: var(--text-primary, #333); }
.tmr-ic { color: #0e7490; }
.tmr-sub { font-size: 12px; color: var(--text-muted, #5b6470); margin: 4px 0 12px; line-height: 1.5; }

.tmr-section-label { font-size: 11px; font-weight: 800; color: var(--text-muted, #8891a0); margin: 10px 0 6px; }

.tmr-dir-row { display: flex; gap: 8px; }
.tmr-dir-chip {
  flex: 1; text-align: center; font-size: 13px; font-weight: 800; padding: 9px 0;
  border-radius: 10px; border: 1px solid #dfe3e8; background: var(--bg-card, #fff);
  color: var(--text-secondary, #5b6470); cursor: pointer; transition: all 0.15s;
}
.tmr-dir-chip.active { border-color: #06b6d4; background: #06b6d4; color: #fff; }

.tmr-preset-row { display: flex; gap: 8px; flex-wrap: wrap; }
.tmr-preset-chip {
  flex: 1; min-width: 64px; text-align: center; font-size: 12.5px; font-weight: 800;
  padding: 8px 0; border-radius: 999px; border: 1px solid #dfe3e8;
  background: var(--bg-card, #fff); color: var(--text-secondary, #5b6470); cursor: pointer; transition: all 0.15s;
}
.tmr-preset-chip.active { border-color: #06b6d4; background: #06b6d4; color: #fff; }

.tmr-fine {
  display: flex; align-items: center; justify-content: center; gap: 10px;
  background: var(--bg-subtle, #fafbfc); border: 1px solid var(--border-light, #eef0f3);
  border-radius: 12px; padding: 12px; margin-top: 10px;
}
.tmr-fine-col { display: flex; align-items: center; gap: 6px; }
.tmr-select {
  font-size: 18px; font-weight: 800; color: #0e7490; text-align: center;
  border: 1px solid #67e8f9; border-radius: 8px; background: #ecfeff;
  padding: 6px 8px; cursor: pointer; font-variant-numeric: tabular-nums;
}
.tmr-unit { font-size: 12px; font-weight: 700; color: var(--text-muted, #5b6470); }
.tmr-colon { font-size: 20px; font-weight: 800; color: #c3c8cf; }

.tmr-actions { display: flex; gap: 8px; margin-top: 14px; }
.tmr-btn-cancel {
  flex: 0 0 auto; padding: 11px 18px; border-radius: 10px; border: none;
  background: var(--bg-badge, #f2f3f5); color: var(--text-secondary, #5b6470);
  font-size: 13px; font-weight: 700; cursor: pointer;
}
.tmr-btn-start {
  flex: 1; padding: 11px 0; border-radius: 10px; border: none;
  background: #0e7490; color: #fff; font-size: 13.5px; font-weight: 800; cursor: pointer;
}
.tmr-btn-start:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
