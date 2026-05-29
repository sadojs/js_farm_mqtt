import type { WizardStateV2 } from './types'
import type { CreateRuleRequest, ConditionGroup, IrrigationConditions } from '@/types/automation.types'
import { DEFAULT_CHANNEL_MAPPING_8CH, DEFAULT_CHANNEL_MAPPING_12CH } from '@/types/device.types'

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

function toHour(hhmm: string): number {
  return Number(hhmm.split(':')[0])
}

function buildIrrigation(state: WizardStateV2): CreateRuleRequest {
  const { groupId, ruleName, irrigation } = state
  if (!irrigation) throw new Error('irrigation state missing')

  const sched = irrigation.schedule[0]
  const mapping = irrigation.controllerChannels === 12
    ? DEFAULT_CHANNEL_MAPPING_12CH
    : DEFAULT_CHANNEL_MAPPING_8CH

  // 8CH → 4구역(zone_1~4), 12CH → 8구역(zone_1~8)
  // 우선순위: valves 배열(밸브별 개별 설정) > valveZones + 공통값 (backward compat)
  const zoneCount = irrigation.controllerChannels === 12 ? 8 : 4
  const useValves = Array.isArray(irrigation.valves) && irrigation.valves.length === zoneCount
  const allZones = irrigation.valveZones.length === 0
  const zones = Array.from({ length: zoneCount }, (_, i) => {
    if (useValves) {
      const v = irrigation.valves[i]
      return {
        zone: v.zone,
        name: `${v.zone}번 밸브`,
        duration: v.enabled ? v.duration : 0,
        waitTime: v.enabled ? v.waitTime : 0,
        enabled: v.enabled,
      }
    }
    const inSel = allZones || irrigation.valveZones.includes(i + 1)
    return {
      zone: i + 1,
      name: `${i + 1}번 밸브`,
      duration: inSel ? irrigation.durationMin : 0,
      waitTime: inSel ? irrigation.waitTimeBetweenZones : 0,
      enabled: inSel,
    }
  })

  const conditions: IrrigationConditions = {
    type: 'irrigation',
    startTime: sched?.startTime ?? '08:00',
    zones,
    mixer: { enabled: irrigation.mixerEnabled },
    fertilizer: irrigation.useFertilizer
      ? { enabled: true, duration: irrigation.fertilizer.duration, preStopWait: irrigation.fertilizer.preStopWait }
      : { enabled: false, duration: 0, preStopWait: 0 },
    schedule: { days: sched?.days ?? [1, 2, 3, 4, 5], repeat: true },
    schedules: irrigation.schedule.map(s => ({ startTime: s.startTime, days: s.days, repeat: true })),
  }

  const meta: Record<string, unknown> = {}
  meta.channelMapping = mapping

  return {
    name: ruleName,
    groupId: groupId ?? undefined,
    conditions,
    actions: {
      targetDeviceId: irrigation.controllerDeviceId,
      targetDeviceIds: [irrigation.controllerDeviceId],
      sensorDeviceIds: [],
    } as any,
    priority: 1,
    ...(Object.keys(meta).length ? { description: JSON.stringify(meta) } : {}),
  }
}

function buildOpenerFan(state: WizardStateV2): CreateRuleRequest {
  const { groupId, ruleName, intent } = state
  const trigger = intent === 'opener' ? state.opener : state.fan
  if (!trigger) throw new Error('trigger state missing')

  // 개폐기 온도 룰은 항상 30s ON / 60s OFF 모니터링 사이클 적용
  // (물리 리미트 스위치가 있어 ON 중에도 안전하게 계속 펄스 가능)
  const isOpenerTemp = intent === 'opener' && trigger.triggerType === 'temperature'

  let conditions: ConditionGroup

  if (trigger.triggerType === 'time') {
    const ranges = (trigger.timeRanges && trigger.timeRanges.length > 0)
      ? trigger.timeRanges
      : (trigger.timeRange ? [trigger.timeRange] : [])
    if (ranges.length === 0) throw new Error('time trigger has no ranges')
    const firstRange = ranges[0]
    const baseCond: any = {
      type: 'time',
      field: 'time',
      operator: 'between',
      value: [toMinutes(firstRange.start), toMinutes(firstRange.end)] as [number, number],
      daysOfWeek: firstRange.days,
    }
    if (ranges.length > 1) {
      baseCond.timeSlots = ranges.map(r => ({ start: toHour(r.start), end: toHour(r.end) }))
    }
    if (trigger.relayEnabled) {
      baseCond.relay = true
      baseCond.relayOnMinutes = trigger.relayOnMin
      baseCond.relayOffMinutes = trigger.relayOffMin
    }
    conditions = {
      logic: 'AND',
      groups: [{ logic: 'AND', conditions: [baseCond] }],
    }
  } else if (trigger.triggerType === 'temperature' && trigger.temperature) {
    const { base, hysteresis } = trigger.temperature
    const sensorField = trigger.sensorField ?? 'temperature'
    const unit = sensorField === 'humidity' ? '%' : '°C'
    // 런타임 평가는 condition.value를 midpoint(base)로 사용하고 deviation을 더해 onThreshold,
    // 빼서 offThreshold를 계산하므로 base를 그대로 저장해야 한다.
    const mainCond: any = {
      type: 'sensor' as const,
      field: sensorField,
      operator: 'gte' as const,
      value: base,
      unit,
      deviation: hysteresis,
      sensor_device_id: trigger.sensorDeviceId ?? null,
    }
    if (trigger.relayEnabled) {
      mainCond.relay = true
      mainCond.relayOnMinutes = trigger.relayOnMin
      mainCond.relayOffMinutes = trigger.relayOffMin
    }
    // 개폐기 온도 룰: 30초 펄스 / 60초 대기 자동 부착 (사용자 설정 없이도 적용)
    if (isOpenerTemp) {
      mainCond.relay = true
      mainCond.relayOnSeconds = 30
      mainCond.relayOffSeconds = 60
    }
    const extraConds = trigger.extraConditions.map(ec => ({
      type: 'sensor' as const,
      field: ec.field,
      operator: ec.operator,
      value: ec.value,
    }))
    conditions = {
      logic: 'AND',
      groups: [{ logic: 'AND', conditions: [mainCond, ...extraConds] }],
    }
  } else {
    throw new Error('invalid trigger state')
  }

  // 이전엔 hysteresisOffAt / originalV2State 메타데이터를 description에 JSON으로 저장했으나
  // 현재 value=base 시맨틱 정정 이후 value/deviation/sensor_device_id 만으로 모든 정보 복원 가능 → 제거.
  return {
    name: ruleName,
    groupId: groupId ?? undefined,
    conditions,
    actions: {
      targetDeviceId: trigger.deviceIds[0],
      targetDeviceIds: trigger.deviceIds,
      sensorDeviceIds: trigger.sensorDeviceId ? [trigger.sensorDeviceId] : [],
    } as any,
    priority: 1,
  }
}

export function transformV2ToLegacy(state: WizardStateV2): CreateRuleRequest {
  switch (state.intent) {
    case 'irrigation': return buildIrrigation(state)
    case 'opener':
    case 'fan':        return buildOpenerFan(state)
    default:           throw new Error(`Cannot transform intent: ${state.intent}`)
  }
}
