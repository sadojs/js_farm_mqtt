<template>
  <div class="empty-state-container">
    <div class="empty-state-icon" v-if="icon">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" v-html="icon"></svg>
    </div>
    <h3 class="empty-state-title">{{ title }}</h3>
    <p class="empty-state-description">{{ description }}</p>
    <button
      v-if="actionLabel && actionFn"
      class="empty-state-action btn-primary"
      @click="actionFn"
    >
      {{ actionLabel }}
    </button>
    <slot />
  </div>
</template>

<script setup lang="ts">
defineProps<{
  icon?: string
  title: string
  description: string
  actionLabel?: string
  actionFn?: () => void
}>()
</script>

<style scoped>
.empty-state-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 64px 24px;
  text-align: center;
  gap: 12px;
}

.empty-state-icon {
  width: 72px;
  height: 72px;
  background: var(--accent-bg);
  border-radius: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 8px;
}

.empty-state-icon svg {
  width: 36px;
  height: 36px;
  color: var(--accent);
  stroke-linecap: round;
  stroke-linejoin: round;
}

.empty-state-title {
  font-size: 1.1em;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
}

.empty-state-description {
  font-size: 0.9em;
  color: var(--text-muted);
  max-width: 360px;
  line-height: 1.6;
  margin: 0;
  white-space: pre-line;
}

.empty-state-action {
  margin-top: 8px;
  padding: 10px 24px;
  border-radius: 8px;
  font-size: 0.95em;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s, color 0.2s;
}

/* btn-primary 스타일 (전역 정의 안된 경우 fallback) */
.empty-state-action.btn-primary {
  background: var(--accent);
  color: #fff;
  border: none;
}

.empty-state-action.btn-primary:hover {
  background: var(--accent-hover);
}
</style>
