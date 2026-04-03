import apiClient from './client'

export interface ActivityLogEntry {
  id: string
  userId: string
  userName: string
  groupId: string | null
  groupName: string | null
  action: string
  targetType: string
  targetId: string | null
  targetName: string | null
  details: Record<string, any> | null
  createdAt: string
}

export const activityLogApi = {
  async getLogs(params: {
    groupId?: string; action?: string; targetType?: string;
    page?: number; limit?: number
  } = {}): Promise<{ data: ActivityLogEntry[]; total: number }> {
    const { data } = await apiClient.get('/activity-logs', { params })
    return data
  },
}
