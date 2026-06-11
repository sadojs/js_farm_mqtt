import apiClient from '../../../api/client'
import type {
  Worker,
  SaveWorkerPayload,
  Advance,
  CalendarResponse,
  SettlementResponse,
  SettlementHistoryItem,
  DayStatus,
} from '../types/worker-payroll.types'

export const workerPayrollApi = {
  // ── 일꾼 ──
  listWorkers(): Promise<Worker[]> {
    return apiClient.get('/worker-payroll/workers').then((r) => r.data)
  },
  /** 일꾼 본인 프로필 (farm_user) — 없으면 null */
  getMe(): Promise<Worker | null> {
    return apiClient.get('/worker-payroll/me').then((r) => r.data)
  },
  getWorker(id: string): Promise<Worker> {
    return apiClient.get(`/worker-payroll/workers/${id}`).then((r) => r.data)
  },
  saveWorker(payload: SaveWorkerPayload): Promise<Worker> {
    return apiClient.post('/worker-payroll/workers', payload).then((r) => r.data)
  },
  removeWorker(id: string): Promise<void> {
    return apiClient.delete(`/worker-payroll/workers/${id}`).then(() => undefined)
  },

  // ── 가불 ──
  listAdvances(workerId: string): Promise<Advance[]> {
    return apiClient.get(`/worker-payroll/workers/${workerId}/advances`).then((r) => r.data)
  },
  addAdvance(
    workerId: string,
    payload: { date: string; amount: number; note?: string },
  ): Promise<Advance> {
    return apiClient
      .post(`/worker-payroll/workers/${workerId}/advances`, payload)
      .then((r) => r.data)
  },
  removeAdvance(advanceId: string): Promise<void> {
    return apiClient.delete(`/worker-payroll/advances/${advanceId}`).then(() => undefined)
  },

  // ── 일자 근무 설정 (관리자) ──
  setDay(
    workerId: string,
    payload: { date: string; status: DayStatus; hours?: number },
  ): Promise<unknown> {
    return apiClient
      .post(`/worker-payroll/workers/${workerId}/day`, payload)
      .then((r) => r.data)
  },

  // ── 달력 / 정산 ──
  getCalendar(workerId: string, periodStart?: string): Promise<CalendarResponse> {
    return apiClient
      .get(`/worker-payroll/workers/${workerId}/calendar`, { params: { periodStart } })
      .then((r) => r.data)
  },
  getSettlement(workerId: string, periodStart?: string): Promise<SettlementResponse> {
    return apiClient
      .get(`/worker-payroll/workers/${workerId}/settlement`, { params: { periodStart } })
      .then((r) => r.data)
  },
  requestSettlement(workerId: string, periodStart?: string): Promise<unknown> {
    return apiClient
      .post(`/worker-payroll/workers/${workerId}/settlement/request`, { periodStart })
      .then((r) => r.data)
  },
  approveSettlement(workerId: string, periodStart?: string): Promise<unknown> {
    return apiClient
      .post(`/worker-payroll/workers/${workerId}/settlement/approve`, { periodStart })
      .then((r) => r.data)
  },
  listSettlements(): Promise<SettlementHistoryItem[]> {
    return apiClient.get('/worker-payroll/settlements').then((r) => r.data)
  },
}
