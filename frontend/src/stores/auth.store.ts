import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { authApi } from '../api/auth.api'
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
        startSilentRefreshTimer()
      }
    } catch {
      // 유효한 세션 없음 → 로그인 필요 (logout API 호출 없이 상태만 초기화)
      user.value = null
      accessToken.value = null
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
    login,
    logout,
    refreshToken,
    fetchUser,
    initAuth,
  }
})
