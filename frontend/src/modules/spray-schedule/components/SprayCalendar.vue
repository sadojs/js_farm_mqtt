<template>
  <div class="spray-calendar">
    <!-- 상단 컨트롤 -->
    <div class="cal-toolbar">
      <div class="month-nav">
        <button class="nav-btn" @click="shiftMonth(-1)" aria-label="이전 달">‹</button>
        <span class="month-label">{{ year }}년 {{ month }}월</span>
        <button class="nav-btn" @click="shiftMonth(1)" aria-label="다음 달">›</button>
      </div>

      <div class="zone-filter">
        <button
          class="chip"
          :class="{ active: activeZone === 'all' }"
          @click="activeZone = 'all'"
        >전체 구역</button>
        <button
          v-for="z in markers"
          :key="z.id"
          class="chip"
          :class="{ active: activeZone === z.id }"
          @click="activeZone = z.id"
        >
          <span class="dot" :style="{ background: z.color }"></span>{{ z.name }}
        </button>
      </div>

      <button class="btn-add-single" @click="$emit('add-single', monthFirst)">+ 단건 일정 추가</button>
    </div>

    <!-- 약종 범례 -->
    <div v-if="legend.length" class="legend">
      <span v-for="l in legend" :key="l.pest" class="legend-item">
        <span class="dot" :style="{ background: l.color }"></span>{{ l.pest }}
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
        :class="{ muted: cell.month !== month, today: cell.date === today }"
        @dragover.prevent
        @drop="onDrop(cell.date)"
      >
        <div class="cell-head">
          <span class="day-num" :class="{ sun: cell.dow === 0, sat: cell.dow === 6 }">{{ cell.day }}</span>
          <span
            v-for="m in markersOn(cell.date)"
            :key="m.id"
            class="plant-badge"
            :style="{ background: m.color }"
          >{{ m.name }} 정식</span>
        </div>
        <div class="cell-events">
          <div
            v-for="ev in eventsOn(cell.date)"
            :key="ev.id"
            class="event-chip"
            :style="{ background: tint(ev.color), borderLeftColor: ev.zoneColor || ev.color || '#888' }"
            draggable="true"
            @dragstart="onDragStart(ev)"
            @click="$emit('select', ev)"
            :title="chipTitle(ev)"
          >
            <span class="chip-line1">
              <span v-if="ev.isManual" class="manual-mark">✚</span>
              {{ zoneAbbr(ev) }} · {{ ev.pest }} <template v-if="!ev.isManual">{{ ev.round }}차</template>
            </span>
            <span class="chip-line2">{{ ev.product }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { SprayEvent, ZoneMarker } from '../types/spray-schedule.types'
import {
  monthGrid,
  parseDate,
  todayStr,
  shortDate,
  fmt,
} from '../utils/spray-schedule.utils'

const props = defineProps<{
  events: SprayEvent[]
  markers: ZoneMarker[]
  initialDate?: string
}>()
const emit = defineEmits<{
  (e: 'move', ev: SprayEvent, date: string): void
  (e: 'select', ev: SprayEvent): void
  (e: 'add-single', date: string): void
}>()

const weekdays = ['일', '월', '화', '수', '목', '금', '토']
const today = todayStr()

const cursor = ref(props.initialDate ? parseDate(props.initialDate) : new Date())
const year = computed(() => cursor.value.getUTCFullYear())
const month = computed(() => cursor.value.getUTCMonth() + 1)
const monthFirst = computed(() => fmt(new Date(Date.UTC(year.value, month.value - 1, 1))))
const activeZone = ref<string>('all')

const markers = computed(() => props.markers)

const cells = computed(() =>
  monthGrid(year.value, month.value).map((date) => {
    const d = parseDate(date)
    return {
      date,
      day: d.getUTCDate(),
      month: d.getUTCMonth() + 1,
      dow: d.getUTCDay(),
    }
  }),
)

const filteredEvents = computed(() =>
  activeZone.value === 'all'
    ? props.events
    : props.events.filter((e) => e.zoneId === activeZone.value),
)

const legend = computed(() => {
  const map = new Map<string, string>()
  for (const e of filteredEvents.value) {
    if (e.pest && !map.has(e.pest)) map.set(e.pest, e.color || '#888')
  }
  return [...map.entries()].map(([pest, color]) => ({ pest, color }))
})

function eventsOn(date: string): SprayEvent[] {
  return filteredEvents.value.filter((e) => e.date.slice(0, 10) === date)
}
function markersOn(date: string): ZoneMarker[] {
  const list = activeZone.value === 'all'
    ? props.markers
    : props.markers.filter((m) => m.id === activeZone.value)
  return list.filter((m) => m.transplantDate.slice(0, 10) === date)
}

function shiftMonth(delta: number) {
  cursor.value = new Date(Date.UTC(year.value, month.value - 1 + delta, 1))
}

function zoneAbbr(ev: SprayEvent): string {
  return ev.zoneName ?? ''
}
function chipTitle(ev: SprayEvent): string {
  return `${ev.zoneName ?? ''} · ${ev.pest ?? ''} ${ev.isManual ? '(단건)' : ev.round + '차'} · ${ev.product ?? ''} · ${shortDate(ev.date)}`
}
function tint(hex: string | null): string {
  return hex ? `${hex}1f` : 'var(--bg-hover)'
}

// 드래그
const dragging = ref<SprayEvent | null>(null)
function onDragStart(ev: SprayEvent) {
  dragging.value = ev
}
function onDrop(date: string) {
  if (dragging.value && dragging.value.date.slice(0, 10) !== date) {
    emit('move', dragging.value, date)
  }
  dragging.value = null
}
</script>

<style scoped>
.spray-calendar { display: flex; flex-direction: column; gap: 12px; }
.cal-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.month-nav {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: 10px;
  padding: 6px 10px;
}
.nav-btn {
  width: 32px;
  height: 32px;
  border: none;
  background: var(--bg-hover);
  border-radius: 8px;
  color: var(--text-secondary);
  font-size: 18px;
  cursor: pointer;
}
.month-label { font-weight: 700; color: var(--text-primary); min-width: 110px; text-align: center; }
.zone-filter { display: flex; gap: 6px; flex-wrap: wrap; }
.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--border-input);
  background: var(--bg-card);
  color: var(--text-secondary);
  border-radius: 20px;
  padding: 6px 12px;
  cursor: pointer;
  font-size: var(--font-size-caption);
  font-weight: 600;
}
.chip.active { border-color: var(--accent); background: var(--accent-bg); color: var(--accent); }
.dot { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
.btn-add-single {
  margin-left: auto;
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 9px 16px;
  font-weight: 600;
  cursor: pointer;
}
.btn-add-single:hover { background: var(--accent-hover); }
.legend { display: flex; gap: 14px; flex-wrap: wrap; padding: 0 4px; }
.legend-item { display: inline-flex; align-items: center; gap: 6px; font-size: var(--font-size-caption); color: var(--text-secondary); }
.grid-head {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 4px;
}
.grid-head span {
  text-align: center;
  font-size: var(--font-size-caption);
  font-weight: 600;
  color: var(--text-muted);
  padding: 4px 0;
}
.grid-head .sun { color: var(--danger); }
.grid-head .sat { color: var(--text-info-banner); }
.grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 4px;
}
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
}
.cell.muted { background: var(--bg-primary); opacity: 0.6; }
.cell.today { border-color: var(--accent); }
.cell-head { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.day-num { font-size: var(--font-size-caption); font-weight: 600; color: var(--text-secondary); font-variant-numeric: tabular-nums; }
.day-num.sun { color: var(--danger); }
.day-num.sat { color: var(--text-info-banner); }
.plant-badge {
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  border-radius: 6px;
  padding: 1px 6px;
  margin-left: auto;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
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
.chip-line1 { display: block; font-weight: 700; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chip-line2 { display: block; color: var(--text-secondary); font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.manual-mark { color: var(--accent); font-weight: 700; }
@media (max-width: 768px) {
  .cell { min-height: 64px; padding: 4px; }
  .btn-add-single { margin-left: 0; }
  .cal-toolbar { gap: 8px; }
  .day-num { font-size: 11px; }
  .plant-badge { font-size: 9px; padding: 1px 4px; }
  .event-chip { font-size: 10px; padding: 2px 4px; }
}
</style>
