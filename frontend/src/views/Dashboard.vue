<template>
  <div class="page-container">
    <header class="page-header">
      <div>
        <h2>대시보드</h2>
        <p class="page-description">농장의 현재 상태를 한눈에 확인하세요</p>
      </div>
      <button @click="refreshWeather" class="btn-refresh" :disabled="loading">
        {{ loading ? '조회 중...' : '새로고침' }}
      </button>
    </header>

    <div v-if="errorMessage" class="error-banner">
      {{ errorMessage }}
    </div>

    <!-- 날씨 위젯 - 파란 그라데이션 -->
    <div class="weather-card">
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

    <!-- 요약 카드 -->
    <SummaryCards />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { dashboardApi } from '../api/dashboard.api'
import SummaryCards from '../components/dashboard/SummaryCards.vue'

const loading = ref(false)
const errorMessage = ref('')
const lastUpdate = ref('-')

const sourceAddress = ref('-')
const locationLabel = ref('-')
const grid = ref({ nx: '-', ny: '-' })
const source = ref({ baseDate: '-', baseTime: '-', endpoint: '-' })
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
    sourceAddress.value = data.location.address
    locationLabel.value = [data.location.level1, data.location.level2, data.location.level3]
      .filter(Boolean)
      .join(' ')

    grid.value = {
      nx: String(data.location.nx),
      ny: String(data.location.ny),
    }

    source.value = data.source
    weather.value = data.weather
    lastUpdate.value = new Date(data.fetchedAt).toLocaleString('ko-KR')

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

.btn-refresh {
  padding: 12px 24px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  font-weight: 500;
  font-size: calc(15px * var(--content-scale, 1));
  cursor: pointer;
  transition: border-color 0.2s, background 0.2s;
}
.btn-refresh:hover:not(:disabled) { border-color: var(--accent); background: var(--accent-bg); }
.btn-refresh:disabled { opacity: 0.5; cursor: not-allowed; }

.error-banner {
  margin-bottom: 16px;
  background: #ffebee;
  color: #c62828;
  border: 1px solid #ef9a9a;
  border-radius: 12px;
  padding: 14px 18px;
  font-size: 15px;
}

/* 날씨 카드 - 파란 그라데이션 */
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

.weather-icon-big {
  font-size: 28px;
}

.weather-title {
  font-size: 15px;
  font-weight: 700;
  margin-bottom: 2px;
}

.weather-location {
  font-size: 13px;
  opacity: 0.85;
}

.weather-right {
  text-align: right;
}

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
  .page-container {
    padding: 16px;
  }

  .page-header h2 {
    font-size: 24px;
  }

  .weather-card {
    padding: 14px 16px;
  }

  .weather-details-grid {
    grid-template-columns: repeat(3, 1fr);
  }

  .weather-temp-big {
    font-size: 32px;
  }

  .detail-value {
    font-size: 16px;
  }
}
</style>
