import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { authApi } from '../api/auth.api'
import apiClient from '../api/client'
import type { User } from '../types/auth.types'

// 14분마다 silent refresh (accessToken 만료 15분 기준)
const SILENT_REFRESH_INTERVAL_MS = 14 * 60 * 1000

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null)
  // accessToken은 메모리에만 유지 (XSS 탈취 방지 - sessionStorage 미사용)
  const accessToken = ref<string | null>(null)
  const loading = ref(false)
  let silentRefreshTimer: ReturnType<typeof setInterval> | null = null

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
      await refreshToken()
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
      // refreshToken은 백엔드가 httpOnly 쿠키로 설정 → JS에서 접근 불가
      accessToken.value = data.accessToken
      user.value = data.user
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
  }

  async function refreshToken(): Promise<boolean> {
    try {
      // 쿠키는 브라우저가 자동 전송 → body에 토큰 불필요
      const { data } = await authApi.refresh()
      accessToken.value = data.accessToken
      return true
    } catch {
      // 401 인터셉터가 로그아웃 처리 — 여기서는 상태만 초기화
      accessToken.value = null
      return false
    }
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
    // 쿠키 기반 silent refresh 시도 (httpOnly refreshToken 쿠키 사용)
    // refreshToken() 실패 시 로그아웃 호출 없이 상태만 초기화
    try {
      const { data } = await authApi.refresh()
      accessToken.value = data.accessToken
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
