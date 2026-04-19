<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal-panel">
      <div class="modal-header">
        <h3>환경 설정</h3>
        <button class="btn-close" @click="$emit('close')" aria-label="닫기">✕</button>
      </div>

      <div class="modal-body">
        <!-- ── 화면 설정 ── -->
        <section class="settings-section">
          <h4 class="section-title">화면 설정</h4>

          <div class="setting-row">
            <span class="setting-label">글자 크기</span>
            <div class="font-size-buttons">
              <button :class="{ active: fontSize === 'sm' }" @click="$emit('set-font', 'sm')">가</button>
              <button :class="{ active: fontSize === 'md' }" @click="$emit('set-font', 'md')">가</button>
              <button :class="{ active: fontSize === 'lg' }" @click="$emit('set-font', 'lg')">가</button>
            </div>
          </div>

          <div class="setting-row">
            <span class="setting-label">화면 모드</span>
            <div class="theme-buttons">
              <button :class="{ active: theme === 'light' }" @click="$emit('set-theme', 'light')">밝게</button>
              <button :class="{ active: theme === 'dark' }" @click="$emit('set-theme', 'dark')">어둡게</button>
            </div>
          </div>
        </section>

        <!-- ── 기능 설정 (farm_admin만) ── -->
        <section v-if="isFarmAdmin" class="settings-section">
          <h4 class="section-title">기능 설정</h4>
          <p class="section-desc">사용할 기능을 켜거나 끌 수 있습니다.</p>

          <!-- 생육관리 -->
          <div class="feature-row" :class="{ disabled: cropFeature.lockedByAdmin }">
            <div class="feature-info">
              <span class="feature-icon">🌱</span>
              <div>
                <span class="feature-name">생육관리</span>
                <span v-if="cropFeature.lockedByAdmin" class="feature-locked">
                  플랫폼 관리자에 의해 비활성화됨
                </span>
                <span v-else class="feature-desc">적산온도 기반 생육 단계 추적 및 수확 예측</span>
              </div>
            </div>
            <button
              class="toggle-btn"
              :class="{ on: cropFeature.userEnabled && !cropFeature.lockedByAdmin }"
              :disabled="cropFeature.lockedByAdmin"
              @click="$emit('toggle-crop')"
              :aria-label="cropFeature.userEnabled ? '생육관리 끄기' : '생육관리 켜기'"
            >
              <span class="toggle-knob" />
            </button>
          </div>

          <!-- 추후 기능 추가 시 여기에 삽입 -->
        </section>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  fontSize: string
  theme: string
  isFarmAdmin: boolean
  cropFeature: { enabled: boolean; platformEnabled: boolean; userEnabled: boolean; lockedByAdmin: boolean }
}>()

defineEmits<{
  close: []
  'set-font': [size: 'sm' | 'md' | 'lg']
  'set-theme': [mode: 'light' | 'dark']
  'toggle-crop': []
}>()
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  z-index: 1000;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 0;
}

@media (min-width: 600px) {
  .modal-overlay {
    align-items: center;
  }
}

.modal-panel {
  background: var(--bg-secondary, #fff);
  border-radius: 20px 20px 0 0;
  width: 100%;
  max-width: 480px;
  max-height: 85vh;
  overflow-y: auto;
  box-shadow: 0 -4px 32px rgba(0, 0, 0, 0.18);
}

@media (min-width: 600px) {
  .modal-panel {
    border-radius: 16px;
    max-height: 80vh;
  }
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 20px 0;
  margin-bottom: 4px;
}

.modal-header h3 {
  font-size: 17px;
  font-weight: 700;
  color: var(--text-primary, #222);
}

.btn-close {
  background: none;
  border: none;
  font-size: 18px;
  color: var(--text-secondary, #888);
  cursor: pointer;
  padding: 4px 8px;
  line-height: 1;
}

.modal-body {
  padding: 8px 20px 32px;
}

/* ── 섹션 ── */
.settings-section {
  margin-top: 20px;
}

.settings-section + .settings-section {
  border-top: 1px solid var(--border-color, #eee);
  padding-top: 20px;
}

.section-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary, #888);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 14px;
}

.section-desc {
  font-size: 12px;
  color: var(--text-secondary, #aaa);
  margin-bottom: 12px;
  margin-top: -8px;
}

/* ── 설정 행 ── */
.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 0;
  border-bottom: 1px solid var(--border-color, #f0f0f0);
}

.setting-row:last-child {
  border-bottom: none;
}

.setting-label {
  font-size: 14px;
  color: var(--text-primary, #333);
}

/* ── 폰트/테마 버튼 ── */
.font-size-buttons,
.theme-buttons {
  display: flex;
  gap: 4px;
}

.font-size-buttons button,
.theme-buttons button {
  padding: 6px 12px;
  border: 1px solid var(--border-color, #ddd);
  border-radius: 8px;
  background: none;
  font-size: 13px;
  cursor: pointer;
  color: var(--text-secondary, #666);
  transition: all 0.15s;
}

.font-size-buttons button.active,
.theme-buttons button.active {
  background: var(--accent, #2e7d32);
  color: #fff;
  border-color: var(--accent, #2e7d32);
}

.font-size-buttons button:nth-child(1) { font-size: 11px; }
.font-size-buttons button:nth-child(2) { font-size: 13px; }
.font-size-buttons button:nth-child(3) { font-size: 15px; }

/* ── 기능 행 ── */
.feature-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 0;
  border-bottom: 1px solid var(--border-color, #f0f0f0);
  gap: 12px;
}

.feature-row:last-child {
  border-bottom: none;
}

.feature-row.disabled {
  opacity: 0.55;
}

.feature-info {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  flex: 1;
  min-width: 0;
}

.feature-icon {
  font-size: 20px;
  line-height: 1.2;
  flex-shrink: 0;
}

.feature-name {
  display: block;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary, #222);
  margin-bottom: 2px;
}

.feature-desc {
  display: block;
  font-size: 11px;
  color: var(--text-secondary, #aaa);
}

.feature-locked {
  display: block;
  font-size: 11px;
  color: var(--danger, #e53935);
}

/* ── 토글 버튼 ── */
.toggle-btn {
  position: relative;
  width: 48px;
  height: 28px;
  border-radius: 14px;
  background: var(--border-color, #ccc);
  border: none;
  cursor: pointer;
  transition: background 0.2s;
  flex-shrink: 0;
  padding: 0;
}

.toggle-btn.on {
  background: var(--accent, #2e7d32);
}

.toggle-btn:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.toggle-knob {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
  transition: transform 0.2s;
  display: block;
}

.toggle-btn.on .toggle-knob {
  transform: translateX(20px);
}

/* 다크모드 */
#app.theme-dark .modal-panel {
  background: var(--bg-secondary);
}
</style>
