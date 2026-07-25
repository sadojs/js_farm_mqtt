import axios from 'axios'
import router from '../router'
import { useAuthStore } from '../stores/auth.store'
import { appClientHeader } from '../utils/appAuth'

const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  timeout: 10000,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
})

// 요청 인터셉터: JWT 토큰 자동 첨부 (메모리 기반 - sessionStorage 미사용)
apiClient.interceptors.request.use((config) => {
  const authStore = useAuthStore()
  const token = authStore.accessToken
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  // 앱(Capacitor)이면 X-Client 헤더 첨부 → 서버가 refresh token 을 body 로도 내려준다.
  // 웹에서는 undefined 라 헤더 미첨부(동작 무변경).
  const client = appClientHeader()
  if (client) {
    config.headers['X-Client'] = client
  }
  return config
})

// 응답 인터셉터: 에러 핸들링
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config
    const status = error.response?.status

    // 401: 토큰 갱신 or 로그아웃 (refresh 요청 자체는 재시도 안 함)
    const isRefreshRequest = originalRequest.url?.includes('/auth/refresh')
    if (status === 401 && !originalRequest._retry && !isRefreshRequest) {
      originalRequest._retry = true
      try {
        const authStore = useAuthStore()
        const refreshed = await authStore.refreshToken()
        if (refreshed) {
          originalRequest.headers.Authorization = `Bearer ${authStore.accessToken}`
          return apiClient(originalRequest)
        }
      } catch {
        // refresh failed
      }
      const authStore = useAuthStore()
      authStore.logout()
      router.push('/login')
      return Promise.reject(error)
    }

    // 글로벌 에러 알림 (401 제외)
    if (status && status !== 401) {
      try {
        const { useNotificationStore } = await import('../stores/notification.store')
        const notificationStore = useNotificationStore()
        const message = error.response?.data?.message || error.message || '알 수 없는 오류'
        if (status >= 500) {
          notificationStore.error('서버 오류', message)
        } else if (status === 403) {
          notificationStore.warning('접근 거부', '권한이 없습니다.')
        } else if (status === 404) {
          notificationStore.warning('리소스 없음', message)
        }
      } catch {
        // notification store unavailable
      }
    }

    return Promise.reject(error)
  },
)

export default apiClient
