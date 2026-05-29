<script setup lang="ts">
defineProps<{
  irrigationEnabled: boolean
  irrigationMaxRuntimeMinutes: number
}>()
const emit = defineEmits<{
  (e: 'update:irrigationEnabled', v: boolean): void
  (e: 'update:irrigationMaxRuntimeMinutes', v: number): void
}>()
</script>

<template>
  <section class="card">
    <h3>3. 관수 (Irrigation)</h3>
    <div class="toggle-row">
      <label>
        <input
          type="checkbox"
          :checked="irrigationEnabled"
          @change="emit('update:irrigationEnabled', ($event.target as HTMLInputElement).checked)"
        />
        폴백 활성
      </label>
    </div>
    <div class="form-group">
      <label>관수 시작 후 최대 작동 시간 (분)</label>
      <input
        type="number" min="1" max="240"
        :value="irrigationMaxRuntimeMinutes"
        @input="emit('update:irrigationMaxRuntimeMinutes', Number(($event.target as HTMLInputElement).value))"
      />
    </div>
    <p class="hint">ⓘ 통신 단절 시 관수 ON 시각부터 N분이 지나면 자동 OFF. 폴백 중 신규 시작은 금지됩니다.</p>
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
.form-group { display: flex; flex-direction: column; gap: 6px; }
.form-group label { font-size: 14px; font-weight: 500; }
.form-group input {
  padding: 8px; border: 1px solid var(--border-color, #ccc);
  border-radius: 6px; font-size: 14px;
}
.hint {
  background: var(--info-bg, #f0f4f8); padding: 8px 12px; border-radius: 6px;
  font-size: 13px; color: var(--text-secondary, #555); margin: 8px 0 0 0;
}
</style>
