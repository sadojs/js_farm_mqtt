<template>
  <div class="modal-overlay" @click.self="$emit('cancel')">
    <div class="modal">
      <h3 class="modal-title">일정 이동</h3>
      <p class="modal-desc">
        <strong>{{ event?.zoneName }} · {{ event?.pest }} {{ event?.round }}차</strong>
        일정을 {{ shortDate(targetDate) }}(으)로 이동합니다.
      </p>
      <label class="opt" :class="{ active: mode === 'single' }">
        <input type="radio" value="single" v-model="mode" />
        <span>
          <strong>이 일정만 이동</strong>
          <small>선택한 1건만 날짜를 변경합니다.</small>
        </span>
      </label>
      <label class="opt" :class="{ active: mode === 'following' }">
        <input type="radio" value="following" v-model="mode" />
        <span>
          <strong>이 일정 + 이후 전체 이동</strong>
          <small>같은 약품의 이후 회차를 간격을 유지하며 함께 이동합니다.</small>
        </span>
      </label>
      <div class="modal-actions">
        <button class="btn-ghost" @click="$emit('cancel')">취소</button>
        <button class="btn-primary" @click="$emit('apply', mode)">적용</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import type { SprayEvent, MoveMode } from '../types/spray-schedule.types'
import { shortDate } from '../utils/spray-schedule.utils'

defineProps<{ event: SprayEvent | null; targetDate: string }>()
defineEmits<{ (e: 'apply', mode: MoveMode): void; (e: 'cancel'): void }>()

const mode = ref<MoveMode>('single')
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: var(--overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 16px;
}
.modal {
  background: var(--bg-card);
  border-radius: 14px;
  box-shadow: var(--shadow-modal);
  padding: 22px;
  width: 100%;
  max-width: 440px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.modal-title { font-size: var(--font-size-subtitle); font-weight: 700; color: var(--text-primary); }
.modal-desc { color: var(--text-secondary); font-size: var(--font-size-label); }
.opt {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  border: 1px solid var(--border-input);
  border-radius: 10px;
  padding: 12px;
  cursor: pointer;
}
.opt.active { border-color: var(--accent); background: var(--accent-bg); }
.opt span { display: flex; flex-direction: column; gap: 2px; }
.opt small { color: var(--text-muted); }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
.btn-ghost {
  background: var(--bg-hover);
  border: none;
  border-radius: 8px;
  padding: 9px 16px;
  color: var(--text-secondary);
  cursor: pointer;
  font-weight: 600;
}
.btn-primary {
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 9px 18px;
  cursor: pointer;
  font-weight: 600;
}
.btn-primary:hover { background: var(--accent-hover); }
</style>
