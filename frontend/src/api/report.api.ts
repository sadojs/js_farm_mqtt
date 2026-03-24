import apiClient from './client'

export interface ReportParams {
  groupId?: string
  sensorType?: string
  startDate: string
  endDate: string
}

export const reportApi = {
  getStatistics: (params: ReportParams) =>
    apiClient.get('/reports/statistics', { params }),

  getHourlyData: (params: ReportParams) =>
    apiClient.get('/reports/hourly', { params }),

  getActuatorStats: (params: Omit<ReportParams, 'sensorType'>) =>
    apiClient.get('/reports/actuator-stats', { params }),

  exportCsv: (params: ReportParams) =>
    apiClient.get('/reports/export/csv', {
      params,
      responseType: 'blob',
    }),

  getWeatherHourly: (params: Pick<ReportParams, 'startDate' | 'endDate'>) =>
    apiClient.get('/reports/weather-hourly', { params }),
}
