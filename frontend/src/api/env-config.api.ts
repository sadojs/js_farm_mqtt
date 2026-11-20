import apiClient from './client'

export interface EnvRole {
  id: string
  roleKey: string
  label: string
  category: 'internal' | 'external'
  unit: string
  sortOrder: number
  isDefault: boolean
}

export interface EnvMapping {
  id: string
  groupId: string
  roleKey: string
  sourceType: 'sensor' | 'weather'
  deviceId: string | null
  sensorType: string | null
  weatherField: string | null
}

export interface SensorSource {
  deviceId: string
  deviceName: string
  sensorType: string
  label: string
  currentValue: number | null
  unit: string
}

export interface WeatherSource {
  field: string
  label: string
  currentValue: number | null
  unit: string
}

export interface SourcesResponse {
  sensors: SensorSource[]
  weather: WeatherSource[]
}

export interface SaveMappingItem {
  roleKey: string
  sourceType: 'sensor' | 'weather'
  deviceId?: string
  sensorType?: string
  weatherField?: string
}

export interface ResolvedValue {
  value: number | null
  unit: string
  label: string
  category: string
  source: string
  updatedAt: string | null
}

export interface ZoneDeviceSettings {
  gateways: Array<{ id: string; gatewayId: string; name: string }>
  settings: {
    openerOperationSeconds: number
    openerStandbySeconds: number
    fanOperationMinutes: number
    fanStandbyMinutes: number
    hasRainSensor: boolean
    rainEnabled: boolean
    highTempOverrideEnabled: boolean
    highTempOpenThreshold: number | null
  } | null
}

export interface SaveZoneDeviceSettings {
  openerOperationSeconds?: number
  openerStandbySeconds?: number
  fanOperationMinutes?: number
  fanStandbyMinutes?: number
  rainEnabled?: boolean
  highTempOverrideEnabled?: boolean
  highTempOpenThreshold?: number | null
}

export const envConfigApi = {
  getRoles: () =>
    apiClient.get<EnvRole[]>('/env-config/roles'),

  getDeviceSettings: (groupId: string) =>
    apiClient.get<ZoneDeviceSettings>(`/env-config/groups/${groupId}/device-settings`),

  saveDeviceSettings: (groupId: string, dto: SaveZoneDeviceSettings) =>
    apiClient.patch<ZoneDeviceSettings>(`/env-config/groups/${groupId}/device-settings`, dto),

  getSources: (groupId: string) =>
    apiClient.get<SourcesResponse>(`/env-config/groups/${groupId}/sources`),

  getMappings: (groupId: string) =>
    apiClient.get<EnvMapping[]>(`/env-config/groups/${groupId}/mappings`),

  saveMappings: (groupId: string, mappings: SaveMappingItem[]) =>
    apiClient.put<EnvMapping[]>(`/env-config/groups/${groupId}/mappings`, { mappings }),

  getResolved: (groupId: string) =>
    apiClient.get<Record<string, ResolvedValue>>(`/env-config/groups/${groupId}/resolved`),
}

// ── 환경 경보 (내부 온도·습도 높음, 토양 수분 낮음 — 지속 시간 기본 5분) ──
export interface EnvAlertItem {
  key: 'temp_high' | 'humidity_high' | 'soil_low'
  enabled: boolean
  threshold: number
  minutes: number
  label?: string
  unit?: string
  dir?: 'high' | 'low'
}
export interface EnvAlertSettings {
  groupId: string
  saved: boolean
  channel: 'push' | 'center'
  items: EnvAlertItem[]
}
export const envAlertsApi = {
  get: (groupId: string) => apiClient.get<EnvAlertSettings>(`/env-alerts/groups/${groupId}`),
  save: (groupId: string, body: { items: EnvAlertItem[]; channel: 'push' | 'center' }) =>
    apiClient.put<EnvAlertSettings>(`/env-alerts/groups/${groupId}`, body),
}
