// === 장비 유형 (레거시 호환) ===
export type DeviceType = 'roof_actuator' | 'ventilation_fan' | 'irrigation'
export type RuleType = 'weather' | 'time' | 'hybrid'

// === 조건 구조 (중첩 그룹) ===
export interface Condition {
  type: 'time' | 'sensor' | 'weather'
  field: string
  operator: 'eq' | 'gt' | 'lt' | 'gte' | 'lte' | 'between'
  value: number | boolean | string | [number, number]
  unit?: string
  scheduleType?: 'repeat' | 'once'
  daysOfWeek?: number[]
  onceWeekStart?: string
  executedDates?: string[]
  deviation?: number
  timeSlots?: { start: number; end: number }[]
  repeat?: boolean
  relay?: boolean
  relayOnMinutes?: number
  relayOffMinutes?: number
}

export interface ConditionSet {
  logic: 'AND' | 'OR'
  conditions: Condition[]
}

export interface ConditionGroup {
  logic: 'AND' | 'OR'
  groups: ConditionSet[]
}

// === 액션 (새로운 형식: 실제 장비 ID 기반) ===
export interface RuleAction {
  targetDeviceId?: string
  targetDeviceIds?: string[]
  command?: string
  sensorDeviceIds?: string[]
  actuatorDeviceIds?: string[]
  // 레거시 호환
  deviceType?: DeviceType
  parameters?: any
}

// === 관수 조건 데이터 ===
export interface IrrigationZoneConfig {
  zone: number
  name: string
  duration: number
  waitTime: number
  enabled: boolean
}

export interface IrrigationConditions {
  type: 'irrigation'
  startTime: string
  timerSwitch: boolean
  zones: IrrigationZoneConfig[]
  mixer: { enabled: boolean }
  fertilizer: { duration: number; preStopWait: number }
  schedule: { days: number[]; repeat: boolean }
}

// === 위저드 폼 데이터 (5단계) ===
export interface WizardFormData {
  groupId?: string
  sensorDeviceIds: string[]
  actuatorDeviceIds: string[]
  conditions: ConditionGroup
  irrigationConditions?: IrrigationConditions
  name: string
  description: string
  priority: number
}

// === 자동화 룰 (DB 모델) ===
export interface AutomationRule {
  id: string
  userId: string
  groupId?: string
  houseId?: string
  name: string
  description?: string
  ruleType: RuleType
  enabled: boolean
  conditions: ConditionGroup | IrrigationConditions
  actions: RuleAction
  priority: number
  createdAt: string
  updatedAt: string
}

export interface CreateRuleRequest {
  name: string
  description?: string
  groupId?: string
  houseId?: string
  conditions: ConditionGroup | IrrigationConditions
  actions: RuleAction
  priority?: number
}

export interface AutomationLog {
  id: string
  ruleId: string
  ruleName: string
  executedAt: string
  success: boolean
  conditionsMet?: any
  actionsExecuted?: any
  error?: string
}

// === 레거시 타입 (기존 코드 호환) ===
export interface RoofActuatorParams {
  percentage: number
}

export interface VentilationFanParams {
  speed?: 'low' | 'mid' | 'high'
}

export interface IrrigationStep {
  type: 'water' | 'fertilizer'
  value: number
  unit: 'minutes' | 'liters'
}

export interface IrrigationParams {
  mode: 'water_only' | 'fertilizer_only' | 'sequence'
  duration?: number
  volume?: number
  durationUnit?: 'minutes' | 'liters'
  sequence?: IrrigationStep[]
}

export type ActionParameters = RoofActuatorParams | VentilationFanParams | IrrigationParams
