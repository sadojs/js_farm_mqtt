/**
 * 농장 컨텍스트 (작업 1 계약서 docs/FARM_SCOPE_DESIGN.md 구현)
 *
 * - "농장 보기" 경로(/farm/:farmId/...)에 있는 동안에만 모든 API 요청에 `X-Farm-Context: <농장관리자 id>` 를 붙인다.
 *   플랫폼 운영 화면·농장 보기 종료 후에는 헤더를 제거한다.
 *   → 기존 frontend/src/api/client.ts 의 axios 인스턴스는 수정하지 않고, 콘솔에서 request interceptor 를 추가한다.
 * - 소켓: 농장 보기 진입 시 `subscribe:farm {farmId}`, 종료 시 `unsubscribe {channel:'farm'}` (재연결 시 재입장).
 * - 농장 변경/종료 시 기존 Pinia 스토어 캐시를 초기 상태로 되돌린다(재조회는 화면 재마운트로).
 * - 마지막 선택 농장은 localStorage `sf-console-farm` 에 저장(기존 앱 키와 겹치지 않음).
 */
import { reactive } from 'vue'
import type { Pinia, PiniaPluginContext } from 'pinia'
import type { Router, RouteLocationNormalized } from 'vue-router'
import apiClient from '@/api/client'
import { useWebSocket } from '@/composables/useWebSocket'

export const FARM_HEADER = 'X-Farm-Context'
const STORAGE_KEY = 'sf-console-farm'
/** 콘솔 내부 표식: 이 표식이 있는 요청은 현재 경로와 무관하게 플랫폼 범위(헤더 없음)로 보낸다. 서버로는 전송하지 않는다. */
const PLATFORM_MARK = 'X-Console-Scope'
/** 셸(사이드바 카운트·전체 검색·농장 목록)처럼 어느 화면에서든 "전체 플랫폼" 데이터가 필요한 요청에 사용 */
export const PLATFORM_REQUEST = { headers: { [PLATFORM_MARK]: 'platform' } }

export interface FarmRef {
  id: string
  name: string
  username: string
}

type SocketFarmState = 'idle' | 'joining' | 'joined' | 'unsupported' | 'error'

export const farmState = reactive({
  /** 사이드바 농장 선택 박스에 표시되는 마지막 선택 농장 */
  selected: loadSelected() as FarmRef | null,
  /** 현재 농장 보기 중인 농장 id (= 헤더가 붙는 대상). 플랫폼 화면이면 null */
  activeFarmId: null as string | null,
  /** 소켓 농장 room 상태 — 백엔드(작업 1) 배포 전이면 응답이 없어 'unsupported' */
  socket: 'idle' as SocketFarmState,
  socketError: '' as string,
})

function loadSelected(): FarmRef | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as FarmRef) : null
  } catch {
    return null
  }
}

export function rememberFarm(farm: FarmRef | null) {
  farmState.selected = farm
  try {
    if (farm) localStorage.setItem(STORAGE_KEY, JSON.stringify(farm))
    else localStorage.removeItem(STORAGE_KEY)
  } catch { /* 저장 불가 환경 무시 */ }
}

/** 라우트가 농장 보기면 farmId, 아니면 null */
export function farmIdOfRoute(route: Pick<RouteLocationNormalized, 'path' | 'params'>): string | null {
  if (!route.path.startsWith('/farm/')) return null
  const id = route.params.farmId
  return typeof id === 'string' && id ? id : null
}

// ── Pinia 스토어 초기화 플러그인 ─────────────────────────────────────────────
// setup 스토어는 $reset 이 없으므로, 생성 시점 상태를 스냅샷해 두고 농장 전환 시 되돌린다.
// 인증·알림 스토어는 콘솔 세션 상태이므로 제외.
const KEEP_STORES = new Set(['auth', 'notification', 'console-platform'])
const initialStates = new Map<string, string>()

export function storeSnapshotPlugin({ store }: PiniaPluginContext) {
  if (KEEP_STORES.has(store.$id)) return
  try { initialStates.set(store.$id, JSON.stringify(store.$state)) } catch { /* 직렬화 불가 상태는 건너뜀 */ }
}

export function resetFarmStores(pinia: Pinia) {
  const stores = (pinia as any)._s as Map<string, any> | undefined
  stores?.forEach((store, id) => {
    const snap = initialStates.get(id)
    if (!snap) return
    try {
      const initial = JSON.parse(snap)
      store.$patch((state: Record<string, unknown>) => { Object.assign(state, initial) })
    } catch { /* 일부 스토어 초기화 실패는 화면 재조회로 보완 */ }
  })
}

// ── 설치 ──────────────────────────────────────────────────────────────────
let installed = false

export function installFarmContext(router: Router, pinia: Pinia) {
  if (installed) return
  installed = true

  // 1) HTTP: 농장 보기 경로에서만 헤더 부착 (현재 라우트가 단일 진실 원천)
  apiClient.interceptors.request.use((config) => {
    if (config.headers.get(PLATFORM_MARK)) {
      config.headers.delete(PLATFORM_MARK)
      config.headers.delete(FARM_HEADER)
      return config
    }
    const farmId = farmIdOfRoute(router.currentRoute.value)
    if (farmId) config.headers.set(FARM_HEADER, farmId)
    else config.headers.delete(FARM_HEADER)
    return config
  })

  // 2) 라우트 전환: 농장 변경/종료 감지 → 스토어 초기화 + 소켓 room 전환
  router.afterEach((to) => {
    const next = farmIdOfRoute(to)
    const prev = farmState.activeFarmId
    if (next === prev) return
    if (prev) resetFarmStores(pinia)
    farmState.activeFarmId = next
    syncSocketRoom()
  })
}

// ── 소켓 ──────────────────────────────────────────────────────────────────
type WsApi = ReturnType<typeof useWebSocket>
let socketHooked = false
let wsRef: WsApi | null = null
let joinTimer: ReturnType<typeof setTimeout> | null = null

/**
 * App 에서 소켓 connect() 직후 1회 호출 — 재연결 시 농장 room 재입장 + 응답 이벤트 수신.
 * (useWebSocket() 은 컴포넌트 setup 안에서만 호출하고 그 결과를 넘겨받는다)
 */
export function hookFarmSocket(ws: WsApi) {
  if (socketHooked) return
  wsRef = ws
  ws.on('connect', () => syncSocketRoom())
  ws.on('farm:joined', (p: { farmId: string }) => {
    if (p?.farmId === farmState.activeFarmId) {
      farmState.socket = 'joined'
      farmState.socketError = ''
      if (joinTimer) clearTimeout(joinTimer)
    }
  })
  ws.on('farm:left', () => {
    if (!farmState.activeFarmId) farmState.socket = 'idle'
  })
  ws.on('farm:error', (p: { code?: string; message?: string }) => {
    farmState.socket = 'error'
    farmState.socketError = p?.code || p?.message || 'FARM_CONTEXT_ERROR'
    if (joinTimer) clearTimeout(joinTimer)
  })
  socketHooked = true
  syncSocketRoom()
}

/** 로그아웃 등으로 소켓을 끊을 때 호출 — 다음 connect() 후 hookFarmSocket() 이 핸들러를 다시 등록 */
export function unhookFarmSocket() {
  socketHooked = false
  if (joinTimer) clearTimeout(joinTimer)
  farmState.socket = 'idle'
}

function syncSocketRoom() {
  const ws = wsRef
  if (!socketHooked || !ws) return
  if (joinTimer) clearTimeout(joinTimer)
  const farmId = farmState.activeFarmId
  if (farmId) {
    farmState.socket = 'joining'
    ws.subscribe('farm', farmId) // → emit('subscribe:farm', { farmId })
    // 백엔드에 작업 1 이 아직 없으면 응답 이벤트가 오지 않는다 → 3초 후 'unsupported' 로 표시
    joinTimer = setTimeout(() => {
      if (farmState.socket === 'joining') farmState.socket = 'unsupported'
    }, 3000)
  } else {
    ws.unsubscribe('farm') // → emit('unsubscribe', { channel: 'farm' }) — 기존 서버에선 무해한 no-op
    farmState.socket = 'idle'
  }
}
