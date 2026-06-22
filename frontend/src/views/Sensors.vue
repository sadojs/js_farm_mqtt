<template>
  <div class="page-container">
    <header class="page-header">
      <div>
        <h2>농장 환경</h2>
        <p class="page-description">농장 환경을 종합적으로 확인합니다</p>
      </div>
      <button class="btn-refresh" @click="refreshAll" :disabled="refreshing">
        {{ refreshing ? '새로고침 중...' : '새로고침' }}
      </button>
    </header>

    <!-- 로딩 -->
    <div v-if="loading" class="loading-state">
      <p>측정 데이터를 불러오는 중...</p>
    </div>

    <!-- 센서 없음 -->
    <EmptyState
      v-else-if="sensorGroups.length === 0"
      icon="<polyline points='22 12 18 12 15 21 9 3 6 12 2 12'/>"
      title="측정 데이터가 없습니다"
      description="아직 측정기가 등록된 구역이 없습니다.&#10;① 장치 관리에서 측정기를 등록하세요&#10;② 구역 관리에서 구역을 만들고 배치하세요&#10;③ 이곳에서 실시간 데이터를 확인하세요"
    >
      <router-link to="/gateways" class="btn-cta" style="margin-top: 8px;">게이트웨이 관리로 이동</router-link>
    </EmptyState>

    <!-- 구역별 환경 카드 (E1) -->
    <div v-else class="groups-container">
      <article
        v-for="group in sensorGroups"
        :key="group.id"
        class="env-card"
      >
        <!-- ── 카드 헤더: 점수 링 + 구역명 + 상태 배지 + 측정기 수 ── -->
        <header class="env-card-header" @click="toggleGroup(group.id)">
          <ScoreRing
            :score="scoreInfoFor(group.id).score"
            :variant="scoreInfoFor(group.id).variant"
          />
          <div class="env-card-title">
            <div class="title-row">
              <h3>{{ group.name }}</h3>
              <span :class="['status-badge', scoreInfoFor(group.id).variant]">
                <span class="status-dot" aria-hidden="true"></span>
                {{ scoreInfoFor(group.id).label }}
              </span>
            </div>
            <p class="meta-row">측정기 {{ group.sensors.length }}개</p>
          </div>
          <button
            type="button"
            class="toggle-btn"
            :aria-expanded="expandedGroups.has(group.id)"
            :aria-label="expandedGroups.has(group.id) ? '접기' : '펼치기'"
            @click.stop="toggleGroup(group.id)"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" :class="{ rotated: expandedGroups.has(group.id) }">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>
        </header>

        <!-- ── 카드 본문 (펼침 시) ── -->
        <div v-if="expandedGroups.has(group.id)" class="env-card-body">
          <!-- 로딩 -->
          <div v-if="loadingResolvedFor[group.id]" class="env-loading">
            환경 데이터를 불러오는 중...
          </div>

          <!-- 미설정 -->
          <div v-else-if="!resolvedByGroup[group.id] || !isEnvConfigured(group.id)" class="env-unconfigured">
            <div class="env-unconfigured-box">
              <p>환경 설정이 필요합니다</p>
              <router-link :to="`/groups?envConfig=${group.id}`" class="btn-cta">환경 설정하기</router-link>
            </div>
          </div>

          <!-- 환경 게이지 + 측정기 + 종합평가 -->
          <template v-else>
            <!-- 환경 게이지 그리드 -->
            <section class="gauge-grid">
              <div
                v-for="tile in gaugeTilesFor(group.id)"
                :key="tile.key"
                :class="['gauge-tile', { 'out-of-range': tile.outOfRange }]"
              >
                <div class="gauge-label">
                  <span class="gauge-icon" aria-hidden="true">{{ tile.icon }}</span>
                  <span class="gauge-name">{{ tile.label }}</span>
                </div>
                <div class="gauge-value-row">
                  <span :class="['gauge-value', { amber: tile.outOfRange }]">
                    {{ tile.displayValue }}
                  </span>
                  <span class="gauge-unit">{{ tile.unit }}</span>
                </div>
                <div class="gauge-bar" v-if="tile.hasTarget">
                  <div
                    class="gauge-band"
                    :style="{ left: tile.bandLeft + '%', width: tile.bandWidth + '%' }"
                  ></div>
                  <div
                    :class="['gauge-dot', tile.outOfRange ? 'amber' : 'green']"
                    :style="{ left: tile.dotLeft + '%' }"
                  ></div>
                </div>
                <div class="gauge-bar disabled" v-else></div>
                <div class="gauge-foot">
                  <span class="gauge-target">{{ tile.targetText }}</span>
                  <span class="gauge-source">{{ tile.source }}</span>
                </div>
              </div>
            </section>

            <!-- 측정기 목록 -->
            <section class="sensors-section">
              <h4 class="sensors-heading">측정기 {{ group.sensors.length }}</h4>
              <ul class="sensor-list">
                <li
                  v-for="s in group.sensorRows"
                  :key="s.id"
                  class="sensor-row"
                >
                  <span :class="['sensor-icon-chip', { offline: !s.online }]" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
                    </svg>
                  </span>
                  <span class="sensor-name">{{ s.name }}</span>
                  <span class="sensor-values">
                    <span
                      v-for="chip in s.chips"
                      :key="chip.field"
                      class="value-chip"
                    >
                      {{ chip.icon }} {{ chip.value }}<span class="chip-unit">{{ chip.unit }}</span>
                    </span>
                    <span v-if="s.chips.length === 0" class="value-chip-empty">데이터 없음</span>
                  </span>
                </li>
              </ul>
            </section>

            <!-- 종합 환경 평가 (기존 컴포넌트 그대로) -->
            <GroupEnvScore :resolved-data="resolvedByGroup[group.id]!" />
          </template>
        </div>
      </article>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, h } from 'vue'
import { useGroupStore } from '@/stores/group.store'
import { useDeviceStore } from '@/stores/device.store'
import { useWebSocket } from '@/composables/useWebSocket'
import { envConfigApi } from '@/api/env-config.api'
import type { ResolvedValue } from '@/api/env-config.api'
import GroupEnvScore from '@/components/dashboard/GroupEnvScore.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import type { Device } from '@/types/device.types'
import {
  calcVPD,
  calcEnvScore,
  calcSatVaporPressure,
  getDayNightParams,
} from '@/utils/widget-calculations'

const groupStore = useGroupStore()
const deviceStore = useDeviceStore()
const loading = ref(true)
const refreshing = ref(false)
const expandedGroups = ref(new Set<string>())

// 그룹별 resolved 환경 데이터
const resolvedByGroup = ref<Record<string, Record<string, ResolvedValue> | null>>({})
const loadingResolvedFor = ref<Record<string, boolean>>({})

// 센서 필드 메타데이터 (DB 기록은 전체, 화면 표시는 DISPLAY_FIELDS만)
const SENSOR_FIELD_META: Record<string, { label: string; icon: string; unit: string; min: number; max: number; color: string }> = {
  temperature: { label: '온도', icon: '🌡️', unit: '°C', min: -10, max: 50, color: '#f44336' },
  humidity: { label: '습도', icon: '💧', unit: '%', min: 0, max: 100, color: '#2196f3' },
  rainfall: { label: '강우량', icon: '🌧️', unit: 'mm', min: 0, max: 100, color: '#1565c0' },
  uv: { label: 'UV', icon: '☀️', unit: '', min: 0, max: 11, color: '#ff9800' },
  dew_point: { label: '이슬점', icon: '💦', unit: '°C', min: -10, max: 40, color: '#00bcd4' },
  co2: { label: 'CO2', icon: '🌫️', unit: 'ppm', min: 0, max: 2000, color: '#9c27b0' },
  light: { label: '조도', icon: '💡', unit: 'lux', min: 0, max: 100000, color: '#ff9800' },
  soil_moisture: { label: '토양수분', icon: '🌱', unit: '%', min: 0, max: 100, color: '#795548' },
  ph: { label: 'PH', icon: '⚗️', unit: '', min: 0, max: 14, color: '#009688' },
  ec: { label: 'EC', icon: '⚡', unit: 'mS/cm', min: 0, max: 10, color: '#607d8b' },
}

const DISPLAY_FIELDS = ['temperature', 'humidity', 'co2', 'rainfall', 'uv', 'dew_point']

// resolved roleKey → 게이지 라벨/도메인/목표 (목표는 calcEnvScore와 동일한 주야간 기준 사용)
function getGaugeBoundsFor(roleKey: string): {
  label: string
  icon: string
  unit: string
  fullMin: number
  fullMax: number
  optMin: number | null
  optMax: number | null
} | null {
  const dn = getDayNightParams()
  switch (roleKey) {
    case 'internal_temp':
      return { label: '온', icon: '🌡️', unit: '°C', fullMin: 10, fullMax: 35, optMin: dn.tempOptLow, optMax: dn.tempOptHigh }
    case 'internal_humidity':
      return { label: '습', icon: '💧', unit: '%', fullMin: 30, fullMax: 95, optMin: dn.rhOptLow, optMax: dn.rhOptHigh }
    case 'co2':
      return { label: 'CO₂', icon: '🌫️', unit: 'ppm', fullMin: 300, fullMax: 1500, optMin: 600, optMax: 900 }
    case 'external_temp':
      return { label: '외기', icon: '🌡️', unit: '°C', fullMin: -10, fullMax: 40, optMin: null, optMax: null }
    case 'external_humidity':
      return { label: '외습', icon: '💧', unit: '%', fullMin: 0, fullMax: 100, optMin: null, optMax: null }
    case 'wind_speed':
      return { label: '풍속', icon: '💨', unit: 'm/s', fullMin: 0, fullMax: 20, optMin: null, optMax: null }
    case 'uv':
      return { label: 'UV', icon: '☀️', unit: '', fullMin: 0, fullMax: 11, optMin: 0, optMax: 5 }
    case 'rainfall':
      return { label: '강우', icon: '🌧️', unit: 'mm', fullMin: 0, fullMax: 100, optMin: null, optMax: null }
    default:
      return null
  }
}

interface SensorChip { field: string; icon: string; value: string; unit: string }
interface SensorRow { id: string; name: string; online: boolean; chips: SensorChip[] }
interface SensorGroupView {
  id: string
  name: string
  sensors: Device[]
  sensorRows: SensorRow[]
}

const sensorGroups = computed<SensorGroupView[]>(() => {
  return groupStore.iotGroups
    .map(group => {
      const groupSensorIds = (group.devices || [])
        .filter(d => d.deviceType === 'sensor')
        .map(d => d.id)
      const sensors = deviceStore.devices.filter(d => groupSensorIds.includes(d.id))
      if (sensors.length === 0) return null

      const sensorRows: SensorRow[] = sensors.map(s => {
        const chips: SensorChip[] = []
        if (s.sensorData) {
          for (const field of DISPLAY_FIELDS) {
            const v = (s.sensorData as Record<string, number | null | undefined>)[field]
            if (v == null) continue
            const meta = SENSOR_FIELD_META[field]
            chips.push({
              field,
              icon: meta?.icon || '📊',
              value: formatSensorValue(field, v),
              unit: meta?.unit || '',
            })
          }
        }
        return {
          id: s.id,
          name: s.name,
          online: s.online === true,
          chips,
        }
      })

      return {
        id: group.id,
        name: group.name,
        sensors,
        sensorRows,
      }
    })
    .filter(Boolean) as SensorGroupView[]
})

function formatSensorValue(field: string, value: number): string {
  if (['temperature', 'dew_point', 'rainfall'].includes(field)) return value.toFixed(1)
  if (['co2'].includes(field)) return Math.round(value).toLocaleString()
  return Math.round(value).toString()
}

function clip(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

interface GaugeTile {
  key: string
  label: string
  icon: string
  displayValue: string
  unit: string
  source: string
  hasTarget: boolean
  bandLeft: number
  bandWidth: number
  dotLeft: number
  outOfRange: boolean
  targetText: string
}

function gaugeTilesFor(groupId: string): GaugeTile[] {
  const resolved = resolvedByGroup.value[groupId]
  if (!resolved) return []
  const tiles: GaugeTile[] = []
  for (const [key, item] of Object.entries(resolved)) {
    if (item.source === '미설정' || item.value == null) continue
    const bounds = getGaugeBoundsFor(key)
    if (!bounds) continue
    const n = Number(item.value)
    if (!isFinite(n)) continue

    const hasTarget = bounds.optMin != null && bounds.optMax != null
    const range = bounds.fullMax - bounds.fullMin
    const dotPct = clip(((n - bounds.fullMin) / range) * 100, 0, 100)
    let bandLeft = 0, bandWidth = 0, outOfRange = false, targetText = ''
    if (hasTarget) {
      bandLeft = clip(((bounds.optMin! - bounds.fullMin) / range) * 100, 0, 100)
      bandWidth = clip(((bounds.optMax! - bounds.optMin!) / range) * 100, 0, 100)
      outOfRange = n < bounds.optMin! || n > bounds.optMax!
      targetText = `목표 ${formatBound(bounds.optMin!, key)}~${formatBound(bounds.optMax!, key)}${bounds.unit}`
    } else {
      targetText = `현재값 표시`
    }

    tiles.push({
      key,
      label: bounds.label,
      icon: bounds.icon,
      displayValue: formatResolvedValue(n, key),
      unit: bounds.unit,
      source: item.source,
      hasTarget,
      bandLeft,
      bandWidth,
      dotLeft: dotPct,
      outOfRange,
      targetText,
    })
  }
  return tiles
}

function formatResolvedValue(n: number, key: string): string {
  if (key === 'co2') return Math.round(n).toLocaleString()
  if (['internal_temp', 'external_temp'].includes(key)) return n.toFixed(1)
  if (['internal_humidity', 'external_humidity', 'wind_speed', 'rainfall'].includes(key)) return n.toFixed(1)
  return n.toFixed(1)
}

function formatBound(n: number, key: string): string {
  if (key === 'co2') return Math.round(n).toLocaleString()
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

async function loadResolved(groupId: string) {
  loadingResolvedFor.value[groupId] = true
  try {
    const res = await envConfigApi.getResolved(groupId)
    resolvedByGroup.value[groupId] = res.data
  } catch {
    resolvedByGroup.value[groupId] = null
  } finally {
    loadingResolvedFor.value[groupId] = false
  }
}

function isEnvConfigured(groupId: string): boolean {
  const resolved = resolvedByGroup.value[groupId]
  if (!resolved) return false
  return Object.values(resolved).some(v => v.source !== '미설정')
}

// 카드 헤더용 점수 + 색상 분류
interface ScoreInfo { score: number | null; variant: 'good' | 'warn' | 'danger' | 'unset'; label: string }
function scoreInfoFor(groupId: string): ScoreInfo {
  const resolved = resolvedByGroup.value[groupId]
  if (!resolved || !isEnvConfigured(groupId)) {
    return { score: null, variant: 'unset', label: '미설정' }
  }
  const toNum = (k: string): number | null => {
    const v = resolved[k]?.value
    if (v == null) return null
    const n = Number(v)
    return isNaN(n) ? null : n
  }
  const t = toNum('internal_temp')
  const rh = toNum('internal_humidity')
  if (t == null || rh == null) {
    return { score: null, variant: 'unset', label: '데이터 부족' }
  }
  const vpd = calcVPD(t, rh)
  let dewPoint: number | null = null
  if (rh > 0) {
    const es = calcSatVaporPressure(t)
    const ea = es * rh / 100
    if (ea > 0) {
      const ln_ea = Math.log(ea / 0.6108)
      dewPoint = Math.round((237.3 * ln_ea) / (17.27 - ln_ea) * 10) / 10
    }
  }
  const env = calcEnvScore({
    vpd: vpd.value,
    vpdOptimal: vpd.optimal,
    insideTemp: t,
    insideHumidity: rh,
    insideDewpoint: dewPoint,
    uvNorm: null,
  })
  const variant: ScoreInfo['variant'] =
    env.color === 'green' ? 'good' : env.color === 'yellow' ? 'warn' : 'danger'
  const label = variant === 'good' ? '양호' : variant === 'warn' ? '주의' : '위험'
  return { score: env.score, variant, label }
}

async function toggleGroup(groupId: string) {
  if (expandedGroups.value.has(groupId)) {
    expandedGroups.value.delete(groupId)
  } else {
    expandedGroups.value.add(groupId)
    if (!resolvedByGroup.value[groupId]) {
      await loadResolved(groupId)
    }
  }
}

async function refreshAll() {
  refreshing.value = true
  try {
    await Promise.all([
      deviceStore.fetchDevices(),
      ...Object.keys(resolvedByGroup.value).map(gId => loadResolved(gId)),
    ])
  } finally {
    refreshing.value = false
  }
}

// 점수 링 — 간단한 인라인 컴포넌트
const ScoreRing = (props: { score: number | null; variant: 'good' | 'warn' | 'danger' | 'unset' }) => {
  const size = 60
  const stroke = 5
  const r = (size - stroke) / 2
  const C = 2 * Math.PI * r
  const score = props.score == null ? 0 : Math.max(0, Math.min(100, props.score))
  const offset = C * (1 - score / 100)
  const color =
    props.variant === 'good' ? '#4caf50' :
    props.variant === 'warn' ? '#ff9800' :
    props.variant === 'danger' ? '#f44336' :
    'var(--border-color)'

  const children = [
    h('circle', { cx: size / 2, cy: size / 2, r, fill: 'none', stroke: 'var(--border-light)', 'stroke-width': stroke }),
    props.variant !== 'unset' ? h('circle', {
      cx: size / 2, cy: size / 2, r,
      fill: 'none', stroke: color, 'stroke-width': stroke,
      'stroke-linecap': 'round',
      'stroke-dasharray': `${C} ${C}`,
      'stroke-dashoffset': offset,
      transform: `rotate(-90 ${size / 2} ${size / 2})`,
      style: 'transition: stroke-dashoffset 0.4s ease',
    }) : null,
  ].filter(Boolean)

  return h('div', { class: 'score-ring' }, [
    h('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}` }, children),
    h('div', { class: ['ring-center', props.variant] }, [
      props.score == null
        ? h('svg', { viewBox: '0 0 24 24', width: 22, height: 22, fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, [
            h('circle', { cx: 12, cy: 12, r: 3 }),
            h('path', { d: 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z' }),
          ])
        : h('span', { class: 'ring-number' }, String(props.score)),
    ]),
  ])
}

// WebSocket: sensor:update 수신 시 위젯 자동 갱신 (2초 디바운스)
const { on, off } = useWebSocket()
let refreshTimer: ReturnType<typeof setTimeout> | null = null

function handleSensorUpdate() {
  if (refreshTimer) clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => {
    for (const gId of expandedGroups.value) {
      loadResolved(gId)
    }
  }, 2000)
}

onMounted(async () => {
  try {
    await Promise.all([
      groupStore.fetchGroups(),
      deviceStore.fetchDevices(),
    ])
    for (const g of sensorGroups.value) {
      expandedGroups.value.add(g.id)
    }
  } catch (err) {
    console.error('센서 데이터 로딩 실패:', err)
  } finally {
    loading.value = false
  }
  await Promise.all(sensorGroups.value.map(g => loadResolved(g.id)))
  on('sensor:update', handleSensorUpdate)
})

onUnmounted(() => {
  off('sensor:update', handleSensorUpdate)
  if (refreshTimer) clearTimeout(refreshTimer)
})
</script>

<style scoped>
.page-container {
  padding: 24px;
  max-width: 1200px;
  margin: 0 auto;
}

.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 20px;
  flex-wrap: wrap;
  gap: 12px;
}

.page-header h2 { font-size: calc(32px * var(--content-scale, 1)); font-weight: 700; color: var(--text-primary); }
.page-description { color: var(--text-secondary); font-size: calc(16px * var(--content-scale, 1)); margin-top: 4px; }

.btn-refresh {
  padding: 12px 24px;
  background: var(--bg-hover);
  color: var(--text-primary);
  border: none;
  border-radius: 8px;
  font-weight: 500;
  font-size: calc(15px * var(--content-scale, 1));
  cursor: pointer;
  transition: background 0.2s;
}
.btn-refresh:hover:not(:disabled) { background: var(--border-color); }
.btn-refresh:disabled { opacity: 0.5; cursor: not-allowed; }

.loading-state {
  text-align: center;
  padding: 60px 20px;
  color: var(--text-secondary);
  font-size: calc(16px * var(--content-scale, 1));
}

.btn-cta {
  display: inline-block;
  margin-top: 16px;
  padding: 10px 24px;
  background: var(--accent);
  color: white;
  border-radius: 8px;
  text-decoration: none;
  font-weight: 600;
  font-size: calc(15px * var(--content-scale, 1));
  transition: background 0.2s;
}
.btn-cta:hover { background: var(--accent-hover); }

.groups-container {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* ============ E1 환경 카드 ============ */
.env-card {
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: 16px;
  box-shadow: var(--shadow-card);
  overflow: hidden;
}

.env-card-header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 18px 20px;
  cursor: pointer;
  transition: background 0.2s;
}
.env-card-header:hover { background: var(--bg-hover); }

.env-card-title {
  flex: 1;
  min-width: 0;
}

.title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.title-row h3 {
  font-size: calc(20px * var(--content-scale, 1));
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
}

.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: calc(12px * var(--content-scale, 1));
  font-weight: 600;
  border: 1px solid transparent;
}
.status-badge .status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}
.status-badge.good { color: #2e7d32; background: rgba(76, 175, 80, 0.12); border-color: rgba(76, 175, 80, 0.3); }
.status-badge.warn { color: #b45309; background: rgba(255, 152, 0, 0.12); border-color: rgba(255, 152, 0, 0.3); }
.status-badge.danger { color: #b71c1c; background: rgba(244, 67, 54, 0.12); border-color: rgba(244, 67, 54, 0.3); }
.status-badge.unset { color: var(--text-muted); background: var(--bg-badge); border-color: var(--border-light); }

.meta-row {
  margin: 4px 0 0;
  font-size: calc(13px * var(--content-scale, 1));
  color: var(--text-muted);
}

.toggle-btn {
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 6px;
  border-radius: 6px;
  transition: background 0.15s;
}
.toggle-btn:hover { background: var(--bg-hover); color: var(--text-primary); }
.toggle-btn svg { transition: transform 0.2s ease; }
.toggle-btn svg.rotated { transform: rotate(180deg); }

/* ── 점수 링 ── */
.score-ring {
  position: relative;
  width: 60px;
  height: 60px;
  flex-shrink: 0;
}
.score-ring .ring-center {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
}
.score-ring .ring-center.good { color: #2e7d32; }
.score-ring .ring-center.warn { color: #b45309; }
.score-ring .ring-center.danger { color: #b71c1c; }
.score-ring .ring-center.unset { color: var(--text-muted); }
.score-ring .ring-number {
  font-size: 20px;
  line-height: 1;
}

/* ── 카드 본문 ── */
.env-card-body {
  padding: 0 20px 20px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.env-loading {
  text-align: center;
  padding: 24px;
  color: var(--text-muted);
  font-size: calc(14px * var(--content-scale, 1));
}

.env-unconfigured {
  padding: 8px 0 0;
}
.env-unconfigured-box {
  border: 1.5px dashed var(--border-color);
  border-radius: 12px;
  padding: 28px 20px;
  text-align: center;
  color: var(--text-secondary);
  font-size: calc(15px * var(--content-scale, 1));
}
.env-unconfigured-box p { margin: 0 0 4px; }

/* ── 게이지 그리드 ── */
.gauge-grid {
  display: grid;
  /* minmax(0, 1fr) — 자식 min-content 가 viewport 폭을 넘기는 흔한 grid 함정 차단 */
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.gauge-tile {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  background: var(--bg-secondary, var(--bg-hover));
  border: 1px solid var(--border-light);
  border-radius: 12px;
  min-width: 0;
  overflow: hidden;
}
.gauge-tile.out-of-range {
  border-color: #fcd9a8;
}

.gauge-label {
  display: flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
  font-size: calc(12px * var(--content-scale, 1));
  color: var(--text-muted);
  font-weight: 600;
}
.gauge-icon { font-size: 14px; }
.gauge-name { white-space: nowrap; }

.gauge-value-row {
  display: flex;
  align-items: baseline;
  gap: 4px;
}
.gauge-value {
  font-size: calc(24px * var(--content-scale, 1));
  font-weight: 800;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}
.gauge-value.amber { color: #b45309; }
.gauge-unit {
  font-size: calc(12px * var(--content-scale, 1));
  color: var(--text-muted);
  font-weight: 500;
}

.gauge-bar {
  position: relative;
  height: 6px;
  background: var(--bg-hover);
  border-radius: 999px;
  overflow: visible;
}
.gauge-bar.disabled {
  opacity: 0.5;
}
.gauge-band {
  position: absolute;
  top: 0;
  bottom: 0;
  background: rgba(76, 175, 80, 0.25);
  border-radius: 999px;
}
.gauge-dot {
  position: absolute;
  top: 50%;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  transform: translate(-50%, -50%);
  border: 2px solid var(--bg-card);
}
.gauge-dot.green { background: #4caf50; }
.gauge-dot.amber { background: #ff9800; }

.gauge-foot {
  display: flex;
  justify-content: space-between;
  gap: 6px;
  font-size: calc(11px * var(--content-scale, 1));
  color: var(--text-muted);
}
.gauge-target { white-space: nowrap; }
.gauge-source {
  text-align: right;
  max-width: 80px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── 측정기 목록 ── */
.sensors-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.sensors-heading {
  font-size: calc(12px * var(--content-scale, 1));
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin: 0;
}
.sensor-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.sensor-row {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: var(--bg-secondary, var(--bg-hover));
  border: 1px solid var(--border-light);
  border-radius: 10px;
}
.sensor-icon-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: rgba(123, 31, 162, 0.12);
  color: var(--sensor-accent, #7b1fa2);
}
.sensor-icon-chip.offline {
  background: var(--bg-hover);
  color: var(--text-muted);
}
.sensor-name {
  font-size: calc(14px * var(--content-scale, 1));
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sensor-values {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.value-chip {
  display: inline-flex;
  align-items: baseline;
  gap: 2px;
  padding: 3px 10px;
  background: var(--bg-card);
  border: 1px solid var(--border-light);
  border-radius: 999px;
  font-size: calc(12px * var(--content-scale, 1));
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
}
.chip-unit {
  font-size: calc(10px * var(--content-scale, 1));
  color: var(--text-muted);
  font-weight: 500;
  margin-left: 1px;
}
.value-chip-empty {
  font-size: calc(11px * var(--content-scale, 1));
  color: var(--text-muted);
  font-style: italic;
}

/* ── 반응형 ── */
@media (max-width: 768px) {
  .page-container { padding: 4px 0; }
  .page-header h2 { font-size: calc(24px * var(--content-scale, 1)); }
  .gauge-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .env-card-body { padding: 0 12px 16px; }
  .env-card-header { padding: 14px 14px; gap: 12px; }
  .sensor-row {
    grid-template-columns: auto 1fr;
    grid-template-areas:
      "icon name"
      "values values";
  }
  .sensor-icon-chip { grid-area: icon; }
  .sensor-name { grid-area: name; }
  .sensor-values { grid-area: values; justify-content: flex-start; }
}
</style>
