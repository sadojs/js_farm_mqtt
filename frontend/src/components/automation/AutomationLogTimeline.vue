<template>
  <div class="automation-log">
    <!-- 통계 카드 -->
    <div class="log-stats">
      <div class="stat-card">
        <span class="stat-value">{{ stats.todayCount }}</span>
        <span class="stat-label">오늘 실행</span>
      </div>
      <div class="stat-card">
        <span class="stat-value">{{ stats.successRate }}%</span>
        <span class="stat-label">성공률</span>
      </div>
      <div class="stat-card stat-card-wide">
        <span class="stat-value stat-value-sm">{{ stats.mostActiveRule || '-' }}</span>
        <span class="stat-label">가장 활발한 룰</span>
      </div>
    </div>

    <!-- 헤더 -->
    <div class="log-list-header">
      <span class="log-count">최근 {{ logs.length }}건</span>
      <button class="btn-refresh-sm" @click="refresh" :disabled="loading">
        {{ loading ? '불러오는 중...' : '새로고침' }}
      </button>
    </div>

    <!-- 로딩 -->
    <div v-if="loading && logs.length === 0" class="log-loading">로그를 불러오는 중...</div>

    <!-- 빈 상태 -->
    <div v-else-if="logs.length === 0" class="log-empty">
      <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="16" y1="13" x2="8" y2="13"/>
        <line x1="16" y1="17" x2="8" y2="17"/>
        <polyline points="10 9 9 9 8 9"/>
      </svg>
      <p class="empty-title">실행 기록이 없습니다</p>
      <p class="empty-desc">자동화 룰이 실행되면 여기에 기록됩니다</p>
    </div>

    <!-- 타임라인 -->
    <div v-else class="log-timeline">
      <div
        v-for="log in logs"
        :key="log.id"
        class="log-entry"
      >
        <div class="log-indicator">
          <span :class="['log-dot', log.success ? 'success' : 'failed']"></span>
          <span class="log-line"></span>
        </div>
        <div class="log-body">
          <div class="log-header">
            <span :class="['log-badge', log.success ? 'success' : 'failed']">
              {{ log.success ? '성공' : '실패' }}
            </span>
            <span class="log-time">{{ formatTime(log.executedAt) }}</span>
            <span class="log-rule-name">{{ log.ruleName || '삭제된 룰' }}</span>
          </div>
          <div class="log-details">
            <div v-if="hasDetails(log.conditionsMet)" class="log-detail-row">
              <span class="detail-label">조건:</span>
              <span class="detail-value">{{ formatConditions(log.conditionsMet) }}</span>
            </div>
            <div v-if="hasDetails(log.actionsExecuted)" class="log-detail-row">
              <span class="detail-label">동작:</span>
              <span class="detail-value">{{ formatActions(log.actionsExecuted) }}</span>
            </div>
            <div v-if="log.errorMessage" class="log-detail-row">
              <span class="detail-label">오류:</span>
              <span class="detail-value error">{{ log.errorMessage }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 더보기 -->
      <button v-if="hasMore" class="btn-load-more" @click="loadMore" :disabled="loadingMore">
        {{ loadingMore ? '불러오는 중...' : '더보기' }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { automationApi } from '../../api/automation.api'
import type { AutomationLog, AutomationLogStats } from '../../types/automation.types'

const logs = ref<AutomationLog[]>([])
const stats = ref<AutomationLogStats>({ todayCount: 0, successRate: 0, mostActiveRule: null })
const loading = ref(false)
const loadingMore = ref(false)
const page = ref(1)
const hasMore = ref(false)

onMounted(async () => {
  await Promise.all([fetchLogs(), fetchStats()])
})

async function fetchLogs() {
  loading.value = true
  page.value = 1
  try {
    const { data } = await automationApi.getLogs({ page: 1, limit: 20 })
    logs.value = data
    hasMore.value = data.length >= 20
  } catch {
    logs.value = []
  } finally {
    loading.value = false
  }
}

async function fetchStats() {
  try {
    const { data } = await automationApi.getLogStats()
    stats.value = data
  } catch {
    // 기본값 유지
  }
}

async function refresh() {
  await Promise.all([fetchLogs(), fetchStats()])
}

async function loadMore() {
  loadingMore.value = true
  page.value++
  try {
    const { data } = await automationApi.getLogs({ page: page.value, limit: 20 })
    logs.value.push(...data)
    hasMore.value = data.length >= 20
  } catch {
    page.value--
  } finally {
    loadingMore.value = false
  }
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  if (diff < 60000) return '방금 전'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}분 전`
  if (diff < 86400000) {
    const hh = String(d.getHours()).padStart(2, '0')
    const mm = String(d.getMinutes()).padStart(2, '0')
    return `${hh}:${mm}`
  }
  return d.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function hasDetails(val: any): boolean {
  if (!val) return false
  if (Array.isArray(val)) return val.length > 0
  if (typeof val === 'object') return Object.keys(val).length > 0
  return false
}

function formatConditions(conditions: any): string {
  if (!conditions) return '-'
  if (typeof conditions === 'string') return conditions
  if (Array.isArray(conditions)) {
    return conditions.map((c: any) => {
      if (c.field && c.operator && c.value !== undefined) {
        return `${c.field} ${c.operator} ${c.value}`
      }
      return JSON.stringify(c)
    }).join(', ')
  }
  const entries = Object.entries(conditions)
  if (entries.length === 0) return '-'
  return entries.map(([k, v]) => `${k}: ${v}`).join(', ')
}

function formatActions(actions: any): string {
  if (!actions) return '-'
  if (typeof actions === 'string') return actions
  if (Array.isArray(actions)) {
    return actions.map((a: any) => {
      if (a.deviceId && a.command) return `${a.command}`
      if (a.command) return a.command
      if (a.action) return a.action
      return '제어'
    }).join(', ')
  }
  const entries = Object.entries(actions)
  if (entries.length === 0) return '-'
  return entries.map(([k, v]) => `${k} → ${v}`).join(', ')
}
</script>

<style scoped>
.automation-log {
  padding: 0;
}

/* 통계 카드 */
.log-stats {
  display: grid;
  grid-template-columns: 1fr 1fr 2fr;
  gap: 12px;
  margin-bottom: 20px;
}

.stat-card {
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: 12px;
  box-shadow: var(--shadow-card);
  padding: 16px;
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.stat-value {
  font-size: calc(22px * var(--content-scale, 1));
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
}

.stat-value-sm {
  font-size: calc(14px * var(--content-scale, 1));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.stat-label {
  font-size: calc(12px * var(--content-scale, 1));
  color: var(--text-muted);
}

/* 헤더 */
.log-list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.log-count {
  font-size: calc(13px * var(--content-scale, 1));
  color: var(--text-muted);
}

.btn-refresh-sm {
  padding: 5px 12px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  font-size: calc(12px * var(--content-scale, 1));
  cursor: pointer;
}
.btn-refresh-sm:hover:not(:disabled) { background: var(--bg-hover); }
.btn-refresh-sm:disabled { opacity: 0.5; cursor: not-allowed; }

/* 로딩 / 빈 상태 */
.log-loading {
  text-align: center;
  padding: 40px;
  color: var(--text-muted);
  font-size: calc(14px * var(--content-scale, 1));
}

.log-empty {
  text-align: center;
  padding: 48px 20px;
  color: var(--text-muted);
}

.empty-icon {
  width: 40px;
  height: 40px;
  margin: 0 auto 12px;
  stroke: var(--text-muted);
}

.empty-title {
  font-size: calc(15px * var(--content-scale, 1));
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 4px;
}

.empty-desc {
  font-size: calc(13px * var(--content-scale, 1));
  color: var(--text-muted);
}

/* 타임라인 */
.log-timeline {
  display: flex;
  flex-direction: column;
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: 14px;
  box-shadow: var(--shadow-card);
  overflow: hidden;
}

.log-entry {
  display: flex;
  gap: 12px;
  padding: 14px 20px;
  border-bottom: 1px solid var(--border-light);
}
.log-entry:last-of-type { border-bottom: none; }
.log-entry:hover { background: var(--bg-hover); }

.log-indicator {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 12px;
  flex-shrink: 0;
  padding-top: 4px;
}

.log-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}
.log-dot.success { background: var(--toggle-on); }
.log-dot.failed { background: var(--danger); }

.log-line {
  width: 2px;
  flex: 1;
  background: var(--border-light);
  margin-top: 4px;
  min-height: 8px;
}

.log-body {
  flex: 1;
  min-width: 0;
}

.log-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
  flex-wrap: wrap;
}

.log-badge {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: calc(11px * var(--content-scale, 1));
  font-weight: 600;
  flex-shrink: 0;
}
.log-badge.success { background: var(--accent-bg); color: var(--accent); }
.log-badge.failed { background: var(--danger-bg, #fee2e2); color: var(--danger); }

.log-time {
  font-size: calc(13px * var(--content-scale, 1));
  font-weight: 600;
  color: var(--text-primary);
  flex-shrink: 0;
}

.log-rule-name {
  font-size: calc(13px * var(--content-scale, 1));
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.log-details {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.log-detail-row {
  display: flex;
  gap: 6px;
  font-size: calc(12px * var(--content-scale, 1));
  color: var(--text-muted);
  min-width: 0;
}

.detail-label {
  flex-shrink: 0;
  font-weight: 500;
}

.detail-value {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.detail-value.error { color: var(--danger); }

/* 더보기 */
.btn-load-more {
  display: block;
  width: 100%;
  padding: 12px;
  border: none;
  border-top: 1px solid var(--border-light);
  background: transparent;
  color: var(--accent);
  font-size: calc(13px * var(--content-scale, 1));
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
}
.btn-load-more:hover:not(:disabled) { background: var(--accent-bg); }
.btn-load-more:disabled { opacity: 0.5; cursor: not-allowed; }

@media (max-width: 768px) {
  .log-stats {
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .stat-card-wide {
    grid-column: 1 / -1;
  }
  .log-entry {
    padding: 12px 16px;
  }
}
</style>
