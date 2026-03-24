<template>
  <Teleport to="body">
    <div v-if="visible" class="more-menu-overlay" @click="$emit('close')">
      <div class="more-menu" @click.stop role="menu" aria-label="추가 메뉴">
        <router-link to="/reports" class="more-item" role="menuitem" @click="$emit('close')">
          <span class="more-icon">📈</span>
          <span>리포트</span>
        </router-link>
        <router-link v-if="isAdmin" to="/users" class="more-item" role="menuitem" @click="$emit('close')">
          <span class="more-icon">👤</span>
          <span>사용자 관리</span>
        </router-link>
        <button class="more-item logout" role="menuitem" @click="handleLogout">
          <span class="more-icon">🚪</span>
          <span>로그아웃</span>
        </button>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
defineProps<{
  visible: boolean
  isAdmin: boolean
}>()

const emit = defineEmits<{
  close: []
  logout: []
}>()

function handleLogout() {
  emit('close')
  emit('logout')
}
</script>

<style scoped>
.more-menu-overlay {
  position: fixed;
  inset: 0;
  z-index: 999;
}

.more-menu {
  position: fixed;
  bottom: calc(56px + env(safe-area-inset-bottom, 0px));
  right: 8px;
  background: var(--bg-card);
  border-radius: 12px;
  box-shadow: var(--shadow-card);
  overflow: hidden;
  min-width: 180px;
  z-index: 1001;
  overscroll-behavior: contain;
}

.more-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 20px;
  text-decoration: none;
  color: var(--text-primary);
  font-size: 15px;
  font-weight: 500;
  border: none;
  background: none;
  width: 100%;
  cursor: pointer;
  min-height: 44px;
  transition: background 0.2s;
}

.more-item:hover {
  background: var(--bg-hover);
}

.more-item:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}

.more-item.logout {
  border-top: 1px solid var(--border-light);
  color: var(--danger);
}

.more-icon {
  font-size: 18px;
}

@media (min-width: 769px) {
  .more-menu-overlay {
    display: none;
  }
}
</style>
