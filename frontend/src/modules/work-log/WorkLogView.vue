<template>
  <div class="page-container">
    <header class="page-header">
      <div>
        <h2>농작업 일정</h2>
        <p class="page-description">구역별로 어떤 작업을 마지막으로 언제 했는지 한눈에 — 중복·누락 방지</p>
      </div>
      <div class="header-actions">
        <div class="tab-switch">
          <button :class="['tab-btn', { active: tab === 'board' }]" @click="tab = 'board'">상태 보드</button>
          <button :class="['tab-btn', { active: tab === 'calendar' }]" @click="tab = 'calendar'">작업 달력</button>
          <button :class="['tab-btn', { active: tab === 'types' }]" @click="tab = 'types'">작업 종류</button>
        </div>
        <button class="btn-primary" @click="openQuickLog()">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          빠른 기록
        </button>
      </div>
    </header>

    <div v-if="loading" class="empty-state">불러오는 중...</div>
    <template v-else>
      <BoardView
        v-if="tab === 'board'"
        :zones="zones"
        :task-types="visibleTaskTypes"
        :board="boardMap"
        @cell-click="onCellClick"
      />
      <CalendarView
        v-else-if="tab === 'calendar'"
        :task-types="taskTypesById"
        :zones="zonesById"
        :logs="monthLogs"
        :month="currentMonth"
        @prev="changeMonth(-1)"
        @next="changeMonth(1)"
        @day-click="onDayClick"
        @move="onChipMove"
      />
      <TaskTypesManager
        v-else-if="tab === 'types'"
        :task-types="taskTypes"
        :palette="palette"
        :is-admin="isAdmin"
        @add="openAddType()"
        @edit="openEditType($event)"
        @toggle-hidden="onToggleHidden"
        @delete="onDeleteType"
      />
    </template>

    <QuickLogModal
      v-if="showQuick"
      :zones="zones"
      :task-types="visibleTaskTypes"
      :board="boardMap"
      :preset-zone-id="quickPresetZoneId"
      :preset-task-type-id="quickPresetTaskTypeId"
      :preset-date="quickPresetDate"
      @close="showQuick = false"
      @saved="onLogSaved"
    />

    <DayLogsModal
      v-if="showDay"
      :date="dayDate"
      :logs="dayLogs"
      :task-types="taskTypesById"
      :zones="zonesById"
      @close="showDay = false"
      @edit="onDayEdit"
      @add="onDayAdd"
    />

    <AddTaskTypeModal
      v-if="showTypeModal"
      :palette="palette"
      :initial="editingType"
      @close="closeTypeModal"
      @saved="onTypeSaved"
    />

    <EditLogModal
      v-if="showEdit && editingLog"
      :log="editingLog"
      :zones="zones"
      :task-types="visibleTaskTypes"
      @close="showEdit = false; editingLog = null"
      @saved="onLogEdited"
      @deleted="onLogEdited"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { workLogApi } from './api/work-log.api'
import type { BoardCell, Palette, WorkLog, WorkTaskType } from './types/work-log.types'
import { useGroupStore } from '@/stores/group.store'
import { useAuthStore } from '@/stores/auth.store'
import BoardView from './components/BoardView.vue'
import CalendarView from './components/CalendarView.vue'
import TaskTypesManager from './components/TaskTypesManager.vue'
import QuickLogModal from './components/QuickLogModal.vue'
import AddTaskTypeModal from './components/AddTaskTypeModal.vue'
import EditLogModal from './components/EditLogModal.vue'
import DayLogsModal from './components/DayLogsModal.vue'
import { todayYmd, ymd } from './utils/work-log.utils'

const groupStore = useGroupStore()
const authStore = useAuthStore()
const tab = ref<'board' | 'calendar' | 'types'>('board')
const loading = ref(true)

const taskTypes = ref<WorkTaskType[]>([])
const board = ref<BoardCell[]>([])
const monthLogs = ref<WorkLog[]>([])
const palette = ref<Palette>({ emoji: [], color: [] })
const currentMonth = ref(todayYmd().slice(0, 7))

const showQuick = ref(false)
const quickPresetZoneId = ref<string | null>(null)
const quickPresetTaskTypeId = ref<string | null>(null)
const quickPresetDate = ref<string | null>(null)

const showDay = ref(false)
const dayDate = ref<string>(todayYmd())

const showTypeModal = ref(false)
const editingType = ref<WorkTaskType | null>(null)

const showEdit = ref(false)
const editingLog = ref<WorkLog | null>(null)

const isAdmin = computed(() => authStore.user?.role !== 'farm_user')
const zones = computed(() => groupStore.groups)
const zonesById = computed(() => Object.fromEntries(zones.value.map(z => [z.id, z])))
const visibleTaskTypes = computed(() => taskTypes.value.filter(t => !t.hidden))
const taskTypesById = computed(() => Object.fromEntries(taskTypes.value.map(t => [t.id, t])))
const boardMap = computed(() => {
  const m: Record<string, BoardCell> = {}
  for (const c of board.value) m[`${c.zoneId}:${c.taskTypeId}`] = c
  return m
})

async function loadAll() {
  loading.value = true
  try {
    await groupStore.fetchGroups()
    const [tt, bd, p] = await Promise.all([
      workLogApi.listTaskTypes(),
      workLogApi.board(),
      workLogApi.palette(),
    ])
    taskTypes.value = tt.data
    board.value = bd.data
    palette.value = p.data
    await loadMonth(currentMonth.value)
  } finally {
    loading.value = false
  }
}

async function loadMonth(month: string) {
  const res = await workLogApi.listByMonth(month)
  monthLogs.value = res.data
}

function changeMonth(delta: number) {
  const [y, m] = currentMonth.value.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  currentMonth.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  loadMonth(currentMonth.value)
}

const dayLogs = computed(() =>
  monthLogs.value.filter((l) => ymd(new Date(l.doneAt)) === dayDate.value),
)

function openQuickLog(zoneId?: string, taskTypeId?: string, date?: string) {
  quickPresetZoneId.value = zoneId ?? null
  quickPresetTaskTypeId.value = taskTypeId ?? null
  quickPresetDate.value = date ?? null
  showQuick.value = true
}

// 달력 날짜(셀) 클릭 → 그 날의 모든 작업 목록 모달
function onDayClick(date: string) {
  dayDate.value = date
  showDay.value = true
}
function onDayEdit(log: WorkLog) {
  showDay.value = false
  editingLog.value = log
  showEdit.value = true
}
function onDayAdd(date: string) {
  showDay.value = false
  openQuickLog(undefined, undefined, date)
}

async function onCellClick(zoneId: string, taskTypeId: string) {
  // 기존 기록이 있는 칸 → 가장 최근 기록 수정, 없으면 빠른 기록(오늘)
  const cell = boardMap.value[`${zoneId}:${taskTypeId}`]
  if (cell?.lastDoneAt) {
    try {
      const res = await workLogApi.listLogs({ zoneId, taskTypeId, limit: 1 })
      if (res.data.length) {
        editingLog.value = res.data[0]
        showEdit.value = true
        return
      }
    } catch {
      /* 조회 실패 시 빠른 기록으로 폴백 */
    }
  }
  openQuickLog(zoneId, taskTypeId)
}

/** 달력 드래그앤드롭 — 기록을 다른 날짜로 이동 */
async function onChipMove(logId: string, date: string) {
  const log = monthLogs.value.find((l) => l.id === logId)
  if (!log || ymd(new Date(log.doneAt)) === date) return
  try {
    const [y, m, d] = date.split('-').map(Number)
    const doneAt = new Date(y, m - 1, d, 12, 0, 0).toISOString()
    await workLogApi.updateLog(logId, { doneAt })
    await refreshAfterLog()
  } catch (err: any) {
    alert(err.response?.data?.message || '날짜 이동에 실패했습니다.')
  }
}

async function refreshAfterLog() {
  const [bd] = await Promise.all([workLogApi.board(), loadMonth(currentMonth.value)])
  board.value = bd.data
}

async function onLogSaved() {
  showQuick.value = false
  await refreshAfterLog()
}

async function onLogEdited() {
  showEdit.value = false
  editingLog.value = null
  await refreshAfterLog()
}

function openAddType() {
  editingType.value = null
  showTypeModal.value = true
}
function openEditType(t: WorkTaskType) {
  editingType.value = t
  showTypeModal.value = true
}
function closeTypeModal() {
  showTypeModal.value = false
  editingType.value = null
}
async function onTypeSaved() {
  closeTypeModal()
  const tt = await workLogApi.listTaskTypes()
  taskTypes.value = tt.data
}

async function onToggleHidden(t: WorkTaskType) {
  await workLogApi.toggleHidden(t.id, !t.hidden)
  const tt = await workLogApi.listTaskTypes()
  taskTypes.value = tt.data
}

async function onDeleteType(t: WorkTaskType) {
  if (!confirm(`"${t.label}" 작업 종류를 삭제하시겠습니까? 표준 작업은 숨김 처리됩니다.`)) return
  try {
    await workLogApi.deleteTaskType(t.id)
    const tt = await workLogApi.listTaskTypes()
    taskTypes.value = tt.data
  } catch (err: any) {
    alert(err.response?.data?.message || '삭제 실패')
  }
}

onMounted(loadAll)
</script>

<style scoped>
.page-container { padding: 24px; max-width: 1400px; margin: 0 auto; }
.page-header {
  display: flex; align-items: flex-start; justify-content: space-between;
  margin-bottom: 20px; gap: 12px; flex-wrap: wrap;
}
.page-header h2 { font-size: calc(28px * var(--content-scale, 1)); font-weight: 700; color: var(--text-primary); margin: 0; }
.page-description { color: var(--text-secondary); font-size: calc(14px * var(--content-scale, 1)); margin: 4px 0 0; }
.header-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }

.tab-switch {
  display: inline-flex;
  background: var(--bg-hover);
  border-radius: 10px;
  padding: 3px;
  border: 1px solid var(--border-light);
}
.tab-btn {
  padding: 7px 14px;
  font-size: 13px;
  font-weight: 600;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: 7px;
  transition: background 0.15s, color 0.15s;
}
.tab-btn.active { background: var(--bg-card); color: var(--text-primary); box-shadow: 0 1px 2px rgba(0,0,0,0.05); }

.btn-primary {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 9px 16px;
  background: var(--accent); color: #fff;
  border: none; border-radius: 10px;
  font-size: 14px; font-weight: 600; cursor: pointer;
}
.btn-primary:hover { background: var(--accent-hover); }

.empty-state {
  padding: 48px;
  text-align: center;
  color: var(--text-secondary);
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: 14px;
}

@media (max-width: 768px) {
  .page-container { padding: 4px 0; }
  .header-actions { width: 100%; }
  .tab-switch { flex: 1; }
  .tab-btn { flex: 1; padding: 9px 8px; }
}
</style>
