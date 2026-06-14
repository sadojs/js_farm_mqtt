<template>
  <div class="calendar-wrap">
    <div class="cal-header">
      <button class="nav-btn" @click="$emit('prev')">‹</button>
      <h3>{{ title }}</h3>
      <button class="nav-btn" @click="$emit('next')">›</button>
    </div>

    <div class="legend">
      <span v-for="t in topTypes" :key="t.id" class="legend-item">
        <span class="dot" :style="{ background: t.color }"></span>
        {{ t.emoji }} {{ t.label }}
      </span>
    </div>

    <div class="cal-grid">
      <div v-for="d in ['일','월','화','수','목','금','토']" :key="d" class="dow">{{ d }}</div>
      <div
        v-for="(cell, idx) in cells"
        :key="idx"
        :class="['day-cell', { other: !cell.inMonth, today: cell.isToday, blank: cell.day === 0 }]"
      >
        <template v-if="cell.day > 0">
          <div class="day-num">{{ cell.day }}</div>
          <div class="chips">
            <span
              v-for="c in cell.chips.slice(0, 3)"
              :key="c.id"
              class="day-chip"
              :style="{ background: c.color + '22', color: c.color }"
              :title="c.title + ' (클릭하여 수정)'"
              @click="$emit('chip-click', c.id)"
            >
              <span class="chip-dot" :style="{ background: c.color }"></span>
              <span>{{ c.text }}</span>
            </span>
            <span v-if="cell.chips.length > 3" class="more-chip">+{{ cell.chips.length - 3 }}건</span>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { WorkLog, WorkTaskType } from '../types/work-log.types'
import { todayYmd } from '../utils/work-log.utils'

const props = defineProps<{
  month: string             // 'YYYY-MM'
  logs: WorkLog[]
  taskTypes: Record<string, WorkTaskType>
  zones: Record<string, { id: string; name: string }>
}>()

defineEmits<{ (e: 'prev'): void; (e: 'next'): void; (e: 'chip-click', logId: string): void }>()

const title = computed(() => {
  const [y, m] = props.month.split('-').map(Number)
  return `${y}년 ${m}월`
})

const topTypes = computed(() => {
  // 사용된 타입 + 표준 우선
  const used = new Set(props.logs.map(l => l.taskTypeId))
  const types = Object.values(props.taskTypes).filter(t => used.has(t.id))
  if (types.length === 0) return Object.values(props.taskTypes).slice(0, 6)
  return types.slice(0, 8)
})

interface DayCell {
  day: number
  inMonth: boolean
  isToday: boolean
  chips: { id: string; color: string; text: string; title: string }[]
}

const cells = computed<DayCell[]>(() => {
  const [y, m] = props.month.split('-').map(Number)
  const first = new Date(y, m - 1, 1)
  const lastDay = new Date(y, m, 0).getDate()
  const startWeekday = first.getDay()
  const today = todayYmd()
  const todayYM = today.slice(0, 7)
  const todayD = Number(today.slice(8))

  // 일별 logs
  const byDay: Record<number, WorkLog[]> = {}
  for (const log of props.logs) {
    const d = new Date(log.doneAt)
    if (d.getFullYear() === y && d.getMonth() === m - 1) {
      const dn = d.getDate()
      if (!byDay[dn]) byDay[dn] = []
      byDay[dn].push(log)
    }
  }

  const result: DayCell[] = []
  for (let i = 0; i < startWeekday; i++) {
    result.push({ day: 0, inMonth: false, isToday: false, chips: [] })
  }
  for (let d = 1; d <= lastDay; d++) {
    const dayLogs = byDay[d] || []
    const chips = dayLogs.map(log => {
      const t = props.taskTypes[log.taskTypeId]
      const z = props.zones[log.zoneId]
      const zoneShort = z ? shortName(z.name) : '?'
      const taskLabel = t?.label || '?'
      const color = t?.color || '#94a3b8'
      return {
        id: log.id,
        color,
        text: `${zoneShort} ${taskLabel}`,
        title: `${z?.name ?? '?'} · ${taskLabel}`,
      }
    })
    result.push({
      day: d,
      inMonth: true,
      isToday: props.month === todayYM && d === todayD,
      chips,
    })
  }
  // 6주 채우기
  while (result.length % 7 !== 0) result.push({ day: 0, inMonth: false, isToday: false, chips: [] })
  return result
})

function shortName(name: string): string {
  if (!name) return '?'
  // "석문리 1호" → "1호", "둔내 A동" → "A동"
  const parts = name.split(/\s+/)
  return parts[parts.length - 1] || name
}
</script>

<style scoped>
.calendar-wrap {
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: 14px;
  padding: 18px;
  box-shadow: var(--shadow-card);
}

.cal-header {
  display: flex; align-items: center; justify-content: center; gap: 16px;
  margin-bottom: 12px;
}
.cal-header h3 { margin: 0; font-size: 18px; font-weight: 700; color: var(--text-primary); }
.nav-btn {
  width: 32px; height: 32px;
  border: 1px solid var(--border-color);
  background: transparent; color: var(--text-primary);
  border-radius: 8px;
  font-size: 18px;
  cursor: pointer;
}
.nav-btn:hover { background: var(--bg-hover); }

.legend {
  display: flex; flex-wrap: wrap; gap: 10px;
  padding: 10px 0;
  border-bottom: 1px solid var(--border-light);
  margin-bottom: 12px;
}
.legend-item {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 12px; color: var(--text-secondary); font-weight: 600;
}
.dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }

.cal-grid {
  display: grid; grid-template-columns: repeat(7, 1fr);
  gap: 0;
  border: 1px solid var(--border-light);
  border-radius: 10px;
  overflow: hidden;
}
.dow {
  background: var(--bg-hover);
  text-align: center;
  padding: 8px;
  font-size: 12px; font-weight: 700;
  color: var(--text-secondary);
  border-bottom: 1px solid var(--border-light);
}
.day-cell {
  min-height: 92px;
  padding: 6px 8px;
  border-right: 1px solid var(--border-light);
  border-bottom: 1px solid var(--border-light);
  background: var(--bg-card);
}
.day-cell:nth-child(7n) { border-right: none; }
.day-cell.blank { background: var(--bg-hover); opacity: 0.4; }
.day-cell.today { background: var(--accent-bg); }
.day-num { font-size: 12px; font-weight: 700; color: var(--text-primary); margin-bottom: 4px; font-variant-numeric: tabular-nums; }
.day-cell.today .day-num { color: var(--accent); }

.chips { display: flex; flex-direction: column; gap: 3px; }
.day-chip {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 6px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
}
.day-chip:hover { filter: brightness(0.95); }
.chip-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.more-chip {
  display: inline-block;
  padding: 2px 6px;
  font-size: 10px;
  color: var(--text-muted);
}

@media (max-width: 768px) {
  .day-cell { min-height: 64px; padding: 4px; }
  .day-chip { font-size: 10px; padding: 1px 4px; }
}
</style>
