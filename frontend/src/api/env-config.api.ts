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

export const envConfigApi = {
  getRoles: () =>
    apiClient.get<EnvRole[]>('/env-config/roles'),

  getSources: (groupId: string) =>
    apiClient.get<SourcesResponse>(`/env-config/groups/${groupId}/sources`),

  getMappings: (groupId: string) =>
    apiClient.get<EnvMapping[]>(`/env-config/groups/${groupId}/mappings`),

  saveMappings: (groupId: string, mappings: SaveMappingItem[]) =>
    apiClient.put<EnvMapping[]>(`/env-config/groups/${groupId}/mappings`, { mappings }),

  getResolved: (groupId: string) =>
    apiClient.get<Record<string, ResolvedValue>>(`/env-config/groups/${groupId}/resolved`),
}
