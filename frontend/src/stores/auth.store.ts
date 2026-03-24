import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { authApi } from '../api/auth.api'
import type { User } from '../types/auth.types'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null)
  const accessToken = ref<string | null>(null)
  const refreshTokenValue = ref<string | null>(null)
  const loading = ref(false)

  const isAuthenticated = computed(() => !!accessToken.value)
  const isAdmin = computed(() => user.value?.role === 'admin')
  const isFarmAdmin = computed(() => user.value?.role === 'farm_admin')
  const isFarmUser = computed(() => user.value?.role === 'farm_user')

  async function login(email: string, password: string) {
    loading.value = true
    try {
      const { data } = await authApi.login(email, password)
      accessToken.value = data.accessToken
      refreshTokenValue.value = data.refreshToken
      user.value = data.user
      sessionStorage.setItem('accessToken', data.accessToken)
      localStorage.setItem('refreshToken', data.refreshToken)
    } finally {
      loading.value = false
    }
  }

  function logout() {
    user.value = null
    accessToken.value = null
    refreshTokenValue.value = null
    sessionStorage.removeItem('accessToken')
    localStorage.removeItem('refreshToken')
  }

  async function refreshToken(): Promise<boolean> {
    const token = refreshTokenValue.value || localStorage.getItem('refreshToken')
    if (!token) return false
    try {
      const { data } = await authApi.refresh(token)
      accessToken.value = data.accessToken
      refreshTokenValue.value = data.refreshToken
      sessionStorage.setItem('accessToken', data.accessToken)
      localStorage.setItem('refreshToken', data.refreshToken)
      return true
    } catch {
      logout()
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
    const storedToken = sessionStorage.getItem('accessToken')
    const storedRefresh = localStorage.getItem('refreshToken')
    if (storedToken) {
      accessToken.value = storedToken
      refreshTokenValue.value = storedRefresh
      await fetchUser()
    } else if (storedRefresh) {
      refreshTokenValue.value = storedRefresh
      await refreshToken()
      if (accessToken.value) {
        await fetchUser()
      }
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
