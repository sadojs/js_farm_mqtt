/**
 * 폴백 이벤트(fallback_events) 한글화 — DB raw payload 를 사람이 읽는 문장으로.
 * RPi rule-evaluator/* 가 enqueue 하는 페이로드 구조 기준.
 */

import type { FallbackEvent } from '../types/emergency-failover.types'

/** 이벤트 종류 한글 라벨 */
export function eventTypeLabel(eventType: FallbackEvent['eventType']): string {
  switch (eventType) {
    case 'mode_change': return '모드 전환'
    case 'rule_fired': return '룰 발화'
    case 'safety_off': return '안전 정지'
    case 'sync_ack': return '동기화 확인'
    default: return String(eventType)
  }
}

function fmtNum(n: unknown, digits = 1): string {
  if (typeof n !== 'number' || !isFinite(n)) return '?'
  return n.toFixed(digits)
}

function fmtChannels(value: unknown): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return '(없음)'
    if (value.length > 4) return `${value.slice(0, 4).join(', ')} 외 ${value.length - 4}`
    return value.join(', ')
  }
  return ''
}

/** 페이로드 상세 한글 요약 (events-table 의 "상세" 열) */
export function eventPayloadSummary(event: FallbackEvent): string {
  const p = (event.payload || {}) as Record<string, any>

  if (event.eventType === 'mode_change') {
    const to = String(p.to ?? '')
    if (to === 'online') return '온라인 모드 복귀 — 서버 통신 정상 회복'
    if (to === 'fallback' || to === 'offline') return '폴백 모드 진입 — 서버 통신 단절 감지'
    return `모드 → ${to || '(미지정)'}`
  }

  if (event.eventType === 'safety_off') {
    const reason = String(p.reason ?? '')
    const channels = fmtChannels(p.channels)
    const cmd = p.cmd
    const reasonText =
      reason === 'emergency-stop-all' ? '전체 비상 정지 명령'
      : reason === 'emergency-stop-no-mapping' ? '비상 정지 — 채널 매핑 미동기화 안전망'
      : reason === 'fallback-mode-drop' ? '폴백 모드 종료 — 활성 채널 강제 OFF'
      : reason === 'rain-override-active' ? '강우 감지 — 개폐기 강제 닫힘'
      : reason || '(사유 미기재)'
    if (cmd && typeof cmd === 'object') {
      const slot = cmd.slot ?? '?'
      const state = cmd.state === true ? 'ON' : cmd.state === false ? 'OFF' : '?'
      return `${reasonText} — 채널 ${slot} ${state}`
    }
    if (channels) return `${reasonText} — 대상 ${channels}`
    return reasonText
  }

  if (event.eventType === 'rule_fired') {
    const rule = String(p.rule ?? '')

    if (rule === 'rain-override') {
      return p.active ? '강우 보호 ON — 개폐기 닫음' : '강우 보호 OFF — 정상 복귀'
    }
    if (rule === 'opener-intent') {
      const to = String(p.to ?? '')
      const reasonRaw = String(p.reason ?? '')
      const reason =
        reasonRaw === 'rain-active' || reasonRaw === 'rain-override-active' ? '강우 감지' :
        reasonRaw.startsWith('env-temperature') ? '온도 조건' :
        reasonRaw.startsWith('env-humidity') ? '습도 조건' :
        reasonRaw.startsWith('backup-') && reasonRaw.includes('always-open') ? '백업 24시간 개방' :
        reasonRaw.startsWith('backup-') ? '백업 스케줄' :
        reasonRaw === 'schedule-time' ? '월별 스케줄' :
        reasonRaw === 'always-open' ? '항시 개방' :
        reasonRaw || ''
      const direction = to === 'closed' ? '닫힘' : to === 'open' ? '열림' : to || '?'
      return reason ? `개폐기 ${direction} (${reason})` : `개폐기 ${direction}`
    }
    if (rule === 'fan-toggle') {
      const to = p.to === true ? 'ON' : p.to === false ? 'OFF' : '?'
      const triggerType = String(p.triggerType ?? 'temperature')
      const unit = triggerType === 'humidity' ? '%' : '°C'
      const valueKey = p.value ?? p.temperature ?? p.humidity
      const valueStr = `${fmtNum(valueKey, triggerType === 'humidity' ? 0 : 1)}${unit}`
      const chs = fmtChannels(p.channels)
      return `환기팬 ${to} (${triggerType === 'humidity' ? '습도' : '온도'} ${valueStr}${chs ? `, ${chs}` : ''})`
    }
    if (rule === 'irrigation-cycle') {
      const phase = p.phase === 'on' ? '시작' : p.phase === 'off' ? '종료' : String(p.phase ?? '')
      return `관수 사이클 ${phase}`
    }
    if (rule === 'fertilizer-cycle') {
      const phase = p.phase === 'on' ? '시작' : p.phase === 'off' ? '종료' : String(p.phase ?? '')
      return `액비 사이클 ${phase}`
    }
    // 알 수 없는 룰 — payload 의 의미 있는 키들만 추려서 표시
    const keys = Object.keys(p).filter(k => k !== 'rule').slice(0, 4)
    if (keys.length === 0) return rule || '(상세 없음)'
    const kv = keys.map(k => `${k}=${JSON.stringify(p[k])}`).join(', ')
    return `${rule}: ${kv}`
  }

  if (event.eventType === 'sync_ack') {
    const v = p.version
    return v ? `설정 v${v} 동기화 확인` : '동기화 확인'
  }

  return JSON.stringify(p)
}

/** 이벤트 종류별 배지 색상 분류 */
export function eventBadgeClass(eventType: FallbackEvent['eventType']): string {
  switch (eventType) {
    case 'safety_off': return 'danger'
    case 'mode_change': return 'warning'
    case 'rule_fired': return 'info'
    case 'sync_ack': return 'success'
    default: return 'neutral'
  }
}
