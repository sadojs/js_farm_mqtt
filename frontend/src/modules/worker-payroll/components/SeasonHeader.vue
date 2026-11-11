<template>
  <div class="season-header">
    <div class="sh-top">
      <div class="sh-who">
        <span class="sh-avatar">{{ worker.name.charAt(0) }}</span>
        <div class="sh-names">
          <span class="sh-name">{{ worker.name }}</span>
          <span class="sh-sub">
            <template v-if="worker.username">@{{ worker.username }} · </template>첫 고용 {{ firstYear }}
          </span>
        </div>
      </div>
      <span class="sh-right">
      <span v-if="selected?.closed" class="sh-badge closed">🔒 {{ selected.seasonYear }} 시즌 마감 완료 · 기록 잠금</span>
      <span v-else-if="selected?.endDate" class="sh-badge ended">귀국 {{ md(selected.endDate) }}</span>
      <span v-else-if="selected" class="sh-badge active">근무 중</span>
      <button class="btn-del" title="일꾼 삭제" @click="$emit('delete')">일꾼 삭제</button>
      </span>
    </div>

    <!-- 시즌 칩 -->
    <div class="chips" role="tablist" aria-label="시즌 선택">
      <button
        v-for="s in seasons"
        :key="s.id"
        role="tab"
        :aria-selected="s.id === selected?.id"
        :class="['chip', { active: s.id === selected?.id, closed: s.closed }]"
        @click="$emit('select', s.id)"
      >
        <span class="chip-year">{{ s.closed ? '🔒 ' : '' }}{{ s.seasonYear }} 시즌</span>
        <span class="chip-range">{{ md(s.startDate) }} ~ {{ s.endDate ? md(s.endDate) : '근무 중' }}</span>
      </button>
      <button
        class="chip add"
        :disabled="!canRehire"
        :title="canRehire ? '' : '진행 중인 시즌의 종료일(귀국일)을 먼저 입력하세요.'"
        @click="$emit('rehire')"
      >+ {{ nextYear }} 시즌 시작</button>
    </div>

    <!-- 시즌 요약 -->
    <div v-if="selected" class="summary">
      <div class="sum-cell">
        <span class="sum-label">근무 일수</span>
        <span class="sum-val">{{ selected.summary.workDays }}<small>일</small></span>
      </div>
      <div class="sum-cell">
        <span class="sum-label">총 근무시간</span>
        <span class="sum-val">{{ fmtH(selected.summary.totalHours) }}<small>h</small></span>
      </div>
      <div class="sum-cell">
        <span class="sum-label">시즌 지급액(세전)</span>
        <span class="sum-val money">{{ won(selected.summary.grossPay) }}</span>
      </div>
      <div class="sum-cell">
        <span class="sum-label">시즌 실수령 합계</span>
        <span class="sum-val money">{{ won(selected.summary.netPay) }}</span>
      </div>
    </div>
    <p v-if="selected && selected.summary.unsettledCount > 0" class="sum-note">
      정산일이 지났는데 확정되지 않은 정산이 {{ selected.summary.unsettledCount }}건 있습니다. (요약에는 미확정분도 현재 계산값으로 포함)
    </p>

    <!-- 마감 -->
    <div v-if="selected" class="close-row">
      <template v-if="selected.closed">
        <p class="close-note">
          시즌을 마감하면 이 시즌의 달력·가불·정산은 수정할 수 없고, 다음 시즌에서 시급·공제를 바꿔도 지난 기록은 그대로 남습니다.
        </p>
        <button class="btn-ghost" :disabled="busy" @click="reopen">마감 해제</button>
      </template>
      <template v-else>
        <span class="close-hint">
          {{ selected.endDate ? '모든 정산을 확정한 뒤 시즌을 마감하면 기록이 잠깁니다.' : '종료일(귀국일)을 입력하면 시즌을 마감할 수 있습니다.' }}
        </span>
        <button class="btn-outline" :disabled="busy || !selected.endDate" @click="close">시즌 마감</button>
      </template>
    </div>

    <div v-if="unsettled.length" class="unsettled">
      <strong>마감하려면 아래 정산을 먼저 확정하세요</strong>
      <ul>
        <li v-for="p in unsettled" :key="p.periodStart">
          {{ md(p.periodStart) }} ~ {{ md(p.periodEnd) }} · {{ STATUS_LABEL[p.status] }}
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useNotificationStore } from '../../../stores/notification.store'
import { useConfirm } from '../../../composables/useConfirm'
import { workerPayrollApi } from '../api/worker-payroll.api'
import type { Worker, WorkerSeason, UnsettledPeriod } from '../types/worker-payroll.types'
import { md, won } from '../utils/payroll-utils'

const props = defineProps<{
  worker: Worker
  seasons: WorkerSeason[]
  selectedSeasonId: string | null
}>()
const emit = defineEmits<{
  (e: 'select', seasonId: string): void
  (e: 'rehire'): void
  (e: 'changed'): void
  (e: 'delete'): void
}>()

const notify = useNotificationStore()
const { confirm: confirmDialog } = useConfirm()
const busy = ref(false)
const unsettled = ref<UnsettledPeriod[]>([])
const STATUS_LABEL: Record<UnsettledPeriod['status'], string> = {
  open: '정산일 전',
  pending: '정산 대기',
  requested: '확정 요청됨(승인 필요)',
}

const selected = computed(() => props.seasons.find((s) => s.id === props.selectedSeasonId) ?? null)
const firstYear = computed(() => Math.min(...props.seasons.map((s) => s.seasonYear)))
const latest = computed(() => props.seasons[props.seasons.length - 1])
const nextYear = computed(() => (latest.value?.seasonYear ?? new Date().getFullYear()) + 1)
// 진행 중(종료일 없는) 시즌이 있으면 새 시즌을 만들 수 없음
const canRehire = computed(() => props.seasons.every((s) => !!s.endDate))

watch(() => props.selectedSeasonId, () => { unsettled.value = [] })

function fmtH(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

async function close() {
  const s = selected.value
  if (!s) return
  const ok = await confirmDialog({
    title: `${s.seasonYear} 시즌 마감`,
    message: '마감하면 이 시즌의 달력·가불·정산·근무조건을 수정할 수 없습니다. (필요하면 마감 해제 가능)',
    confirmText: '마감',
  })
  if (!ok) return
  busy.value = true
  unsettled.value = []
  try {
    await workerPayrollApi.closeSeason(s.id)
    notify.success('일꾼 관리', `${s.seasonYear} 시즌을 마감했습니다.`)
    emit('changed')
  } catch (e: any) {
    const body = e?.response?.data
    if (body?.code === 'SEASON_UNSETTLED') unsettled.value = body.periods ?? []
    notify.warning('일꾼 관리', body?.message ?? '시즌 마감에 실패했습니다.')
  } finally {
    busy.value = false
  }
}

async function reopen() {
  const s = selected.value
  if (!s) return
  const ok = await confirmDialog({
    title: `${s.seasonYear} 시즌 마감 해제`,
    message: '마감을 해제하면 이 시즌의 달력·가불·근무조건을 다시 수정할 수 있습니다. 이미 확정된 정산은 그대로 유지됩니다.',
    confirmText: '마감 해제',
  })
  if (!ok) return
  busy.value = true
  try {
    await workerPayrollApi.reopenSeason(s.id)
    notify.info('일꾼 관리', `${s.seasonYear} 시즌 마감을 해제했습니다.`)
    emit('changed')
  } catch (e: any) {
    notify.error('일꾼 관리', e?.response?.data?.message ?? '마감 해제에 실패했습니다.')
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.season-header {
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: 14px;
  box-shadow: var(--shadow-card);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.sh-top { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.sh-right { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.btn-del {
  border: 1px solid var(--border-input); background: var(--bg-card); color: var(--text-muted);
  border-radius: 8px; padding: 4px 10px; font-size: var(--font-size-caption); font-weight: 600; cursor: pointer;
}
.btn-del:hover { color: var(--danger); border-color: var(--danger); background: var(--danger-bg); }
.sh-who { display: flex; align-items: center; gap: 10px; min-width: 0; }
.sh-avatar {
  width: 40px; height: 40px; border-radius: 50%;
  background: var(--accent); color: #fff;
  display: flex; align-items: center; justify-content: center; font-weight: 700; flex-shrink: 0;
}
.sh-names { display: flex; flex-direction: column; min-width: 0; }
.sh-name { font-weight: 800; color: var(--text-primary); font-size: var(--font-size-subtitle); }
.sh-sub { color: var(--text-muted); font-size: var(--font-size-caption); }
.sh-badge { border-radius: 8px; padding: 4px 10px; font-size: var(--font-size-caption); font-weight: 700; }
.sh-badge.closed { background: var(--warning-bg); color: var(--warning-text); border: 1px solid var(--warning-border); }
.sh-badge.ended { background: var(--bg-hover); color: var(--text-secondary); }
.sh-badge.active { background: var(--success-bg); color: var(--success-text); }
.chips { display: flex; flex-wrap: wrap; gap: 8px; }
.chip {
  display: flex; flex-direction: column; align-items: flex-start; gap: 1px;
  border: 1px solid var(--border-input); background: var(--bg-card);
  border-radius: 10px; padding: 7px 12px; cursor: pointer; text-align: left;
}
.chip:hover:not(:disabled) { border-color: var(--accent); }
.chip.active { border-color: var(--accent); background: var(--accent-bg); }
.chip-year { font-weight: 700; color: var(--text-primary); font-size: var(--font-size-label); }
.chip.active .chip-year { color: var(--accent); }
.chip-range { font-size: var(--font-size-caption); color: var(--text-muted); font-variant-numeric: tabular-nums; }
.chip.add {
  justify-content: center; border-style: dashed; border-color: var(--accent);
  color: var(--accent); font-weight: 700; font-size: var(--font-size-label);
}
.chip.add:hover:not(:disabled) { background: var(--accent-bg); }
.chip.add:disabled { opacity: 0.45; cursor: default; border-color: var(--border-input); color: var(--text-muted); }
.summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.sum-cell { background: var(--bg-hover); border-radius: 10px; padding: 10px 12px; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.sum-label { font-size: var(--font-size-caption); color: var(--text-muted); font-weight: 600; }
.sum-val { font-weight: 800; color: var(--text-primary); font-size: calc(20px * var(--content-scale, 1)); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.sum-val small { font-size: var(--font-size-caption); color: var(--text-muted); margin-left: 2px; }
.sum-val.money { font-size: calc(16px * var(--content-scale, 1)); color: var(--accent); }
.sum-note { color: var(--warning-text); font-size: var(--font-size-caption); }
.close-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.close-hint { color: var(--text-muted); font-size: var(--font-size-caption); }
.close-note {
  flex: 1 1 260px;
  background: var(--warning-bg); color: var(--warning-text); border: 1px solid var(--warning-border);
  border-radius: 10px; padding: 10px 12px; font-size: var(--font-size-caption);
}
.btn-outline, .btn-ghost {
  border-radius: 8px; padding: 9px 16px; font-weight: 700; cursor: pointer; min-height: 40px;
}
.btn-outline { border: 1px solid var(--accent); background: var(--bg-card); color: var(--accent); }
.btn-outline:hover:not(:disabled) { background: var(--accent-bg); }
.btn-ghost { border: 1px solid var(--border-input); background: var(--bg-card); color: var(--text-secondary); }
.btn-ghost:hover:not(:disabled) { background: var(--bg-hover); }
.btn-outline:disabled, .btn-ghost:disabled { opacity: 0.5; cursor: default; }
.unsettled {
  background: var(--warning-bg); border: 1px solid var(--warning-border); color: var(--warning-text);
  border-radius: 10px; padding: 10px 14px; font-size: var(--font-size-caption);
}
.unsettled ul { margin: 6px 0 0 18px; display: flex; flex-direction: column; gap: 2px; }
@media (max-width: 768px) {
  .summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
