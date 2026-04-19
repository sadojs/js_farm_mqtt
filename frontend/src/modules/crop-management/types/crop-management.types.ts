// ──────────────────────────────────────────────────
// 도메인 타입 정의
// ──────────────────────────────────────────────────

export type CropType = 'tomato' | 'cherry_tomato' | 'cucumber' | 'strawberry' | 'paprika'
export type SeedlingType = 'seedling' | 'grafted'
export type TempSource = 'auto' | 'sensor' | 'weather'
export type OffsetSource = 'calibrated' | 'manual' | 'borrowed' | 'community'
export type TempSourceQuality = 'sensor' | 'sensor_with_gap_fill' | 'weather_with_offset' | 'weather_only'
export type OffsetStrategy = 'calibrated' | 'manual' | 'borrowed' | 'community' | 'default'
export type MilestoneStatus = 'done' | 'imminent' | 'upcoming'

export const CROP_LABELS: Record<CropType, string> = {
  tomato: '토마토',
  cherry_tomato: '방울토마토',
  cucumber: '오이',
  strawberry: '딸기',
  paprika: '파프리카',
}

export const SEEDLING_LABELS: Record<SeedlingType, string> = {
  seedling: '실생묘',
  grafted: '접목묘',
}

export const SOURCE_BADGE: Record<TempSourceQuality, { emoji: string; label: string; color: string }> = {
  sensor:               { emoji: '🟢', label: '실내 센서',     color: 'var(--success-color, #4caf50)' },
  sensor_with_gap_fill: { emoji: '🟡', label: '센서 + 보정',   color: '#ffc107' },
  weather_with_offset:  { emoji: '🟠', label: '기상청 + 보정값', color: '#ff9800' },
  weather_only:         { emoji: '🔴', label: '기상청만 사용',  color: 'var(--danger-color, #f44336)' },
}

// ──────────────────────────────────────────────────
// API 응답 타입
// ──────────────────────────────────────────────────

export interface CropBatch {
  id: string
  groupId: string | null
  cropType: CropType
  seedlingType: SeedlingType
  sowingDate: string
  transplantDate: string | null
  baseTemp: number
  targetGdd: number | null
  tempSource: TempSource
  greenhouseOffset: number | null
  offsetSource: OffsetSource | null
  borrowedGroupId: string | null
  offsetCalibratedAt: string | null
  notes: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface GrowthStage {
  key: string
  label: string
  emoji: string
}

export interface GddResult {
  currentGdd: number
  targetGdd: number
  progressPct: number
  stage: GrowthStage
  sourceQuality: TempSourceQuality
  sourceBadge: { color: string; emoji: string; label: string }
  dailyAvg: number
  offsetInfo: { value: number; strategy: OffsetStrategy }
}

export interface MilestoneItem {
  id: string
  title: string
  milestoneType: string
  gddThreshold: number
  priority: string
  description: string | null
  status: MilestoneStatus
  estimatedDate: string | null
}

export interface MilestonesResponse {
  gdd: GddResult
  milestones: MilestoneItem[]
}

export interface HarvestPrediction {
  currentGdd: number
  targetGdd: number
  remainingGdd: number
  dailyAvgGdd: number
  estimatedDaysLeft: number
  estimatedDate: string
  optimisticDate: string
  pessimisticDate: string
  seasonal: {
    estimatedDate: string
    estimatedDaysLeft: number
    source: 'kma_asos' | 'weather_data' | 'builtin'
    dataYears: number
    monthlyForecast: Array<{ month: string; label: string; expectedDailyGdd: number; role: 'actual' | 'forecast' }>
  }
  predictionMethod: 'rate_only' | 'seasonal_only' | 'blended'
  daysElapsed: number
  confidence: 'low' | 'medium' | 'high'
}

export interface DashboardItem {
  batchId: string
  groupId: string | null
  groupName: string | null
  cropType: CropType
  sowingDate: string
  gdd: GddResult
  nextMilestone: MilestoneItem | null
}

export interface OffsetSuggestion {
  selfCalibrated: number | null
  otherGroups: Array<{ groupId: string; groupName: string; offset: number; cropType: string }>
  communityAverage: { cropType: string; offset: number; sampleCount: number } | null
}

// ──────────────────────────────────────────────────
// 요청 타입
// ──────────────────────────────────────────────────

export interface CreateCropBatchPayload {
  groupId?: string
  cropType: CropType
  seedlingType: SeedlingType
  sowingDate: string
  transplantDate?: string
  baseTemp?: number
  targetGdd?: number
  tempSource?: TempSource
  greenhouseOffset?: number
  offsetSource?: OffsetSource
  borrowedGroupId?: string
  notes?: string
}

export interface UpdateCropBatchPayload extends Partial<CreateCropBatchPayload> {
  isActive?: boolean
}

export interface TimelineDailyPoint {
  date: string
  cumulativeGdd: number
  dailyGdd: number
}

export interface TimelineMilestone {
  gddThreshold: number
  title: string
  milestoneType: string
  priority: string
  reachedDate: string | null
  estimatedDate: string | null
}

export interface GddTimeline {
  cropType: string
  sowingDate: string
  targetGdd: number
  currentGdd: number
  dailyPoints: TimelineDailyPoint[]
  milestones: TimelineMilestone[]
  estimatedHarvestDate: string
}
