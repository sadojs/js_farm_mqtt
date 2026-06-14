<template>
  <div class="board-wrap">
    <div class="legend">
      <span class="legend-title">마지막 작업 경과</span>
      <span class="legend-chip" :style="{ background: TONE_COLORS.fresh.bg, color: TONE_COLORS.fresh.text }">0~2일</span>
      <span class="legend-chip" :style="{ background: TONE_COLORS.mild.bg, color: TONE_COLORS.mild.text }">~7일</span>
      <span class="legend-chip" :style="{ background: TONE_COLORS.amber.bg, color: TONE_COLORS.amber.text }">~14일</span>
      <span class="legend-chip" :style="{ background: TONE_COLORS.red.bg, color: TONE_COLORS.red.text }">15일+</span>
      <span class="legend-chip none">미실시</span>
    </div>

    <div class="table-wrap">
      <table class="board-table">
        <thead>
          <tr>
            <th class="zone-col">구역 \ 작업</th>
            <th v-for="t in taskTypes" :key="t.id" class="task-col">
              <span class="task-emoji" :style="{ background: t.color + '22' }">{{ t.emoji }}</span>
              <span class="task-label">{{ t.label }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="z in zones" :key="z.id">
            <td class="zone-cell">
              <div class="zone-head">
                <span class="zone-name">{{ z.name }}</span>
                <span v-if="inspectCount(z.id) > 0" class="inspect-badge">점검 {{ inspectCount(z.id) }}</span>
              </div>
              <div class="zone-sub">{{ (z as any).description || '' }}</div>
            </td>
            <td
              v-for="t in taskTypes"
              :key="t.id"
              class="data-cell"
              @click="$emit('cell-click', z.id, t.id)"
            >
              <div
                class="cell-chip"
                :class="cell(z.id, t.id).tone"
                :style="{ background: cell(z.id, t.id).bg, color: cell(z.id, t.id).color }"
              >
                <span class="cell-days">{{ cell(z.id, t.id).text }}</span>
                <span class="cell-sub">{{ cell(z.id, t.id).sub }}</span>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="hint">ⓘ 빨강(15일+)·미실시 칸을 우선 확인하세요. 칸을 클릭하면 그 구역·작업을 바로 기록할 수 있습니다.</p>
  </div>
</template>

<script setup lang="ts">
import type { BoardCell, WorkTaskType } from '../types/work-log.types'
import { TONE_COLORS, elapsedDays, elapsedTone } from '../utils/work-log.utils'

const props = defineProps<{
  zones: Array<{ id: string; name: string }>
  taskTypes: WorkTaskType[]
  board: Record<string, BoardCell>
}>()

defineEmits<{
  (e: 'cell-click', zoneId: string, taskTypeId: string): void
}>()

/** 한 칸의 표시 정보 (tone/색/텍스트) */
function cell(zoneId: string, taskTypeId: string) {
  const days = elapsedDays(props.board[`${zoneId}:${taskTypeId}`]?.lastDoneAt ?? null)
  const tone = elapsedTone(days)
  const c = TONE_COLORS[tone]
  return {
    tone,
    bg: c.bg,
    color: c.text,
    text: days == null ? '—' : `${days}일`,
    sub: days == null ? '기록 없음' : '전',
  }
}

/** 구역별 '점검 필요'(15일+ 또는 미실시) 칸 수 */
function inspectCount(zoneId: string): number {
  let n = 0
  for (const t of props.taskTypes) {
    const tone = elapsedTone(elapsedDays(props.board[`${zoneId}:${t.id}`]?.lastDoneAt ?? null))
    if (tone === 'red' || tone === 'none') n += 1
  }
  return n
}
</script>

<style scoped>
.board-wrap { display: flex; flex-direction: column; gap: 14px; }
.legend {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 10px 14px;
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: 12px;
}
.legend-title { font-size: 13px; font-weight: 700; color: var(--text-secondary); margin-right: 4px; }
.legend-chip {
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
}
.legend-chip.none {
  background: #f1f4f7;
  color: #94a3b8;
  border: 1px dashed #cbd5e1;
}

.table-wrap {
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: 14px;
  overflow: auto;
  box-shadow: var(--shadow-card);
}
.board-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  min-width: 720px;
}
.board-table thead th {
  background: var(--bg-hover);
  padding: 14px 12px;
  text-align: center;
  font-size: 13px;
  font-weight: 700;
  color: var(--text-primary);
  border-bottom: 1px solid var(--border-light);
  position: sticky;
  top: 0;
  z-index: 1;
}
.board-table thead th.zone-col {
  text-align: left;
  padding-left: 20px;
  background: var(--bg-card);
}
.task-col { width: 116px; }
.task-emoji {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  font-size: 16px;
  margin-bottom: 2px;
}
.task-label {
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
}

.zone-cell {
  padding: 14px 20px;
  border-bottom: 1px solid var(--border-light);
}
.zone-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.zone-name { font-size: 14px; font-weight: 700; color: var(--text-primary); }
.inspect-badge {
  font-size: 11px;
  font-weight: 700;
  color: var(--danger-badge-text);
  background: var(--danger-badge-bg);
  border-radius: 999px;
  padding: 1px 8px;
  white-space: nowrap;
}
.zone-sub { font-size: 11px; color: var(--text-muted); margin-top: 2px; }

.data-cell {
  padding: 8px 6px;
  border-bottom: 1px solid var(--border-light);
  text-align: center;
  cursor: pointer;
  transition: background 0.15s;
}
.data-cell:hover { background: var(--bg-hover); }

.cell-chip {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 92px;
  height: 54px;
  border-radius: 10px;
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
  box-sizing: border-box;
}
.cell-chip.none {
  background: #f1f4f7 !important;
  color: #94a3b8 !important;
  border: 1px dashed #cbd5e1;
}
.cell-days { font-size: 19px; font-weight: 800; white-space: nowrap; }
.cell-sub { font-size: 11.5px; font-weight: 500; margin-top: 1px; white-space: nowrap; }

.hint {
  font-size: 12px;
  color: var(--text-muted);
  margin: 0;
  padding: 0 4px;
}

@media (max-width: 768px) {
  .board-table { font-size: 12px; }
  .task-col { width: 100px; }
  .zone-cell { padding: 10px; }
  .data-cell { padding: 6px 4px; }
  .cell-chip { width: 84px; height: 52px; }
  .cell-days { font-size: 18px; }
}
</style>
