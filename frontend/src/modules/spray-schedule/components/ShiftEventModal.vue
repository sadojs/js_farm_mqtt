<template>
  <div class="modal-overlay" @click.self="$emit('cancel')">
    <div class="modal">
      <h3 class="modal-title">일정 연기 / 당기기</h3>
      <p class="modal-desc">
        <strong>{{ event?.zoneName }} · {{ event?.pest }}<template v-if="!event?.isManual"> {{ event?.round }}차</template></strong>
        의 일정을 조정합니다.
      </p>
      <p class="current-date">현재 날짜: <strong>{{ shortDate(event?.date ?? '') }}</strong></p>

      <!-- 방향 -->
      <div class="dir-row">
        <button
          type="button"
          :class="['dir-btn', { active: dir === 'forward' }]"
          @click="dir = 'forward'"
        >연기 (뒤로)</button>
        <button
          type="button"
          :class="['dir-btn', { active: dir === 'backward' }]"
          @click="dir = 'backward'"
        >당기기 (앞으로)</button>
      </div>

      <!-- 일수 -->
      <label class="field-label">조정할 일수</label>
      <div class="quick-row">
        <button
          v-for="d in [1, 2, 3, 5, 7, 14]"
          :key="d"
          type="button"
          :class="['quick-chip', { active: days === d }]"
          @click="days = d"
        >{{ d }}일</button>
        <input
          type="number"
          v-model.number="days"
          min="1"
          max="60"
          class="num-input"
          inputmode="numeric"
        />
      </div>

      <p class="preview">→ 새 날짜: <strong>{{ shortDate(newDate) }}</strong></p>

      <!-- 범위 -->
      <label class="opt" :class="{ active: mode === 'single' }">
        <input type="radio" value="single" v-model="mode" />
        <span>
          <strong>이 일정만 조정</strong>
          <small>선택한 1건만 날짜를 변경합니다.</small>
        </span>
      </label>
      <label class="opt" :class="{ active: mode === 'following' }">
        <input type="radio" value="following" v-model="mode" />
        <span>
          <strong>이 일정 + 이후 전체 조정</strong>
          <small>같은 약품의 이후 회차도 같이 {{ dir === 'forward' ? '연기' : '당김' }} 합니다.</small>
        </span>
      </label>

      <div class="modal-actions">
        <button class="btn-ghost" @click="$emit('cancel')">취소</button>
        <button class="btn-primary" :disabled="!canApply" @click="apply">적용</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { SprayEvent, MoveMode } from '../types/spray-schedule.types'
import { shortDate } from '../utils/spray-schedule.utils'

const props = defineProps<{ event: SprayEvent | null }>()
const emit = defineEmits<{
  (e: 'apply', payload: { newDate: string; mode: MoveMode }): void
  (e: 'cancel'): void
}>()

const dir = ref<'forward' | 'backward'>('forward')
const days = ref<number>(1)
const mode = ref<MoveMode>('single')

const newDate = computed(() => {
  if (!props.event?.date) return ''
  const d = new Date(props.event.date)
  if (isNaN(d.getTime())) return ''
  const offset = dir.value === 'forward' ? days.value : -days.value
  d.setDate(d.getDate() + offset)
  return d.toISOString().slice(0, 10)
})

const canApply = computed(() => {
  return props.event && Number.isInteger(days.value) && days.value >= 1 && days.value <= 60 && newDate.value !== ''
})

function apply() {
  if (!canApply.value) return
  emit('apply', { newDate: newDate.value, mode: mode.value })
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
  z-index: 1100;
  padding: 16px;
}
.modal {
  background: var(--bg-card);
  border-radius: 14px;
  box-shadow: var(--shadow-modal);
  padding: 22px;
  width: 100%;
  max-width: 460px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.modal-title { font-size: var(--font-size-subtitle); font-weight: 700; color: var(--text-primary); }
.modal-desc { color: var(--text-secondary); font-size: var(--font-size-label); }
.current-date { font-size: var(--font-size-label); color: var(--text-secondary); margin: 0; }
.current-date strong { color: var(--text-primary); }

.dir-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  background: var(--bg-hover);
  padding: 4px;
  border-radius: 10px;
}
.dir-btn {
  padding: 9px 10px;
  border: none;
  background: transparent;
  border-radius: 7px;
  font-weight: 600;
  color: var(--text-secondary);
  cursor: pointer;
}
.dir-btn.active { background: var(--bg-card); color: var(--accent); box-shadow: var(--shadow-card); }

.field-label { font-size: var(--font-size-label); font-weight: 600; color: var(--text-secondary); margin-top: 4px; }

.quick-row {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
}
.quick-chip {
  padding: 7px 12px;
  border: 1px solid var(--border-input);
  border-radius: 8px;
  background: var(--bg-card);
  color: var(--text-secondary);
  font-weight: 600;
  cursor: pointer;
  font-variant-numeric: tabular-nums;
}
.quick-chip.active { background: var(--accent-bg); color: var(--accent); border-color: var(--accent); }
.num-input {
  width: 72px;
  padding: 7px 10px;
  border: 1px solid var(--border-input);
  border-radius: 8px;
  background: var(--bg-card);
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  text-align: center;
}
.num-input:focus { outline: none; border-color: var(--accent); }

.preview {
  margin: 4px 0 6px;
  padding: 10px 14px;
  background: var(--accent-bg);
  border-radius: 10px;
  font-size: var(--font-size-label);
  color: var(--accent);
}
.preview strong { color: var(--text-primary); }

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
.btn-primary:hover:not(:disabled) { background: var(--accent-hover); }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
