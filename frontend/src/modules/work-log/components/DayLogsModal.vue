<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="day-modal">
      <div class="modal-head">
        <h3>{{ titleText }} <span class="dow">{{ dowText }}</span></h3>
        <button class="close-btn" @click="$emit('close')" aria-label="닫기">✕</button>
      </div>

      <div class="modal-body">
        <p class="count-line">이 날 작업 기록 {{ logs.length }}건</p>

        <div v-if="logs.length === 0" class="empty">아직 이 날 기록이 없습니다.</div>

        <ul v-else class="log-list">
          <li v-for="log in logs" :key="log.id" class="log-row" @click="$emit('edit', log)">
            <span class="row-emoji" :style="{ background: colorOf(log) + '22' }">{{ emojiOf(log) }}</span>
            <div class="row-main">
              <span class="row-task">{{ taskLabel(log) }}</span>
              <span class="row-zone">{{ zoneName(log) }}<template v-if="log.note"> · {{ log.note }}</template></span>
            </div>
            <span class="row-edit">수정 ›</span>
          </li>
        </ul>
      </div>

      <div class="modal-foot">
        <button class="btn-add" @click="$emit('add', date)">+ 이 날 기록 추가</button>
        <button class="btn-ghost" @click="$emit('close')">닫기</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { WorkLog, WorkTaskType } from '../types/work-log.types'

const props = defineProps<{
  date: string // YYYY-MM-DD
  logs: WorkLog[]
  taskTypes: Record<string, WorkTaskType>
  zones: Record<string, { id: string; name: string }>
}>()
defineEmits<{
  (e: 'close'): void
  (e: 'edit', log: WorkLog): void
  (e: 'add', date: string): void
}>()

const weekdays = ['일', '월', '화', '수', '목', '금', '토']
const titleText = computed(() => {
  const [, m, d] = props.date.split('-').map(Number)
  return `${m}월 ${d}일`
})
const dowText = computed(() => {
  const [y, m, d] = props.date.split('-').map(Number)
  return weekdays[new Date(y, m - 1, d).getDay()] + '요일'
})

function taskLabel(log: WorkLog) { return props.taskTypes[log.taskTypeId]?.label ?? '?' }
function emojiOf(log: WorkLog) { return props.taskTypes[log.taskTypeId]?.emoji ?? '📝' }
function colorOf(log: WorkLog) { return props.taskTypes[log.taskTypeId]?.color ?? '#43a047' }
function zoneName(log: WorkLog) { return props.zones[log.zoneId]?.name ?? '?' }
</script>

<style scoped>
.modal-overlay {
  position: fixed; inset: 0;
  background: var(--overlay);
  display: flex; align-items: center; justify-content: center;
  z-index: 1000; padding: 16px;
}
.day-modal {
  background: var(--bg-card);
  border-radius: 16px;
  width: 100%; max-width: 460px;
  box-shadow: var(--shadow-modal);
  display: flex; flex-direction: column;
  max-height: 88vh;
}
.modal-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 18px 20px; border-bottom: 1px solid var(--border-light);
}
.modal-head h3 { margin: 0; font-size: 18px; font-weight: 700; color: var(--text-primary); }
.dow { margin-left: 8px; font-size: 14px; font-weight: 500; color: var(--text-muted); }
.close-btn {
  background: none; border: none; font-size: 18px; color: var(--text-muted);
  cursor: pointer; width: 32px; height: 32px; border-radius: 8px;
}
.close-btn:hover { background: var(--bg-hover); }

.modal-body { padding: 14px 16px; overflow-y: auto; }
.count-line { margin: 0 4px 10px; font-size: 13px; color: var(--text-muted); }
.empty { text-align: center; padding: 28px; color: var(--text-muted); }
.log-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.log-row {
  display: flex; align-items: center; gap: 12px;
  padding: 12px; border: 1px solid var(--border-light); border-radius: 12px;
  cursor: pointer; background: var(--bg-card);
}
.log-row:hover { background: var(--bg-hover); border-color: var(--accent); }
.row-emoji {
  width: 40px; height: 40px; border-radius: 12px;
  display: inline-flex; align-items: center; justify-content: center; font-size: 20px; flex-shrink: 0;
}
.row-main { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.row-task { font-weight: 700; color: var(--text-primary); }
.row-zone { font-size: 12.5px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row-edit { color: var(--accent); font-size: 13px; font-weight: 600; white-space: nowrap; }

.modal-foot {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 14px 20px; border-top: 1px solid var(--border-light);
}
.btn-add {
  background: var(--accent-bg); color: var(--accent);
  border: 1px dashed var(--accent); border-radius: 10px;
  padding: 10px 16px; font-weight: 700; cursor: pointer; min-height: 44px;
}
.btn-add:hover { background: var(--accent); color: #fff; }
.btn-ghost {
  background: var(--bg-hover); border: none; border-radius: 10px;
  padding: 10px 16px; color: var(--text-secondary); font-weight: 600; cursor: pointer; min-height: 44px;
}

@media (max-width: 600px) {
  .modal-overlay { align-items: flex-end; padding: 0; }
  .day-modal {
    max-width: 100%; border-radius: 18px 18px 0 0; max-height: 90vh;
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }
}
</style>
