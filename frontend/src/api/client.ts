import axios from 'axios'
import router from '../router'
import { useAuthStore } from '../stores/auth.store'

const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  timeout: 10000,
  headers: { 'Content-Type': 'application/json' },
})

// 요청 인터셉터: JWT 토큰 자동 첨부
apiClient.interceptors.request.use((config) => {
  const token = sessionStorage.getItem('accessToken')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// 응답 인터셉터: 에러 핸들링
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config
    const status = error.response?.status

    // 401: 토큰 갱신 or 로그아웃
    if (status === 401 && !originalRequest._retry) {
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
