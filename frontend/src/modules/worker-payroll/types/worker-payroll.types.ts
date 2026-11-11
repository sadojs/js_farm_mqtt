export type DeductionKind = 'fixed' | 'variable'

/** 급여 방식: 시급(시간×시급) | 고정 월급 */
export type SalaryType = 'hourly' | 'fixed_monthly'

/** 정산 주기: 달력월(1일~말일) | 입사일 기준(anniversary) */
export type SettlementCycleType = 'calendar_month' | 'anniversary'

export interface Deduction {
  id?: string
  label: string
  kind?: DeductionKind
  amount: number
  /** 일할 계산 적용 — 고정공제만 의미. 기본 true. 변동공제는 무시. */
  prorate?: boolean
  sortOrder?: number
}

export interface VariableDeductionDef {
  id: string
  label: string
}

export interface Worker {
  id: string
  name: string
  phone?: string | null
  startDate: string
  endDate?: string | null
  salaryType: SalaryType
  hourlyWage: number
  fixedMonthlySalary: number
  settlementCycleType: SettlementCycleType
  dailyHours: number
  isActive: boolean
  accountUserId?: string | null
  username?: string | null
  deductions: Deduction[]
  /** 시즌(고용 기간) — 구버전 서버 응답에는 없을 수 있음 */
  seasons?: SeasonBrief[]
  currentSeason?: SeasonBrief
  lastSeasonYear?: number
  inYear?: boolean
}

/** 시즌 = 한 번의 고용 기간 (근무조건·공제를 가짐) */
export interface SeasonBrief {
  id: string
  seasonYear: number
  startDate: string
  endDate: string | null
  salaryType: SalaryType
  hourlyWage: number
  fixedMonthlySalary: number
  dailyHours: number
  settlementCycleType: SettlementCycleType
  note: string | null
  closed: boolean
  closedAt: string | null
  /** 정산일이 지났는데 확정되지 않은 기간 수 (목록 응답에만) */
  unsettledCount?: number
}

/** GET workers/:id/seasons — 시즌 + 공제 + 요약 */
export interface WorkerSeason extends SeasonBrief {
  isCurrent: boolean
  deductions: Deduction[]
  summary: {
    workDays: number
    totalHours: number
    grossPay: number
    netPay: number
    confirmedGrossPay: number
    confirmedNetPay: number
    unsettledCount: number
    periodCount: number
  }
}

export interface CreateSeasonPayload {
  startDate: string
  endDate?: string | null
  salaryType?: SalaryType
  hourlyWage: number
  fixedMonthlySalary?: number
  dailyHours: number
  settlementCycleType?: SettlementCycleType
  note?: string
  copyDeductionsFromSeasonId?: string
  deductions?: Deduction[]
}

export type UpdateSeasonPayload = Partial<Omit<CreateSeasonPayload, 'copyDeductionsFromSeasonId'>>

/** 마감 실패(409 SEASON_UNSETTLED) 시 남은 정산기간 */
export interface UnsettledPeriod {
  periodStart: string
  periodEnd: string
  settleDate: string
  status: 'open' | 'pending' | 'requested'
}

export interface AnnualReport {
  year: number
  totals: {
    grossPay: number
    deductionTotal: number
    advanceTotal: number
    netPay: number
    cashOut: number
    workDays: number
    totalHours: number
    headcount: number
    extraCostTotal: number
    totalCost: number
  }
  monthly: { month: number; grossPay: number; deductionTotal: number; advanceTotal: number; netPay: number }[]
  byWorker: {
    workerId: string
    workerName: string
    seasonId: string | null
    seasonYear: number
    seasonStart: string | null
    seasonEnd: string | null
    workDays: number
    totalHours: number
    grossPay: number
    deductionTotal: number
    advanceTotal: number
    netPay: number
    share: number
  }[]
  deductionsByLabel: { label: string; amount: number }[]
  unsettled: {
    count: number
    estimatedNetPay: number
    items: {
      workerId: string
      workerName: string
      periodStart: string
      settleDate: string
      status: 'open' | 'pending' | 'requested'
      estimatedNetPay: number
    }[]
  }
  previousYear: { year: number; grossPay: number; netPay: number; headcount: number } | null
}

/** 신규 등록 시 username/password 포함, 수정 시 근무조건만 */
export interface SaveWorkerPayload {
  id?: string
  /** 수정 시 근무조건·공제를 저장할 시즌 (없으면 기본 시즌) */
  seasonId?: string
  name: string
  username?: string
  password?: string
  phone?: string
  startDate: string
  endDate?: string | null
  salaryType?: SalaryType
  hourlyWage: number
  fixedMonthlySalary?: number
  settlementCycleType?: SettlementCycleType
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
  terminated?: boolean
  status: DayStatus
  hours: number
  advance: number
}

export interface PeriodMeta {
  periodStart: string
  periodEnd: string
  settleDate: string
  /** 시즌의 마지막 기간이면 null */
  nextPeriodStart: string | null
  prevPeriodStart: string | null
}

export interface WorkerBrief {
  id: string
  name: string
  startDate: string
  endDate?: string | null
  hourlyWage: number
  dailyHours: number
  salaryType?: SalaryType
  fixedMonthlySalary?: number
  settlementCycleType?: SettlementCycleType
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
  season?: SeasonBrief
}

export type SettlementStatus = 'open' | 'pending' | 'requested' | 'confirmed'

export interface SettlementResponse extends PeriodMeta {
  worker: WorkerBrief
  workDays: number
  totalHours: number
  hourlyWage: number
  salaryType?: SalaryType
  fixedMonthlySalary?: number
  grossProrationReason?: string | null
  grossPay: number
  deductions: { label: string; amount: number; kind?: DeductionKind; prorationReason?: string | null }[]
  deductionTotal: number
  advances: { date: string; amount: number; note: string | null }[]
  advanceTotal: number
  netPay: number
  status: SettlementStatus
  frozen: boolean
  canEdit?: boolean
  requestedAt: string | null
  confirmedAt: string | null
  canRequest: boolean
  canApprove: boolean
  variableDeductions: VariableDeductionDef[]
  season?: SeasonBrief
  seasonId?: string
  seasonYear?: number
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
  seasonYear?: number
}

/** 삭제 안내용 기록 건수 */
export interface WorkerRecordSummary {
  workerId: string
  name: string
  hasAccount: boolean
  seasons: number
  settlements: number
  confirmedSettlements: number
  advances: number
  dayOverrides: number
  extraCosts: number
}

/** 기타 고용비용 (항공권·비자 등) — 연간 결산 총 고용비용에 합산 */
export interface ExtraCost {
  id: string
  year: number
  date: string | null
  workerId: string | null
  workerName?: string | null
  label: string
  amount: number
  note: string | null
}

export interface SaveExtraCostPayload {
  year: number
  date?: string | null
  workerId?: string | null
  label: string
  amount: number
  note?: string | null
}
