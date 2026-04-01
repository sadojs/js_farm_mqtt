export type EquipmentType = 'fan' | 'irrigation' | 'opener_open' | 'opener_close' | 'other'

export interface ChannelMapping {
  remote_control:       string
  zone_1:               string
  zone_2:               string
  zone_3:               string
  zone_4:               string
  fertilizer_b_contact: string
  mixer:                string
  fertilizer_motor:     string
}

export const DEFAULT_CHANNEL_MAPPING: ChannelMapping = {
  remote_control:       'switch_1',
  zone_1:               'switch_2',
  zone_2:               'switch_3',
  zone_3:               'switch_4',
  zone_4:               'switch_5',
  fertilizer_b_contact: 'switch_6',
  mixer:                'switch_usb1',
  fertilizer_motor:     'switch_usb2',
}

export const FUNCTION_LABELS: Record<keyof ChannelMapping, string> = {
  remote_control:       '원격제어 ON/OFF',
  zone_1:               '1구역 관수',
  zone_2:               '2구역 관수',
  zone_3:               '3구역 관수',
  zone_4:               '4구역 관수',
  fertilizer_b_contact: '액비/교반기 B접점',
  mixer:                '교반기',
  fertilizer_motor:     '액비모터',
}

export const AVAILABLE_SWITCH_CODES = [
  'switch_1', 'switch_2', 'switch_3', 'switch_4',
  'switch_5', 'switch_6', 'switch_usb1', 'switch_usb2',
]

export interface SensorData {
  [key: string]: number | null | undefined
}

export interface Device {
  id: string
  userId: string
  houseId?: string
  gatewayId?: string
  zigbeeIeee: string
  friendlyName?: string
  zigbeeModel?: string
  name: string
  category: string
  deviceType: 'sensor' | 'actuator'
  equipmentType?: EquipmentType
  icon?: string
  online: boolean
  switchState?: boolean | null
  switchStates?: Record<string, boolean>
  channelMapping?: ChannelMapping | null
  sensorData?: SensorData | null
  lastSeen?: string
  createdAt: string
  updatedAt: string
  pairedDeviceId?: string
  openerGroupName?: string
}

export interface RegisterDeviceRequest {
  devices: {
    zigbeeIeee: string
    friendlyName?: string
    zigbeeModel?: string
    name: string
    category: string
    deviceType: 'sensor' | 'actuator'
    equipmentType?: EquipmentType
    online?: boolean
    gatewayId?: string
  }[]
  houseId?: string
}

export interface DeviceControlRequest {
  commands: {
    code: string
    value: any
  }[]
}

/** Zigbee2MQTT bridge/devices에서 가져온 장비 정보 */
export interface ZigbeeDeviceInfo {
  ieee_address: string
  friendly_name: string
  type: string
  model_id?: string
  manufacturer?: string
  supported: boolean
  definition?: {
    model: string
    vendor: string
    description: string
    exposes: { type: string; name?: string; property?: string }[]
  }
}

/** 게이트웨이 (라즈베리파이) */
export interface Gateway {
  id: string
  userId: string
  gatewayId: string
  name: string
  location?: string
  rpiIp?: string
  status: string
  lastSeen?: string
  createdAt: string
  updatedAt: string
}

export interface DependencyRule {
  id: string
  name: string
  enabled: boolean
}

export interface DeviceDependenciesResponse {
  canDelete: boolean
  isOpenerPair: boolean
  pairedDevice?: {
    id: string
    name: string
    equipmentType: string
  }
  automationRules: DependencyRule[]
  pairedDeviceAutomationRules?: DependencyRule[]
  groups: { id: string; name: string }[]
}
