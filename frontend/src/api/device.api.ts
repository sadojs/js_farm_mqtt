import apiClient from './client'
import type { Device, DeviceDependenciesResponse, RegisterDeviceRequest, TuyaDeviceInfo } from '../types/device.types'

export const deviceApi = {
  getAll: () =>
    apiClient.get<Device[]>('/devices'),

  getById: (id: string) =>
    apiClient.get<Device>(`/devices/${id}`),

  getTuyaDevices: () =>
    apiClient.get<TuyaDeviceInfo[]>('/devices/tuya/list'),

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

  getDependencies: (id: string) =>
    apiClient.get<DeviceDependenciesResponse>(`/devices/${id}/dependencies`),

  removeOpenerPair: (id: string) =>
    apiClient.delete<{ message: string; deletedIds: string[] }>(`/devices/${id}/opener-pair`),
}
