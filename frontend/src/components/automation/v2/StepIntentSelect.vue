<template>
  <div class="step-intent">
    <div class="step-head">
      <h3 class="step-title">무엇을 자동화할까요?</h3>
      <p class="step-desc">제어하고 싶은 장치 종류를 선택하세요</p>
    </div>

    <div class="intent-list" role="radiogroup" aria-label="의도 선택">
      <button
        v-for="intent in INTENTS"
        :key="intent.id"
        type="button"
        class="intent-card"
        :class="{ selected: selected === intent.id }"
        :aria-pressed="selected === intent.id"
        role="radio"
        :aria-checked="selected === intent.id"
        @click="handleSelect(intent.id)"
      >
        <!-- 좌측: 장비색 아이콘 칩 -->
        <EquipmentIcon
          :type="intentToEquipmentKind(intent.id)"
          :active="selected === intent.id"
          :size="22"
          :title="intent.title"
        />
        <!-- 본문: 제목 + 설명 -->
        <div class="intent-text">
          <span class="intent-title">{{ intent.title }}</span>
          <span class="intent-subtitle">{{ intent.subtitle }}</span>
        </div>
        <!-- 우측: 라디오 원 (선택 시 채워진 체크) -->
        <span class="radio-mark" :class="{ checked: selected === intent.id }" aria-hidden="true">
          <svg v-if="selected === intent.id" viewBox="0 0 24 24" width="14" height="14" fill="none"
            stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { INTENTS, type WizardIntent } from './types'
import EquipmentIcon, { type EquipmentKind } from '@/components/common/EquipmentIcon.vue'

const props = defineProps<{ modelValue: WizardIntent | null }>()
const emit = defineEmits<{
  'update:modelValue': [v: WizardIntent]
  proceed: []
  'switch-to-legacy': []
}>()

const selected = ref<WizardIntent | null>(props.modelValue)

function handleSelect(id: WizardIntent) {
  selected.value = id
  emit('update:modelValue', id)

  if (id === 'advanced') {
    setTimeout(() => emit('switch-to-legacy'), 200)
    return
  }
  setTimeout(() => emit('proceed'), 200)
}

// WizardIntent → EquipmentIcon 타입 매핑 (UI 일관성)
function intentToEquipmentKind(id: WizardIntent): EquipmentKind {
  if (id === 'irrigation') return 'irrigation'
  if (id === 'opener') return 'opener'
  if (id === 'fan') return 'fan'
  return 'other'  // advanced
}
</script>

<style scoped>
.step-intent { display: flex; flex-direction: column; gap: 16px; }

.step-head { display: flex; flex-direction: column; gap: 4px; }
.step-title {
  font-size: calc(18px * var(--content-scale, 1));
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
  letter-spacing: -0.02em;
}
.step-desc {
  font-size: calc(13px * var(--content-scale, 1));
  color: var(--text-muted);
  margin: 0;
}

.intent-list { display: flex; flex-direction: column; gap: 10px; }

/* W2 가이드 카드 톤 — 큰 선택 카드 */
.intent-card {
  display: flex; align-items: center; gap: 14px;
  min-height: 72px; padding: 14px 16px;
  border: 1.5px solid var(--border-color);
  border-radius: 13px;
  background: var(--bg-card);
  cursor: pointer; text-align: left; width: 100%;
  transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
}
.intent-card:hover {
  border-color: var(--primary, var(--color-primary, #4caf50));
  background: var(--bg-hover);
}
.intent-card:active { transform: scale(0.99); }
.intent-card.selected {
  border-color: var(--primary, var(--color-primary, #4caf50));
  background: color-mix(in srgb, var(--primary, #4caf50) 8%, var(--bg-card));
}
.intent-card:focus-visible { outline: 2px solid var(--primary, #4caf50); outline-offset: 2px; }

.intent-text { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
.intent-title {
  font-size: calc(15px * var(--content-scale, 1));
  font-weight: 700;
  color: var(--text-primary);
}
.intent-subtitle {
  font-size: calc(12px * var(--content-scale, 1));
  color: var(--text-muted);
}

/* 우측 라디오 원 */
.radio-mark {
  width: 22px; height: 22px;
  border-radius: 50%;
  border: 1.5px solid var(--border-color);
  background: var(--bg-card);
  display: inline-flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  transition: all 0.15s;
}
.radio-mark.checked {
  background: var(--primary, var(--color-primary, #4caf50));
  border-color: var(--primary, var(--color-primary, #4caf50));
  color: #fff;
}
</style>
