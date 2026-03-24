// 생육단계 상수
export const GROWTH_STAGES = [
  { value: 'vegetative' as const, label: '영양생장', color: '#10B981', icon: '🌿' },
  { value: 'flowering_fruit' as const, label: '개화착과', color: '#8B5CF6', icon: '🌸' },
  { value: 'harvest' as const, label: '수확', color: '#EF4444', icon: '🍅' },
]

export type GrowthStage = typeof GROWTH_STAGES[number]['value']

// 생육 피드백 상수
export const GROWTH_FEEDBACK = [
  { value: 'growth_fast' as const, label: '순 많음', icon: '🌱', description: '생육이 빠릅니다' },
  { value: 'normal' as const, label: '보통', icon: '🌿', description: '정상 생육' },
  { value: 'growth_slow' as const, label: '거의 없음', icon: '🍂', description: '생육이 느립니다' },
]

export type GrowthFeedback = typeof GROWTH_FEEDBACK[number]['value']

// 재스케줄 모드
export interface RescheduleMode {
  value: 'anchor' | 'shift' | 'one_time'
  label: string
  description: string
  recommended: boolean
}

export const RESCHEDULE_MODES: RescheduleMode[] = [
  { value: 'anchor', label: '주기 유지', description: '원래 간격 그대로 유지', recommended: true },
  { value: 'shift', label: '시리즈 이동', description: '완료일 기준으로 전체 이동', recommended: false },
  { value: 'one_time', label: '이번만 반영', description: '이번 작업만 날짜 변경', recommended: false },
]

export function getStageInfo(stage: string) {
  return GROWTH_STAGES.find(s => s.value === stage) || GROWTH_STAGES[0]
}

export function needsFeedback(intervalMin?: number | null, intervalMax?: number | null): boolean {
  if (!intervalMin || !intervalMax) return false
  return intervalMin !== intervalMax
}
