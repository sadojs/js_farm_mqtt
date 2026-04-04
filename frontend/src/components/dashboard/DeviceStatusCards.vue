<template>
  <div class="device-status-wrapper">
    <div class="detail-grid">
      <!-- 가동 중인 장치 -->
      <div class="detail-card">
        <div class="detail-card-header">
          <div class="detail-icon devices">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
          </div>
          <h3>가동 중인 장치</h3>
          <span class="detail-count">{{ actuatorOnline }} / {{ actuatorCount }}</span>
        </div>
        <div class="detail-list">
          <div v-if="actuatorDevices.length === 0" class="detail-empty">
            등록된 장치가 없습니다
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
            <div v-if="device.equipmentType === 'irrigation'" class="item-status-group">
              <span :class="['item-status', getIrrigationScheduleStatus(device).scheduled ? 'scheduled' : 'stopped']">
                {{ getIrrigationScheduleStatus(device).scheduled ? `일정 ON (${getIrrigationScheduleStatus(device).count})` : '일정 OFF' }}
              </span>
              <span :class="['item-status', getIrrigationScheduleStatus(device).running ? 'running' : 'stopped']">
                {{ getIrrigationScheduleStatus(device).running ? '가동중' : '대기' }}
              </span>
            </div>
            <span v-else :class="['item-status', device.switchState ? 'running' : 'stopped']">
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
          <h3>측정기 현황</h3>
          <span class="detail-count">{{ sensorOnline }} / {{ sensorCount }}</span>
        </div>
        <div class="detail-list">
          <div v-if="sensorDevices.length === 0" class="detail-empty">
            등록된 측정기가 없습니다
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
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useDeviceStore } from '../../stores/device.store'
import { useGroupStore } from '../../stores/group.store'
import { useAutomationStore } from '../../stores/automation.store'
import type { Device } from '../../types/device.types'

const deviceStore = useDeviceStore()
const groupStore = useGroupStore()
const automationStore = useAutomationStore()

function getIrrigationScheduleStatus(device: Device) {
  const status = automationStore.getDeviceIrrigationStatus(device.id)
  return {
    scheduled: (status?.enabledRuleCount ?? 0) > 0,
    count: status?.enabledRuleCount ?? 0,
    running: status?.isRunning ?? false,
  }
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

function getDeviceLocation(device: Device): string {
  for (const group of groupStore.groups) {
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
  if (['co2', 'light'].includes(field)) return Math.round(value).toLocaleString()
  return Math.round(value).toString()
}

onMounted(async () => {
  const promises: Promise<any>[] = []
  if (deviceStore.devices.length === 0) promises.push(deviceStore.fetchDevices())
  if (groupStore.groups.length === 0) promises.push(groupStore.fetchGroups())
  await Promise.all(promises)
})
</script>

<style scoped>
.device-status-wrapper {
  margin-bottom: 24px;
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
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

.detail-item:last-child { border-bottom: none; }
.detail-item:hover { background: var(--bg-hover); }

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
.item-status.scheduled { background: #e3f2fd; color: #1565c0; }
.item-status-group { display: flex; gap: 4px; flex-shrink: 0; }
.item-status.stopped { background: var(--bg-hover); color: var(--text-muted); }

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

@media (max-width: 768px) {
  .detail-grid { grid-template-columns: 1fr; }
  .detail-list { max-height: 240px; }
}
</style>
