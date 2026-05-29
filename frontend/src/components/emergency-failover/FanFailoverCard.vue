<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  fanEnabled: boolean
  fanOnTemp: number
  fanOffTemp: number
}>()
const emit = defineEmits<{
  (e: 'update:fanEnabled', v: boolean): void
  (e: 'update:fanOnTemp', v: number): void
  (e: 'update:fanOffTemp', v: number): void
}>()

const valid = computed(() => props.fanOnTemp > props.fanOffTemp)
</script>

<template>
  <section class="card">
    <h3>5. 환기팬 / 유동팬</h3>
    <p class="hint" style="margin-bottom: 12px;">※ 환기팬과 유동팬은 동일 장치를 가리킵니다. 기본 비활성.</p>
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
    <div class="grid-2">
      <div class="form-group">
        <label>ON 임계값 (°C)</label>
        <input
          type="number" step="0.1"
          :value="fanOnTemp"
          @input="emit('update:fanOnTemp', Number(($event.target as HTMLInputElement).value))"
        />
      </div>
      <div class="form-group">
        <label>OFF 임계값 (°C)</label>
        <input
          type="number" step="0.1"
          :value="fanOffTemp"
          @input="emit('update:fanOffTemp', Number(($event.target as HTMLInputElement).value))"
        />
      </div>
    </div>
    <p v-if="!valid" class="error-msg">⚠ ON 임계값은 OFF 임계값보다 커야 합니다</p>
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
}
.error-msg { color: var(--danger, #d32f2f); font-size: 13px; margin: 8px 0 0 0; }
@media (max-width: 768px) { .grid-2 { grid-template-columns: 1fr; } }
</style>
