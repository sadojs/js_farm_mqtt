<template>
  <div class="irrigation-history-card">
    <div class="widget-header">
      <h3>관수 실행 이력</h3>
      <span class="badge">오늘 {{ stats.todayCount }}회</span>
    </div>
    <!-- 실시간 상태 섹션 -->
    <div v-if="irrigationDevices.length > 0" class="realtime-section">
      <div v-for="device in irrigationDevices" :key="device.deviceId" class="device-status-row">
        <span class="device-name">{{ device.deviceName }}</span>
        <div class="status-badges">
          <span v-if="device.enabledRuleCount > 0" class="status-badge active">
            자동화 활성 ({{ device.enabledRuleCount }})
          </span>
          <span v-else class="status-badge inactive">비활성</span>
          <span v-if="device.isRunning" class="status-badge running">
            가동중 — {{ device.runningRule?.ruleName }}
            <template v-if="getRemainingMin(device) > 0"> ({{ getRemainingMin(device) }}분)</template>
          </span>
          <span v-else class="status-badge idle">대기</span>
        </div>
      </div>
    </div>

    <div class="stats-row">
      <div class="stat-item">
        <span class="stat-value">{{ stats.successRate }}%</span>
        <span class="stat-label">성공률</span>
      </div>
      <div class="stat-item">
        <span class="stat-value">{{ stats.todayCount }}</span>
        <span class="stat-label">오늘 실행</span>
      </div>
      <div class="stat-item">
        <span class="stat-value" :title="stats.mostActiveRule || '-'">{{ truncate(stats.mostActiveRule, 8) }}</span>
        <span class="stat-label">최다 실행</span>
      </div>
    </div>
    <div v-if="recentLogs.length > 0" class="recent-logs">
      <h4>최근 실행</h4>
      <div v-for="log in recentLogs" :key="log.id" class="log-entry">
        <span class="log-status" :class="log.success ? 'success' : 'fail'">{{ log.success ? '성공' : '실패' }}</span>
        <span class="log-name">{{ log.ruleName || '규칙' }}</span>
        <span class="log-time">{{ formatTime(log.executedAt) }}</span>
      </div>
    </div>
    <div v-else class="empty-text">최근 실행 이력이 없습니다</div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, computed, watch } from 'vue'
import { automationApi } from '../../api/automation.api'
import type { AutomationLog, AutomationLogStats } from '../../types/automation.types'
import { useAutomationStore } from '../../stores/automation.store'
import type { IrrigationDeviceStatus } from '../../api/automation.api'

const automationStore = useAutomationStore()
const stats = ref<AutomationLogStats>({
  todayCount: 0,
  successRate: 0,
  mostActiveRule: null,
})

const recentLogs = ref<AutomationLog[]>([])
const irrigationDevices = computed(() => automationStore.irrigationStatus)

function getRemainingMin(device: IrrigationDeviceStatus): number {
  if (!device.runningRule?.estimatedEndAt) return 0
  return Math.max(0, Math.ceil((device.runningRule.estimatedEndAt - Date.now()) / 60000))
}

// 가동중 장비 있으면 15초 폴링
let pollTimer: ReturnType<typeof setInterval> | null = null
watch(irrigationDevices, (devs) => {
  const hasRunning = devs.some(d => d.isRunning)
  if (hasRunning && !pollTimer) {
    pollTimer = setInterval(() => automationStore.fetchIrrigationStatus(), 15000)
  } else if (!hasRunning && pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}, { immediate: true })
onBeforeUnmount(() => { if (pollTimer) clearInterval(pollTimer) })

function truncate(text: string | null, maxLen: number): string {
  if (!text) return '-'
  return text.length > maxLen ? text.slice(0, maxLen) + '...' : text
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

async function loadData() {
  try {
    const [statsRes, logsRes] = await Promise.all([
      automationApi.getLogStats(),
      automationApi.getLogs({ limit: 5 }),
    ])
    stats.value = statsRes.data
    recentLogs.value = logsRes.data
  } catch {
    // silently fail - widget shows empty state
  }
}

onMounted(() => {
  loadData()
  // 별도 호출 (404 시에도 기존 기능에 영향 없음)
  automationStore.fetchIrrigationStatus()
})
</script>

<style scoped>
.irrigation-history-card {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 16px;
  padding: 16px 20px;
  margin-bottom: 20px;
}

.widget-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}

.widget-header h3 {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
}

.badge {
  background: var(--accent-bg, #e8f4fd);
  color: var(--accent, #4a7fd4);
  font-size: 12px;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 12px;
}

.realtime-section {
  margin-bottom: 16px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border-light);
}
.device-status-row {
  padding: 8px 0;
}
.device-status-row + .device-status-row {
  border-top: 1px solid var(--border-light);
}
.device-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  display: block;
  margin-bottom: 6px;
}
.status-badges {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.status-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 6px;
}
.status-badge.active { background: #e8f5e9; color: #2e7d32; }
.status-badge.inactive { background: var(--bg-badge, #f0f0f0); color: var(--text-muted); }
.status-badge.running { background: #e3f2fd; color: #1565c0; }
.status-badge.idle { background: var(--bg-badge, #f0f0f0); color: var(--text-muted); }

.stats-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-bottom: 16px;
}

.stat-item {
  background: var(--bg-secondary, #f5f5f5);
  border-radius: 10px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.stat-value {
  font-size: 20px;
  font-weight: 700;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}

.stat-label {
  font-size: 12px;
  color: var(--text-secondary);
  font-weight: 500;
}

.recent-logs h4 {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 10px 0;
}

.log-entry {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  border-bottom: 1px solid var(--border-color);
  font-size: 13px;
}

.log-entry:last-child {
  border-bottom: none;
}

.log-status {
  font-size: 12px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 6px;
  flex-shrink: 0;
}

.log-status.success {
  background: #e6f9ee;
  color: #22a855;
}

.log-status.fail {
  background: #fde8e8;
  color: #d63031;
}

.log-name {
  flex: 1;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.log-time {
  color: var(--text-secondary);
  font-size: 12px;
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}

.empty-text {
  text-align: center;
  color: var(--text-secondary);
  font-size: 13px;
  padding: 16px 0;
}

@media (max-width: 768px) {
  .irrigation-history-card {
    padding: 14px 16px;
  }
  .stat-value {
    font-size: 18px;
  }
}
</style>
