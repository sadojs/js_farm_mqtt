export type WizardIntent = 'irrigation' | 'opener' | 'fan' | 'advanced'

export type WizardStep =
  | 'farm'
  | 'intent'
  | 'irrigation-device'
  | 'irrigation-valve'
  | 'device-by-intent'
  | 'timing'
  | 'review'

export interface IntentConfig {
  id: WizardIntent
  icon: string
  title: string
  subtitle: string
}

export const INTENTS: IntentConfig[] = [
  { id: 'irrigation', icon: '💧', title: '물(액비)을 주고 싶어요',        subtitle: '정해진 시간에 관수, 액비 혼합' },
  { id: 'opener',     icon: '🚪', title: '개폐기를 열거나 닫고 싶어요',   subtitle: '시간·온도에 따라 자동 개폐' },
  { id: 'fan',        icon: '🌀', title: '환풍기를 켜거나 끄고 싶어요',   subtitle: '시간·온도에 따라 자동 가동' },
  { id: 'advanced',   icon: '⚙️', title: '온도/습도에 따라 세밀하게 제어', subtitle: '조건을 직접 설정 (고급)' },
]

export interface SensorCondition {
  field: 'humidity' | 'co2' | 'soil_moisture' | 'light'
  operator: 'gte' | 'lte'
  value: number
}

export interface IrrigationSchedule {
  days: number[]      // 0(일)~6(토)
  startTime: string   // "HH:MM"
  durationMin: number
}

export interface FertilizerConfig {
  enabled: boolean
  duration: number    // 분
  preStopWait: number // 종료 전 대기 분
}

export interface TimeRange {
  days: number[]
  start: string       // "HH:MM"
  end: string         // "HH:MM"
}

export interface TemperatureTrigger {
  base: number        // 기준 온도
  hysteresis: number  // 편차 (기본 2) — onAt = base+hysteresis, offAt = base-hysteresis
}

export interface IrrigationState {
  controllerDeviceId: string
  controllerChannels: 8 | 12
  valveZones: number[]        // 선택된 구역 번호 배열 (1-based)
  durationMin: number         // 구역별 공통 관수 시간(분)
  waitTimeBetweenZones: number // 구역 간 쉬는 시간(분)
  mixerEnabled: boolean       // 교반기 ON/OFF
  useFertilizer: boolean      // 액비모터 사용 여부
  fertilizer: FertilizerConfig
  schedule: IrrigationSchedule[]
}

export interface OpenerFanState {
  deviceIds: string[]
  triggerType: 'time' | 'temperature'
  timeRange?: TimeRange
  timeRanges?: TimeRange[]
  temperature?: TemperatureTrigger
  extraConditions: SensorCondition[]
  relayEnabled: boolean       // 동작대기 ON/OFF
  relayOnMin: number          // 동작대기 ON 분
  relayOffMin: number         // 동작대기 OFF 분
}

export interface WizardStateV2 {
  groupId: string | null
  intent: WizardIntent | null
  irrigation?: IrrigationState
  opener?: OpenerFanState
  fan?: OpenerFanState
  ruleName: string
  activateNow: boolean
}
