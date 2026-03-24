import apiClient from './client'

export interface DashboardWeatherResponse {
  location: {
    address: string
    level1: string
    level2: string
    level3: string
    nx: number
    ny: number
    longitude: number
    latitude: number
  }
  weather: {
    temperature: number | null
    humidity: number | null
    precipitation: number | null
    windSpeed: number | null
    condition: string
  }
  fetchedAt: string
  source: {
    baseDate: string
    baseTime: string
    endpoint: string
  }
}

export interface WidgetDataResponse {
  inside: {
    temperature: number | null
    humidity: number | null
    dewPoint: number | null
    uv: number | null
    rainfall: number | null
  } | null
  history: {
    temperature: number | null
    humidity: number | null
    timestamp: string | null
  } | null
  trend6h: {
    temperature: { time: string; value: number }[]
    humidity: { time: string; value: number }[]
    uv: { time: string; value: number }[]
  } | null
  uvStats14d: { min: number; max: number } | null
}

export const dashboardApi = {
  getWeather: () => apiClient.get<DashboardWeatherResponse>('/dashboard/weather'),
  getWidgets: () => apiClient.get<WidgetDataResponse>('/dashboard/widgets'),
}
