import apiClient from './client'
import type { AutomationRule, CreateRuleRequest, AutomationLog, AutomationLogStats } from '../types/automation.types'

export const automationApi = {
  getRules: () =>
    apiClient.get<AutomationRule[]>('/automation/rules'),

  createRule: (data: CreateRuleRequest) =>
    apiClient.post<AutomationRule>('/automation/rules', data),

  updateRule: (id: string, data: Partial<CreateRuleRequest>) =>
    apiClient.put<AutomationRule>(`/automation/rules/${id}`, data),

  toggleRule: (id: string, params?: string) =>
    apiClient.patch(`/automation/rules/${id}/toggle${params || ''}`),

  removeRule: (id: string) =>
    apiClient.delete(`/automation/rules/${id}`),

  getLogs: (params?: { ruleId?: string; page?: number; limit?: number }) =>
    apiClient.get<AutomationLog[]>('/automation/logs', { params }),

  getLogStats: () =>
    apiClient.get<AutomationLogStats>('/automation/logs/stats'),

  getIrrigationStatus: () =>
    apiClient.get<IrrigationDeviceStatus[]>('/automation/irrigation/status'),

  bulkDisableByDevice: (deviceId: string) =>
    apiClient.post<{ disabledCount: number; stoppedIrrigation: boolean }>(
      '/automation/rules/bulk-disable', { deviceId }
    ),
}

export interface IrrigationRuleSummary {
  ruleId: string
  ruleName: string
  startTime: string | null
  enabledZones: number
  totalZones: number
  days: number[]
  repeat: boolean
}

export interface IrrigationDeviceStatus {
  deviceId: string
  deviceName: string
  groupId: string | null
  groupName: string | null
  tuyaDeviceId: string
  enabledRuleCount: number
  totalRuleCount: number
  isRunning: boolean
  runningRule?: {
    ruleId: string
    ruleName: string
    startedAt: number
    estimatedEndAt: number
  }
  ruleSummaries: IrrigationRuleSummary[]
}
