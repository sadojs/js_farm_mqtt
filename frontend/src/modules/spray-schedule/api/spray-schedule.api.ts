import apiClient from '../../../api/client'
import type {
  SprayZone,
  SaveZonePayload,
  SprayEvent,
  ZoneMarker,
  CreateManualEventPayload,
  MoveMode,
} from '../types/spray-schedule.types'

export const sprayScheduleApi = {
  // ── 구역 / 프로그램 / 약품 ──
  getZones(): Promise<SprayZone[]> {
    return apiClient.get('/spray-schedule/zones').then((r) => r.data)
  },
  saveZone(payload: SaveZonePayload): Promise<SprayZone> {
    return apiClient.post('/spray-schedule/zones', payload).then((r) => r.data)
  },
  deleteZone(id: string): Promise<void> {
    return apiClient.delete(`/spray-schedule/zones/${id}`).then(() => undefined)
  },
  getZoneMarkers(): Promise<ZoneMarker[]> {
    return apiClient.get('/spray-schedule/zones/markers').then((r) => r.data)
  },

  // ── 달력 이벤트 ──
  getEvents(from?: string, to?: string): Promise<SprayEvent[]> {
    return apiClient
      .get('/spray-schedule/events', { params: { from, to } })
      .then((r) => r.data)
  },
  createManualEvent(payload: CreateManualEventPayload): Promise<SprayEvent> {
    return apiClient.post('/spray-schedule/events', payload).then((r) => r.data)
  },
  moveEvent(id: string, date: string, mode: MoveMode): Promise<SprayEvent> {
    return apiClient
      .patch(`/spray-schedule/events/${id}/move`, { date, mode })
      .then((r) => r.data)
  },
  deleteEvent(id: string): Promise<void> {
    return apiClient.delete(`/spray-schedule/events/${id}`).then(() => undefined)
  },
}
