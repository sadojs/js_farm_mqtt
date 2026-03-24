import apiClient from './client'

export interface SensorAlert {
  id: string
  userId: string
  deviceId: string
  deviceName: string | null
  sensorType: string
  alertType: 'no_data' | 'flatline' | 'spike' | 'out_of_range'
  severity: 'warning' | 'critical'
  message: string
  value: number | null
  threshold: string | null
  resolved: boolean
  resolvedAt: string | null
  snoozedUntil: string | null
  createdAt: string
}

export interface AlertDetail extends SensorAlert {
  stats24h: {
    min_value: number | null
    max_value: number | null
    delta: number | null
    last_value: number | null
  } | null
  actionGuides: string[]
}

export interface SensorEntry {
  deviceId: string
  deviceName: string
  sensorType: string
  latestValue: number | null
  unit: string
  lastSeen: string | null
  standby: boolean
}

export const sensorAlertsApi = {
  getSensors: () =>
    apiClient.get<SensorEntry[]>('/sensor-alerts/sensors'),
  addStandby: (deviceId: string, sensorType: string) =>
    apiClient.put('/sensor-alerts/sensors/standby', { deviceId, sensorType }),
  removeStandby: (deviceId: string, sensorType: string) =>
    apiClient.delete('/sensor-alerts/sensors/standby', { data: { deviceId, sensorType } }),
  getAlerts: (params?: { severity?: string; resolved?: string; deviceId?: string }) =>
    apiClient.get<SensorAlert[]>('/sensor-alerts', { params }),
  getAlert: (id: string) =>
    apiClient.get<AlertDetail>(`/sensor-alerts/${id}`),
  resolveAlert: (id: string) =>
    apiClient.put(`/sensor-alerts/${id}/resolve`),
  snoozeAlert: (id: string, days: number) =>
    apiClient.put(`/sensor-alerts/${id}/snooze`, { days }),
  removeAlert: (id: string) =>
    apiClient.delete(`/sensor-alerts/${id}`),
}
