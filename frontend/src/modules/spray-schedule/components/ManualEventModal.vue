<template>
  <div class="modal-overlay" @click.self="$emit('cancel')">
    <div class="modal">
      <h3 class="modal-title">단건 일정 추가</h3>
      <p class="modal-desc">프로그램과 무관한 1회성 방재 일정을 추가합니다. 달력에 ✚ 로 표시됩니다.</p>

      <label class="field">
        <span>구역</span>
        <select v-model="form.zoneId" class="inp">
          <option value="" disabled>구역 선택</option>
          <option v-for="z in zones" :key="z.id" :value="z.id">{{ z.name }}</option>
        </select>
      </label>
      <label class="field">
        <span>날짜</span>
        <input v-model="form.date" type="date" class="inp" />
      </label>
      <label class="field">
        <span>방재 종류</span>
        <input v-model="form.pest" class="inp" placeholder="예: 총채약" />
      </label>
      <label class="field">
        <span>약품명</span>
        <input v-model="form.product" class="inp" placeholder="예: 스피노사드" />
      </label>
      <label class="field">
        <span>메모</span>
        <input v-model="form.note" class="inp" placeholder="(선택)" />
      </label>

      <div class="modal-actions">
        <button class="btn-ghost" @click="$emit('cancel')">취소</button>
        <button class="btn-primary" :disabled="!form.zoneId || !form.date" @click="submit">추가</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive } from 'vue'
import type { ZoneMarker, CreateManualEventPayload } from '../types/spray-schedule.types'
import { todayStr } from '../utils/spray-schedule.utils'

const props = defineProps<{ zones: ZoneMarker[]; defaultDate?: string }>()
const emit = defineEmits<{ (e: 'create', payload: CreateManualEventPayload): void; (e: 'cancel'): void }>()

const form = reactive({
  zoneId: props.zones[0]?.id ?? '',
  date: props.defaultDate ?? todayStr(),
  pest: '',
  product: '',
  note: '',
})

function submit() {
  emit('create', {
    zoneId: form.zoneId,
    date: form.date,
    pest: form.pest.trim() || undefined,
    product: form.product.trim() || undefined,
    note: form.note.trim() || undefined,
  })
}
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
  max-width: 420px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.modal-title { font-size: var(--font-size-subtitle); font-weight: 700; color: var(--text-primary); }
.modal-desc { color: var(--text-muted); font-size: var(--font-size-caption); }
.field { display: flex; flex-direction: column; gap: 4px; }
.field span { font-size: var(--font-size-caption); color: var(--text-secondary); font-weight: 600; }
.inp {
  padding: 10px 12px;
  border: 1px solid var(--border-input);
  border-radius: 8px;
  background: var(--bg-input);
  color: var(--text-primary);
}
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
.btn-primary:disabled { opacity: 0.5; cursor: default; }
.btn-primary:hover:not(:disabled) { background: var(--accent-hover); }
</style>
