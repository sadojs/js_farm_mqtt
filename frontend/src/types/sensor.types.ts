export type SensorType = 'temperature' | 'humidity' | 'co2' | 'light' | 'soil_moisture' | 'soil_temperature' | 'wind_speed' | 'rainfall' | 'ph' | 'ec' | string

export type SensorStatus = 'normal' | 'warning' | 'critical'

export type Aggregation = 'raw' | 'hourly' | 'daily'

export interface SensorDataPoint {
  time: string
  deviceId: string
  sensorType: SensorType
  value: number
  unit: string
  status: SensorStatus
}

export interface SensorQueryParams {
  sensorType?: SensorType
  startTime: string
  endTime: string
  aggregation?: Aggregation
  deviceId?: string
  groupId?: string
  houseId?: string
  page?: number
  limit?: number
}

export interface SensorStatistics {
  avg: number
  min: number
  max: number
  count: number
  stddev?: number
}

export interface SensorDataResponse {
  data: SensorDataPoint[]
  statistics: SensorStatistics
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

export interface LatestSensorData {
  [deviceId: string]: {
    sensorType: SensorType
    value: number
    unit: string
    status: SensorStatus
    time: string
  }
}
