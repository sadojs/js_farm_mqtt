import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { deviceApi } from '../api/device.api'
import { sensorApi } from '../api/sensor.api'
import type { Device, ChannelMapping } from '../types/device.types'
import { DEFAULT_CHANNEL_MAPPING } from '../types/device.types'

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
      await loadLatestSensorData()
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

  /** 페이지 로드 시 최신 센서값을 API에서 일괄 로드 */
  async function loadLatestSensorData() {
    try {
      const { data } = await sensorApi.getLatest() as any
      const rows: { device_id: string; sensor_type: string; value: number }[] = Array.isArray(data) ? data : (data?.data ?? [])
      for (const row of rows) {
        updateSensorData(row.device_id, row.sensor_type, Number(row.value))
      }
    } catch {
      // 실패 시 무시 — WebSocket 이벤트로 이후 보완됨
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

  function getEffectiveMapping(device: Device): ChannelMapping {
    return device.channelMapping
      ? { ...DEFAULT_CHANNEL_MAPPING, ...device.channelMapping }
      : { ...DEFAULT_CHANNEL_MAPPING }
  }

  async function updateChannelMapping(deviceId: string, mapping: ChannelMapping) {
    await deviceApi.updateChannelMapping(deviceId, mapping)
    const device = devices.value.find(d => d.id === deviceId)
    if (device) device.channelMapping = mapping
  }

  /** 제어 후 장치 상태 검증 (1초 대기 후 상태 확인) */
  async function verifyDeviceStatus(deviceId: string, switchCode: string, expectedValue: boolean) {
    try {
      await new Promise(resolve => setTimeout(resolve, 1000))
      const status = await fetchDeviceStatus(deviceId)
      if (!status) return { verified: false }
      const actualValue = status[switchCode] ?? status.state === 'ON'
      return { verified: actualValue === expectedValue, actualValue }
    } catch {
      return { verified: false }
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
    loadLatestSensorData,
    fetchDeviceStatus,
    verifyDeviceStatus,
    getEffectiveMapping,
    updateChannelMapping,
  }
})
