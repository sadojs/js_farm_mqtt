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

  /** 구역관리 카드 순서 배치 저장 (드래그 정렬 확정 시 1회) */
  reorder: (orders: { id: string; displayOrder: number }[]) =>
    apiClient.patch<{ updated: number }>('/devices/reorder', { orders }),

  remove: (id: string) =>
    apiClient.delete(`/devices/${id}`),

  control: (id: string, commands: { code: string; value: any }[]) =>
    apiClient.post(`/devices/${id}/control`, { commands }),

  /** 임시 타이머 설정 — 설정 시간 동안 강제 상태 유지, 만료 시 자동제어 복귀.
   *  팬: {value,durationMinutes} / 개폐기: {direction,durationMinutes} / 관수: {channelKey:'zone_N',durationMinutes} */
  setTimer: (
    id: string,
    body: { channelKey?: string; direction?: 'open' | 'close'; value?: boolean; durationMinutes: number },
  ) => apiClient.post<{ ok: boolean; until: string; channelKey?: string; direction?: string; value?: boolean }>(
    `/devices/${id}/timer`, body,
  ),

  /** 임시 타이머 해제 — 즉시 자동제어 복귀. 관수는 {channelKey}로 채널별 해제. */
  cancelTimer: (id: string, body?: { channelKey?: string }) =>
    apiClient.post<{ ok: boolean }>(`/devices/${id}/timer/cancel`, body ?? {}),

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
    /** 새 device가 갖는 채널 수 (1/8/12) — 채널 증설 허용 검증용 */
    newChannelCount?: 1 | 8 | 12
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
