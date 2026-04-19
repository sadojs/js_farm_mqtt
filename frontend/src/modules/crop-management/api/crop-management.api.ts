import apiClient from '../../../api/client'
import type {
  CropBatch,
  CreateCropBatchPayload,
  UpdateCropBatchPayload,
  GddResult,
  MilestonesResponse,
  HarvestPrediction,
  DashboardItem,
  OffsetSuggestion,
  GddTimeline,
} from '../types/crop-management.types'

export const cropManagementApi = {
  // ── 배치 CRUD ──
  getBatches(): Promise<CropBatch[]> {
    return apiClient.get('/crop-management/batches').then((r) => r.data)
  },
  createBatch(payload: CreateCropBatchPayload): Promise<CropBatch> {
    return apiClient.post('/crop-management/batches', payload).then((r) => r.data)
  },
  updateBatch(id: string, payload: UpdateCropBatchPayload): Promise<CropBatch> {
    return apiClient.put(`/crop-management/batches/${id}`, payload).then((r) => r.data)
  },
  deleteBatch(id: string): Promise<void> {
    return apiClient.delete(`/crop-management/batches/${id}`).then(() => undefined)
  },

  // ── GDD / 마일스톤 / 수확 예측 ──
  getGdd(batchId: string): Promise<GddResult> {
    return apiClient.get(`/crop-management/batches/${batchId}/gdd`).then((r) => r.data)
  },
  getMilestones(batchId: string): Promise<MilestonesResponse> {
    return apiClient.get(`/crop-management/batches/${batchId}/milestones`).then((r) => r.data)
  },
  getHarvestPrediction(batchId: string): Promise<HarvestPrediction> {
    return apiClient.get(`/crop-management/batches/${batchId}/harvest-prediction`).then((r) => r.data)
  },
  triggerCalibrate(batchId: string): Promise<{ offset: number | null }> {
    return apiClient.post(`/crop-management/batches/${batchId}/calibrate`).then((r) => r.data)
  },

  // ── 대시보드 ──
  getDashboard(): Promise<DashboardItem[]> {
    return apiClient.get('/crop-management/dashboard').then((r) => r.data)
  },

  // ── 타임라인 ──
  getTimeline(batchId: string): Promise<GddTimeline> {
    return apiClient.get(`/crop-management/batches/${batchId}/timeline`).then((r) => r.data)
  },

  // ── 오프셋 차용 후보 ──
  getOffsetSuggestions(groupId: string, cropType: string): Promise<OffsetSuggestion> {
    return apiClient
      .get('/crop-management/offset-suggestions', { params: { groupId, cropType } })
      .then((r) => r.data)
  },
}
