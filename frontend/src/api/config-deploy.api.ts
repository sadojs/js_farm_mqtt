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

// ---- MQTT 기반 원격 설정 (rpi-golden-image-system) ----

export type ConfigAction =
  | 'get_config' | 'update_config'
  | 'wifi_update' | 'hostname_update' | 'gateway_id_update' | 'identity_update' | 'server_ip_update'

export type RemoteConfigStatus =
  | 'pending'
  | 'success'
  | 'applied_online'
  | 'applied_no_internet'
  | 'rolled_back'
  | 'failed'

export interface RemoteConfigAccepted {
  requestId: string
  action: ConfigAction
  status: 'pending'
  publishedAt: string
}

export interface RemoteConfigResponseEvent {
  gatewayId: string
  requestId: string
  action: ConfigAction
  success: boolean
  status: RemoteConfigStatus
  detail?: string
  pingResult?: { tried: number; ok: number }
  appliedAt: string
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

  // ---- 원격 시스템 설정 4종 ----

  updateWifi: (gatewayId: string, ssid: string, password: string) =>
    apiClient.post<RemoteConfigAccepted>(
      `/config-deploy/${gatewayId}/wifi`,
      { ssid, password },
    ),

  updateHostname: (gatewayId: string, hostname: string) =>
    apiClient.post<RemoteConfigAccepted>(
      `/config-deploy/${gatewayId}/hostname`,
      { hostname },
    ),

  updateGatewayId: (gatewayId: string, newGatewayId: string) =>
    apiClient.post<RemoteConfigAccepted>(
      `/config-deploy/${gatewayId}/gateway-id`,
      { newGatewayId },
    ),

  /**
   * rpi-hostname-gateway-id-unify
   * hostname + gateway-id 통합 배포 — 두 값을 같은 값으로 한 번에 변경.
   * 양산 시나리오에서 분리 배포로 인한 mismatch 방지.
   */
  updateIdentity: (gatewayId: string, name: string) =>
    apiClient.post<RemoteConfigAccepted>(
      `/config-deploy/${gatewayId}/identity`,
      { name },
    ),

  updateServerIp: (gatewayId: string, newServerIp: string) =>
    apiClient.post<RemoteConfigAccepted>(
      `/config-deploy/${gatewayId}/server-ip`,
      { newServerIp },
    ),
}
