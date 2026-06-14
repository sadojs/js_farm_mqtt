<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="edit-modal">
      <div class="modal-head">
        <div class="head-title">
          <span class="head-emoji" :style="{ background: currentColor + '22' }">{{ currentEmoji }}</span>
          <div>
            <h3>작업 기록 수정</h3>
            <p class="head-sub">잘못 입력했거나 날짜를 옮길 때</p>
          </div>
        </div>
        <button class="close-btn" @click="$emit('close')" aria-label="닫기">✕</button>
      </div>

      <div class="modal-body">
        <!-- 날짜 -->
        <div class="field">
          <label>날짜</label>
          <div class="date-row">
            <input v-model="date" type="date" class="inp date-inp" />
            <button type="button" class="quick-btn" :class="{ on: date === yesterday }" @click="date = yesterday">어제</button>
            <button type="button" class="quick-btn" :class="{ on: date === today }" @click="date = today">오늘</button>
          </div>
        </div>

        <div class="grid2">
          <!-- 구역 -->
          <div class="field">
            <label>구역</label>
            <select v-model="zoneId" class="inp">
              <option v-for="z in zones" :key="z.id" :value="z.id">{{ z.name }}</option>
            </select>
          </div>
          <!-- 작업 종류 -->
          <div class="field">
            <label>작업 종류</label>
            <select v-model="taskTypeId" class="inp">
              <option v-for="t in taskTypes" :key="t.id" :value="t.id">{{ t.emoji }} {{ t.label }}</option>
            </select>
          </div>
        </div>

        <!-- 메모 -->
        <div class="field">
          <label>메모 <span class="opt">(선택)</span></label>
          <input v-model="note" type="text" class="inp" maxlength="500" placeholder="예: 15kg" />
        </div>
      </div>

      <div class="modal-foot">
        <button class="btn-delete" :disabled="busy" @click="onDelete">🗑 삭제</button>
        <div class="foot-right">
          <button class="btn-ghost" :disabled="busy" @click="$emit('close')">취소</button>
          <button class="btn-save" :disabled="busy" @click="onSave">{{ busy ? '저장 중…' : '저장' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { workLogApi } from '../api/work-log.api'
import type { WorkLog, WorkTaskType } from '../types/work-log.types'

const props = defineProps<{
  log: WorkLog
  zones: Array<{ id: string; name: string }>
  taskTypes: WorkTaskType[]
}>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'saved'): void; (e: 'deleted'): void }>()

function pad(n: number) { return String(n).padStart(2, '0') }
function localYmd(d: Date) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }

const today = localYmd(new Date())
const yesterday = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return localYmd(d) })()

const date = ref(localYmd(new Date(props.log.doneAt)))
const zoneId = ref(props.log.zoneId)
const taskTypeId = ref(props.log.taskTypeId)
const note = ref(props.log.note ?? '')
const busy = ref(false)

const currentType = computed(() => props.taskTypes.find((t) => t.id === taskTypeId.value))
const currentEmoji = computed(() => currentType.value?.emoji ?? '📝')
const currentColor = computed(() => currentType.value?.color ?? '#43a047')

async function onSave() {
  busy.value = true
  try {
    const [y, m, d] = date.value.split('-').map(Number)
    // 정오로 고정 → 시간대 경계 날짜 밀림 방지
    const doneAt = new Date(y, m - 1, d, 12, 0, 0).toISOString()
    await workLogApi.updateLog(props.log.id, {
      zoneId: zoneId.value,
      taskTypeId: taskTypeId.value,
      doneAt,
      note: note.value,
    })
    emit('saved')
  } catch (err: any) {
    alert(err.response?.data?.message || '저장에 실패했습니다.')
  } finally {
    busy.value = false
  }
}

async function onDelete() {
  if (!confirm('이 기록을 삭제하시겠습니까?')) return
  busy.value = true
  try {
    await workLogApi.deleteLog(props.log.id)
    emit('deleted')
  } catch (err: any) {
    alert(err.response?.data?.message || '삭제에 실패했습니다.')
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.modal-overlay {
  position: fixed; inset: 0;
  background: var(--overlay);
  display: flex; align-items: center; justify-content: center;
  z-index: 1000; padding: 16px;
}
.edit-modal {
  background: var(--bg-card);
  border-radius: 16px;
  width: 100%; max-width: 520px;
  box-shadow: var(--shadow-modal);
  display: flex; flex-direction: column;
  max-height: 90vh;
}
.modal-head {
  display: flex; align-items: flex-start; justify-content: space-between;
  padding: 18px 20px; border-bottom: 1px solid var(--border-light);
}
.head-title { display: flex; align-items: center; gap: 12px; }
.head-emoji {
  width: 40px; height: 40px; border-radius: 12px;
  display: inline-flex; align-items: center; justify-content: center; font-size: 22px;
}
.modal-head h3 { margin: 0; font-size: 18px; font-weight: 700; color: var(--text-primary); }
.head-sub { margin: 2px 0 0; font-size: 12.5px; color: var(--text-muted); }
.close-btn {
  background: none; border: none; font-size: 18px; color: var(--text-muted);
  cursor: pointer; width: 32px; height: 32px; border-radius: 8px;
}
.close-btn:hover { background: var(--bg-hover); }

.modal-body { padding: 16px 20px; overflow-y: auto; display: flex; flex-direction: column; gap: 14px; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field label { font-size: 13px; font-weight: 600; color: var(--text-secondary); }
.opt { color: var(--text-muted); font-weight: 400; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.inp {
  width: 100%; box-sizing: border-box;
  padding: 10px 12px;
  border: 1px solid var(--border-input); border-radius: 10px;
  background: var(--bg-input); color: var(--text-primary);
  font-size: 14px; min-width: 0;
}
.inp:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.date-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.date-inp { flex: 1 1 160px; }
.quick-btn {
  padding: 9px 14px; border: 1px solid var(--border-input); border-radius: 10px;
  background: var(--bg-input); color: var(--text-secondary);
  font-weight: 600; font-size: 13px; cursor: pointer; min-height: 40px;
}
.quick-btn.on { border-color: var(--accent); background: var(--accent-bg); color: var(--accent); }

.modal-foot {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 14px 20px; border-top: 1px solid var(--border-light); flex-wrap: wrap;
}
.foot-right { display: flex; align-items: center; gap: 8px; margin-left: auto; }
.btn-delete {
  border: 1px solid var(--danger); background: var(--danger-bg); color: var(--danger);
  border-radius: 10px; padding: 10px 16px; font-weight: 700; cursor: pointer; min-height: 44px;
}
.btn-delete:hover { background: var(--danger); color: #fff; }
.btn-ghost {
  background: var(--bg-hover); border: none; border-radius: 10px;
  padding: 10px 16px; color: var(--text-secondary); font-weight: 600; cursor: pointer; min-height: 44px;
}
.btn-save {
  background: var(--accent); color: #fff; border: none; border-radius: 10px;
  padding: 10px 22px; font-weight: 700; cursor: pointer; min-height: 44px;
}
.btn-save:hover { background: var(--accent-hover); }
.btn-save:disabled, .btn-delete:disabled { opacity: 0.6; cursor: default; }

@media (max-width: 600px) {
  .modal-overlay { align-items: flex-end; padding: 0; }
  .edit-modal {
    max-width: 100%; border-radius: 18px 18px 0 0; max-height: 92vh;
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }
  .grid2 { grid-template-columns: 1fr; }
}
</style>
