export interface Deduction {
  id?: string
  label: string
  amount: number
  sortOrder?: number
}

export interface Worker {
  id: string
  name: string
  phone?: string | null
  startDate: string
  hourlyWage: number
  dailyHours: number
  isActive: boolean
  accountUserId?: string | null
  username?: string | null
  deductions: Deduction[]
}

/** 신규 등록 시 username/password 포함, 수정 시 근무조건만 */
export interface SaveWorkerPayload {
  id?: string
  name: string
  username?: string
  password?: string
  phone?: string
  startDate: string
  hourlyWage: number
  dailyHours: number
  deductions?: Deduction[]
}

export interface Advance {
  id: string
  date: string
  amount: number
  note: string | null
}

export type DayStatus = 'work' | 'off' | 'none'

export interface CalendarDay {
  date: string
  beforeStart: boolean
  status: DayStatus
  hours: number
  advance: number
}

export interface PeriodMeta {
  periodStart: string
  periodEnd: string
  settleDate: string
  nextPeriodStart: string
  prevPeriodStart: string | null
}

export interface WorkerBrief {
  id: string
  name: string
  startDate: string
  hourlyWage: number
  dailyHours: number
}

export interface CalendarResponse extends PeriodMeta {
  worker: WorkerBrief
  canEdit: boolean
  kpi: {
    workDays: number
    totalHours: number
    grossPay: number
  }
  days: CalendarDay[]
}

export type SettlementStatus = 'open' | 'pending' | 'requested' | 'confirmed'

export interface SettlementResponse extends PeriodMeta {
  worker: WorkerBrief
  workDays: number
  totalHours: number
  hourlyWage: number
  grossPay: number
  deductions: { label: string; amount: number }[]
  deductionTotal: number
  advances: { date: string; amount: number; note: string | null }[]
  advanceTotal: number
  netPay: number
  status: SettlementStatus
  frozen: boolean
  requestedAt: string | null
  confirmedAt: string | null
  canRequest: boolean
  canApprove: boolean
}

export interface SettlementHistoryItem {
  id: string
  workerId: string
  workerName: string
  periodStart: string
  periodEnd: string
  settleDate: string
  status: 'requested' | 'confirmed'
  netPay: number
  requestedAt: string | null
  confirmedAt: string | null
  snapshot: SettlementResponse
}
