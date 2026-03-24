<template>
  <div v-if="state.visible" class="confirm-overlay" @click="handleCancel">
    <div
      class="confirm-dialog"
      :class="state.options.variant || 'warning'"
      role="alertdialog"
      aria-modal="true"
      :aria-label="state.options.title"
      @click.stop
    >
      <div class="confirm-icon">
        <span v-if="state.options.variant === 'danger'">&#x26A0;&#xFE0F;</span>
        <span v-else-if="state.options.variant === 'info'">&#x2139;&#xFE0F;</span>
        <span v-else>&#x26A0;&#xFE0F;</span>
      </div>
      <h3 class="confirm-title">{{ state.options.title }}</h3>
      <p class="confirm-message">{{ state.options.message }}</p>
      <div class="confirm-actions">
        <button
          class="confirm-btn cancel"
          @click="handleCancel"
          aria-label="취소"
        >
          {{ state.options.cancelText || '취소' }}
        </button>
        <button
          class="confirm-btn ok"
          :class="state.options.variant || 'warning'"
          @click="handleConfirm"
        >
          {{ state.options.confirmText || '확인' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useConfirm } from '../../composables/useConfirm'

const { state, handleConfirm, handleCancel } = useConfirm()
</script>

<style scoped>
.confirm-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
  padding: 20px;
  overscroll-behavior: contain;
}

.confirm-dialog {
  background: var(--bg-card);
  border-radius: 16px;
  padding: 28px 24px 24px;
  max-width: 400px;
  width: 100%;
  box-shadow: var(--shadow-modal);
  border: 1px solid var(--border-color);
  text-align: center;
}

.confirm-icon {
  font-size: 40px;
  margin-bottom: 12px;
}

.confirm-title {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 8px;
}

.confirm-message {
  font-size: 15px;
  color: var(--text-secondary);
  line-height: 1.5;
  margin-bottom: 24px;
}

.confirm-actions {
  display: flex;
  gap: 12px;
}

.confirm-btn {
  flex: 1;
  padding: 12px;
  min-height: 44px;
  border-radius: 8px;
  font-weight: 600;
  font-size: 15px;
  cursor: pointer;
  border: none;
  transition: background 0.2s, transform 0.1s;
}

.confirm-btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.confirm-btn:active {
  transform: scale(0.98);
}

.confirm-btn.cancel {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.confirm-btn.cancel:hover {
  background: var(--border-color);
}

.confirm-btn.ok.danger {
  background: var(--danger);
  color: white;
}

.confirm-btn.ok.danger:hover {
  background: var(--danger-hover);
}

.confirm-btn.ok.warning {
  background: var(--warning);
  color: white;
}

.confirm-btn.ok.warning:hover {
  background: var(--warning-hover);
}

.confirm-btn.ok.info {
  background: var(--accent);
  color: white;
}

.confirm-btn.ok.info:hover {
  background: var(--accent-hover);
}
</style>
