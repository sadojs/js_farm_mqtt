# Plan: 환경 모니터링 수식 보정 (monitoring-calibration)

## 1. 개요

현재 환경 모니터링 위젯의 계산식/기준값을 방울토마토 실제 재배 환경에 맞게 보정한다.
주요 보정 항목: VPD 단계별 구간, 환기 필요도 VPD 교차검증, 결로위험 단계화, 주/야간 온습도 목표 분리.

## 2. 현재 문제점 (AS-IS)

### 2.1 VPD 고정 구간
- **현재**: LOW < 0.4 / OK 0.4~1.4 / HIGH > 1.4 (고정)
- **문제**: 생육 단계마다 최적 VPD가 다름. 초기생장은 0.6~1.0이 적정, 한여름 고광 시 1.0~1.6도 허용 가능

### 2.2 환기 필요도 — RH 비선형 문제
- **현재**: `max(0,ΔT)*1.0 + max(0,ΔRH)*0.3` (단순 가중합)
- **문제**: RH는 비선형 — 온도가 높으면 RH가 높아도 VPD는 정상일 수 있음. RH 기반 점수만으로는 오판 가능

### 2.3 결로위험 단순 구간
- **현재**: `(내부온도 - 이슬점) / 4` → 0~1 연속 스코어
- **문제**: 구간 경계가 없어 알람 품질 낮음. 0.5°C 여유와 3.5°C 여유가 같은 레벨로 취급됨

### 2.4 온습도 최적값 — 주야간 미분리
- **현재**: 온도 22~26°C 고정, 습도 60~70% 고정
- **문제**: 방울토마토 야간 관리 목표는 16~18°C. 24°C는 주간 목표. 습도도 60~85% 범위가 현실적

## 3. 보정 내용 (TO-BE)

### 3.1 VPD 단계별 가중 구간

수확관리의 `currentStage`를 활용하여 VPD OK 구간을 이동시킨다.

| 단계 | VPD 적정 (kPa) | LOW 경계 | HIGH 경계 | 최적 중심 |
|------|----------------|----------|-----------|-----------|
| vegetative (초기생장) | 0.6~1.0 | < 0.3 | > 1.2 | 0.8 |
| flowering_fruit (개화~착과) | 0.8~1.2 | < 0.4 | > 1.4 | 1.0 |
| harvest (수확기/고광) | 1.0~1.6 | < 0.5 | > 1.8 | 1.3 |

**변경 파일**: `widget-calculations.ts` — `calcVPD`에 stage 파라미터 추가
**변경 파일**: `MonitoringWidgets.vue` — VPD 계산 시 배치의 currentStage 전달
**변경 파일**: `dashboard.service.ts` — 위젯 데이터에 활성 배치의 currentStage 포함

```typescript
// TO-BE
const VPD_RANGES: Record<string, { low: number; high: number; optimal: number }> = {
  vegetative:      { low: 0.3, high: 1.2, optimal: 0.8 },
  flowering_fruit: { low: 0.4, high: 1.4, optimal: 1.0 },
  harvest:         { low: 0.5, high: 1.8, optimal: 1.3 },
};

export function calcVPD(tempC: number, rhPct: number, stage?: string) {
  const es = calcSatVaporPressure(tempC);
  const vpd = es * (1 - rhPct / 100);
  const range = VPD_RANGES[stage || 'flowering_fruit'] || VPD_RANGES.flowering_fruit;
  let status: VPDStatus = 'OK';
  if (vpd < range.low) status = 'LOW';
  else if (vpd > range.high) status = 'HIGH';
  return { value: Math.round(vpd * 100) / 100, status, optimal: range.optimal };
}
```

### 3.2 환기 필요도 — VPD 교차검증

기존 ΔT/ΔRH 점수 + VPD 상태를 교차 분석하여 오판을 방지한다.

```typescript
// TO-BE
export function calcVentScore(
  inT: number, outT: number, inRH: number, outRH: number, vpdStatus?: VPDStatus,
) {
  const dT = Math.round((inT - outT) * 10) / 10;
  const dRH = Math.round((inRH - outRH) * 10) / 10;
  let score = Math.round((Math.max(0, dT) * 1.0 + Math.max(0, dRH) * 0.3) * 10) / 10;

  // VPD 교차검증: RH 높아도 VPD OK면 환기 긴급도 낮춤
  if (vpdStatus === 'OK' && score > 3) {
    score = Math.max(score * 0.6, 2); // 40% 감쇠, 최소 2
  }
  // VPD LOW인데 점수 낮으면 상향 보정
  if (vpdStatus === 'LOW' && score < 3) {
    score = 3.5; // 최소 Recommended
  }

  let status: VentStatus = 'Normal';
  if (score > 6) status = 'Urgent';
  else if (score > 3) status = 'Recommended';
  return { score: Math.round(score * 10) / 10, dT, dRH, status };
}
```

### 3.3 결로위험 4단계화

| 이슬점 여유 (T - Td) | 등급 | 코드 |
|----------------------|------|------|
| 0~1°C | 매우 위험 | critical |
| 1~2°C | 위험 | danger |
| 2~4°C | 주의 | warning |
| 4°C+ | 양호 | safe |

```typescript
// TO-BE
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
```

**환경점수 반영**: `S_cond` 계산을 연속 0~1 → 단계별 매핑으로 변경
```
critical → S_cond = 0.0
danger   → S_cond = 0.3
warning  → S_cond = 0.7
safe     → S_cond = 1.0
```

### 3.4 온습도 주/야간 목표 분리

현재 시각 기준으로 주간(06~18시)/야간(18~06시) 관리 목표를 분리한다.

| 시간대 | 온도 적정 | 온도 하한 | 온도 상한 | 습도 적정 |
|--------|-----------|-----------|-----------|-----------|
| 주간 (06~18) | 22~26°C | 15°C | 33°C | 60~75% |
| 야간 (18~06) | 16~18°C | 10°C | 22°C | 65~85% |

```typescript
// TO-BE
function getDayNightParams(): {
  tempOptLow: number; tempOptHigh: number;
  tempFloor: number; tempCeil: number;
  rhOptLow: number; rhOptHigh: number; rhCeil: number;
} {
  const hour = new Date().getHours();
  const isDay = hour >= 6 && hour < 18;
  return isDay
    ? { tempOptLow: 22, tempOptHigh: 26, tempFloor: 15, tempCeil: 33,
        rhOptLow: 60, rhOptHigh: 75, rhCeil: 90 }
    : { tempOptLow: 16, tempOptHigh: 18, tempFloor: 10, tempCeil: 22,
        rhOptLow: 65, rhOptHigh: 85, rhCeil: 95 };
}
```

**환경점수 반영**: `S_T`, `S_RH` 계산에서 고정값 → `getDayNightParams()` 사용
**코칭 반영**: 추천 문구에서 "적정(22~26°C)" → "주간 적정(22~26°C)" / "야간 적정(16~18°C)" 분기

## 4. 수정 대상 파일

| 파일 | 변경 내용 |
|------|-----------|
| `frontend/src/utils/widget-calculations.ts` | VPD 단계별 구간, 환기 VPD 교차검증, 결로 4단계, 주/야 파라미터 |
| `frontend/src/components/dashboard/MonitoringWidgets.vue` | stage 전달, 결로 등급 표시, 주/야 코칭 문구 분기 |
| `backend/src/modules/dashboard/dashboard.service.ts` | 위젯 응답에 currentStage 포함 (활성 배치 조회) |
| `backend/src/modules/dashboard/dashboard.controller.ts` | getWidgetData에 harvest 서비스 연동 |

## 5. 구현 순서

1. `widget-calculations.ts` — 4개 계산 함수 보정 (순수 함수, 테스트 용이)
2. `dashboard.service.ts` — 위젯 응답에 `currentStage` 추가
3. `MonitoringWidgets.vue` — 보정된 함수 연동 + 코칭 문구 업데이트
4. 빌드 및 통합 테스트

## 6. 영향 범위

- **대시보드 위젯 7개**: VPD, 환기필요도, 결로위험(환경점수 내), 온도/습도 점수 → 전부 보정 영향
- **코칭 추천**: 문구 분기 + VPD 상태 판정 변경으로 추천 내용 변화
- **하위 호환**: API 응답 스키마 변경 없음 (currentStage 필드 추가만)
- **기존 위젯 레이아웃**: 변경 없음 (계산 로직만 변경)
