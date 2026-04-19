/** 작물별 기준온도 (°C) — 실생묘 기준 */
export const CROP_BASE_TEMP: Record<string, number> = {
  tomato:        10.0,
  cherry_tomato: 10.0,
  cucumber:      12.0,
  strawberry:     5.0,
  paprika:       10.0,
};

/**
 * 접목묘 기준온도 (°C)
 * 접목묘는 대목의 강한 뿌리 활착력으로 저온에서도 생육 가능 → 기저온도 낮음
 */
export const CROP_BASE_TEMP_GRAFTED: Record<string, number> = {
  tomato:        8.0,
  cherry_tomato: 8.0,
  cucumber:      10.0,
  strawberry:     3.0,
  paprika:        8.0,
};

/**
 * 기상청 외기 온도 → 하우스 내부 온도 보정 기본값 (°C)
 * 실내 센서가 없고 별도 오프셋 미설정 시 적용되는 안전 기본값.
 * 한국 비닐하우스 평균 내외 온도차 (봄~가을 주간 기준).
 */
export const DEFAULT_GREENHOUSE_OFFSET = 8.0;

/**
 * 파종~정식 기간(육묘기) 오프셋 (°C)
 * 육묘 트레이는 보온 관리가 더 강해 외기 대비 온도차가 큼.
 * 정식일이 설정된 경우, 파종일부터 정식일 전날까지 이 값을 적용.
 */
export const NURSERY_OFFSET = 10.0;

/** 묘 타입을 반영한 기준온도 반환 */
export function getCropBaseTemp(cropType: string, seedlingType: string): number {
  if (seedlingType === 'grafted') {
    return CROP_BASE_TEMP_GRAFTED[cropType] ?? Math.max((CROP_BASE_TEMP[cropType] ?? 10) - 2, 0);
  }
  return CROP_BASE_TEMP[cropType] ?? 10;
}

/** 작물별 수확 목표 GDD — 실생묘 기준 */
export const CROP_TARGET_GDD: Record<string, number> = {
  tomato:        1200,
  cherry_tomato: 1100,
  cucumber:       700,
  strawberry:     600,
  paprika:       1400,
};

/**
 * 접목묘 수확 목표 GDD
 * 접목묘는 활착이 빠르고 생육 속도가 빠르므로 동일 수확 품질 도달 GDD가 약 12~15% 낮음
 */
export const CROP_TARGET_GDD_GRAFTED: Record<string, number> = {
  tomato:        1050,
  cherry_tomato:  960,
  cucumber:        615,
  strawberry:      525,
  paprika:        1225,
};

/** 묘 타입을 반영한 수확 목표 GDD 반환 */
export function getCropTargetGdd(cropType: string, seedlingType: string): number {
  if (seedlingType === 'grafted') {
    return CROP_TARGET_GDD_GRAFTED[cropType] ?? Math.round((CROP_TARGET_GDD[cropType] ?? 1200) * 0.875);
  }
  return CROP_TARGET_GDD[cropType] ?? 1200;
}

/** 작물 표시 이름 */
export const CROP_LABEL: Record<string, string> = {
  tomato:        '토마토',
  cherry_tomato: '방울토마토',
  cucumber:      '오이',
  strawberry:    '딸기',
  paprika:       '파프리카',
};

/**
 * 작물별 생육기 최소 일일 GDD (°C/일)
 * 봄철 초기 데이터가 부족할 때 과도하게 긴 예측을 방지하기 위한 하한선.
 * 한국 기준: 노지/하우스 생육기(4~10월) 평균을 반영한 보수적 추정치.
 */
export const CROP_MIN_DAILY_GDD: Record<string, number> = {
  tomato:        5.0,
  cherry_tomato: 5.0,
  cucumber:      5.0,
  strawberry:    2.0,
  paprika:       5.0,
};


/** 누적 GDD 기반 생육 단계 정의 (토마토 기준) */
export interface GrowthStage {
  key: string;
  label: string;
  emoji: string;
  minGdd: number;
  maxGdd: number;
}

export const GROWTH_STAGES: GrowthStage[] = [
  { key: 'germination',   label: '발아기',    emoji: '🌱', minGdd: 0,    maxGdd: 80 },
  { key: 'seedling',      label: '육묘기',    emoji: '🌿', minGdd: 80,   maxGdd: 200 },
  { key: 'establishment', label: '활착기',    emoji: '💪', minGdd: 200,  maxGdd: 350 },
  { key: 'vegetative',    label: '영양생장기', emoji: '🌾', minGdd: 350,  maxGdd: 600 },
  { key: 'flowering',     label: '개화착과기', emoji: '🌸', minGdd: 600,  maxGdd: 900 },
  { key: 'fruiting',      label: '과비대기',  emoji: '🍅', minGdd: 900,  maxGdd: 1200 },
  { key: 'harvest',       label: '수확기',    emoji: '✂️', minGdd: 1200, maxGdd: Infinity },
];

/** 현재 GDD로 생육 단계 반환 */
export function resolveGrowthStage(currentGdd: number): GrowthStage {
  return (
    GROWTH_STAGES.find((s) => currentGdd >= s.minGdd && currentGdd < s.maxGdd) ??
    GROWTH_STAGES[GROWTH_STAGES.length - 1]
  );
}

/** 데이터 품질 배지 */
export type TempSourceQuality = 'sensor' | 'sensor_with_gap_fill' | 'weather_with_offset' | 'weather_only';

export const SOURCE_BADGE: Record<TempSourceQuality, { color: string; label: string; emoji: string }> = {
  sensor:                { color: 'green',  emoji: '🟢', label: '실내 센서' },
  sensor_with_gap_fill:  { color: 'yellow', emoji: '🟡', label: '센서 + 보정' },
  weather_with_offset:   { color: 'orange', emoji: '🟠', label: '기상청 + 보정값' },
  weather_only:          { color: 'red',    emoji: '🔴', label: '기상청만 사용' },
};
