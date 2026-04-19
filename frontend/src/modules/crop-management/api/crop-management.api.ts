import axios from 'axios'
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

// 독립 axios 인스턴스 (삭제 시 기존 api/client.ts 변경 불필요)
const client = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
})

client.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

export const cropManagementApi = {
  // ── 배치 CRUD ──
  getBatches(): Promise<CropBatch[]> {
    return client.get('/crop-management/batches').then((r) => r.data)
  },
  createBatch(payload: CreateCropBatchPayload): Promise<CropBatch> {
    return client.post('/crop-management/batches', payload).then((r) => r.data)
  },
  updateBatch(id: string, payload: UpdateCropBatchPayload): Promise<CropBatch> {
    return client.put(`/crop-management/batches/${id}`, payload).then((r) => r.data)
  },
  deleteBatch(id: string): Promise<void> {
    return client.delete(`/crop-management/batches/${id}`).then(() => undefined)
  },

  // ── GDD / 마일스톤 / 수확 예측 ──
  getGdd(batchId: string): Promise<GddResult> {
    return client.get(`/crop-management/batches/${batchId}/gdd`).then((r) => r.data)
  },
  getMilestones(batchId: string): Promise<MilestonesResponse> {
    return client.get(`/crop-management/batches/${batchId}/milestones`).then((r) => r.data)
  },
  getHarvestPrediction(batchId: string): Promise<HarvestPrediction> {
    return client.get(`/crop-management/batches/${batchId}/harvest-prediction`).then((r) => r.data)
  },
  triggerCalibrate(batchId: string): Promise<{ offset: number | null }> {
    return client.post(`/crop-management/batches/${batchId}/calibrate`).then((r) => r.data)
  },

  // ── 대시보드 ──
  getDashboard(): Promise<DashboardItem[]> {
    return client.get('/crop-management/dashboard').then((r) => r.data)
  },

  // ── 타임라인 ──
  getTimeline(batchId: string): Promise<GddTimeline> {
    return client.get(`/crop-management/batches/${batchId}/timeline`).then((r) => r.data)
  },

  // ── 오프셋 차용 후보 ──
  getOffsetSuggestions(groupId: string, cropType: string): Promise<OffsetSuggestion> {
    return client
      .get('/crop-management/offset-suggestions', { params: { groupId, cropType } })
      .then((r) => r.data)
  },
}
