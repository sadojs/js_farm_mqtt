import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { authApi } from '../api/auth.api'
import apiClient from '../api/client'
import type { User } from '../types/auth.types'
// 앱 전용 refresh token 저장/전송 (웹에서는 전부 no-op)
import { saveAppRefreshToken, loadAppRefreshToken, clearAppRefreshToken } from '../utils/appAuth'

// 10분마다 silent refresh (accessToken 만료 15분 기준 — 만료 전 여유 5분 확보).
// 이전 14분은 여유 1분뿐이라 앱 백그라운드/느린 네트워크에서 만료→셸 소멸 위험이 컸음.
const SILENT_REFRESH_INTERVAL_MS = 10 * 60 * 1000

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null)
  // accessToken은 메모리에만 유지 (XSS 탈취 방지 - sessionStorage 미사용)
  const accessToken = ref<string | null>(null)
  const loading = ref(false)
  let silentRefreshTimer: ReturnType<typeof setInterval> | null = null
  // refresh 동시호출 방지 뮤텍스 — 여러 요청이 동시에 401→refresh 하면 백엔드가 refresh
  // 토큰을 회전시키므로 두 번째부터 실패하고, 그 실패가 성공한 갱신을 null 로 덮어써
  // 셸(상단바·사이드바)이 사라지는 버그가 있었다. in-flight Promise 를 공유해 1회로 합친다.
  let refreshInFlight: Promise<boolean> | null = null

  const isAuthenticated = computed(() => !!accessToken.value)
  const isAdmin = computed(() => user.value?.role === 'admin')
  const isFarmAdmin = computed(() => user.value?.role === 'farm_admin')
  const isFarmUser = computed(() => user.value?.role === 'farm_user')

  // 일꾼 계정 여부: payroll_workers 에 account_user_id 로 연결된 farm_user
  // null=미확인. true 인 경우 일꾼 관리(정산) 페이지만 접근 가능.
  const isWorkerAccount = ref<boolean | null>(null)
  const isWorker = computed(() => isFarmUser.value && isWorkerAccount.value === true)

  async function resolveWorkerStatus(): Promise<boolean> {
    // 사용자 미확정 시 캐시하지 않음 (앱 초기화 레이스 방지)
    if (!user.value) return false
    if (user.value.role !== 'farm_user') {
      isWorkerAccount.value = false
      return false
    }
    if (isWorkerAccount.value !== null) return isWorkerAccount.value === true
    try {
      const { data } = await apiClient.get('/worker-payroll/me')
      isWorkerAccount.value = !!data
    } catch {
      isWorkerAccount.value = false
    }
    return isWorkerAccount.value === true
  }

  function startSilentRefreshTimer() {
    stopSilentRefreshTimer()
    silentRefreshTimer = setInterval(async () => {
      const ok = await refreshToken()
      if (!ok) {
        // 무음 갱신 실패 = 세션 만료. 인터셉터를 안 거치는 경로라 여기서 명시적으로 정리한다.
        // (예전엔 accessToken 만 null 이 되어 상단바·사이드바가 사라진 채 페이지에 갇혔음)
        stopSilentRefreshTimer()
        user.value = null
        isWorkerAccount.value = null
        // accessToken 은 refreshToken() 이 이미 null 처리 → App.vue 의 isAuthenticated 워처가 /login 이동
      }
    }, SILENT_REFRESH_INTERVAL_MS)
  }

  function stopSilentRefreshTimer() {
    if (silentRefreshTimer !== null) {
      clearInterval(silentRefreshTimer)
      silentRefreshTimer = null
    }
  }

  async function login(username: string, password: string) {
    loading.value = true
    try {
      const { data } = await authApi.login(username, password)
      // 웹: refreshToken 은 httpOnly 쿠키(응답 body 미포함). 앱: body 로 받은 토큰을 네이티브 저장.
      accessToken.value = data.accessToken
      user.value = data.user
      await saveAppRefreshToken(data.refreshToken)
      // farm_user 는 worker 여부를 미리 결정해야 사이드바 NAV 분기가 깜빡이지 않음.
      // 다른 role 은 즉시 확정 — false 로 명시.
      if (user.value?.role === 'farm_user') {
        isWorkerAccount.value = null
        await resolveWorkerStatus()
      } else {
        isWorkerAccount.value = false
      }
      startSilentRefreshTimer()
    } finally {
      loading.value = false
    }
  }

  async function logout() {
    try {
      await authApi.logout()
    } catch {
      // 서버 오류여도 클라이언트 상태는 정리
    }
    user.value = null
    accessToken.value = null
    isWorkerAccount.value = null
    stopSilentRefreshTimer()
    await clearAppRefreshToken()
  }

  async function refreshToken(): Promise<boolean> {
    // 이미 진행 중인 refresh 가 있으면 그 결과를 공유 (동시호출 → 토큰 회전 경쟁 방지)
    if (refreshInFlight) return refreshInFlight
    const p = (async (): Promise<boolean> => {
      try {
        // 웹: 쿠키 자동 전송. 앱: 저장된 refresh token 을 body 로 전달.
        const stored = await loadAppRefreshToken()
        const { data } = await authApi.refresh(stored)
        accessToken.value = data.accessToken
        await saveAppRefreshToken(data.refreshToken) // 회전된 새 토큰 저장 (앱)
        return true
      } catch {
        // 갱신 실패(만료/무효) — 토큰 초기화. 리다이렉트는 호출측(인터셉터/무음타이머/App.vue 워처)이 담당.
        accessToken.value = null
        await clearAppRefreshToken()
        return false
      }
    })()
    refreshInFlight = p
    void p.finally(() => { if (refreshInFlight === p) refreshInFlight = null })
    return p
  }

  async function fetchUser() {
    try {
      const { data } = await authApi.me()
      user.value = data
    } catch {
      // token invalid
    }
  }

  async function initAuth() {
    // 웹: 쿠키 기반 silent refresh. 앱: 네이티브 저장된 refresh token 으로 세션 복원(앱 재시작 후 로그인 유지).
    // 실패 시 로그아웃 호출 없이 상태만 초기화
    try {
      const stored = await loadAppRefreshToken()
      const { data } = await authApi.refresh(stored)
      accessToken.value = data.accessToken
      await saveAppRefreshToken(data.refreshToken)
      await fetchUser()
      if (user.value) {
        // 새로고침 케이스도 farm_user 면 worker 확정 후 mount → NAV 깜빡임 방지
        if (user.value.role === 'farm_user') {
          await resolveWorkerStatus()
        } else {
          isWorkerAccount.value = false
        }
        startSilentRefreshTimer()
      }
    } catch {
      // 유효한 세션 없음 → 로그인 필요 (logout API 호출 없이 상태만 초기화)
      user.value = null
      accessToken.value = null
      await clearAppRefreshToken() // 앱: 만료/무효 토큰 정리
      // iOS Safari 등이 만료된 httpOnly refresh 쿠키를 영구 보관해 다음 로그인을 방해하는 문제 방지 —
      // 백엔드에 명시적으로 쿠키 정리 요청 (안전망; 백엔드도 refresh 401 시 자동 정리함)
      try { await authApi.clearCookie() } catch { /* 무시 */ }
    }
  }

  return {
    user,
    accessToken,
    loading,
    isAuthenticated,
    isAdmin,
    isFarmAdmin,
    isFarmUser,
    isWorkerAccount,
    isWorker,
    resolveWorkerStatus,
    login,
    logout,
    refreshToken,
    fetchUser,
    initAuth,
  }
})
