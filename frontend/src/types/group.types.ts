import type { Device } from './device.types'

export interface HouseGroup {
  id: string
  userId: string
  name: string
  description?: string
  manager?: string
  enableGroupControl: boolean
  enableAutomation: boolean
  houses: House[]
  devices: Device[]
  createdAt: string
  updatedAt: string
}

export interface House {
  id: string
  userId: string
  groupId?: string
  name: string
  location?: string
  description?: string
  area?: number
  status: 'active' | 'inactive'
  createdAt: string
  updatedAt: string
}

export interface CreateGroupRequest {
  name: string
  description?: string
  manager?: string
}

export interface CreateHouseRequest {
  groupId: string
  name: string
  location?: string
  description?: string
  area?: number
}

export interface GroupDependenciesResponse {
  canDelete: boolean
  automationRules: { id: string; name: string; enabled: boolean }[]
}
