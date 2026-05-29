<script setup lang="ts">
defineProps<{
  fertilizerEnabled: boolean
}>()
const emit = defineEmits<{
  (e: 'update:fertilizerEnabled', v: boolean): void
}>()
</script>

<template>
  <section class="card">
    <h3>4. 액비 (Fertilizer)</h3>
    <div class="toggle-row">
      <label>
        <input
          type="checkbox"
          :checked="fertilizerEnabled"
          @change="emit('update:fertilizerEnabled', ($event.target as HTMLInputElement).checked)"
        />
        폴백 활성
      </label>
    </div>
    <p class="hint">ⓘ 통신 단절 즉시 OFF (지연 없음)</p>
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
.hint {
  background: var(--info-bg, #f0f4f8); padding: 8px 12px; border-radius: 6px;
  font-size: 13px; color: var(--text-secondary, #555); margin: 8px 0 0 0;
}
</style>
