<template>
  <div id="app" :class="['content-size-' + fontSize, { 'has-sidebar': isAuthenticated, 'theme-dark': theme === 'dark' }]">
    <!-- 데스크탑 사이드바 -->
    <aside v-if="isAuthenticated" class="sidebar">
      <div class="sidebar-brand">
        <div class="brand-icon-wrap">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2z"/><path d="M12 6v6l4 2"/></svg>
        </div>
        <div class="brand-text">
          <h1>스마트팜</h1>
          <span class="brand-sub">Smart Farm IoT</span>
        </div>
      </div>

      <nav class="sidebar-nav">
        <router-link to="/dashboard" class="sidebar-link">
          <span class="link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg></span>
          <span>대시보드</span>
        </router-link>
        <router-link v-if="!isFarmUser" to="/devices" class="sidebar-link">
          <span class="link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg></span>
          <span>장비 관리</span>
        </router-link>
        <router-link to="/groups" class="sidebar-link">
          <span class="link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></span>
          <span>그룹 관리</span>
        </router-link>
        <router-link v-if="!isFarmUser" to="/automation" class="sidebar-link">
          <span class="link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></span>
          <span>자동화 룰</span>
        </router-link>
        <router-link to="/sensors" class="sidebar-link">
          <span class="link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg></span>
          <span>환경 모니터링</span>
        </router-link>
        <router-link to="/reports" class="sidebar-link">
          <span class="link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg></span>
          <span>리포트</span>
        </router-link>
        <router-link to="/harvest-rec" class="sidebar-link">
          <span class="link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22c4-4 8-7.5 8-12a8 8 0 1 0-16 0c0 4.5 4 8 8 12z"/><circle cx="12" cy="10" r="3"/></svg></span>
          <span>수확 관리</span>
        </router-link>
        <router-link to="/alerts" class="sidebar-link">
          <span class="link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></span>
          <span>센서 알림</span>
        </router-link>
        <router-link v-if="isAdmin" to="/users" class="sidebar-link">
          <span class="link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></span>
          <span>사용자 관리</span>
        </router-link>
      </nav>

      <!-- 폰트 크기 조절 -->
      <div class="font-size-control">
        <span class="font-size-label">글자 크기</span>
        <div class="font-size-buttons">
          <button :class="{ active: fontSize === 'sm' }" @click="setFontSize('sm')">가</button>
          <button :class="{ active: fontSize === 'md' }" @click="setFontSize('md')">가</button>
          <button :class="{ active: fontSize === 'lg' }" @click="setFontSize('lg')">가</button>
        </div>
      </div>

      <!-- 테마 모드 -->
      <div class="theme-control">
        <span class="theme-label">화면 모드</span>
        <div class="theme-buttons">
          <button :class="{ active: theme === 'light' }" @click="setTheme('light')">밝게</button>
          <button :class="{ active: theme === 'dark' }" @click="setTheme('dark')">어둡게</button>
        </div>
      </div>

      <div class="sidebar-footer">
        <div class="sidebar-user">
          <div class="user-avatar">{{ userInitial }}</div>
          <div class="user-details">
            <span class="user-name">{{ userName }}</span>
            <span class="user-role">{{ userRole }}</span>
          </div>
        </div>
        <button class="btn-logout" @click="handleLogout" aria-label="로그아웃">
          로그아웃
        </button>
      </div>
    </aside>

    <!-- 모바일 헤더 -->
    <header v-if="isAuthenticated" class="mobile-header">
      <button class="hamburger" @click="isDrawerOpen = true" aria-label="메뉴 열기">
        <span></span>
        <span></span>
        <span></span>
      </button>
      <div class="mobile-brand">스마트팜</div>
      <div class="mobile-header-spacer"></div>
    </header>

    <!-- 모바일 드로어 오버레이 -->
    <div
      v-if="isAuthenticated && isDrawerOpen"
      class="drawer-overlay"
      @click="isDrawerOpen = false"
    ></div>

    <!-- 모바일 드로어 -->
    <aside
      v-if="isAuthenticated"
      class="drawer"
      :class="{ open: isDrawerOpen }"
    >
      <div class="sidebar-brand">
        <div class="brand-icon-wrap">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2z"/><path d="M12 6v6l4 2"/></svg>
        </div>
        <div class="brand-text">
          <h1>스마트팜</h1>
          <span class="brand-sub">Smart Farm IoT</span>
        </div>
        <button class="drawer-close" @click="isDrawerOpen = false" aria-label="메뉴 닫기">✕</button>
      </div>

      <nav class="sidebar-nav">
        <router-link to="/dashboard" class="sidebar-link" @click="isDrawerOpen = false">
          <span class="link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg></span>
          <span>대시보드</span>
        </router-link>
        <router-link v-if="!isFarmUser" to="/devices" class="sidebar-link" @click="isDrawerOpen = false">
          <span class="link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg></span>
          <span>장비 관리</span>
        </router-link>
        <router-link to="/groups" class="sidebar-link" @click="isDrawerOpen = false">
          <span class="link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></span>
          <span>그룹 관리</span>
        </router-link>
        <router-link v-if="!isFarmUser" to="/automation" class="sidebar-link" @click="isDrawerOpen = false">
          <span class="link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></span>
          <span>자동화 룰</span>
        </router-link>
        <router-link to="/sensors" class="sidebar-link" @click="isDrawerOpen = false">
          <span class="link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg></span>
          <span>환경 모니터링</span>
        </router-link>
        <router-link to="/reports" class="sidebar-link" @click="isDrawerOpen = false">
          <span class="link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg></span>
          <span>리포트</span>
        </router-link>
        <router-link to="/harvest-rec" class="sidebar-link" @click="isDrawerOpen = false">
          <span class="link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22c4-4 8-7.5 8-12a8 8 0 1 0-16 0c0 4.5 4 8 8 12z"/><circle cx="12" cy="10" r="3"/></svg></span>
          <span>수확 관리</span>
        </router-link>
        <router-link to="/alerts" class="sidebar-link" @click="isDrawerOpen = false">
          <span class="link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></span>
          <span>센서 알림</span>
        </router-link>
        <router-link v-if="isAdmin" to="/users" class="sidebar-link" @click="isDrawerOpen = false">
          <span class="link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></span>
          <span>사용자 관리</span>
        </router-link>
      </nav>

      <!-- 모바일 폰트 크기 조절 -->
      <div class="font-size-control">
        <span class="font-size-label">글자 크기</span>
        <div class="font-size-buttons">
          <button :class="{ active: fontSize === 'sm' }" @click="setFontSize('sm')">가</button>
          <button :class="{ active: fontSize === 'md' }" @click="setFontSize('md')">가</button>
          <button :class="{ active: fontSize === 'lg' }" @click="setFontSize('lg')">가</button>
        </div>
      </div>

      <!-- 모바일 테마 모드 -->
      <div class="theme-control">
        <span class="theme-label">화면 모드</span>
        <div class="theme-buttons">
          <button :class="{ active: theme === 'light' }" @click="setTheme('light')">밝게</button>
          <button :class="{ active: theme === 'dark' }" @click="setTheme('dark')">어둡게</button>
        </div>
      </div>

      <div class="sidebar-footer">
        <div class="sidebar-user">
          <div class="user-avatar">{{ userInitial }}</div>
          <div class="user-details">
            <span class="user-name">{{ userName }}</span>
            <span class="user-role">{{ userRole }}</span>
          </div>
        </div>
        <button class="btn-logout" @click="handleLogout" aria-label="로그아웃">
          로그아웃
        </button>
      </div>
    </aside>

    <!-- 메인 콘텐츠 -->
    <main class="main-content">
      <router-view />
    </main>

    <ConfirmDialog />
    <ToastContainer />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from './stores/auth.store'
import { useNotificationStore } from './stores/notification.store'
import { useWebSocket } from './composables/useWebSocket'
import ConfirmDialog from './components/common/ConfirmDialog.vue'
import ToastContainer from './components/common/ToastContainer.vue'

const router = useRouter()
const authStore = useAuthStore()
const notificationStore = useNotificationStore()
const { connect, disconnect } = useWebSocket()

const isAuthenticated = computed(() => authStore.isAuthenticated)
const isAdmin = computed(() => authStore.isAdmin)
const isFarmUser = computed(() => authStore.isFarmUser)
const userName = computed(() => authStore.user?.name || '사용자')
const userRole = computed(() => {
  if (isAdmin.value) return '플랫폼 관리자'
  if (authStore.isFarmAdmin) return '농장 관리자'
  return '농장 사용자'
})
const userInitial = computed(() => userName.value.charAt(0))

const isDrawerOpen = ref(false)

// 폰트 크기 조절 (localStorage에 저장)
type FontSize = 'sm' | 'md' | 'lg'
const fontSize = ref<FontSize>((localStorage.getItem('sf-font-size') as FontSize) || 'md')

function setFontSize(size: FontSize) {
  fontSize.value = size
  localStorage.setItem('sf-font-size', size)
}

// 테마 모드 (localStorage에 저장)
type ThemeMode = 'light' | 'dark'
const theme = ref<ThemeMode>(
  (localStorage.getItem('sf-theme') as ThemeMode) ||
  (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
)

function setTheme(mode: ThemeMode) {
  theme.value = mode
  localStorage.setItem('sf-theme', mode)
}

onMounted(async () => {
  await authStore.initAuth()
  if (authStore.isAuthenticated) {
    connect()
  }
})

const handleLogout = () => {
  isDrawerOpen.value = false
  authStore.logout()
  disconnect()
  notificationStore.info('로그아웃', '정상적으로 로그아웃되었습니다.')
  router.push('/login')
}
</script>

<style>
*,
*::before,
*::after {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
  -webkit-tap-highlight-color: transparent;
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  background: var(--bg-primary);
  color: var(--text-primary);
  /* 기본 폰트 크기 확대 (45~70세 대상) */
  font-size: 16px;
}

/* ========== 테마 색상 변수 시스템 ========== */
#app {
  /* 배경 */
  --bg-primary: #f5f7fa;
  --bg-secondary: #ffffff;
  --bg-card: #ffffff;
  --bg-hover: #f5f5f5;
  --bg-active: #e8f5e9;
  --bg-input: #ffffff;
  --bg-badge: #f0f0f0;
  --bg-sensor: #f8f0ff;
  --bg-actuator: #f0faf0;
  --bg-condition: #f1f8e9;
  --bg-action: #e8f5e9;
  --bg-info-banner: #e3f2fd;
  /* 텍스트 */
  --text-primary: #333333;
  --text-secondary: #555555;
  --text-muted: #999999;
  --text-link: #666666;
  --text-info-banner: #1565c0;
  /* 테두리 */
  --border-color: #d0d0d0;
  --border-light: #e8e8e8;
  --border-card: #d0d0d0;
  --border-input: #e0e0e0;
  /* 그림자 */
  --shadow-card: 0 2px 8px rgba(0, 0, 0, 0.06);
  --shadow-modal: 0 20px 60px rgba(0, 0, 0, 0.3);
  /* 강조색 */
  --accent: #2e7d32;
  --accent-hover: #1b5e20;
  --accent-bg: #e8f5e9;
  --accent-text: #2e7d32;
  /* 위험색 */
  --danger: #e53935;
  --danger-hover: #c62828;
  --danger-bg: #ffebee;
  /* 경고색 */
  --warning: #ff9800;
  --warning-hover: #f57c00;
  /* 센서 (보라) */
  --sensor-accent: #7b1fa2;
  --sensor-bg: #ede7f6;
  --sensor-value-bg: #f8f0ff;
  /* 자동화 (오렌지) */
  --automation-bg: #fff3e0;
  --automation-text: #e65100;
  /* 차트 */
  --chart-primary: #4caf50;
  --chart-bg: rgba(76, 175, 80, 0.2);
  /* 토글 */
  --toggle-off: #cccccc;
  --toggle-on: #4caf50;
  /* 오버레이 */
  --overlay: rgba(0, 0, 0, 0.5);
}

/* ========== 다크 모드 ========== */
#app.theme-dark {
  --bg-primary: #121212;
  --bg-secondary: #1e1e1e;
  --bg-card: #252525;
  --bg-hover: #333333;
  --bg-active: #1b3a2a;
  --bg-input: #2a2a2a;
  --bg-badge: #333333;
  --bg-sensor: #2a1f3a;
  --bg-actuator: #1a2e1a;
  --bg-condition: #1a2a1a;
  --bg-action: #1a2e1a;
  --bg-info-banner: #1a2a3a;
  --text-primary: #e8e8e8;
  --text-secondary: #b0b0b0;
  --text-muted: #808080;
  --text-link: #b0b0b0;
  --text-info-banner: #64b5f6;
  --border-color: #404040;
  --border-light: #333333;
  --border-card: #404040;
  --border-input: #404040;
  --shadow-card: 0 2px 8px rgba(0, 0, 0, 0.3);
  --shadow-modal: 0 20px 60px rgba(0, 0, 0, 0.6);
  --accent: #4caf50;
  --accent-hover: #66bb6a;
  --accent-bg: #1b3a2a;
  --accent-text: #66bb6a;
  --danger: #ef5350;
  --danger-hover: #f44336;
  --danger-bg: #3a1a1a;
  --warning: #ffa726;
  --warning-hover: #ffb74d;
  --sensor-accent: #ce93d8;
  --sensor-bg: #2a1f3a;
  --sensor-value-bg: #2a1f3a;
  --automation-bg: #3a2a1a;
  --automation-text: #ffb74d;
  --chart-primary: #66bb6a;
  --chart-bg: rgba(102, 187, 106, 0.2);
  --toggle-off: #555555;
  --toggle-on: #4caf50;
  --overlay: rgba(0, 0, 0, 0.7);
}

/* ========== 본문(우측 콘텐츠) 폰트 크기 조절 시스템 ========== */
#app {
  --content-scale: 1;
  --content-body-size: 16px;
  --content-small-size: 14px;
  --content-title-scale: 1;
}

#app.content-size-sm {
  --content-scale: 1;
  --content-body-size: 16px;
  --content-small-size: 14px;
  --content-title-scale: 1;
}

#app.content-size-md {
  --content-scale: 1.1;
  --content-body-size: 17px;
  --content-small-size: 15px;
  --content-title-scale: 1.08;
}

#app.content-size-lg {
  --content-scale: 1.2;
  --content-body-size: 18px;
  --content-small-size: 16px;
  --content-title-scale: 1.15;
}

#app {
  min-height: 100vh;
}

/* ========== 데스크탑 사이드바 레이아웃 ========== */
#app.has-sidebar {
  display: flex;
}

.sidebar {
  width: 260px;
  height: 100vh;
  background: var(--bg-secondary);
  border-right: 1px solid var(--border-light);
  display: flex;
  flex-direction: column;
  position: fixed;
  top: 0;
  left: 0;
  z-index: 100;
}

.sidebar-brand {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 24px 20px;
  border-bottom: 1px solid var(--border-light);
}

.brand-icon-wrap {
  width: 40px;
  height: 40px;
  background: var(--accent-bg);
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.brand-icon-wrap svg {
  width: 22px;
  height: 22px;
  color: var(--accent);
}

.brand-text h1 {
  font-size: 20px;
  font-weight: 700;
  color: var(--accent);
  line-height: 1.2;
}

.brand-sub {
  font-size: 13px;
  color: var(--text-muted);
}

.sidebar-nav {
  flex: 1;
  padding: 12px 12px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
}

.sidebar-link {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border-radius: 10px;
  text-decoration: none;
  color: var(--text-secondary);
  font-size: 1em;
  font-weight: 500;
  transition: background 0.2s, color 0.2s;
}

.sidebar-link:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.sidebar-link .link-icon {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.sidebar-link .link-icon svg {
  width: 20px;
  height: 20px;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.sidebar-link:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.sidebar-link.router-link-active {
  background: var(--accent-bg);
  color: var(--accent);
  font-weight: 600;
}

/* ========== 폰트 크기 조절 ========== */
.font-size-control {
  padding: 12px 16px;
  border-top: 1px solid var(--border-light);
}

.font-size-label {
  display: block;
  font-size: 13px;
  color: var(--text-muted);
  margin-bottom: 8px;
  font-weight: 500;
}

.font-size-buttons {
  display: flex;
  gap: 6px;
}

.font-size-buttons button {
  flex: 1;
  border: 1px solid var(--border-input);
  border-radius: 8px;
  background: var(--bg-secondary);
  cursor: pointer;
  color: var(--text-link);
  font-weight: 600;
  transition: background 0.2s, border-color 0.2s, color 0.2s;
  padding: 6px 0;
}

.font-size-buttons button:nth-child(1) { font-size: 13px; }
.font-size-buttons button:nth-child(2) { font-size: 16px; }
.font-size-buttons button:nth-child(3) { font-size: 19px; }

.font-size-buttons button.active {
  background: var(--accent-bg);
  border-color: var(--accent);
  color: var(--accent);
}

.font-size-buttons button:hover:not(.active) {
  background: var(--bg-hover);
}

/* ========== 테마 모드 조절 ========== */
.theme-control {
  padding: 12px 16px;
  border-top: 1px solid var(--border-light);
}

.theme-label {
  display: block;
  font-size: 13px;
  color: var(--text-muted);
  margin-bottom: 8px;
  font-weight: 500;
}

.theme-buttons {
  display: flex;
  gap: 6px;
}

.theme-buttons button {
  flex: 1;
  border: 1px solid var(--border-input);
  border-radius: 8px;
  background: var(--bg-secondary);
  cursor: pointer;
  color: var(--text-link);
  font-weight: 600;
  font-size: 13px;
  padding: 6px 0;
  transition: background 0.2s, border-color 0.2s, color 0.2s;
}

.theme-buttons button.active {
  background: var(--accent-bg);
  border-color: var(--accent);
  color: var(--accent);
}

.theme-buttons button:hover:not(.active) {
  background: var(--bg-hover);
}

/* ========== 사이드바 하단 ========== */
.sidebar-footer {
  padding: 16px 16px;
  border-top: 1px solid var(--border-light);
}

.sidebar-user {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.user-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 16px;
  flex-shrink: 0;
}

.user-details {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.user-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.user-role {
  font-size: 13px;
  color: var(--text-muted);
}

.btn-logout {
  width: 100%;
  padding: 10px;
  background: var(--bg-hover);
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-link);
  cursor: pointer;
  transition: background 0.2s, color 0.2s;
}

.btn-logout:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.btn-logout:hover {
  background: var(--danger-bg);
  color: var(--danger);
}

/* ========== 메인 콘텐츠 ========== */
.main-content {
  flex: 1;
  min-height: 100vh;
  font-size: var(--content-body-size);
  line-height: 1.55;
  background: var(--bg-primary);
  color: var(--text-primary);
}

/* 본문 공통 가독성 보정 */
.main-content p,
.main-content li,
.main-content td,
.main-content th,
.main-content label,
.main-content input,
.main-content select,
.main-content textarea,
.main-content button {
  font-size: calc(1em * var(--content-scale));
}

.main-content small,
.main-content .help-text,
.main-content .rule-summary,
.main-content .page-description,
.main-content .target-label,
.main-content .priority-badge {
  font-size: var(--content-small-size) !important;
}

.main-content .page-header h2,
.main-content .rule-name,
.main-content .modal-title,
.main-content .step-title {
  font-size: calc(1em * var(--content-title-scale)) !important;
}

#app.has-sidebar .main-content {
  margin-left: 260px;
}

/* ========== 모바일 헤더 ========== */
.mobile-header {
  display: none;
}

/* ========== 모바일 드로어 ========== */
.drawer {
  display: none;
}

.drawer-overlay {
  display: none;
}

/* ========== 반응형 - 모바일 ========== */
@media (max-width: 768px) {
  #app.has-sidebar {
    flex-direction: column;
  }

  .sidebar {
    display: none;
  }

  #app.has-sidebar .main-content {
    margin-left: 0;
    padding-top: 60px;
  }

  .mobile-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 60px;
    padding: 0 16px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border-light);
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 90;
    padding-top: env(safe-area-inset-top, 0px);
  }

  .hamburger {
    width: 44px;
    height: 44px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 5px;
    background: none;
    border: none;
    cursor: pointer;
    padding: 8px;
  }

  .hamburger span {
    display: block;
    width: 22px;
    height: 2px;
    background: var(--text-primary);
    border-radius: 1px;
  }

  .mobile-brand {
    font-size: 18px;
    font-weight: 700;
    color: var(--accent);
  }

  .mobile-header-spacer {
    width: 44px;
  }

  .drawer-overlay {
    display: block;
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: var(--overlay);
    z-index: 200;
  }

  .drawer {
    display: flex;
    flex-direction: column;
    position: fixed;
    top: 0;
    left: 0;
    bottom: 0;
    width: 280px;
    background: var(--bg-secondary);
    z-index: 210;
    transform: translateX(-100%);
    transition: transform 0.3s ease;
    padding-top: env(safe-area-inset-top, 0px);
  }

  .drawer.open {
    transform: translateX(0);
  }

  .drawer .sidebar-brand {
    position: relative;
  }

  .drawer-close {
    position: absolute;
    right: 12px;
    top: 50%;
    transform: translateY(-50%);
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    font-size: 18px;
    color: var(--text-muted);
    cursor: pointer;
    border-radius: 8px;
  }

  .drawer-close:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .drawer .sidebar-nav {
    flex: 1;
    overflow-y: auto;
  }

  .drawer .sidebar-link {
    font-size: 1.05em;
    padding: 16px 16px;
  }

  .drawer .sidebar-footer {
    padding-bottom: calc(16px + env(safe-area-inset-bottom, 0px));
  }
}
</style>
