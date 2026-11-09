import type { SeasonBrief, SettlementHistoryItem } from '../types/worker-payroll.types'

/**
 * 스냅샷의 가불 합계. 구버전 스냅샷에 advanceTotal 이 없으면 지급액−공제−실수령으로 역산
 * (표시용, 데이터 변경 없음 — 백엔드 advanceOf 와 같은 규칙)
 */
export function advOf(it: SettlementHistoryItem): number {
  const s = it.snapshot
  const v = (s as any).advanceTotal
  if (typeof v === 'number') return v
  return Math.max(0, (s.grossPay ?? 0) - (s.deductionTotal ?? 0) - (it.netPay ?? 0))
}

/** 시즌이 그 해와 겹치는지 */
export function seasonInYear(s: SeasonBrief, year: number): boolean {
  return s.startDate.slice(0, 10) <= `${year}-12-31` && (s.endDate ? s.endDate.slice(0, 10) : '9999-12-31') >= `${year}-01-01`
}

/** 'YYYY-MM-DD' → 'M/D' */
export function md(iso: string | null | undefined): string {
  if (!iso) return ''
  return `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`
}

/** 1,234,000원 */
export function won(n: number): string {
  return `${Math.round(n).toLocaleString()}원`
}

/** 큰 금액 요약: 12,345,000 → 1,234.5만원 */
export function manwon(n: number): string {
  const v = Math.round(n / 1000) / 10
  return `${v.toLocaleString()}만원`
}
