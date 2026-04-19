<template>
  <div class="harvest-tab">
    <div v-for="batch in batches" :key="batch.id" class="harvest-card">
      <h4 class="harvest-title">
        {{ CROP_LABELS[batch.cropType] ?? batch.cropType }}
        <span class="sowing-info">파종일: {{ batch.sowingDate }}</span>
      </h4>

      <div v-if="loading[batch.id]" class="loading">계산 중...</div>
      <div v-else-if="predictions[batch.id]" class="prediction-body">
        <!-- ── GDD 현황 요약 ── -->
        <div class="gdd-summary">
          <div class="gdd-row">
            <span class="gdd-label">현재 적산온도</span>
            <span class="gdd-value">{{ predictions[batch.id].currentGdd.toFixed(1) }}°C</span>
          </div>
          <div class="gdd-row">
            <span class="gdd-label">수확 목표</span>
            <span class="gdd-value">{{ predictions[batch.id].targetGdd }}°C</span>
          </div>
          <div class="gdd-row highlight">
            <span class="gdd-label">잔여</span>
            <span class="gdd-value">{{ predictions[batch.id].remainingGdd.toFixed(1) }}°C</span>
          </div>
        </div>

        <div class="divider" />

        <!-- ── 신뢰도 배지 ── -->
        <div class="confidence-row">
          <span class="confidence-badge" :class="predictions[batch.id].confidence">
            {{ confidenceLabel(predictions[batch.id].confidence) }}
          </span>
          <span class="days-elapsed">{{ predictions[batch.id].daysElapsed }}일 누적 데이터</span>
          <span class="method-badge">{{ methodLabel(predictions[batch.id].predictionMethod) }}</span>
        </div>

        <!-- ── 이중 예측 카드 ── -->
        <div class="dual-prediction">
          <!-- 현재 속도 기반 -->
          <div class="prediction-card rate-card">
            <div class="card-label">
              <span class="card-icon">📊</span>
              <span>현재 속도 기반</span>
            </div>
            <div class="card-main-date">{{ formatDate(predictions[batch.id].estimatedDate) }}</div>
            <div class="card-sub">약 {{ predictions[batch.id].estimatedDaysLeft }}일 후</div>
            <div class="card-daily">+{{ predictions[batch.id].dailyAvgGdd }}°C/일</div>
            <!-- 낙관/보수 범위 -->
            <div class="scenario-range">
              <span class="range-opt">{{ formatDate(predictions[batch.id].optimisticDate) }}</span>
              <span class="range-sep">~</span>
              <span class="range-pes">{{ formatDate(predictions[batch.id].pessimisticDate) }}</span>
            </div>
          </div>

          <!-- 계절 패턴 기반 -->
          <div class="prediction-card seasonal-card">
            <div class="card-label">
              <span class="card-icon">🌦️</span>
              <span>계절 패턴 기반</span>
            </div>
            <div class="card-main-date">{{ formatDate(predictions[batch.id].seasonal.estimatedDate) }}</div>
            <div class="card-sub">약 {{ predictions[batch.id].seasonal.estimatedDaysLeft }}일 후</div>
            <div class="card-source">{{ sourceLabel(predictions[batch.id].seasonal.source, predictions[batch.id].seasonal.dataYears) }}</div>
          </div>
        </div>

        <!-- ── 월별 예상 GDD 바 차트 ── -->
        <div class="monthly-forecast">
          <div class="forecast-title">월별 예상 GDD 누적 속도</div>
          <div class="forecast-bars">
            <div
              v-for="mf in predictions[batch.id].seasonal.monthlyForecast"
              :key="mf.month"
              class="forecast-bar-item"
            >
              <div class="bar-wrap">
                <div
                  class="bar-fill"
                  :class="mf.role"
                  :style="{ height: barHeight(mf.expectedDailyGdd, predictions[batch.id].seasonal.monthlyForecast) + '%' }"
                />
              </div>
              <div class="bar-val">{{ mf.expectedDailyGdd.toFixed(1) }}</div>
              <div class="bar-label">{{ shortMonth(mf.month) }}</div>
            </div>
          </div>
          <div class="forecast-legend">
            <span class="legend-dot actual" />실측 기준
            <span class="legend-dot forecast" style="margin-left:12px" />예측
          </div>
        </div>

        <p class="prediction-note">
          ※ 계절 패턴은 {{ sourceNote(predictions[batch.id].seasonal.source) }} 기반입니다.
          실내 데이터가 쌓일수록 예측 정확도가 자동으로 향상됩니다.
        </p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { cropManagementApi } from '../api/crop-management.api'
import { CROP_LABELS } from '../types/crop-management.types'
import type { CropBatch, HarvestPrediction } from '../types/crop-management.types'

const props = defineProps<{ batches: CropBatch[] }>()

const loading = ref<Record<string, boolean>>({})
const predictions = ref<Record<string, HarvestPrediction>>({})

onMounted(async () => {
  for (const batch of props.batches) {
    loading.value[batch.id] = true
    try {
      predictions.value[batch.id] = await cropManagementApi.getHarvestPrediction(batch.id)
    } finally {
      loading.value[batch.id] = false
    }
  }
})

function formatDate(dateStr: string) {
  const d = new Date(dateStr)
  return `${d.getMonth() + 1}월 ${d.getDate()}일`
}

function shortMonth(ym: string) {
  // "2026-04" → "4월"
  return `${parseInt(ym.split('-')[1], 10)}월`
}

function barHeight(val: number, all: Array<{ expectedDailyGdd: number }>) {
  const max = Math.max(...all.map(m => m.expectedDailyGdd), 0.1)
  return Math.round((val / max) * 100)
}

function confidenceLabel(c: string) {
  return c === 'high' ? '높음 ●●●' : c === 'medium' ? '보통 ●●○' : '낮음 ●○○'
}

function methodLabel(m: string) {
  return m === 'rate_only' ? '속도 전용' : m === 'seasonal_only' ? '계절 패턴' : '혼합 예측'
}

function sourceLabel(source: string, years: number) {
  if (source === 'kma_asos') return `기상청 ASOS ${years}년 데이터`
  if (source === 'weather_data') return '축적 날씨 데이터'
  return '한국 기후 평년값'
}

function sourceNote(source: string) {
  if (source === 'kma_asos') return '기상청 ASOS 과거 기온 데이터'
  if (source === 'weather_data') return '농장 축적 날씨 데이터'
  return '한국 중부 기후 평년값'
}
</script>

<style scoped>
.harvest-tab {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.harvest-card {
  background: var(--card-bg, #fff);
  border-radius: 12px;
  padding: 16px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.harvest-title {
  font-size: 15px;
  font-weight: 600;
  margin: 0 0 14px;
  color: var(--text-primary, #222);
}

.sowing-info {
  font-size: 12px;
  font-weight: 400;
  color: var(--text-secondary, #888);
  margin-left: 8px;
}

.loading {
  color: var(--text-secondary, #888);
  font-size: 13px;
}

/* ── GDD 요약 ── */
.gdd-summary {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}

.gdd-row {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
}

.gdd-row.highlight {
  font-weight: 600;
  color: var(--primary-color, #4caf50);
}

.gdd-label {
  color: var(--text-secondary, #666);
}

.divider {
  height: 1px;
  background: var(--border-color, #eee);
  margin: 12px 0;
}

/* ── 신뢰도 행 ── */
.confidence-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}

.confidence-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 3px 8px;
  border-radius: 10px;
}

.confidence-badge.high   { background: #e8f5e9; color: #2e7d32; }
.confidence-badge.medium { background: #fff3e0; color: #e65100; }
.confidence-badge.low    { background: #f3e5f5; color: #6a1b9a; }

.days-elapsed {
  font-size: 11px;
  color: var(--text-secondary, #888);
}

.method-badge {
  font-size: 11px;
  color: var(--text-secondary, #aaa);
  margin-left: auto;
}

/* ── 이중 예측 카드 ── */
.dual-prediction {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-bottom: 16px;
}

.prediction-card {
  border-radius: 10px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.rate-card {
  background: #e8f5e9;
  border: 1px solid #a5d6a7;
}

.seasonal-card {
  background: #e3f2fd;
  border: 1px solid #90caf9;
}

.card-label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary, #666);
  margin-bottom: 4px;
}

.card-icon { font-size: 14px; }

.card-main-date {
  font-size: 17px;
  font-weight: 700;
  color: var(--text-primary, #222);
}

.card-sub {
  font-size: 12px;
  color: var(--text-secondary, #666);
}

.card-daily {
  font-size: 11px;
  color: #2e7d32;
  font-weight: 500;
}

.card-source {
  font-size: 11px;
  color: #1565c0;
  font-weight: 500;
}

.scenario-range {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  margin-top: 2px;
}

.range-opt  { color: #2e7d32; }
.range-pes  { color: #e65100; }
.range-sep  { color: var(--text-muted, #bbb); }

/* ── 월별 바 차트 ── */
.monthly-forecast {
  margin-bottom: 12px;
}

.forecast-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary, #888);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 8px;
}

.forecast-bars {
  display: flex;
  align-items: flex-end;
  gap: 6px;
  height: 64px;
}

.forecast-bar-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex: 1;
  gap: 2px;
}

.bar-wrap {
  width: 100%;
  height: 44px;
  display: flex;
  align-items: flex-end;
}

.bar-fill {
  width: 100%;
  border-radius: 3px 3px 0 0;
  min-height: 2px;
  transition: height 0.3s;
}

.bar-fill.actual   { background: #4caf50; }
.bar-fill.forecast { background: #90caf9; }

.bar-val {
  font-size: 9px;
  color: var(--text-secondary, #aaa);
  line-height: 1;
}

.bar-label {
  font-size: 10px;
  color: var(--text-secondary, #888);
  white-space: nowrap;
}

.forecast-legend {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  color: var(--text-secondary, #999);
  margin-top: 6px;
}

.legend-dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 2px;
}
.legend-dot.actual   { background: #4caf50; }
.legend-dot.forecast { background: #90caf9; }

.prediction-note {
  font-size: 11px;
  color: var(--text-secondary, #aaa);
  margin: 0;
  text-align: center;
  line-height: 1.5;
}
</style>
