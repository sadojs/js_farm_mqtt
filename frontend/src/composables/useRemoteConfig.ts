import { ref, onUnmounted } from 'vue'
import { useWebSocket } from './useWebSocket'
import {
  configDeployApi,
  type ConfigAction,
  type RemoteConfigResponseEvent,
  type RemoteConfigStatus,
} from '../api/config-deploy.api'
import { useNotificationStore } from '../stores/notification.store'

export interface RemoteConfigState {
  status: RemoteConfigStatus | 'idle'
  requestId?: string
  detail?: string
  appliedAt?: string
  pingResult?: { tried: number; ok: number }
}

const INITIAL: RemoteConfigState = { status: 'idle' }

/**
 * 게이트웨이별 원격 설정 4종 mutation + WS 응답 통합.
 * 사용 예: const { state, applyWifi } = useRemoteConfig(gatewayId)
 */
export function useRemoteConfig(gatewayId: string) {
  const notif = useNotificationStore()
  const { on, off } = useWebSocket()

  /** action별 상태 (wifi / hostname / gateway-id / server-ip 모두 같은 카드 안에서 분리 추적) */
  const states = ref<Record<ConfigAction, RemoteConfigState>>({
    get_config: { ...INITIAL },
    update_config: { ...INITIAL },
    wifi_update: { ...INITIAL },
    hostname_update: { ...INITIAL },
    gateway_id_update: { ...INITIAL },
    identity_update: { ...INITIAL },
    server_ip_update: { ...INITIAL },
  })

  const eventName = `config:response:${gatewayId}`

  function onResponse(payload: RemoteConfigResponseEvent) {
    if (!payload || payload.gatewayId !== gatewayId) return
    const s = states.value[payload.action]
    if (!s) return
    if (s.requestId && s.requestId !== payload.requestId) return // 다른 요청

    s.status = payload.status
    s.detail = payload.detail
    s.appliedAt = payload.appliedAt
    s.pingResult = payload.pingResult

    const label = actionLabel(payload.action)
    if (payload.status === 'applied_online' || payload.status === 'success') {
      notif.success(`${label} 적용 완료`, payload.detail ?? '')
    } else if (payload.status === 'applied_no_internet') {
      notif.warning(
        `${label} 적용 (인터넷 없음)`,
        'Pi가 새 Wi-Fi에는 연결되었으나 인터넷이 확인되지 않았습니다. 농장으로 이동 후 자동 연결을 기다리세요.',
      )
    } else if (payload.status === 'failed' || payload.status === 'rolled_back') {
      notif.error(`${label} 실패`, payload.detail ?? '응답 시간 초과')
    }
  }

  on(eventName, onResponse)
  onUnmounted(() => off(eventName, onResponse))

  function markRequested(action: ConfigAction, requestId: string) {
    states.value[action] = {
      status: 'pending',
      requestId,
      detail: undefined,
      appliedAt: undefined,
      pingResult: undefined,
    }
  }

  async function applyWifi(ssid: string, password: string) {
    try {
      const { data } = await configDeployApi.updateWifi(gatewayId, ssid, password)
      markRequested('wifi_update', data.requestId)
      return data
    } catch (err: any) {
      notif.error('Wi-Fi 변경 요청 실패', err?.response?.data?.message ?? err?.message ?? 'unknown')
      states.value.wifi_update.status = 'failed'
      throw err
    }
  }

  async function applyHostname(hostname: string) {
    try {
      const { data } = await configDeployApi.updateHostname(gatewayId, hostname)
      markRequested('hostname_update', data.requestId)
      return data
    } catch (err: any) {
      notif.error('Hostname 변경 요청 실패', err?.response?.data?.message ?? err?.message ?? 'unknown')
      states.value.hostname_update.status = 'failed'
      throw err
    }
  }

  async function applyGatewayId(newGatewayId: string) {
    try {
      const { data } = await configDeployApi.updateGatewayId(gatewayId, newGatewayId)
      markRequested('gateway_id_update', data.requestId)
      return data
    } catch (err: any) {
      notif.error('Gateway ID 변경 요청 실패', err?.response?.data?.message ?? err?.message ?? 'unknown')
      states.value.gateway_id_update.status = 'failed'
      throw err
    }
  }

  async function applyServerIp(newServerIp: string) {
    try {
      const { data } = await configDeployApi.updateServerIp(gatewayId, newServerIp)
      markRequested('server_ip_update', data.requestId)
      return data
    } catch (err: any) {
      notif.error('Server IP 변경 요청 실패', err?.response?.data?.message ?? err?.message ?? 'unknown')
      states.value.server_ip_update.status = 'failed'
      throw err
    }
  }

  /** rpi-hostname-gateway-id-unify: hostname + gateway-id 통합 배포 */
  async function applyIdentity(name: string) {
    try {
      const { data } = await configDeployApi.updateIdentity(gatewayId, name)
      markRequested('identity_update', data.requestId)
      return data
    } catch (err: any) {
      notif.error('게이트웨이 이름 변경 요청 실패', err?.response?.data?.message ?? err?.message ?? 'unknown')
      states.value.identity_update.status = 'failed'
      throw err
    }
  }

  return {
    states,
    applyWifi,
    applyHostname,
    applyGatewayId,
    applyServerIp,
    applyIdentity,
  }
}

function actionLabel(action: ConfigAction): string {
  switch (action) {
    case 'wifi_update':       return 'Wi-Fi'
    case 'hostname_update':   return 'Hostname'
    case 'gateway_id_update': return 'Gateway ID'
    case 'server_ip_update':  return 'Server IP'
    default:                  return action
  }
}
