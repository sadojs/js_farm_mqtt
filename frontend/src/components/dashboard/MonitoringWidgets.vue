<template>
  <div v-if="hasData" class="monitoring-section">
    <div class="monitoring-grid">
      <!-- 1) 내부 VPD -->
      <div class="widget-card">
        <div class="widget-header">
          <span class="widget-title">내부 VPD</span>
          <span :class="['widget-badge', vpdBadgeClass]">{{ vpd?.status ?? '-' }}</span>
        </div>
        <div class="widget-body">
          <span class="widget-value">{{ vpd ? vpd.value.toFixed(2) : '-' }}</span>
          <span class="widget-unit">kPa</span>
        </div>
        <div class="widget-hint">{{ vpdRangeHint }}</div>
        <div class="widget-advice" v-if="vpd">
          <template v-if="vpd.status === 'LOW'">습도 과다로 곰팡이병(잿빛곰팡이 등) 위험. 환기로 습도를 낮추세요.</template>
          <template v-else-if="vpd.status === 'OK'">방울토마토에 적정 범위입니다.</template>
          <template v-else>건조하여 수분 스트레스 위험. 관수량을 늘리거나 미스트를 가동하세요.</template>
        </div>
        <svg v-if="tempTrendPath" class="widget-sparkline" viewBox="0 0 120 32">
          <path :d="tempTrendPath" fill="none" stroke="var(--accent)" stroke-width="1.5" />
        </svg>
      </div>

      <!-- 2) 환기 필요도 -->
      <div class="widget-card">
        <div class="widget-header">
          <span class="widget-title">환기 필요도</span>
          <span :class="['widget-badge', ventBadgeClass]">{{ vent?.status ?? '-' }}</span>
        </div>
        <div class="widget-body">
          <span class="widget-value">{{ vent ? vent.score.toFixed(1) : '-' }}</span>
          <span class="widget-unit">pt</span>
        </div>
        <div v-if="vent" class="widget-hint">
          ΔT {{ vent.dT > 0 ? '+' : '' }}{{ vent.dT }}°C &nbsp; ΔRH {{ vent.dRH > 0 ? '+' : '' }}{{ vent.dRH }}%
        </div>
        <div v-else class="widget-hint">내외부 온습도 차이 기반</div>
        <div class="widget-advice" v-if="vent">
          <template v-if="vent.status === 'Normal'">환기가 충분합니다. 현재 상태를 유지하세요.</template>
          <template v-else-if="vent.status === 'Recommended'">환기를 권장합니다. 측창을 열어보세요.</template>
          <template v-else>긴급 환기 필요. 모든 환기구를 열어주세요.</template>
        </div>
      </div>

      <!-- 3) 온도 변화 -->
      <div class="widget-card">
        <div class="widget-header">
          <span class="widget-title">온도 변화</span>
          <span :class="['widget-badge', tempRateBadgeClass]">{{ tempRate?.status ?? '-' }}</span>
        </div>
        <div class="widget-body">
          <span class="widget-value">{{ tempRate ? (tempRate.delta > 0 ? '+' : '') + tempRate.delta.toFixed(1) : '-' }}</span>
          <span class="widget-unit">°C/10m</span>
        </div>
        <div class="widget-hint">10분간 온도 변화량</div>
        <div class="widget-advice" v-if="tempRate">
          <template v-if="tempRate.statusKey === 'rapid-rise'">온도 급상승 중. 차광이나 환기를 검토하세요.</template>
          <template v-else-if="tempRate.statusKey === 'rise'">온도 상승 추세. 모니터링을 계속하세요.</template>
          <template v-else-if="tempRate.statusKey === 'rapid-drop'">온도 급하강 주의. 보온 조치를 취하세요.</template>
          <template v-else-if="tempRate.statusKey === 'drop'">온도 하강 중. 보온을 검토하세요.</template>
          <template v-else>온도가 안정적입니다.</template>
        </div>
        <svg v-if="tempTrendPath" class="widget-sparkline" viewBox="0 0 120 32">
          <path :d="tempTrendPath" fill="none" stroke="var(--accent)" stroke-width="1.5" />
        </svg>
      </div>

      <!-- 4) 습도 변화 -->
      <div class="widget-card">
        <div class="widget-header">
          <span class="widget-title">습도 변화</span>
          <span :class="['widget-badge', rhRateBadgeClass]">{{ rhRate?.status ?? '-' }}</span>
        </div>
        <div class="widget-body">
          <span class="widget-value">{{ rhRate ? (rhRate.delta > 0 ? '+' : '') + rhRate.delta.toFixed(1) : '-' }}</span>
          <span class="widget-unit">%/10m</span>
        </div>
        <div class="widget-hint">10분간 습도 변화량</div>
        <div class="widget-advice" v-if="rhRate">
          <template v-if="rhRate.statusKey === 'rapid-wet'">습도 급상승. 환기를 검토하세요.</template>
          <template v-else-if="rhRate.statusKey === 'wet'">습도 상승 추세. 모니터링하세요.</template>
          <template v-else-if="rhRate.statusKey === 'rapid-drying'">습도 급하강. 관수 조치를 취하세요.</template>
          <template v-else-if="rhRate.statusKey === 'drying'">습도 하강 중. 관수를 검토하세요.</template>
          <template v-else>습도가 안정적입니다.</template>
        </div>
        <svg v-if="rhTrendPath" class="widget-sparkline" viewBox="0 0 120 32">
          <path :d="rhTrendPath" fill="none" stroke="var(--sensor-accent, #2196F3)" stroke-width="1.5" />
        </svg>
      </div>

      <!-- 5) 내외부 비교 -->
      <div class="widget-card">
        <div class="widget-header">
          <span class="widget-title">내외부 비교</span>
        </div>
        <div v-if="vent" class="gauge-container">
          <div class="gauge-row">
            <span class="gauge-label">ΔT</span>
            <div class="gauge-bar">
              <div class="gauge-center-line"></div>
              <div
                class="gauge-fill"
                :class="vent.dT >= 0 ? 'positive' : 'negative'"
                :style="gaugeFillStyle(vent.dT, -10, 10)"
              ></div>
            </div>
            <span class="gauge-value">{{ vent.dT > 0 ? '+' : '' }}{{ vent.dT }}°C</span>
          </div>
          <div class="gauge-row">
            <span class="gauge-label">ΔRH</span>
            <div class="gauge-bar">
              <div class="gauge-center-line"></div>
              <div
                class="gauge-fill"
                :class="vent.dRH >= 0 ? 'positive' : 'negative'"
                :style="gaugeFillStyle(vent.dRH, -40, 40)"
              ></div>
            </div>
            <span class="gauge-value">{{ vent.dRH > 0 ? '+' : '' }}{{ vent.dRH }}%</span>
          </div>
        </div>
        <div v-else class="widget-body"><span class="widget-value">-</span></div>
        <div class="widget-advice" v-if="vent">
          <template v-if="vent.dT > 5 && vent.dRH > 15">내부가 고온다습합니다. 적극적인 환기가 필요합니다.</template>
          <template v-else-if="vent.dT > 5">내부가 외부보다 많이 덥습니다. 환기로 온도를 낮추세요.</template>
          <template v-else-if="vent.dRH > 15">내부 습도가 외부 대비 높습니다. 환기 필요도를 함께 확인하세요.</template>
          <template v-else-if="vent.dT < -3">내부가 외부보다 춥습니다. 보온을 확인하세요.</template>
          <template v-else>내외부 차이가 적정 범위입니다.</template>
        </div>
        <div v-else class="widget-hint">내부 - 외부 비교 (날씨 데이터 필요)</div>
      </div>

      <!-- 6) UV 위험도 -->
      <div class="widget-card">
        <div class="widget-header">
          <span class="widget-title">UV 위험도</span>
          <span :class="['widget-badge', uvBadgeClass]">{{ uvRisk?.label ?? '-' }}</span>
        </div>
        <div class="widget-body">
          <span class="widget-value">{{ uvRisk ? uvRisk.value : '-' }}</span>
          <span class="widget-unit">idx</span>
        </div>
        <div class="widget-hint">자외선 지수 카테고리</div>
        <div class="widget-advice" v-if="uvRisk">
          <template v-if="uvRisk.category === 'low'">자외선 안전 수준입니다.</template>
          <template v-else-if="uvRisk.category === 'moderate'">자외선 보통. 차광 없이 괜찮습니다.</template>
          <template v-else-if="uvRisk.category === 'high'">자외선 높음. 차광막을 검토하세요.</template>
          <template v-else-if="uvRisk.category === 'very-high'">자외선 매우 높음. 차광이 필요합니다.</template>
          <template v-else>위험 수준. 작물 보호 조치를 취하세요.</template>
        </div>
        <svg v-if="uvTrendPath" class="widget-sparkline" viewBox="0 0 120 32">
          <path :d="uvTrendPath" fill="none" stroke="var(--automation-text, #FF9800)" stroke-width="1.5" />
        </svg>
      </div>

      <!-- 7) 환경 점수 + 종합 권고 (전체 너비) -->
      <div class="widget-card full-width env-score-card">
        <div class="env-score-layout">
          <div class="env-score-left">
            <div class="widget-header">
              <span class="widget-title">방울토마토 환경 종합</span>
            </div>
            <div class="widget-hint" style="margin-top: 8px;">
              VPD(30%) + 온도(25%) + 습도(20%) + 결로(15%) + UV(10%)
            </div>
          </div>
          <div v-if="envScore" :class="['score-circle', envScore.color]">
            <span class="score-value">{{ envScore.score }}</span>
          </div>
          <div v-else class="score-circle gray">
            <span class="score-value">-</span>
          </div>
        </div>
        <div v-if="envRecommendations.length" class="env-recommendations">
          <div
            v-for="(rec, i) in envRecommendations"
            :key="i"
            :class="['rec-item', rec.level]"
          >
            <span class="rec-icon">{{ rec.level === 'good' ? '✓' : rec.level === 'warn' ? '!' : '▲' }}</span>
            <span>{{ rec.text }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { WidgetDataResponse } from '../../api/dashboard.api'
import {
  calcVPD,
  calcVentScore,
  calcTempRate,
  calcRhRate,
  calcUVRisk,
  calcUVNorm,
  calcEnvScore,
  calcCondensationRisk,
  getDayNightParams,
  sparklinePath,
  gaugePercent,
} from '../../utils/widget-calculations'

const props = defineProps<{
  widgetData: WidgetDataResponse | null
  weatherData: { temperature: number | null; humidity: number | null } | null
  loading: boolean
}>()

const hasData = computed(() => props.widgetData?.inside != null)

// === 현재 생육 단계 ===
const currentStage = computed(() => (props.widgetData as any)?.currentStage || null)

// === 주/야간 파라미터 ===
const dayNight = computed(() => getDayNightParams())

// === VPD (단계별 구간) ===
const vpd = computed(() => {
  const d = props.widgetData?.inside
  if (!d || d.temperature == null || d.humidity == null) return null
  return calcVPD(d.temperature, d.humidity, currentStage.value ?? undefined)
})

const vpdRangeHint = computed(() => {
  const stageLabels: Record<string, string> = {
    vegetative: '초기생장 적정 0.6~1.0 kPa',
    flowering_fruit: '개화~착과 적정 0.8~1.2 kPa',
    harvest: '수확기 적정 1.0~1.6 kPa',
  }
  return stageLabels[currentStage.value ?? ''] || '방울토마토 적정 0.8~1.2 kPa'
})

const vpdBadgeClass = computed(() => {
  if (!vpd.value) return ''
  const map: Record<string, string> = { LOW: 'low', OK: 'ok', HIGH: 'high' }
  return map[vpd.value.status] ?? ''
})

// === 환기 스코어 (VPD 교차검증) ===
const vent = computed(() => {
  const d = props.widgetData?.inside
  const w = props.weatherData
  if (!d || d.temperature == null || d.humidity == null) return null
  if (!w || w.temperature == null || w.humidity == null) return null
  return calcVentScore(d.temperature, w.temperature, d.humidity, w.humidity, vpd.value?.status)
})

const ventBadgeClass = computed(() => {
  if (!vent.value) return ''
  const map: Record<string, string> = { Normal: 'normal', Recommended: 'recommended', Urgent: 'urgent' }
  return map[vent.value.status] ?? ''
})

// === 온도 변화율 ===
const tempRate = computed(() => {
  const d = props.widgetData?.inside
  const h = props.widgetData?.history
  if (!d || d.temperature == null || !h || h.temperature == null) return null
  return calcTempRate(d.temperature, h.temperature)
})

const tempRateBadgeClass = computed(() => {
  if (!tempRate.value) return ''
  const k = tempRate.value.statusKey
  if (k.includes('rapid')) return 'rapid'
  return 'stable'
})

// === 습도 변화율 ===
const rhRate = computed(() => {
  const d = props.widgetData?.inside
  const h = props.widgetData?.history
  if (!d || d.humidity == null || !h || h.humidity == null) return null
  return calcRhRate(d.humidity, h.humidity)
})

const rhRateBadgeClass = computed(() => {
  if (!rhRate.value) return ''
  const k = rhRate.value.statusKey
  if (k !== 'stable') return 'rapid'
  return 'stable'
})

// === UV 위험도 ===
const uvRisk = computed(() => {
  const d = props.widgetData?.inside
  if (!d || d.uv == null) return null
  return calcUVRisk(d.uv)
})

const uvBadgeClass = computed(() => {
  if (!uvRisk.value) return ''
  const map: Record<string, string> = { low: 'ok', moderate: 'low', high: 'recommended', 'very-high': 'urgent', extreme: 'high' }
  return map[uvRisk.value.category] ?? ''
})

// === 결로위험 4단계 ===
const condensation = computed(() => {
  const d = props.widgetData?.inside
  if (!d || d.temperature == null || d.dewPoint == null) return null
  return calcCondensationRisk(d.temperature, d.dewPoint)
})

// === 환경 점수 ===
const envScore = computed(() => {
  const d = props.widgetData?.inside
  if (!d || d.temperature == null || d.humidity == null) return null
  const v = vpd.value
  if (!v) return null

  let uvNorm: number | null = null
  if (d.uv != null && props.widgetData?.uvStats14d) {
    uvNorm = calcUVNorm(d.uv, props.widgetData.uvStats14d)
  }

  return calcEnvScore({
    vpd: v.value,
    vpdOptimal: v.optimal,
    insideTemp: d.temperature,
    insideHumidity: d.humidity,
    insideDewpoint: d.dewPoint,
    uvNorm,
  })
})

// === 종합 권고사항 (방울토마토 기준, 교차 분석) ===
const envRecommendations = computed(() => {
  const recs: { text: string; level: 'good' | 'warn' | 'danger'; priority: number }[] = []
  const d = props.widgetData?.inside
  const w = props.weatherData
  if (!d) return recs

  const T = d.temperature
  const RH = d.humidity
  const vpdVal = vpd.value
  const outT = w?.temperature
  const isOutdoorCold = outT != null && T != null && outT < T - 5

  // ── 1. 환기 판단 (VPD + 습도 + 내외부 온도 교차 분석) ──
  if (vpdVal && T != null && RH != null) {
    if (vpdVal.status === 'LOW' && RH > 85) {
      // 과습 긴급
      recs.push({
        text: `과습 상태(VPD ${vpdVal.value}, 습도 ${RH}%). 환기창 50% 이상 오픈 + 관수 중단을 권장합니다.`,
        level: 'danger', priority: 1,
      })
    } else if (vpdVal.status === 'LOW' && isOutdoorCold) {
      // 습도 높지만 외부가 추움 → 대량 환기 불가
      recs.push({
        text: `습도 과다(VPD ${vpdVal.value})이나 외부가 ${outT}°C로 낮습니다. 환기창 10~20% 소량 오픈 + 순환팬 가동을 권장합니다.`,
        level: 'warn', priority: 2,
      })
    } else if (vpdVal.status === 'LOW') {
      // 습도 높고 외부 온도 적당
      const ventPct = RH > 75 ? '30~50%' : '20~30%'
      recs.push({
        text: `습도 과다(VPD ${vpdVal.value}, 습도 ${RH}%). 환기창 ${ventPct} 오픈을 권장합니다.`,
        level: 'danger', priority: 1,
      })
    } else if (vpdVal.status === 'HIGH') {
      recs.push({
        text: `건조 상태(VPD ${vpdVal.value}). 미스트 가동 또는 관수량 증가를 권장합니다.`,
        level: 'danger', priority: 1,
      })
    }
  }

  // ── 2. 관수 판단 (습도 + VPD 교차) ──
  if (RH != null && vpdVal) {
    if (vpdVal.status === 'LOW' || RH > 75) {
      recs.push({
        text: '과습 경향으로 관수는 보류를 권장합니다.',
        level: 'warn', priority: 3,
      })
    } else if (vpdVal.status === 'HIGH' && RH < 55) {
      recs.push({
        text: `건조 상태(습도 ${RH}%). 관수를 실시하세요.`,
        level: 'warn', priority: 3,
      })
    }
  }

  // ── 3. 온도 관리 (주/야간 목표 분리) ──
  const dn = dayNight.value
  const tempLabel = dn.isDay ? `주간 적정(${dn.tempOptLow}~${dn.tempOptHigh}°C)` : `야간 적정(${dn.tempOptLow}~${dn.tempOptHigh}°C)`
  if (T != null) {
    if (T > dn.tempCeil) {
      recs.push({
        text: `고온 ${T}°C — 환기창 전개 + 차광막 설치가 시급합니다.`,
        level: 'danger', priority: 2,
      })
    } else if (T > dn.tempOptHigh && RH != null && RH > 70) {
      recs.push({
        text: `고온다습(${T}°C, ${RH}%). 환기만 실시하세요. 미스트는 습도를 더 높이므로 보류합니다.`,
        level: 'warn', priority: 4,
      })
    } else if (T > dn.tempOptHigh && RH != null && RH < 60) {
      recs.push({
        text: `고온건조(${T}°C, ${RH}%). 환기 + 미스트 동시 가동을 권장합니다.`,
        level: 'warn', priority: 4,
      })
    } else if (T > dn.tempOptHigh) {
      recs.push({
        text: `온도 ${T}°C — ${tempLabel} 초과. 환기를 검토하세요.`,
        level: 'warn', priority: 4,
      })
    } else if (T < dn.tempFloor) {
      recs.push({
        text: `저온 ${T}°C — 생육 저해 위험. 보온 커튼 + 난방을 가동하세요.`,
        level: 'danger', priority: 2,
      })
    } else if (T < dn.tempOptLow) {
      recs.push({
        text: `온도 ${T}°C — ${tempLabel} 미만. 보온을 검토하세요.`,
        level: 'warn', priority: 5,
      })
    }
  }

  // ── 4. 결로위험 ──
  if (condensation.value) {
    const c = condensation.value
    if (c.level === 'critical') {
      recs.push({
        text: `결로 매우 위험(이슬점 여유 ${c.margin}°C). 순환팬 + 소량 환기를 즉시 실시하세요.`,
        level: 'danger', priority: 2,
      })
    } else if (c.level === 'danger') {
      recs.push({
        text: `결로 위험(이슬점 여유 ${c.margin}°C). 환기로 습도를 낮추세요.`,
        level: 'warn', priority: 3,
      })
    } else if (c.level === 'warning') {
      recs.push({
        text: `결로 주의(이슬점 여유 ${c.margin}°C). 야간 습도 관리에 유의하세요.`,
        level: 'warn', priority: 5,
      })
    }
  }

  // ── 5. UV 관리 ──
  if (uvRisk.value) {
    const cat = uvRisk.value.category
    if (cat === 'very-high' || cat === 'extreme') {
      recs.push({
        text: `자외선 ${uvRisk.value.label}(${uvRisk.value.value}). 차광막을 설치하세요. 과일 일소 위험.`,
        level: 'danger', priority: 6,
      })
    } else if (cat === 'high') {
      recs.push({
        text: `자외선 높음(${uvRisk.value.value}). 장시간 지속 시 차광을 검토하세요.`,
        level: 'warn', priority: 7,
      })
    }
  }

  // ── 양호 ──
  if (recs.length === 0) {
    recs.push({
      text: '방울토마토 재배에 양호한 환경입니다. 현재 관리를 유지하세요.',
      level: 'good', priority: 99,
    })
  }

  return recs.sort((a, b) => a.priority - b.priority)
})

// === Sparklines ===
const tempTrendPath = computed(() => {
  const data = props.widgetData?.trend6h?.temperature
  return data && data.length >= 2 ? sparklinePath(data) : ''
})

const rhTrendPath = computed(() => {
  const data = props.widgetData?.trend6h?.humidity
  return data && data.length >= 2 ? sparklinePath(data) : ''
})

const uvTrendPath = computed(() => {
  const data = props.widgetData?.trend6h?.uv
  return data && data.length >= 2 ? sparklinePath(data) : ''
})

// === 게이지 바 스타일 ===
function gaugeFillStyle(value: number, min: number, max: number) {
  const center = 50 // 중앙 %
  const pct = gaugePercent(value, min, max)
  if (value >= 0) {
    return { left: center + '%', width: (pct - center) + '%' }
  } else {
    return { left: pct + '%', width: (center - pct) + '%' }
  }
}
</script>

<style scoped>
.monitoring-section {
  /* 그룹 카드 내부에서 사용되므로 외부 여백 없음 */
}

.monitoring-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
}

.widget-card {
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: 14px;
  padding: 16px 18px;
  box-shadow: var(--shadow-card);
  display: flex;
  flex-direction: column;
}

.widget-card.full-width {
  grid-column: 1 / -1;
}

.widget-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.widget-title {
  font-size: calc(13px * var(--content-scale, 1));
  font-weight: 600;
  color: var(--text-secondary);
}

.widget-badge {
  padding: 2px 10px;
  border-radius: 12px;
  font-size: calc(11px * var(--content-scale, 1));
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}
.widget-badge.ok,
.widget-badge.normal,
.widget-badge.stable { background: var(--accent-bg); color: var(--accent); }
.widget-badge.low,
.widget-badge.recommended { background: var(--bg-info-banner, rgba(33,150,243,0.1)); color: var(--text-info-banner, #1976D2); }
.widget-badge.high,
.widget-badge.urgent,
.widget-badge.rapid { background: rgba(244,67,54,0.1); color: #F44336; }

.widget-body {
  display: flex;
  align-items: baseline;
  gap: 4px;
  margin-bottom: 6px;
}

.widget-value {
  font-size: calc(28px * var(--content-scale, 1));
  font-weight: 700;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}

.widget-unit {
  font-size: calc(14px * var(--content-scale, 1));
  color: var(--text-muted);
}

.widget-hint {
  font-size: calc(11px * var(--content-scale, 1));
  color: var(--text-muted);
  line-height: 1.4;
}

.widget-advice {
  font-size: calc(12px * var(--content-scale, 1));
  color: var(--text-secondary);
  background: var(--bg-hover, rgba(0,0,0,0.03));
  border-radius: 8px;
  padding: 8px 10px;
  margin-top: 8px;
  line-height: 1.5;
}

/* Sparkline */
.widget-sparkline {
  width: 100%;
  height: 32px;
  margin-top: 8px;
  opacity: 0.7;
}

/* 게이지 */
.gauge-container {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 8px;
}

.gauge-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.gauge-label {
  font-size: calc(12px * var(--content-scale, 1));
  font-weight: 600;
  color: var(--text-secondary);
  width: 32px;
  flex-shrink: 0;
}

.gauge-bar {
  flex: 1;
  height: 14px;
  background: var(--bg-secondary, #f0f0f0);
  border-radius: 7px;
  position: relative;
  overflow: hidden;
}

.gauge-center-line {
  position: absolute;
  left: 50%;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--border-color, #ccc);
  transform: translateX(-1px);
  z-index: 1;
}

.gauge-fill {
  position: absolute;
  top: 2px;
  bottom: 2px;
  border-radius: 5px;
  transition: width 0.3s, left 0.3s;
}

.gauge-fill.positive {
  background: var(--accent, #4CAF50);
}

.gauge-fill.negative {
  background: var(--text-info-banner, #2196F3);
}

.gauge-value {
  font-size: calc(13px * var(--content-scale, 1));
  font-weight: 700;
  color: var(--text-primary);
  width: 56px;
  text-align: right;
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}

/* 환경 점수 */
.env-score-card {
  padding: 18px 24px;
}

.env-score-layout {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.env-score-left {
  flex: 1;
}

.env-recommendations {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border-light, #e8e8e8);
}

.rec-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: calc(13px * var(--content-scale, 1));
  line-height: 1.5;
  padding: 6px 10px;
  border-radius: 8px;
}

.rec-icon {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 700;
  margin-top: 2px;
}

.rec-item.good { background: var(--accent-bg, rgba(76,175,80,0.1)); color: var(--accent, #2e7d32); }
.rec-item.good .rec-icon { background: var(--accent, #4CAF50); color: white; }

.rec-item.warn { background: rgba(255,193,7,0.1); color: #F57F17; }
.rec-item.warn .rec-icon { background: #FFC107; color: white; }

.rec-item.danger { background: rgba(244,67,54,0.08); color: #C62828; }
.rec-item.danger .rec-icon { background: #F44336; color: white; }

.score-circle {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.score-circle.green {
  background: rgba(76, 175, 80, 0.12);
  border: 3px solid #4CAF50;
}

.score-circle.yellow {
  background: rgba(255, 193, 7, 0.12);
  border: 3px solid #FFC107;
}

.score-circle.red {
  background: rgba(244, 67, 54, 0.12);
  border: 3px solid #F44336;
}

.score-circle.gray {
  background: var(--bg-secondary);
  border: 3px solid var(--border-color);
}

.score-value {
  font-size: calc(24px * var(--content-scale, 1));
  font-weight: 700;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}

/* 반응형 */
@media (max-width: 1024px) {
  .monitoring-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 768px) {
  .monitoring-grid {
    grid-template-columns: 1fr;
  }

  .widget-value {
    font-size: calc(24px * var(--content-scale, 1));
  }

  .score-circle {
    width: 60px;
    height: 60px;
  }

  .score-value {
    font-size: calc(20px * var(--content-scale, 1));
  }
}
</style>
