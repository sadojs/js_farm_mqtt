<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal-card">
      <div class="modal-header">
        <h3>빠른 기록</h3>
        <button class="modal-close" @click="$emit('close')" aria-label="닫기">&times;</button>
      </div>
      <div class="modal-body">
        <!-- Step 1: 구역 -->
        <div class="step">
          <div class="step-title">① 구역 선택</div>
          <div class="zone-grid">
            <button
              v-for="z in zones"
              :key="z.id"
              type="button"
              :class="['zone-card', { selected: zoneId === z.id }]"
              @click="zoneId = z.id"
            >{{ z.name }}</button>
          </div>
        </div>

        <!-- Step 2: 작업 -->
        <div class="step">
          <div class="step-title">② 작업 선택</div>
          <div class="task-grid">
            <button
              v-for="t in taskTypes"
              :key="t.id"
              type="button"
              :class="['task-card', { selected: taskTypeId === t.id }]"
              :style="{ borderColor: taskTypeId === t.id ? t.color : 'transparent', background: taskTypeId === t.id ? t.color + '18' : 'var(--bg-secondary, var(--bg-hover))' }"
              @click="taskTypeId = t.id"
            >
              <span class="task-emoji-big" :style="{ background: t.color + '22' }">{{ t.emoji }}</span>
              <span class="task-name">{{ t.label }}</span>
              <span class="task-last">{{ lastForType(t.id) }}</span>
            </button>
          </div>
        </div>

        <!-- Step 3: 메모 (선택) -->
        <div class="step">
          <div class="step-title">③ 메모 <span class="opt">(선택)</span></div>
          <input v-model="note" type="text" maxlength="200" placeholder="예: 1열 절반 완료" class="form-input" />
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-ghost" @click="$emit('close')">취소</button>
        <button class="btn-primary" :disabled="!canSave || saving" @click="save">
          ✓ {{ saving ? '저장 중...' : '기록하기' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { workLogApi } from '../api/work-log.api'
import type { BoardCell, WorkTaskType } from '../types/work-log.types'
import { elapsedDays } from '../utils/work-log.utils'

const props = defineProps<{
  zones: Array<{ id: string; name: string }>
  taskTypes: WorkTaskType[]
  board: Record<string, BoardCell>
  presetZoneId?: string | null
  presetTaskTypeId?: string | null
  presetDate?: string | null
}>()

const emit = defineEmits<{ (e: 'close'): void; (e: 'saved'): void }>()

const zoneId = ref<string | null>(props.presetZoneId ?? null)
const taskTypeId = ref<string | null>(props.presetTaskTypeId ?? null)
const note = ref('')
const saving = ref(false)

const canSave = computed(() => !!zoneId.value && !!taskTypeId.value)

function lastForType(taskId: string): string {
  if (!zoneId.value) return ''
  const cell = props.board[`${zoneId.value}:${taskId}`]
  if (!cell) return '미실시'
  const d = elapsedDays(cell.lastDoneAt)
  return d == null ? '미실시' : `지난 기록 ${d}일 전`
}

async function save() {
  if (!canSave.value) return
  saving.value = true
  try {
    // 특정 날짜 지정 시 정오로 고정(없으면 서버 now())
    let doneAt: string | undefined
    if (props.presetDate) {
      const [y, m, d] = props.presetDate.split('-').map(Number)
      doneAt = new Date(y, m - 1, d, 12, 0, 0).toISOString()
    }
    await workLogApi.createLog({
      zoneId: zoneId.value!,
      taskTypeId: taskTypeId.value!,
      note: note.value.trim() || undefined,
      doneAt,
    })
    emit('saved')
  } catch (err: any) {
    alert(err.response?.data?.message || '저장 실패')
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.modal-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.5);
  display: flex; align-items: center; justify-content: center;
  z-index: 1000; padding: 20px;
}
.modal-card {
  background: var(--bg-card);
  border-radius: 16px;
  max-width: 560px;
  width: 100%;
  border: 1px solid var(--border-card);
  max-height: 90vh;
  display: flex; flex-direction: column;
}
.modal-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 18px 22px;
  border-bottom: 1px solid var(--border-light);
}
.modal-header h3 { margin: 0; font-size: 18px; color: var(--text-primary); font-weight: 700; }
.modal-close {
  background: none; border: none;
  font-size: 24px; cursor: pointer;
  color: var(--text-muted); line-height: 1;
}
.modal-body {
  padding: 20px 22px;
  overflow-y: auto;
  display: flex; flex-direction: column; gap: 20px;
}

.step-title { font-size: 14px; font-weight: 700; color: var(--text-secondary); margin-bottom: 10px; }
.opt { font-weight: 400; color: var(--text-muted); }

.zone-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 8px;
}
.zone-card {
  padding: 14px;
  background: var(--bg-secondary, var(--bg-hover));
  border: 2px solid transparent;
  border-radius: 10px;
  font-size: 14px; font-weight: 700;
  color: var(--text-primary);
  cursor: pointer;
  text-align: center;
  min-height: 44px;
}
.zone-card.selected {
  background: var(--accent-bg);
  border-color: var(--accent);
  color: var(--accent);
}

.task-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}
.task-card {
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  padding: 14px 10px;
  border: 2px solid transparent;
  border-radius: 12px;
  cursor: pointer;
  min-height: 88px;
}
.task-emoji-big {
  display: inline-flex; align-items: center; justify-content: center;
  width: 44px; height: 44px;
  border-radius: 50%;
  font-size: 22px;
}
.task-name { font-size: 13px; font-weight: 700; color: var(--text-primary); }
.task-last { font-size: 11px; color: var(--text-muted); }

.form-input {
  width: 100%; padding: 10px 12px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-secondary, var(--bg-card));
  color: var(--text-primary); font-size: 14px;
  box-sizing: border-box;
}
.form-input:focus { outline: none; border-color: var(--accent); }

.modal-footer {
  display: flex; justify-content: flex-end; gap: 8px;
  padding: 16px 22px;
  border-top: 1px solid var(--border-light);
}
.btn-ghost, .btn-primary {
  padding: 12px 20px;
  border-radius: 10px;
  font-size: 14px; font-weight: 600;
  cursor: pointer;
  border: 1px solid transparent;
}
.btn-ghost {
  background: transparent; color: var(--text-primary);
  border-color: var(--border-color);
}
.btn-primary {
  background: var(--accent); color: #fff; border: none;
}
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

@media (max-width: 768px) {
  .zone-grid, .task-grid { grid-template-columns: 1fr 1fr; }
}
</style>
