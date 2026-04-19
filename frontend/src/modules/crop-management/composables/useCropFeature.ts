import { ref, readonly } from 'vue'
import apiClient from '../../../api/client'

interface FeatureState {
  enabled: boolean
  platformEnabled: boolean
  userEnabled: boolean
  lockedByAdmin: boolean
}

const state = ref<FeatureState>({ enabled: true, platformEnabled: true, userEnabled: true, lockedByAdmin: false })
const loaded = ref(false)

async function fetchFeature() {
  try {
    const { data } = await apiClient.get<FeatureState>('/crop-management/feature')
    state.value = data
  } catch {
    // 오류 시 기본값 유지 (true)
  } finally {
    loaded.value = true
  }
}

async function setFeature(enabled: boolean, scope: 'platform' | 'personal' = 'personal') {
  await apiClient.patch('/crop-management/feature', { enabled, scope })
  await fetchFeature()
}

export function useCropFeature() {
  return {
    feature: readonly(state),
    loaded: readonly(loaded),
    fetchFeature,
    setFeature,
  }
}
