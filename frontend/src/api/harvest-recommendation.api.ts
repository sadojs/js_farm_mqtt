import apiClient from './client'

export interface RecommendationCard {
  taskType: string
  taskName: string
  icon: string
  priorityScore: number
  riskScore: number
  delayRatio: number
  daysSinceLast: number | null
  recommendedWindowStart: string
  recommendedWindowEnd: string
  status: 'NORMAL' | 'UPCOMING' | 'DELAYED' | 'URGENT'
  reasons: string[]
  effectRemaining: number | null
  lastCompletedAt: string | null
}

export interface RecommendationsResponse {
  summary: {
    status: 'good' | 'caution' | 'warning'
    statusLabel: string
    mainReason: string
    subInfo: string
  }
  cards: RecommendationCard[]
  environment: {
    temperature: number | null
    humidity: number | null
    dewPoint: number | null
    vpdValue: number | null
    vpdStatus: string | null
    condensationLevel: string | null
    highHumidityHours: number
  }
  activeBatch: {
    id: string
    cropName: string
    variety: string | null
    currentStage: string
    sowDate: string
    transplantDate: string | null
    growDays: number
    groupId: string | null
    memo: string | null
    status: string
  } | null
}

export const harvestRecApi = {
  getRecommendations: () =>
    apiClient.get<RecommendationsResponse>('/harvest-rec/recommendations'),

  createTaskLog: (batchId: string, taskType: string) =>
    apiClient.post('/harvest-rec/task-logs', { batchId, taskType }),

  getTaskLogs: (batchId?: string) =>
    apiClient.get('/harvest-rec/task-logs', { params: { batchId } }),
}
