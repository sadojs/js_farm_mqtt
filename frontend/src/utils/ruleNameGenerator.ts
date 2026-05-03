import type { WizardStateV2 } from '../components/automation/v2/types'

function dayLabel(days: number[]): string {
  const sorted = [...days].sort((a, b) => a - b)
  if (sorted.length === 7) return '매일'
  if (JSON.stringify(sorted) === JSON.stringify([1, 2, 3, 4, 5])) return '평일'
  if (JSON.stringify(sorted) === JSON.stringify([0, 6])) return '주말'
  const names = ['일', '월', '화', '수', '목', '금', '토']
  return sorted.map(d => names[d]).join('·')
}

function timeLabel(hhmm: string): string {
  const h = parseInt(hhmm.split(':')[0], 10)
  if (h >= 6 && h < 12) return '오전'
  if (h >= 12 && h < 18) return '오후'
  if (h >= 18 && h < 23) return '저녁'
  return '야간'
}

export function generateRuleName(state: WizardStateV2): string {
  const { intent } = state

  if (intent === 'irrigation' && state.irrigation) {
    const sched = state.irrigation.schedule[0]
    if (!sched) return '관수 자동화'
    const day = dayLabel(sched.days)
    const time = timeLabel(sched.startTime)
    const fert = state.irrigation.useFertilizer ? '액비 ' : ''
    return `${day} ${time} ${fert}관수`
  }

  if (intent === 'opener' && state.opener) {
    const t = state.opener
    if (t.triggerType === 'time' && t.timeRange) {
      const startH = parseInt(t.timeRange.start.split(':')[0], 10)
      const period = startH >= 6 && startH < 18 ? '주간' : '야간'
      const day = dayLabel(t.timeRange.days)
      return day === '매일' ? `${period} 개폐기 자동 개방` : `${day} ${period} 개폐기 자동 개방`
    }
    return '고온시 개폐기 자동 개방'
  }

  if (intent === 'fan' && state.fan) {
    const t = state.fan
    if (t.triggerType === 'time' && t.timeRange) {
      const startH = parseInt(t.timeRange.start.split(':')[0], 10)
      const period = startH >= 6 && startH < 18 ? '주간' : '야간'
      const day = dayLabel(t.timeRange.days)
      return day === '매일' ? `${period} 환풍기 가동` : `${day} ${period} 환풍기 가동`
    }
    return '고온시 환풍기 자동 가동'
  }

  return '새 자동 제어'
}
