<template>
  <div class="sensor-compare">
    <!-- 비교 설정 -->
    <div class="compare-controls">
      <div class="compare-row">
        <div class="compare-group">
          <label>구역 1</label>
          <select v-model="group1Id" class="compare-select">
            <option value="">선택</option>
            <option v-for="g in groups" :key="g.id" :value="g.id">{{ g.name }}</option>
          </select>
        </div>
        <span class="compare-vs">vs</span>
        <div class="compare-group">
          <label>구역 2</label>
          <select v-model="group2Id" class="compare-select">
            <option value="">선택</option>
            <option v-for="g in groups" :key="g.id" :value="g.id">{{ g.name }}</option>
          </select>
        </div>
      </div>
      <div class="compare-row">
        <div class="compare-group">
          <label>항목</label>
          <select v-model="metric" class="compare-select">
            <option v-for="m in metricOptions" :key="m.value" :value="m.value">{{ m.label }}</option>
          </select>
        </div>
        <div class="compare-group">
          <label>기간</label>
          <select v-model="period" class="compare-select">
            <option value="1d">1일</option>
            <option value="7d">7일</option>
            <option value="30d">30일</option>
          </select>
        </div>
        <button class="btn-compare" @click="fetchComparison" :disabled="!canCompare || loading">
          {{ loading ? '조회 중...' : '비교' }}
        </button>
      </div>
    </div>

    <!-- 차트 -->
    <div v-if="chartData" class="compare-chart-wrap">
      <canvas ref="chartCanvas"></canvas>
    </div>

    <!-- 통계 비교 -->
    <div v-if="statsGroup1 && statsGroup2" class="compare-stats">
      <div class="stats-header">
        <span>통계 비교</span>
      </div>
      <table class="stats-table">
        <thead>
          <tr>
            <th></th>
            <th>{{ group1Name }}</th>
            <th>{{ group2Name }}</th>
            <th>차이</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>평균</td>
            <td>{{ statsGroup1.avg.toFixed(1) }}{{ metricUnit }}</td>
            <td>{{ statsGroup2.avg.toFixed(1) }}{{ metricUnit }}</td>
            <td :class="diffClass(statsGroup1.avg - statsGroup2.avg)">
              {{ (statsGroup1.avg - statsGroup2.avg) > 0 ? '+' : '' }}{{ (statsGroup1.avg - statsGroup2.avg).toFixed(1) }}{{ metricUnit }}
            </td>
          </tr>
          <tr>
            <td>최고</td>
            <td>{{ statsGroup1.max.toFixed(1) }}{{ metricUnit }}</td>
            <td>{{ statsGroup2.max.toFixed(1) }}{{ metricUnit }}</td>
            <td>-</td>
          </tr>
          <tr>
            <td>최저</td>
            <td>{{ statsGroup1.min.toFixed(1) }}{{ metricUnit }}</td>
            <td>{{ statsGroup2.min.toFixed(1) }}{{ metricUnit }}</td>
            <td>-</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-else-if="!loading && !chartData" class="compare-placeholder">
      <EmptyState
        icon="chart"
        title="비교할 구역과 항목을 선택하세요"
        description="두 구역의 측정 데이터를 오버레이 차트로 비교합니다"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onUnmounted } from 'vue'
import { useGroupStore } from '@/stores/group.store'
import { reportApi } from '@/api/report.api'
import { Chart, registerables } from 'chart.js'
import EmptyState from '@/components/common/EmptyState.vue'

Chart.register(...registerables)

const groupStore = useGroupStore()
const groups = computed(() => groupStore.iotGroups)

const group1Id = ref('')
const group2Id = ref('')
const metric = ref('temperature')
const period = ref('7d')
const loading = ref(false)
const chartData = ref<any>(null)
const chartCanvas = ref<HTMLCanvasElement | null>(null)
let chartInstance: Chart | null = null

interface Stats { avg: number; max: number; min: number }
const statsGroup1 = ref<Stats | null>(null)
const statsGroup2 = ref<Stats | null>(null)

const metricOptions = [
  { value: 'temperature', label: '온도 (°C)', unit: '°C' },
  { value: 'humidity', label: '습도 (%)', unit: '%' },
  { value: 'co2', label: 'CO₂ (ppm)', unit: 'ppm' },
  { value: 'light', label: '조도 (lx)', unit: 'lx' },
  { value: 'soil_moisture', label: '토양수분 (%)', unit: '%' },
]

const metricUnit = computed(() => metricOptions.find(m => m.value === metric.value)?.unit || '')
const group1Name = computed(() => groups.value.find(g => g.id === group1Id.value)?.name || '구역 1')
const group2Name = computed(() => groups.value.find(g => g.id === group2Id.value)?.name || '구역 2')
const canCompare = computed(() => group1Id.value && group2Id.value && group1Id.value !== group2Id.value)

const PERIOD_MS: Record<string, number> = {
  '1d': 24 * 3600000,
  '7d': 7 * 86400000,
  '30d': 30 * 86400000,
}

function diffClass(diff: number) {
  if (Math.abs(diff) < 0.5) return 'diff-neutral'
  return diff > 0 ? 'diff-positive' : 'diff-negative'
}

async function fetchComparison() {
  if (!canCompare.value) return
  loading.value = true

  try {
    const now = new Date()
    const start = new Date(now.getTime() - PERIOD_MS[period.value])
    const params = { sensorType: metric.value, startDate: start.toISOString(), endDate: now.toISOString() }

    const [res1, res2] = await Promise.all([
      reportApi.getHourlyData({ ...params, groupId: group1Id.value }),
      reportApi.getHourlyData({ ...params, groupId: group2Id.value }),
    ])

    const data1 = (res1.data || []).filter((d: any) => d.sensor_type === metric.value)
    const data2 = (res2.data || []).filter((d: any) => d.sensor_type === metric.value)

    statsGroup1.value = calcStats(data1)
    statsGroup2.value = calcStats(data2)

    chartData.value = { data1, data2 }
    await nextTick()
    renderChart(data1, data2)
  } catch {
    chartData.value = null
  } finally {
    loading.value = false
  }
}

function calcStats(data: any[]): Stats {
  const values = data.map(d => Number(d.avg_value)).filter(v => !isNaN(v))
  if (values.length === 0) return { avg: 0, max: 0, min: 0 }
  return {
    avg: values.reduce((a, b) => a + b, 0) / values.length,
    max: Math.max(...values),
    min: Math.min(...values),
  }
}

function renderChart(data1: any[], data2: any[]) {
  if (!chartCanvas.value) return
  if (chartInstance) chartInstance.destroy()

  const labels1 = data1.map(d => d.time)
  const labels2 = data2.map(d => d.time)
  const allLabels = [...new Set([...labels1, ...labels2])].sort()

  chartInstance = new Chart(chartCanvas.value, {
    type: 'line',
    data: {
      labels: allLabels.map(l => {
        const d = new Date(l)
        return `${(d.getMonth()+1)}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`
      }),
      datasets: [
        {
          label: group1Name.value,
          data: allLabels.map(l => {
            const found = data1.find(d => d.time === l)
            return found ? Number(found.avg_value) : null
          }),
          borderColor: '#2e7d32',
          backgroundColor: 'rgba(46,125,50,0.1)',
          fill: false,
          tension: 0.3,
          pointRadius: 2,
        },
        {
          label: group2Name.value,
          data: allLabels.map(l => {
            const found = data2.find(d => d.time === l)
            return found ? Number(found.avg_value) : null
          }),
          borderColor: '#2196f3',
          backgroundColor: 'rgba(33,150,243,0.1)',
          fill: false,
          tension: 0.3,
          borderDash: [5, 5],
          pointRadius: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top' },
        tooltip: { mode: 'index', intersect: false },
      },
      scales: {
        x: { display: true, ticks: { maxTicksLimit: 10, font: { size: 11 } } },
        y: { display: true, title: { display: true, text: metricUnit.value } },
      },
    },
  })
}

onUnmounted(() => {
  if (chartInstance) chartInstance.destroy()
})
</script>

<style scoped>
.sensor-compare {
  padding: 0;
}

.compare-controls {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 20px;
}

.compare-row {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  flex-wrap: wrap;
}

.compare-group {
  flex: 1;
  min-width: 120px;
}

.compare-group label {
  display: block;
  font-size: calc(12px * var(--content-scale, 1));
  color: var(--text-secondary);
  margin-bottom: 4px;
}

.compare-select {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--border-input);
  border-radius: 8px;
  background: var(--bg-input);
  color: var(--text-primary);
  font-size: calc(14px * var(--content-scale, 1));
}

.compare-vs {
  font-weight: 600;
  color: var(--text-secondary);
  padding-bottom: 8px;
}

.btn-compare {
  padding: 8px 20px;
  background: var(--accent, #2e7d32);
  color: #fff;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-size: calc(14px * var(--content-scale, 1));
  white-space: nowrap;
}

.btn-compare:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.compare-chart-wrap {
  height: 300px;
  margin-bottom: 20px;
}

.compare-stats {
  border: 1px solid var(--border-input);
  border-radius: 8px;
  overflow: hidden;
}

.stats-header {
  padding: 10px 14px;
  background: var(--bg-secondary);
  font-size: calc(13px * var(--content-scale, 1));
  font-weight: 600;
  border-bottom: 1px solid var(--border-input);
}

.stats-table {
  width: 100%;
  border-collapse: collapse;
  font-size: calc(13px * var(--content-scale, 1));
}

.stats-table th, .stats-table td {
  padding: 8px 14px;
  text-align: center;
  border-bottom: 1px solid var(--border-light);
}

.stats-table th {
  font-weight: 600;
  font-size: calc(12px * var(--content-scale, 1));
  color: var(--text-secondary);
}

.stats-table td:first-child {
  text-align: left;
  font-weight: 500;
}

.diff-positive { color: #e53935; }
.diff-negative { color: #2196f3; }
.diff-neutral { color: var(--text-secondary); }

.compare-placeholder {
  padding: 20px 0;
}

@media (max-width: 768px) {
  .compare-row {
    flex-direction: column;
    align-items: stretch;
  }
  .compare-vs {
    text-align: center;
    padding: 0;
  }
  .compare-chart-wrap {
    height: 220px;
  }
}
</style>
