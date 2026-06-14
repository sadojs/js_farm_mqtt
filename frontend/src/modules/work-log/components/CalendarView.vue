<template>
  <div class="work-calendar">
    <!-- 상단 네비 -->
    <div class="cal-toolbar">
      <div class="month-nav">
        <button class="nav-btn" @click="$emit('prev')" aria-label="이전 달">‹</button>
        <span class="month-label">{{ title }}</span>
        <button class="nav-btn" @click="$emit('next')" aria-label="다음 달">›</button>
      </div>
    </div>

    <!-- 작업종류 범례 -->
    <div v-if="topTypes.length" class="legend">
      <span v-for="t in topTypes" :key="t.id" class="legend-item">
        <span class="dot" :style="{ background: t.color }"></span>{{ t.emoji }} {{ t.label }}
      </span>
    </div>

    <!-- 월 그리드 -->
    <div class="grid-head">
      <span v-for="(d, i) in weekdays" :key="d" :class="{ sun: i === 0, sat: i === 6 }">{{ d }}</span>
    </div>
    <div class="grid">
      <div
        v-for="cell in cells"
        :key="cell.date"
        class="cell"
        :class="{ muted: cell.month !== curMonth, today: cell.date === today }"
        @click="$emit('day-click', cell.date)"
        @dragover.prevent
        @drop="onDrop(cell.date)"
      >
        <div class="cell-head">
          <span class="day-num" :class="{ sun: cell.dow === 0, sat: cell.dow === 6 }">{{ cell.day }}</span>
        </div>
        <div class="cell-events">
          <div
            v-for="c in cell.chips.slice(0, 3)"
            :key="c.id"
            class="event-chip"
            :style="{ background: c.color + '22', borderLeftColor: c.color }"
            draggable="true"
            @dragstart="onDragStart(c.id)"
            :title="c.title + ' (드래그로 날짜 이동 · 클릭하면 그 날의 전체 기록)'"
          >
            <span class="chip-text">{{ c.text }}</span>
          </div>
          <span v-if="cell.chips.length > 3" class="more-chip">+{{ cell.chips.length - 3 }}건</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { WorkLog, WorkTaskType } from '../types/work-log.types'
import { todayYmd, ymd } from '../utils/work-log.utils'

const props = defineProps<{
  month: string             // 'YYYY-MM'
  logs: WorkLog[]
  taskTypes: Record<string, WorkTaskType>
  zones: Record<string, { id: string; name: string }>
}>()

const emit = defineEmits<{
  (e: 'prev'): void
  (e: 'next'): void
  (e: 'day-click', date: string): void
  (e: 'move', logId: string, date: string): void
}>()

const weekdays = ['일', '월', '화', '수', '목', '금', '토']
const today = todayYmd()
const curMonth = computed(() => Number(props.month.split('-')[1]))

const title = computed(() => {
  const [y, m] = props.month.split('-').map(Number)
  return `${y}년 ${m}월`
})

const topTypes = computed(() => {
  const used = new Set(props.logs.map((l) => l.taskTypeId))
  const types = Object.values(props.taskTypes).filter((t) => used.has(t.id))
  if (types.length === 0) return Object.values(props.taskTypes).slice(0, 6)
  return types.slice(0, 8)
})

function shortName(name: string): string {
  if (!name) return '?'
  const parts = name.split(/\s+/)
  return parts[parts.length - 1] || name
}

interface Chip { id: string; color: string; text: string; title: string }
interface Cell { date: string; day: number; month: number; dow: number; chips: Chip[] }

const cells = computed<Cell[]>(() => {
  const [y, m] = props.month.split('-').map(Number)
  // 일별 logs (로컬 날짜 기준)
  const byDate: Record<string, WorkLog[]> = {}
  for (const log of props.logs) {
    const key = ymd(new Date(log.doneAt))
    ;(byDate[key] ||= []).push(log)
  }

  // 6주(42칸) 균일 그리드 — 일요일 시작
  const first = new Date(y, m - 1, 1)
  const startDow = first.getDay()
  const out: Cell[] = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(y, m - 1, 1 - startDow + i)
    const key = ymd(d)
    const chips: Chip[] = (byDate[key] || []).map((log) => {
      const t = props.taskTypes[log.taskTypeId]
      const z = props.zones[log.zoneId]
      const color = t?.color || '#94a3b8'
      return {
        id: log.id,
        color,
        text: `${z ? shortName(z.name) : '?'} ${t?.label || '?'}`,
        title: `${z?.name ?? '?'} · ${t?.label ?? '?'}`,
      }
    })
    out.push({ date: key, day: d.getDate(), month: d.getMonth() + 1, dow: d.getDay(), chips })
  }
  return out
})

// ── 드래그앤드롭 (날짜 이동) ──
const dragging = ref<string | null>(null)
function onDragStart(logId: string) {
  dragging.value = logId
}
function onDrop(date: string) {
  if (dragging.value) {
    emit('move', dragging.value, date)
  }
  dragging.value = null
}
</script>

<style scoped>
.work-calendar { display: flex; flex-direction: column; gap: 12px; }
.cal-toolbar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.month-nav {
  display: flex; align-items: center; gap: 8px;
  background: var(--bg-card); border: 1px solid var(--border-card);
  border-radius: 10px; padding: 6px 10px;
}
.nav-btn {
  width: 32px; height: 32px; border: none;
  background: var(--bg-hover); border-radius: 8px;
  color: var(--text-secondary); font-size: 18px; cursor: pointer;
}
.nav-btn:hover { background: var(--border-light); }
.month-label { font-weight: 700; color: var(--text-primary); min-width: 110px; text-align: center; }

.legend { display: flex; gap: 14px; flex-wrap: wrap; padding: 0 4px; }
.legend-item { display: inline-flex; align-items: center; gap: 6px; font-size: var(--font-size-caption); color: var(--text-secondary); font-weight: 600; }
.dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }

.grid-head, .grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 4px;
}
.grid-head span {
  text-align: center; font-size: var(--font-size-caption);
  font-weight: 600; color: var(--text-muted); padding: 4px 0;
}
.grid-head .sun { color: var(--danger); }
.grid-head .sat { color: var(--text-info-banner); }

.cell {
  min-width: 0;
  min-height: 104px;
  background: var(--bg-card);
  border: 1px solid var(--border-light);
  border-radius: 8px;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow: hidden;
  cursor: pointer;
}
.cell:hover { border-color: var(--accent); }
.cell.muted { background: var(--bg-primary); opacity: 0.55; }
.cell.today { border-color: var(--accent); }
.cell-head { display: flex; align-items: center; }
.day-num { font-size: var(--font-size-caption); font-weight: 600; color: var(--text-secondary); font-variant-numeric: tabular-nums; }
.day-num.sun { color: var(--danger); }
.day-num.sat { color: var(--text-info-banner); }

.cell-events { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.event-chip {
  border-left: 3px solid;
  border-radius: 4px;
  padding: 3px 6px;
  cursor: grab;
  font-size: 11px;
  line-height: 1.3;
  min-width: 0;
  overflow: hidden;
}
.event-chip:active { cursor: grabbing; }
.chip-text {
  display: block;
  font-weight: 700;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.more-chip { font-size: 10px; color: var(--text-muted); padding-left: 2px; }

@media (max-width: 768px) {
  .cell { min-height: 72px; padding: 4px; }
  .day-num { font-size: 11px; }
  .event-chip { font-size: 10px; padding: 2px 4px; }
}
</style>
