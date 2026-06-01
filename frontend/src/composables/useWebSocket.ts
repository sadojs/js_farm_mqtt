import { ref, onUnmounted, readonly } from 'vue'
import { io, Socket } from 'socket.io-client'
import { useAuthStore } from '../stores/auth.store'
import { useSensorStore } from '../stores/sensor.store'
import { useDeviceStore } from '../stores/device.store'
import { useNotificationStore } from '../stores/notification.store'
import { useAutomationStore } from '../stores/automation.store'

let socket: Socket | null = null

/** 전역 연결 상태 (reactive) */
const _connected = ref(false)
const _reconnecting = ref(false)
const _reconnectAttempts = ref(0)

type GpioStatusHandler = (data: { gatewayId: string; slot: string; pin: number; state: boolean; auto?: boolean }) => void
const gpioStatusHandlers = new Set<GpioStatusHandler>()

export function onGpioStatus(fn: GpioStatusHandler) {
  gpioStatusHandlers.add(fn)
  return () => gpioStatusHandlers.delete(fn)
}

// rpi-emergency-failover: 폴백 모드 변경 핸들러
type FallbackModeHandler = (data: {
  gatewayId: string
  mode: 'online' | 'fallback' | 'unknown'
  modeChangedAt: string
}) => void
const fallbackModeHandlers = new Set<FallbackModeHandler>()
export function onFallbackModeChanged(fn: FallbackModeHandler) {
  fallbackModeHandlers.add(fn)
  return () => fallbackModeHandlers.delete(fn)
}

type FallbackEventHandler = (data: {
  gatewayId: string
  eventType: string
  payload: Record<string, unknown>
  occurredAt: string
}) => void
const fallbackEventHandlers = new Set<FallbackEventHandler>()
export function onFallbackEvent(fn: FallbackEventHandler) {
  fallbackEventHandlers.add(fn)
  return () => fallbackEventHandlers.delete(fn)
}

export const socketStatus = readonly({
  connected: _connected,
  reconnecting: _reconnecting,
  reconnectAttempts: _reconnectAttempts,
})

export function useWebSocket() {
  const authStore = useAuthStore()

  function connect() {
    if (socket?.connected) return

    const wsUrl = import.meta.env.VITE_WS_URL || 'http://localhost:3100'
    socket = io(wsUrl, {
      auth: { token: authStore.accessToken },
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
      timeout: 10000,
    })

    socket.on('connect', () => {
      _connected.value = true
      _reconnecting.value = false
      _reconnectAttempts.value = 0
    })

    socket.on('disconnect', (reason) => {
      _connected.value = false
      // 서버 측 종료가 아니면 자동 재연결
      if (reason === 'io server disconnect') {
        // 서버가 강제 종료한 경우 → 토큰 갱신 후 재연결 시도
        setTimeout(() => {
          if (authStore.accessToken) {
            socket!.auth = { token: authStore.accessToken }
            socket!.connect()
          }
        }, 2000)
      }
    })

    socket.io.on('reconnect_attempt', (attempt) => {
      _reconnecting.value = true
      _reconnectAttempts.value = attempt
    })

    socket.io.on('reconnect', () => {
      _connected.value = true
      _reconnecting.value = false
      _reconnectAttempts.value = 0
      const notificationStore = useNotificationStore()
      notificationStore.success('연결 복구', '서버와 다시 연결되었습니다.')
    })

    socket.io.on('reconnect_failed', () => {
      _reconnecting.value = false
      const notificationStore = useNotificationStore()
      notificationStore.error('연결 실패', '서버와 연결할 수 없습니다. 페이지를 새로고침 해주세요.')
    })

    socket.on('connect_error', (err) => {
      _connected.value = false
      console.warn('WebSocket 연결 오류:', err.message)
    })

    // 센서 데이터 실시간 업데이트
    socket.on('sensor:update', (data) => {
      const sensorStore = useSensorStore()
      sensorStore.updateSensorRealtimeData(data.deviceId, data)

      const deviceStore = useDeviceStore()
      deviceStore.updateSensorData(data.deviceId, data.sensorType, data.value)
    })

    // 장치 온라인 상태 변경
    socket.on('device:status', (data) => {
      const deviceStore = useDeviceStore()
      deviceStore.updateDeviceStatus(data.deviceId, data.online)
    })

    // 룰이 발행한 GPIO 토글 → device 카드 실시간 갱신
    socket.on('device:switch-update', (data: {
      deviceId: string;
      switchState: boolean | null;
      switchStates?: Record<string, boolean> | null;
      online?: boolean;
    }) => {
      const deviceStore = useDeviceStore()
      const dev = deviceStore.devices.find(d => d.id === data.deviceId)
      if (dev) {
        if (data.switchState !== null && data.switchState !== undefined) {
          (dev as any).switchState = data.switchState
        }
        if (data.switchStates) {
          (dev as any).switchStates = { ...((dev as any).switchStates ?? {}), ...data.switchStates }
        }
        if (typeof data.online === 'boolean') (dev as any).online = data.online
      }
    })

    // device-replacement: 장치 교체 완료 — device store 새로고침 + 알림
    socket.on('device:replaced', (data: {
      deviceId: string
      oldIeee: string
      newIeee: string
      preservedRules: number
      pairedDeviceId?: string | null
      childrenIds?: string[]
    }) => {
      const deviceStore = useDeviceStore()
      // 영향 받은 device들 재로드
      deviceStore.fetchDevices().catch(() => undefined)
      const notificationStore = useNotificationStore()
      notificationStore.info(
        '장치 교체 완료',
        `자동제어룰 ${data.preservedRules}개가 보존되었습니다.`,
      )
    })

    // 자동화 실행 알림
    socket.on('automation:executed', (data) => {
      const notificationStore = useNotificationStore()
      if (data.success) {
        notificationStore.info('자동 제어 실행', `규칙 "${data.ruleName}" 이 실행되었습니다.`)
      } else {
        notificationStore.warning('자동 제어 실행 실패', `규칙 "${data.ruleName}" 실행에 실패했습니다.`)
      }
    })

    // 관수 시작/종료 실시간 이벤트
    socket.on('irrigation:started', (data) => {
      const automationStore = useAutomationStore()
      const status = automationStore.irrigationStatus.find(
        s => s.tuyaDeviceId === data.tuyaDeviceId
      )
      if (status) {
        status.isRunning = true
        status.runningRule = {
          ruleId: data.ruleId,
          ruleName: data.ruleName,
          startedAt: data.startedAt,
          estimatedEndAt: data.estimatedEndAt,
        }
      }
    })

    socket.on('irrigation:stopped', (data) => {
      const automationStore = useAutomationStore()
      const status = automationStore.irrigationStatus.find(
        s => s.tuyaDeviceId === data.tuyaDeviceId
      )
      if (status) {
        status.isRunning = false
        status.runningRule = undefined
      }
    })

    // GPIO 핀 상태 (admin 핀 테스트 피드백)
    socket.on('gpio:status', (data: { gatewayId: string; slot: string; pin: number; state: boolean; auto?: boolean }) => {
      gpioStatusHandlers.forEach(fn => fn(data))
    })

    // rpi-emergency-failover: 폴백 모드 변경
    socket.on('fallback:mode-changed', (data: Parameters<FallbackModeHandler>[0]) => {
      fallbackModeHandlers.forEach(fn => fn(data))
    })
    socket.on('fallback:event', (data: Parameters<FallbackEventHandler>[0]) => {
      fallbackEventHandlers.forEach(fn => fn(data))
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
    _connected.value = false
    _reconnecting.value = false
    _reconnectAttempts.value = 0
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
    connected: socketStatus.connected,
    reconnecting: socketStatus.reconnecting,
    reconnectAttempts: socketStatus.reconnectAttempts,
    connect,
    disconnect,
    subscribe,
    unsubscribe,
    on,
    off,
  }
}
