import type { SprayProduct } from '../types/spray-schedule.types'

// ──── date-only 헬퍼 (UTC 기준) ────
export function parseDate(s: string): Date {
  return new Date(`${s.slice(0, 10)}T00:00:00.000Z`)
}
export function fmt(d: Date): string {
  return d.toISOString().slice(0, 10)
}
export function addDays(s: string, days: number): string {
  const d = parseDate(s)
  d.setUTCDate(d.getUTCDate() + days)
  return fmt(d)
}
export function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

/** 약품 마지막 방재일 = 시작일 + 간격×(횟수-1) */
export function lastSprayDate(p: SprayProduct): string {
  return addDays(p.startDate, p.intervalDays * Math.max(0, p.count - 1))
}

/**
 * 우선순위 약품의 기본 시작일 자동 산출.
 * - 첫 약품(index 0): 구역 정식일
 * - 그 외: 앞 약품 마지막 방재 + 앞 약품 간격
 */
export function computeDefaultStart(
  products: SprayProduct[],
  index: number,
  transplantDate: string,
): string {
  if (index <= 0) return transplantDate
  const prev = products[index - 1]
  if (!prev) return transplantDate
  return addDays(lastSprayDate(prev), prev.intervalDays)
}

/** MM/DD 표기 */
export function shortDate(s: string): string {
  const d = parseDate(s)
  return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}`
}

/** 월 그리드(6주) 셀 날짜 목록 — 일요일 시작 */
export function monthGrid(year: number, month1: number): string[] {
  const first = new Date(Date.UTC(year, month1 - 1, 1))
  const startDow = first.getUTCDay() // 0=일
  const gridStart = new Date(first)
  gridStart.setUTCDate(1 - startDow)
  const cells: string[] = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart)
    d.setUTCDate(gridStart.getUTCDate() + i)
    cells.push(fmt(d))
  }
  return cells
}

export function monthOf(s: string): number {
  return parseDate(s).getUTCMonth() + 1
}
export function yearOf(s: string): number {
  return parseDate(s).getUTCFullYear()
}
export function dayOf(s: string): number {
  return parseDate(s).getUTCDate()
}
