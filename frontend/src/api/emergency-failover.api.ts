import apiClient from './client'
import type {
  FallbackFullConfig,
  FallbackGatewayStatus,
  FallbackEvent,
  UpdateConfigDto,
  UpsertScheduleDto,
  OpenerSchedule,
  FallbackConfig, EmergencyStopState } from '../types/emergency-failover.types'

const base = (gatewayId: string) => `/fallback-config/${gatewayId}`

export const emergencyFailoverApi = {
  async getFull(gatewayId: string): Promise<FallbackFullConfig> {
    const { data } = await apiClient.get<FallbackFullConfig>(base(gatewayId))
    return data
  },

  async updateConfig(
    gatewayId: string,
    dto: UpdateConfigDto,
  ): Promise<FallbackConfig> {
    const { data } = await apiClient.patch<FallbackConfig>(base(gatewayId), dto)
    return data
  },

  async upsertSchedule(
    gatewayId: string,
    month: number,
    dto: UpsertScheduleDto,
  ): Promise<OpenerSchedule> {
    const { data } = await apiClient.put<OpenerSchedule>(
      `${base(gatewayId)}/opener/${month}`,
      dto,
    )
    return data
  },

  async disableSchedule(
    gatewayId: string,
    month: number,
  ): Promise<OpenerSchedule> {
    const { data } = await apiClient.delete<OpenerSchedule>(
      `${base(gatewayId)}/opener/${month}`,
    )
    return data
  },

  async getMode(gatewayId: string): Promise<FallbackGatewayStatus | null> {
    const { data } = await apiClient.get<FallbackGatewayStatus | null>(
      `${base(gatewayId)}/mode`,
    )
    return data
  },

  async getEvents(
    gatewayId: string,
    limit = 100,
    offset = 0,
  ): Promise<{ data: FallbackEvent[]; total: number; limit: number; offset: number }> {
    const { data } = await apiClient.get(`${base(gatewayId)}/events`, {
      params: { limit, offset },
    })
    return data
  },

  async resync(gatewayId: string): Promise<{ ok: boolean }> {
    const { data } = await apiClient.post(`${base(gatewayId)}/resync`)
    return data
  },

  /** 비상 정지 — 정지 유지(래치). 실행자는 서버가 로그인 사용자로 기록(by 는 하위 호환용) */
  async emergencyStop(
    gatewayId: string,
    reason: string,
    by: string,
  ): Promise<{ ok: boolean } & Partial<EmergencyStopState>> {
    const { data } = await apiClient.post(
      `${base(gatewayId)}/emergency-stop`,
      { reason, by },
    )
    return data
  },

  /** 비상 정지 해제 — 장비는 꺼진 상태 그대로, 자동제어·수동 조작이 다시 가능 */
  async emergencyRelease(gatewayId: string): Promise<{ ok: boolean } & Partial<EmergencyStopState>> {
    const { data } = await apiClient.post(`${base(gatewayId)}/emergency-release`)
    return data
  },

  async getEmergency(gatewayId: string): Promise<EmergencyStopState> {
    const { data } = await apiClient.get(`${base(gatewayId)}/emergency`)
    return data
  },
}
