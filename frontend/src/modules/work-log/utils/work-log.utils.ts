/** 경과일 색 분류 — PROMPT §A 의 색 기준 */
export type ElapsedTone = 'fresh' | 'mild' | 'amber' | 'red' | 'none'

export function elapsedDays(lastDoneAt: string | null | undefined): number | null {
  if (!lastDoneAt) return null
  const t = new Date(lastDoneAt).getTime()
  if (isNaN(t)) return null
  const now = Date.now()
  return Math.floor((now - t) / 86400000)
}

export function elapsedTone(days: number | null): ElapsedTone {
  if (days == null) return 'none'
  if (days <= 2) return 'fresh'
  if (days <= 7) return 'mild'
  if (days <= 14) return 'amber'
  return 'red'
}

export const TONE_COLORS: Record<ElapsedTone, { bg: string; text: string }> = {
  fresh: { bg: '#dcfce7', text: '#166534' },
  mild: { bg: '#eef7e9', text: '#3d6b2e' },
  amber: { bg: '#fef3c7', text: '#92400e' },
  red: { bg: '#fee2e2', text: '#991b1b' },
  none: { bg: '#f1f4f7', text: '#94a3b8' },
}

export function formatDateShort(iso: string): string {
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

export function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function todayYmd(): string {
  return ymd(new Date())
}
