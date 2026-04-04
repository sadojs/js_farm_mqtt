<template>
  <div class="page-container">
    <header class="page-header">
      <div>
        <h2>우리 농장</h2>
        <p class="page-description">농장의 현재 상태를 한눈에 확인하세요</p>
      </div>
      <div class="header-actions">
        <button @click="isEditMode ? exitEditMode() : enterEditMode()" class="btn-header-sm">
          {{ isEditMode ? '완료' : '⚙ 편집' }}
        </button>
        <button @click="refreshWeather" class="btn-refresh" :disabled="loading">
          {{ loading ? '조회 중...' : '새로고침' }}
        </button>
      </div>
    </header>

    <div v-if="errorMessage" class="error-banner">
      {{ errorMessage }}
    </div>

    <!-- 대시보드 편집 모드 -->
    <div v-if="isEditMode" class="dashboard-edit-panel">
      <h4>위젯 설정</h4>
      <div class="widget-edit-list">
        <div v-for="widget in layout" :key="widget.id" class="widget-edit-item">
          <label class="widget-checkbox">
            <input type="checkbox" :checked="widget.visible" @change="toggleWidget(widget.id)" />
            <span>{{ widget.title }}</span>
          </label>
          <div class="widget-order-btns">
            <button @click="moveWidget(widget.id, 'up')" class="btn-order" aria-label="위로">↑</button>
            <button @click="moveWidget(widget.id, 'down')" class="btn-order" aria-label="아래로">↓</button>
          </div>
        </div>
      </div>
      <button @click="resetLayout()" class="btn-reset">기본값으로 초기화</button>
    </div>

    <!-- 위젯 동적 렌더링 -->
    <template v-for="widget in visibleWidgets" :key="widget.id">
      <!-- 날씨 위젯 -->
      <div v-if="widget.type === 'weather'" class="weather-card">
        <div class="weather-top">
          <div class="weather-left">
            <div class="weather-icon-big">{{ weatherIcon }}</div>
            <div>
              <h3 class="weather-title">날씨 정보</h3>
              <span class="weather-location">{{ locationLabel }}</span>
            </div>
          </div>
          <div class="weather-right">
            <div class="weather-temp-line">
              <span class="weather-temp-big">{{ formatValue(weather.temperature, '') }}</span>
              <span class="weather-temp-unit">°C</span>
            </div>
            <div class="weather-condition">{{ weather.condition === 'rain' ? '비' : '맑음' }}</div>
          </div>
        </div>
        <div class="weather-details-grid">
          <div class="weather-detail-item">
            <span class="detail-label">💧 습도</span>
            <span class="detail-value">{{ formatValue(weather.humidity, '%') }}</span>
          </div>
          <div class="weather-detail-item">
            <span class="detail-label">💨 풍속</span>
            <span class="detail-value">{{ formatValue(weather.windSpeed, 'm/s') }}</span>
          </div>
          <div class="weather-detail-item">
            <span class="detail-label">🌧️ 강수량</span>
            <span class="detail-value">{{ formatValue(weather.precipitation, 'mm') }}</span>
          </div>
        </div>
      </div>

      <!-- 요약 카드 위젯 -->
      <SummaryCards v-else-if="widget.type === 'summary'" />

      <!-- 장치 상태 정보 위젯 -->
      <DeviceStatusCards v-else-if="widget.type === 'device-status'" />

      <!-- 관수 실행 이력 위젯 -->
      <IrrigationHistoryWidget v-else-if="widget.type === 'irrigation-history'" />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { dashboardApi } from '../api/dashboard.api'
import SummaryCards from '../components/dashboard/SummaryCards.vue'
import DeviceStatusCards from '../components/dashboard/DeviceStatusCards.vue'
import IrrigationHistoryWidget from '../components/dashboard/IrrigationHistoryWidget.vue'
import { useDashboardLayout } from '../composables/useDashboardLayout'

const { isEditMode, layout, visibleWidgets, toggleWidget, moveWidget, enterEditMode, exitEditMode, resetLayout } = useDashboardLayout()

const loading = ref(false)
const errorMessage = ref('')

const locationLabel = ref('-')
const weather = ref({
  temperature: null as number | null,
  humidity: null as number | null,
  precipitation: null as number | null,
  windSpeed: null as number | null,
  condition: 'clear',
})
const weatherIcon = computed(() => {
  if (weather.value.condition === 'rain') return '🌧️'
  return '☀️'
})

function formatValue(value: number | null, unit: string) {
  if (value === null || Number.isNaN(value)) return '-'
  return `${value}${unit}`
}

async function refreshWeather() {
  loading.value = true
  errorMessage.value = ''

  try {
    const weatherRes = await dashboardApi.getWeather()
    const data = weatherRes.data
    locationLabel.value = [data.location.level1, data.location.level2, data.location.level3]
      .filter(Boolean)
      .join(' ')
    weather.value = data.weather
  } catch (err: any) {
    errorMessage.value = err.response?.data?.message || '날씨 정보를 불러오지 못했습니다.'
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  refreshWeather()
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
  margin-bottom: 24px;
  flex-wrap: wrap;
  gap: 12px;
}

.page-header h2 {
  font-size: calc(28px * var(--content-scale, 1));
  font-weight: 700;
  color: var(--text-primary);
}

.page-description {
  color: var(--text-secondary);
  font-size: calc(14px * var(--content-scale, 1));
  margin-top: 4px;
}

.header-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-shrink: 0;
}

.btn-header-sm {
  padding: 8px 14px;
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  font-size: calc(13px * var(--content-scale, 1));
  cursor: pointer;
  white-space: nowrap;
}
.btn-header-sm:hover { background: var(--accent-bg); color: var(--accent); border-color: var(--accent); }

.btn-refresh {
  padding: 8px 16px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  font-weight: 500;
  font-size: calc(13px * var(--content-scale, 1));
  cursor: pointer;
  transition: border-color 0.2s, background 0.2s;
}
.btn-refresh:hover:not(:disabled) { border-color: var(--accent); background: var(--accent-bg); }
.btn-refresh:disabled { opacity: 0.5; cursor: not-allowed; }

.error-banner {
  margin-bottom: 16px;
  background: var(--danger-bg);
  color: var(--danger);
  border: 1px solid var(--danger);
  border-radius: 12px;
  padding: 14px 18px;
  font-size: 15px;
}

/* 편집 패널 */
.dashboard-edit-panel {
  background: var(--bg-card);
  border: 2px dashed var(--accent);
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 20px;
}
.dashboard-edit-panel h4 {
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 12px;
  color: var(--text-primary);
}
.widget-edit-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.widget-edit-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-primary);
}
.widget-checkbox {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  cursor: pointer;
  color: var(--text-primary);
}
.widget-checkbox input {
  width: 18px;
  height: 18px;
  accent-color: var(--accent);
}
.widget-order-btns {
  display: flex;
  gap: 4px;
}
.btn-order {
  width: 28px;
  height: 28px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-card);
  color: var(--text-primary);
  cursor: pointer;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.btn-order:hover { background: var(--accent-bg); }
.btn-reset {
  margin-top: 12px;
  padding: 6px 14px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: transparent;
  font-size: 13px;
  cursor: pointer;
  color: var(--text-secondary);
}
.btn-reset:hover { background: var(--bg-hover); }

/* 날씨 카드 */
.weather-card {
  background: linear-gradient(135deg, #5B9BE6 0%, #4A7FD4 50%, #3B6BC2 100%);
  border-radius: 16px;
  padding: 16px 20px;
  color: white;
  margin-bottom: 20px;
  box-shadow: 0 4px 16px rgba(74, 144, 217, 0.25);
}

.weather-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.weather-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.weather-icon-big { font-size: 28px; }

.weather-title {
  font-size: 15px;
  font-weight: 700;
  margin-bottom: 2px;
}

.weather-location {
  font-size: 13px;
  opacity: 0.85;
}

.weather-right { text-align: right; }

.weather-temp-line {
  display: flex;
  align-items: flex-start;
  justify-content: flex-end;
  gap: 2px;
}

.weather-temp-big {
  font-size: 36px;
  font-weight: 700;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

.weather-temp-unit {
  font-size: 16px;
  font-weight: 500;
  opacity: 0.85;
  margin-top: 2px;
}

.weather-condition {
  font-size: 14px;
  opacity: 0.85;
  text-align: right;
  margin-top: 2px;
}

.weather-details-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.weather-detail-item {
  background: rgba(255, 255, 255, 0.18);
  border-radius: 10px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.detail-label {
  font-size: 13px;
  opacity: 0.85;
  font-weight: 500;
}

.detail-value {
  font-size: 18px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

@media (max-width: 768px) {
  .page-container { padding: 12px; }
  .page-header { margin-bottom: 12px; }
  .weather-card { padding: 12px 14px; margin-bottom: 12px; border-radius: 12px; }
  .weather-top { margin-bottom: 8px; }
  .weather-details-grid { gap: 6px; }
  .weather-detail-item { padding: 8px 10px; gap: 2px; }
  .weather-temp-big { font-size: 32px; }
  .detail-value { font-size: 16px; }
}
</style>
