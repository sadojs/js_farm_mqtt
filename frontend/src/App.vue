<template>
  <div id="app" :class="['content-size-' + fontSize, 'layout-' + mode, { 'has-sidebar': showShell, 'theme-dark': theme === 'dark' }]">
    <!-- 데스크탑 사이드바 -->
    <aside v-if="showShell" class="sidebar">
      <div class="sidebar-brand">
        <div class="brand-icon-wrap">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2z"/><path d="M12 6v6l4 2"/></svg>
        </div>
        <div class="brand-text">
          <h1>스마트팜</h1>
          <span class="brand-sub">Smart Farm IoT</span>
        </div>
      </div>

      <!-- role 미확정 (farm_user 의 worker 여부 확인 중) — NAV 깜빡임 방지 -->
      <nav
        v-if="isAuthenticated && !roleResolved"
        class="sidebar-nav sidebar-nav-loading"
        aria-busy="true"
        aria-label="메뉴 불러오는 중"
      >
        <div class="nav-loading-skeleton">
          <span></span><span></span><span></span><span></span>
        </div>
      </nav>

      <!-- 관리자 메뉴 -->
      <nav v-else-if="isAdmin" class="sidebar-nav">
        <div class="nav-section-label">플랫폼 운영</div>
        <router-link to="/users" class="sidebar-link">
          <span class="link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></span>
          <span>사용자 관리</span>
        </router-link>
        <router-link to="/admin/farms" class="sidebar-link">
          <span class="link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg></span>
          <span>농장 관리</span>
        </router-link>
        <router-link to="/gateways" class="sidebar-link">
          <span class="link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg></span>
          <span>게이트웨이</span>
        </router-link>
        <router-link to="/config-deploy" class="sidebar-link">
          <span class="link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/><polyline points="7 11 12 16 17 11"/><line x1="12" y1="4" x2="12" y2="16"/></svg></span>
          <span>설정 배포</span>
        </router-link>
        <router-link to="/emergency-failover" class="sidebar-link sidebar-link-danger">
          <span class="link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></span>
          <span>이머전시</span>
        </router-link>

        <div class="nav-section-label">농장 모니터링</div>
        <router-link to="/dashboard" class="sidebar-link">
          <span class="link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg></span>
          <span>우리 농장</span>
        </router-link>
        <router-link to="/groups" class="sidebar-link">
          <span class="link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></span>
          <span>구역 관리</span>
        </router-link>
        <router-link to="/automation" class="sidebar-link">
          <span class="link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></span>
          <span>자동 제어 설정</span>
        </router-link>

        <div class="nav-section-label">농장 운영</div>
        <router-link v-if="featureOn('spray_schedule')" to="/spray-schedule" class="sidebar-link">
          <span class="link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg></span>
          <span>방재 일정</span>
        </router-link>
        <router-link v-if="featureOn('worker_payroll')" to="/worker-payroll" class="sidebar-link">
          <span class="link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"/></svg></span>
          <span>일꾼 관리</span>
        </router-link>
      </nav>

      <!-- 일꾼(농장 사용자-근무계정) 메뉴: 정산만 -->
      <nav v-else-if="isWorker" class="sidebar-nav">
        <router-link to="/worker-payroll" class="sidebar-link">
          <span class="link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"/></svg></span>
          <span>내 근무·정산</span>
        </router-link>
      </nav>

      <!-- 농장 관리자 메뉴 -->
      <nav v-else-if="isFarmAdmin" class="sidebar-nav">
        <div class="nav-section-label">모니터링</div>
        <router-link to="/dashboard" class="sidebar-link">
          <span class="link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg></span>
          <span>우리 농장</span>
        </router-link>
        <router-link to="/sensors" class="sidebar-link">
          <span class="link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg></span>
          <span>농장 환경</span>
        </router-link>
        <router-link to="/reports" class="sidebar-link">
          <span class="link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg></span>
          <span>환경 비교</span>
        </router-link>
        <router-link to="/alerts" class="sidebar-link">
          <span class="link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></span>
          <span>이상 알림</span>
        </router-link>

        <div class="nav-section-label">운영 · 제어</div>
        <router-link to="/groups" class="sidebar-link">
          <span class="link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></span>
          <span>구역 관리</span>
        </router-link>
        <router-link to="/automation" class="sidebar-link">
          <span class="link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></span>
          <span>자동 제어 설정</span>
        </router-link>
        <router-link v-if="featureOn('work_log')" to="/work-log" class="sidebar-link">
          <span class="link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><path d="M8 14l2 2 4-4"/></svg></span>
          <span>농작업 일정</span>
        </router-link>
        <router-link v-if="featureOn('spray_schedule')" to="/spray-schedule" class="sidebar-link">
          <span class="link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg></span>
          <span>방재 일정</span>
        </router-link>

        <div class="nav-section-label">재배 · 인력</div>
        <router-link v-if="cropFeature.enabled" to="/crop-management" class="sidebar-link">
          <span class="link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22V12"/><path d="M5 12H2a10 10 0 0 0 20 0h-3"/><path d="M8 12a4 4 0 0 1 8 0"/><path d="M12 12V2"/></svg></span>
          <span>생육관리</span>
        </router-link>
        <router-link v-if="featureOn('worker_payroll')" to="/worker-payroll" class="sidebar-link">
          <span class="link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"/></svg></span>
          <span>일꾼 관리</span>
        </router-link>

        <div class="nav-section-label">기록</div>
        <router-link to="/activity-log" class="sidebar-link">
          <span class="link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></span>
          <span>동작 이력</span>
        </router-link>
      </nav>

      <!-- 농장 사용자 메뉴 (worker 가 아닌 farm_user) -->
      <nav v-else-if="isFarmUser" class="sidebar-nav">
        <div class="nav-section-label">모니터링</div>
        <router-link to="/sensors" class="sidebar-link">
          <span class="link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg></span>
          <span>농장 환경</span>
        </router-link>
        <router-link to="/alerts" class="sidebar-link">
          <span class="link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></span>
          <span>이상 알림</span>
        </router-link>

        <div class="nav-section-label">작업</div>
        <router-link to="/groups" class="sidebar-link">
          <span class="link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></span>
          <span>구역 관리</span>
        </router-link>
        <router-link v-if="featureOn('work_log')" to="/work-log" class="sidebar-link">
          <span class="link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><path d="M8 14l2 2 4-4"/></svg></span>
          <span>농작업 일정</span>
        </router-link>
        <router-link v-if="featureOn('spray_schedule')" to="/spray-schedule" class="sidebar-link">
          <span class="link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg></span>
          <span>방재 일정</span>
        </router-link>
      </nav>

      <!-- 알림 + 시계/버전 -->
      <div class="sidebar-bottom-info">
        <div class="sidebar-notification-row">
          <NotificationCenter placement="right" />
          <span class="sidebar-notification-label">알림</span>
        </div>
        <div class="sidebar-info-row">
          <span class="sidebar-clock">{{ currentTime }}</span>
          <span class="sidebar-version">Smart Farm IoT v0.1.0</span>
        </div>
      </div>

      <div class="sidebar-footer">
        <div class="sidebar-user">
          <div class="user-avatar">{{ userInitial }}</div>
          <div class="user-details">
            <span class="user-name">{{ userName }}</span>
            <span class="user-role">{{ userRole }}</span>
          </div>
          <button class="btn-settings" @click="showSettings = true" aria-label="환경설정" title="환경설정">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          </button>
        </div>
        <button class="btn-logout" @click="handleLogout" aria-label="로그아웃">
          로그아웃
        </button>
      </div>
    </aside>

    <!-- 태블릿 헤더 (태블릿 모드 전용 — 사이드바 접힘, 페이지명·연결상태 표시) -->
    <TabletHeader
      v-if="showShell && mode === 'tablet'"
      :connected="connected"
      @open-drawer="isDrawerOpen = true"
      @open-settings="showSettings = true"
    />

    <!-- 모바일 헤더 -->
    <header v-if="showShell" class="mobile-header">
      <button class="hamburger" @click="isDrawerOpen = true" aria-label="메뉴 열기">
        <span></span>
        <span></span>
        <span></span>
      </button>
      <div class="mobile-brand">스마트팜</div>
      <div class="mobile-header-actions">
        <div class="mobile-fontsize-toggle" aria-label="글자 크기">
          <button :class="['btn-font-md', { active: fontSize === 'md' }]" @click="setFontSize('md')" aria-label="보통">가</button>
          <button :class="['btn-font-lg', { active: fontSize === 'lg' }]" @click="setFontSize('lg')" aria-label="크게">가</button>
        </div>
        <NotificationCenter />
      </div>
    </header>

    <!-- 모바일 드로어 오버레이 -->
    <div
      v-if="showShell && isDrawerOpen"
      class="drawer-overlay"
      @click="isDrawerOpen = false"
    ></div>

    <!-- 모바일 드로어 -->
    <aside
      v-if="showShell"
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

      <!-- role 미확정 (worker 여부 확인 중) — 깜빡임 방지 -->
      <nav
        v-if="isAuthenticated && !roleResolved"
        class="sidebar-nav sidebar-nav-loading"
        aria-busy="true"
        aria-label="메뉴 불러오는 중"
      >
        <div class="nav-loading-skeleton">
          <span></span><span></span><span></span><span></span>
        </div>
      </nav>

      <!-- 관리자 메뉴 (모바일) -->
      <nav v-else-if="isAdmin" class="sidebar-nav">
        <div class="nav-section-label">플랫폼 운영</div>
        <router-link to="/users" class="sidebar-link" @click="isDrawerOpen = false">
          <span class="link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></span>
          <span>사용자 관리</span>
        </router-link>
        <router-link to="/admin/farms" class="sidebar-link" @click="isDrawerOpen = false">
          <span class="link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg></span>
          <span>농장 관리</span>
        </router-link>
        <router-link to="/gateways" class="sidebar-link" @click="isDrawerOpen = false">
          <span class="link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg></span>
          <span>게이트웨이</span>
        </router-link>
        <router-link to="/config-deploy" class="sidebar-link" @click="isDrawerOpen = false">
          <span class="link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/><polyline points="7 11 12 16 17 11"/><line x1="12" y1="4" x2="12" y2="16"/></svg></span>
          <span>설정 배포</span>
        </router-link>
        <router-link to="/emergency-failover" class="sidebar-link sidebar-link-danger" @click="isDrawerOpen = false">
          <span class="link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></span>
          <span>이머전시</span>
        </router-link>

        <div class="nav-section-label">농장 모니터링</div>
        <router-link to="/dashboard" class="sidebar-link" @click="isDrawerOpen = false">
          <span class="link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg></span>
          <span>우리 농장</span>
        </router-link>
        <router-link to="/groups" class="sidebar-link" @click="isDrawerOpen = false">
          <span class="link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></span>
          <span>구역 관리</span>
        </router-link>
        <router-link to="/automation" class="sidebar-link" @click="isDrawerOpen = false">
          <span class="link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></span>
          <span>자동 제어 설정</span>
        </router-link>

        <div class="nav-section-label">농장 운영</div>
        <router-link v-if="featureOn('spray_schedule')" to="/spray-schedule" class="sidebar-link" @click="isDrawerOpen = false">
          <span class="link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg></span>
          <span>방재 일정</span>
        </router-link>
        <router-link v-if="featureOn('worker_payroll')" to="/worker-payroll" class="sidebar-link" @click="isDrawerOpen = false">
          <span class="link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"/></svg></span>
          <span>일꾼 관리</span>
        </router-link>
      </nav>

      <!-- 일꾼(농장 사용자-근무계정) 메뉴 (모바일): 정산만 -->
      <nav v-else-if="isWorker" class="sidebar-nav">
        <router-link to="/worker-payroll" class="sidebar-link" @click="isDrawerOpen = false">
          <span class="link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"/></svg></span>
          <span>내 근무·정산</span>
        </router-link>
      </nav>

      <!-- 농장 관리자 메뉴 (모바일) -->
      <nav v-else-if="isFarmAdmin" class="sidebar-nav">
        <div class="nav-section-label">모니터링</div>
        <router-link to="/dashboard" class="sidebar-link" @click="isDrawerOpen = false">
          <span class="link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg></span>
          <span>우리 농장</span>
        </router-link>
        <router-link to="/sensors" class="sidebar-link" @click="isDrawerOpen = false">
          <span class="link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg></span>
          <span>농장 환경</span>
        </router-link>
        <router-link to="/reports" class="sidebar-link" @click="isDrawerOpen = false">
          <span class="link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg></span>
          <span>환경 비교</span>
        </router-link>
        <router-link to="/alerts" class="sidebar-link" @click="isDrawerOpen = false">
          <span class="link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></span>
          <span>이상 알림</span>
        </router-link>

        <div class="nav-section-label">운영 · 제어</div>
        <router-link to="/groups" class="sidebar-link" @click="isDrawerOpen = false">
          <span class="link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></span>
          <span>구역 관리</span>
        </router-link>
        <router-link to="/automation" class="sidebar-link" @click="isDrawerOpen = false">
          <span class="link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></span>
          <span>자동 제어 설정</span>
        </router-link>
        <router-link v-if="featureOn('work_log')" to="/work-log" class="sidebar-link" @click="isDrawerOpen = false">
          <span class="link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><path d="M8 14l2 2 4-4"/></svg></span>
          <span>농작업 일정</span>
        </router-link>
        <router-link v-if="featureOn('spray_schedule')" to="/spray-schedule" class="sidebar-link" @click="isDrawerOpen = false">
          <span class="link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg></span>
          <span>방재 일정</span>
        </router-link>

        <div class="nav-section-label">재배 · 인력</div>
        <router-link v-if="cropFeature.enabled" to="/crop-management" class="sidebar-link" @click="isDrawerOpen = false">
          <span class="link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22V12"/><path d="M5 12H2a10 10 0 0 0 20 0h-3"/><path d="M8 12a4 4 0 0 1 8 0"/><path d="M12 12V2"/></svg></span>
          <span>생육관리</span>
        </router-link>
        <router-link v-if="featureOn('worker_payroll')" to="/worker-payroll" class="sidebar-link" @click="isDrawerOpen = false">
          <span class="link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"/></svg></span>
          <span>일꾼 관리</span>
        </router-link>

        <div class="nav-section-label">기록</div>
        <router-link to="/activity-log" class="sidebar-link" @click="isDrawerOpen = false">
          <span class="link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></span>
          <span>동작 이력</span>
        </router-link>
      </nav>

      <!-- 농장 사용자 메뉴 (모바일, worker 가 아닌 farm_user) -->
      <nav v-else-if="isFarmUser" class="sidebar-nav">
        <div class="nav-section-label">모니터링</div>
        <router-link to="/sensors" class="sidebar-link" @click="isDrawerOpen = false">
          <span class="link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg></span>
          <span>농장 환경</span>
        </router-link>
        <router-link to="/alerts" class="sidebar-link" @click="isDrawerOpen = false">
          <span class="link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></span>
          <span>이상 알림</span>
        </router-link>

        <div class="nav-section-label">작업</div>
        <router-link to="/groups" class="sidebar-link" @click="isDrawerOpen = false">
          <span class="link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></span>
          <span>구역 관리</span>
        </router-link>
        <router-link v-if="featureOn('work_log')" to="/work-log" class="sidebar-link" @click="isDrawerOpen = false">
          <span class="link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><path d="M8 14l2 2 4-4"/></svg></span>
          <span>농작업 일정</span>
        </router-link>
        <router-link v-if="featureOn('spray_schedule')" to="/spray-schedule" class="sidebar-link" @click="isDrawerOpen = false">
          <span class="link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg></span>
          <span>방재 일정</span>
        </router-link>
      </nav>

      <div class="sidebar-footer">
        <div class="sidebar-user">
          <div class="user-avatar">{{ userInitial }}</div>
          <div class="user-details">
            <span class="user-name">{{ userName }}</span>
            <span class="user-role">{{ userRole }}</span>
          </div>
          <button class="btn-settings" @click="showSettings = true; isDrawerOpen = false" aria-label="환경설정" title="환경설정">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          </button>
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
    <VoiceAssistant v-if="showShell" />
    <UserSettingsModal
      v-if="showSettings"
      :fontSize="fontSize"
      :theme="theme"
      :isFarmAdmin="isFarmAdmin"
      :cropFeature="cropFeature"
      :featureFlags="featureFlags"
      @close="showSettings = false"
      @set-font="setFontSize"
      @set-theme="setTheme"
      @toggle-crop="toggleCropFeature"
      @toggle-feature="toggleFeature"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from './stores/auth.store'
import { useNoDoubleTapZoom } from './composables/useNoDoubleTapZoom'
import { useNotificationStore } from './stores/notification.store'
import { useWebSocket } from './composables/useWebSocket'
// 네이티브 앱 전용 OS 푸시 등록 (웹에서는 no-op)
import { initNativePush } from './composables/useNativePush'
import ConfirmDialog from './components/common/ConfirmDialog.vue'
import ToastContainer from './components/common/ToastContainer.vue'
import NotificationCenter from './components/common/NotificationCenter.vue'
import VoiceAssistant from './modules/voice-assistant/VoiceAssistant.vue'
import UserSettingsModal from './components/common/UserSettingsModal.vue'
import TabletHeader from './components/common/TabletHeader.vue'
import { useLayoutMode } from './composables/useLayoutMode'
import { useCropFeature } from './modules/crop-management/composables/useCropFeature'
import { useFeatureFlags, type FeatureKey } from './composables/useFeatureFlags'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()
const notificationStore = useNotificationStore()
const { connect, disconnect, connected } = useWebSocket()

// 레이아웃 모드(모바일/태블릿/데스크탑) — #app 클래스 바인딩 + 태블릿 헤더 렌더 판정
const { mode } = useLayoutMode()

useNoDoubleTapZoom()

const isAuthenticated = computed(() => authStore.isAuthenticated)
const isAdmin = computed(() => authStore.isAdmin)
const isFarmAdmin = computed(() => authStore.isFarmAdmin)
const isFarmUser = computed(() => authStore.isFarmUser)
const isWorker = computed(() => authStore.isWorker)
// farm_user 는 worker 여부 확정(`isWorkerAccount` !== null) 후에만 NAV 분기 표시
const roleResolved = computed(() =>
  authStore.isAdmin
  || authStore.isFarmAdmin
  || (authStore.isFarmUser && authStore.isWorkerAccount !== null),
)
// 임시 비밀번호 변경 강제 중에는 사이드바/헤더 숨김(로그인처럼 단독 화면)
const mustChangePassword = computed(() => authStore.user?.mustChangePassword === true)
const showShell = computed(() => isAuthenticated.value && !mustChangePassword.value)

const { feature: cropFeature, fetchFeature: fetchCropFeature, setFeature: setCropFeature } = useCropFeature()
const { features: featureFlags, fetchFeatures, setFeature: setFeatureFlag } = useFeatureFlags()
const showSettings = ref(false)

async function toggleCropFeature() {
  await setCropFeature(!cropFeature.value.userEnabled, 'personal')
}
/** 부가기능 메뉴 노출 여부 (기본 true) */
function featureOn(key: FeatureKey): boolean {
  return featureFlags.value[key]?.enabled !== false
}
async function toggleFeature(key: FeatureKey) {
  await setFeatureFlag(key, !featureFlags.value[key]?.userEnabled, 'personal')
}
const userName = computed(() => authStore.user?.name || '사용자')
const userRole = computed(() => {
  if (isAdmin.value) return '플랫폼 관리자'
  if (authStore.isFarmAdmin) return '농장 관리자'
  return '농장 사용자'
})
const userInitial = computed(() => userName.value.charAt(0))

const isDrawerOpen = ref(false)

// 실시간 시계
const currentTime = ref('')
let clockTimer: ReturnType<typeof setInterval> | null = null

function updateClock() {
  currentTime.value = new Date().toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

// 폰트 크기 조절 (localStorage에 저장)
// 2단계: 보통(md, 기본) / 크게(lg). 기존 'sm'(작게)은 제거.
type FontSize = 'md' | 'lg'
// 기존에 저장된 'sm'(작게)은 이제 없으므로 'md'(보통)로 승격
const fontSize = ref<FontSize>(localStorage.getItem('sf-font-size') === 'lg' ? 'lg' : 'md')

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

onMounted(() => {
  if (authStore.isAuthenticated) {
    connect()
    fetchCropFeature()
    fetchFeatures()
    authStore.resolveWorkerStatus()
    void initNativePush() // 앱에서만 실행 (웹 no-op)
  }
  updateClock()
  clockTimer = setInterval(updateClock, 10000)
})

// 로그인 직후(비인증 → 인증)에도 푸시 등록 — 앱에서만 동작, 웹은 no-op
watch(isAuthenticated, (authed) => {
  if (authed) {
    void initNativePush()
    return
  }
  // 인증 소멸(무음 갱신 실패·토큰 만료 등) 시 셸(상단바·사이드바)이 사라지므로,
  // 보호된 화면에 햄버거도 없이 갇히지 않도록 로그인으로 강제 이동한다. (셸 안전장치)
  if (route.path !== '/login') {
    router.replace('/login')
  }
})

// 라우트 이동 시 모바일 drawer 자동 닫기 — 메뉴 항목 클릭 후 본문이 가려지는 문제 방지
watch(
  () => route.fullPath,
  () => {
    if (isDrawerOpen.value) isDrawerOpen.value = false
  },
)

onUnmounted(() => {
  if (clockTimer) clearInterval(clockTimer)
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
  font-size: calc(16px * var(--content-scale, 1));
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
  --warning-bg: #fef3c7;
  --warning-text: #92400e;
  --warning-border: #fde68a;
  --success-bg: #dcfce7;
  --success-text: #166534;
  --danger-badge-bg: #fee2e2;
  --danger-badge-text: #991b1b;
  --diff-old: #dc2626;
  --diff-new: #16a34a;
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
  --warning-bg: #3a2a0a;
  --warning-text: #fbbf24;
  --warning-border: #78510a;
  --success-bg: #0a2a1a;
  --success-text: #4ade80;
  --danger-badge-bg: #3a1a1a;
  --danger-badge-text: #f87171;
  --diff-old: #f87171;
  --diff-new: #4ade80;
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

/* ========== 다크모드 글로벌 오버라이드 ========== */
/* 토글 스위치의 흰색 thumb를 다크모드에서 어두운 베이지로 변환 */
#app.theme-dark .toggle-slider::before,
#app.theme-dark .toggle span:not(.toggle-slider),
#app.theme-dark label.toggle span[style*="background"] {
  background: #d4d4d4 !important;
}

/* 라이트모드용 밝은 배지(상태/역할) — 다크모드 반투명 오버라이드 */
#app.theme-dark .role-badge.admin,
#app.theme-dark .badge-online,
#app.theme-dark .log-status.started,
#app.theme-dark .chip.menu {
  background: rgba(33, 150, 243, 0.18);
  color: #90caf9;
}
#app.theme-dark .role-badge.farm_admin,
#app.theme-dark .log-status.cancelled,
#app.theme-dark .log-status.update,
#app.theme-dark .status-badge.warning {
  background: rgba(255, 152, 0, 0.18);
  color: #ffb74d;
}
#app.theme-dark .role-badge.farm_user,
#app.theme-dark .gateway-tag,
#app.theme-dark .project-badge,
#app.theme-dark .status-badge.active,
#app.theme-dark .log-status.success,
#app.theme-dark .log-status.create {
  background: rgba(76, 175, 80, 0.18);
  color: #81c784;
}
#app.theme-dark .gateway-tag.offline,
#app.theme-dark .status-badge.inactive,
#app.theme-dark .log-status.fail,
#app.theme-dark .log-status.delete,
#app.theme-dark .chip.error {
  background: rgba(244, 67, 54, 0.18);
  color: #ef9a9a;
}
#app.theme-dark .badge-offline {
  background: rgba(120, 120, 120, 0.25);
  color: #b0b0b0;
}

/* hover 시 밝은 빨강 → 다크모드 반투명 */
#app.theme-dark .btn-icon.danger:hover,
#app.theme-dark .btn-gw-detach:hover,
#app.theme-dark .btn-danger:hover {
  background: rgba(244, 67, 54, 0.15) !important;
}

/* 오프라인/비활성 dot */
#app.theme-dark .dot-off {
  background: var(--border-color) !important;
}

/* ========== 폰트 크기 조절 시스템 (font-size 전용, 2단계) ==========
   방식: 모든 font-size 를 calc(px * var(--content-scale)) 로 통일 → 토글 시 --content-scale
   만 바뀌어 '글씨 크기만' 커진다. 아이콘/토글/이미지(width·height)·여백은 그대로 유지되어
   레이아웃 손상이 없다. (var(--font-size-*) 사용 컴포넌트도 아래에서 함께 스케일)
   보통(md, 기본)=1.0 / 크게(lg)=1.2배. */
#app {
  --content-scale: 1;
  --font-size-display: 38px;
  --font-size-title: 26px;
  --font-size-subtitle: 22px;
  --font-size-body: 18px;
  --font-size-label: 16px;
  --font-size-caption: 14px;
  --font-size-tiny: 13px;
}

/* 크게(lg): '본문(.main-content)' 글씨만 1.2배. 헤더/사이드바(chrome)는 main-content 밖이라
   자동으로 기본 크기 유지. 변수만 바뀌므로 아이콘/토글/여백 등 레이아웃은 그대로. */
#app.content-size-lg .main-content {
  --content-scale: 1.2;
  --font-size-display: 46px;
  --font-size-title: 31px;
  --font-size-subtitle: 26px;
  --font-size-body: 22px;
  --font-size-label: 19px;
  --font-size-caption: 17px;
  --font-size-tiny: 16px;
}

/* 제목줄(페이지/카드/섹션)은 확대 제외 → 변수만 기본값으로 되돌린다.
   variable 상속이라 그 안의 텍스트·이모지·아이콘·여백이 전부 기본 크기가 되고,
   zoom 방식과 달리 오프셋/이중축소/여백팽창이 전혀 없다. */
#app.content-size-lg .main-content :is(
  .page-header, .card-header, .section-header, .panel-header,
  .card-title, .section-title, .widget-title, .page-title
) {
  --content-scale: 1;
  --font-size-display: 38px;
  --font-size-title: 26px;
  --font-size-subtitle: 22px;
  --font-size-body: 18px;
  --font-size-label: 16px;
  --font-size-caption: 14px;
  --font-size-tiny: 13px;
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
  font-size: calc(20px * var(--content-scale, 1));
  font-weight: 700;
  color: var(--accent);
  line-height: 1.2;
}

.brand-sub {
  font-size: calc(13px * var(--content-scale, 1));
  color: var(--text-muted);
}

.sidebar-nav {
  flex: 1;
  padding: 12px 12px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
  /* 사이드바 메뉴를 끝까지 스크롤해도 본문(window)으로 스크롤이 전파되지 않도록 차단
     (scroll chaining 방지 — 사이드바 위에서 스크롤하면 사이드바 안에서만 동작) */
  overscroll-behavior: contain;
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
  /* 접근성: 터치 타겟 최소 44px 확보 */
  min-height: 44px;
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

/* 섹션 그룹 라벨 */
.nav-section-label {
  font-size: calc(10.5px * var(--content-scale, 1));
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 4px 12px 6px;
}
.nav-section-label:not(:first-child) {
  margin-top: 10px;
}

/* 이머전시(위험) 강조 링크 */
.sidebar-link-danger {
  color: var(--danger);
}
.sidebar-link-danger:hover {
  background: var(--danger-bg);
  color: var(--danger-hover);
}
.sidebar-link-danger.router-link-active {
  background: var(--danger-bg);
  color: var(--danger-hover);
}

/* ========== 폰트 크기 조절 ========== */
.font-size-control {
  padding: 12px 16px;
  border-top: 1px solid var(--border-light);
}

.font-size-label {
  display: block;
  font-size: calc(13px * var(--content-scale, 1));
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

.font-size-buttons button:nth-child(1) { font-size: calc(13px * var(--content-scale, 1)); }
.font-size-buttons button:nth-child(2) { font-size: calc(16px * var(--content-scale, 1)); }
.font-size-buttons button:nth-child(3) { font-size: calc(19px * var(--content-scale, 1)); }

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
  font-size: calc(13px * var(--content-scale, 1));
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
  font-size: calc(13px * var(--content-scale, 1));
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

/* ========== 사이드바 하단 정보 (알림 + 시계/버전) ========== */
.sidebar-bottom-info {
  border-top: 1px solid var(--border-light);
}

.sidebar-notification-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
}

.sidebar-notification-label {
  font-size: calc(13px * var(--content-scale, 1));
  color: var(--text-muted);
  font-weight: 500;
}

.sidebar-info-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 16px 10px;
}

.sidebar-clock {
  font-size: calc(18px * var(--content-scale, 1));
  font-weight: 700;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}

.sidebar-version {
  font-size: calc(11px * var(--content-scale, 1));
  color: var(--text-muted);
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
  font-size: calc(16px * var(--content-scale, 1));
  flex-shrink: 0;
}

.user-details {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.user-name {
  font-size: calc(14px * var(--content-scale, 1));
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.user-role {
  font-size: calc(13px * var(--content-scale, 1));
  color: var(--text-muted);
}

.btn-logout {
  width: 100%;
  padding: 10px;
  background: var(--bg-hover);
  border: none;
  border-radius: 8px;
  font-size: calc(14px * var(--content-scale, 1));
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

.btn-settings {
  margin-left: auto;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: none;
  border: 1px solid var(--border-light);
  color: var(--text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: background 0.2s, color 0.2s;
}

.btn-settings:hover {
  background: var(--accent-bg);
  color: var(--accent);
  border-color: var(--accent);
}

/* ========== 메인 콘텐츠 ========== */
.main-content {
  flex: 1;
  min-height: 100vh;
  font-size: var(--font-size-body);
  line-height: 1.55;
  background: var(--bg-primary);
  color: var(--text-primary);
  /* 페이지 헤더/콘텐츠가 사이드바와 너무 가까이 붙지 않도록 좌우 패딩 + 상단 여유
     (전체 화면 밀도 개선 요청 — 여백 축소) */
  padding: 18px 20px 24px 20px;
  box-sizing: border-box;
}

/* 모바일에서는 사이드바가 collapse되므로 패딩 더 축소(카드 폭 확보) */
@media (max-width: 768px) {
  .main-content { padding: 12px 10px 18px 10px; }
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
  font-size: var(--font-size-body);
}

.main-content small,
.main-content .help-text,
.main-content .rule-summary,
.main-content .page-description,
.main-content .target-label,
.main-content .priority-badge {
  font-size: var(--font-size-label) !important;
}

.main-content .page-header h2,
.main-content .rule-name,
.main-content .modal-title,
.main-content .step-title {
  font-size: var(--font-size-subtitle) !important;
}

#app.has-sidebar .main-content {
  margin-left: 260px;
  /* app-shell: 사이드바는 고정(position:fixed)이고 본문만 독립 스크롤.
     본문을 자체 스크롤 영역으로 만들어, 본문 위에서 휠 시 항상 본문이 스크롤되고
     사이드바 스크롤과 서로 간섭(전파)하지 않도록 한다. */
  height: 100vh;
  overflow-y: auto;
  overscroll-behavior: contain;
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
    /* 고정 헤더(60px) + iOS 세이프에어리어(다이나믹 아일랜드) 만큼 본문을 내린다 */
    padding-top: calc(60px + env(safe-area-inset-top, 0px));
    /* 모바일은 사이드바가 없으므로 본문 pane 스크롤을 해제하고 일반 페이지(window) 스크롤 사용 */
    height: auto;
    overflow-y: visible;
  }

  .mobile-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    /* 총 높이 = 세이프에어리어 + 60px 콘텐츠. padding-top 이 콘텐츠를 아일랜드 아래로 민다.
       (height 60px 고정 + padding-top 조합은 box-sizing:border-box 에서 콘텐츠가 찌그러졌음) */
    height: calc(60px + env(safe-area-inset-top, 0px));
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
    font-size: calc(18px * var(--content-scale, 1));
    font-weight: 700;
    color: var(--accent);
  }

  .mobile-header-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .mobile-fontsize-toggle {
    display: flex;
    gap: 2px;
  }

  .mobile-fontsize-toggle button {
    width: 30px;
    height: 30px;
    border: 1px solid var(--border-input);
    border-radius: 6px;
    background: var(--bg-secondary);
    cursor: pointer;
    color: var(--text-link);
    font-weight: 600;
    transition: background 0.2s, border-color 0.2s, color 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .btn-font-sm { font-size: calc(11px * var(--content-scale, 1)); }
  .btn-font-md { font-size: calc(13px * var(--content-scale, 1)); }
  .btn-font-lg { font-size: calc(15px * var(--content-scale, 1)); }

  .mobile-fontsize-toggle button.active {
    background: var(--accent-bg);
    border-color: var(--accent);
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
    font-size: calc(18px * var(--content-scale, 1));
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

/* ═══════════════════════════════════════════════════════════
   태블릿 모드 (하우스 고정 설치용, 1280×800) — 클래스 기반 분리
   ⚠️ 위 @media (max-width: 768px) 블록은 수정하지 않음. 모바일 동작 그대로.
      태블릿은 #app.layout-tablet 클래스로만 분리하고, 드로어 공통 규칙을
      layout-mobile / layout-tablet 이 공유하도록 클래스로 끌어올린다.
   ═══════════════════════════════════════════════════════════ */

/* ── 사이드바 접기 + 태블릿 헤더 만큼 본문 내림 ── */
#app.layout-tablet .sidebar { display: none; }
#app.layout-tablet.has-sidebar .main-content {
  margin-left: 0;
  padding-top: 62px;   /* TabletHeader 높이 */
}
/* 태블릿은 TabletHeader 를 쓰므로 모바일 헤더는 숨김 */
#app.layout-tablet .mobile-header { display: none; }

/* ── 드로어 공통화 (모바일·태블릿 공유) ── */
#app.layout-mobile .drawer-overlay,
#app.layout-tablet .drawer-overlay {
  display: block;
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: var(--overlay);
  z-index: 200;
}
#app.layout-mobile .drawer,
#app.layout-tablet .drawer {
  display: flex;
  flex-direction: column;
  position: fixed;
  top: 0; left: 0; bottom: 0;
  background: var(--bg-secondary);
  z-index: 210;
  transform: translateX(-100%);
  transition: transform 0.3s ease;
  padding-top: env(safe-area-inset-top, 0px);
}
#app.layout-mobile .drawer.open,
#app.layout-tablet .drawer.open { transform: translateX(0); }
#app.layout-mobile .drawer { width: 280px; }
#app.layout-tablet .drawer { width: 292px; }
#app.layout-mobile .drawer .sidebar-link,
#app.layout-tablet .drawer .sidebar-link {
  font-size: 1.05em;
  padding: 16px 16px;
  min-height: 48px;
}
#app.layout-mobile .drawer .sidebar-footer,
#app.layout-tablet .drawer .sidebar-footer {
  padding-bottom: calc(16px + env(safe-area-inset-bottom, 0px));
}

/* 하단 탭바는 모바일 전용 유지 (태블릿은 드로어만) */
#app.layout-tablet .bottom-tab-bar { display: none; }

/* ── 구역 관리 장치 그리드 폭 확보 (사이드바 접힘 → 4열) ──
   실측해 3열이면 아래 패딩 축소가 가용폭을 넓혀 4열로 만든다.
   .device-sub-grid 의 minmax 260px 는 절대 바꾸지 않음 (카드 내 토글 2개 최소폭). */
#app.layout-tablet .page-container {
  padding-left: 16px;
  padding-right: 16px;
}
#app.layout-tablet .group-body {
  padding-left: 16px;
  padding-right: 16px;
}

/* ── 구역 헤더 버튼 6개 유지 + 터치 타깃 확대(44px, 48px는 헤더를 밀어냄) ── */
#app.layout-tablet .group-header-actions .btn-icon { width: 44px; height: 44px; }
#app.layout-tablet .group-header-actions .btn-memo { min-height: 44px; }

/* ── 헤더 액션 3개 라벨 유지 (모바일 .btn-label{display:none} 이 새지 않도록) ── */
#app.layout-tablet .header-actions .btn-label { display: inline; }
#app.layout-tablet .header-actions button { min-height: 48px; }
</style>
