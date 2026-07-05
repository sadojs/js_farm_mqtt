export type FallbackMode = 'online' | 'fallback' | 'unknown'
export type OpenerScheduleMode = 'time' | 'always-open'
export type FanTriggerType = 'temperature' | 'humidity'
export type OpenerTriggerType = FanTriggerType

export interface FallbackConfig {
  gatewayId: string
  heartbeatTimeoutSeconds: number
  recoveryGraceSeconds: number
  openerEnabled: boolean
  openerRainOverride: boolean
  irrigationEnabled: boolean
  irrigationMaxRuntimeMinutes: number
  fertilizerEnabled: boolean
  fanEnabled: boolean
  fanTriggerType: FanTriggerType
  fanOnTemp: number
  fanOffTemp: number
  openerTriggerType: OpenerTriggerType
  openerOnValue: number
  openerOffValue: number
  sensorTimeoutSeconds: number
  version: number
  lastAppliedAt: string | null
  lastAppliedVersion: number | null
  updatedAt: string
}

export interface OpenerSchedule {
  id: string
  gatewayId: string
  month: number
  enabled: boolean
  mode: OpenerScheduleMode
  openTime: string | null
  closeTime: string | null
  updatedAt: string
}

export interface FallbackGatewayStatus {
  gatewayId: string
  mode: FallbackMode
  modeChangedAt: string
  lastHeartbeatSeenAt: string | null
  updatedAt: string
}

export interface FallbackFullConfig {
  config: FallbackConfig
  schedule: OpenerSchedule[]
  status: FallbackGatewayStatus | null
}

export interface FallbackEvent {
  id: string
  gatewayId: string
  eventType: 'mode_change' | 'rule_fired' | 'safety_off' | 'sync_ack'
  payload: Record<string, unknown>
  occurredAt: string
  reportedAt: string
}

export interface UpdateConfigDto {
  heartbeatTimeoutSeconds?: number
  recoveryGraceSeconds?: number
  openerEnabled?: boolean
  openerRainOverride?: boolean
  irrigationEnabled?: boolean
  irrigationMaxRuntimeMinutes?: number
  fertilizerEnabled?: boolean
  fanEnabled?: boolean
  fanTriggerType?: FanTriggerType
  fanOnTemp?: number
  fanOffTemp?: number
  openerTriggerType?: OpenerTriggerType
  openerOnValue?: number
  openerOffValue?: number
  sensorTimeoutSeconds?: number
}

export interface UpsertScheduleDto {
  enabled: boolean
  mode: OpenerScheduleMode
  openTime?: string
  closeTime?: string
}
