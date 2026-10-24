import apiClient from '@/api/client'
import type {
  BoardCell,
  CreateLogDto,
  UpdateLogDto,
  Palette,
  UpsertTaskTypeDto,
  WorkLog,
  WorkTaskType,
} from '../types/work-log.types'

export const workLogApi = {
  palette: () => apiClient.get<Palette>('/work-log/palette'),
  listTaskTypes: () => apiClient.get<WorkTaskType[]>('/work-log/task-types'),
  createTaskType: (dto: UpsertTaskTypeDto) =>
    apiClient.post<WorkTaskType>('/work-log/task-types', dto),
  updateTaskType: (id: string, dto: UpsertTaskTypeDto) =>
    apiClient.put<WorkTaskType>(`/work-log/task-types/${id}`, dto),
  toggleHidden: (id: string, hidden: boolean) =>
    apiClient.patch<WorkTaskType>(`/work-log/task-types/${id}/hidden`, { hidden }),
  /** 기록이 있는 작업은 409(TASK_TYPE_IN_USE, count) → withLogs=true 로 기록과 함께 삭제 */
  deleteTaskType: (id: string, withLogs = false) =>
    apiClient.delete<{ ok: true; deletedLogs: number }>(`/work-log/task-types/${id}`, withLogs ? { params: { withLogs: 'true' } } : undefined),
  /** 농작업 초기화 — 기록 전부 삭제(작업 종류 유지) */
  resetLogs: () => apiClient.delete<{ ok: true; deleted: number }>('/work-log/logs'),
  listLogs: (params?: { zoneId?: string; taskTypeId?: string; from?: string; to?: string; limit?: number }) =>
    apiClient.get<WorkLog[]>('/work-log/logs', { params }),
  listByMonth: (month: string) =>
    apiClient.get<WorkLog[]>('/work-log/logs/by-month', { params: { month } }),
  createLog: (dto: CreateLogDto) => apiClient.post<WorkLog>('/work-log/logs', dto),
  updateLog: (id: string, dto: UpdateLogDto) => apiClient.put<WorkLog>(`/work-log/logs/${id}`, dto),
  deleteLog: (id: string) => apiClient.delete<{ ok: true }>(`/work-log/logs/${id}`),
  board: () => apiClient.get<BoardCell[]>('/work-log/board'),
}
