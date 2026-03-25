import apiClient from './client'
import type { Gateway, ZigbeeDeviceInfo } from '../types/device.types'

export const gatewayApi = {
  getAll: () =>
    apiClient.get<Gateway[]>('/gateways'),

  create: (data: { gatewayId: string; name: string; location?: string; rpiIp?: string }) =>
    apiClient.post<Gateway>('/gateways', data),

  update: (id: string, data: { name?: string; location?: string; rpiIp?: string }) =>
    apiClient.put<Gateway>(`/gateways/${id}`, data),

  remove: (id: string) =>
    apiClient.delete(`/gateways/${id}`),

  /** 특정 게이트웨이에 페어링된 Zigbee 장비 목록 */
  getZigbeeDevices: (id: string) =>
    apiClient.get<ZigbeeDeviceInfo[]>(`/gateways/${id}/zigbee-devices`),

  /** 페어링 모드 ON/OFF */
  permitJoin: (id: string, enable: boolean) =>
    apiClient.post(`/gateways/${id}/permit-join`, { enable }),
}
