<template>
  <div class="irrigation-history-card">
    <div class="widget-header">
      <h3>관수 현황</h3>
      <span v-if="stats.todayCount > 0" class="badge">오늘 {{ stats.todayCount }}회</span>
    </div>

    <div v-if="irrigationLogs.length > 0" class="recent-logs">
      <div v-for="log in irrigationLogs" :key="log.id" class="log-entry">
        <div class="log-main">
          <span class="log-status" :class="getLogStatusClass(log)">
            {{ getLogTypeLabel(log) }}
          </span>
          <span class="log-name">{{ log.ruleName || '관수' }}</span>
          <span class="log-time">{{ formatTime(log.executedAt) }}</span>
        </div>
        <div class="log-summary">
          <span v-if="log.conditionsMet?.deviceName" class="summary-chip device">{{ log.conditionsMet.deviceName }}</span>
          <span v-if="log.conditionsMet?.startTime" class="summary-chip">{{ log.conditionsMet.startTime }}</span>
          <span v-if="log.conditionsMet?.enabledZones != null" class="summary-chip">{{ log.conditionsMet.enabledZones }}/{{ log.conditionsMet.totalZones }}구역</span>
          <span v-if="log.actionsExecuted?.estimatedDurationMin" class="summary-chip">소요 {{ log.actionsExecuted.estimatedDurationMin }}분</span>
          <span v-if="log.conditionsMet?.irrigationMin" class="summary-chip">관수 {{ log.conditionsMet.irrigationMin }}분</span>
          <span v-if="log.conditionsMet?.fertilizerMin" class="summary-chip">액비 {{ log.conditionsMet.fertilizerMin }}분</span>
        </div>
      </div>
    </div>
    <div v-else class="empty-text">최근 관수 실행 이력이 없습니다</div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { automationLogApi } from '../../api/automation-log.api'
import type { AutomationLogEntry, AutomationLogStats } from '../../api/automation-log.api'

const stats = ref<AutomationLogStats>({ todayCount: 0, successRate: 0, mostActiveRule: null })
const irrigationLogs = ref<AutomationLogEntry[]>([])

function getLogTypeLabel(log: AutomationLogEntry): string {
  const t = log.conditionsMet?.type
  if (t === 'irrigation_started') return '시작'
  if (t === 'irrigation_cancelled') return '취소'
  return log.success ? '완료' : '실패'
}

function getLogStatusClass(log: AutomationLogEntry): string {
  const t = log.conditionsMet?.type
  if (t === 'irrigation_started') return 'started'
  if (t === 'irrigation_cancelled') return 'cancelled'
  return log.success ? 'success' : 'fail'
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return '방금'
  if (diffMin < 60) return `${diffMin}분 전`
  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return `${diffHour}시간 전`
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

onMounted(async () => {
  const [s, l] = await Promise.all([
    automationLogApi.getStats(),
    automationLogApi.getLogs({ limit: 10, type: 'irrigation' }),
  ])
  stats.value = s
  irrigationLogs.value = Array.isArray(l) ? l : (l.data ?? [])
})
</script>

<style scoped>
.irrigation-history-card {
  background: var(--bg-card);
  border-radius: 16px;
  padding: 24px;
  box-shadow: var(--shadow-card);
}
.widget-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}
.widget-header h3 {
  font-size: calc(18px * var(--content-scale, 1));
  font-weight: 600;
  margin: 0;
  color: var(--text-primary);
}
.badge {
  background: var(--accent-bg);
  color: var(--accent);
  padding: 4px 10px;
  border-radius: 12px;
  font-size: calc(12px * var(--content-scale, 1));
  font-weight: 600;
}

.log-entry {
  padding: 10px 0;
  border-bottom: 1px solid var(--border-light);
}
.log-entry:last-child { border-bottom: none; }

.log-main {
  display: flex;
  align-items: center;
  gap: 8px;
}
.log-status {
  padding: 2px 8px;
  border-radius: 6px;
  font-size: calc(11px * var(--content-scale, 1));
  font-weight: 600;
  flex-shrink: 0;
}
.log-status.success { background: #e8f5e9; color: #2e7d32; }
.log-status.fail { background: #ffebee; color: #c62828; }
.log-status.started { background: #e3f2fd; color: #1565c0; }
.log-status.cancelled { background: #fff3e0; color: #e65100; }
.log-name {
  flex: 1;
  font-size: calc(12px * var(--content-scale, 1));
  color: var(--text-primary);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.log-time {
  font-size: calc(12px * var(--content-scale, 1));
  color: var(--text-muted);
  flex-shrink: 0;
}

.log-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 6px;
  padding-left: 4px;
}
.summary-chip {
  font-size: calc(11px * var(--content-scale, 1));
  color: var(--text-secondary);
  background: var(--bg-badge);
  padding: 2px 8px;
  border-radius: 6px;
  white-space: nowrap;
}
.summary-chip.device {
  color: var(--accent);
  font-weight: 600;
}

.empty-text {
  text-align: center;
  color: var(--text-muted);
  font-size: calc(14px * var(--content-scale, 1));
  padding: 16px 0;
}
</style>
