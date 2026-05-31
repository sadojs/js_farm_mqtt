import apiClient from './client'

export interface OnboardDevice {
  id: string
  gatewayId: string
  slotKey: string
  slotType: string
  pairKey: string | null
  name: string
  enabled: boolean
  sortOrder: number
  operationTime: number | null
  standbyTime: number | null
  gpioPin: number | null
}

export interface ZigbeeDevice {
  id: string
  zigbeeIeee: string
  friendlyName: string
  zigbeeModel: string
  name: string
  category: string
  deviceType: 'sensor' | 'actuator'
  equipmentType: string
  icon?: string
  houseId?: string
  online: boolean
  enabled: boolean
  channelMapping?: Record<string, string>
  deviceSettings?: Record<string, any>
  source: 'zigbee' | 'onboard'
  pairedDeviceId?: string
  openerGroupName?: string
  /** parent device.id (zigbee multi-channel controller child) */
  parentDeviceId?: string | null
  /** child의 z2m payload 키 (switch_1~switch_12) */
  channelCode?: string | null
}

export interface ZigbeeScannedDevice {
  ieee_address: string
  friendly_name: string
  model_id?: string
  definition?: { description?: string }
  /**
   * Backend가 exposes의 state_lN 또는 모델명에서 추론한 채널 수.
   * 1 = 단일 채널, 8/12 = 다채널 컨트롤러, null = 미감지(센서 등)
   */
  detectedChannelCount?: 1 | 8 | 12 | null
}

export interface AllDevicesResponse {
  onboard: OnboardDevice[]
  zigbee: ZigbeeDevice[]
  irrigationDevice: ZigbeeDevice | null
}

export const gatewayEnvApi = {
  // 통합 조회 (온보드 + 지그비)
  getAllDevices: (gatewayId: string) =>
    apiClient.get<AllDevicesResponse>(`/gateway-env/${gatewayId}/all-devices`),

  // Onboard (flat list, no opener pairs in onboard anymore)
  getOnboard: (gatewayId: string) =>
    apiClient.get<OnboardDevice[]>(`/gateway-env/${gatewayId}/onboard`),

  createOnboard: (gatewayId: string, data: { type: 'fan' | 'irrigation' | 'vent'; name: string; channels?: 8 | 12 }) =>
    apiClient.post<OnboardDevice[]>(`/gateway-env/${gatewayId}/onboard`, data),

  updateOnboard: (gatewayId: string, deviceId: string, data: { name?: string; enabled?: boolean; operationTime?: number; standbyTime?: number; gpioPin?: number | null }) =>
    apiClient.patch<OnboardDevice>(`/gateway-env/${gatewayId}/onboard/${deviceId}`, data),

  deleteOnboard: (gatewayId: string, deviceId: string) =>
    apiClient.delete(`/gateway-env/${gatewayId}/onboard/${deviceId}`),

  // Zigbee
  getZigbee: (gatewayId: string) =>
    apiClient.get<ZigbeeDevice[]>(`/gateway-env/${gatewayId}/zigbee`),

  scanZigbee: (gatewayId: string) =>
    apiClient.get<ZigbeeScannedDevice[]>(`/gateway-env/${gatewayId}/zigbee/scan`),

  addZigbee: (gatewayId: string, data: Partial<ZigbeeDevice> & { pairedDeviceId?: string; openerGroupName?: string }) =>
    apiClient.post<ZigbeeDevice>(`/gateway-env/${gatewayId}/zigbee`, data),

  /** 8/12채널 컨트롤러를 관수/유동팬/개폐기로 일괄 등록 */
  addZigbeeController: (gatewayId: string, data: {
    ieee: string; friendlyName: string; zigbeeModel: string;
    channelCount: 8 | 12; mode: 'irrigation' | 'fan' | 'opener';
  }) =>
    apiClient.post<{ controller: ZigbeeDevice; children: ZigbeeDevice[] }>(
      `/gateway-env/${gatewayId}/zigbee-controller`, data,
    ),

  updateZigbee: (gatewayId: string, deviceId: string, data: { name?: string; houseId?: string; channelMapping?: Record<string, string>; deviceSettings?: Record<string, any>; enabled?: boolean }) =>
    apiClient.patch<ZigbeeDevice>(`/gateway-env/${gatewayId}/zigbee/${deviceId}`, data),

  removeZigbee: (gatewayId: string, deviceId: string) =>
    apiClient.delete(`/gateway-env/${gatewayId}/zigbee/${deviceId}`),

  updateIrrigationName: (gatewayId: string, name: string) =>
    apiClient.patch<ZigbeeDevice>(`/gateway-env/${gatewayId}/irrigation-device-name`, { name }),

  // Pin test (admin only)
  testGpioPin: (gatewayId: string, data: { pin: number; state: boolean; durationMs?: number }) =>
    apiClient.post(`/gateway-env/${gatewayId}/pin-test`, data),

  testZigbeeChannel: (gatewayId: string, data: { friendlyName: string; switchCode: string; state: boolean; durationMs?: number }) =>
    apiClient.post(`/gateway-env/${gatewayId}/zigbee-test`, data),
}
