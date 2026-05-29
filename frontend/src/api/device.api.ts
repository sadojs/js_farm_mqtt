import apiClient from './client'
import type { Device, DeviceDependenciesResponse, RegisterDeviceRequest, ChannelMapping } from '../types/device.types'

export const deviceApi = {
  getAll: () =>
    apiClient.get<Device[]>('/devices'),

  getById: (id: string) =>
    apiClient.get<Device>(`/devices/${id}`),

  register: (devices: RegisterDeviceRequest['devices'], houseId?: string) =>
    apiClient.post<Device[]>('/devices/register', { devices, ...(houseId && { houseId }) }),

  update: (id: string, data: Partial<Device>) =>
    apiClient.put<Device>(`/devices/${id}`, data),

  remove: (id: string) =>
    apiClient.delete(`/devices/${id}`),

  control: (id: string, commands: { code: string; value: any }[]) =>
    apiClient.post(`/devices/${id}/control`, { commands }),

  getStatus: (id: string) =>
    apiClient.get(`/devices/${id}/status`),

  getSensorChannels: (id: string) =>
    apiClient.get<Array<{ field: string; lastValue: number | null; unit: string; updatedAt: string }>>(
      `/devices/${id}/sensor-channels`,
    ),

  getDependencies: (id: string) =>
    apiClient.get<DeviceDependenciesResponse>(`/devices/${id}/dependencies`),

  removeOpenerPair: (id: string) =>
    apiClient.delete<{ message: string; deletedIds: string[] }>(`/devices/${id}/opener-pair`),

  rename: (id: string, name: string) =>
    apiClient.patch<{ id: string; name: string }>(`/devices/${id}/name`, { name }),

  updateChannelMapping: (id: string, mapping: ChannelMapping) =>
    apiClient.patch(`/devices/${id}/channel-mapping`, { mapping }),

  // 채널 활성/비활성 토글 — 매핑은 보존, deviceSettings.disabledChannels만 갱신
  updateChannelEnabled: (id: string, key: string, enabled: boolean) =>
    apiClient.patch(`/devices/${id}/channel-enabled`, { key, enabled }),
}
