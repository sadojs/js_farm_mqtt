import apiClient from './client'

export interface AutomationLogEntry {
  id: string
  ruleId: string
  ruleName?: string
  executedAt: string
  success: boolean
  conditionsMet: Record<string, any>
  actionsExecuted: Record<string, any>
  errorMessage?: string | null
}

export interface AutomationLogStats {
  todayCount: number
  successRate: number
  mostActiveRule: string | null
}

export const automationLogApi = {
  async getLogs(params: { page?: number; limit?: number; ruleId?: string } = {}): Promise<{ data: AutomationLogEntry[]; total: number }> {
    const { data } = await apiClient.get('/automation/logs', { params })
    return data
  },

  async getStats(): Promise<AutomationLogStats> {
    try {
      const { data } = await apiClient.get('/automation/logs/stats')
      return data
    } catch {
      return { todayCount: 0, successRate: 0, mostActiveRule: null }
    }
  },
}
