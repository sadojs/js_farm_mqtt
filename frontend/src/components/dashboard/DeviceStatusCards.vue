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
            <router-link to="/gateways" class="empty-inline-link">설정하기</router-link>
          </div>
          <div
            v-for="device in actuatorDevices"
            :key="device.id"
            class="detail-item"
          >
            <div class="item-left">
              <EquipmentIcon
                :type="device.equipmentType"
                :active="isActuatorActive(device)"
                :size="16"
                :title="device.equipmentType ?? ''"
              />
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
            <!-- 수동 우회 활성: 룰이 일시 정지됨을 명시 -->
            <span v-if="device.userOverride" class="manual-override-badge"
              title="자동제어 룰의 의도와 다르게 수동으로 변경됨. 다시 룰 의도와 같은 상태로 토글하면 자동제어로 복귀합니다.">
              🖐 수동 모드
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
            <router-link to="/gateways" class="empty-inline-link">설정하기</router-link>
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
              <span
                v-if="getBattery(device.sensorData) != null"
                class="sensor-chip battery"
                :class="getBatteryClass(getBattery(device.sensorData))"
                :title="`배터리 ${getBattery(device.sensorData)}%`"
              >
                {{ getBatteryIcon(getBattery(device.sensorData)) }}
                <strong>{{ getBattery(device.sensorData) }}%</strong>
              </span>
              <!-- 우적센서: rain-override 비활성화 토글 (오탐 방지) -->
              <button
                v-if="isRainSensor(device)"
                type="button"
                class="rain-toggle-btn"
                :class="{ 'is-on': !(device as any).rainOverrideDisabled, 'is-off': (device as any).rainOverrideDisabled }"
                @click.stop="toggleRainOverride(device)"
                :title="(device as any).rainOverrideDisabled
                  ? '비 감지 시 자동 개폐기 닫기가 꺼져 있습니다. 클릭하여 다시 켜기'
                  : '비 감지 시 자동으로 개폐기를 닫습니다. 오탐 방지를 위해 끄려면 클릭'"
              >
                <span class="rain-toggle-icon">{{ (device as any).rainOverrideDisabled ? '🌂' : '☔' }}</span>
                <span class="rain-toggle-text">
                  <span class="rain-toggle-label">비 감지 자동 제어</span>
                  <span class="rain-toggle-state">{{ (device as any).rainOverrideDisabled ? '꺼짐' : '켜짐' }}</span>
                </span>
                <span class="rain-toggle-switch" aria-hidden="true">
                  <span class="rain-toggle-knob"></span>
                </span>
              </button>
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
import { deviceApi } from '../../api/device.api'
import EquipmentIcon from '../common/EquipmentIcon.vue'

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

// EquipmentIcon active 판정 — 기존 가동 판정 로직 그대로 사용
// 관수는 진행 중 timeline 또는 switchState, 그 외는 device.online && device.switchState
function isActuatorActive(device: Device): boolean {
  if (!device.online) return false
  if (device.equipmentType === 'irrigation') {
    return getIrrigationScheduleStatus(device).running
  }
  return !!device.switchState
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

function getBattery(sensorData: Record<string, number | null | undefined> | null | undefined): number | null {
  if (!sensorData) return null
  const v = (sensorData as any).battery
  return v != null ? Math.round(Number(v)) : null
}

function getBatteryIcon(pct: number | null): string {
  if (pct == null) return ''
  if (pct >= 75) return '🔋'   // full
  if (pct >= 30) return '🔋'   // medium
  return '🪫'                   // low
}

function getBatteryClass(pct: number | null): string {
  if (pct == null) return ''
  if (pct < 20) return 'battery-low'
  if (pct < 50) return 'battery-mid'
  return 'battery-ok'
}

function isRainSensor(device: Device): boolean {
  // 1) 센서 데이터에 rain_* 필드 (실제 비 감지 reading이 있었을 때)
  const data = device.sensorData as any
  if (data && ('rain_detection' in data || 'rain_intensity' in data || 'rainfall' in data)) return true
  // 2) 모델/이름 기반 — TS0207 solar rain sensor 등 (아직 reading 없어도 토글은 보여야 함)
  const model = (device.zigbeeModel || '').toLowerCase()
  if (model.includes('ts0207') || model.includes('rain')) return true
  const name = (device.name || '').toLowerCase()
  if (name.includes('우적') || name.includes('rain')) return true
  return false
}

async function toggleRainOverride(device: Device) {
  const next = !(device as any).rainOverrideDisabled
  try {
    await deviceApi.updateRainOverrideDisabled(device.id, next)
    ;(device as any).rainOverrideDisabled = next
  } catch (err) {
    console.error('우적센서 토글 실패:', err)
  }
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

.sensor-chip.battery {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}
.sensor-chip.battery.battery-ok  { background: rgba(16,185,129,.10); color: #059669; }
.sensor-chip.battery.battery-mid { background: rgba(245,158,11,.12); color: #d97706; }
.sensor-chip.battery.battery-low { background: rgba(239,68,68,.12); color: #dc2626; font-weight: 700; }

/* 수동 우회 배지 (manual override) — 자동제어가 일시 정지됨을 명시 */
.manual-override-badge {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 8px;
  border-radius: 6px;
  background: rgba(245,158,11,.12);
  color: #b45309;
  font-size: calc(11px * var(--content-scale, 1));
  font-weight: 700;
  white-space: nowrap;
  margin-left: 4px;
}

/* 우적센서 자동제어 토글 — 명확한 ON/OFF 버튼 (대시보드용) */
.rain-toggle-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px 6px 8px;
  border-radius: 10px;
  border: 1px solid transparent;
  cursor: pointer;
  font-size: calc(12px * var(--content-scale, 1));
  user-select: none;
  transition: all 0.15s;
  background: var(--bg-card, #fff);
}
.rain-toggle-btn.is-on {
  background: rgba(37,99,235,.08);
  border-color: rgba(37,99,235,.35);
  color: #1e40af;
}
.rain-toggle-btn.is-on:hover { background: rgba(37,99,235,.14); }
.rain-toggle-btn.is-off {
  background: rgba(156,163,175,.12);
  border-color: rgba(156,163,175,.35);
  color: #6b7280;
}
.rain-toggle-btn.is-off:hover { background: rgba(156,163,175,.2); }

.rain-toggle-icon { font-size: 18px; line-height: 1; }
.rain-toggle-text { display: inline-flex; flex-direction: column; align-items: flex-start; line-height: 1.2; }
.rain-toggle-label { font-size: calc(11px * var(--content-scale, 1)); opacity: 0.8; font-weight: 500; }
.rain-toggle-state { font-size: calc(13px * var(--content-scale, 1)); font-weight: 700; }

/* iOS-like 슬라이드 스위치 인디케이터 */
.rain-toggle-switch {
  position: relative;
  display: inline-block;
  width: 34px; height: 18px;
  border-radius: 999px;
  background: #cbd5e1;
  transition: background 0.2s;
  flex-shrink: 0;
}
.rain-toggle-knob {
  position: absolute;
  top: 2px; left: 2px;
  width: 14px; height: 14px;
  border-radius: 50%;
  background: #fff;
  transition: transform 0.2s;
  box-shadow: 0 1px 2px rgba(0,0,0,.2);
}
.rain-toggle-btn.is-on .rain-toggle-switch { background: #3b82f6; }
.rain-toggle-btn.is-on .rain-toggle-knob { transform: translateX(16px); }

@media (max-width: 768px) {
  .device-status-wrapper { margin-bottom: 16px; }
  .detail-grid { grid-template-columns: 1fr; gap: 10px; }
  .detail-card { border-radius: 12px; }
  .detail-card-header { padding: 12px 14px; gap: 10px; }
  .detail-icon { width: 34px; height: 34px; }
  .detail-icon svg { width: 17px; height: 17px; }
  .detail-list { max-height: 240px; }
  /* 우적 토글: 모바일에서도 한눈에 보이도록 약간 작게 + 더 명확하게 */
  .rain-toggle-btn { padding: 5px 9px 5px 7px; gap: 7px; }
  .rain-toggle-icon { font-size: 16px; }
  .rain-toggle-switch { width: 30px; height: 16px; }
  .rain-toggle-knob { width: 12px; height: 12px; }
  .rain-toggle-btn.is-on .rain-toggle-knob { transform: translateX(14px); }
}
</style>
