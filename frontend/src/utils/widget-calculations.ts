/**
 * 스마트팜 환경 모니터링 위젯 계산 유틸리티
 * 방울토마토 재배 기준 적용
 */

export function clip(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

// === 포화 수증기압 (kPa) ===
export function calcSatVaporPressure(tempC: number): number {
  return 0.6108 * Math.exp((17.27 * tempC) / (tempC + 237.3));
}

// === VPD (Vapor Pressure Deficit) — 생육 단계별 가중 구간 ===
export type VPDStatus = 'LOW' | 'OK' | 'HIGH';

const VPD_RANGES: Record<string, { low: number; high: number; optimal: number }> = {
  vegetative:      { low: 0.3, high: 1.2, optimal: 0.8 },
  flowering_fruit: { low: 0.4, high: 1.4, optimal: 1.0 },
  harvest:         { low: 0.5, high: 1.8, optimal: 1.3 },
};

export function calcVPD(
  tempC: number, rhPct: number, stage?: string,
): { value: number; status: VPDStatus; optimal: number } {
  const es = calcSatVaporPressure(tempC);
  const vpd = es * (1 - rhPct / 100);
  const value = Math.round(vpd * 100) / 100;
  const range = VPD_RANGES[stage || 'flowering_fruit'] || VPD_RANGES.flowering_fruit;
  let status: VPDStatus = 'OK';
  if (vpd < range.low) status = 'LOW';
  else if (vpd > range.high) status = 'HIGH';
  return { value, status, optimal: range.optimal };
}

// === 환기 필요 스코어 — VPD 교차검증 ===
export type VentStatus = 'Normal' | 'Recommended' | 'Urgent';
export function calcVentScore(
  inT: number, outT: number, inRH: number, outRH: number, vpdStatus?: VPDStatus,
): { score: number; dT: number; dRH: number; status: VentStatus } {
  const dT = Math.round((inT - outT) * 10) / 10;
  const dRH = Math.round((inRH - outRH) * 10) / 10;
  let score = Math.round((Math.max(0, dT) * 1.0 + Math.max(0, dRH) * 0.3) * 10) / 10;

  // VPD 교차검증: RH 높아도 VPD OK면 환기 긴급도 낮춤
  if (vpdStatus === 'OK' && score > 3) {
    score = Math.round(Math.max(score * 0.6, 2) * 10) / 10;
  }
  // VPD LOW인데 점수 낮으면 상향 보정
  if (vpdStatus === 'LOW' && score < 3) {
    score = 3.5;
  }

  let status: VentStatus = 'Normal';
  if (score > 6) status = 'Urgent';
  else if (score > 3) status = 'Recommended';
  return { score, dT, dRH, status };
}

// === 온도 10분 변화율 ===
export function calcTempRate(now: number, prev: number): { delta: number; status: string; statusKey: string } {
  const delta = Math.round((now - prev) * 10) / 10;
  let status = 'Stable';
  let statusKey = 'stable';
  if (delta > 2.0) { status = '급상승'; statusKey = 'rapid-rise'; }
  else if (delta > 0.5) { status = '상승'; statusKey = 'rise'; }
  else if (delta < -2.0) { status = '급하강'; statusKey = 'rapid-drop'; }
  else if (delta < -0.5) { status = '하강'; statusKey = 'drop'; }
  return { delta, status, statusKey };
}

// === 습도 10분 변화율 ===
export function calcRhRate(now: number, prev: number): { delta: number; status: string; statusKey: string } {
  const delta = Math.round((now - prev) * 10) / 10;
  let status = 'Stable';
  let statusKey = 'stable';
  if (delta > 5) { status = '급가습'; statusKey = 'rapid-wet'; }
  else if (delta > 2) { status = '가습'; statusKey = 'wet'; }
  else if (delta < -5) { status = '급건조'; statusKey = 'rapid-drying'; }
  else if (delta < -2) { status = '건조'; statusKey = 'drying'; }
  return { delta, status, statusKey };
}

// === 결로위험 4단계 ===
export type CondensationLevel = 'critical' | 'danger' | 'warning' | 'safe';
export function calcCondensationRisk(tempC: number, dewPoint: number): {
  margin: number; level: CondensationLevel; label: string;
} {
  const margin = Math.round((tempC - dewPoint) * 10) / 10;
  if (margin < 1) return { margin, level: 'critical', label: '매우 위험' };
  if (margin < 2) return { margin, level: 'danger', label: '위험' };
  if (margin < 4) return { margin, level: 'warning', label: '주의' };
  return { margin, level: 'safe', label: '양호' };
}

// === 주/야간 파라미터 ===
export function getDayNightParams(): {
  tempOptLow: number; tempOptHigh: number;
  tempFloor: number; tempCeil: number;
  rhOptLow: number; rhOptHigh: number; rhCeil: number;
  isDay: boolean;
} {
  const hour = new Date().getHours();
  const isDay = hour >= 6 && hour < 18;
  return isDay
    ? { tempOptLow: 22, tempOptHigh: 26, tempFloor: 15, tempCeil: 33,
        rhOptLow: 60, rhOptHigh: 75, rhCeil: 90, isDay }
    : { tempOptLow: 16, tempOptHigh: 18, tempFloor: 10, tempCeil: 22,
        rhOptLow: 65, rhOptHigh: 85, rhCeil: 95, isDay };
}

// === UV 위험도 ===
export function calcUVRisk(
  uv: number,
): { value: number; label: string; category: string } {
  if (uv <= 2) return { value: uv, label: '낮음', category: 'low' };
  if (uv <= 5) return { value: uv, label: '보통', category: 'moderate' };
  if (uv <= 7) return { value: uv, label: '높음', category: 'high' };
  if (uv <= 10) return { value: uv, label: '매우높음', category: 'very-high' };
  return { value: uv, label: '위험', category: 'extreme' };
}

// UV norm (raw UV fallback)
export function calcUVNorm(uv: number, stats14d: { min: number; max: number }): number {
  const range = stats14d.max - stats14d.min;
  if (range <= 0) return 0;
  return clip((uv - stats14d.min) / range, 0, 1);
}

// === 환경 상태 점수 (방울토마토 기준 — 주/야간+단계별 보정) ===
export interface EnvScoreParams {
  vpd: number;
  vpdOptimal?: number;
  insideTemp: number;
  insideHumidity?: number | null;
  insideDewpoint?: number | null;
  uvNorm?: number | null;
}

export function calcEnvScore(params: EnvScoreParams): { score: number; color: 'green' | 'yellow' | 'red' } {
  const { vpd, insideTemp, insideHumidity, insideDewpoint, uvNorm } = params;
  const dn = getDayNightParams();
  const optimal = params.vpdOptimal ?? 1.0;

  // VPD: 단계별 최적 중심 기준
  const S_vpd = clip(1 - Math.abs(vpd - optimal) / optimal, 0, 1);

  // 결로 위험: 4단계 매핑
  let S_cond = 1;
  if (insideDewpoint != null) {
    const cond = calcCondensationRisk(insideTemp, insideDewpoint);
    const condMap: Record<CondensationLevel, number> = {
      critical: 0, danger: 0.3, warning: 0.7, safe: 1,
    };
    S_cond = condMap[cond.level];
  }

  // 온도: 주/야간 목표 분리
  let S_T: number;
  if (insideTemp >= dn.tempOptLow && insideTemp <= dn.tempOptHigh) {
    S_T = 1;
  } else if (insideTemp < dn.tempOptLow) {
    S_T = clip((insideTemp - dn.tempFloor) / (dn.tempOptLow - dn.tempFloor), 0, 1);
  } else {
    S_T = clip((dn.tempCeil - insideTemp) / (dn.tempCeil - dn.tempOptHigh), 0, 1);
  }

  // 습도: 주/야간 목표 분리
  let S_RH = 1;
  if (insideHumidity != null) {
    if (insideHumidity >= dn.rhOptLow && insideHumidity <= dn.rhOptHigh) {
      S_RH = 1;
    } else if (insideHumidity < dn.rhOptLow) {
      S_RH = clip((insideHumidity - (dn.rhOptLow - 20)) / 20, 0, 1);
    } else {
      S_RH = clip((dn.rhCeil - insideHumidity) / (dn.rhCeil - dn.rhOptHigh), 0, 1);
    }
  }

  const S_uv = uvNorm != null ? 1 - Math.max(0, uvNorm - 0.7) : 1;

  // 가중치: VPD(30%) + 결로(15%) + 온도(25%) + 습도(20%) + UV(10%)
  const score = Math.round(100 * (3 * S_vpd + 1.5 * S_cond + 2.5 * S_T + 2 * S_RH + 1 * S_uv) / 10);

  let color: 'green' | 'yellow' | 'red' = 'green';
  if (score < 60) color = 'red';
  else if (score < 80) color = 'yellow';

  return { score, color };
}

// === Sparkline 경로 생성 ===
export function sparklinePath(data: { time: string; value: number }[], w = 120, h = 32): string {
  if (data.length < 2) return '';
  const values = data.map(d => d.value);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const range = maxV - minV || 1;
  return data.map((d, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((d.value - minV) / range) * (h - 4) - 2;
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}

// === 게이지 퍼센트 ===
export function gaugePercent(value: number, min: number, max: number): number {
  return ((clip(value, min, max) - min) / (max - min)) * 100;
}
