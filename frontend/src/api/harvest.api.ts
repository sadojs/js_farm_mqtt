import apiClient from './client'

export interface CropBatch {
  id: string
  userId: string
  cropName: string
  variety: string | null
  houseName: string
  houseId: string | null
  groupId: string | null
  sowDate: string
  transplantDate: string | null
  growDays: number
  stage: string
  currentStage: string
  stageStartedAt: string | null
  memo: string | null
  status: 'active' | 'completed'
  completedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateBatchRequest {
  cropName: string
  variety?: string
  houseName?: string
  houseId?: string
  groupId?: string
  sowDate: string
  transplantDate?: string
  growDays: number
  stage?: string
  memo?: string
}

export const harvestApi = {
  getBatches: (status?: string) =>
    apiClient.get<CropBatch[]>('/harvest/batches', { params: { status } }),
  getBatch: (id: string) =>
    apiClient.get<CropBatch>(`/harvest/batches/${id}`),
  createBatch: (data: CreateBatchRequest) =>
    apiClient.post<CropBatch>('/harvest/batches', data),
  updateBatch: (id: string, data: Partial<CreateBatchRequest> & { stage?: string }) =>
    apiClient.put<CropBatch>(`/harvest/batches/${id}`, data),
  completeBatch: (id: string) =>
    apiClient.put<CropBatch>(`/harvest/batches/${id}/complete`),
  cloneBatch: (id: string, houseName: string) =>
    apiClient.post<CropBatch>(`/harvest/batches/${id}/clone`, { houseName }),
  deleteBatch: (id: string) =>
    apiClient.delete(`/harvest/batches/${id}`),
}
