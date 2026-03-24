<template>
  <nav v-if="isAuthenticated" class="bottom-tab-bar" aria-label="주요 메뉴">
    <router-link
      v-for="tab in mainTabs"
      :key="tab.path"
      :to="tab.path"
      class="tab-item"
      :class="{ active: isActive(tab.path) }"
      :aria-label="tab.ariaLabel"
    >
      <span class="tab-icon">{{ tab.icon }}</span>
      <span class="tab-label">{{ tab.label }}</span>
    </router-link>

    <button
      class="tab-item"
      :class="{ active: moreMenuOpen }"
      @click="moreMenuOpen = !moreMenuOpen"
      aria-label="더보기 메뉴"
      :aria-expanded="moreMenuOpen"
    >
      <span class="tab-icon">&#x2261;</span>
      <span class="tab-label">더보기</span>
    </button>

    <MoreMenu
      :visible="moreMenuOpen"
      :is-admin="isAdmin"
      @close="moreMenuOpen = false"
      @logout="$emit('logout')"
    />
  </nav>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRoute } from 'vue-router'
import { useAuthStore } from '../../stores/auth.store'
import MoreMenu from './MoreMenu.vue'

defineEmits<{ logout: [] }>()

const route = useRoute()
const authStore = useAuthStore()

const isAuthenticated = computed(() => authStore.isAuthenticated)
const isAdmin = computed(() => authStore.isAdmin)
const moreMenuOpen = ref(false)

interface TabItem {
  path: string
  icon: string
  label: string
  ariaLabel: string
}

const mainTabs: TabItem[] = [
  { path: '/dashboard', icon: '\uD83D\uDCCA', label: '홈', ariaLabel: '대시보드로 이동' },
  { path: '/sensors', icon: '\uD83D\uDCE1', label: '환경', ariaLabel: '환경 모니터링으로 이동' },
  { path: '/automation', icon: '\u2699\uFE0F', label: '자동화', ariaLabel: '자동화 관리로 이동' },
  { path: '/groups', icon: '\uD83D\uDC65', label: '그룹', ariaLabel: '그룹 관리로 이동' },
  { path: '/devices', icon: '\uD83D\uDD0C', label: '장비', ariaLabel: '장비 관리로 이동' },
]

function isActive(path: string) {
  return route.path === path || route.path.startsWith(path + '/')
}
</script>

<style scoped>
.bottom-tab-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: calc(56px + env(safe-area-inset-bottom, 0px));
  padding-bottom: env(safe-area-inset-bottom, 0px);
  background: var(--bg-secondary);
  border-top: 1px solid var(--border-color);
  display: flex;
  z-index: 1000;
  touch-action: manipulation;
}

.tab-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  min-width: 44px;
  gap: 2px;
  text-decoration: none;
  color: var(--text-muted);
  font-size: 13px;
  font-weight: 500;
  border: none;
  background: none;
  cursor: pointer;
  transition: color 0.2s;
  padding: 0;
}

.tab-item:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}

.tab-item.active {
  color: var(--accent);
}

.tab-icon {
  font-size: 20px;
  line-height: 1;
}

.tab-label {
  line-height: 1;
}

/* 데스크탑에서 숨김 */
@media (min-width: 769px) {
  .bottom-tab-bar {
    display: none;
  }
}
</style>
