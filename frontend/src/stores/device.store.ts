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

  function getDevicesByGateway(gatewayId: string) {
    return devices.value.filter(d => d.gatewayId === gatewayId)
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
    return data
  }

  function updateDeviceStatus(deviceId: string, online: boolean) {
    const device = devices.value.find(d => d.id === deviceId)
    if (device) {
      device.online = online
    }
  }

  /** MQTT에서 센서 데이터를 WebSocket으로 수신하여 업데이트 */
  function updateSensorData(deviceId: string, sensorType: string, value: number) {
    const device = devices.value.find(d => d.id === deviceId)
    if (device) {
      if (!device.sensorData) device.sensorData = {}
      device.sensorData[sensorType] = value
    }
  }

  async function fetchDeviceStatus(deviceId: string) {
    try {
      const { data } = await deviceApi.getStatus(deviceId) as any
      return data
    } catch {
      return null
    }
  }

  return {
    devices,
    loading,
    onlineDevices,
    sensorDevices,
    actuatorDevices,
    getDevicesByHouse,
    getDevicesByGateway,
    fetchDevices,
    registerDevices,
    removeDevice,
    controlDevice,
    updateDeviceStatus,
    updateSensorData,
    fetchDeviceStatus,
  }
})
