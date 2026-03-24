<template>
  <div class="dashboard-detail">
    <!-- 상단 2열: 가동 장비 + 센서 현황 -->
    <div class="detail-grid">
      <!-- 가동 중인 장비 -->
      <div class="detail-card">
        <div class="detail-card-header">
          <div class="detail-icon devices">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
          </div>
          <h3>가동 중인 장비</h3>
          <span class="detail-count">{{ actuatorOnline }} / {{ actuatorCount }}</span>
        </div>
        <div class="detail-list">
          <div v-if="actuatorDevices.length === 0" class="detail-empty">
            등록된 장비가 없습니다
            <router-link to="/devices" class="empty-inline-link">설정하기</router-link>
          </div>
          <div
            v-for="device in actuatorDevices"
            :key="device.id"
            class="detail-item"
          >
            <div class="item-left">
              <span :class="['status-dot', device.online ? 'online' : 'offline']"></span>
              <div class="item-info">
                <span class="item-name">{{ device.name }}</span>
                <span class="item-location">{{ getDeviceLocation(device) }}</span>
              </div>
            </div>
            <span :class="['item-status', device.switchState ? 'running' : 'stopped']">
              {{ device.online ? (device.switchState ? '가동중' : '대기') : '오프라인' }}
            </span>
          </div>
        </div>
      </div>

      <!-- 센서 현황 -->
      <div class="detail-card">
        <div class="detail-card-header">
          <div class="detail-icon sensors">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
          </div>
          <h3>센서 현황</h3>
          <span class="detail-count">{{ sensorOnline }} / {{ sensorCount }}</span>
        </div>
        <div class="detail-list">
          <div v-if="sensorDevices.length === 0" class="detail-empty">
            등록된 센서가 없습니다
            <router-link to="/devices" class="empty-inline-link">설정하기</router-link>
          </div>
          <div
            v-for="device in sensorDevices"
            :key="device.id"
            class="detail-item sensor-detail-item"
          >
            <div class="sensor-item-top">
              <span :class="['status-dot', device.online ? 'online' : 'offline']"></span>
              <div class="item-info">
                <span class="item-name">{{ device.name }}</span>
                <span class="item-location">{{ getDeviceLocation(device) }}</span>
              </div>
            </div>
            <div v-if="device.sensorData && device.online" class="sensor-chip-row">
              <span
                v-for="(val, key) in getTopSensorValues(device.sensorData)"
                :key="key"
                class="sensor-chip"
              >
                {{ SENSOR_META[key as string]?.label || key }}
                <strong>{{ formatVal(key as string, val as number) }}{{ SENSOR_META[key as string]?.unit || '' }}</strong>
              </span>
            </div>
            <span v-else :class="['item-status', device.online ? 'running' : 'stopped']">
              {{ device.online ? '대기' : '오프라인' }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- 하단 요약 카드 -->
    <div class="summary-row">
      <div :class="['summary-item', canNavigate(0) && 'summary-item-link']" @click="navigateTo(0)">
        <div class="summary-icon equip">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
        </div>
        <div class="summary-text">
          <span class="summary-number">{{ actuatorCount + sensorCount }}</span>
          <span class="summary-label">전체 장비</span>
        </div>
      </div>
      <div :class="['summary-item', canNavigate(1) && 'summary-item-link']" @click="navigateTo(1)">
        <div class="summary-icon group">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        </div>
        <div class="summary-text">
          <span class="summary-number">{{ groupCount }}</span>
          <span class="summary-label">활성 그룹</span>
        </div>
      </div>
      <div :class="['summary-item', canNavigate(2) && 'summary-item-link']" @click="navigateTo(2)">
        <div class="summary-icon auto">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        </div>
        <div class="summary-text">
          <span class="summary-number">{{ ruleActive }} / {{ ruleCount }}</span>
          <span class="summary-label">자동화 룰</span>
        </div>
      </div>
      <div :class="['summary-item', canNavigate(3) && 'summary-item-link']" @click="navigateTo(3)">
        <div class="summary-icon online">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        </div>
        <div class="summary-text">
          <span class="summary-number">{{ onlineTotal }}</span>
          <span class="summary-label">온라인 기기</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useDeviceStore } from '../../stores/device.store'
import { useGroupStore } from '../../stores/group.store'
import { useAutomationStore } from '../../stores/automation.store'
import { useAuthStore } from '../../stores/auth.store'
import type { Device } from '../../types/device.types'

const router = useRouter()
const deviceStore = useDeviceStore()
const groupStore = useGroupStore()
const automationStore = useAutomationStore()
const authStore = useAuthStore()

const summaryCards = [
  { route: '/devices',    denyFarmUser: true  },
  { route: '/groups',     denyFarmUser: false },
  { route: '/automation', denyFarmUser: true  },
  { route: '/devices',    denyFarmUser: true  },
]

function canNavigate(index: number): boolean {
  if (summaryCards[index].denyFarmUser && authStore.isFarmUser) return false
  return true
}

function navigateTo(index: number) {
  if (!canNavigate(index)) return
  router.push(summaryCards[index].route)
}

const DISPLAY_FIELDS = ['temperature', 'humidity', 'co2', 'rainfall', 'uv', 'dew_point']

const SENSOR_META: Record<string, { label: string; unit: string }> = {
  temperature: { label: '온도', unit: '°C' },
  humidity: { label: '습도', unit: '%' },
  co2: { label: 'CO2', unit: 'ppm' },
  rainfall: { label: '강우량', unit: 'mm' },
  uv: { label: 'UV', unit: '' },
  dew_point: { label: '이슬점', unit: '°C' },
}

const sensorDevices = computed(() => deviceStore.sensorDevices)
const actuatorDevices = computed(() => deviceStore.actuatorDevices)
const sensorCount = computed(() => sensorDevices.value.length)
const sensorOnline = computed(() => sensorDevices.value.filter(d => d.online).length)
const actuatorCount = computed(() => actuatorDevices.value.length)
const actuatorOnline = computed(() => actuatorDevices.value.filter(d => d.online).length)
const groupCount = computed(() => groupStore.groups.length)
const ruleCount = computed(() => automationStore.rules.length)
const ruleActive = computed(() => automationStore.rules.filter(r => r.enabled).length)
const onlineTotal = computed(() => deviceStore.onlineDevices.length)

function getDeviceLocation(device: Device): string {
  for (const group of groupStore.groups) {
    if (device.houseId) {
      const house = (group.houses || []).find(h => h.id === device.houseId)
      if (house) return `${group.name} > ${house.name}`
    }
    if ((group.devices || []).some(d => d.id === device.id)) {
      return group.name
    }
  }
  return ''
}

function getTopSensorValues(sensorData: Record<string, number | null | undefined>): Record<string, number> {
  const entries = Object.entries(sensorData)
    .filter(([k, v]) => v != null && DISPLAY_FIELDS.includes(k)) as [string, number][]
  return Object.fromEntries(entries)
}

function formatVal(field: string, value: number): string {
  if (['temperature', 'dew_point', 'rainfall'].includes(field)) return value.toFixed(1)
  if (field === 'co2' || field === 'light') return Math.round(value).toLocaleString()
  return Math.round(value).toString()
}

onMounted(async () => {
  const promises: Promise<any>[] = []
  if (deviceStore.devices.length === 0) promises.push(deviceStore.fetchDevices())
  if (groupStore.groups.length === 0) promises.push(groupStore.fetchGroups())
  if (automationStore.rules.length === 0) promises.push(automationStore.fetchRules())
  await Promise.all(promises)

  // 센서 상태도 가져오기
  if (deviceStore.sensorDevices.some(d => d.online && !d.sensorData)) {
    await deviceStore.fetchAllSensorStatuses()
  }
  // 액추에이터 상태도 가져오기
  if (deviceStore.actuatorDevices.some(d => d.online && d.switchState === undefined)) {
    await deviceStore.fetchAllActuatorStatuses()
  }
})
</script>

<style scoped>
.dashboard-detail {
  margin-bottom: 24px;
}

/* 상단 2열 */
.detail-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
  margin-bottom: 16px;
}

.detail-card {
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: 14px;
  box-shadow: var(--shadow-card);
  overflow: hidden;
}

.detail-card-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 18px 20px;
  border-bottom: 1px solid var(--border-light);
}

.detail-icon {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.detail-icon svg {
  width: 20px;
  height: 20px;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.detail-icon.devices { background: var(--accent-bg); color: var(--accent); }
.detail-icon.sensors { background: var(--sensor-bg); color: var(--sensor-accent); }

.detail-card-header h3 {
  flex: 1;
  font-size: calc(18px * var(--content-scale, 1));
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.detail-count {
  font-size: calc(15px * var(--content-scale, 1));
  font-weight: 600;
  color: var(--accent);
  background: var(--accent-bg);
  padding: 4px 12px;
  border-radius: 20px;
}

/* 리스트 */
.detail-list {
  max-height: 320px;
  overflow-y: auto;
}

.detail-empty {
  padding: 32px 20px;
  text-align: center;
  color: var(--text-muted);
  font-size: calc(15px * var(--content-scale, 1));
}
.empty-inline-link {
  display: inline-block;
  margin-top: 8px;
  color: var(--accent);
  font-weight: 600;
  text-decoration: none;
  font-size: calc(14px * var(--content-scale, 1));
}
.empty-inline-link:hover { text-decoration: underline; }

.detail-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  border-bottom: 1px solid var(--border-light);
  transition: background 0.15s;
}

.detail-item:last-child {
  border-bottom: none;
}

.detail-item:hover {
  background: var(--bg-hover);
}

.item-left {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  flex: 1;
}

.status-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}
.status-dot.online { background: var(--toggle-on); }
.status-dot.offline { background: var(--border-color); }

.item-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.item-name {
  font-size: calc(15px * var(--content-scale, 1));
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-location {
  font-size: calc(13px * var(--content-scale, 1));
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-status {
  padding: 4px 12px;
  border-radius: 6px;
  font-size: calc(14px * var(--content-scale, 1));
  font-weight: 600;
  flex-shrink: 0;
}
.item-status.running { background: var(--accent-bg); color: var(--accent); }
.item-status.stopped { background: var(--bg-hover); color: var(--text-muted); }

/* 센서 아이템 2줄 구조 */
.sensor-detail-item {
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
}

.sensor-item-top {
  display: flex;
  align-items: center;
  gap: 10px;
}

.sensor-chip-row {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.sensor-chip {
  padding: 4px 10px;
  background: var(--sensor-bg);
  border-radius: 6px;
  font-size: calc(13px * var(--content-scale, 1));
  color: var(--sensor-accent);
  white-space: nowrap;
}

.sensor-chip strong {
  margin-left: 4px;
  font-weight: 700;
}

/* 하단 요약 */
.summary-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
}

.summary-item {
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: 14px;
  padding: 18px 20px;
  box-shadow: var(--shadow-card);
  display: flex;
  align-items: center;
  gap: 14px;
}

.summary-item-link {
  cursor: pointer;
  transition: background 0.15s, transform 0.15s;
}

.summary-item-link:hover {
  background: var(--bg-hover);
  transform: translateY(-1px);
}

.summary-item-link:active {
  transform: translateY(0);
}

.summary-icon {
  width: 44px;
  height: 44px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.summary-icon svg {
  width: 22px;
  height: 22px;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.summary-icon.equip { background: var(--accent-bg); color: var(--accent); }
.summary-icon.group { background: var(--bg-info-banner); color: var(--text-info-banner); }
.summary-icon.auto { background: var(--automation-bg); color: var(--automation-text); }
.summary-icon.online { background: var(--accent-bg); color: var(--accent); }

.summary-text {
  display: flex;
  flex-direction: column;
}

.summary-number {
  font-size: calc(24px * var(--content-scale, 1));
  font-weight: 700;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
}

.summary-label {
  font-size: calc(14px * var(--content-scale, 1));
  color: var(--text-muted);
  margin-top: 2px;
}

@media (max-width: 768px) {
  .detail-grid {
    grid-template-columns: 1fr;
  }

  .summary-row {
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;
  }

  .summary-item {
    padding: 14px 16px;
  }

  .summary-number {
    font-size: calc(20px * var(--content-scale, 1));
  }

  .detail-list {
    max-height: 240px;
  }
}
</style>
