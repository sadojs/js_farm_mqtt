<template>
  <div class="notification-center" ref="containerRef">
    <!-- 벨 아이콘 버튼 -->
    <button
      class="bell-btn"
      :class="{ active: isOpen }"
      @click="togglePanel"
      aria-label="알림 센터"
      title="알림 센터"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
        <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
      </svg>
      <span v-if="notificationStore.unreadCount > 0" class="badge">
        {{ notificationStore.unreadCount > 99 ? '99+' : notificationStore.unreadCount }}
      </span>
    </button>

    <!-- 드롭다운 패널 -->
    <Transition name="panel-fade">
      <div v-if="isOpen" :class="['notification-panel', `placement-${placement}`]" role="dialog" aria-label="알림 목록">
        <div class="panel-header">
          <span class="panel-title">알림</span>
          <button
            v-if="notificationStore.centerItems.length > 0"
            class="btn-mark-all"
            @click="notificationStore.markAllRead()"
          >
            모두 읽음
          </button>
        </div>

        <!-- 빈 상태 -->
        <div v-if="notificationStore.centerItems.length === 0" class="panel-empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
          </svg>
          <p>새 알림이 없습니다</p>
        </div>

        <!-- 알림 목록 -->
        <div v-else class="panel-list">
          <div
            v-for="item in notificationStore.centerItems"
            :key="item.id"
            class="panel-item"
            :class="[`type-${item.type}`, { unread: !item.read }]"
            @click="item.read = true"
          >
            <div class="item-dot" :class="item.type"></div>
            <div class="item-content">
              <div class="item-title">{{ item.title }}</div>
              <div v-if="item.message" class="item-message">{{ item.message }}</div>
              <div class="item-time">{{ formatTime(item.createdAt) }}</div>
            </div>
            <button
              class="item-dismiss"
              @click.stop="notificationStore.removeCenterItem(item.id)"
              aria-label="알림 제거"
              title="제거"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        </div>

        <!-- 전체 삭제 -->
        <div v-if="notificationStore.centerItems.length > 0" class="panel-footer">
          <button class="btn-clear-all" @click="notificationStore.clearCenter()">
            전체 삭제
          </button>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useNotificationStore } from '../../stores/notification.store'

const { placement } = withDefaults(defineProps<{ placement?: 'bottom' | 'right' }>(), { placement: 'bottom' })
const notificationStore = useNotificationStore()
const isOpen = ref(false)
const containerRef = ref<HTMLElement | null>(null)

function togglePanel() {
  isOpen.value = !isOpen.value
}

function handleClickOutside(e: MouseEvent) {
  if (containerRef.value && !containerRef.value.contains(e.target as Node)) {
    isOpen.value = false
  }
}

function formatTime(date: Date): string {
  const now = new Date()
  const diff = now.getTime() - new Date(date).getTime()
  if (diff < 60000) return '방금 전'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}분 전`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}시간 전`
  return new Date(date).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside, true)
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside, true)
})
</script>

<style scoped>
.notification-center {
  position: relative;
  display: flex;
  align-items: center;
}

.bell-btn {
  position: relative;
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  border-radius: 10px;
  cursor: pointer;
  color: var(--text-secondary);
  transition: background 0.2s, color 0.2s;
}

.bell-btn:hover,
.bell-btn.active {
  background: var(--bg-hover);
  color: var(--accent);
}

.bell-btn svg {
  width: 22px;
  height: 22px;
}

.badge {
  position: absolute;
  top: 6px;
  right: 6px;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  background: var(--danger);
  color: white;
  border-radius: 9px;
  font-size: 11px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  pointer-events: none;
}

.notification-panel {
  position: absolute;
  width: 340px;
  max-height: 480px;
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: 14px;
  box-shadow: var(--shadow-modal);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  z-index: 1000;
}

/* 아래로 열기 (모바일 헤더 기본값) */
.notification-panel.placement-bottom {
  top: calc(100% + 8px);
  right: 0;
}

/* 오른쪽으로 열기 (세로 사이드바) */
.notification-panel.placement-right {
  left: calc(100% + 12px);
  top: 50%;
  transform: translateY(-50%);
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 16px 12px;
  border-bottom: 1px solid var(--border-light);
  flex-shrink: 0;
}

.panel-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-primary);
}

.btn-mark-all {
  font-size: 13px;
  color: var(--accent);
  background: none;
  border: none;
  cursor: pointer;
  font-weight: 500;
  padding: 4px 8px;
  border-radius: 6px;
  transition: background 0.2s;
}

.btn-mark-all:hover {
  background: var(--accent-bg);
}

.panel-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 48px 20px;
  color: var(--text-muted);
}

.panel-empty svg {
  width: 40px;
  height: 40px;
  opacity: 0.4;
}

.panel-empty p {
  font-size: 14px;
}

.panel-list {
  flex: 1;
  overflow-y: auto;
}

.panel-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 16px;
  cursor: pointer;
  transition: background 0.15s;
  border-bottom: 1px solid var(--border-light);
  position: relative;
}

.panel-item:last-child {
  border-bottom: none;
}

.panel-item:hover {
  background: var(--bg-hover);
}

.panel-item.unread {
  background: var(--bg-active);
}

.panel-item.unread:hover {
  background: var(--accent-bg);
}

.item-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-top: 5px;
  flex-shrink: 0;
}

.item-dot.success { background: var(--accent); }
.item-dot.error { background: var(--danger); }
.item-dot.warning { background: var(--warning); }
.item-dot.info { background: #2196f3; }

.item-content {
  flex: 1;
  min-width: 0;
}

.item-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  line-height: 1.4;
  margin-bottom: 2px;
}

.item-message {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.4;
  margin-bottom: 4px;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.item-time {
  font-size: 11px;
  color: var(--text-muted);
}

.item-dismiss {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  color: var(--text-muted);
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.2s, background 0.2s;
}

.panel-item:hover .item-dismiss {
  opacity: 1;
}

.item-dismiss:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.item-dismiss svg {
  width: 12px;
  height: 12px;
}

.panel-footer {
  padding: 10px 16px;
  border-top: 1px solid var(--border-light);
  display: flex;
  justify-content: center;
  flex-shrink: 0;
}

.btn-clear-all {
  font-size: 13px;
  color: var(--danger);
  background: none;
  border: none;
  cursor: pointer;
  font-weight: 500;
  padding: 6px 16px;
  border-radius: 6px;
  transition: background 0.2s;
}

.btn-clear-all:hover {
  background: var(--danger-bg);
}

/* 트랜지션 */
.panel-fade-enter-active,
.panel-fade-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.placement-bottom.panel-fade-enter-from,
.placement-bottom.panel-fade-leave-to {
  opacity: 0;
  transform: translateY(-8px) scale(0.97);
}

.placement-right.panel-fade-enter-from,
.placement-right.panel-fade-leave-to {
  opacity: 0;
  transform: translateX(-8px) translateY(-50%) scale(0.97);
}

/* 모바일 반응형 */
@media (max-width: 480px) {
  .notification-panel {
    width: calc(100vw - 32px);
    right: -16px;
  }
}
</style>
