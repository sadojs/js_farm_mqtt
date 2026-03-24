<template>
  <div class="page-container">
    <!-- 헤더 -->
    <header class="page-header">
      <div>
        <h2>수확 관리</h2>
        <p class="page-description">환경 기반 작업 추천 · 품질 관리</p>
      </div>
      <div class="header-actions">
        <button class="btn-outline" @click="showScheduleModal = true">📋 작업 기준표</button>
        <button class="btn-primary" @click="openBatchModal()">+ 배치 추가</button>
      </div>
    </header>

    <!-- 로딩 -->
    <div v-if="loading" class="loading-state">추천 정보 불러오는 중...</div>

    <!-- 배치 없음 -->
    <template v-else-if="!data?.activeBatch">
      <div class="empty-state">
        <div class="empty-icon">🌱</div>
        <p>작물 배치를 등록하면 환경 기반 관리 추천이 시작됩니다</p>
        <button class="btn-primary" @click="openBatchModal()">첫 번째 배치 추가</button>
      </div>
    </template>

    <!-- 메인 컨텐츠 -->
    <template v-else>
      <!-- 환경 요약 배너 -->
      <div :class="['summary-banner', `summary-${data.summary.status}`]">
        <div class="summary-main">
          <span class="summary-icon">{{ summaryIcon }}</span>
          <div class="summary-text">
            <strong>{{ data.summary.statusLabel }}</strong>
            <span>{{ data.summary.mainReason }}</span>
          </div>
        </div>
        <div v-if="data.summary.subInfo" class="summary-sub">{{ data.summary.subInfo }}</div>
        <div class="env-chips">
          <span v-if="data.environment.temperature != null" class="env-chip">
            🌡️ {{ data.environment.temperature.toFixed(1) }}°C
          </span>
          <span v-if="data.environment.humidity != null" class="env-chip">
            💧 {{ data.environment.humidity.toFixed(0) }}%
          </span>
          <span v-if="data.environment.vpdStatus" :class="['env-chip', `vpd-${data.environment.vpdStatus.toLowerCase()}`]">
            VPD {{ data.environment.vpdValue?.toFixed(2) }} ({{ vpdLabel }})
          </span>
          <span v-if="data.environment.condensationLevel && data.environment.condensationLevel !== 'safe'"
            :class="['env-chip', `cond-${data.environment.condensationLevel}`]">
            결로 {{ condensationLabel }}
          </span>
        </div>
      </div>

      <!-- 배치 정보 칩 -->
      <div class="batch-info-bar" @click="showBatchSection = !showBatchSection">
        <span class="batch-name">{{ data.activeBatch.cropName }}</span>
        <span class="batch-stage" :style="{ color: stageColor }">{{ stageLabel }}</span>
        <span class="batch-days">{{ data.activeBatch.growDays }}일차</span>
        <span class="toggle-icon">{{ showBatchSection ? '▲' : '▼' }}</span>
      </div>

      <!-- 배치 상세 (접이식) -->
      <div v-if="showBatchSection" class="batch-detail">
        <div class="detail-row">
          <span>파종일</span><span>{{ data.activeBatch.sowDate }}</span>
        </div>
        <div v-if="data.activeBatch.transplantDate" class="detail-row">
          <span>정식일</span><span>{{ data.activeBatch.transplantDate }}</span>
        </div>
        <div class="detail-row">
          <span>생육 단계</span><span>{{ stageLabel }}</span>
        </div>
        <div v-if="data.activeBatch.variety" class="detail-row">
          <span>품종</span><span>{{ data.activeBatch.variety }}</span>
        </div>
        <div v-if="data.activeBatch.memo" class="detail-row">
          <span>메모</span><span>{{ data.activeBatch.memo }}</span>
        </div>
        <div class="batch-actions">
          <button class="btn-sm" @click="openBatchModal(data?.activeBatch ?? undefined)">배치 수정</button>
          <button class="btn-sm danger" @click="handleDeleteBatch">배치 삭제</button>
        </div>
      </div>

      <!-- 추천 카드 -->
      <div class="recommendation-cards">
        <div v-for="(card, idx) in data.cards" :key="card.taskType"
          :class="['rec-card', `status-${card.status.toLowerCase()}`, { highlight: idx < 2, snoozed: snoozed.has(card.taskType) }]">

          <!-- 카드 헤더 -->
          <div class="card-header">
            <span class="card-icon">{{ card.icon }}</span>
            <span class="card-name">{{ card.taskName }}</span>
            <span :class="['status-badge', card.status.toLowerCase()]">{{ statusLabel(card.status) }}</span>
          </div>

          <!-- 우선순위 게이지 -->
          <div class="score-section">
            <div class="score-label">
              <span>우선순위</span>
              <span :class="['score-value', scoreColor(card.priorityScore)]">{{ card.priorityScore }}</span>
            </div>
            <div class="score-bar">
              <div class="score-fill" :class="scoreColor(card.priorityScore)"
                :style="{ width: card.priorityScore + '%' }"></div>
            </div>
          </div>

          <!-- 정보 -->
          <div class="card-info">
            <div class="info-row">
              <span>📅</span>
              <span>권장: {{ card.recommendedWindowStart.slice(5) }} ~ {{ card.recommendedWindowEnd.slice(5) }}</span>
            </div>
            <div class="info-row">
              <span>⏱</span>
              <span v-if="card.daysSinceLast != null">
                {{ delayText(card) }}
              </span>
              <span v-else>아직 수행 이력 없음</span>
            </div>
            <div v-if="card.lastCompletedAt" class="info-row">
              <span>📋</span>
              <span>마지막 완료: {{ card.daysSinceLast }}일 전</span>
            </div>
          </div>

          <!-- 추천 사유 -->
          <div class="reasons">
            <div class="reasons-title">💡 추천 이유</div>
            <div v-for="(reason, ri) in card.reasons" :key="ri" class="reason-item">· {{ reason }}</div>
          </div>

          <!-- 효과 잔여 -->
          <div v-if="card.effectRemaining" class="effect-bar">
            <span class="effect-label">방제 효과</span>
            <div class="effect-track">
              <div class="effect-fill" :style="{ width: effectPercent(card) + '%' }"></div>
            </div>
            <span class="effect-days">{{ card.effectRemaining }}일 남음</span>
          </div>

          <!-- 액션 버튼 -->
          <div class="card-actions">
            <button class="btn-complete" @click="handleComplete(card.taskType)"
              :disabled="completing === card.taskType">
              {{ completing === card.taskType ? '처리 중...' : '✓ 완료' }}
            </button>
            <button class="btn-postpone" @click="handlePostpone(card.taskType)"
              :disabled="snoozed.has(card.taskType)">
              {{ snoozed.has(card.taskType) ? '미룸' : '1일 미루기' }}
            </button>
          </div>
        </div>
      </div>
    </template>

    <!-- 배치 추가/수정 모달 -->
    <div v-if="showBatchModal" class="modal-overlay" @click.self="showBatchModal = false">
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
          <input v-model="batchForm.cropName" placeholder="예: 방울토마토" />
        </div>

        <div class="form-group">
          <label>품종</label>
          <input v-model="batchForm.variety" placeholder="예: 대추방울" />
        </div>

        <div class="form-group">
          <label>그룹</label>
          <select v-model="batchForm.groupId">
            <option value="">선택 안함</option>
            <option v-for="g in groups" :key="g.id" :value="g.id">{{ g.name }}</option>
          </select>
        </div>

        <div class="form-group">
          <label>파종일 *</label>
          <input type="date" v-model="batchForm.sowDate" />
        </div>

        <div class="form-group">
          <label>정식일</label>
          <input type="date" v-model="batchForm.transplantDate" />
        </div>

        <div class="form-group">
          <label>생육기간 (일) *</label>
          <input type="number" v-model.number="batchForm.growDays" min="1" max="365" />
        </div>

        <div class="form-group">
          <label>메모</label>
          <textarea v-model="batchForm.memo" maxlength="200" rows="2" placeholder="메모 (선택)"></textarea>
        </div>

        <div class="modal-actions">
          <button class="btn-secondary" @click="showBatchModal = false">취소</button>
          <button class="btn-primary" @click="saveBatch" :disabled="!isBatchFormValid">저장</button>
        </div>
      </div>
    </div>

    <!-- 작업 기준표 모달 -->
    <div v-if="showScheduleModal" class="modal-overlay" @click.self="showScheduleModal = false">
      <div class="modal-content schedule-modal">
        <div class="schedule-header">
          <h3>📋 작업 기준표</h3>
          <span class="schedule-region">강원도 횡성군 군내면 기준</span>
        </div>

        <div v-for="task in TASK_SCHEDULE" :key="task.taskType" class="schedule-task">
          <div class="schedule-task-header">
            <span class="schedule-task-icon">{{ task.icon }}</span>
            <span class="schedule-task-name">{{ task.taskName }}</span>
          </div>
          <p class="schedule-desc">{{ task.description }}</p>

          <div class="schedule-section">
            <div class="schedule-label">첫 작업 시기</div>
            <div class="schedule-grid">
              <div class="schedule-cell">
                <span class="cell-label">정식 후</span>
                <span class="cell-value">{{ task.firstTiming.afterTransplant }}</span>
              </div>
              <div class="schedule-cell">
                <span class="cell-label">파종 기준</span>
                <span class="cell-value">{{ task.firstTiming.afterSow }}</span>
              </div>
              <div class="schedule-cell">
                <span class="cell-label">효과 지속</span>
                <span class="cell-value">{{ task.effectDuration }}</span>
              </div>
            </div>
          </div>

          <div class="schedule-section">
            <div class="schedule-label">단계별 반복 간격</div>
            <div v-for="si in task.stageIntervals" :key="si.stage" class="stage-row">
              <span class="stage-name">{{ si.label }}</span>
              <span class="stage-interval">{{ si.interval }}</span>
              <span class="stage-note">{{ si.note }}</span>
            </div>
          </div>

          <div class="schedule-section">
            <div class="schedule-label">관리 팁</div>
            <div v-for="(tip, ti) in task.tips" :key="ti" class="tip-item">· {{ tip }}</div>
          </div>
        </div>

        <div class="modal-actions">
          <button class="btn-primary" @click="showScheduleModal = false">닫기</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { harvestRecApi, type RecommendationsResponse } from '../api/harvest-recommendation.api'
import { harvestApi, type CreateBatchRequest } from '../api/harvest.api'
import { groupApi } from '../api/group.api'
import type { HouseGroup } from '../types/group.types'
import { CROP_PRESETS, TASK_SCHEDULE } from '../utils/harvest-presets'
import { useNotificationStore } from '../stores/notification.store'

const notificationStore = useNotificationStore()

const loading = ref(true)
const data = ref<RecommendationsResponse | null>(null)
const completing = ref<string | null>(null)
const snoozed = ref(new Set<string>())
const showBatchSection = ref(false)
const showScheduleModal = ref(false)
const groups = ref<HouseGroup[]>([])

// Batch modal
const showBatchModal = ref(false)
const editingBatch = ref<{ id: string } | null>(null)
const selectedPreset = ref('')
const batchForm = ref<CreateBatchRequest>({
  cropName: '', variety: '', groupId: '',
  sowDate: formatLocalDate(new Date()),
  transplantDate: '', growDays: 100, memo: '',
})

const isBatchFormValid = computed(() =>
  batchForm.value.cropName.trim() !== '' &&
  batchForm.value.sowDate !== '' &&
  batchForm.value.growDays >= 1 && batchForm.value.growDays <= 365
)

// ── Computed ──
const summaryIcon = computed(() => {
  if (!data.value) return ''
  const m: Record<string, string> = { good: '✅', caution: '⚠️', warning: '🚨' }
  return m[data.value.summary.status] || ''
})

const vpdLabel = computed(() => {
  const s = data.value?.environment.vpdStatus
  if (s === 'LOW') return '과습'
  if (s === 'HIGH') return '건조'
  return '정상'
})

const condensationLabel = computed(() => {
  const l = data.value?.environment.condensationLevel
  const m: Record<string, string> = { critical: '위험', danger: '경고', warning: '주의' }
  return l ? m[l] || '' : ''
})

const stageLabel = computed(() => {
  const s = data.value?.activeBatch?.currentStage
  const m: Record<string, string> = { vegetative: '영양생장기', flowering_fruit: '개화착과기', harvest: '수확기' }
  return s ? m[s] || s : ''
})

const stageColor = computed(() => {
  const s = data.value?.activeBatch?.currentStage
  const m: Record<string, string> = { vegetative: '#4CAF50', flowering_fruit: '#FF9800', harvest: '#F44336' }
  return s ? m[s] || 'var(--text-secondary)' : ''
})

// ── Functions ──
function formatLocalDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function scoreColor(score: number): string {
  if (score >= 70) return 'red'
  if (score >= 40) return 'yellow'
  return 'green'
}

function statusLabel(status: string): string {
  const m: Record<string, string> = { NORMAL: '정상', UPCOMING: '임박', DELAYED: '지연', URGENT: '긴급' }
  return m[status] || status
}

function delayText(card: { daysSinceLast: number | null; status: string }): string {
  if (card.daysSinceLast == null) return ''
  if (card.status === 'DELAYED' || card.status === 'URGENT') {
    return `D+${card.daysSinceLast} 작업 지연됨`
  }
  return `${card.daysSinceLast}일 경과`
}

function effectPercent(card: { effectRemaining: number | null; taskType: string }): number {
  if (!card.effectRemaining) return 0
  const durations: Record<string, number> = { leaf_removal: 7, training: 5, pesticide: 12 }
  const total = durations[card.taskType] || 7
  return Math.round((card.effectRemaining / total) * 100)
}

async function loadRecommendations() {
  try {
    const res = await harvestRecApi.getRecommendations()
    data.value = res.data
  } catch {
    notificationStore.error('오류', '추천 데이터를 불러오지 못했습니다.')
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

async function handleComplete(taskType: string) {
  if (!data.value?.activeBatch) return
  completing.value = taskType
  try {
    await harvestRecApi.createTaskLog(data.value.activeBatch.id, taskType)
    notificationStore.success('완료', '작업이 기록되었습니다.')
    await loadRecommendations()
  } catch {
    notificationStore.error('오류', '작업 완료 기록에 실패했습니다.')
  } finally {
    completing.value = null
  }
}

function handlePostpone(taskType: string) {
  if (!data.value?.activeBatch) return
  const key = `snooze:${data.value.activeBatch.id}:${taskType}`
  localStorage.setItem(key, new Date().toISOString().slice(0, 10))
  snoozed.value.add(taskType)
}

function loadSnoozeState() {
  if (!data.value?.activeBatch) return
  const today = new Date().toISOString().slice(0, 10)
  for (const type of ['leaf_removal', 'training', 'pesticide']) {
    const key = `snooze:${data.value.activeBatch.id}:${type}`
    const saved = localStorage.getItem(key)
    if (saved && saved === today) {
      snoozed.value.add(type)
    } else if (saved) {
      localStorage.removeItem(key)
    }
  }
}

function openBatchModal(batch?: { id: string; cropName?: string; variety?: string | null; groupId?: string | null; sowDate?: string; transplantDate?: string | null; growDays?: number; memo?: string | null }) {
  editingBatch.value = batch ? { id: batch.id } : null
  selectedPreset.value = ''
  if (batch) {
    batchForm.value = {
      cropName: batch.cropName || '',
      variety: batch.variety || '',
      groupId: batch.groupId || '',
      sowDate: batch.sowDate || formatLocalDate(new Date()),
      transplantDate: batch.transplantDate || '',
      growDays: batch.growDays || 100,
      memo: batch.memo || '',
    }
  } else {
    batchForm.value = {
      cropName: '', variety: '', groupId: '',
      sowDate: formatLocalDate(new Date()),
      transplantDate: '', growDays: 100, memo: '',
    }
  }
  showBatchModal.value = true
}

function applyPreset() {
  if (!selectedPreset.value) return
  const [name, variety] = selectedPreset.value.split('|')
  const preset = CROP_PRESETS.find(p => p.name === name && p.variety === variety)
  if (preset) {
    batchForm.value.cropName = preset.name
    batchForm.value.variety = preset.variety
    batchForm.value.growDays = preset.growDays
  }
}

async function handleDeleteBatch() {
  if (!data.value?.activeBatch) return
  if (!confirm('정말로 이 배치를 삭제하시겠습니까? 관련 작업 이력도 함께 삭제됩니다.')) return
  try {
    await harvestApi.deleteBatch(data.value.activeBatch.id)
    notificationStore.success('삭제 완료', '배치가 삭제되었습니다.')
    showBatchSection.value = false
    await loadRecommendations()
  } catch {
    notificationStore.error('오류', '배치 삭제에 실패했습니다.')
  }
}

async function saveBatch() {
  try {
    const payload: CreateBatchRequest = {
      cropName: batchForm.value.cropName,
      sowDate: batchForm.value.sowDate,
      growDays: batchForm.value.growDays,
    }
    if (batchForm.value.groupId) payload.groupId = batchForm.value.groupId
    if (batchForm.value.transplantDate) payload.transplantDate = batchForm.value.transplantDate
    if (batchForm.value.variety) payload.variety = batchForm.value.variety
    if (batchForm.value.memo) payload.memo = batchForm.value.memo

    if (editingBatch.value) {
      await harvestApi.updateBatch(editingBatch.value.id, payload)
      notificationStore.success('수정 완료', '배치가 수정되었습니다.')
    } else {
      await harvestApi.createBatch(payload)
      notificationStore.success('추가 완료', '새 배치가 추가되었습니다.')
    }
    showBatchModal.value = false
    await loadRecommendations()
  } catch {
    notificationStore.error('오류', '저장에 실패했습니다.')
  }
}

onMounted(async () => {
  await Promise.all([loadRecommendations(), loadGroups()])
  loadSnoozeState()
})
</script>

<style scoped>
.page-container { padding: 24px; max-width: 900px; margin: 0 auto; }

.page-header {
  display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px;
}
.page-header h2 { font-size: calc(1.4em * var(--content-title-scale, 1)); font-weight: 700; color: var(--text-primary); }
.page-description { color: var(--text-muted); margin-top: 4px; }
.header-actions { display: flex; gap: 8px; align-items: center; }

.btn-outline {
  padding: 10px 16px; background: transparent; color: var(--text-secondary);
  border: 1px solid var(--border-input); border-radius: 8px;
  font-weight: 500; cursor: pointer; white-space: nowrap; font-size: 0.9em;
}
.btn-outline:hover { background: var(--bg-hover); color: var(--text-primary); }

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
.btn-sm {
  padding: 6px 14px; font-size: 0.85em; border: 1px solid var(--border-input);
  border-radius: 6px; background: var(--bg-input); color: var(--text-secondary);
  cursor: pointer; margin-top: 8px;
}

.loading-state, .empty-state { text-align: center; padding: 60px 20px; color: var(--text-muted); }
.empty-icon { font-size: 3em; margin-bottom: 16px; }
.empty-state .btn-primary { margin-top: 16px; }

/* ── 요약 배너 ── */
.summary-banner {
  border-radius: 12px; padding: 16px 20px; margin-bottom: 16px;
  border: 1px solid var(--border-card);
}
.summary-good { background: rgba(76,175,80,0.08); border-color: rgba(76,175,80,0.2); }
.summary-caution { background: rgba(255,193,7,0.08); border-color: rgba(255,193,7,0.2); }
.summary-warning { background: rgba(244,67,54,0.08); border-color: rgba(244,67,54,0.2); }

.summary-main { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
.summary-icon { font-size: 1.4em; }
.summary-text { display: flex; flex-direction: column; gap: 2px; }
.summary-text strong { font-size: 1em; color: var(--text-primary); }
.summary-text span { font-size: 0.88em; color: var(--text-secondary); }
.summary-sub { font-size: 0.82em; color: var(--text-muted); margin-bottom: 8px; padding-left: 34px; }

.env-chips { display: flex; gap: 8px; flex-wrap: wrap; padding-left: 34px; }
.env-chip {
  padding: 3px 10px; border-radius: 12px; font-size: 0.78em; font-weight: 500;
  background: var(--bg-hover); color: var(--text-secondary);
}
.vpd-low { background: rgba(33,150,243,0.12); color: #1565C0; }
.vpd-high { background: rgba(255,152,0,0.12); color: #E65100; }
.vpd-ok { background: rgba(76,175,80,0.12); color: #2E7D32; }
.cond-critical { background: rgba(244,67,54,0.15); color: #C62828; }
.cond-danger { background: rgba(255,152,0,0.12); color: #E65100; }
.cond-warning { background: rgba(255,193,7,0.12); color: #F57F17; }

/* ── 배치 정보 바 ── */
.batch-info-bar {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 16px; margin-bottom: 16px;
  background: var(--bg-card); border: 1px solid var(--border-card);
  border-radius: 10px; cursor: pointer; font-size: 0.9em;
}
.batch-info-bar:hover { background: var(--bg-hover); }
.batch-name { font-weight: 600; color: var(--text-primary); }
.batch-stage { font-weight: 500; font-size: 0.88em; }
.batch-days { color: var(--text-muted); font-size: 0.85em; margin-left: auto; }
.toggle-icon { color: var(--text-muted); font-size: 0.7em; }

.batch-detail {
  background: var(--bg-card); border: 1px solid var(--border-card);
  border-radius: 10px; padding: 14px 18px; margin-bottom: 16px; margin-top: -10px;
}
.detail-row {
  display: flex; justify-content: space-between; padding: 6px 0;
  font-size: 0.88em; color: var(--text-secondary);
  border-bottom: 1px solid var(--border-light);
}
.detail-row:last-of-type { border-bottom: none; }

.batch-actions { display: flex; gap: 8px; margin-top: 12px; justify-content: flex-end; }
.btn-sm.danger {
  border-color: #F44336; color: #F44336; background: transparent;
}
.btn-sm.danger:hover { background: rgba(244,67,54,0.08); }

/* ── 추천 카드 ── */
.recommendation-cards { display: flex; flex-direction: column; gap: 14px; }

.rec-card {
  background: var(--bg-card); border: 1px solid var(--border-card);
  border-radius: 14px; padding: 20px; box-shadow: var(--shadow-card);
  transition: opacity 0.3s, border-color 0.3s;
}
.rec-card.highlight { border-left: 4px solid var(--accent); }
.rec-card.snoozed { opacity: 0.5; }
.rec-card.status-urgent { border-left: 4px solid #F44336; }
.rec-card.status-delayed { border-left: 4px solid #FF9800; }
.rec-card.status-upcoming { border-left: 4px solid #2196F3; }

.card-header { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; }
.card-icon { font-size: 1.3em; }
.card-name { font-size: 1.05em; font-weight: 700; color: var(--text-primary); flex: 1; }

.status-badge {
  padding: 3px 10px; border-radius: 12px; font-size: 0.75em; font-weight: 600;
}
.status-badge.normal { background: rgba(76,175,80,0.1); color: #2E7D32; }
.status-badge.upcoming { background: rgba(33,150,243,0.1); color: #1565C0; }
.status-badge.delayed { background: rgba(255,152,0,0.1); color: #E65100; }
.status-badge.urgent { background: rgba(244,67,54,0.1); color: #C62828; }

/* 점수 게이지 */
.score-section { margin-bottom: 14px; }
.score-label { display: flex; justify-content: space-between; margin-bottom: 4px; font-size: 0.85em; color: var(--text-secondary); }
.score-value { font-weight: 700; }
.score-value.green { color: #4CAF50; }
.score-value.yellow { color: #FFC107; }
.score-value.red { color: #F44336; }

.score-bar { height: 8px; background: var(--bg-hover); border-radius: 4px; overflow: hidden; }
.score-fill { height: 100%; border-radius: 4px; transition: width 0.5s ease; }
.score-fill.green { background: #4CAF50; }
.score-fill.yellow { background: #FFC107; }
.score-fill.red { background: #F44336; }

/* 정보 */
.card-info { margin-bottom: 12px; }
.info-row { display: flex; gap: 6px; align-items: center; font-size: 0.85em; color: var(--text-secondary); padding: 3px 0; }

/* 추천 사유 */
.reasons {
  background: var(--bg-hover); border-radius: 8px; padding: 10px 14px; margin-bottom: 12px;
}
.reasons-title { font-size: 0.82em; font-weight: 600; color: var(--text-secondary); margin-bottom: 4px; }
.reason-item { font-size: 0.82em; color: var(--text-muted); padding: 2px 0; }

/* 효과 바 */
.effect-bar { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; font-size: 0.82em; }
.effect-label { color: var(--text-muted); white-space: nowrap; }
.effect-track { flex: 1; height: 6px; background: var(--bg-hover); border-radius: 3px; overflow: hidden; }
.effect-fill { height: 100%; background: var(--accent); border-radius: 3px; }
.effect-days { color: var(--text-secondary); white-space: nowrap; }

/* 액션 버튼 */
.card-actions { display: flex; gap: 8px; }
.btn-complete {
  flex: 1; padding: 10px; background: var(--accent); color: white; border: none;
  border-radius: 8px; font-weight: 600; cursor: pointer; font-size: 0.9em;
}
.btn-complete:hover { background: var(--accent-hover); }
.btn-complete:disabled { opacity: 0.6; cursor: not-allowed; }
.btn-postpone {
  padding: 10px 16px; background: var(--bg-hover); color: var(--text-secondary);
  border: 1px solid var(--border-input); border-radius: 8px; cursor: pointer; font-size: 0.9em;
}
.btn-postpone:hover { background: var(--bg-card); }
.btn-postpone:disabled { opacity: 0.5; cursor: not-allowed; }

/* ── 모달 ── */
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

/* ── 작업 기준표 모달 ── */
.schedule-modal { max-width: 600px; }
.schedule-header { display: flex; align-items: baseline; gap: 10px; margin-bottom: 20px; }
.schedule-header h3 { margin-bottom: 0; }
.schedule-region { font-size: 0.78em; color: var(--text-muted); font-weight: 400; }

.schedule-task {
  border: 1px solid var(--border-card); border-radius: 10px;
  padding: 16px; margin-bottom: 14px;
}
.schedule-task:last-of-type { margin-bottom: 0; }
.schedule-task-header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.schedule-task-icon { font-size: 1.2em; }
.schedule-task-name { font-size: 1.05em; font-weight: 700; color: var(--text-primary); }
.schedule-desc { font-size: 0.82em; color: var(--text-muted); margin-bottom: 12px; }

.schedule-section { margin-bottom: 12px; }
.schedule-section:last-child { margin-bottom: 0; }
.schedule-label {
  font-size: 0.78em; font-weight: 600; color: var(--text-secondary);
  text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 6px;
}

.schedule-grid { display: flex; gap: 8px; }
.schedule-cell {
  flex: 1; display: flex; flex-direction: column; align-items: center;
  padding: 8px; background: var(--bg-hover); border-radius: 8px;
}
.cell-label { font-size: 0.72em; color: var(--text-muted); margin-bottom: 2px; }
.cell-value { font-size: 0.92em; font-weight: 700; color: var(--text-primary); }

.stage-row {
  display: grid; grid-template-columns: 80px 60px 1fr; gap: 8px;
  padding: 5px 0; font-size: 0.82em; border-bottom: 1px solid var(--border-light);
  align-items: center;
}
.stage-row:last-child { border-bottom: none; }
.stage-name { font-weight: 600; color: var(--text-primary); }
.stage-interval { font-weight: 700; color: var(--accent); text-align: center; }
.stage-note { color: var(--text-muted); }

.tip-item { font-size: 0.82em; color: var(--text-secondary); padding: 2px 0; }

@media (max-width: 768px) {
  .page-container { padding: 16px; }
  .page-header { flex-direction: column; gap: 12px; }
  .env-chips { padding-left: 0; }
  .summary-sub { padding-left: 0; }
  .modal-content { padding: 20px; }
}
</style>
