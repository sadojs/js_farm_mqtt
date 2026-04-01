<template>
  <Transition name="slide">
    <div v-if="!connected" class="connection-bar" :class="{ reconnecting }">
      <span v-if="reconnecting" class="status-text">
        서버 재연결 중... ({{ reconnectAttempts }}회 시도)
      </span>
      <span v-else class="status-text">
        서버 연결 끊김
      </span>
      <button v-if="!reconnecting" class="retry-btn" @click="retryConnect">재연결</button>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { useWebSocket } from '../../composables/useWebSocket'

const { connected, reconnecting, reconnectAttempts, connect: retryConnect } = useWebSocket()
</script>

<style scoped>
.connection-bar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 8px 16px;
  background: var(--danger, #ef4444);
  color: white;
  font-size: 13px;
  font-weight: 500;
}

.connection-bar.reconnecting {
  background: #f59e0b;
}

.status-text {
  display: flex;
  align-items: center;
  gap: 6px;
}

.retry-btn {
  padding: 4px 12px;
  background: rgba(255, 255, 255, 0.2);
  color: white;
  border: 1px solid rgba(255, 255, 255, 0.4);
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.retry-btn:hover {
  background: rgba(255, 255, 255, 0.3);
}

.slide-enter-active,
.slide-leave-active {
  transition: transform 0.3s ease, opacity 0.3s ease;
}
.slide-enter-from,
.slide-leave-to {
  transform: translateY(-100%);
  opacity: 0;
}
</style>
