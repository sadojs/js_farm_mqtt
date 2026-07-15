import apiClient from './client'
import type { HouseGroup, House, CreateGroupRequest, CreateHouseRequest, GroupDependenciesResponse, HouseGroupWithOwner, FarmAdmin, IotRelatedCounts } from '../types/group.types'

export const groupApi = {
  getGroups: (opts?: { iotOnly?: boolean }) =>
    apiClient.get<HouseGroup[]>('/groups', {
      params: opts?.iotOnly ? { iotOnly: 'true' } : {},
    }),

  bulkUpdateIotEnabled: (updates: Array<{ id: string; enabled: boolean }>) =>
    apiClient.patch<{ updated: number }>('/groups/houses/iot-enabled', { updates }),

  getIotRelatedCounts: (ids: string[]) =>
    apiClient.get<IotRelatedCounts>('/groups/houses/iot-related-counts', {
      params: ids.length ? { ids: ids.join(',') } : {},
    }),

  createGroup: (data: CreateGroupRequest) =>
    apiClient.post<HouseGroup>('/groups', data),

  updateGroup: (id: string, data: Partial<CreateGroupRequest>) =>
    apiClient.put<HouseGroup>(`/groups/${id}`, data),

  /** 구역 표시 순서 배치 저장 (드래그 정렬) */
  reorder: (orders: { id: string; displayOrder: number }[]) =>
    apiClient.patch<{ updated: number }>('/groups/reorder', { orders }),

  removeGroup: (id: string) =>
    apiClient.delete(`/groups/${id}`),

  controlGroup: (id: string, commands: { code: string; value: any }[]) =>
    apiClient.post(`/groups/${id}/control`, { commands }),

  getHouses: () =>
    apiClient.get<House[]>('/groups/houses'),

  createHouse: (data: CreateHouseRequest) =>
    apiClient.post<House>('/groups/houses', data),

  updateHouse: (id: string, data: Partial<CreateHouseRequest>) =>
    apiClient.put<House>(`/groups/houses/${id}`, data),

  removeHouse: (id: string) =>
    apiClient.delete(`/groups/houses/${id}`),

  assignGateway: (groupId: string, gatewayId: string) =>
    apiClient.post<HouseGroup>(`/groups/${groupId}/gateway`, { gatewayId }),

  assignDevices: (groupId: string, deviceIds: string[]) =>
    apiClient.post<HouseGroup>(`/groups/${groupId}/devices`, { deviceIds }),

  removeDeviceFromGroup: (groupId: string, deviceId: string) =>
    apiClient.delete(`/groups/${groupId}/devices/${deviceId}`),

  getDependencies: (id: string) =>
    apiClient.get<GroupDependenciesResponse>(`/groups/${id}/dependencies`),

  // admin 전용
  adminGetAllGroups: () =>
    apiClient.get<HouseGroupWithOwner[]>('/groups'),

  adminCreateGroup: (data: { name: string; targetUserId: string; description?: string }) =>
    apiClient.post<HouseGroup>('/groups', data),

  adminCreateHouse: (data: { name: string; groupId: string; targetUserId: string; location?: string }) =>
    apiClient.post<House>('/groups/houses', data),

  adminRemoveHouse: (id: string) =>
    apiClient.delete(`/groups/houses/${id}`),

  adminUpdateHouse: (id: string, data: Partial<CreateHouseRequest>) =>
    apiClient.put<House>(`/groups/houses/${id}`, data),

  getFarmAdmins: () =>
    apiClient.get<FarmAdmin[]>('/users/farm-admins'),
}
