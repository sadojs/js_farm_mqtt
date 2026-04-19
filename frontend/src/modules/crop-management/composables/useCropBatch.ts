import { ref, computed } from 'vue'
import { cropManagementApi } from '../api/crop-management.api'
import type { CropBatch, DashboardItem, CreateCropBatchPayload } from '../types/crop-management.types'

export function useCropBatch() {
  const batches = ref<CropBatch[]>([])
  const dashboard = ref<DashboardItem[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function fetchBatches() {
    loading.value = true
    error.value = null
    try {
      batches.value = await cropManagementApi.getBatches()
    } catch (e: any) {
      error.value = e?.response?.data?.message ?? '데이터를 불러올 수 없습니다.'
    } finally {
      loading.value = false
    }
  }

  async function fetchDashboard() {
    loading.value = true
    error.value = null
    try {
      dashboard.value = await cropManagementApi.getDashboard()
    } catch {
      // 대시보드는 오류 시 빈 배열 유지
      dashboard.value = []
    } finally {
      loading.value = false
    }
  }

  async function createBatch(payload: CreateCropBatchPayload) {
    const created = await cropManagementApi.createBatch(payload)
    batches.value.unshift(created)
    return created
  }

  async function deleteBatch(id: string) {
    await cropManagementApi.deleteBatch(id)
    batches.value = batches.value.filter((b) => b.id !== id)
  }

  /** 특정 그룹의 활성 배치 */
  const batchByGroup = computed(() => {
    const map: Record<string, CropBatch> = {}
    for (const b of batches.value) {
      if (b.groupId && b.isActive) map[b.groupId] = b
    }
    return map
  })

  /** 대시보드 — 그룹 ID로 조회 */
  const dashboardByGroup = computed(() => {
    const map: Record<string, DashboardItem> = {}
    for (const d of dashboard.value) {
      if (d.groupId) map[d.groupId] = d
    }
    return map
  })

  return {
    batches,
    dashboard,
    loading,
    error,
    batchByGroup,
    dashboardByGroup,
    fetchBatches,
    fetchDashboard,
    createBatch,
    deleteBatch,
  }
}
