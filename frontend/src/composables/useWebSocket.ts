import { ref, onUnmounted } from 'vue'
import { io, Socket } from 'socket.io-client'
import { useAuthStore } from '../stores/auth.store'
import { useSensorStore } from '../stores/sensor.store'
import { useDeviceStore } from '../stores/device.store'
import { useNotificationStore } from '../stores/notification.store'

let socket: Socket | null = null

export function useWebSocket() {
  const connected = ref(false)
  const authStore = useAuthStore()

  function connect() {
    if (socket?.connected) return

    const wsUrl = import.meta.env.VITE_WS_URL || 'http://localhost:3000'
    socket = io(wsUrl, {
      auth: { token: authStore.accessToken },
      transports: ['websocket'],
    })

    socket.on('connect', () => {
      connected.value = true
    })

    socket.on('disconnect', () => {
      connected.value = false
    })

    // 센서 데이터 실시간 업데이트
    socket.on('sensor:update', (data) => {
      const sensorStore = useSensorStore()
      sensorStore.updateSensorRealtimeData(data.deviceId, data)
    })

    // 장비 온라인 상태 변경
    socket.on('device:status', (data) => {
      const deviceStore = useDeviceStore()
      deviceStore.updateDeviceStatus(data.deviceId, data.online)
    })

    // 자동화 실행 알림
    socket.on('automation:executed', (data) => {
      const notificationStore = useNotificationStore()
      if (data.success) {
        notificationStore.info('자동화 실행', `규칙 "${data.ruleName}" 이 실행되었습니다.`)
      } else {
        notificationStore.warning('자동화 실행 실패', `규칙 "${data.ruleName}" 실행에 실패했습니다.`)
      }
    })

    // 일반 알림
    socket.on('notification:new', (data) => {
      const notificationStore = useNotificationStore()
      notificationStore.add(data.type || 'info', data.title, data.message)
    })
  }

  function disconnect() {
    socket?.disconnect()
    socket = null
    connected.value = false
  }

  function subscribe(channel: string, id: string) {
    socket?.emit(`subscribe:${channel}`, { [`${channel}Id`]: id })
  }

  function unsubscribe(channel: string) {
    socket?.emit('unsubscribe', { channel })
  }

  function on(event: string, handler: (...args: any[]) => void) {
    socket?.on(event, handler)
  }

  function off(event: string, handler: (...args: any[]) => void) {
    socket?.off(event, handler)
  }

  onUnmounted(() => {
    // Component-level cleanup is not needed for global socket
  })

  return {
    connected,
    connect,
    disconnect,
    subscribe,
    unsubscribe,
    on,
    off,
  }
}
