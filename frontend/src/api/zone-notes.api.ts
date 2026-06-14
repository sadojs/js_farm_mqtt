import apiClient from './client'
import type {
  ZoneNote,
  CreateZoneNotePayload,
  UpdateZoneNotePayload,
} from '../types/zone-note.types'

export const zoneNotesApi = {
  list: (zoneId: string) =>
    apiClient.get<ZoneNote[]>('/zone-notes', { params: { zoneId } }),
  counts: () => apiClient.get<Record<string, number>>('/zone-notes/counts'),
  create: (dto: CreateZoneNotePayload) => apiClient.post<ZoneNote>('/zone-notes', dto),
  update: (id: string, dto: UpdateZoneNotePayload) =>
    apiClient.put<ZoneNote>(`/zone-notes/${id}`, dto),
  remove: (id: string) => apiClient.delete<{ ok: true }>(`/zone-notes/${id}`),
}
