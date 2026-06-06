import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth.store'
import { useNotificationStore } from '../stores/notification.store'

export function useAuth() {
  const authStore = useAuthStore()
  const notificationStore = useNotificationStore()
  const router = useRouter()

  async function login(email: string, password: string) {
    try {
      await authStore.login(email, password)
      // 로그인 성공 알림은 노이즈 — 대시보드로 곧장 이동하면 사용자는 이미 성공을 인지한다.
      router.push('/dashboard')
    } catch (err: any) {
      const message = err.response?.data?.message || '로그인에 실패했습니다.'
      notificationStore.error('로그인 실패', message)
      throw err
    }
  }

  function logout() {
    authStore.logout()
    router.push('/login')
  }

  return {
    login,
    logout,
    user: authStore.user,
    isAuthenticated: authStore.isAuthenticated,
    isAdmin: authStore.isAdmin,
    loading: authStore.loading,
  }
}
