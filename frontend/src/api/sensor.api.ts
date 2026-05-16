import apiClient from './client'
import type { SensorQueryParams, SensorDataResponse, LatestSensorData } from '../types/sensor.types'

export const sensorApi = {
  getData: (params: SensorQueryParams) =>
    apiClient.get<SensorDataResponse>('/sensor-data', { params }),

  getLatest: (params?: { deviceId?: string; groupId?: string }) =>
    apiClient.get<LatestSensorData>('/sensor-data/latest', { params }),
}
