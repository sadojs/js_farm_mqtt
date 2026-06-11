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
      </header>

      <!-- 상위 모드 탭 -->
      <div class="mode-tabs">
        <button :class="['mode-tab', { active: mode === 'workers' }]" @click="mode = 'workers'">일꾼별 근무·정산</button>
        <button :class="['mode-tab', { active: mode === 'history' }]" @click="mode = 'history'">정산 이력</button>
      </div>

      <!-- 정산 이력 -->
      <SettlementHistory v-if="mode === 'history'" />

      <!-- 일꾼별 -->
      <div v-else class="layout">
        <aside class="worker-list">
          <button
            v-for="w in workers"
            :key="w.id"
            :class="['worker-item', { active: w.id === selectedId }]"
            @click="select(w.id)"
          >
            <span class="w-avatar">{{ w.name.charAt(0) }}</span>
            <span class="w-info">
              <span class="w-name">{{ w.name }}</span>
              <span class="w-sub">{{ w.username ? '@' + w.username : '' }} · {{ w.hourlyWage.toLocaleString() }}원/h</span>
            </span>
          </button>
          <button class="worker-add" :class="{ active: selectedId === null && creating }" @click="newWorker">
            + 일꾼 등록
          </button>
        </aside>

        <section class="worker-detail">
          <div v-if="selectedId === null && !creating" class="empty">
            <p>일꾼을 선택하거나 새 일꾼을 등록해 주세요.</p>
          </div>

          <template v-else>
            <div class="tabs">
              <button :class="['tab', { active: tab === 'calendar' }]" :disabled="!selectedId" @click="tab = 'calendar'">근무 달력</button>
              <button :class="['tab', { active: tab === 'settlement' }]" :disabled="!selectedId" @click="tab = 'settlement'">월 정산</button>
              <button :class="['tab', { active: tab === 'settings' }]" @click="tab = 'settings'">{{ creating ? '계정 등록' : '설정' }}</button>
            </div>

            <WorkerCalendar
              v-if="tab === 'calendar' && selectedId"
              :key="'cal' + selectedId"
              :worker-id="selectedId"
              :lang="lang"
              editable
            />
            <WorkerSettlement
              v-else-if="tab === 'settlement' && selectedId"
              :key="'set' + selectedId"
              :worker-id="selectedId"
              :lang="lang"
              show-nav
            />
            <WorkerSettings
              v-else-if="tab === 'settings'"
              :key="'cfg' + (selectedId ?? 'new')"
              :worker-id="selectedId"
              @saved="onSaved"
              @delete="onDelete"
            />
          </template>
        </section>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useAuthStore } from '../../stores/auth.store'
import { useNotificationStore } from '../../stores/notification.store'
import { workerPayrollApi } from './api/worker-payroll.api'
import type { Worker } from './types/worker-payroll.types'
import { LANG_OPTIONS, type PayrollLang } from './i18n/payroll-i18n'
import WorkerCalendar from './components/WorkerCalendar.vue'
import WorkerSettlement from './components/WorkerSettlement.vue'
import WorkerSettings from './components/WorkerSettings.vue'
import WorkerSelfView from './components/WorkerSelfView.vue'
import SettlementHistory from './components/SettlementHistory.vue'

const authStore = useAuthStore()
const notify = useNotificationStore()
const isWorker = authStore.isFarmUser
const farmLabel = `${authStore.user?.name ?? '우리'} 농장`

const mode = ref<'workers' | 'history'>('workers')
const workers = ref<Worker[]>([])
const selectedId = ref<string | null>(null)
const creating = ref(false)
const tab = ref<'calendar' | 'settlement' | 'settings'>('calendar')
const lang = ref<PayrollLang>('ko')

async function loadWorkers() {
  workers.value = await workerPayrollApi.listWorkers()
}

function select(id: string) {
  selectedId.value = id
  creating.value = false
  if (tab.value === 'settings') return
  tab.value = 'calendar'
}

function newWorker() {
  selectedId.value = null
  creating.value = true
  tab.value = 'settings'
}

async function onSaved(worker: Worker) {
  await loadWorkers()
  selectedId.value = worker.id
  creating.value = false
  tab.value = 'calendar'
}

async function onDelete() {
  if (!selectedId.value) return
  if (!confirm('이 일꾼을 삭제할까요? (근무·정산 기록은 보존됩니다)')) return
  try {
    await workerPayrollApi.removeWorker(selectedId.value)
    notify.info('일꾼 관리', '일꾼을 삭제했습니다.')
    selectedId.value = null
    creating.value = false
    await loadWorkers()
  } catch {
    notify.error('일꾼 관리', '삭제에 실패했습니다.')
  }
}

onMounted(async () => {
  if (isWorker) return
  await loadWorkers()
  if (workers.value.length > 0) {
    selectedId.value = workers.value[0].id
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
.layout { display: grid; grid-template-columns: 240px minmax(0, 1fr); gap: 18px; align-items: start; }
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
@media (max-width: 768px) {
  .layout { grid-template-columns: minmax(0, 1fr); }
  .worker-list { flex-direction: row; overflow-x: auto; }
  .worker-item { min-width: 180px; flex-shrink: 0; }
  .tabs { flex-wrap: wrap; }
}
</style>
