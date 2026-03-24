import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { deviceApi } from '../api/device.api'
import type { Device } from '../types/device.types'

export const useDeviceStore = defineStore('device', () => {
  const devices = ref<Device[]>([])
  const loading = ref(false)

  const onlineDevices = computed(() => devices.value.filter(d => d.online))
  const sensorDevices = computed(() => devices.value.filter(d => d.deviceType === 'sensor'))
  const actuatorDevices = computed(() => devices.value.filter(d => d.deviceType === 'actuator'))

  function getDevicesByHouse(houseId: string) {
    return devices.value.filter(d => d.houseId === houseId)
  }

  async function fetchDevices() {
    loading.value = true
    try {
      const { data } = await deviceApi.getAll()
      devices.value = data
    } finally {
      loading.value = false
    }
  }

  async function registerDevices(deviceList: any[], houseId?: string) {
    const { data } = await deviceApi.register(deviceList, houseId)
    await fetchDevices()
    return data
  }

  async function removeDevice(id: string) {
    await deviceApi.remove(id)
    devices.value = devices.value.filter(d => d.id !== id)
  }

  async function controlDevice(deviceId: string, commands: { code: string; value: any }[]) {
    const { data } = await deviceApi.control(deviceId, commands)
    return data as { success: boolean; result?: any; msg?: string; code?: number; t?: number; tid?: string }
  }

  async function verifyDeviceStatus(
    deviceId: string,
    switchCode: string,
    expectedValue: boolean
  ): Promise<{ verified: boolean; actualValue?: boolean }> {
    await new Promise(resolve => setTimeout(resolve, 1000))

    const data = await fetchDeviceStatus(deviceId)
    if (!data || !data.success) {
      return { verified: false }
    }

    const status = data.status?.find((s: any) => s.code === switchCode)
    if (!status) return { verified: false }

    return {
      verified: status.value === expectedValue,
      actualValue: status.value,
    }
  }

  function updateDeviceStatus(deviceId: string, online: boolean) {
    const device = devices.value.find(d => d.id === deviceId)
    if (device) {
      device.online = online
    }
  }

  async function fetchDeviceStatus(deviceId: string) {
    try {
      const { data } = await deviceApi.getStatus(deviceId) as any
      if (data.success && Array.isArray(data.status)) {
        const device = devices.value.find(d => d.id === deviceId)
        if (device) {
          // 액추에이터: switch 상태
          const switchStatus = data.status.find(
            (s: any) => s.code === 'switch_1' || s.code === 'switch'
          )
          if (switchStatus !== undefined) {
            device.switchState = switchStatus.value
          }

          // 관수 장비: 개별 스위치 상태 저장
          if (device.equipmentType === 'irrigation') {
            const states: Record<string, boolean> = {}
            for (const s of data.status) {
              if (typeof s.value === 'boolean' && (s.code.startsWith('switch_') || s.code.startsWith('switch_usb'))) {
                states[s.code] = s.value
              }
            }
            device.switchStates = states
          }

          // 센서: Tuya 코드를 센서 필드로 매핑 (확장 가능)
          if (device.deviceType === 'sensor') {
            const TUYA_SENSOR_MAP: Record<string, { field: string; divisor: number }> = {
              // hjjcy 센서 (내부 온습도)
              'va_temperature': { field: 'temperature', divisor: 10 },
              'temp_current': { field: 'temperature', divisor: 10 },
              'va_humidity': { field: 'humidity', divisor: 1 },
              'humidity_value': { field: 'humidity', divisor: 1 },
              'co2_value': { field: 'co2', divisor: 1 },
              // qxj 센서 (외부 온습도)
              'temp_current_external': { field: 'temperature', divisor: 10 },
              'humidity_outdoor': { field: 'humidity', divisor: 1 },
              'rain_1h': { field: 'rainfall', divisor: 10 },
              'uv_index': { field: 'uv', divisor: 1 },
              'dew_point_temp': { field: 'dew_point', divisor: 10 },
            }
            const sensorData: Record<string, number | null> = {}
            for (const s of data.status) {
              const mapping = TUYA_SENSOR_MAP[s.code]
              if (mapping) {
                sensorData[mapping.field] = Number(s.value) / mapping.divisor
              }
              // 매핑에 없는 코드는 무시
            }
            device.sensorData = Object.keys(sensorData).length > 0 ? sensorData : null
          }
        }
      }
      return data
    } catch {
      return null
    }
  }

  async function fetchAllActuatorStatuses() {
    const actuators = devices.value.filter(d => d.deviceType === 'actuator' && d.online)
    await Promise.allSettled(actuators.map(d => fetchDeviceStatus(d.id)))
  }

  async function fetchAllSensorStatuses() {
    const sensors = devices.value.filter(d => d.deviceType === 'sensor' && d.online)
    await Promise.allSettled(sensors.map(d => fetchDeviceStatus(d.id)))
  }

  return {
    devices,
    loading,
    onlineDevices,
    sensorDevices,
    actuatorDevices,
    getDevicesByHouse,
    fetchDevices,
    registerDevices,
    removeDevice,
    controlDevice,
    verifyDeviceStatus,
    updateDeviceStatus,
    fetchDeviceStatus,
    fetchAllActuatorStatuses,
    fetchAllSensorStatuses,
  }
})
