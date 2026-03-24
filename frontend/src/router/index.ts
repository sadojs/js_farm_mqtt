import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth.store'
import { useNotificationStore } from '../stores/notification.store'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('../views/Login.vue'),
      meta: { title: '로그인', public: true }
    },
    {
      path: '/',
      redirect: '/dashboard'
    },
    {
      path: '/dashboard',
      name: 'dashboard',
      component: () => import('../views/Dashboard.vue'),
      meta: { title: '대시보드', requiresAuth: true }
    },
    {
      path: '/sensors',
      name: 'sensors',
      component: () => import('../views/Sensors.vue'),
      meta: { title: '센서 관리', requiresAuth: true }
    },
    {
      path: '/automation',
      name: 'automation',
      component: () => import('../views/Automation.vue'),
      meta: { title: '자동화', requiresAuth: true, denyFarmUser: true }
    },
    {
      path: '/groups',
      name: 'groups',
      component: () => import('../views/Groups.vue'),
      meta: { title: '그룹 관리', requiresAuth: true }
    },
    {
      path: '/devices',
      name: 'devices',
      component: () => import('../views/Devices.vue'),
      meta: { title: '장비 관리', requiresAuth: true, denyFarmUser: true }
    },
    {
      path: '/users',
      name: 'users',
      component: () => import('../views/UserManagement.vue'),
      meta: { title: '사용자 관리', requiresAuth: true, requiresAdmin: true }
    },
    {
      path: '/reports',
      name: 'reports',
      component: () => import('../views/Reports.vue'),
      meta: { title: '리포트 및 통계', requiresAuth: true }
    },
    {
      path: '/harvest',
      name: 'harvest',
      component: () => import('../views/Harvest.vue'),
      meta: { title: '수확 관리', requiresAuth: true }
    },
    {
      path: '/harvest-rec',
      name: 'harvest-rec',
      component: () => import('../views/HarvestRecommendation.vue'),
      meta: { title: '수확 관리', requiresAuth: true }
    },
    {
      path: '/alerts',
      name: 'alerts',
      component: () => import('../views/Alerts.vue'),
      meta: { title: '센서 알림', requiresAuth: true }
    },
  ]
})

// 인증 가드 - Pinia 스토어 기반
router.beforeEach((to, _from, next) => {
  const authStore = useAuthStore()

  // 공개 페이지는 그냥 통과
  if (to.meta.public) {
    next()
    return
  }

  // 인증이 필요한 페이지
  if (to.meta.requiresAuth && !authStore.isAuthenticated) {
    next('/login')
    return
  }

  // farm_user 접근 불가 페이지
  if (to.meta.denyFarmUser && authStore.isFarmUser) {
    const notificationStore = useNotificationStore()
    notificationStore.error('접근 거부', '해당 메뉴에 접근할 수 없습니다.')
    next('/dashboard')
    return
  }

  // 관리자 권한이 필요한 페이지
  if (to.meta.requiresAdmin && !authStore.isAdmin) {
    const notificationStore = useNotificationStore()
    notificationStore.error('접근 거부', '관리자 권한이 필요합니다.')
    next('/dashboard')
    return
  }

  next()
})

export default router
