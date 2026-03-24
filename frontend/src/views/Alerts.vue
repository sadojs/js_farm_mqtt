<template>
  <div class="page-container">
    <!-- 헤더 -->
    <header class="page-header">
      <div>
        <h2>센서 알림</h2>
        <p class="page-description">센서 이상 감지 및 조치 안내</p>
      </div>
      <span v-if="unresolvedCount > 0" class="unresolved-badge">{{ unresolvedCount }}</span>
    </header>

    <!-- 탭 -->
    <div class="tab-bar">
      <button :class="['tab-item', { active: activeTab === 'sensors' }]" @click="activeTab = 'sensors'">
        활성 센서 <span class="tab-count">{{ activeSensors.length }}</span>
      </button>
      <button :class="['tab-item', { active: activeTab === 'alerts' }]" @click="activeTab = 'alerts'">
        알림 <span v-if="unresolvedCount > 0" class="tab-badge">{{ unresolvedCount }}</span>
      </button>
      <button :class="['tab-item', { active: activeTab === 'standby' }]" @click="activeTab = 'standby'">
        대기 목록 <span v-if="standbySensors.length > 0" class="tab-count">{{ standbySensors.length }}</span>
      </button>
    </div>

    <!-- ═══ 탭1: 활성 센서 ═══ -->
    <template v-if="activeTab === 'sensors'">
      <div v-if="sensorsLoading" class="loading-state">센서 목록을 불러오는 중...</div>
      <div v-else-if="activeSensors.length === 0" class="empty-state">
        <h3>활성 센서가 없습니다</h3>
        <p v-if="standbySensors.length > 0">대기 목록에서 센서를 활성화하세요.</p>
        <p v-else>장비를 등록하고 센서를 활성화하세요.</p>
        <router-link to="/devices" class="empty-cta-link">장비 관리</router-link>
      </div>
      <div v-else class="sensor-grid">
        <div v-for="s in activeSensors" :key="s.deviceId + s.sensorType" class="sensor-card">
          <div class="sensor-icon">{{ sensorIcon(s.sensorType) }}</div>
          <div class="sensor-info">
            <div class="sensor-device">{{ s.deviceName }}</div>
            <div class="sensor-type">{{ sensorTypeLabel(s.sensorType) }}</div>
            <div class="sensor-value" v-if="s.latestValue != null">
              {{ formatSensorValue(s.latestValue, s.sensorType) }}<span class="sensor-unit">{{ s.unit }}</span>
            </div>
            <div class="sensor-value muted" v-else>데이터 없음</div>
            <div class="sensor-time" v-if="s.lastSeen">{{ formatTimeAgo(s.lastSeen) }}</div>
          </div>
          <button class="btn-standby" @click="moveToStandby(s)" title="대기 목록으로 이동">
            ⏸
          </button>
        </div>
      </div>
    </template>

    <!-- ═══ 탭2: 알림 (기존 기능 그대로) ═══ -->
    <template v-if="activeTab === 'alerts'">
      <!-- 필터 칩 -->
      <div class="filter-bar">
        <button v-for="f in filterOptions" :key="f.value"
                :class="['filter-chip', { active: filter === f.value }]"
                @click="filter = f.value">
          {{ f.label }}
        </button>
      </div>

      <!-- 로딩 -->
      <div v-if="loading" class="loading-state">알림을 불러오는 중...</div>

      <!-- 빈 상태 -->
      <div v-else-if="filteredAlerts.length === 0" class="empty-state">
        <h3>알림이 없습니다</h3>
        <p>센서가 정상적으로 작동하고 있습니다.</p>
      </div>

      <!-- 알림 카드 리스트 -->
      <div v-else class="alerts-list">
        <div v-for="alert in filteredAlerts" :key="alert.id"
             class="alert-card" :class="[alert.severity, { resolved: alert.resolved }]"
             @click="openDetail(alert)">
          <div class="alert-severity">
            <span class="severity-icon">{{ alert.severity === 'critical' ? '🔴' : '🟡' }}</span>
            <span :class="['severity-badge', alert.severity]">
              {{ alert.severity === 'critical' ? '심각' : '경고' }}
            </span>
          </div>
          <div class="alert-content">
            <div class="alert-title">{{ alert.deviceName || alert.deviceId }}</div>
            <div class="alert-meta">
              <span class="alert-type">{{ alertTypeLabel(alert.alertType) }}</span>
              <span class="dot">·</span>
              <span class="alert-sensor">{{ sensorTypeLabel(alert.sensorType) }}</span>
            </div>
            <div class="alert-message">{{ alert.message }}</div>
            <div class="alert-time">{{ formatTimeAgo(alert.createdAt) }}</div>
          </div>
          <div class="alert-actions" @click.stop>
            <button v-if="!alert.resolved" class="btn-sm" @click="handleResolve(alert.id)">해결</button>
            <button v-if="alert.resolved" class="btn-sm danger" @click="handleRemove(alert.id)">삭제</button>
          </div>
        </div>
      </div>
    </template>

    <!-- ═══ 탭3: 대기 목록 ═══ -->
    <template v-if="activeTab === 'standby'">
      <div v-if="sensorsLoading" class="loading-state">센서 목록을 불러오는 중...</div>
      <div v-else-if="standbySensors.length === 0" class="empty-state">
        <h3>대기 중인 센서가 없습니다</h3>
        <p>사용하지 않는 센서를 활성 센서 탭에서 대기로 이동할 수 있습니다.</p>
      </div>
      <div v-else class="sensor-grid standby-grid">
        <div v-for="s in standbySensors" :key="s.deviceId + s.sensorType" class="sensor-card standby">
          <div class="sensor-icon muted">{{ sensorIcon(s.sensorType) }}</div>
          <div class="sensor-info">
            <div class="sensor-device">{{ s.deviceName }}</div>
            <div class="sensor-type">{{ sensorTypeLabel(s.sensorType) }}</div>
            <div class="sensor-value muted" v-if="s.latestValue != null">
              {{ formatSensorValue(s.latestValue, s.sensorType) }}<span class="sensor-unit">{{ s.unit }}</span>
            </div>
            <div class="standby-label">알림 비활성</div>
          </div>
          <button class="btn-activate" @click="restoreFromStandby(s)" title="활성화">
            ▶
          </button>
        </div>
      </div>
    </template>

    <!-- 상세 모달 -->
    <div v-if="selectedAlert" class="modal-overlay" @click.self="selectedAlert = null">
      <div class="modal-content">
        <div v-if="detailLoading" class="loading-state">상세 정보를 불러오는 중...</div>
        <template v-else-if="detail">
          <div class="detail-header">
            <h3>{{ alertTypeLabel(detail.alertType) }} 감지</h3>
            <span :class="['severity-badge', detail.severity]">
              {{ detail.severity === 'critical' ? '심각' : '경고' }}
            </span>
          </div>

          <div class="detail-info">
            <div>센서: {{ detail.deviceName }} / {{ sensorTypeLabel(detail.sensorType) }}</div>
            <div>감지 시각: {{ formatDate(detail.createdAt) }}</div>
          </div>

          <!-- 24h 숫자 요약 -->
          <div v-if="detail.stats24h" class="stats-grid">
            <div class="stat-item">
              <span class="stat-label">최근 24h 최소</span>
              <span class="stat-value">{{ detail.stats24h.min_value ?? '-' }}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">최근 24h 최대</span>
              <span class="stat-value">{{ detail.stats24h.max_value ?? '-' }}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">변화폭</span>
              <span class="stat-value">{{ detail.stats24h.delta ?? '-' }}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">마지막 값</span>
              <span class="stat-value">{{ detail.stats24h.last_value ?? '-' }}</span>
            </div>
          </div>

          <!-- 감지 이유 -->
          <div class="detail-reason">
            <h4>감지 이유</h4>
            <p>{{ detail.message }}</p>
          </div>

          <!-- 조치 가이드 -->
          <div v-if="detail.actionGuides.length > 0" class="detail-guides">
            <h4>조치 가이드</h4>
            <ul>
              <li v-for="(guide, i) in detail.actionGuides" :key="i">{{ guide }}</li>
            </ul>
          </div>

          <!-- 액션 버튼 -->
          <div class="modal-actions">
            <button class="btn-secondary" @click="selectedAlert = null">닫기</button>
            <button class="btn-secondary" @click="handleSnooze(detail.id, 1)">1일 스누즈</button>
            <button class="btn-secondary" @click="handleSnooze(detail.id, 7)">1주 스누즈</button>
            <button v-if="!detail.resolved" class="btn-primary" @click="handleResolve(detail.id)">해결 처리</button>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { sensorAlertsApi, type SensorAlert, type SensorEntry, type AlertDetail } from '../api/sensor-alerts.api'
import { useNotificationStore } from '../stores/notification.store'

const notificationStore = useNotificationStore()

const activeTab = ref('sensors')
const loading = ref(true)
const sensorsLoading = ref(true)
const alerts = ref<SensorAlert[]>([])
const sensors = ref<SensorEntry[]>([])
const filter = ref('all')
const selectedAlert = ref<SensorAlert | null>(null)
const detail = ref<AlertDetail | null>(null)
const detailLoading = ref(false)

const ALERT_TYPE_LABELS: Record<string, string> = {
  no_data: '데이터 없음',
  flatline: '값 고정',
  spike: '급변',
  out_of_range: '범위 이탈',
  unstable: '센서 불안정',
}

const SENSOR_TYPE_LABELS: Record<string, string> = {
  // 하우스 내부
  temperature: '온도',
  humidity: '습도',
  // 기상 관측
  dew_point: '이슬점',
  dew_point_temp: '이슬점 온도',
  rainfall: '강우량',
  rain_rate: '강우 강도',
  rain_1h: '1시간 강우',
  rain_24h: '24시간 강우',
  uv: '자외선',
  uv_index: 'UV 지수',
  atmospheric_pressture: '기압',
  pressure_drop: '기압 변화',
  windspeed_avg: '평균 풍속',
  windspeed_gust: '돌풍 풍속',
  // 온도 파생 지표
  feellike_temp: '체감온도',
  heat_index: '열지수',
  windchill_index: '풍속냉각지수',
  // 실외 온습도 (다채널)
  temp_current_external: '외부 온도',
  temp_current_external_1: '외부 온도 1',
  temp_current_external_2: '외부 온도 2',
  temp_current_external_3: '외부 온도 3',
  humidity_outdoor: '외부 습도',
  humidity_outdoor_1: '외부 습도 1',
  humidity_outdoor_2: '외부 습도 2',
  humidity_outdoor_3: '외부 습도 3',
}

const SENSOR_ICONS: Record<string, string> = {
  temperature: '🌡️',
  humidity: '💧',
  dew_point: '🌫️',
  dew_point_temp: '🌫️',
  rainfall: '🌧️',
  rain_rate: '🌧️',
  rain_1h: '🌧️',
  rain_24h: '🌧️',
  uv: '☀️',
  uv_index: '☀️',
  atmospheric_pressture: '🔵',
  pressure_drop: '🔵',
  windspeed_avg: '💨',
  windspeed_gust: '💨',
  feellike_temp: '🌡️',
  heat_index: '🌡️',
  windchill_index: '❄️',
  temp_current_external: '🌡️',
  temp_current_external_1: '🌡️',
  temp_current_external_2: '🌡️',
  temp_current_external_3: '🌡️',
  humidity_outdoor: '💧',
  humidity_outdoor_1: '💧',
  humidity_outdoor_2: '💧',
  humidity_outdoor_3: '💧',
}

const filterOptions = [
  { label: '전체', value: 'all' },
  { label: '미해결', value: 'unresolved' },
  { label: '심각', value: 'critical' },
  { label: '경고', value: 'warning' },
  { label: '해결됨', value: 'resolved' },
]

const activeSensors = computed(() => sensors.value.filter(s => !s.standby))
const standbySensors = computed(() => sensors.value.filter(s => s.standby))

// 대기 센서 알림 프론트엔드 방어 필터
const standbyKeys = computed(() => new Set(
  standbySensors.value.map(s => `${s.deviceId}:${s.sensorType}`)
))
const visibleAlerts = computed(() =>
  alerts.value.filter(a => !standbyKeys.value.has(`${a.deviceId}:${a.sensorType}`))
)

const unresolvedCount = computed(() => visibleAlerts.value.filter(a => !a.resolved).length)

const filteredAlerts = computed(() => {
  switch (filter.value) {
    case 'unresolved': return visibleAlerts.value.filter(a => !a.resolved)
    case 'critical': return visibleAlerts.value.filter(a => a.severity === 'critical' && !a.resolved)
    case 'warning': return visibleAlerts.value.filter(a => a.severity === 'warning' && !a.resolved)
    case 'resolved': return visibleAlerts.value.filter(a => a.resolved)
    default: return visibleAlerts.value
  }
})

function alertTypeLabel(type: string) { return ALERT_TYPE_LABELS[type] || type }
function sensorTypeLabel(type: string) {
  const ko = SENSOR_TYPE_LABELS[type]
  return ko ? `${ko} (${type})` : type
}
function sensorIcon(type: string) { return SENSOR_ICONS[type] || '📡' }

function formatSensorValue(value: number, type: string): string {
  if (type.includes('temp') || type === 'dew_point' || type === 'heat_index' || type === 'windchill_index') return value.toFixed(1)
  if (type.includes('humidity')) return value.toFixed(0)
  if (type.includes('rain') || type === 'rainfall') return value.toFixed(1)
  if (type.includes('wind')) return value.toFixed(1)
  if (type.includes('pressure') || type === 'atmospheric_pressture') return value.toFixed(1)
  if (type === 'uv' || type === 'uv_index') return value.toFixed(1)
  return value.toFixed(1)
}

function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 60) return `${minutes}분 전`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}시간 전`
  const days = Math.floor(hours / 24)
  return `${days}일 전`
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString('ko-KR')
}

async function loadAlerts() {
  loading.value = true
  try {
    const res = await sensorAlertsApi.getAlerts()
    alerts.value = res.data
  } catch {
    notificationStore.error('오류', '알림 목록을 불러오지 못했습니다.')
  } finally {
    loading.value = false
  }
}

async function loadSensors() {
  sensorsLoading.value = true
  try {
    const res = await sensorAlertsApi.getSensors()
    sensors.value = res.data
  } catch {
    notificationStore.error('오류', '센서 목록을 불러오지 못했습니다.')
  } finally {
    sensorsLoading.value = false
  }
}

async function moveToStandby(sensor: SensorEntry) {
  try {
    await sensorAlertsApi.addStandby(sensor.deviceId, sensor.sensorType)
    sensor.standby = true
    notificationStore.success('대기', `${sensor.deviceName} / ${sensorTypeLabel(sensor.sensorType)} 대기 목록으로 이동`)
    await loadAlerts()
  } catch {
    notificationStore.error('오류', '대기 목록 이동에 실패했습니다.')
  }
}

async function restoreFromStandby(sensor: SensorEntry) {
  try {
    await sensorAlertsApi.removeStandby(sensor.deviceId, sensor.sensorType)
    sensor.standby = false
    notificationStore.success('활성화', `${sensor.deviceName} / ${sensorTypeLabel(sensor.sensorType)} 활성화됨`)
    await loadAlerts()
  } catch {
    notificationStore.error('오류', '활성화에 실패했습니다.')
  }
}

async function openDetail(alert: SensorAlert) {
  selectedAlert.value = alert
  detailLoading.value = true
  detail.value = null
  try {
    const res = await sensorAlertsApi.getAlert(alert.id)
    detail.value = res.data
  } catch {
    notificationStore.error('오류', '상세 정보를 불러오지 못했습니다.')
    selectedAlert.value = null
  } finally {
    detailLoading.value = false
  }
}

async function handleResolve(id: string) {
  try {
    await sensorAlertsApi.resolveAlert(id)
    notificationStore.success('해결', '알림이 해결 처리되었습니다.')
    selectedAlert.value = null
    await loadAlerts()
  } catch {
    notificationStore.error('오류', '해결 처리에 실패했습니다.')
  }
}

async function handleRemove(id: string) {
  try {
    await sensorAlertsApi.removeAlert(id)
    alerts.value = alerts.value.filter(a => a.id !== id)
    notificationStore.success('삭제', '알림 이력이 삭제되었습니다.')
  } catch {
    notificationStore.error('오류', '알림 삭제에 실패했습니다.')
  }
}

async function handleSnooze(id: string, days: number) {
  try {
    await sensorAlertsApi.snoozeAlert(id, days)
    notificationStore.success('스누즈', `${days}일간 스누즈 설정되었습니다.`)
    selectedAlert.value = null
    await loadAlerts()
  } catch {
    notificationStore.error('오류', '스누즈 설정에 실패했습니다.')
  }
}

// 30초마다 알림 목록 자동 갱신
let pollTimer: ReturnType<typeof setInterval> | null = null

onMounted(async () => {
  await Promise.all([loadAlerts(), loadSensors()])
  pollTimer = setInterval(() => loadAlerts(), 30_000)
})

onBeforeUnmount(() => {
  if (pollTimer) clearInterval(pollTimer)
})
</script>

<style scoped>
.page-container {
  padding: 24px;
  max-width: 900px;
  margin: 0 auto;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 20px;
}

.page-header h2 {
  font-size: calc(1.4em * var(--content-title-scale, 1));
  font-weight: 700;
  color: var(--text-primary);
}

.page-description {
  color: var(--text-muted);
  margin-top: 4px;
}

.unresolved-badge {
  background: var(--danger);
  color: white;
  font-weight: 700;
  font-size: 0.85em;
  padding: 4px 12px;
  border-radius: 20px;
  min-width: 28px;
  text-align: center;
}

/* 탭 바 */
.tab-bar {
  display: flex;
  gap: 0;
  margin-bottom: 20px;
  border-bottom: 2px solid var(--border-card);
}

.tab-item {
  padding: 10px 20px;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  margin-bottom: -2px;
  color: var(--text-muted);
  font-size: 0.9em;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  gap: 6px;
}

.tab-item:hover { color: var(--text-secondary); }

.tab-item.active {
  color: var(--accent);
  border-bottom-color: var(--accent);
}

.tab-count {
  font-size: 0.78em;
  font-weight: 500;
  color: var(--text-muted);
  background: var(--bg-hover);
  padding: 1px 7px;
  border-radius: 10px;
}

.tab-badge {
  font-size: 0.72em;
  font-weight: 700;
  color: white;
  background: var(--danger);
  padding: 1px 7px;
  border-radius: 10px;
  min-width: 18px;
  text-align: center;
}

/* 센서 그리드 */
.sensor-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 12px;
}

.sensor-card {
  display: flex;
  gap: 12px;
  padding: 14px 16px;
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: 12px;
  align-items: center;
  box-shadow: var(--shadow-card);
}

.sensor-card.standby { opacity: 0.65; }

.sensor-icon { font-size: 1.6em; flex-shrink: 0; }
.sensor-icon.muted { opacity: 0.5; }

.sensor-info { flex: 1; min-width: 0; }

.sensor-device {
  font-weight: 600;
  font-size: 0.88em;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sensor-type {
  font-size: 0.78em;
  color: var(--text-muted);
  margin-bottom: 4px;
}

.sensor-value {
  font-size: 1.1em;
  font-weight: 700;
  color: var(--text-primary);
}

.sensor-value.muted { color: var(--text-muted); font-size: 0.85em; font-weight: 500; }

.sensor-unit {
  font-size: 0.75em;
  font-weight: 400;
  color: var(--text-muted);
  margin-left: 2px;
}

.sensor-time {
  font-size: 0.72em;
  color: var(--text-muted);
}

.standby-label {
  font-size: 0.75em;
  color: var(--text-muted);
  font-style: italic;
  margin-top: 2px;
}

.btn-standby, .btn-activate {
  width: 34px;
  height: 34px;
  border-radius: 8px;
  border: 1px solid var(--border-input);
  background: var(--bg-hover);
  color: var(--text-muted);
  cursor: pointer;
  font-size: 0.9em;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: all 0.2s;
}

.btn-standby:hover {
  background: rgba(255, 152, 0, 0.1);
  border-color: #FF9800;
  color: #FF9800;
}

.btn-activate:hover {
  background: rgba(76, 175, 80, 0.1);
  border-color: #4CAF50;
  color: #4CAF50;
}

/* 필터 칩 */
.filter-bar {
  display: flex;
  gap: 8px;
  margin-bottom: 20px;
  flex-wrap: wrap;
}

.filter-chip {
  padding: 8px 16px;
  border: 1px solid var(--border-color);
  border-radius: 20px;
  background: var(--bg-card);
  color: var(--text-secondary);
  font-size: 0.85em;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.filter-chip.active {
  background: var(--accent);
  color: white;
  border-color: var(--accent);
}

.filter-chip:hover:not(.active) {
  background: var(--bg-hover);
}

.loading-state, .empty-state {
  text-align: center;
  padding: 60px 20px;
  color: var(--text-muted);
}

.empty-state h3 {
  color: var(--text-primary);
  margin-bottom: 8px;
}
.empty-cta-link {
  display: inline-block;
  margin-top: 12px;
  color: var(--accent);
  font-weight: 600;
  text-decoration: none;
  font-size: calc(15px * var(--content-scale, 1));
}
.empty-cta-link:hover { text-decoration: underline; }

/* 알림 카드 */
.alerts-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.alert-card {
  display: flex;
  gap: 14px;
  padding: 16px;
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: 12px;
  cursor: pointer;
  transition: box-shadow 0.2s;
  box-shadow: var(--shadow-card);
}

.alert-card:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.alert-card.critical { border-left: 4px solid var(--danger); }
.alert-card.warning { border-left: 4px solid var(--warning); }
.alert-card.resolved { opacity: 0.6; }

.alert-severity {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.severity-icon { font-size: 1.2em; }

.severity-badge {
  font-size: 0.7em;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 10px;
  white-space: nowrap;
}

.severity-badge.critical { background: var(--danger-bg); color: var(--danger); }
.severity-badge.warning { background: #fff8e1; color: #f57c00; }
.theme-dark .severity-badge.warning { background: #3a2a1a; }

.alert-content { flex: 1; min-width: 0; }

.alert-title { font-weight: 600; color: var(--text-primary); margin-bottom: 4px; }

.alert-meta {
  display: flex;
  gap: 6px;
  font-size: 0.8em;
  color: var(--text-muted);
  margin-bottom: 6px;
}

.dot { color: var(--text-muted); }
.alert-type { font-weight: 600; color: var(--text-secondary); }

.alert-message {
  font-size: 0.85em;
  color: var(--text-secondary);
  margin-bottom: 4px;
  line-height: 1.4;
}

.alert-time { font-size: 0.75em; color: var(--text-muted); }

.alert-actions {
  display: flex;
  align-items: flex-start;
  flex-shrink: 0;
}

.btn-sm {
  padding: 6px 14px;
  border: 1px solid var(--accent);
  border-radius: 6px;
  background: none;
  color: var(--accent);
  font-size: 0.8em;
  font-weight: 600;
  cursor: pointer;
}

.btn-sm:hover { background: var(--accent-bg); }
.btn-sm.danger { border-color: var(--danger); color: var(--danger); }
.btn-sm.danger:hover { background: var(--danger-bg); }

/* 모달 */
.modal-overlay {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: var(--overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 300;
  padding: 20px;
}

.modal-content {
  background: var(--bg-card);
  border-radius: 14px;
  padding: 28px;
  width: 100%;
  max-width: 520px;
  max-height: 85vh;
  overflow-y: auto;
  box-shadow: var(--shadow-modal);
}

.detail-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.detail-header h3 {
  font-size: 1.2em;
  font-weight: 700;
  color: var(--text-primary);
}

.detail-info {
  font-size: 0.9em;
  color: var(--text-secondary);
  margin-bottom: 20px;
  line-height: 1.6;
}

.stats-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-bottom: 20px;
}

.stat-item {
  background: var(--bg-hover);
  padding: 12px;
  border-radius: 10px;
  text-align: center;
}

.stat-label {
  display: block;
  font-size: 0.75em;
  color: var(--text-muted);
  margin-bottom: 4px;
}

.stat-value {
  font-size: 1.1em;
  font-weight: 700;
  color: var(--text-primary);
}

.detail-reason, .detail-guides { margin-bottom: 20px; }

.detail-reason h4, .detail-guides h4 {
  font-size: 0.9em;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 8px;
}

.detail-reason p {
  font-size: 0.9em;
  color: var(--text-secondary);
  line-height: 1.5;
}

.detail-guides ul { list-style: none; padding: 0; }

.detail-guides li {
  font-size: 0.85em;
  color: var(--text-secondary);
  padding: 6px 0;
  padding-left: 16px;
  position: relative;
}

.detail-guides li::before {
  content: '•';
  position: absolute;
  left: 0;
  color: var(--accent);
  font-weight: 700;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 24px;
  flex-wrap: wrap;
}

.btn-primary {
  padding: 10px 20px;
  background: var(--accent);
  color: white;
  border: none;
  border-radius: 8px;
  font-weight: 600;
  cursor: pointer;
}

.btn-primary:hover { background: var(--accent-hover); }

.btn-secondary {
  padding: 10px 16px;
  background: var(--bg-hover);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  font-weight: 500;
  cursor: pointer;
  font-size: 0.9em;
}

@media (max-width: 768px) {
  .page-container { padding: 16px; }
  .page-header { flex-direction: column; gap: 12px; }
  .tab-item { padding: 10px 12px; font-size: 0.82em; }
  .sensor-grid { grid-template-columns: 1fr; }
  .alert-card { flex-direction: column; gap: 10px; }
  .alert-actions { align-self: flex-end; }
  .modal-content { padding: 20px; }
  .stats-grid { grid-template-columns: 1fr 1fr; gap: 8px; }
  .modal-actions { flex-direction: column; }
  .modal-actions button { width: 100%; }
}
</style>
