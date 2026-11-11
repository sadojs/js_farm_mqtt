<template>
  <div class="payroll-view">
    <!-- 일꾼(farm_user) 본인 화면 -->
    <WorkerSelfView v-if="isWorker" />

    <!-- 관리자(admin/farm_admin) 화면 -->
    <template v-else>
      <header class="page-header">
        <div>
          <h2>일꾼 관리</h2>
          <p class="page-description">{{ farmLabel }} · 근무·월급 관리</p>
        </div>
        <div class="head-right">
          <div class="year-seg" role="group" aria-label="시즌 연도 선택">
            <span class="year-label">시즌</span>
            <button
              v-for="y in years"
              :key="y"
              :class="['year-btn', { active: y === year }]"
              @click="setYear(y)"
            >{{ y }}<template v-if="y > thisYear"> +</template></button>
          </div>
          <div
            v-if="mode === 'workers' && selectedId && tab !== 'settings'"
            class="lang-toggle"
            role="group"
            aria-label="언어 선택"
          >
            <button
              v-for="opt in LANG_OPTIONS"
              :key="opt.code"
              :class="['lang-btn', { active: lang === opt.code }]"
              @click="lang = opt.code"
            >{{ opt.label }}</button>
          </div>
        </div>
      </header>

      <!-- 상위 모드 탭 -->
      <div class="mode-tabs">
        <button :class="['mode-tab', { active: mode === 'workers' }]" @click="mode = 'workers'">일꾼별 근무·정산</button>
        <button :class="['mode-tab', { active: mode === 'history' }]" @click="mode = 'history'">정산 이력</button>
        <button :class="['mode-tab', { active: mode === 'annual' }]" @click="mode = 'annual'">연간 결산</button>
      </div>

      <!-- 정산 이력 -->
      <SettlementHistory v-if="mode === 'history'" :year="year" />

      <!-- 연간 결산 -->
      <AnnualReport v-else-if="mode === 'annual'" :key="'annual' + year" :year="year" />

      <!-- 일꾼별 -->
      <div v-else class="layout">
        <aside class="worker-list">
          <span class="group-label">{{ year }} 시즌 일꾼 · {{ yearWorkers.length }}명</span>
          <button
            v-for="w in yearWorkers"
            :key="w.id"
            :class="['worker-item', { active: w.id === selectedId }]"
            @click="select(w.id)"
          >
            <span class="w-avatar">{{ w.name.charAt(0) }}</span>
            <span class="w-info">
              <span class="w-name">
                {{ w.name }}
                <span v-if="yearSeason(w)?.closed" class="badge muted">마감</span>
                <span v-else-if="yearSeason(w)?.endDate" class="badge-terminated">귀국 {{ md(yearSeason(w)!.endDate) }}</span>
                <span v-if="(yearSeason(w)?.unsettledCount ?? 0) > 0" class="badge warn">정산 {{ yearSeason(w)!.unsettledCount }}건 남음</span>
              </span>
              <span class="w-sub">{{ itemSub(w) }}</span>
            </span>
          </button>
          <p v-if="yearWorkers.length === 0" class="group-empty">{{ year }} 시즌에 고용된 일꾼이 없습니다.</p>

          <template v-if="pastWorkers.length">
            <hr class="group-sep" />
            <span class="group-label">지난 시즌 일꾼 · 이번 시즌 미고용</span>
            <div
              v-for="w in pastWorkers"
              :key="w.id"
              :class="['worker-item past', { active: w.id === selectedId }]"
              role="button"
              tabindex="0"
              @click="select(w.id)"
              @keydown.enter="select(w.id)"
            >
              <span class="w-avatar past">{{ w.name.charAt(0) }}</span>
              <span class="w-info">
                <span class="w-name">{{ w.name }}</span>
                <span class="w-sub">마지막 근무 {{ w.lastSeasonYear ?? '—' }} 시즌</span>
              </span>
              <button
                v-if="(w.lastSeasonYear ?? 0) < year"
                class="btn-rehire"
                @click.stop="openRehire(w.id, year)"
              >재고용</button>
            </div>
          </template>

          <button class="worker-add" :class="{ active: selectedId === null && creating }" @click="newWorker">
            + 새 일꾼 등록
          </button>
        </aside>

        <section class="worker-detail">
          <div v-if="selectedId === null && !creating" class="empty">
            <p>일꾼을 선택하거나 새 일꾼을 등록해 주세요.</p>
          </div>

          <template v-else>
            <SeasonHeader
              v-if="selectedWorker && seasonDetails.length"
              :worker="selectedWorker"
              :seasons="seasonDetails"
              :selected-season-id="selectedSeasonId"
              @select="selectSeason"
              @rehire="openRehire(selectedWorker.id, (selectedWorker.lastSeasonYear ?? thisYear) + 1)"
              @changed="refreshSelected"
              @delete="onDelete"
            />

            <div class="tabs">
              <button :class="['tab', { active: tab === 'calendar' }]" :disabled="!selectedId" @click="tab = 'calendar'">근무 달력</button>
              <button :class="['tab', { active: tab === 'settlement' }]" :disabled="!selectedId" @click="tab = 'settlement'">월 정산</button>
              <button :class="['tab', { active: tab === 'settings' }]" @click="tab = 'settings'">{{ creating ? '계정 등록' : '근무·임금' }}</button>
            </div>

            <WorkerCalendar
              v-if="tab === 'calendar' && selectedId && selectedSeasonId"
              :key="'cal' + selectedId + selectedSeasonId"
              :worker-id="selectedId"
              :season-id="selectedSeasonId ?? undefined"
              :lang="lang"
              editable
            />
            <WorkerSettlement
              v-else-if="tab === 'settlement' && selectedId && selectedSeasonId"
              :key="'set' + selectedId + selectedSeasonId"
              :worker-id="selectedId"
              :season-id="selectedSeasonId ?? undefined"
              :season-totals="selectedSeasonTotals"
              :lang="lang"
              show-nav
              @changed="refreshSelected"
            />
            <WorkerSettings
              v-else-if="tab === 'settings'"
              :key="'cfg' + (selectedId ?? 'new') + selectedSeasonId"
              :worker-id="selectedId"
              :season="selectedSeason"
              @saved="onSaved"
              @delete="onDelete"
            />
          </template>
        </section>
      </div>

      <DeleteWorkerModal
        v-if="deleting"
        :worker-id="deleting.id"
        :worker-name="deleting.name"
        @close="deleting = null"
        @deleted="onDeleted"
      />

      <RehireModal
        v-if="rehire"
        :worker="rehire.worker"
        :last-season="rehire.lastSeason"
        :target-year="rehire.targetYear"
        @close="rehire = null"
        @created="onRehired"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useAuthStore } from '../../stores/auth.store'
import { useNotificationStore } from '../../stores/notification.store'
import { workerPayrollApi } from './api/worker-payroll.api'
import type { Worker, WorkerSeason, SeasonBrief } from './types/worker-payroll.types'
import { LANG_OPTIONS, type PayrollLang } from './i18n/payroll-i18n'
import { md, seasonInYear } from './utils/payroll-utils'
import WorkerCalendar from './components/WorkerCalendar.vue'
import WorkerSettlement from './components/WorkerSettlement.vue'
import WorkerSettings from './components/WorkerSettings.vue'
import WorkerSelfView from './components/WorkerSelfView.vue'
import SettlementHistory from './components/SettlementHistory.vue'
import SeasonHeader from './components/SeasonHeader.vue'
import RehireModal from './components/RehireModal.vue'
import AnnualReport from './components/AnnualReport.vue'
import DeleteWorkerModal from './components/DeleteWorkerModal.vue'

const authStore = useAuthStore()
const notify = useNotificationStore()
const isWorker = authStore.isFarmUser
// 내가 속한 농장 이름 (농장 사용자는 소속 농장) — 이전엔 로그인한 사람 이름으로 "OOO 농장" 이 표시됐음
const farmLabel = authStore.user?.farmName || '우리 농장'

const YEAR_KEY = 'payroll.year'
const thisYear = new Date().getFullYear()

const mode = ref<'workers' | 'history' | 'annual'>('workers')
const workers = ref<Worker[]>([])
const selectedId = ref<string | null>(null)
const creating = ref(false)
const tab = ref<'calendar' | 'settlement' | 'settings'>('calendar')
const lang = ref<PayrollLang>('ko')
const year = ref<number>(readYear())
const seasonDetails = ref<WorkerSeason[]>([])
const selectedSeasonId = ref<string | null>(null)
const deleting = ref<{ id: string; name: string } | null>(null)
const rehire = ref<{ worker: Worker; lastSeason: WorkerSeason | null; targetYear: number } | null>(null)

function readYear(): number {
  try {
    const v = Number(localStorage.getItem(YEAR_KEY))
    if (v >= 2000 && v <= 2100) return v
  } catch { /* 저장소 사용 불가 */ }
  return thisYear
}
function setYear(y: number) {
  year.value = y
  try { localStorage.setItem(YEAR_KEY, String(y)) } catch { /* 무시 */ }
  // 선택한 일꾼의 그 해 시즌으로 전환
  const s = selectedWorker.value ? yearSeason(selectedWorker.value) : null
  if (s) selectedSeasonId.value = s.id
}

/** 연도 세그먼트 = 데이터가 있는 연도 + 올해 + 다음 연도 */
const years = computed(() => {
  const set = new Set<number>([thisYear, thisYear + 1, year.value])
  for (const w of workers.value) {
    for (const s of w.seasons ?? []) {
      const end = s.endDate ? Number(s.endDate.slice(0, 4)) : Math.max(thisYear, s.seasonYear)
      for (let y = s.seasonYear; y <= end; y++) set.add(y)
    }
  }
  return [...set].sort((a, b) => a - b)
})

/** 그 해와 겹치는 시즌 중 가장 최근 시즌 */
function yearSeason(w: Worker): SeasonBrief | null {
  const list = (w.seasons ?? []).filter((s) => seasonInYear(s, year.value))
  return list.length ? list[list.length - 1] : null
}
// 시즌 정보가 없는 응답(구버전 서버)은 모두 이번 시즌 일꾼으로 표시
const yearWorkers = computed(() => workers.value.filter((w) => !w.seasons || !!yearSeason(w)))
const pastWorkers = computed(() => workers.value.filter((w) => w.seasons && !yearSeason(w)))

function itemSub(w: Worker): string {
  const s = yearSeason(w)
  if (!s) return `${w.username ? '@' + w.username + ' · ' : ''}${w.hourlyWage.toLocaleString()}원/h`
  const nth = (w.seasons ?? []).findIndex((x) => x.id === s.id) + 1
  const wage = s.salaryType === 'fixed_monthly' ? `월 ${s.fixedMonthlySalary.toLocaleString()}원` : `${s.hourlyWage.toLocaleString()}원/h`
  return `${nth}년차 · ${md(s.startDate)} ~ ${s.endDate ? md(s.endDate) : ''} · ${wage}`
}

const selectedWorker = computed(() => workers.value.find((w) => w.id === selectedId.value) ?? null)
const selectedSeason = computed(() => seasonDetails.value.find((s) => s.id === selectedSeasonId.value) ?? null)
const selectedSeasonTotals = computed(() => {
  const s = selectedSeason.value
  return s ? { seasonYear: s.seasonYear, ...s.summary } : null
})

async function loadWorkers() {
  workers.value = await workerPayrollApi.listWorkers(year.value)
}

async function loadSeasons(keepSelection = true) {
  if (!selectedId.value) {
    seasonDetails.value = []
    selectedSeasonId.value = null
    return
  }
  const id = selectedId.value
  const list = await workerPayrollApi.listSeasons(id)
  if (selectedId.value !== id) return
  seasonDetails.value = list
  if (keepSelection && list.some((s) => s.id === selectedSeasonId.value)) return
  const inYear = list.filter((s) => seasonInYear(s, year.value))
  selectedSeasonId.value = (inYear[inYear.length - 1] ?? list.find((s) => s.isCurrent) ?? list[list.length - 1])?.id ?? null
}

async function select(id: string) {
  const changed = selectedId.value !== id
  selectedId.value = id
  creating.value = false
  if (tab.value !== 'settings') tab.value = 'calendar'
  if (changed) {
    seasonDetails.value = []
    selectedSeasonId.value = null
    await loadSeasons(false)
  }
}

function selectSeason(id: string) {
  selectedSeasonId.value = id
}

/** 마감·해제·정산 승인 후 — 목록 배지와 시즌 요약 갱신 */
async function refreshSelected() {
  await Promise.all([loadWorkers(), loadSeasons()])
}

function newWorker() {
  selectedId.value = null
  creating.value = true
  seasonDetails.value = []
  selectedSeasonId.value = null
  tab.value = 'settings'
}

async function openRehire(workerId: string, targetYear: number) {
  const worker = workers.value.find((w) => w.id === workerId)
  if (!worker) return
  try {
    const list = workerId === selectedId.value && seasonDetails.value.length
      ? seasonDetails.value
      : await workerPayrollApi.listSeasons(workerId)
    if (list.some((s) => !s.endDate)) {
      notify.warning('일꾼 관리', '진행 중인 시즌의 종료일(귀국일)을 먼저 입력해 주세요.')
      return
    }
    const last = list[list.length - 1] ?? null
    rehire.value = { worker, lastSeason: last, targetYear: Math.max(targetYear, (last?.seasonYear ?? 0) + 1) }
  } catch {
    notify.error('일꾼 관리', '시즌 정보를 불러오지 못했습니다.')
  }
}

async function onRehired(seasonId: string) {
  const workerId = rehire.value?.worker.id
  const targetYear = rehire.value?.targetYear
  rehire.value = null
  if (targetYear && targetYear !== year.value) setYear(targetYear)
  await loadWorkers()
  if (workerId) {
    selectedId.value = workerId
    creating.value = false
    tab.value = 'calendar'
    selectedSeasonId.value = seasonId
    await loadSeasons()
  }
}

async function onSaved(worker: Worker) {
  await loadWorkers()
  const isNew = selectedId.value !== worker.id
  selectedId.value = worker.id
  creating.value = false
  tab.value = 'calendar'
  await loadSeasons(!isNew)
}

/** 삭제 — 목록에서만(기록 유지) / 기록까지 완전 삭제 중 선택하는 팝업 */
function onDelete() {
  const w = selectedWorker.value
  if (w) deleting.value = { id: w.id, name: w.name }
}

async function onDeleted() {
  deleting.value = null
  selectedId.value = null
  creating.value = false
  seasonDetails.value = []
  selectedSeasonId.value = null
  await loadWorkers()
  const first = yearWorkers.value[0] ?? workers.value[0]
  if (first) await select(first.id)
}

onMounted(async () => {
  if (isWorker) return
  await loadWorkers()
  const first = yearWorkers.value[0] ?? workers.value[0]
  if (first) {
    await select(first.id)
  } else {
    newWorker()
  }
})
</script>

<style scoped>
.payroll-view { display: flex; flex-direction: column; gap: 18px; }
.page-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.page-header h2 { font-size: var(--font-size-title); font-weight: 700; color: var(--text-primary); }
.page-description { color: var(--text-muted); }
.head-right { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.year-seg { display: flex; align-items: center; flex-wrap: wrap; gap: 2px; background: var(--bg-hover); border-radius: 10px; padding: 4px; }
.year-label { font-size: var(--font-size-caption); color: var(--text-muted); font-weight: 600; padding: 0 6px; }
.year-btn {
  border: none;
  background: none;
  padding: 7px 12px;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 700;
  color: var(--text-secondary);
  font-size: var(--font-size-caption);
  font-variant-numeric: tabular-nums;
}
.year-btn.active { background: var(--bg-card); color: var(--accent); box-shadow: var(--shadow-card); }
.lang-toggle { display: flex; flex-wrap: wrap; gap: 2px; background: var(--bg-hover); border-radius: 10px; padding: 4px; }
.lang-btn {
  border: none;
  background: none;
  padding: 7px 12px;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 600;
  color: var(--text-secondary);
  font-size: var(--font-size-caption);
}
.lang-btn.active { background: var(--bg-card); color: var(--accent); box-shadow: var(--shadow-card); }
.mode-tabs { display: flex; gap: 8px; border-bottom: 1px solid var(--border-light); }
.mode-tab {
  border: none;
  background: none;
  padding: 10px 4px;
  margin-bottom: -1px;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  font-weight: 700;
  color: var(--text-muted);
}
.mode-tab.active { color: var(--accent); border-bottom-color: var(--accent); }
.layout { display: grid; grid-template-columns: 260px minmax(0, 1fr); gap: 18px; align-items: start; }
.worker-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: 14px;
  box-shadow: var(--shadow-card);
  padding: 10px;
}
.worker-item {
  display: flex;
  align-items: center;
  gap: 10px;
  border: none;
  background: none;
  border-radius: 10px;
  padding: 10px;
  cursor: pointer;
  text-align: left;
  width: 100%;
}
.worker-item.active { background: var(--accent-bg); }
.worker-item:hover:not(.active) { background: var(--bg-hover); }
.w-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  flex-shrink: 0;
}
.w-info { display: flex; flex-direction: column; min-width: 0; }
.w-name { font-weight: 600; color: var(--text-primary); }
.w-sub { font-size: var(--font-size-caption); color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.group-label { font-size: var(--font-size-caption); color: var(--text-muted); font-weight: 700; padding: 4px 6px 0; }
.group-empty { font-size: var(--font-size-caption); color: var(--text-muted); padding: 4px 6px 8px; }
.group-sep { border: none; border-top: 1px solid var(--border-light); margin: 6px 0 2px; width: 100%; }
.worker-item.past .w-name { color: var(--text-secondary); }
.w-avatar.past { background: var(--text-muted); }
.btn-rehire {
  margin-left: auto;
  flex-shrink: 0;
  border: 1px solid var(--accent);
  background: var(--bg-card);
  color: var(--accent);
  border-radius: 8px;
  padding: 5px 10px;
  font-weight: 700;
  font-size: var(--font-size-caption);
  cursor: pointer;
}
.btn-rehire:hover { background: var(--accent-bg); }
.badge {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 6px;
  font-size: calc(10px * var(--content-scale, 1));
  font-weight: 700;
  vertical-align: middle;
}
.badge.warn { background: var(--warning-bg); color: var(--warning-text); }
.badge.muted { background: var(--bg-hover); color: var(--text-secondary); }
.worker-add {
  border: 1px dashed var(--accent);
  background: none;
  color: var(--accent);
  border-radius: 10px;
  padding: 10px;
  cursor: pointer;
  font-weight: 600;
}
.worker-add:hover, .worker-add.active { background: var(--accent-bg); }
.worker-detail { min-width: 0; display: flex; flex-direction: column; gap: 16px; }
.tabs { display: flex; gap: 4px; background: var(--bg-hover); border-radius: 10px; padding: 4px; align-self: flex-start; }
.tab {
  border: none;
  background: none;
  padding: 8px 18px;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 600;
  color: var(--text-secondary);
}
.tab.active { background: var(--bg-card); color: var(--accent); box-shadow: var(--shadow-card); }
.tab:disabled { opacity: 0.4; cursor: default; }
.empty { text-align: center; padding: 60px 20px; color: var(--text-muted); }
.badge-terminated {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 6px;
  background: var(--danger-badge-bg, #fee2e2);
  color: var(--danger-badge-text, #b91c1c);
  font-size: calc(10px * var(--content-scale, 1));
  font-weight: 700;
  vertical-align: middle;
}
@media (max-width: 768px) {
  .layout { grid-template-columns: minmax(0, 1fr); }
  /* 가로 스크롤 대신 줄바꿈 — "일꾼 등록" 버튼이 화면 밖으로 밀리지 않도록 */
  .worker-list { flex-direction: row; flex-wrap: wrap; }
  .worker-item { flex: 1 1 160px; min-width: 0; }
  .group-label { font-size: var(--font-size-caption); color: var(--text-muted); font-weight: 700; padding: 4px 6px 0; }
.group-empty { font-size: var(--font-size-caption); color: var(--text-muted); padding: 4px 6px 8px; }
.group-sep { border: none; border-top: 1px solid var(--border-light); margin: 6px 0 2px; width: 100%; }
.worker-item.past .w-name { color: var(--text-secondary); }
.w-avatar.past { background: var(--text-muted); }
.btn-rehire {
  margin-left: auto;
  flex-shrink: 0;
  border: 1px solid var(--accent);
  background: var(--bg-card);
  color: var(--accent);
  border-radius: 8px;
  padding: 5px 10px;
  font-weight: 700;
  font-size: var(--font-size-caption);
  cursor: pointer;
}
.btn-rehire:hover { background: var(--accent-bg); }
.badge {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 6px;
  font-size: calc(10px * var(--content-scale, 1));
  font-weight: 700;
  vertical-align: middle;
}
.badge.warn { background: var(--warning-bg); color: var(--warning-text); }
.badge.muted { background: var(--bg-hover); color: var(--text-secondary); }
.worker-add { flex: 1 1 100%; }
  .tabs { flex-wrap: wrap; }
}
</style>
