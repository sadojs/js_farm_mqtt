<template>
  <div class="page-container">
    <div class="page-header">
      <h2>작업 내역</h2>
    </div>

    <!-- 탭 -->
    <div class="log-tabs">
      <button class="log-tab" :class="{ active: tab === 'execution' }" @click="switchTab('execution')">실행 기록</button>
      <button class="log-tab" :class="{ active: tab === 'activity' }" @click="switchTab('activity')">행동 기록</button>
    </div>

    <!-- 실행 로그 탭 -->
    <div v-if="tab === 'execution'">
      <div v-if="execLoading" class="log-loading">로그를 불러오는 중...</div>
      <div v-else-if="execLogs.length === 0" class="log-empty">실행 기록이 없습니다</div>
      <div v-else class="log-list">
        <div v-for="log in execLogs" :key="log.id" class="log-entry">
          <div class="log-main">
            <span class="log-status" :class="getExecStatusClass(log)">{{ getExecLabel(log) }}</span>
            <span class="log-name">{{ log.ruleName || log.conditionsMet?.ruleName || '자동화' }}</span>
            <span class="log-time">{{ formatTime(log.executedAt) }}</span>
          </div>
          <div class="log-summary">
            <template v-if="isIrrigationLog(log)">
              <span v-if="log.conditionsMet?.deviceName" class="chip device">{{ log.conditionsMet.deviceName }}</span>
              <span v-if="getIrrigationRange(log)" class="chip">{{ getIrrigationRange(log) }}</span>
              <span v-if="log.conditionsMet?.enabledZones != null" class="chip">{{ log.conditionsMet.enabledZones }}/{{ log.conditionsMet.totalZones }}구역</span>
              <span v-if="log.actionsExecuted?.estimatedDurationMin" class="chip">소요 {{ log.actionsExecuted.estimatedDurationMin }}분</span>
              <span v-if="log.conditionsMet?.irrigationMin" class="chip">관주 {{ log.conditionsMet.irrigationMin }}분</span>
              <span v-if="log.conditionsMet?.fertilizerMin" class="chip">액비 {{ log.conditionsMet.fertilizerMin }}분</span>
            </template>
            <template v-else-if="log.conditionsMet?.type === 'relay'">
              <span v-for="name in (log.actionsExecuted?.deviceNames || [])" :key="name" class="chip device">{{ name }}</span>
              <span v-if="log.conditionsMet?.equipmentType" class="chip">{{ formatEquipment(log.conditionsMet.equipmentType) }}</span>
              <span v-if="log.conditionsMet?.field" class="chip">{{ log.conditionsMet.field }}</span>
              <span class="chip">{{ log.conditionsMet?.relayOnMinutes }}분 ON / {{ log.conditionsMet?.relayOffMinutes }}분 OFF</span>
            </template>
            <template v-else>
              <span v-for="name in (log.actionsExecuted?.deviceNames || [])" :key="name" class="chip device">{{ name }}</span>
              <span v-if="log.conditionsMet?.equipmentType" class="chip">{{ formatEquipment(log.conditionsMet.equipmentType) }}</span>
              <span v-if="log.actionsExecuted?.commandSummary" class="chip cmd">{{ log.actionsExecuted.commandSummary }}</span>
            </template>
            <span v-if="log.errorMessage" class="chip error">{{ log.errorMessage }}</span>
          </div>
        </div>
        <button v-if="execHasMore" class="btn-more" @click="loadMoreExec" :disabled="execLoadingMore">
          {{ execLoadingMore ? '불러오는 중...' : '더보기' }}
        </button>
      </div>
    </div>

    <!-- 행동 로그 탭 -->
    <div v-if="tab === 'activity'">
      <div v-if="actLoading" class="log-loading">로그를 불러오는 중...</div>
      <div v-else-if="actLogs.length === 0" class="log-empty">행동 기록이 없습니다</div>
      <div v-else class="log-list">
        <div v-for="log in actLogs" :key="log.id" class="log-entry">
          <div class="log-main">
            <span class="log-status" :class="getActionClass(log.action)">{{ getActionLabel(log.action) }}</span>
            <span class="log-user">{{ log.userName }}</span>
            <span class="log-desc">{{ getActionDesc(log) }}</span>
            <span class="log-time">{{ formatTime(log.createdAt) }}</span>
          </div>
          <div class="log-summary">
            <span v-if="getMenuLabel(log)" class="chip menu">{{ getMenuLabel(log) }}</span>
            <span v-if="log.groupName" class="chip">{{ log.groupName }}</span>
            <span v-if="log.targetName" class="chip device">{{ log.targetName }}</span>
            <span v-if="log.details?.equipmentType" class="chip">{{ formatEquipment(log.details.equipmentType) }}</span>
            <span v-if="log.details?.ruleType" class="chip">{{ log.details.ruleType === 'time' ? '시간 설정' : '측정값 설정' }}</span>
            <span v-if="log.details?.commandSummary" class="chip cmd">{{ log.details.commandSummary }}</span>
          </div>
        </div>
        <button v-if="actHasMore" class="btn-more" @click="loadMoreAct" :disabled="actLoadingMore">
          {{ actLoadingMore ? '불러오는 중...' : '더보기' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { automationLogApi, type AutomationLogEntry } from '../api/automation-log.api'
import { activityLogApi, type ActivityLogEntry } from '../api/activity-log.api'

const tab = ref<'execution' | 'activity'>('execution')

// 실행 로그
const execLogs = ref<AutomationLogEntry[]>([])
const execLoading = ref(true)
const execLoadingMore = ref(false)
const execPage = ref(1)
const execHasMore = ref(false)

// 행동 로그
const actLogs = ref<ActivityLogEntry[]>([])
const actLoading = ref(true)
const actLoadingMore = ref(false)
const actPage = ref(1)
const actHasMore = ref(false)
let actLoaded = false

onMounted(() => fetchExecLogs())

function switchTab(t: 'execution' | 'activity') {
  tab.value = t
  if (t === 'activity' && !actLoaded) {
    actLoaded = true
    fetchActLogs()
  }
}

async function fetchExecLogs() {
  execLoading.value = true
  try {
    const result = await automationLogApi.getLogs({ page: 1, limit: 20 })
    execLogs.value = result.data
    execHasMore.value = result.data.length >= 20
  } catch { execLogs.value = [] }
  finally { execLoading.value = false }
}

async function loadMoreExec() {
  execLoadingMore.value = true
  execPage.value++
  try {
    const result = await automationLogApi.getLogs({ page: execPage.value, limit: 20 })
    execLogs.value.push(...result.data)
    execHasMore.value = result.data.length >= 20
  } finally { execLoadingMore.value = false }
}

async function fetchActLogs() {
  actLoading.value = true
  try {
    const result = await activityLogApi.getLogs({ page: 1, limit: 20 })
    actLogs.value = result.data
    actHasMore.value = result.data.length >= 20
  } catch { actLogs.value = [] }
  finally { actLoading.value = false }
}

async function loadMoreAct() {
  actLoadingMore.value = true
  actPage.value++
  try {
    const result = await activityLogApi.getLogs({ page: actPage.value, limit: 20 })
    actLogs.value.push(...result.data)
    actHasMore.value = result.data.length >= 20
  } finally { actLoadingMore.value = false }
}

// 실행 로그 헬퍼
function isIrrigationLog(log: AutomationLogEntry): boolean {
  const t = log.conditionsMet?.type
  return t === 'irrigation' || t === 'irrigation_started' || t === 'irrigation_cancelled'
}

function getExecLabel(log: AutomationLogEntry): string {
  const t = log.conditionsMet?.type
  if (t === 'irrigation_started') return '시작'
  if (t === 'irrigation_cancelled') return '취소'
  if (t === 'irrigation') return log.success ? '완료' : '실패'
  if (t === 'relay') return log.conditionsMet?.isOnPhase ? 'ON' : 'OFF'
  return log.success ? '실행' : '실패'
}

function getExecStatusClass(log: AutomationLogEntry): string {
  const t = log.conditionsMet?.type
  if (t === 'irrigation_started') return 'started'
  if (t === 'irrigation_cancelled') return 'cancelled'
  return log.success ? 'success' : 'fail'
}

function formatEquipment(type: string): string {
  const m: Record<string, string> = { fan: '팬', irrigation: '관주', opener_open: '개폐기(열림)', opener_close: '개폐기(닫힘)', other: '기타' }
  return m[type] || type
}

// 행동 로그 헬퍼
const ACTION_MAP: Record<string, { label: string; cls: string }> = {
  'device.control': { label: '제어', cls: 'control' },
  'device.register': { label: '등록', cls: 'create' },
  'device.delete': { label: '삭제', cls: 'delete' },
  'rule.create': { label: '생성', cls: 'create' },
  'rule.update': { label: '수정', cls: 'update' },
  'rule.enable': { label: '활성화', cls: 'enable' },
  'rule.disable': { label: '비활성화', cls: 'disable' },
  'rule.delete': { label: '삭제', cls: 'delete' },
  'group.create': { label: '생성', cls: 'create' },
  'group.update': { label: '수정', cls: 'update' },
  'env.update': { label: '설정변경', cls: 'update' },
}

function getActionLabel(action: string) { return ACTION_MAP[action]?.label || action }
function getActionClass(action: string) { return ACTION_MAP[action]?.cls || 'default' }

const MENU_FALLBACK: Record<string, string> = {
  device: '장치 관리', rule: '자동 제어', group: '구역 관리', env_config: '환경설정', sensor: '측정기',
}
function getMenuLabel(log: ActivityLogEntry): string {
  return log.details?.menu || MENU_FALLBACK[log.targetType] || ''
}

function getActionDesc(log: ActivityLogEntry): string {
  const target = log.targetName ? `"${log.targetName}"` : ''
  const typeMap: Record<string, string> = { device: '장치', rule: '설정', group: '구역', env_config: '환경설정', sensor: '측정기' }
  const typeName = typeMap[log.targetType] || log.targetType
  if (log.action.endsWith('.control')) return `${target} ${typeName} 제어`
  if (log.action.endsWith('.register')) return `${target} ${typeName} 등록`
  if (log.action.endsWith('.delete')) return `${target} ${typeName} 삭제`
  if (log.action.endsWith('.create')) return `${target} ${typeName} 생성`
  if (log.action.endsWith('.update')) return `${target} ${typeName} 수정`
  if (log.action.endsWith('.enable')) return `${target} ${typeName} 활성화`
  if (log.action.endsWith('.disable')) return `${target} ${typeName} 비활성화`
  return `${target} ${log.action}`
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr)
  const now = new Date()
  const diffMin = Math.floor((now.getTime() - d.getTime()) / 60000)
  if (diffMin < 1) return '방금'
  if (diffMin < 60) return `${diffMin}분 전`
  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return `${diffHour}시간 전`
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function hhmm(dateStr?: string): string {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// 관수 row의 시작/종료 시각 chip — 종료 row는 "08:00 → 08:35", 시작 row는 "08:00 시작"
function getIrrigationRange(log: any): string {
  const cm = log.conditionsMet || {}
  if (cm.type === 'irrigation' || cm.type === 'irrigation_cancelled') {
    const s = cm.startedAt ? hhmm(cm.startedAt) : cm.startTime
    const e = cm.endedAt ? hhmm(cm.endedAt) : hhmm(log.executedAt)
    if (s && e) return `${s} → ${e}`
  }
  if (cm.type === 'irrigation_started') {
    return cm.startTime ? `${cm.startTime} 시작` : ''
  }
  return cm.startTime ?? ''
}
</script>

<style scoped>
.page-container { padding: 24px; max-width: 800px; margin: 0 auto; }
.page-header { margin-bottom: 20px; }
.page-header h2 { font-size: calc(22px * var(--content-scale, 1)); font-weight: 700; color: var(--text-primary); margin: 0; }

.log-tabs {
  display: flex; gap: 4px; background: var(--bg-badge);
  border-radius: 10px; padding: 4px; margin-bottom: 16px;
}
.log-tab {
  flex: 1; padding: 8px 16px; border: none; border-radius: 8px;
  background: none; font-size: calc(14px * var(--content-scale, 1)); font-weight: 600;
  color: var(--text-muted); cursor: pointer; transition: all 0.2s;
}
.log-tab.active {
  background: var(--bg-card); color: var(--text-primary); box-shadow: var(--shadow-card);
}

.log-loading, .log-empty {
  text-align: center; padding: 40px 0; color: var(--text-muted); font-size: calc(14px * var(--content-scale, 1));
}

.log-entry { padding: 12px 0; border-bottom: 1px solid var(--border-light); }
.log-entry:last-child { border-bottom: none; }

.log-main { display: flex; align-items: center; gap: 8px; }
.log-status {
  padding: 2px 8px; border-radius: 6px;
  font-size: calc(11px * var(--content-scale, 1)); font-weight: 600; flex-shrink: 0;
}
.log-status.success { background: #e8f5e9; color: #2e7d32; }
.log-status.fail { background: #ffebee; color: #c62828; }
.log-status.started { background: #e3f2fd; color: #1565c0; }
.log-status.cancelled { background: #fff3e0; color: #e65100; }
.log-status.control { background: #e3f2fd; color: #1565c0; }
.log-status.create, .log-status.enable { background: #e8f5e9; color: #2e7d32; }
.log-status.update { background: #fff3e0; color: #e65100; }
.log-status.disable, .log-status.delete { background: #ffebee; color: #c62828; }
.log-status.default { background: var(--bg-badge); color: var(--text-secondary); }

.log-name, .log-desc {
  flex: 1; font-size: calc(13px * var(--content-scale, 1)); color: var(--text-primary);
  font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.log-user {
  font-size: calc(13px * var(--content-scale, 1)); color: var(--accent); font-weight: 600;
  flex-shrink: 0;
}
.log-time { font-size: calc(13px * var(--content-scale, 1)); color: var(--text-muted); flex-shrink: 0; }

.log-summary { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; padding-left: 4px; }
.chip {
  font-size: calc(11px * var(--content-scale, 1)); color: var(--text-secondary);
  background: var(--bg-badge); padding: 2px 8px; border-radius: 6px; white-space: nowrap;
}
.chip.device { color: var(--accent); font-weight: 600; }
.chip.menu { color: #6a1b9a; background: #f3e5f5; font-weight: 600; }
.chip.cmd { font-family: monospace; }
.chip.error { color: #c62828; background: #ffebee; }

.btn-more {
  display: block; margin: 12px auto 0; padding: 8px 24px;
  border: 1px solid var(--border-light); border-radius: 10px;
  background: transparent; color: var(--text-secondary); cursor: pointer;
  font-size: calc(13px * var(--content-scale, 1));
}
.btn-more:hover { background: var(--bg-hover); }

@media (max-width: 768px) {
  .page-container { padding: 16px; }
}
</style>
