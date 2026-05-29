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
      meta: { title: '우리 농장', requiresAuth: true }
    },
    {
      path: '/sensors',
      name: 'sensors',
      component: () => import('../views/Sensors.vue'),
      meta: { title: '농장 환경', requiresAuth: true }
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
      meta: { title: '구역 관리', requiresAuth: true }
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
      meta: { title: '기록 보기', requiresAuth: true }
    },
{
      path: '/alerts',
      name: 'alerts',
      component: () => import('../views/Alerts.vue'),
      meta: { title: '이상 알림', requiresAuth: true }
    },
    {
      path: '/activity-log',
      name: 'activity-log',
      component: () => import('../views/ActivityLog.vue'),
      meta: { title: '작업 내역', requiresAuth: true }
    },
    {
      path: '/config-deploy',
      name: 'config-deploy',
      component: () => import('../views/ConfigDeploy.vue'),
      meta: { title: '설정 배포', requiresAuth: true, requiresAdmin: true }
    },
    {
      path: '/emergency-failover',
      name: 'emergency-failover',
      component: () => import('../views/EmergencyFailover.vue'),
      meta: { title: '이머전시 페일오버', requiresAuth: true, denyFarmUser: true }
    },
    {
      path: '/gateways',
      name: 'gateways',
      component: () => import('../views/GatewayManagement.vue'),
      meta: { title: '게이트웨이 관리', requiresAuth: true, denyFarmUser: true }
    },
    {
      path: '/crop-management',
      name: 'crop-management',
      component: () => import('../modules/crop-management/CropManagementView.vue'),
      meta: { title: '생육관리', requiresAuth: true }
    },
    {
      path: '/gateways/:id/env',
      name: 'gateway-env',
      component: () => import('../views/GatewayEnvSettings.vue'),
      meta: { title: '게이트웨이 환경 설정', requiresAuth: true, denyFarmUser: true }
    },
    {
      path: '/admin/farms',
      name: 'admin-farms',
      component: () => import('../views/AdminFarmManagement.vue'),
      meta: { title: '농장 관리', requiresAuth: true, requiresAdmin: true }
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
