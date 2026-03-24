<template>
  <Teleport to="body">
    <TransitionGroup name="toast" tag="div" class="toast-container">
      <div
        v-for="n in notifications"
        :key="n.id"
        :class="['toast', `toast-${n.type}`]"
        role="alert"
      >
        <span class="toast-icon">{{ iconMap[n.type] }}</span>
        <div class="toast-body">
          <strong class="toast-title">{{ n.title }}</strong>
          <p v-if="n.message" class="toast-message">{{ n.message }}</p>
        </div>
        <button class="toast-close" @click="remove(n.id)" aria-label="닫기">&times;</button>
      </div>
    </TransitionGroup>
  </Teleport>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useNotificationStore } from '../../stores/notification.store'

const store = useNotificationStore()
const { notifications } = storeToRefs(store)
const { remove } = store

const iconMap: Record<string, string> = {
  success: '\u2713',
  error: '\u2715',
  warning: '!',
  info: 'i',
}
</script>

<style scoped>
.toast-container {
  position: fixed;
  bottom: calc(16px + env(safe-area-inset-bottom, 0px));
  right: 16px;
  z-index: 9999;
  display: flex;
  flex-direction: column-reverse;
  gap: 8px;
  max-width: 400px;
}

.toast {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 14px;
  background: var(--bg-card, #fff);
  border: 1px solid var(--border-light, #e8e8e8);
  border-radius: 10px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  min-width: 280px;
}

.toast-success { border-left: 4px solid #4caf50; }
.toast-error   { border-left: 4px solid #e53935; }
.toast-warning { border-left: 4px solid #ff9800; }
.toast-info    { border-left: 4px solid #2196f3; }

.toast-icon {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 700;
  flex-shrink: 0;
  color: #fff;
}

.toast-success .toast-icon { background: #4caf50; }
.toast-error   .toast-icon { background: #e53935; }
.toast-warning .toast-icon { background: #ff9800; }
.toast-info    .toast-icon { background: #2196f3; }

.toast-body {
  flex: 1;
  min-width: 0;
}

.toast-title {
  display: block;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary, #333);
  line-height: 1.4;
}

.toast-message {
  margin-top: 2px;
  font-size: 13px;
  color: var(--text-secondary, #555);
  line-height: 1.4;
}

.toast-close {
  background: none;
  border: none;
  font-size: 18px;
  color: var(--text-muted, #999);
  cursor: pointer;
  padding: 0 2px;
  line-height: 1;
  flex-shrink: 0;
}

.toast-close:hover {
  color: var(--text-primary, #333);
}

/* Transition */
.toast-enter-active {
  transition: all 0.3s ease;
}
.toast-leave-active {
  transition: all 0.25s ease;
}
.toast-enter-from {
  opacity: 0;
  transform: translateY(20px);
}
.toast-leave-to {
  opacity: 0;
  transform: translateX(100%);
}

@media (max-width: 768px) {
  .toast-container {
    left: 16px;
    right: 16px;
    max-width: none;
  }
}
</style>
