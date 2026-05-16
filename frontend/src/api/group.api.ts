import apiClient from './client'
import type { HouseGroup, House, CreateGroupRequest, CreateHouseRequest, GroupDependenciesResponse, HouseGroupWithOwner, FarmAdmin } from '../types/group.types'

export const groupApi = {
  getGroups: () =>
    apiClient.get<HouseGroup[]>('/groups'),

  createGroup: (data: CreateGroupRequest) =>
    apiClient.post<HouseGroup>('/groups', data),

  updateGroup: (id: string, data: Partial<CreateGroupRequest>) =>
    apiClient.put<HouseGroup>(`/groups/${id}`, data),

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
