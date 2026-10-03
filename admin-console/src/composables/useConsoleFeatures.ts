/**
 * 기능 플래그 (요청 형태는 기존 useFeatureFlags·useCropFeature 와 동일).
 *
 * - useMySettings: 관리자 "본인" 설정(A10·A11). 어느 화면에서 열어도 본인 기준이어야 하므로 플랫폼 범위로 요청.
 * - useFarmMenuFlags: 농장 보기 사이드바의 방재·일꾼·농작업·생육관리 메뉴 노출(시안 05 "기능 플래그 반영").
 *   농장 보기 경로에서 호출되므로 X-Farm-Context 가 붙어 선택 농장 기준으로 판정된다.
 */
import { ref } from 'vue'
import apiClient from '@/api/client'
import type { FeatureKey, FeatureState } from '@/composables/useFeatureFlags'
import { PLATFORM_REQUEST } from '@console/farm/farmContext'

const defaultState = (): FeatureState => ({ enabled: true, platformEnabled: true, userEnabled: true, lockedByAdmin: false })
const emptyFlags = (): Record<FeatureKey, FeatureState> => ({
  work_log: defaultState(), spray_schedule: defaultState(), worker_payroll: defaultState(),
})

export function useMySettings() {
  const cropFeature = ref<FeatureState>(defaultState())
  const featureFlags = ref<Record<FeatureKey, FeatureState>>(emptyFlags())

  async function load() {
    const [crop, flags] = await Promise.allSettled([
      apiClient.get<FeatureState>('/crop-management/feature', PLATFORM_REQUEST),
      apiClient.get<Record<FeatureKey, FeatureState>>('/features', PLATFORM_REQUEST),
    ])
    if (crop.status === 'fulfilled') cropFeature.value = crop.value.data
    if (flags.status === 'fulfilled') featureFlags.value = { ...emptyFlags(), ...flags.value.data }
  }
  async function toggleCrop() {
    await apiClient.patch('/crop-management/feature', { enabled: !cropFeature.value.userEnabled, scope: 'personal' }, PLATFORM_REQUEST)
    await load()
  }
  async function toggleFeature(key: FeatureKey) {
    await apiClient.patch(`/features/${key}`, { enabled: !featureFlags.value[key]?.userEnabled, scope: 'personal' }, PLATFORM_REQUEST)
    await load()
  }
  return { cropFeature, featureFlags, load, toggleCrop, toggleFeature }
}

export function useFarmMenuFlags() {
  const flags = ref<Record<string, boolean>>({ work_log: true, spray_schedule: true, worker_payroll: true, crop: true })
  async function load() {
    const [crop, features] = await Promise.allSettled([
      apiClient.get<FeatureState>('/crop-management/feature'),
      apiClient.get<Record<FeatureKey, FeatureState>>('/features'),
    ])
    const next = { ...flags.value }
    if (features.status === 'fulfilled') {
      for (const k of ['work_log', 'spray_schedule', 'worker_payroll'] as FeatureKey[]) next[k] = features.value.data?.[k]?.enabled !== false
    }
    if (crop.status === 'fulfilled') next.crop = crop.value.data?.enabled !== false
    flags.value = next
  }
  return { flags, load }
}
