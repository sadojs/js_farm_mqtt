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
  openerOperationSeconds: number
  openerStandbySeconds: number
  fanOperationMinutes: number
  fanStandbyMinutes: number
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

/** 비상 정지 유지(래치) 상태 — active 동안 이 게이트웨이의 모든 릴레이 ON 차단, '정지 해제'로만 풀림 */
export interface EmergencyStopState {
  active: boolean
  stoppedAt: string | null
  stoppedByName: string | null
  reason: string | null
  releasedAt: string | null
  releasedByName: string | null
  /** Pi 가 현재 상태를 회신했고 서버 상태와 일치 */
  piConfirmed: boolean
  piConfirmedAt: string | null
}

export interface FallbackFullConfig {
  config: FallbackConfig
  schedule: OpenerSchedule[]
  status: FallbackGatewayStatus | null
  emergency?: EmergencyStopState | null
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
  openerOperationSeconds?: number
  openerStandbySeconds?: number
  fanOperationMinutes?: number
  fanStandbyMinutes?: number
}

export interface UpsertScheduleDto {
  enabled: boolean
  mode: OpenerScheduleMode
  openTime?: string
  closeTime?: string
}
