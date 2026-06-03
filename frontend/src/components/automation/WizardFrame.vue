<script setup lang="ts">
/**
 * WizardFrame — 자동제어 위저드 (추가/수정) 공통 프레임
 *
 * 적용: IntentWizardModal(추가) / RuleWizardModal(수정) 공유
 * 디자인 토큰: style.css의 --device-*, --primary, --bg-card, --border-*, --text-* 만 사용
 * 데스크탑: 560px 모달, 화면 중앙, radius 18, 딤 rgba(15,23,42,0.55)
 * 모바일 (≤600px): 풀폭 바텀 시트, 상단 그래버, 상단 모서리 radius 22
 *
 * Slot:
 *   - default: step 본문
 * Props/Emits:
 *   - title: 모달 제목 ('자동 제어 추가' / '자동 제어 수정')
 *   - editMode: 수정 모드 배지 표시 여부
 *   - stepIndex: 현재 step (0-based)
 *   - totalSteps: 전체 step 수
 *   - showPrev / showNext: 이전/다음 버튼 표시 여부
 *   - canProceed: 다음 버튼 활성화
 *   - canProceedHint: 비활성 시 tooltip
 *   - nextLabel: 다음 버튼 텍스트
 *   - saving: 저장 중 표시
 *   - close: 닫기 emit
 *   - prev / next: 이전/다음 emit
 */
import { onMounted, onBeforeUnmount } from 'vue'

interface Props {
  title: string
  editMode?: boolean
  stepIndex: number
  totalSteps: number
  showPrev?: boolean
  showNext?: boolean
  canProceed?: boolean
  canProceedHint?: string
  nextLabel?: string
  saving?: boolean
  closeOnOverlay?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  editMode: false,
  showPrev: false,
  showNext: false,
  canProceed: true,
  canProceedHint: '',
  nextLabel: '다음',
  saving: false,
  closeOnOverlay: true,
})

const emit = defineEmits<{
  close: []
  prev: []
  next: []
}>()

function handleOverlayClick() {
  if (props.closeOnOverlay) emit('close')
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}

onMounted(() => {
  document.body.style.overflow = 'hidden'
  document.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  document.body.style.overflow = ''
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <Teleport to="#app">
    <div class="wf-overlay" role="dialog" aria-modal="true" :aria-label="title" @click.self="handleOverlayClick">
      <div class="wf-container" @click.stop>
        <!-- 모바일 그래버 -->
        <div class="wf-grabber" aria-hidden="true"></div>

        <!-- 헤더: 제목 + (수정모드)배지 + ✕ -->
        <div class="wf-header">
          <div class="wf-title-row">
            <h2 class="wf-title">{{ title }}</h2>
            <span v-if="editMode" class="wf-edit-badge" title="기존 룰을 수정합니다">수정 모드</span>
          </div>
          <button class="wf-close" aria-label="닫기" @click="emit('close')">✕</button>
        </div>

        <!-- 진행바: 단계 수만큼 균등 분할 막대 (현재까지=primary, 이후=border-color) -->
        <div class="wf-progress" role="progressbar" :aria-valuenow="stepIndex + 1" :aria-valuemax="totalSteps"
          :aria-label="`진행률 ${stepIndex + 1}/${totalSteps}`">
          <span v-for="i in totalSteps" :key="i" class="wf-progress-segment"
            :class="{ active: i - 1 <= stepIndex }" aria-hidden="true"></span>
        </div>

        <!-- 본문 (스크롤) -->
        <div class="wf-body">
          <slot />
        </div>

        <!-- 푸터: 이전/다음 -->
        <div class="wf-footer">
          <button v-if="showPrev" class="wf-btn-prev" type="button" @click="emit('prev')">← 이전</button>
          <div class="wf-spacer"></div>
          <button v-if="showNext" class="wf-btn-next" type="button"
            :disabled="!canProceed || saving"
            :title="!canProceed ? canProceedHint : ''"
            @click="emit('next')">
            <span v-if="saving">저장 중...</span>
            <span v-else>{{ nextLabel }}</span>
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.wf-overlay {
  position: fixed; inset: 0;
  background: rgba(15, 23, 42, 0.55);
  backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
  z-index: 1100;
  display: flex; align-items: center; justify-content: center;
}

.wf-container {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 18px;
  width: 100%; max-width: 560px;
  max-height: 90vh;
  display: flex; flex-direction: column;
  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.4);
  overflow: hidden;
}

/* 모바일 그래버 - 데스크탑에서는 숨김 */
.wf-grabber { display: none; }

/* 헤더 */
.wf-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 18px 22px 8px;
  flex-shrink: 0;
}
.wf-title-row { display: flex; align-items: center; gap: 10px; min-width: 0; }
.wf-title {
  font-size: calc(16px * var(--content-scale, 1));
  font-weight: 800;
  color: var(--text-primary);
  letter-spacing: -0.02em;
  margin: 0;
}
.wf-edit-badge {
  display: inline-flex; align-items: center;
  padding: 2px 9px;
  border-radius: 999px;
  background: rgba(245, 158, 11, 0.14);
  color: #b45309;
  font-size: calc(11px * var(--content-scale, 1));
  font-weight: 700;
  letter-spacing: 0.02em;
  white-space: nowrap;
}
.wf-close {
  background: none; border: none;
  width: 32px; height: 32px;
  display: flex; align-items: center; justify-content: center;
  font-size: 18px; color: var(--text-muted); cursor: pointer;
  border-radius: 8px;
  transition: background 0.12s, color 0.12s;
  flex-shrink: 0;
}
.wf-close:hover { background: var(--bg-hover); color: var(--text-primary); }

/* 진행바 */
.wf-progress {
  display: flex; gap: 4px;
  padding: 4px 22px 14px;
  flex-shrink: 0;
}
.wf-progress-segment {
  flex: 1;
  height: 4px;
  border-radius: 999px;
  background: var(--border-color, #e4e7eb);
  transition: background 0.25s;
}
.wf-progress-segment.active { background: var(--primary, var(--color-primary, #4caf50)); }

/* 본문 */
.wf-body {
  flex: 1;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  background: #fafbfc;
  padding: 22px 24px;
}

/* 푸터 */
.wf-footer {
  display: flex; align-items: center;
  padding: 14px 22px;
  background: var(--bg-card);
  border-top: 1px solid var(--border-color);
  flex-shrink: 0;
}
.wf-spacer { flex: 1; }

.wf-btn-prev {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  color: var(--text-primary);
  cursor: pointer;
  padding: 10px 18px;
  font-size: calc(14px * var(--content-scale, 1));
  font-weight: 500;
  min-height: 42px;
  transition: border-color 0.15s, background 0.15s;
}
.wf-btn-prev:hover {
  border-color: var(--text-muted);
  background: var(--bg-hover);
}

.wf-btn-next {
  background: var(--primary, var(--color-primary, #4caf50));
  border: none;
  border-radius: 10px;
  color: #fff;
  cursor: pointer;
  padding: 10px 24px;
  font-size: calc(14px * var(--content-scale, 1));
  font-weight: 700;
  min-height: 42px;
  transition: opacity 0.15s, transform 0.05s;
}
.wf-btn-next:not(:disabled):hover { opacity: 0.92; }
.wf-btn-next:not(:disabled):active { transform: translateY(1px); }
.wf-btn-next:disabled { opacity: 0.45; cursor: not-allowed; }

/* 다크모드 본문 배경 미세 조정 */
@media (prefers-color-scheme: dark) {
  .wf-body { background: var(--bg-secondary, #1f242b); }
}

/* 모바일 — 풀폭 바텀 시트 */
@media (max-width: 600px) {
  .wf-overlay {
    align-items: flex-end;
    background: rgba(15, 23, 42, 0.55);
  }
  .wf-container {
    max-width: 100%; width: 100%;
    max-height: 92vh;
    border-radius: 22px 22px 0 0;
    padding-bottom: env(safe-area-inset-bottom);
  }
  .wf-grabber {
    display: block;
    width: 40px; height: 4px;
    background: var(--border-color, #cbd5e1);
    border-radius: 999px;
    margin: 8px auto 4px;
    flex-shrink: 0;
  }
  .wf-header { padding: 8px 18px 6px; }
  .wf-title { font-size: calc(15px * var(--content-scale, 1)); }
  .wf-progress { padding: 4px 18px 12px; }
  .wf-body { padding: 18px 18px 22px; }
  .wf-footer { padding: 12px 18px; }
  .wf-btn-prev, .wf-btn-next { min-height: 44px; }
}
</style>
