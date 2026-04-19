import { ref, readonly } from 'vue'

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
    const res = await fetch('/api/crop-management/feature', {
      headers: { Authorization: `Bearer ${localStorage.getItem('accessToken')}` },
    })
    if (res.ok) {
      state.value = await res.json()
    }
  } catch {
    // 오류 시 기본값 유지 (true)
  } finally {
    loaded.value = true
  }
}

async function setFeature(enabled: boolean, scope: 'platform' | 'personal' = 'personal') {
  const res = await fetch('/api/crop-management/feature', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${localStorage.getItem('accessToken')}`,
    },
    body: JSON.stringify({ enabled, scope }),
  })
  if (!res.ok) throw new Error('설정 저장 실패')
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
