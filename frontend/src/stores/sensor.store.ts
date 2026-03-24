import { ref } from 'vue'
import { defineStore } from 'pinia'
import { sensorApi } from '../api/sensor.api'
import type { SensorDataPoint, SensorQueryParams, SensorStatistics, LatestSensorData } from '../types/sensor.types'

export const useSensorStore = defineStore('sensor', () => {
  const sensorData = ref<SensorDataPoint[]>([])
  const statistics = ref<SensorStatistics | null>(null)
  const latestData = ref<LatestSensorData>({})
  const loading = ref(false)

  async function fetchSensorData(params: SensorQueryParams) {
    loading.value = true
    try {
      const { data } = await sensorApi.getData(params)
      sensorData.value = data.data
      statistics.value = data.statistics
      return data
    } finally {
      loading.value = false
    }
  }

  async function fetchLatestData() {
    try {
      const { data } = await sensorApi.getLatest()
      latestData.value = data
    } catch {
      // silent fail for dashboard refresh
    }
  }

  function updateSensorRealtimeData(deviceId: string, point: SensorDataPoint) {
    latestData.value = {
      ...latestData.value,
      [deviceId]: {
        sensorType: point.sensorType,
        value: point.value,
        unit: point.unit,
        status: point.status,
        time: point.time,
      },
    }
  }

  return {
    sensorData,
    statistics,
    latestData,
    loading,
    fetchSensorData,
    fetchLatestData,
    updateSensorRealtimeData,
  }
})
