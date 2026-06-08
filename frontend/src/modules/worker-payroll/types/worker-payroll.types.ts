export interface Deduction {
  id?: string
  label: string
  amount: number
  sortOrder?: number
}

export interface Worker {
  id: string
  name: string
  startDate: string
  hourlyWage: number
  dailyHours: number
  isActive: boolean
  deductions: Deduction[]
}

export interface SaveWorkerPayload {
  id?: string
  name: string
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

export interface CalendarDay {
  date: string
  beforeStart: boolean
  holiday: boolean
  deltaHours: number
  hours: number
  advance: number
  isSettleDay: boolean
}

export interface PeriodMeta {
  periodStart: string
  periodEnd: string
  settleDate: string
  nextPeriodStart: string
  prevPeriodStart: string | null
}

export interface CalendarResponse extends PeriodMeta {
  worker: {
    id: string
    name: string
    startDate: string
    hourlyWage: number
    dailyHours: number
  }
  kpi: {
    workDays: number
    totalHours: number
    overtimeHours: number
    grossPay: number
  }
  days: CalendarDay[]
}

export interface SettlementResponse extends PeriodMeta {
  worker: {
    id: string
    name: string
    startDate: string
    hourlyWage: number
    dailyHours: number
  }
  workDays: number
  totalHours: number
  overtimeHours: number
  hourlyWage: number
  grossPay: number
  deductions: { label: string; amount: number }[]
  deductionTotal: number
  advances: { date: string; amount: number; note: string | null }[]
  advanceTotal: number
  netPay: number
  confirmed: boolean
  confirmedAt: string | null
}
