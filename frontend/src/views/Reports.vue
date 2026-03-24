<template>
  <div class="page-container">
    <header class="page-header">
      <div>
        <h2>리포트</h2>
        <p class="page-description">농장 운영 데이터를 분석합니다</p>
      </div>
    </header>

    <!-- 필터 영역 -->
    <div class="filter-section">
      <div class="filter-row">
        <div class="filter-group">
          <label>그룹 선택</label>
          <select v-model="selectedGroup" class="filter-select">
            <option value="">전체 그룹</option>
            <option v-for="group in groups" :key="group.id" :value="group.id">
              {{ group.name }}
            </option>
          </select>
        </div>

        <div class="filter-group">
          <label>센서 타입</label>
          <select v-model="selectedSensorType" class="filter-select">
            <option v-for="st in sensorTypeOptions" :key="st.value" :value="st.value">
              {{ st.label }}
            </option>
          </select>
        </div>
      </div>

      <!-- 기간 선택 버튼 그룹 -->
      <div class="period-row">
        <label>기간 선택</label>
        <div class="period-buttons">
          <button
            v-for="opt in periodOptions"
            :key="opt.value"
            class="period-btn"
            :class="{ active: dateRange === opt.value }"
            @click="selectPeriod(opt.value)"
          >
            {{ opt.label }}
          </button>
        </div>
        <div v-if="dateRange === 'custom'" class="custom-dates">
          <VueDatePicker
            v-model="customStartDate"
            :model-type="'yyyy-MM-dd'"
            :dark="isDark"
            :enable-time-picker="false"
            class="custom-date-picker"
            :teleport="false"
            auto-apply
          >
            <template #dp-input="{ }">
              <input
                class="dp__pointer dp__input_readonly dp__input dp__input_reg"
                :value="customStartDate || ''"
                placeholder="시작 날짜"
                readonly
                inputmode="none"
              />
            </template>
          </VueDatePicker>
          <span class="date-separator">~</span>
          <VueDatePicker
            v-model="customEndDate"
            :model-type="'yyyy-MM-dd'"
            :dark="isDark"
            :enable-time-picker="false"
            class="custom-date-picker"
            :teleport="false"
            auto-apply
          >
            <template #dp-input="{ }">
              <input
                class="dp__pointer dp__input_readonly dp__input dp__input_reg"
                :value="customEndDate || ''"
                placeholder="종료 날짜"
                readonly
                inputmode="none"
              />
            </template>
          </VueDatePicker>
          <button class="btn-primary btn-sm" @click="onCustomQuery" :disabled="loadingData">조회</button>
        </div>
      </div>

      <!-- 다운로드 -->
      <div class="download-row">
        <span class="download-label">다운로드</span>
        <button class="btn-download csv" @click="exportToCSV" :disabled="loadingData">CSV 다운로드</button>
        <button class="btn-download pdf" @click="exportToPDF" :disabled="loadingData">PDF 다운로드</button>
      </div>
    </div>

    <!-- 환경 미설정 경고 -->
    <div v-if="envWarning" class="env-warning-banner">
      <span>⚠️ 선택된 그룹의 환경 항목이 설정되지 않았습니다.</span>
      <router-link :to="`/groups?envConfig=${selectedGroup}`" class="warning-link">환경 설정하기</router-link>
    </div>

    <!-- 로딩 -->
    <div v-if="loadingData" class="loading-state">데이터를 불러오는 중...</div>

    <template v-else-if="hourlyData.length > 0 && !envWarning">
      <!-- 통계 카드 -->
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-label">평균 온도</div>
          <div class="stat-value temp">{{ avgTemp }}<span class="stat-unit">°C</span></div>
        </div>
        <div class="stat-card">
          <div class="stat-label">평균 습도</div>
          <div class="stat-value humidity">{{ avgHumidity }}<span class="stat-unit">%</span></div>
        </div>
        <div class="stat-card">
          <div class="stat-label">장비 가동 시간</div>
          <div class="stat-value actuator">{{ actuatorHours }}<span class="stat-unit">시간</span></div>
        </div>
      </div>

      <!-- 온도 및 습도 추이 차트 -->
      <div class="chart-card">
        <h3 class="chart-title">{{ chartTitle }}</h3>
        <div class="chart-container">
          <Line v-if="sensorChartData" :data="sensorChartData" :options="lineChartOptions" />
        </div>
      </div>

      <!-- 장비 가동 현황 차트 -->
      <div class="chart-card">
        <h3 class="chart-title">장비 가동 현황</h3>
        <div class="chart-container">
          <Bar v-if="actuatorChartData" :data="actuatorChartData" :options="barChartOptions" />
        </div>
      </div>

      <!-- 상세 데이터 테이블 -->
      <div class="chart-card">
        <h3 class="chart-title">상세 데이터</h3>
        <div class="table-container">
          <table class="data-table">
            <thead>
              <tr>
                <th>시간</th>
                <th v-for="col in tableColumns" :key="col.key">{{ col.label }}</th>
                <th>가동 장비</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, i) in tableData" :key="i">
                <td>{{ row.time }}</td>
                <td v-for="col in tableColumns" :key="col.key">{{ row[col.key] ?? '-' }}</td>
                <td>{{ row.activeDevices }}</td>
              </tr>
            </tbody>
          </table>
          <div v-if="tableData.length === 0" class="empty-state">
            <p>조회된 데이터가 없습니다</p>
          </div>
        </div>
      </div>
    </template>

    <div v-else class="empty-state">
      <p>{{ envWarning ? '환경 설정 후 리포트를 확인할 수 있습니다.' : '조회된 데이터가 없습니다. 기간을 선택하여 조회해주세요.' }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { Line, Bar } from 'vue-chartjs'
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement,
  LineElement, BarElement, Title, Tooltip, Legend, Filler
} from 'chart.js'
import { reportApi } from '../api/report.api'
import { envConfigApi } from '../api/env-config.api'
import { useGroupStore } from '../stores/group.store'
import { VueDatePicker } from '@vuepic/vue-datepicker'
import '@vuepic/vue-datepicker/dist/main.css'
import { useLocalStorage } from '@vueuse/core'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Title, Tooltip, Legend, Filler)

const groupStore = useGroupStore()

const sfTheme = useLocalStorage('sf-theme', 'light')
const isDark = computed(() => sfTheme.value === 'dark')

// 필터 상태
const selectedGroup = ref('')
const selectedSensorType = ref('temp_humidity')

const sensorTypeOptions = [
  { value: 'temp_humidity', label: '온/습도 (실내·외부)', unit: '' },
  { value: 'temperature', label: '온도 (실내·외부)', unit: '°C' },
  { value: 'humidity', label: '습도 (실내·외부)', unit: '%' },
]

const dateRange = ref('12h')
const customStartDate = ref('')
const customEndDate = ref('')
const startDate = ref('')
const endDate = ref('')
const loadingData = ref(false)
const envWarning = ref(false)

const groups = computed(() => groupStore.groups)

const periodOptions = [
  { value: '12h', label: '12시간' },
  { value: 'today', label: '1일' },
  { value: 'week', label: '7일' },
  { value: 'month', label: '1개월' },
  { value: 'custom', label: '기간 선택' },
]

// 데이터
const hourlyData = ref<any[]>([])
const actuatorData = ref<any[]>([])
const statsData = ref<any[]>([])
const weatherData = ref<any[]>([])

// 현재 센서 타입 정보
const selectedSensorLabel = computed(() => {
  const opt = sensorTypeOptions.find(o => o.value === selectedSensorType.value)
  return opt ? opt.label : selectedSensorType.value
})
const selectedSensorUnit = computed(() => {
  const opt = sensorTypeOptions.find(o => o.value === selectedSensorType.value)
  return opt ? opt.unit : ''
})

// 온/습도 선택시 이중 차트
const showDualChart = computed(() => selectedSensorType.value === 'temp_humidity')
const chartTitle = computed(() => {
  const base = showDualChart.value ? '온도 및 습도' : selectedSensorLabel.value
  return `${base} 추이 (실내·외부 비교)`
})

// 통계 카드 값
const avgTemp = computed(() => {
  const stat = statsData.value.find((s: any) => s.sensor_type === 'temperature')
  return stat ? Number(stat.avg_value).toFixed(1) : '-'
})
const avgHumidity = computed(() => {
  const stat = statsData.value.find((s: any) => s.sensor_type === 'humidity')
  return stat ? Number(stat.avg_value).toFixed(1) : '-'
})
const actuatorHours = computed(() => {
  if (actuatorData.value.length === 0) return '0'
  return actuatorData.value.reduce((sum: number, d: any) => sum + Number(d.total_actions || 0), 0)
})

// 차트 색상
const CHART_COLORS: Record<string, { border: string; bg: string }> = {
  temperature: { border: '#4A90D9', bg: 'rgba(74, 144, 217, 0.1)' },
  humidity: { border: '#4caf50', bg: 'rgba(76, 175, 80, 0.1)' },
  weather_temperature: { border: '#FF9800', bg: 'rgba(255, 152, 0, 0.1)' },
  weather_humidity: { border: '#9C27B0', bg: 'rgba(156, 39, 176, 0.1)' },
}

// 시간 라벨 - 기간에 따라 포맷 변경
function formatTimeLabel(dateStr: string) {
  const d = new Date(dateStr)
  if (dateRange.value === '12h' || dateRange.value === 'today') {
    return `${String(d.getHours()).padStart(2, '0')}:00`
  }
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}시`
}

// 날씨 데이터를 시간 라벨 기준으로 매핑
function buildWeatherMap() {
  const map = new Map<string, any>()
  weatherData.value.forEach((d: any) => {
    map.set(formatTimeLabel(d.time), d)
  })
  return map
}

// 센서 차트 데이터
const sensorChartData = computed(() => {
  const sType = selectedSensorType.value
  const weatherMap = buildWeatherMap()

  if (showDualChart.value) {
    // 온도 + 습도 이중 차트 (실내·외부 비교)
    const tempData = hourlyData.value.filter((d: any) => d.sensor_type === 'temperature')
    const humData = hourlyData.value.filter((d: any) => d.sensor_type === 'humidity')
    const labels = tempData.map((d: any) => formatTimeLabel(d.time))

    return {
      labels,
      datasets: [
        {
          label: '실내 온도 (°C)',
          data: tempData.map((d: any) => Number(d.avg_value)),
          borderColor: CHART_COLORS.temperature.border,
          backgroundColor: CHART_COLORS.temperature.bg,
          tension: 0.4,
          fill: false,
          yAxisID: 'y',
          pointRadius: 4,
          pointBackgroundColor: CHART_COLORS.temperature.border,
        },
        {
          label: '외부 온도 (°C)',
          data: labels.map((label: string) => {
            const w = weatherMap.get(label)
            return w ? Number(w.temperature) : null
          }),
          borderColor: CHART_COLORS.weather_temperature.border,
          backgroundColor: CHART_COLORS.weather_temperature.bg,
          borderDash: [5, 5],
          tension: 0.4,
          fill: false,
          yAxisID: 'y',
          pointRadius: 3,
          pointBackgroundColor: CHART_COLORS.weather_temperature.border,
          spanGaps: true,
        },
        {
          label: '실내 습도 (%)',
          data: humData.map((d: any) => Number(d.avg_value)),
          borderColor: CHART_COLORS.humidity.border,
          backgroundColor: CHART_COLORS.humidity.bg,
          tension: 0.4,
          fill: false,
          yAxisID: 'y1',
          pointRadius: 4,
          pointBackgroundColor: CHART_COLORS.humidity.border,
        },
        {
          label: '외부 습도 (%)',
          data: labels.map((label: string) => {
            const w = weatherMap.get(label)
            return w ? Number(w.humidity) : null
          }),
          borderColor: CHART_COLORS.weather_humidity.border,
          backgroundColor: CHART_COLORS.weather_humidity.bg,
          borderDash: [5, 5],
          tension: 0.4,
          fill: false,
          yAxisID: 'y1',
          pointRadius: 3,
          pointBackgroundColor: CHART_COLORS.weather_humidity.border,
          spanGaps: true,
        },
      ],
    }
  }

  // 단일 센서 차트 (실내·외부 비교)
  const filtered = hourlyData.value.filter((d: any) => d.sensor_type === sType)
  const labels = filtered.map((d: any) => formatTimeLabel(d.time))
  const colors = CHART_COLORS[sType] || { border: '#666', bg: 'rgba(100,100,100,0.1)' }
  const weatherField = sType === 'temperature' ? 'temperature' : 'humidity'
  const weatherColors = CHART_COLORS[`weather_${sType}`] || { border: '#FF9800', bg: 'rgba(255,152,0,0.1)' }

  return {
    labels,
    datasets: [
      {
        label: `실내 ${selectedSensorLabel.value} (${selectedSensorUnit.value})`,
        data: filtered.map((d: any) => Number(d.avg_value)),
        borderColor: colors.border,
        backgroundColor: colors.bg,
        tension: 0.4,
        fill: true,
        pointRadius: 4,
        pointBackgroundColor: colors.border,
      },
      {
        label: `외부 ${selectedSensorLabel.value} (${selectedSensorUnit.value})`,
        data: labels.map((label: string) => {
          const w = weatherMap.get(label)
          return w ? Number(w[weatherField]) : null
        }),
        borderColor: weatherColors.border,
        backgroundColor: weatherColors.bg,
        borderDash: [5, 5],
        tension: 0.4,
        fill: false,
        pointRadius: 3,
        pointBackgroundColor: weatherColors.border,
        spanGaps: true,
      },
    ],
  }
})

const lineChartOptions = computed(() => {
  const base: any = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index' as const, intersect: false },
    plugins: { legend: { position: 'bottom' as const } },
  }

  if (showDualChart.value) {
    base.scales = {
      y: {
        type: 'linear' as const,
        position: 'left' as const,
        title: { display: true, text: '°C' },
      },
      y1: {
        type: 'linear' as const,
        position: 'right' as const,
        title: { display: true, text: '%' },
        grid: { drawOnChartArea: false },
      },
    }
  } else {
    base.scales = {
      y: {
        type: 'linear' as const,
        position: 'left' as const,
        title: { display: true, text: selectedSensorUnit.value },
      },
    }
  }

  return base
})

const actuatorChartData = computed(() => {
  const labels = actuatorData.value.map((d: any) => formatTimeLabel(d.time))
  return {
    labels,
    datasets: [{
      label: '가동 장비 수',
      data: actuatorData.value.map((d: any) => Number(d.total_actions)),
      backgroundColor: 'rgba(103, 58, 183, 0.7)',
      borderRadius: 6,
    }],
  }
})

const barChartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { position: 'bottom' as const } },
  scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } },
}

// 테이블 컬럼 (센서타입별 실외·실내 구분)
const tableColumns = computed(() => {
  if (showDualChart.value) {
    return [
      { key: 'outdoor_temperature', label: '실외온도 (°C)' },
      { key: 'indoor_temperature', label: '실내온도 (°C)' },
      { key: 'outdoor_humidity', label: '실외습도 (%)' },
      { key: 'indoor_humidity', label: '실내습도 (%)' },
    ]
  }
  if (selectedSensorType.value === 'temperature') {
    return [
      { key: 'outdoor_temperature', label: '실외온도 (°C)' },
      { key: 'indoor_temperature', label: '실내온도 (°C)' },
    ]
  }
  if (selectedSensorType.value === 'humidity') {
    return [
      { key: 'outdoor_humidity', label: '실외습도 (%)' },
      { key: 'indoor_humidity', label: '실내습도 (%)' },
    ]
  }
  return [
    { key: `outdoor_${selectedSensorType.value}`, label: `실외 ${selectedSensorLabel.value}` },
    { key: `indoor_${selectedSensorType.value}`, label: `실내 ${selectedSensorLabel.value}` },
  ]
})

// 테이블 데이터 (실외 날씨 + 실내 센서 + 가동장비 통합)
const tableData = computed(() => {
  const sensorMap = new Map<string, Record<string, number>>()
  const weatherMap = buildWeatherMap()
  const actMap = new Map<string, number>()

  hourlyData.value.forEach((d: any) => {
    const key = formatTimeLabel(d.time)
    if (!sensorMap.has(key)) sensorMap.set(key, {})
    sensorMap.get(key)![d.sensor_type] = Number(d.avg_value)
  })
  actuatorData.value.forEach((d: any) => {
    actMap.set(formatTimeLabel(d.time), Number(d.total_actions))
  })

  const allTimes = [...new Set([...sensorMap.keys(), ...actMap.keys(), ...weatherMap.keys()])].sort()
  return allTimes.map(time => {
    const sensors = sensorMap.get(time) || {}
    const weather = weatherMap.get(time)
    const row: Record<string, any> = { time, activeDevices: actMap.get(time) ?? 0 }

    // 실외 (날씨 데이터)
    row.outdoor_temperature = weather?.temperature != null ? Number(weather.temperature).toFixed(1) : '-'
    row.outdoor_humidity = weather?.humidity != null ? Number(weather.humidity).toFixed(1) : '-'

    // 실내 (센서 데이터)
    row.indoor_temperature = sensors.temperature != null ? sensors.temperature.toFixed(1) : '-'
    row.indoor_humidity = sensors.humidity != null ? sensors.humidity.toFixed(1) : '-'

    return row
  })
})

function selectPeriod(value: string) {
  dateRange.value = value
  if (value !== 'custom') {
    updateDateRange()
    loadAllData()
  }
}

function onCustomQuery() {
  updateDateRange()
  loadAllData()
}

function updateDateRange() {
  const now = new Date()
  const toISO = (d: Date) => d.toISOString()

  switch (dateRange.value) {
    case '12h':
      startDate.value = new Date(now.getTime() - 12 * 3600000).toISOString()
      endDate.value = toISO(now)
      break
    case 'today':
      startDate.value = new Date(now.getTime() - 24 * 3600000).toISOString()
      endDate.value = toISO(now)
      break
    case 'week':
      startDate.value = new Date(now.getTime() - 7 * 86400000).toISOString()
      endDate.value = toISO(now)
      break
    case 'month':
      startDate.value = new Date(now.getTime() - 30 * 86400000).toISOString()
      endDate.value = toISO(now)
      break
    case 'custom':
      if (customStartDate.value && customEndDate.value) {
        startDate.value = customStartDate.value
        endDate.value = customEndDate.value + 'T23:59:59'
      }
      break
  }
}

async function loadAllData() {
  if (!startDate.value || !endDate.value) return
  loadingData.value = true
  try {
    const baseParams = {
      startDate: startDate.value,
      endDate: endDate.value,
      groupId: selectedGroup.value || undefined,
    }

    const [statsRes, hourlyRes, actRes, weatherRes] = await Promise.all([
      reportApi.getStatistics({ ...baseParams, sensorType: undefined }),
      reportApi.getHourlyData({ ...baseParams, sensorType: undefined }),
      reportApi.getActuatorStats(baseParams),
      reportApi.getWeatherHourly({ startDate: baseParams.startDate, endDate: baseParams.endDate }).catch(() => ({ data: [] })),
    ])

    statsData.value = statsRes.data || []
    hourlyData.value = hourlyRes.data || []
    actuatorData.value = actRes.data || []
    weatherData.value = weatherRes.data || []
  } catch (err) {
    console.error('데이터 조회 실패:', err)
    statsData.value = []
    hourlyData.value = []
    actuatorData.value = []
    weatherData.value = []
  } finally {
    loadingData.value = false
  }
}

async function exportToCSV() {
  try {
    const { data: blob } = await reportApi.exportCsv({
      startDate: startDate.value,
      endDate: endDate.value,
      groupId: selectedGroup.value || undefined,
      sensorType: selectedSensorType.value,
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `sensor_report_${new Date().toISOString().split('T')[0]}.csv`
    link.click()
    URL.revokeObjectURL(url)
  } catch (err) {
    console.error('CSV 다운로드 실패:', err)
  }
}

async function exportToPDF() {
  // 현재 화면을 PDF로 변환 (간단한 window.print 활용)
  window.print()
}

async function checkEnvWarning(groupId: string) {
  if (!groupId) {
    envWarning.value = false
    return
  }
  try {
    const res = await envConfigApi.getResolved(groupId)
    envWarning.value = Object.values(res.data).every(v => v.source === '미설정')
  } catch {
    envWarning.value = false
  }
}

watch(selectedGroup, (groupId) => {
  checkEnvWarning(groupId)
})

watch([selectedGroup, selectedSensorType], () => {
  if (startDate.value && endDate.value) loadAllData()
})

onMounted(async () => {
  if (groupStore.groups.length === 0) await groupStore.fetchGroups()
  // 기본: 첫 번째 그룹 자동 선택
  if (groupStore.groups.length > 0) {
    selectedGroup.value = groupStore.groups[0].id
    checkEnvWarning(selectedGroup.value)
  }
  updateDateRange()
  loadAllData()
})
</script>

<style scoped>
.page-container { padding: 24px; max-width: 1200px; margin: 0 auto; }

.page-header {
  display: flex; align-items: flex-start; justify-content: space-between;
  margin-bottom: 24px; flex-wrap: wrap; gap: 12px;
}
.page-header h2 { font-size: calc(28px * var(--content-scale, 1)); font-weight: 700; color: var(--text-primary); }
.page-description { color: var(--text-secondary); font-size: calc(14px * var(--content-scale, 1)); margin-top: 4px; }

/* 필터 */
.filter-section {
  background: var(--bg-card); border: 1px solid var(--border-card);
  border-radius: 14px; padding: 20px; box-shadow: var(--shadow-card); margin-bottom: 24px;
}
.filter-row { display: flex; gap: 16px; margin-bottom: 16px; flex-wrap: wrap; }
.filter-group { display: flex; flex-direction: column; gap: 6px; flex: 1; min-width: 150px; }
.filter-group label, .period-row > label, .download-label {
  font-size: calc(14px * var(--content-scale, 1)); font-weight: 600; color: var(--text-secondary);
}
.filter-select, .filter-input {
  padding: 12px 14px; border: 1px solid var(--border-input); border-radius: 8px;
  font-size: calc(15px * var(--content-scale, 1)); background: var(--bg-input); color: var(--text-primary);
}
.filter-select:focus, .filter-input:focus { outline: none; border-color: var(--accent); }

/* 기간 버튼 */
.period-row { margin-bottom: 16px; display: flex; flex-direction: column; gap: 8px; }
.period-buttons { display: flex; gap: 8px; flex-wrap: wrap; }
.period-btn {
  padding: 10px 24px; border: 1px solid var(--border-input); border-radius: 8px;
  background: var(--bg-input); color: var(--text-primary); cursor: pointer;
  font-size: calc(15px * var(--content-scale, 1)); font-weight: 500; transition: all 0.2s;
}
.period-btn.active { background: var(--accent); color: white; border-color: var(--accent); }
.period-btn:hover:not(.active) { border-color: var(--accent); background: var(--accent-bg); }

.custom-dates { display: flex; gap: 8px; align-items: center; margin-top: 8px; flex-wrap: wrap; }
.date-separator { color: var(--text-muted); font-weight: 500; }

.custom-date-picker {
  min-width: 150px;
  max-width: 180px;
}

:deep(.dp__theme_dark) {
  --dp-background-color: var(--bg-card);
  --dp-text-color: var(--text-primary);
  --dp-border-color: var(--border-input);
  --dp-menu-border-color: var(--border-card);
  --dp-primary-color: var(--accent);
  --dp-primary-text-color: white;
  --dp-secondary-color: var(--text-muted);
  --dp-hover-color: var(--bg-secondary);
}

:deep(.dp__theme_light) {
  --dp-background-color: var(--bg-card);
  --dp-text-color: var(--text-primary);
  --dp-border-color: var(--border-input);
  --dp-primary-color: var(--accent);
  --dp-primary-text-color: white;
  --dp-hover-color: var(--bg-secondary);
}

:deep(.dp__input_icon) {
  display: none;
}

:deep(.dp__action_row) {
  display: none;
}

:deep(.dp__button_bottom) {
  display: none !important;
}

:deep(.dp__input) {
  font-size: calc(15px * var(--content-scale, 1));
  font-weight: 500;
  padding: 12px 14px;
  padding-left: 14px !important;
  border-radius: 8px;
  background: var(--bg-input);
  color: var(--text-primary);
}

/* 다운로드 */
.download-row { display: flex; align-items: center; gap: 12px; }
.btn-download {
  padding: 10px 20px; border-radius: 8px; font-size: calc(14px * var(--content-scale, 1));
  font-weight: 500; cursor: pointer; transition: all 0.2s;
}
.btn-download.csv {
  background: var(--bg-secondary); color: var(--text-primary);
  border: 1px solid var(--border-color);
}
.btn-download.csv:hover { border-color: var(--accent); }
.btn-download.pdf {
  background: var(--danger-bg); color: var(--danger); border: 1px solid var(--danger);
}
.btn-download.pdf:hover { opacity: 0.85; }
.btn-download:disabled { opacity: 0.5; cursor: not-allowed; }

.btn-primary { padding: 12px 24px; background: var(--accent); color: white; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; font-size: calc(15px * var(--content-scale, 1)); }
.btn-primary:hover { background: var(--accent-hover); }
.btn-sm { padding: 10px 16px; }

/* 통계 카드 */
.stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 24px; }
.stat-card {
  background: var(--bg-card); border: 1px solid var(--border-card);
  border-radius: 14px; padding: 20px; box-shadow: var(--shadow-card);
}
.stat-label { font-size: calc(14px * var(--content-scale, 1)); color: var(--text-muted); font-weight: 500; margin-bottom: 8px; }
.stat-value {
  font-size: calc(32px * var(--content-scale, 1)); font-weight: 700;
  font-variant-numeric: tabular-nums; line-height: 1.2;
}
.stat-value.temp { color: #e53935; }
.stat-value.humidity { color: var(--accent); }
.stat-value.actuator { color: #673ab7; }
.stat-unit { font-size: calc(16px * var(--content-scale, 1)); font-weight: 500; color: var(--text-muted); margin-left: 4px; }

/* 차트 카드 */
.chart-card {
  background: var(--bg-card); border: 1px solid var(--border-card);
  border-radius: 14px; padding: 20px; box-shadow: var(--shadow-card); margin-bottom: 24px;
}
.chart-title { font-size: calc(18px * var(--content-scale, 1)); font-weight: 600; color: var(--text-primary); margin: 0 0 16px; }
.chart-container { height: 320px; position: relative; }

/* 테이블 */
.table-container { overflow-x: auto; }
.data-table { width: 100%; border-collapse: collapse; }
.data-table thead { background: var(--bg-secondary); }
.data-table th {
  padding: 14px 16px; text-align: left; font-weight: 600; color: var(--text-primary);
  font-size: calc(14px * var(--content-scale, 1)); border-bottom: 2px solid var(--border-input);
}
.data-table td {
  padding: 12px 16px; border-bottom: 1px solid var(--border-light);
  font-size: calc(14px * var(--content-scale, 1)); color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}
.data-table tbody tr:hover { background: var(--bg-hover); }

.env-warning-banner {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: rgba(245, 158, 11, 0.1);
  border: 1px solid #f59e0b;
  border-radius: 10px;
  font-size: calc(14px * var(--content-scale, 1));
  color: var(--text-primary);
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.warning-link {
  color: var(--accent);
  font-weight: 600;
  text-decoration: none;
  white-space: nowrap;
}
.warning-link:hover { text-decoration: underline; }

.loading-state, .empty-state {
  text-align: center; padding: 60px 20px; color: var(--text-secondary); font-size: calc(16px * var(--content-scale, 1));
}

@media (max-width: 768px) {
  .page-container { padding: 16px; }
  .stats-grid { grid-template-columns: 1fr; }
  .chart-container { height: 250px; }
  .filter-row { flex-direction: column; }
  .period-buttons { flex-wrap: nowrap; overflow-x: auto; -webkit-overflow-scrolling: touch; }
  .period-btn { white-space: nowrap; flex-shrink: 0; }
  .download-row { flex-wrap: wrap; }
  .btn-download { white-space: nowrap; }
}

@media print {
  .filter-section, .download-row, .page-header { display: none; }
  .chart-card { break-inside: avoid; }
}
</style>

<style>
/* VueDatePicker 시계 아이콘 및 액션 행 숨김 (teleport 대응) */
.dp__button_bottom {
  display: none !important;
}
.dp__action_row {
  display: none !important;
}
</style>
