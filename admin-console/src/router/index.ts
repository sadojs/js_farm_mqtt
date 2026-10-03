import { createRouter, createWebHistory, type RouteRecordRaw, type LocationQuery } from 'vue-router'
import type { Component } from 'vue'
import { useAuthStore } from '@/stores/auth.store'
import { farmState } from '@console/farm/farmContext'

type Loader = () => Promise<Component | { default: Component }>

declare module 'vue-router' {
  interface RouteMeta {
    title?: string
    /** 셸 구분: console(개요) · platform(플랫폼 운영) · farm(농장 보기) · bare(셸 없음) */
    section?: 'console' | 'platform' | 'farm' | 'bare'
    public?: boolean
    /** 기존 화면 임베드(L) — frontend/src 의 컴포넌트를 그대로 렌더 */
    legacy?: Loader
    /** 농장 보기 메뉴 키 (사이드바 강조·기능 플래그) */
    farmMenu?: string
  }
}

const LegacyHost = () => import('@console/components/LegacyHost.vue')

/** 농장 보기 화면 (H 섹션) — 모두 기존 화면 임베드 */
export const FARM_PAGES: Array<{ seg: string; title: string; loader: Loader }> = [
  { seg: 'dashboard', title: '대시보드', loader: () => import('@/views/Dashboard.vue') },
  { seg: 'groups', title: '구역 관리', loader: () => import('@/views/Groups.vue') },
  { seg: 'automation', title: '자동 제어', loader: () => import('@/views/Automation.vue') },
  { seg: 'spray-schedule', title: '방재 일정', loader: () => import('@/modules/spray-schedule/SprayScheduleView.vue') },
  { seg: 'worker-payroll', title: '일꾼 관리', loader: () => import('@/modules/worker-payroll/WorkerPayrollView.vue') },
  { seg: 'sensors', title: '농장 환경', loader: () => import('@/views/Sensors.vue') },
  { seg: 'reports', title: '기록 보기', loader: () => import('@/views/Reports.vue') },
  { seg: 'alerts', title: '이상 알림', loader: () => import('@/views/Alerts.vue') },
  { seg: 'activity-log', title: '동작 이력', loader: () => import('@/views/ActivityLog.vue') },
  { seg: 'work-log', title: '농작업 일정', loader: () => import('@/modules/work-log/WorkLogView.vue') },
  { seg: 'crop-management', title: '생육관리', loader: () => import('@/modules/crop-management/CropManagementView.vue') },
]

/**
 * 기존 화면 안의 router.push('/dashboard')·router-link to="/groups?envConfig=…" 같은 기존 경로를
 * 콘솔에서 올바른 화면으로 보낸다: 현재(또는 마지막 선택) 농장의 농장 보기 화면으로, 없으면 농장 목록으로.
 */
function farmRedirect(seg: string) {
  return (to: { query: LocationQuery }) => {
    const id = farmState.activeFarmId || farmState.selected?.id
    return id ? { path: `/farm/${id}/${seg}`, query: to.query } : { path: '/farms', query: { pick: seg } }
  }
}

const routes: RouteRecordRaw[] = [
  { path: '/login', name: 'login', component: () => import('@console/views/LoginView.vue'), meta: { title: '로그인', public: true, section: 'bare' } },
  { path: '/blocked', name: 'blocked', component: () => import('@console/views/BlockedView.vue'), meta: { title: '접근 제한', section: 'bare' } },
  { path: '/change-password', name: 'change-password', component: LegacyHost, meta: { title: '비밀번호 변경', section: 'bare', legacy: () => import('@/views/ChangePassword.vue') } },

  // 콘솔
  { path: '/', name: 'overview', component: () => import('@console/views/OverviewView.vue'), meta: { title: '플랫폼 개요', section: 'console' } },

  // 플랫폼 운영 (헤더 미부착)
  { path: '/users', name: 'users', component: () => import('@console/views/UsersView.vue'), meta: { title: '사용자', section: 'platform' } },
  { path: '/farms', name: 'farms', component: () => import('@console/views/FarmsView.vue'), meta: { title: '농장', section: 'platform' } },
  { path: '/gateways', name: 'gateways', component: () => import('@console/views/GatewaysView.vue'), meta: { title: '게이트웨이', section: 'platform' } },
  { path: '/gateways/:id/env', name: 'gateway-env', component: LegacyHost, meta: { title: '게이트웨이 환경 설정', section: 'platform', legacy: () => import('@/views/GatewayEnvSettings.vue') } },
  { path: '/config-deploy', name: 'config-deploy', component: LegacyHost, meta: { title: '설정 배포', section: 'platform', legacy: () => import('@/views/ConfigDeploy.vue') } },
  { path: '/emergency-failover', name: 'emergency-failover', component: LegacyHost, meta: { title: '이머전시 페일오버', section: 'platform', legacy: () => import('@/views/EmergencyFailover.vue') } },

  // 농장 보기 (X-Farm-Context 헤더 부착)
  ...FARM_PAGES.map<RouteRecordRaw>((p) => ({
    path: `/farm/:farmId/${p.seg}`,
    name: `farm-${p.seg}`,
    component: LegacyHost,
    meta: { title: p.title, section: 'farm', legacy: p.loader, farmMenu: p.seg },
  })),
  { path: '/farm/:farmId', redirect: (to) => `/farm/${to.params.farmId}/dashboard` },

  // 기존 앱 경로 호환 (기존 화면 내부 링크·이동용) — 기존 라우트 이름 유지
  ...FARM_PAGES.map<RouteRecordRaw>((p) => ({ path: `/${p.seg}`, name: p.seg, redirect: farmRedirect(p.seg) })),
  { path: '/admin/farms', name: 'admin-farms', redirect: '/farms' },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
})

/** 인증·권한 가드: 관리자 전용 콘솔 */
router.beforeEach((to) => {
  const auth = useAuthStore()
  if (to.meta.public) {
    if (to.name === 'login' && auth.isAuthenticated && auth.isAdmin) return { path: '/' }
    return true
  }
  if (!auth.isAuthenticated) return { name: 'login', query: to.fullPath !== '/' ? { redirect: to.fullPath } : {} }
  // 플랫폼 관리자가 아니면 콘솔 진입 차단 (안내 + 기존 앱 링크 + 로그아웃)
  if (!auth.isAdmin) return to.name === 'blocked' ? true : { name: 'blocked' }
  if (to.name === 'blocked') return { path: '/' }
  // 임시 비밀번호 계정 → 비밀번호 변경 강제 (기존 앱과 동일)
  if (auth.user?.mustChangePassword && to.name !== 'change-password') return { name: 'change-password' }
  return true
})

router.afterEach((to) => {
  document.title = `${to.meta.title ? to.meta.title + ' · ' : ''}스마트팜 콘솔`
})

// 재배포로 예전 청크가 사라졌을 때 1회 전체 로드로 복구 (기존 앱과 동일 방식)
const CHUNK_RELOAD_KEY = 'sf-console-chunk-reload'
router.onError((error, to) => {
  const msg = (error as Error)?.message || ''
  if (!/dynamically imported module|Importing a module script failed|Failed to fetch/i.test(msg)) return
  if (sessionStorage.getItem(CHUNK_RELOAD_KEY)) return
  sessionStorage.setItem(CHUNK_RELOAD_KEY, '1')
  window.location.assign(to?.fullPath || window.location.pathname)
})
router.afterEach(() => sessionStorage.removeItem(CHUNK_RELOAD_KEY))

export default router
