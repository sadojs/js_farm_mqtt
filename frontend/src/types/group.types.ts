import type { Device } from './device.types'

export interface HouseGroup {
  id: string
  userId: string
  name: string
  description?: string
  manager?: string
  enableGroupControl: boolean
  enableAutomation: boolean
  iotEnabled: boolean
  /** 구역 표시 순서 (구역표시 설정 드래그 정렬) */
  displayOrder?: number
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
  iotEnabled: boolean
  createdAt: string
  updatedAt: string
}

export interface IotRelatedCounts {
  totals: { device: number; rule: number; gateway: number }
  perHouse: Array<{
    id: string
    name: string
    device: number
    rule: number
    gateway: number
  }>
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

export interface HouseGroupWithOwner extends HouseGroup {
  ownerName?: string
  ownerUsername?: string
  /** 구역을 소유한 농장의 이름 (관리자 전체 조회) */
  ownerFarmName?: string
}

export interface FarmAdmin {
  id: string
  username: string
  /** 농장 관리자(사람) 이름 */
  name: string
  /** 농장 이름 (migration 051 — 비어 있으면 name 으로 표시) */
  farmName?: string | null
  status: string
}
