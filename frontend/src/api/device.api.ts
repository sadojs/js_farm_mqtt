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

  // Zigbee 다채널 컨트롤러 child의 channel_code 변경
  updateChannelCode: (id: string, channelCode: string) =>
    apiClient.patch(`/devices/${id}/channel-code`, { channelCode }),

  // 우적센서 rain-override 비활성화 토글 (오탐 방지)
  updateRainOverrideDisabled: (id: string, disabled: boolean) =>
    apiClient.patch(`/devices/${id}/rain-override-disabled`, { disabled }),

  // ── device-replacement (Hot Swap) ───────────────────────────────
  /** 교체 전 영향 분석: 보존될 룰/매핑/페어/children 카운트 + 호환 조건 */
  replacePreview: (id: string) =>
    apiClient.get<{
      device: {
        id: string
        name: string
        equipmentType: string | null
        zigbeeModel: string | null
        zigbeeIeee: string | null
        friendlyName: string | null
        source: string | null
        parentDeviceId: string | null
        houseId: string | null
      }
      impact: {
        rulesCount: number
        ruleNames: string[]
        mappingKeys: number
        pairedDeviceId: string | null
        pairedDeviceName: string | null
        childrenCount: number
        hasRunningTimeline: boolean
      }
      compatibility: {
        requireModel: string | null
        requireEquipmentType: string | null
        requireChannelCount: 8 | 12 | null
        requirePair: boolean
        requireChildrenCount: number | null
      }
    }>(`/devices/${id}/replace-preview`),

  /** 실제 교체 실행: devices.id 유지하고 IEEE/friendly_name swap */
  replace: (id: string, data: {
    newIeee: string
    newFriendlyName: string
    newZigbeeModel?: string
    pairedNewIeee?: string
    pairedNewFriendlyName?: string
    forceStopRunningTimeline?: boolean
  }) =>
    apiClient.post<{
      success: boolean
      noop?: boolean
      deviceId: string
      oldIeee: string
      newIeee: string
      pairedDeviceId: string | null
      preserved: { rules: number; mappingKeys: number; childrenCount: number }
    }>(`/devices/${id}/replace`, data),
}
