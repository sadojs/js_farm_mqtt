import apiClient from '@/api/client'
import type {
  BoardCell,
  CreateLogDto,
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
  deleteTaskType: (id: string) =>
    apiClient.delete<{ ok: true; hidden?: boolean }>(`/work-log/task-types/${id}`),
  listLogs: (params?: { zoneId?: string; taskTypeId?: string; from?: string; to?: string; limit?: number }) =>
    apiClient.get<WorkLog[]>('/work-log/logs', { params }),
  listByMonth: (month: string) =>
    apiClient.get<WorkLog[]>('/work-log/logs/by-month', { params: { month } }),
  createLog: (dto: CreateLogDto) => apiClient.post<WorkLog>('/work-log/logs', dto),
  deleteLog: (id: string) => apiClient.delete<{ ok: true }>(`/work-log/logs/${id}`),
  board: () => apiClient.get<BoardCell[]>('/work-log/board'),
}
