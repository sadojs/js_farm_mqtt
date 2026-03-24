<template>
  <div class="group-env-score">
    <div class="env-score-header">
      <span class="env-score-title">종합 환경 평가</span>
      <div v-if="envScore" :class="['score-badge', envScore.color]">
        {{ envScore.score }}점
      </div>
      <div v-else class="score-badge gray">-</div>
    </div>

    <template v-if="hasData">
      <!-- 핵심 지표 -->
      <div class="env-metrics">
        <div class="metric-item">
          <span class="metric-label">🌿 VPD</span>
          <span class="metric-value">
            {{ vpd ? vpd.value.toFixed(2) : '-' }}
            <span class="metric-unit">kPa</span>
          </span>
          <span v-if="vpd" :class="['vpd-badge', vpd.status.toLowerCase()]">{{ vpd.status }}</span>
        </div>
        <div v-if="condensation" class="metric-item">
          <span class="metric-label">💦 결로위험</span>
          <span class="metric-value">
            {{ condensation.margin }}
            <span class="metric-unit">°C여유</span>
          </span>
          <span :class="['vpd-badge', condensationBadgeClass]">{{ condensation.label }}</span>
        </div>
        <div v-if="vent" class="metric-item">
          <span class="metric-label">🌬 환기필요도</span>
          <span class="metric-value">
            {{ vent.score.toFixed(1) }}
            <span class="metric-unit">pt</span>
          </span>
          <span :class="['vpd-badge', ventBadgeClass]">{{ vent.status === 'Normal' ? '양호' : vent.status === 'Recommended' ? '권장' : '긴급' }}</span>
        </div>
      </div>

      <!-- 종합 권고 -->
      <div v-if="recommendations.length" class="env-recs">
        <div
          v-for="(rec, i) in recommendations"
          :key="i"
          :class="['rec-item', rec.level]"
        >
          <span class="rec-icon">{{ rec.level === 'good' ? '✓' : rec.level === 'warn' ? '!' : '▲' }}</span>
          <span>{{ rec.text }}</span>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { ResolvedValue } from '../../api/env-config.api'
import {
  calcVPD,
  calcEnvScore,
  calcCondensationRisk,
  calcSatVaporPressure,
  getDayNightParams,
  calcVentScore,
} from '../../utils/widget-calculations'

const props = defineProps<{
  resolvedData: Record<string, ResolvedValue>
}>()

// 센서값 추출 (DB에서 문자열로 올 수 있으므로 Number 변환)
function toNum(key: string): number | null {
  const v = props.resolvedData?.[key]?.value
  if (v == null) return null
  const n = Number(v)
  return isNaN(n) ? null : n
}

const temp = computed(() => toNum('internal_temp'))
const humidity = computed(() => toNum('internal_humidity'))
const outTemp = computed(() => toNum('external_temp'))
const outHumidity = computed(() => toNum('external_humidity'))

const hasData = computed(() => temp.value != null && humidity.value != null)

// 이슬점 계산
const dewPoint = computed(() => {
  const t = temp.value
  const rh = humidity.value
  if (t == null || rh == null || rh <= 0) return null
  const es = calcSatVaporPressure(t)
  const ea = es * rh / 100
  if (ea <= 0) return null
  const ln_ea = Math.log(ea / 0.6108)
  return Math.round((237.3 * ln_ea) / (17.27 - ln_ea) * 10) / 10
})

// VPD
const vpd = computed(() => {
  if (temp.value == null || humidity.value == null) return null
  return calcVPD(temp.value, humidity.value)
})

// 환경 점수
const envScore = computed(() => {
  if (temp.value == null || humidity.value == null || !vpd.value) return null
  return calcEnvScore({
    vpd: vpd.value.value,
    vpdOptimal: vpd.value.optimal,
    insideTemp: temp.value,
    insideHumidity: humidity.value,
    insideDewpoint: dewPoint.value,
    uvNorm: null,
  })
})

// 결로 위험
const condensation = computed(() => {
  if (temp.value == null || dewPoint.value == null) return null
  return calcCondensationRisk(temp.value, dewPoint.value)
})

const condensationBadgeClass = computed(() => {
  if (!condensation.value) return ''
  const map: Record<string, string> = { critical: 'high', danger: 'high', warning: 'low', safe: 'ok' }
  return map[condensation.value.level] ?? ''
})

// 환기 스코어 (resolved 외부 온습도 사용)
const vent = computed(() => {
  if (temp.value == null || humidity.value == null) return null
  if (outTemp.value == null || outHumidity.value == null) return null
  return calcVentScore(temp.value, outTemp.value, humidity.value, outHumidity.value, vpd.value?.status)
})

const ventBadgeClass = computed(() => {
  if (!vent.value) return ''
  const map: Record<string, string> = { Normal: 'ok', Recommended: 'low', Urgent: 'high' }
  return map[vent.value.status] ?? ''
})

// 종합 권고사항
const recommendations = computed(() => {
  const recs: { text: string; level: 'good' | 'warn' | 'danger'; priority: number }[] = []
  const T = temp.value
  const RH = humidity.value
  const outT = outTemp.value
  const isOutdoorCold = outT != null && T != null && outT < T - 5

  if (!T || !RH || !vpd.value) return recs

  // VPD 판단
  if (vpd.value.status === 'LOW' && RH > 85) {
    recs.push({ text: `과습(VPD ${vpd.value.value}, 습도 ${RH}%). 환기 + 관수 중단 권장`, level: 'danger', priority: 1 })
  } else if (vpd.value.status === 'LOW' && isOutdoorCold) {
    recs.push({ text: `습도 과다이나 외부가 ${outT}°C로 낮음. 소량 환기 + 순환팬 권장`, level: 'warn', priority: 2 })
  } else if (vpd.value.status === 'LOW') {
    recs.push({ text: `습도 과다(VPD ${vpd.value.value}). 환기를 권장합니다`, level: 'danger', priority: 1 })
  } else if (vpd.value.status === 'HIGH') {
    recs.push({ text: `건조(VPD ${vpd.value.value}). 미스트 또는 관수 증가 권장`, level: 'danger', priority: 1 })
  }

  // 온도 판단
  const dn = getDayNightParams()
  if (T > dn.tempCeil) {
    recs.push({ text: `고온 ${T}°C — 환기 + 차광막 시급`, level: 'danger', priority: 2 })
  } else if (T > dn.tempOptHigh) {
    recs.push({ text: `온도 ${T}°C — 적정 초과. 환기 검토`, level: 'warn', priority: 4 })
  } else if (T < dn.tempFloor) {
    recs.push({ text: `저온 ${T}°C — 보온 + 난방 필요`, level: 'danger', priority: 2 })
  } else if (T < dn.tempOptLow) {
    recs.push({ text: `온도 ${T}°C — 적정 미만. 보온 검토`, level: 'warn', priority: 5 })
  }

  // 결로 위험
  if (condensation.value) {
    const c = condensation.value
    if (c.level === 'critical') {
      recs.push({ text: `결로 매우 위험(여유 ${c.margin}°C). 순환팬 즉시 가동`, level: 'danger', priority: 2 })
    } else if (c.level === 'danger') {
      recs.push({ text: `결로 위험(여유 ${c.margin}°C). 환기로 습도 낮추세요`, level: 'warn', priority: 3 })
    }
  }

  // 환기 권고
  if (vent.value && vent.value.status === 'Urgent') {
    recs.push({ text: `환기 긴급(ΔT ${vent.value.dT}°C, ΔRH ${vent.value.dRH}%)`, level: 'danger', priority: 1 })
  }

  if (recs.length === 0) {
    recs.push({ text: '양호한 환경입니다. 현재 관리를 유지하세요', level: 'good', priority: 99 })
  }

  return recs.sort((a, b) => a.priority - b.priority).slice(0, 3)
})
</script>

<style scoped>
.group-env-score {
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid var(--border-light, var(--border-color));
}

.env-score-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}

.env-score-title {
  font-size: calc(14px * var(--content-scale, 1));
  font-weight: 700;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.score-badge {
  padding: 4px 14px;
  border-radius: 20px;
  font-size: calc(14px * var(--content-scale, 1));
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.score-badge.green {
  background: rgba(76, 175, 80, 0.12);
  color: #2e7d32;
  border: 1.5px solid #4CAF50;
}

.score-badge.yellow {
  background: rgba(255, 193, 7, 0.12);
  color: #F57F17;
  border: 1.5px solid #FFC107;
}

.score-badge.red {
  background: rgba(244, 67, 54, 0.12);
  color: #C62828;
  border: 1.5px solid #F44336;
}

.score-badge.gray {
  background: var(--bg-secondary);
  color: var(--text-muted);
  border: 1.5px solid var(--border-color);
}

.env-metrics {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-bottom: 12px;
}

.metric-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  background: var(--bg-secondary);
  border-radius: 10px;
}

.metric-label {
  font-size: calc(12px * var(--content-scale, 1));
  color: var(--text-muted);
  font-weight: 500;
}

.metric-value {
  font-size: calc(18px * var(--content-scale, 1));
  font-weight: 700;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
}

.metric-unit {
  font-size: calc(11px * var(--content-scale, 1));
  font-weight: 500;
  color: var(--text-muted);
  margin-left: 2px;
}

.vpd-badge {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 10px;
  font-size: calc(10px * var(--content-scale, 1));
  font-weight: 700;
  width: fit-content;
  margin-top: 2px;
}

.vpd-badge.ok { background: var(--accent-bg); color: var(--accent); }
.vpd-badge.low { background: rgba(33,150,243,0.1); color: #1976D2; }
.vpd-badge.high { background: rgba(244,67,54,0.1); color: #F44336; }

.env-recs {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.rec-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: calc(12px * var(--content-scale, 1));
  line-height: 1.5;
  padding: 6px 10px;
  border-radius: 8px;
}

.rec-icon {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 9px;
  font-weight: 700;
  margin-top: 2px;
}

.rec-item.good { background: var(--accent-bg, rgba(76,175,80,0.1)); color: var(--accent, #2e7d32); }
.rec-item.good .rec-icon { background: var(--accent, #4CAF50); color: white; }
.rec-item.warn { background: rgba(255,193,7,0.1); color: #F57F17; }
.rec-item.warn .rec-icon { background: #FFC107; color: white; }
.rec-item.danger { background: rgba(244,67,54,0.08); color: #C62828; }
.rec-item.danger .rec-icon { background: #F44336; color: white; }

@media (max-width: 768px) {
  .env-metrics {
    grid-template-columns: 1fr 1fr;
  }
}

@media (max-width: 480px) {
  .env-metrics {
    grid-template-columns: 1fr;
  }

  .metric-value {
    font-size: calc(16px * var(--content-scale, 1));
  }
}
</style>
