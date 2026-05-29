<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  heartbeatTimeoutSeconds: number
  recoveryGraceSeconds: number
}>()
const emit = defineEmits<{
  (e: 'update:heartbeatTimeoutSeconds', v: number): void
  (e: 'update:recoveryGraceSeconds', v: number): void
}>()

const timeoutMinutes = computed(() => Math.round(props.heartbeatTimeoutSeconds / 60))
</script>

<template>
  <section class="card">
    <h3>1. 하트비트 설정</h3>
    <div class="grid-2">
      <div class="form-group">
        <label>단절 판정 시간 (초)</label>
        <input
          type="number" min="60" max="3600"
          :value="heartbeatTimeoutSeconds"
          @input="emit('update:heartbeatTimeoutSeconds', Number(($event.target as HTMLInputElement).value))"
        />
        <small>{{ timeoutMinutes }}분</small>
      </div>
      <div class="form-group">
        <label>복구 grace (초)</label>
        <input
          type="number" min="10" max="600"
          :value="recoveryGraceSeconds"
          @input="emit('update:recoveryGraceSeconds', Number(($event.target as HTMLInputElement).value))"
        />
      </div>
    </div>
  </section>
</template>

<style scoped>
.card {
  background: var(--card-bg, #fff); border-radius: 12px;
  padding: 16px 20px; margin-bottom: 16px;
  border: 1px solid var(--border-color, #e5e5e5);
}
.card h3 { margin: 0 0 12px 0; font-size: 16px; }
.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.form-group { display: flex; flex-direction: column; gap: 6px; }
.form-group label { font-size: 14px; font-weight: 500; }
.form-group input {
  padding: 8px; border: 1px solid var(--border-color, #ccc);
  border-radius: 6px; font-size: 14px;
}
.form-group small { color: var(--text-secondary, #888); font-size: 12px; }
@media (max-width: 768px) { .grid-2 { grid-template-columns: 1fr; } }
</style>
