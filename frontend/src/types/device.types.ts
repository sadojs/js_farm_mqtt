export type EquipmentType = 'fan' | 'irrigation' | 'opener_open' | 'opener_close' | 'other'

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
