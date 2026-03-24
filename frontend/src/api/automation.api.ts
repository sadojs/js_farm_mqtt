import apiClient from './client'
import type { AutomationRule, CreateRuleRequest, AutomationLog } from '../types/automation.types'

export const automationApi = {
  getRules: () =>
    apiClient.get<AutomationRule[]>('/automation/rules'),

  createRule: (data: CreateRuleRequest) =>
    apiClient.post<AutomationRule>('/automation/rules', data),

  updateRule: (id: string, data: Partial<CreateRuleRequest>) =>
    apiClient.put<AutomationRule>(`/automation/rules/${id}`, data),

  toggleRule: (id: string) =>
    apiClient.patch(`/automation/rules/${id}/toggle`),

  removeRule: (id: string) =>
    apiClient.delete(`/automation/rules/${id}`),

  getLogs: (params?: { ruleId?: string; page?: number; limit?: number }) =>
    apiClient.get<AutomationLog[]>('/automation/logs', { params }),
}
