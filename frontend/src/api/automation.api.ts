import apiClient from './client'
import type { AutomationRule, CreateRuleRequest, AutomationLog, AutomationLogStats } from '../types/automation.types'

export interface ControlStatusRow {
  source: string
  label: string
  state: 'win' | 'lose' | 'idle' | 'na'
  detail: string
  want?: string
}
export interface ControlStatus {
  deviceId: string
  deviceName: string
  deviceClass: 'opener' | 'fan' | 'irrigation' | 'other'
  lock: { active: boolean; label: string } | null
  winner: { source: string; label: string; detail: string } | null
  manual: { active: boolean; until: string | null; releasable: boolean }
  ladder: ControlStatusRow[]
  checkedAt: string
}

export const automationApi = {
  /** 장치 제어 현황 — 지금 누가 이 장치를 움직이는지 */
  getControlStatus: (deviceId: string) =>
    apiClient.get<ControlStatus>(`/automation/control-status/${deviceId}`),

  getRules: () =>
    apiClient.get<AutomationRule[]>('/automation/rules'),

  createRule: (data: CreateRuleRequest) =>
    apiClient.post<AutomationRule>('/automation/rules', data),

  updateRule: (id: string, data: Partial<CreateRuleRequest>) =>
    apiClient.put<AutomationRule>(`/automation/rules/${id}`, data),

  /** 자동제어룰 표시 순서 배치 저장 (드래그 정렬) */
  reorderRules: (orders: { id: string; displayOrder: number }[]) =>
    apiClient.patch<{ updated: number }>('/automation/rules/reorder', { orders }),

  toggleRule: (id: string, params?: string, body?: { disableRuleIds?: string[] }) =>
    apiClient.patch(`/automation/rules/${id}/toggle${params || ''}`, body ?? {}),

  /** 저장·켜기 전 충돌 확인 */
  checkConflicts: (data: { ruleId?: string; groupId?: string; conditions: any; actions: any }) =>
    apiClient.post<{ conflicts: import('../utils/ruleConflicts').SaveConflict[] }>('/automation/rules/check-conflicts', data),

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

  // 개폐기 수동 제어 진입 — 해당 개폐기(페어 포함) 제어 중인 활성 룰 조회/정지
  getActiveRulesForDevice: (deviceId: string) =>
    apiClient.get<{ id: string; name: string }[]>(`/automation/device/${deviceId}/active-rules`),

  stopActiveRulesForDevice: (deviceId: string) =>
    apiClient.post<{ stopped: { id: string; name: string }[] }>(
      `/automation/device/${deviceId}/stop-rules`, {}
    ),

  // 일괄제어 — 여러 장치 대상 룰 일괄 조회/정지 + 원복
  getActiveRulesForDevices: (deviceIds: string[]) =>
    apiClient.post<{ id: string; name: string }[]>(`/automation/devices/active-rules`, { deviceIds }),

  stopActiveRulesForDevices: (deviceIds: string[]) =>
    apiClient.post<{ stopped: { id: string; name: string }[] }>(`/automation/devices/stop-rules`, { deviceIds }),

  getBulkStoppedRules: () =>
    apiClient.get<{ id: string; name: string }[]>(`/automation/bulk-stopped-rules`),

  restoreBulkStoppedRules: (ruleIds?: string[]) =>
    apiClient.post<{ restored: { id: string; name: string }[] }>(`/automation/rules/restore`, ruleIds ? { ruleIds } : {}),

  // 룰 충돌(같은 장치를 반대로 제어) — 목록 / 해소(밀린 룰 비활성화 · 그대로 두기)
  getConflicts: () =>
    apiClient.get<import('../composables/useWebSocket').RuleConflictPayload[]>('/automation/conflicts'),

  resolveConflict: (id: string, action: 'disable_loser' | 'dismiss') =>
    apiClient.post<{ resolved: boolean; disabledRule?: { id: string; name: string } | null }>(
      '/automation/conflicts/resolve', { id, action }),
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
