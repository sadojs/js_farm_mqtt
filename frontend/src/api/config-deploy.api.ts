import apiClient from './client'

export interface CommonConfig {
  homeassistant?: boolean
  frontend?: { port?: number; host?: string }
  advanced?: {
    log_level?: string
    channel?: number
    last_seen?: string
    legacy_api?: boolean
    legacy_availability_payload?: boolean
    log_output?: string[]
  }
  availability?: {
    active?: { timeout: number }
    passive?: { timeout: number }
  }
  ota?: {
    disable_automatic_update_check?: boolean
  }
}

export interface DeployResult {
  gatewayId: string
  gatewayName: string
  success: boolean
  error?: string
  changedFields?: string[]
  serviceRestarted?: boolean
  duration: number
}

export interface PreviewResult {
  gatewayId: string
  gatewayName: string
  status: 'online' | 'offline' | 'no-agent'
  currentConfig?: Record<string, any>
  diff?: { field: string; oldValue: any; newValue: any; protected: boolean }[]
}

export const configDeployApi = {
  getTemplate: () =>
    apiClient.get<CommonConfig>('/config-deploy/template'),

  updateTemplate: (config: CommonConfig) =>
    apiClient.put<CommonConfig>('/config-deploy/template', config),

  getGatewayConfig: (gatewayId: string) =>
    apiClient.get<Record<string, any>>(`/config-deploy/gateways/${gatewayId}/config`),

  preview: (gatewayIds: string[], config: Record<string, any>) =>
    apiClient.post<PreviewResult[]>('/config-deploy/preview', { gatewayIds, config }),

  deploy: (gatewayIds: string[], config: Record<string, any>) =>
    apiClient.post<DeployResult[]>('/config-deploy/deploy', { gatewayIds, config }),
}
