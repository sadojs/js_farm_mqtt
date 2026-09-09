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
              <button :class="{ active: fontSize === 'md' }" @click="$emit('set-font', 'md')">보통</button>
              <button :class="{ active: fontSize === 'lg' }" @click="$emit('set-font', 'lg')">크게</button>
            </div>
          </div>

          <div class="setting-row">
            <span class="setting-label">화면 모드</span>
            <div class="theme-buttons">
              <button :class="{ active: theme === 'light' }" @click="$emit('set-theme', 'light')">밝게</button>
              <button :class="{ active: theme === 'dark' }" @click="$emit('set-theme', 'dark')">어둡게</button>
            </div>
          </div>

          <!-- 화면 레이아웃 — 모바일에서는 숨김(사이드바가 물리적으로 안 들어가 의미 없음).
               데스크탑/태블릿 크기에서만 노출 -->
          <template v-if="layoutMode !== 'mobile'">
            <div class="setting-row">
              <span class="setting-label">화면 레이아웃</span>
              <div class="layout-buttons">
                <button :class="{ active: layoutPref === 'auto' }" @click="setLayoutPref('auto')">자동</button>
                <button :class="{ active: layoutPref === 'tablet' }" @click="setLayoutPref('tablet')">태블릿</button>
                <button :class="{ active: layoutPref === 'desktop' }" @click="setLayoutPref('desktop')">데스크탑</button>
              </div>
            </div>
            <p class="setting-hint">{{ LAYOUT_HINTS[layoutPref] }}</p>
            <p class="setting-now">지금: {{ layoutModeLabel }} 모드 · {{ viewportWidth }}px</p>
          </template>
        </section>

        <!-- ── 고정 설치 (태블릿 모드 전용) ── -->
        <section v-if="layoutMode === 'tablet'" class="settings-section">
          <h4 class="section-title">고정 설치</h4>
          <p class="section-desc">하우스에 고정해 둔 기기에서 사용합니다.</p>

          <div class="setting-row">
            <div class="setting-text">
              <span class="setting-label">확대/축소 잠금</span>
              <span class="setting-sub">손가락으로 화면 크기가 바뀌지 않게 합니다</span>
            </div>
            <button class="toggle-btn" :class="{ on: noZoom }" @click="setNoZoom(!noZoom)" aria-label="확대 잠금"><span class="toggle-knob" /></button>
          </div>

          <div class="setting-row">
            <div class="setting-text">
              <span class="setting-label">전체화면 고정</span>
              <span class="setting-sub">브라우저 주소창을 숨깁니다 (기기 재시작 후에는 다시 눌러야 합니다)</span>
            </div>
            <button class="toggle-btn" :class="{ on: fullscreen }" @click="setFullscreen(!fullscreen)" aria-label="전체화면"><span class="toggle-knob" /></button>
          </div>

          <div class="setting-row">
            <div class="setting-text">
              <span class="setting-label">야간 자동 감광</span>
              <span class="setting-sub">밤에는 화면을 어둡게 표시합니다 (기기 밝기는 태블릿 설정에서 조절)</span>
            </div>
            <button class="toggle-btn" :class="{ on: dimming }" @click="setDimming(!dimming)" aria-label="야간 감광"><span class="toggle-knob" /></button>
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

          <!-- 부가기능: 농작업 일정 · 방재 일정 · 일꾼 관리 -->
          <div
            v-for="f in featureMeta"
            :key="f.key"
            class="feature-row"
            :class="{ disabled: featureFlags[f.key]?.lockedByAdmin }"
          >
            <div class="feature-info">
              <span class="feature-icon">{{ f.icon }}</span>
              <div>
                <span class="feature-name">{{ f.label }}</span>
                <span v-if="featureFlags[f.key]?.lockedByAdmin" class="feature-locked">
                  플랫폼 관리자에 의해 비활성화됨
                </span>
                <span v-else class="feature-desc">{{ f.desc }}</span>
              </div>
            </div>
            <button
              class="toggle-btn"
              :class="{ on: featureFlags[f.key]?.userEnabled && !featureFlags[f.key]?.lockedByAdmin }"
              :disabled="featureFlags[f.key]?.lockedByAdmin"
              @click="$emit('toggle-feature', f.key)"
              :aria-label="`${f.label} ${featureFlags[f.key]?.userEnabled ? '끄기' : '켜기'}`"
            >
              <span class="toggle-knob" />
            </button>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { FEATURE_META, type FeatureKey, type FeatureState } from '../../composables/useFeatureFlags'
import { useLayoutMode, type LayoutPref } from '../../composables/useLayoutMode'
import { useKioskMode } from '../../composables/useKioskMode'

// 화면 레이아웃(자동/태블릿/데스크탑) — 모바일에선 UI 숨김(템플릿 v-if)
const { pref: layoutPref, setPref: setLayoutPref, mode: layoutMode, viewportWidth } = useLayoutMode()
// 하우스 고정 설치 옵션 — 태블릿 모드에서만 노출
const { noZoom, fullscreen, dimming, setNoZoom, setFullscreen, setDimming } = useKioskMode()

const LAYOUT_HINTS: Record<LayoutPref, string> = {
  auto: '화면 크기에 맞춰 자동으로 정합니다. 769~1366px는 태블릿, 1367px 이상은 데스크탑입니다.',
  tablet: '메뉴를 접어 화면을 넓게 씁니다. 하우스에 설치한 기기에 권장합니다.',
  desktop: '메뉴를 항상 왼쪽에 보여줍니다.',
}
const layoutModeLabel = computed(() =>
  layoutMode.value === 'tablet' ? '태블릿' : layoutMode.value === 'mobile' ? '모바일' : '데스크탑',
)

defineProps<{
  fontSize: string
  theme: string
  isFarmAdmin: boolean
  cropFeature: { enabled: boolean; platformEnabled: boolean; userEnabled: boolean; lockedByAdmin: boolean }
  featureFlags: Record<FeatureKey, FeatureState>
}>()

defineEmits<{
  close: []
  'set-font': [size: 'md' | 'lg']
  'set-theme': [mode: 'light' | 'dark']
  'toggle-crop': []
  'toggle-feature': [key: FeatureKey]
}>()

const featureMeta = FEATURE_META
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
  font-size: calc(17px * var(--content-scale, 1));
  font-weight: 700;
  color: var(--text-primary, #222);
}

.btn-close {
  background: none;
  border: none;
  font-size: calc(18px * var(--content-scale, 1));
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
  font-size: calc(12px * var(--content-scale, 1));
  font-weight: 600;
  color: var(--text-secondary, #888);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 14px;
}

.section-desc {
  font-size: calc(12px * var(--content-scale, 1));
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
  font-size: calc(14px * var(--content-scale, 1));
  color: var(--text-primary, #333);
}

/* ── 폰트/테마/레이아웃 버튼 ── */
.font-size-buttons,
.theme-buttons,
.layout-buttons {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.font-size-buttons button,
.theme-buttons button,
.layout-buttons button {
  padding: 6px 12px;
  border: 1px solid var(--border-color, #ddd);
  border-radius: 8px;
  background: none;
  font-size: calc(13px * var(--content-scale, 1));
  cursor: pointer;
  color: var(--text-secondary, #666);
  transition: all 0.15s;
}

.font-size-buttons button.active,
.theme-buttons button.active,
.layout-buttons button.active {
  background: var(--accent, #2e7d32);
  color: #fff;
  border-color: var(--accent, #2e7d32);
}

/* ── 화면 레이아웃 안내 문구 ── */
.setting-hint {
  font-size: calc(12px * var(--content-scale, 1));
  color: var(--text-secondary);
  line-height: 1.5;
  margin-top: 8px;
}
.setting-now {
  font-size: calc(12px * var(--content-scale, 1));
  color: var(--text-muted);
  margin-top: 5px;
  font-variant-numeric: tabular-nums;
}

/* ── 고정 설치(키오스크) 행: 라벨 + 보조설명 ── */
.setting-text { min-width: 0; padding-right: 12px; }
.setting-sub {
  display: block;
  font-size: calc(11px * var(--content-scale, 1));
  color: var(--text-muted);
  margin-top: 2px;
  max-width: 34ch;
  line-height: 1.4;
}

.font-size-buttons button:nth-child(1) { font-size: calc(11px * var(--content-scale, 1)); }
.font-size-buttons button:nth-child(2) { font-size: calc(13px * var(--content-scale, 1)); }
.font-size-buttons button:nth-child(3) { font-size: calc(15px * var(--content-scale, 1)); }

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
  font-size: calc(20px * var(--content-scale, 1));
  line-height: 1.2;
  flex-shrink: 0;
}

.feature-name {
  display: block;
  font-size: calc(14px * var(--content-scale, 1));
  font-weight: 600;
  color: var(--text-primary, #222);
  margin-bottom: 2px;
}

.feature-desc {
  display: block;
  font-size: calc(11px * var(--content-scale, 1));
  color: var(--text-secondary, #aaa);
}

.feature-locked {
  display: block;
  font-size: calc(11px * var(--content-scale, 1));
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
