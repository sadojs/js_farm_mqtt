import apiClient from './client'

export interface TaskTemplate {
  id: string
  userId: string
  taskName: string
  cropType: string
  stageName: string | null
  intervalDays: number
  intervalMinDays: number | null
  intervalMaxDays: number | null
  startOffsetDays: number
  defaultRescheduleMode: 'anchor' | 'shift' | 'one_time'
  isPreset: boolean
  createdAt: string
  updatedAt: string
}

export interface OccurrenceWithContext {
  id: string
  scheduledDate: string
  windowEndDate: string | null
  status: 'planned' | 'done' | 'skipped'
  doneDate: string | null
  growthFeedback: string | null
  memo: string | null
  taskName: string
  intervalDays: number
  intervalMinDays: number | null
  intervalMaxDays: number | null
  stageName: string | null
  batchId: string
  cropName: string
  variety: string | null
  houseName: string
  houseId: string | null
  groupId: string | null
  groupName: string | null
  currentStage: string
  batchTaskId: string
  rescheduleMode: string
}

export interface TaskSummary {
  todayTasks: { id: string; scheduledDate: string; taskName: string; status: string; windowEndDate: string | null }[]
  upcoming: { id: string; scheduledDate: string; taskName: string; windowEndDate: string | null }[]
}

export const harvestTaskApi = {
  // 템플릿
  getTemplates: () =>
    apiClient.get<TaskTemplate[]>('/harvest/templates'),
  createTemplate: (data: {
    taskName: string; intervalDays: number; startOffsetDays: number;
    cropType?: string; stageName?: string;
    intervalMinDays?: number; intervalMaxDays?: number;
    defaultRescheduleMode?: string
  }) =>
    apiClient.post<TaskTemplate>('/harvest/templates', data),
  updateTemplate: (id: string, data: Partial<{
    taskName: string; intervalDays: number; startOffsetDays: number;
    cropType: string; stageName: string;
    intervalMinDays: number; intervalMaxDays: number;
    defaultRescheduleMode: string
  }>) =>
    apiClient.put<TaskTemplate>(`/harvest/templates/${id}`, data),
  deleteTemplate: (id: string) =>
    apiClient.delete(`/harvest/templates/${id}`),

  // 작업 요약
  getTaskSummary: (batchId: string) =>
    apiClient.get<TaskSummary>(`/harvest/batches/${batchId}/task-summary`),

  // 배치-템플릿
  applyTemplate: (batchId: string, templateId: string) =>
    apiClient.post(`/harvest/batches/${batchId}/apply-template`, { templateId }),
  applyStageTemplates: (batchId: string, stage: string) =>
    apiClient.put(`/harvest/batches/${batchId}/stage`, { stage }),
  removeTemplateFromBatch: (batchId: string, batchTaskId: string) =>
    apiClient.delete(`/harvest/batches/${batchId}/tasks/${batchTaskId}`),

  // Occurrence
  getOccurrences: (params: { startDate: string; endDate: string; groupId?: string; houseId?: string; batchId?: string }) =>
    apiClient.get<OccurrenceWithContext[]>('/harvest/occurrences', { params }),
  completeOccurrence: (id: string, data: {
    rescheduleMode: string; rememberChoice?: boolean; memo?: string; growthFeedback?: string
  }) =>
    apiClient.put(`/harvest/occurrences/${id}/complete`, data),
  postponeOccurrence: (id: string) =>
    apiClient.put(`/harvest/occurrences/${id}/postpone`),
  skipOccurrence: (id: string) =>
    apiClient.put(`/harvest/occurrences/${id}/skip`),
}
