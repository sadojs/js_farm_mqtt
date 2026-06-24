import { ref, readonly } from 'vue'
import apiClient from '../api/client'

export type FeatureKey = 'work_log' | 'spray_schedule' | 'worker_payroll'

export interface FeatureState {
  enabled: boolean
  platformEnabled: boolean
  userEnabled: boolean
  lockedByAdmin: boolean
}

/** 설정 화면에 노출할 부가기능 메타 (생육관리는 별도 useCropFeature) */
export const FEATURE_META: { key: FeatureKey; label: string; icon: string; desc: string }[] = [
  { key: 'work_log', label: '농작업 일정', icon: '🗓️', desc: '구역별 농작업 기록·상태 보드' },
  { key: 'spray_schedule', label: '방재 일정', icon: '💧', desc: '방재 달력·벌문 개방 일정' },
  { key: 'worker_payroll', label: '일꾼 관리', icon: '👷', desc: '근무·급여 정산 관리' },
]

const FEATURE_KEYS: FeatureKey[] = FEATURE_META.map((f) => f.key)

const defaultState = (): FeatureState => ({
  enabled: true,
  platformEnabled: true,
  userEnabled: true,
  lockedByAdmin: false,
})

function emptyStates(): Record<FeatureKey, FeatureState> {
  return {
    work_log: defaultState(),
    spray_schedule: defaultState(),
    worker_payroll: defaultState(),
  }
}

const state = ref<Record<FeatureKey, FeatureState>>(emptyStates())
const loaded = ref(false)

async function fetchFeatures() {
  try {
    const { data } = await apiClient.get<Record<FeatureKey, FeatureState>>('/features')
    state.value = { ...emptyStates(), ...data }
  } catch {
    // 오류 시 기본값(true) 유지 → 기능 노출
  } finally {
    loaded.value = true
  }
}

async function setFeature(
  feature: FeatureKey,
  enabled: boolean,
  scope: 'platform' | 'personal' = 'personal',
) {
  await apiClient.patch(`/features/${feature}`, { enabled, scope })
  await fetchFeatures()
}

/** 메뉴 노출 여부 — 기본 true */
function isEnabled(feature: FeatureKey): boolean {
  return state.value[feature]?.enabled !== false
}

export function useFeatureFlags() {
  return {
    features: readonly(state),
    loaded: readonly(loaded),
    keys: FEATURE_KEYS,
    fetchFeatures,
    setFeature,
    isEnabled,
  }
}
