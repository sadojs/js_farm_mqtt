<template>
  <div class="page-container">
    <!-- 헤더 -->
    <header class="page-header">
      <div>
        <h2>수확 관리</h2>
        <p class="page-description">작물 배치 · 작업 스케줄 · 생육 단계 추적</p>
      </div>
      <button class="btn-primary" @click="openModal()">+ 배치 추가</button>
    </header>

    <!-- 탭 -->
    <div class="tab-bar">
      <button :class="['tab', { active: tab === 'batches' }]" @click="tab = 'batches'">
        배치 ({{ activeBatches.length }})
      </button>
      <button :class="['tab', { active: tab === 'tasks' }]" @click="switchToTasks">
        작업
      </button>
      <button :class="['tab', { active: tab === 'completed' }]" @click="tab = 'completed'">
        완료 ({{ completedBatches.length }})
      </button>
    </div>

    <!-- 로딩 -->
    <div v-if="loading" class="loading-state">불러오는 중...</div>

    <!-- ───── 탭: 배치 ───── -->
    <template v-if="!loading && tab === 'batches'">
      <div v-if="activeBatches.length === 0" class="empty-state">
        <p>진행 중인 배치가 없습니다.</p>
        <button class="btn-primary" @click="openModal()">첫 번째 배치 추가</button>
      </div>
      <div v-else class="batch-list">
        <div v-for="batch in activeBatches" :key="batch.id" class="batch-card">
          <div class="batch-header">
            <div class="batch-title">
              <h3>{{ batch.cropName }} {{ batch.variety ? `/ ${batch.variety}` : '' }}</h3>
              <span v-if="getGroupName(batch.groupId)" class="batch-group">{{ getGroupName(batch.groupId) }}</span>
              <span v-else-if="batch.houseName" class="batch-group">{{ batch.houseName }}</span>
            </div>
            <span class="stage-badge" :style="{ background: getStageInfo(batch.currentStage).color + '20', color: getStageInfo(batch.currentStage).color }">
              {{ getStageInfo(batch.currentStage).icon }} {{ getStageInfo(batch.currentStage).label }}
            </span>
            <div class="batch-menu">
              <button class="btn-icon-sm" @click="toggleMenu(batch.id)">&#8942;</button>
              <div v-if="openMenuId === batch.id" class="dropdown-menu">
                <button @click="openModal(batch)">수정</button>
                <button @click="handleComplete(batch.id)">수확 완료</button>
                <button @click="handleClone(batch)">복제</button>
                <button class="danger" @click="handleDelete(batch.id)">삭제</button>
              </div>
            </div>
          </div>
          <div class="batch-info">
            <span>파종: {{ batch.sowDate }}</span>
            <template v-if="batch.transplantDate">
              <span class="dot">·</span>
              <span>정식: {{ batch.transplantDate }}</span>
            </template>
            <span class="dot">·</span>
            <span>{{ batch.growDays }}일</span>
          </div>
          <!-- 진행률 -->
          <div class="progress-bar">
            <div class="progress-fill" :style="{ width: calcProgress(batch) + '%' }"></div>
          </div>
          <!-- 오늘의 작업 요약 -->
          <div v-if="batchSummaries[batch.id]" class="task-summary">
            <template v-if="batchSummaries[batch.id].todayTasks.length > 0">
              <div class="summary-label">오늘 작업</div>
              <div v-for="t in batchSummaries[batch.id].todayTasks" :key="t.id" class="summary-task">
                <span :class="['summary-dot', t.status === 'done' ? 'done' : 'planned']"></span>
                {{ t.taskName }}
              </div>
            </template>
            <template v-if="batchSummaries[batch.id].upcoming.length > 0">
              <div class="summary-label upcoming">다음 예정</div>
              <div v-for="t in batchSummaries[batch.id].upcoming" :key="t.id" class="summary-task muted">
                {{ t.scheduledDate.slice(5) }} {{ t.taskName }}
              </div>
            </template>
          </div>
          <div v-if="batch.memo" class="batch-memo">{{ batch.memo }}</div>
        </div>
      </div>
    </template>

    <!-- ───── 탭: 작업 ───── -->
    <template v-if="!loading && tab === 'tasks'">
      <!-- 필터 + 뷰 전환 -->
      <div class="filter-row">
        <select v-model="taskFilter.groupId" @change="loadOccurrences" class="filter-select">
          <option value="">전체 그룹</option>
          <option v-for="g in groups" :key="g.id" :value="g.id">{{ g.name }}</option>
        </select>
        <select v-model="taskFilter.batchId" @change="loadOccurrences" class="filter-select">
          <option value="">전체 배치</option>
          <option v-for="b in activeBatches" :key="b.id" :value="b.id">{{ b.cropName }} {{ b.variety || '' }}</option>
        </select>
        <div class="view-toggle">
          <button :class="{ active: viewMode === 'list' }" @click="switchToList">리스트</button>
          <button :class="{ active: viewMode === 'calendar' }" @click="switchToCalendar">달력</button>
        </div>
      </div>

      <div v-if="occurrencesLoading" class="loading-state">작업 목록 불러오는 중...</div>

      <!-- ── 리스트 뷰 ── -->
      <template v-else-if="viewMode === 'list'">
        <div v-if="allOccurrences.length === 0" class="empty-state">
          <p>표시할 작업이 없습니다.</p>
        </div>
        <template v-else>
          <!-- 지연 작업 -->
          <div v-if="overdueTasks.length > 0" class="task-section">
            <h4 class="section-title danger">지연 ({{ overdueTasks.length }})</h4>
            <div v-for="occ in overdueTasks" :key="occ.id" class="task-card overdue">
              <div class="task-main">
                <span class="task-name">{{ occ.taskName }}</span>
                <span class="task-batch-info">{{ occ.cropName }} · {{ occ.groupName || occ.houseName }}</span>
              </div>
              <div class="task-date">{{ occ.scheduledDate.slice(5) }}</div>
              <div class="task-actions">
                <button class="btn-sm accent" @click="handleTaskComplete(occ)">완료</button>
                <button class="btn-sm" @click="handleTaskSkip(occ.id)">건너뛰기</button>
              </div>
            </div>
          </div>

          <!-- 오늘 작업 -->
          <div v-if="todayTasks.length > 0" class="task-section">
            <h4 class="section-title today">오늘 ({{ todayTasks.length }})</h4>
            <div v-for="occ in todayTasks" :key="occ.id" class="task-card today">
              <div class="task-main">
                <span class="task-name">{{ occ.taskName }}</span>
                <span class="task-batch-info">{{ occ.cropName }} · {{ occ.groupName || occ.houseName }}</span>
                <span v-if="occ.windowEndDate" class="task-window">~{{ occ.windowEndDate.slice(5) }}까지</span>
              </div>
              <div class="task-actions">
                <button class="btn-sm accent" @click="handleTaskComplete(occ)">완료</button>
                <button class="btn-sm" @click="handleTaskPostpone(occ.id)">미루기</button>
                <button class="btn-sm" @click="handleTaskSkip(occ.id)">건너뛰기</button>
              </div>
            </div>
          </div>

          <!-- 예정 작업 -->
          <div v-if="upcomingTasks.length > 0" class="task-section">
            <h4 class="section-title">예정 ({{ upcomingTasks.length }})</h4>
            <div v-for="occ in upcomingTasks" :key="occ.id" class="task-card">
              <div class="task-main">
                <span class="task-name">{{ occ.taskName }}</span>
                <span class="task-batch-info">{{ occ.cropName }} · {{ occ.groupName || occ.houseName }}</span>
                <span v-if="occ.windowEndDate" class="task-window">{{ occ.scheduledDate.slice(5) }}~{{ occ.windowEndDate.slice(5) }}</span>
                <span v-else class="task-window">{{ occ.scheduledDate.slice(5) }}</span>
              </div>
              <div class="task-actions">
                <button class="btn-sm accent" @click="handleTaskComplete(occ)">완료</button>
              </div>
            </div>
          </div>
        </template>
      </template>

      <!-- ── 달력 뷰 ── -->
      <template v-else-if="viewMode === 'calendar'">
        <div class="calendar-nav">
          <button @click="prevMonth">&lt;</button>
          <h4>{{ calendarDate.getFullYear() }}년 {{ calendarDate.getMonth() + 1 }}월</h4>
          <button @click="nextMonth">&gt;</button>
        </div>
        <div class="calendar-grid">
          <div v-for="day in ['일','월','화','수','목','금','토']" :key="day" class="calendar-header">{{ day }}</div>
          <div v-for="(cell, idx) in calendarDays" :key="idx"
            :class="['calendar-cell', {
              'other-month': !cell.isCurrentMonth,
              'today': cell.date === todayStr,
              'selected': cell.date === selectedDate,
            }]"
            @click="selectCalendarDate(cell.date)">
            <span class="calendar-day-num">{{ cell.day }}</span>
            <div v-if="tasksByDate[cell.date]" class="calendar-dots">
              <span v-if="tasksByDate[cell.date].overdue > 0" class="dot-overdue"></span>
              <span v-if="tasksByDate[cell.date].today > 0" class="dot-today"></span>
              <span v-if="tasksByDate[cell.date].planned > 0" class="dot-planned"></span>
            </div>
          </div>
        </div>

        <!-- 선택 날짜 작업 리스트 -->
        <div v-if="selectedDate" class="selected-date-tasks">
          <h4 class="section-title">{{ selectedDate.slice(5).replace('-', '월 ') }}일 작업</h4>
          <div v-if="selectedDateTasks.length === 0" class="empty-hint">해당 날짜에 작업이 없습니다.</div>
          <div v-for="occ in selectedDateTasks" :key="occ.id"
            :class="['task-card', {
              overdue: occ.scheduledDate < todayStr,
              today: occ.scheduledDate === todayStr,
            }]">
            <div class="task-main">
              <span class="task-name">{{ occ.taskName }}</span>
              <span class="task-batch-info">{{ occ.cropName }} · {{ occ.groupName || occ.houseName }}</span>
            </div>
            <div class="task-actions">
              <button class="btn-sm accent" @click="handleTaskComplete(occ)">완료</button>
              <button v-if="occ.scheduledDate <= todayStr" class="btn-sm" @click="handleTaskSkip(occ.id)">건너뛰기</button>
            </div>
          </div>
        </div>
      </template>
    </template>

    <!-- ───── 탭: 완료 ───── -->
    <template v-if="!loading && tab === 'completed'">
      <div v-if="completedBatches.length === 0" class="empty-state">
        <p>완료된 배치가 없습니다.</p>
      </div>
      <div v-else class="batch-list">
        <div v-for="batch in completedBatches" :key="batch.id" class="batch-card completed">
          <div class="batch-header">
            <div class="batch-title">
              <h3>{{ batch.cropName }} {{ batch.variety ? `/ ${batch.variety}` : '' }}</h3>
              <span v-if="getGroupName(batch.groupId)" class="batch-group">{{ getGroupName(batch.groupId) }}</span>
            </div>
            <div class="batch-menu">
              <button class="btn-icon-sm" @click="toggleMenu(batch.id)">&#8942;</button>
              <div v-if="openMenuId === batch.id" class="dropdown-menu">
                <button @click="handleClone(batch)">복제</button>
                <button class="danger" @click="handleDelete(batch.id)">삭제</button>
              </div>
            </div>
          </div>
          <div class="batch-info">
            <span>파종: {{ batch.sowDate }}</span>
            <span class="dot">·</span>
            <span>완료: {{ batch.completedAt?.slice(0, 10) }}</span>
          </div>
        </div>
      </div>
    </template>

    <!-- ───── 배치 추가/수정 모달 ───── -->
    <div v-if="showModal" class="modal-overlay" @click.self="showModal = false">
      <div class="modal-content">
        <h3>{{ editingBatch ? '배치 수정' : '배치 추가' }}</h3>

        <div class="form-group">
          <label>프리셋</label>
          <select v-model="selectedPreset" @change="applyPreset">
            <option value="">직접 입력</option>
            <option v-for="p in CROP_PRESETS" :key="p.name + p.variety" :value="p.name + '|' + p.variety">
              {{ p.name }} ({{ p.variety }}) — {{ p.growDays }}일
            </option>
          </select>
        </div>

        <div class="form-group">
          <label>작물명 *</label>
          <input v-model="form.cropName" placeholder="예: 방울토마토" />
        </div>

        <div class="form-group">
          <label>품종</label>
          <input v-model="form.variety" placeholder="예: 대추방울" />
        </div>

        <div class="form-group">
          <label>그룹</label>
          <select v-model="form.groupId">
            <option value="">선택 안함</option>
            <option v-for="g in groups" :key="g.id" :value="g.id">{{ g.name }}</option>
          </select>
        </div>

        <div class="form-group">
          <label>파종일 *</label>
          <VueDatePicker
            v-model="form.sowDate"
            :model-type="'yyyy-MM-dd'"
            :format="'yyyy-MM-dd'"
            :locale="ko"
            :dark="isDark"
            :enable-time-picker="false"
            :teleport="false"
            auto-apply
          />
        </div>

        <div class="form-group">
          <label>정식일</label>
          <VueDatePicker
            v-model="form.transplantDate"
            :model-type="'yyyy-MM-dd'"
            :format="'yyyy-MM-dd'"
            :locale="ko"
            :dark="isDark"
            :enable-time-picker="false"
            :teleport="false"
            auto-apply
          />
        </div>

        <div class="form-group">
          <label>생육기간 (일) *</label>
          <input type="number" v-model.number="form.growDays" min="1" max="365" />
        </div>

        <div class="form-group">
          <label>메모</label>
          <textarea v-model="form.memo" maxlength="200" rows="2" placeholder="메모 (선택)"></textarea>
        </div>

        <div class="modal-actions">
          <button class="btn-secondary" @click="showModal = false">취소</button>
          <button class="btn-primary" @click="saveBatch" :disabled="!isFormValid">저장</button>
        </div>
      </div>
    </div>

    <!-- ───── 작업 완료 시트 ───── -->
    <RescheduleSheet
      v-if="rescheduleTarget"
      :occurrence="rescheduleTarget"
      :show-feedback="needsFeedback(rescheduleTarget.intervalMinDays, rescheduleTarget.intervalMaxDays)"
      @close="rescheduleTarget = null"
      @confirm="handleRescheduleConfirm"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch, onBeforeUnmount } from 'vue'
import { harvestApi, type CropBatch, type CreateBatchRequest } from '../api/harvest.api'
import { harvestTaskApi, type OccurrenceWithContext, type TaskSummary } from '../api/harvest-task.api'
import { groupApi } from '../api/group.api'
import type { HouseGroup } from '../types/group.types'
import { CROP_PRESETS } from '../utils/harvest-presets'
import { getStageInfo, needsFeedback } from '../utils/task-presets'
import { useNotificationStore } from '../stores/notification.store'
import RescheduleSheet from '../components/harvest/RescheduleSheet.vue'
import { VueDatePicker } from '@vuepic/vue-datepicker'
import '@vuepic/vue-datepicker/dist/main.css'
import { ko } from 'date-fns/locale'
import { useLocalStorage } from '@vueuse/core'

const notificationStore = useNotificationStore()
const sfTheme = useLocalStorage('sf-theme', 'light')
const isDark = computed(() => sfTheme.value === 'dark')

const loading = ref(true)
const batches = ref<CropBatch[]>([])
const groups = ref<HouseGroup[]>([])
const tab = ref<'batches' | 'tasks' | 'completed'>('batches')
const openMenuId = ref<string | null>(null)
const batchSummaries = ref<Record<string, TaskSummary>>({})

// Task tab
const occurrencesLoading = ref(false)
const allOccurrences = ref<OccurrenceWithContext[]>([])
const taskFilter = ref({ groupId: '', batchId: '' })
const viewMode = ref<'list' | 'calendar'>('list')

// Calendar
const calendarDate = ref(new Date())
const selectedDate = ref('')

// Modal
const showModal = ref(false)
const editingBatch = ref<CropBatch | null>(null)
const selectedPreset = ref('')
const form = ref<CreateBatchRequest>({
  cropName: '',
  variety: '',
  groupId: '',
  sowDate: formatLocalDate(new Date()),
  transplantDate: '',
  growDays: 100,
  memo: '',
})

// Reschedule
const rescheduleTarget = ref<OccurrenceWithContext | null>(null)

// ── Computed ──
const activeBatches = computed(() => batches.value.filter(b => b.status === 'active'))
const completedBatches = computed(() => batches.value.filter(b => b.status === 'completed'))

const isFormValid = computed(() =>
  form.value.cropName.trim() !== '' &&
  form.value.sowDate !== '' &&
  form.value.growDays >= 1 && form.value.growDays <= 365
)

function formatLocalDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const todayStr = computed(() => formatLocalDate(new Date()))

const overdueTasks = computed(() =>
  allOccurrences.value.filter(o => o.status === 'planned' && o.scheduledDate < todayStr.value)
)
const todayTasks = computed(() =>
  allOccurrences.value.filter(o => o.status === 'planned' && o.scheduledDate === todayStr.value)
)
const upcomingTasks = computed(() =>
  allOccurrences.value.filter(o => o.status === 'planned' && o.scheduledDate > todayStr.value)
)

// Calendar computed
const calendarDays = computed(() => {
  const year = calendarDate.value.getFullYear()
  const month = calendarDate.value.getMonth()
  const firstDay = new Date(year, month, 1)
  const startDate = new Date(firstDay)
  startDate.setDate(startDate.getDate() - firstDay.getDay())

  const days: { date: string; day: number; isCurrentMonth: boolean }[] = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(startDate)
    d.setDate(d.getDate() + i)
    days.push({
      date: formatLocalDate(d),
      day: d.getDate(),
      isCurrentMonth: d.getMonth() === month,
    })
  }
  return days
})

const tasksByDate = computed(() => {
  const map: Record<string, { overdue: number; today: number; planned: number }> = {}
  const todayVal = todayStr.value
  for (const occ of allOccurrences.value) {
    if (occ.status !== 'planned') continue
    const d = occ.scheduledDate
    if (!map[d]) map[d] = { overdue: 0, today: 0, planned: 0 }
    if (d < todayVal) map[d].overdue++
    else if (d === todayVal) map[d].today++
    else map[d].planned++
  }
  return map
})

const selectedDateTasks = computed(() => {
  if (!selectedDate.value) return []
  return allOccurrences.value.filter(
    o => o.scheduledDate === selectedDate.value && o.status === 'planned'
  )
})

// ── Functions ──
function getGroupName(groupId: string | null): string {
  if (!groupId) return ''
  return groups.value.find(g => g.id === groupId)?.name || ''
}

function calcProgress(batch: CropBatch): number {
  const sow = new Date(batch.sowDate)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const elapsed = (today.getTime() - sow.getTime()) / 86400000
  return Math.round(Math.max(0, Math.min(1, elapsed / batch.growDays)) * 100)
}

async function loadBatches() {
  loading.value = true
  try {
    const res = await harvestApi.getBatches()
    batches.value = res.data
    const active = batches.value.filter(b => b.status === 'active')
    const summaryPromises = active.map(b =>
      harvestTaskApi.getTaskSummary(b.id).then(r => ({ id: b.id, data: r.data })).catch(() => null)
    )
    const results = await Promise.all(summaryPromises)
    const map: Record<string, TaskSummary> = {}
    results.forEach(r => { if (r) map[r.id] = r.data })
    batchSummaries.value = map
  } catch {
    notificationStore.error('오류', '배치 목록을 불러오지 못했습니다.')
  } finally {
    loading.value = false
  }
}

async function loadGroups() {
  try {
    const res = await groupApi.getGroups()
    groups.value = res.data
  } catch { /* ok */ }
}

async function loadOccurrences() {
  occurrencesLoading.value = true
  try {
    const today = new Date()
    const start = new Date(today)
    start.setDate(start.getDate() - 30)
    const end = new Date(today)
    end.setDate(end.getDate() + 365)
    const params: { startDate: string; endDate: string; groupId?: string; batchId?: string } = {
      startDate: formatLocalDate(start),
      endDate: formatLocalDate(end),
    }
    if (taskFilter.value.groupId) params.groupId = taskFilter.value.groupId
    if (taskFilter.value.batchId) params.batchId = taskFilter.value.batchId
    const res = await harvestTaskApi.getOccurrences(params)
    allOccurrences.value = res.data
  } catch {
    notificationStore.error('오류', '작업 목록을 불러오지 못했습니다.')
  } finally {
    occurrencesLoading.value = false
  }
}

function switchToTasks() {
  tab.value = 'tasks'
  if (viewMode.value === 'calendar') {
    loadOccurrencesForCalendar()
  } else {
    loadOccurrences()
  }
}

function switchToList() {
  viewMode.value = 'list'
  loadOccurrences()
}

async function switchToCalendar() {
  viewMode.value = 'calendar'
  await loadOccurrencesForCalendar()
  // 현재 달에 작업이 없으면 첫 작업이 있는 달로 자동 이동
  if (allOccurrences.value.length === 0 && activeBatches.value.length > 0) {
    await navigateToFirstTask()
  }
}

async function navigateToFirstTask() {
  try {
    const today = new Date()
    const end = new Date(today)
    end.setDate(end.getDate() + 365)
    const params: { startDate: string; endDate: string; groupId?: string; batchId?: string } = {
      startDate: formatLocalDate(today),
      endDate: formatLocalDate(end),
    }
    if (taskFilter.value.groupId) params.groupId = taskFilter.value.groupId
    if (taskFilter.value.batchId) params.batchId = taskFilter.value.batchId
    const res = await harvestTaskApi.getOccurrences(params)
    if (res.data.length > 0) {
      const firstDate = new Date(res.data[0].scheduledDate)
      calendarDate.value = new Date(firstDate.getFullYear(), firstDate.getMonth(), 1)
      await loadOccurrencesForCalendar()
    }
  } catch { /* ignore */ }
}

async function loadOccurrencesForCalendar() {
  occurrencesLoading.value = true
  try {
    const year = calendarDate.value.getFullYear()
    const month = calendarDate.value.getMonth()
    const firstDay = new Date(year, month, 1)
    const start = new Date(firstDay)
    start.setDate(start.getDate() - firstDay.getDay())
    const end = new Date(start)
    end.setDate(end.getDate() + 41)

    const params: { startDate: string; endDate: string; groupId?: string; batchId?: string } = {
      startDate: formatLocalDate(start),
      endDate: formatLocalDate(end),
    }
    if (taskFilter.value.groupId) params.groupId = taskFilter.value.groupId
    if (taskFilter.value.batchId) params.batchId = taskFilter.value.batchId
    const res = await harvestTaskApi.getOccurrences(params)
    allOccurrences.value = res.data
  } catch {
    notificationStore.error('오류', '작업 목록을 불러오지 못했습니다.')
  } finally {
    occurrencesLoading.value = false
  }
}

function prevMonth() {
  const d = new Date(calendarDate.value)
  d.setMonth(d.getMonth() - 1)
  calendarDate.value = d
  selectedDate.value = ''
  loadOccurrencesForCalendar()
}

function nextMonth() {
  const d = new Date(calendarDate.value)
  d.setMonth(d.getMonth() + 1)
  calendarDate.value = d
  selectedDate.value = ''
  loadOccurrencesForCalendar()
}

function selectCalendarDate(date: string) {
  selectedDate.value = selectedDate.value === date ? '' : date
}

function openModal(batch?: CropBatch) {
  openMenuId.value = null
  editingBatch.value = batch || null
  selectedPreset.value = ''
  if (batch) {
    form.value = {
      cropName: batch.cropName,
      variety: batch.variety || '',
      groupId: batch.groupId || '',
      sowDate: batch.sowDate,
      transplantDate: batch.transplantDate || '',
      growDays: batch.growDays,
      memo: batch.memo || '',
    }
  } else {
    form.value = {
      cropName: '',
      variety: '',
      groupId: '',
      sowDate: formatLocalDate(new Date()),
      transplantDate: '',
      growDays: 100,
      memo: '',
    }
  }
  showModal.value = true
}

function applyPreset() {
  if (!selectedPreset.value) return
  const [name, variety] = selectedPreset.value.split('|')
  const preset = CROP_PRESETS.find(p => p.name === name && p.variety === variety)
  if (preset) {
    form.value.cropName = preset.name
    form.value.variety = preset.variety
    form.value.growDays = preset.growDays
  }
}

async function saveBatch() {
  try {
    const payload: CreateBatchRequest = {
      cropName: form.value.cropName,
      sowDate: form.value.sowDate,
      growDays: form.value.growDays,
    }
    if (form.value.groupId) payload.groupId = form.value.groupId
    if (form.value.transplantDate) payload.transplantDate = form.value.transplantDate
    if (form.value.variety) payload.variety = form.value.variety
    if (form.value.memo) payload.memo = form.value.memo

    if (editingBatch.value) {
      await harvestApi.updateBatch(editingBatch.value.id, payload)
      notificationStore.success('수정 완료', '배치가 수정되었습니다.')
    } else {
      await harvestApi.createBatch(payload)
      notificationStore.success('추가 완료', '새 배치가 추가되었습니다.')
    }
    showModal.value = false
    await loadBatches()
  } catch {
    notificationStore.error('오류', '저장에 실패했습니다.')
  }
}

async function handleComplete(id: string) {
  openMenuId.value = null
  if (!confirm('이 배치를 수확 완료 처리하시겠습니까?')) return
  try {
    await harvestApi.completeBatch(id)
    notificationStore.success('수확 완료', '배치가 완료 처리되었습니다.')
    await loadBatches()
  } catch {
    notificationStore.error('오류', '완료 처리에 실패했습니다.')
  }
}

async function handleClone(batch: CropBatch) {
  openMenuId.value = null
  try {
    await harvestApi.cloneBatch(batch.id, batch.houseName)
    notificationStore.success('복제 완료', '배치가 복제되었습니다.')
    await loadBatches()
  } catch {
    notificationStore.error('오류', '복제에 실패했습니다.')
  }
}

async function handleDelete(id: string) {
  openMenuId.value = null
  if (!confirm('이 배치를 삭제하시겠습니까?')) return
  try {
    await harvestApi.deleteBatch(id)
    notificationStore.success('삭제 완료', '배치가 삭제되었습니다.')
    await loadBatches()
  } catch {
    notificationStore.error('오류', '삭제에 실패했습니다.')
  }
}

// ── Task actions ──
function handleTaskComplete(occ: OccurrenceWithContext) {
  rescheduleTarget.value = occ
}

async function handleRescheduleConfirm(mode: string, remember: boolean, growthFeedback?: string) {
  if (!rescheduleTarget.value) return
  try {
    await harvestTaskApi.completeOccurrence(rescheduleTarget.value.id, {
      rescheduleMode: mode,
      rememberChoice: remember,
      growthFeedback,
    })
    notificationStore.success('완료', '작업이 완료 처리되었습니다.')
    rescheduleTarget.value = null
    await loadOccurrences()
    await loadBatches()
  } catch {
    notificationStore.error('오류', '작업 완료에 실패했습니다.')
  }
}

async function handleTaskPostpone(id: string) {
  try {
    await harvestTaskApi.postponeOccurrence(id)
    notificationStore.success('미루기', '작업이 내일로 미뤄졌습니다.')
    await loadOccurrences()
  } catch {
    notificationStore.error('오류', '작업 미루기에 실패했습니다.')
  }
}

async function handleTaskSkip(id: string) {
  if (!confirm('이 작업을 건너뛰시겠습니까?')) return
  try {
    await harvestTaskApi.skipOccurrence(id)
    notificationStore.success('건너뛰기', '작업을 건너뛰었습니다.')
    await loadOccurrences()
  } catch {
    notificationStore.error('오류', '건너뛰기에 실패했습니다.')
  }
}

function toggleMenu(id: string) {
  openMenuId.value = openMenuId.value === id ? null : id
}

// 모달 열림 시 배경 스크롤 차단
watch(() => showModal.value, (open) => {
  document.body.style.overflow = open ? 'hidden' : ''
})
onBeforeUnmount(() => { document.body.style.overflow = '' })

onMounted(() => {
  loadBatches()
  loadGroups()
})
</script>

<style scoped>
.page-container { padding: 24px; max-width: 900px; margin: 0 auto; }

.page-header {
  display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px;
}
.page-header h2 { font-size: calc(1.4em * var(--content-title-scale, 1)); font-weight: 700; color: var(--text-primary); }
.page-description { color: var(--text-muted); margin-top: 4px; }

.btn-primary {
  padding: 10px 20px; background: var(--accent); color: white; border: none;
  border-radius: 8px; font-weight: 600; cursor: pointer; white-space: nowrap;
}
.btn-primary:hover { background: var(--accent-hover); }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

.btn-secondary {
  padding: 10px 20px; background: var(--bg-hover); color: var(--text-primary);
  border: 1px solid var(--border-color); border-radius: 8px; font-weight: 500; cursor: pointer;
}

/* 탭 */
.tab-bar { display: flex; gap: 4px; margin-bottom: 20px; border-bottom: 2px solid var(--border-light); }
.tab {
  padding: 10px 20px; background: none; border: none; border-bottom: 2px solid transparent;
  margin-bottom: -2px; font-weight: 500; color: var(--text-muted); cursor: pointer;
}
.tab.active { color: var(--accent); border-bottom-color: var(--accent); font-weight: 600; }

.loading-state, .empty-state { text-align: center; padding: 60px 20px; color: var(--text-muted); }
.empty-state .btn-primary { margin-top: 16px; }

/* 배치 카드 */
.batch-list { display: flex; flex-direction: column; gap: 14px; }
.batch-card {
  background: var(--bg-card); border: 1px solid var(--border-card);
  border-radius: 12px; padding: 18px; box-shadow: var(--shadow-card);
}
.batch-card.completed { opacity: 0.8; }

.batch-header { display: flex; align-items: flex-start; gap: 10px; margin-bottom: 10px; }
.batch-title { flex: 1; min-width: 0; }
.batch-title h3 { font-size: 1.05em; font-weight: 600; color: var(--text-primary); }
.batch-group { font-size: 0.85em; color: var(--text-muted); }

.stage-badge {
  padding: 4px 10px; border-radius: 20px; font-size: 0.82em;
  font-weight: 600; white-space: nowrap; flex-shrink: 0;
}

.batch-menu { position: relative; }
.btn-icon-sm {
  background: none; border: none; font-size: 1.2em; cursor: pointer;
  padding: 4px 8px; border-radius: 6px; color: var(--text-muted);
}
.btn-icon-sm:hover { background: var(--bg-hover); }

.dropdown-menu {
  position: absolute; right: 0; top: 100%; background: var(--bg-card);
  border: 1px solid var(--border-card); border-radius: 8px;
  box-shadow: var(--shadow-card); z-index: 10; min-width: 120px; overflow: hidden;
}
.dropdown-menu button {
  display: block; width: 100%; padding: 10px 14px; background: none; border: none;
  text-align: left; font-size: 0.9em; cursor: pointer; color: var(--text-primary);
}
.dropdown-menu button:hover { background: var(--bg-hover); }
.dropdown-menu button.danger { color: var(--danger); }

.batch-info { display: flex; gap: 6px; font-size: 0.85em; color: var(--text-secondary); margin-bottom: 8px; flex-wrap: wrap; }
.dot { color: var(--text-muted); }

.progress-bar { height: 6px; background: var(--bg-hover); border-radius: 3px; overflow: hidden; margin-bottom: 10px; }
.progress-fill { height: 100%; background: var(--accent); border-radius: 3px; transition: width 0.3s; }

/* 작업 요약 (배치 카드 내부) */
.task-summary { padding-top: 10px; border-top: 1px solid var(--border-light); }
.summary-label { font-size: 0.78em; font-weight: 600; color: var(--text-muted); margin-bottom: 4px; margin-top: 6px; }
.summary-label.upcoming { margin-top: 8px; }
.summary-task { font-size: 0.85em; color: var(--text-secondary); padding: 2px 0; display: flex; align-items: center; gap: 6px; }
.summary-task.muted { color: var(--text-muted); }
.summary-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.summary-dot.planned { background: var(--warning); }
.summary-dot.done { background: var(--accent); }

.batch-memo {
  font-size: 0.8em; color: var(--text-muted); margin-top: 8px;
  padding-top: 8px; border-top: 1px solid var(--border-light);
}

/* 필터 + 뷰 전환 */
.filter-row { display: flex; gap: 8px; margin-bottom: 16px; align-items: center; }
.filter-select {
  flex: 1; padding: 8px 12px; border: 1px solid var(--border-input);
  border-radius: 8px; background: var(--bg-input); color: var(--text-primary); font-size: 0.9em;
}
.view-toggle {
  display: flex; border: 1px solid var(--border-input); border-radius: 8px; overflow: hidden; flex-shrink: 0;
}
.view-toggle button {
  padding: 7px 14px; background: none; border: none;
  font-size: 0.85em; cursor: pointer; color: var(--text-muted);
}
.view-toggle button.active {
  background: var(--accent); color: white; font-weight: 600;
}

/* 달력 */
.calendar-nav {
  display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;
}
.calendar-nav h4 { font-size: 1em; font-weight: 600; color: var(--text-primary); }
.calendar-nav button {
  background: none; border: none; font-size: 1.2em;
  cursor: pointer; padding: 4px 12px; color: var(--text-secondary); border-radius: 6px;
}
.calendar-nav button:hover { background: var(--bg-hover); }

.calendar-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }
.calendar-header {
  text-align: center; font-size: 0.78em; font-weight: 600;
  color: var(--text-muted); padding: 6px 0;
}
.calendar-cell {
  min-height: 52px; padding: 4px; text-align: center;
  border-radius: 8px; cursor: pointer; font-size: 0.85em;
  color: var(--text-primary); display: flex; flex-direction: column;
  align-items: center; gap: 2px;
}
.calendar-cell:hover { background: var(--bg-hover); }
.calendar-cell.other-month { color: var(--text-muted); opacity: 0.4; }
.calendar-cell.today { background: var(--accent-bg); font-weight: 700; }
.calendar-cell.selected { background: var(--accent); color: white; }
.calendar-cell.selected .dot-overdue,
.calendar-cell.selected .dot-today,
.calendar-cell.selected .dot-planned { background: white; }
.calendar-day-num { font-size: 0.9em; line-height: 1.4; }

.calendar-dots { display: flex; gap: 3px; justify-content: center; }
.dot-overdue { width: 6px; height: 6px; border-radius: 50%; background: var(--danger); }
.dot-today { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); }
.dot-planned { width: 6px; height: 6px; border-radius: 50%; background: var(--text-muted); }

.selected-date-tasks { margin-top: 16px; }
.empty-hint { font-size: 0.88em; color: var(--text-muted); padding: 12px 0; }

/* 작업 섹션 */
.task-section { margin-bottom: 20px; }
.section-title { font-size: 0.92em; font-weight: 600; margin-bottom: 10px; color: var(--text-secondary); }
.section-title.danger { color: var(--danger); }
.section-title.today { color: var(--accent); }

.task-card {
  background: var(--bg-card); border: 1px solid var(--border-card);
  border-radius: 10px; padding: 14px 16px; margin-bottom: 8px;
  display: flex; flex-wrap: wrap; align-items: center; gap: 10px;
}
.task-card.overdue { border-left: 3px solid var(--danger); }
.task-card.today { border-left: 3px solid var(--accent); }

.task-main { flex: 1; min-width: 0; }
.task-name { font-weight: 600; font-size: 0.95em; color: var(--text-primary); display: block; }
.task-batch-info { font-size: 0.82em; color: var(--text-muted); }
.task-window { font-size: 0.78em; color: var(--text-muted); margin-left: 6px; }
.task-date { font-size: 0.85em; color: var(--danger); font-weight: 600; }

.task-actions { display: flex; gap: 6px; flex-shrink: 0; }
.btn-sm {
  padding: 6px 12px; font-size: 0.82em; border: 1px solid var(--border-input);
  border-radius: 6px; background: var(--bg-input); color: var(--text-secondary);
  cursor: pointer; font-weight: 500;
}
.btn-sm:hover { background: var(--bg-hover); }
.btn-sm.accent { background: var(--accent); color: white; border-color: var(--accent); }
.btn-sm.accent:hover { background: var(--accent-hover); }

/* 모달 공통 */
.modal-overlay {
  position: fixed; top: 0; left: 0; right: 0; bottom: 0;
  background: var(--overlay); display: flex; align-items: center;
  justify-content: center; z-index: 300; padding: 20px;
}
.modal-content {
  background: var(--bg-card); border-radius: 14px; padding: 28px;
  width: 100%; max-width: 480px; max-height: 85vh;
  overflow-y: auto; box-shadow: var(--shadow-modal);
}
.modal-content h3 { font-size: 1.2em; font-weight: 700; margin-bottom: 20px; color: var(--text-primary); }

.form-group { margin-bottom: 16px; }
.form-group label { display: block; font-size: 0.85em; font-weight: 600; margin-bottom: 6px; color: var(--text-secondary); }
.form-group input, .form-group select, .form-group textarea {
  width: 100%; padding: 10px 12px; border: 1px solid var(--border-input);
  border-radius: 8px; background: var(--bg-input); color: var(--text-primary); font-size: 0.95em;
}
.form-group input:focus, .form-group select:focus, .form-group textarea:focus {
  outline: 2px solid var(--accent); outline-offset: -1px;
}

.modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 24px; }

@media (max-width: 768px) {
  .page-container { padding: 16px; }
  .page-header { flex-direction: column; gap: 12px; }
  .filter-row { flex-wrap: wrap; }
  .filter-select { min-width: 0; }
  .view-toggle { width: 100%; }
  .view-toggle button { flex: 1; }
  .task-card { flex-direction: column; align-items: stretch; }
  .task-actions { justify-content: flex-end; }
  .modal-overlay { padding: 0; }
  .modal-content {
    padding: 20px;
    border-radius: 0;
    max-width: 100%;
    max-height: 100%;
    height: 100vh;
    height: 100dvh;
    overflow-y: auto;
    padding-top: calc(20px + env(safe-area-inset-top, 0px));
    padding-bottom: env(safe-area-inset-bottom, 0);
  }
  .calendar-cell { min-height: 44px; }
}
</style>
