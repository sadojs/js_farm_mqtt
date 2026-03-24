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
      notificationStore.success('로그인 성공', `${authStore.user?.name}님 환영합니다.`)
      router.push('/dashboard')
    } catch (err: any) {
      const message = err.response?.data?.message || '로그인에 실패했습니다.'
      notificationStore.error('로그인 실패', message)
      throw err
    }
  }

  function logout() {
    authStore.logout()
    notificationStore.info('로그아웃', '정상적으로 로그아웃되었습니다.')
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
