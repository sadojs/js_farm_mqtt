/**
 * 콘솔 셸 공용 플랫폼 데이터 (사이드바 카운트·전체 검색·농장 선택·개요).
 * 어느 화면(농장 보기 포함)에서 불려도 "전체 플랫폼" 기준이어야 하므로 모든 요청에 PLATFORM_REQUEST 표식을 붙인다.
 * API 경로·파라미터는 기존 api/*.api.ts 와 동일.
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import apiClient from '@/api/client'
import type { User } from '@/types/auth.types'
import type { FarmAdmin, HouseGroupWithOwner } from '@/types/group.types'
import { PLATFORM_REQUEST } from '@console/farm/farmContext'

export interface ConsoleGateway {
  id: string
  userId: string
  gatewayId: string
  name: string
  location?: string
  rpiIp?: string
  houseId?: string | null
  groupId?: string | null
  groupName?: string | null
  status: string
  agentStatus: string
  zigbeeStatus: string
  tunnelPort?: number | null
  tunnelStatus: string
  tunnelLastSeen?: string | null
  lastSeen?: string | null
  createdAt?: string
}

const AGENT_STALE_MS = 5 * 60 * 1000
const TUNNEL_STALE_MS = 3 * 60 * 1000

/** 기존 GatewayManagement.vue 와 동일한 판정 기준 */
export function agentOnline(gw: ConsoleGateway): boolean {
  if (gw.agentStatus !== 'online') return false
  if (!gw.lastSeen) return true
  return Date.now() - new Date(gw.lastSeen).getTime() <= AGENT_STALE_MS
}
export function tunnelConnected(gw: ConsoleGateway): boolean {
  if (gw.tunnelStatus !== 'connected') return false
  if (!gw.tunnelLastSeen) return true
  return Date.now() - new Date(gw.tunnelLastSeen).getTime() <= TUNNEL_STALE_MS
}
export function gatewayOk(gw: ConsoleGateway): boolean {
  return agentOnline(gw) && gw.zigbeeStatus === 'online' && tunnelConnected(gw)
}
export function gatewayIssue(gw: ConsoleGateway): string | null {
  if (!agentOnline(gw)) return 'Agent 오프라인 — 게이트웨이 연결 확인 필요'
  if (gw.zigbeeStatus !== 'online') return 'Zigbee 미연결 — 무선 환경 확인'
  if (!tunnelConnected(gw)) return 'SSH 터널 끊김 — 원격 접속 불가'
  return null
}

/** 농장 표시 이름 — farm_name(migration 051) 이 없으면 농장 관리자 계정 이름 */
export function farmLabel(f: { farmName?: string | null; name: string } | null | undefined): string {
  return f ? f.farmName || f.name : ''
}

export const usePlatformStore = defineStore('console-platform', () => {
  const users = ref<User[]>([])
  const farms = ref<FarmAdmin[]>([])
  const gateways = ref<ConsoleGateway[]>([])
  const groups = ref<HouseGroupWithOwner[]>([])
  const loaded = ref(false)
  const loading = ref(false)
  const error = ref('')

  async function load(force = false) {
    if (loading.value || (loaded.value && !force)) return
    loading.value = true
    error.value = ''
    const [u, f, g, z] = await Promise.allSettled([
      apiClient.get<User[]>('/users', PLATFORM_REQUEST),
      apiClient.get<FarmAdmin[]>('/users/farm-admins', PLATFORM_REQUEST),
      apiClient.get<ConsoleGateway[]>('/gateways', PLATFORM_REQUEST),
      apiClient.get<HouseGroupWithOwner[]>('/groups', PLATFORM_REQUEST),
    ])
    if (u.status === 'fulfilled') users.value = u.value.data
    if (f.status === 'fulfilled') farms.value = f.value.data
    if (g.status === 'fulfilled') gateways.value = g.value.data
    if (z.status === 'fulfilled') groups.value = z.value.data
    if ([u, f, g, z].some((r) => r.status === 'rejected')) error.value = '일부 데이터를 불러오지 못했습니다.'
    loaded.value = true
    loading.value = false
  }

  function patchGatewayStatus(id: string, agentStatus: string) {
    const gw = gateways.value.find((x) => x.id === id)
    if (gw) {
      gw.agentStatus = agentStatus
      gw.lastSeen = new Date().toISOString()
    }
  }

  const farmById = (id: string | null | undefined) => farms.value.find((f) => f.id === id) ?? null
  const userById = (id: string | null | undefined) => users.value.find((u) => u.id === id) ?? null
  const groupsOfFarm = (farmId: string) => groups.value.filter((z) => z.userId === farmId)
  const gatewaysOfFarm = (farmId: string) => gateways.value.filter((gw) => gw.userId === farmId)
  /** 소유자 id(농장 관리자 또는 플랫폼 관리자) → 농장 이름(없으면 계정 이름) */
  const ownerLabel = (id: string | null | undefined) => farmLabel(farmById(id) || userById(id)) || '알 수 없음'
  const membersOfFarm = (farmId: string) => users.value.filter((u) => u.role === 'farm_user' && u.parentUserId === farmId)

  const counts = computed(() => ({
    users: users.value.length,
    farms: farms.value.length,
    gateways: gateways.value.length,
    admins: users.value.filter((u) => u.role === 'admin').length,
    farmAdmins: users.value.filter((u) => u.role === 'farm_admin').length,
    farmUsers: users.value.filter((u) => u.role === 'farm_user').length,
  }))

  return {
    users, farms, gateways, groups, loaded, loading, error, counts,
    load, patchGatewayStatus, farmById, userById, ownerLabel, groupsOfFarm, gatewaysOfFarm, membersOfFarm,
  }
})
