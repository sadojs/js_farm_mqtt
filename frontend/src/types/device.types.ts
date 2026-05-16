export type EquipmentType = 'fan' | 'irrigation' | 'opener_open' | 'opener_close' | 'other'

export interface ChannelMapping {
  remote_control:       string
  zone_1:               string
  zone_2:               string
  zone_3:               string
  zone_4:               string
  zone_5?:              string
  zone_6?:              string
  zone_7?:              string
  zone_8?:              string
  fertilizer_b_contact: string
  mixer:                string
  fertilizer_motor:     string
  [key: string]: string | undefined
}

export const DEFAULT_CHANNEL_MAPPING_8CH: ChannelMapping = {
  remote_control:       'switch_1',
  zone_1:               'switch_2',
  zone_2:               'switch_3',
  zone_3:               'switch_4',
  zone_4:               'switch_5',
  fertilizer_b_contact: 'switch_6',
  mixer:                'switch_usb1',
  fertilizer_motor:     'switch_usb2',
}

export const DEFAULT_CHANNEL_MAPPING_12CH: ChannelMapping = {
  remote_control:       'switch_1',
  zone_1:               'switch_2',
  zone_2:               'switch_3',
  zone_3:               'switch_4',
  zone_4:               'switch_5',
  zone_5:               'switch_6',
  zone_6:               'switch_7',
  zone_7:               'switch_8',
  zone_8:               'switch_9',
  fertilizer_b_contact: 'switch_10',
  mixer:                'switch_11',
  fertilizer_motor:     'switch_12',
}

// 하위 호환용 별칭
export const DEFAULT_CHANNEL_MAPPING = DEFAULT_CHANNEL_MAPPING_8CH

export const FUNCTION_LABELS: Record<string, string> = {
  remote_control:       '원격제어 ON/OFF',
  fertilizer_b_contact: '액비/교반기 B접점',
  zone_1:               '1구역 관주',
  zone_2:               '2구역 관주',
  zone_3:               '3구역 관주',
  zone_4:               '4구역 관주',
  zone_5:               '5구역 관주',
  zone_6:               '6구역 관주',
  zone_7:               '7구역 관주',
  zone_8:               '8구역 관주',
  zone_9:               '9구역 관주',
  zone_10:              '10구역 관주',
  zone_11:              '11구역 관주',
  zone_12:              '12구역 관주',
  mixer:                '교반기',
  fertilizer_motor:     '액비모터',
}

export const AVAILABLE_SWITCH_CODES_8CH = [
  'switch_1', 'switch_2', 'switch_3', 'switch_4',
  'switch_5', 'switch_6', 'switch_usb1', 'switch_usb2',
]

export const AVAILABLE_SWITCH_CODES_12CH = [
  'switch_1', 'switch_2', 'switch_3', 'switch_4',
  'switch_5', 'switch_6', 'switch_7', 'switch_8',
  'switch_9', 'switch_10', 'switch_11', 'switch_12',
]

// 하위 호환용 별칭
export const AVAILABLE_SWITCH_CODES = AVAILABLE_SWITCH_CODES_8CH

export function detectChannelCount(switchCodes: string[]): 8 | 12 {
  // Zigbee: switch_7..12 → 12ch
  if (switchCodes.some(c => /^switch_(7|8|9|10|11|12)$/.test(c))) return 12
  // Onboard: relay_zone_5 이상 존재하면 12ch (8ch는 zone_1..4까지)
  if (switchCodes.some(c => /^relay_zone_([5-9]|[1-9]\d+)$/.test(c))) return 12
  return 8
}

export function getDefaultMappingByCount(count: 8 | 12): ChannelMapping {
  return count === 12 ? DEFAULT_CHANNEL_MAPPING_12CH : DEFAULT_CHANNEL_MAPPING_8CH
}

export function getAvailableSwitchCodesByCount(count: 8 | 12): string[] {
  return count === 12 ? AVAILABLE_SWITCH_CODES_12CH : AVAILABLE_SWITCH_CODES_8CH
}

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
  enabled?: boolean
  switchState?: boolean | null
  switchStates?: Record<string, boolean>
  channelMapping?: ChannelMapping | null
  sensorData?: SensorData | null
  lastSeen?: string
  createdAt: string
  updatedAt: string
  pairedDeviceId?: string
  openerGroupName?: string
  deviceSettings?: Record<string, any> | null
  source?: 'zigbee' | 'onboard'
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

/** Zigbee2MQTT bridge/devices에서 가져온 장치 정보 */
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
  houseId?: string | null
  status: string
  agentStatus?: string
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
