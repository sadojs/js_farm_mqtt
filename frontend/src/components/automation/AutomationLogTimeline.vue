<template>
  <div class="automation-log">
    <!-- 로그 리스트 -->
    <div v-if="loading" class="log-loading">로그를 불러오는 중...</div>
    <div v-else-if="logs.length === 0" class="log-empty">
      <EmptyState
        icon="rule"
        title="실행 기록이 없습니다"
        description="자동화 룰이 실행되면 여기에 기록됩니다"
      />
    </div>
    <div v-else class="log-timeline">
      <div v-for="log in logs" :key="log.id" class="log-entry">
        <div class="log-main">
          <span class="log-status" :class="getLogStatusClass(log)">
            {{ getLogTypeLabel(log) }}
          </span>
          <span class="log-name">{{ log.ruleName || log.conditionsMet?.ruleName || '자동화' }}</span>
          <span class="log-time">{{ formatTime(log.executedAt) }}</span>
        </div>
        <div class="log-summary">
          <!-- 관수 로그 -->
          <template v-if="isIrrigationLog(log)">
            <span v-if="log.conditionsMet?.deviceName" class="summary-chip device">{{ log.conditionsMet.deviceName }}</span>
            <span v-if="log.conditionsMet?.startTime" class="summary-chip">{{ log.conditionsMet.startTime }}</span>
            <span v-if="log.conditionsMet?.enabledZones != null" class="summary-chip">{{ log.conditionsMet.enabledZones }}/{{ log.conditionsMet.totalZones }}구역</span>
            <span v-if="log.actionsExecuted?.estimatedDurationMin" class="summary-chip">소요 {{ log.actionsExecuted.estimatedDurationMin }}분</span>
            <span v-if="log.conditionsMet?.irrigationMin" class="summary-chip">관수 {{ log.conditionsMet.irrigationMin }}분</span>
            <span v-if="log.conditionsMet?.fertilizerMin" class="summary-chip">액비 {{ log.conditionsMet.fertilizerMin }}분</span>
          </template>
          <!-- 릴레이 자동화 로그 -->
          <template v-else-if="log.conditionsMet?.type === 'relay'">
            <span v-for="name in (log.actionsExecuted?.deviceNames || [])" :key="name" class="summary-chip device">{{ name }}</span>
            <span v-if="log.conditionsMet?.equipmentType" class="summary-chip">{{ formatEquipmentType(log.conditionsMet.equipmentType) }}</span>
            <span v-if="log.conditionsMet?.field" class="summary-chip">{{ log.conditionsMet.field }}</span>
            <span class="summary-chip">{{ log.conditionsMet?.relayOnMinutes }}분 ON / {{ log.conditionsMet?.relayOffMinutes }}분 OFF</span>
          </template>
          <!-- 일반 자동화 로그 -->
          <template v-else>
            <span v-for="name in (log.actionsExecuted?.deviceNames || [])" :key="name" class="summary-chip device">{{ name }}</span>
            <span v-if="log.conditionsMet?.equipmentType" class="summary-chip">{{ formatEquipmentType(log.conditionsMet.equipmentType) }}</span>
            <span v-if="log.actionsExecuted?.commandSummary" class="summary-chip cmd">{{ log.actionsExecuted.commandSummary }}</span>
          </template>
          <span v-if="log.errorMessage" class="summary-chip error">{{ log.errorMessage }}</span>
        </div>
      </div>

      <!-- 더보기 -->
      <button v-if="hasMore" class="log-more-btn" @click="loadMore" :disabled="loadingMore">
        {{ loadingMore ? '불러오는 중...' : '더보기' }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { automationLogApi, type AutomationLogEntry } from '../../api/automation-log.api'
import EmptyState from '../common/EmptyState.vue'

const logs = ref<AutomationLogEntry[]>([])
const loading = ref(true)
const loadingMore = ref(false)
const page = ref(1)
const hasMore = ref(true)

onMounted(async () => {
  await fetchLogs()
})

async function fetchLogs() {
  loading.value = true
  try {
    const result = await automationLogApi.getLogs({ page: 1, limit: 20 })
    logs.value = result.data
    hasMore.value = result.data.length >= 20
  } catch {
    logs.value = []
  } finally {
    loading.value = false
  }
}

async function loadMore() {
  loadingMore.value = true
  page.value++
  try {
    const result = await automationLogApi.getLogs({ page: page.value, limit: 20 })
    logs.value.push(...result.data)
    hasMore.value = result.data.length >= 20
  } finally {
    loadingMore.value = false
  }
}

function isIrrigationLog(log: AutomationLogEntry): boolean {
  const t = log.conditionsMet?.type
  return t === 'irrigation' || t === 'irrigation_started' || t === 'irrigation_cancelled'
}

function getLogTypeLabel(log: AutomationLogEntry): string {
  const t = log.conditionsMet?.type
  if (t === 'irrigation_started') return '시작'
  if (t === 'irrigation_cancelled') return '취소'
  if (t === 'irrigation') return log.success ? '완료' : '실패'
  if (t === 'relay') return log.conditionsMet?.isOnPhase ? 'ON' : 'OFF'
  return log.success ? '실행' : '실패'
}

function getLogStatusClass(log: AutomationLogEntry): string {
  const t = log.conditionsMet?.type
  if (t === 'irrigation_started') return 'started'
  if (t === 'irrigation_cancelled') return 'cancelled'
  if (!log.success) return 'fail'
  return 'success'
}

function formatEquipmentType(type: string): string {
  const map: Record<string, string> = {
    fan: '팬', irrigation: '관수', opener_open: '개폐기(열림)',
    opener_close: '개폐기(닫힘)', other: '기타',
  }
  return map[type] || type
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
</script>

<style scoped>
.log-loading {
  text-align: center;
  padding: 32px;
  color: var(--text-secondary);
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
.summary-chip.cmd {
  font-family: monospace;
}
.summary-chip.error {
  color: #c62828;
  background: #ffebee;
}

.log-more-btn {
  display: block;
  margin: 12px auto 0;
  padding: 8px 24px;
  border: 1px solid var(--border-light);
  border-radius: 10px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: calc(12px * var(--content-scale, 1));
}
.log-more-btn:hover {
  background: var(--bg-hover);
}
</style>
