<template>
  <div class="step-intent">
    <h3 class="step-title">무엇을 하고 싶으세요?</h3>

    <div class="intent-list" role="radiogroup" aria-label="의도 선택">
      <button
        v-for="intent in INTENTS"
        :key="intent.id"
        class="intent-card"
        :class="{ selected: selected === intent.id }"
        :aria-pressed="selected === intent.id"
        @click="handleSelect(intent.id)"
      >
        <span class="intent-icon" aria-hidden="true">{{ intent.icon }}</span>
        <div class="intent-text">
          <span class="intent-title">{{ intent.title }}</span>
          <span class="intent-subtitle">{{ intent.subtitle }}</span>
        </div>
        <span v-if="selected === intent.id" class="check-mark" aria-hidden="true">✓</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { INTENTS, type WizardIntent } from './types'

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
</script>

<style scoped>
.step-intent { display: flex; flex-direction: column; gap: 16px; }
.step-title { font-size: calc(17px * var(--content-scale, 1)); font-weight: 600; color: var(--text-primary); margin: 0; }

.intent-list { display: flex; flex-direction: column; gap: 10px; }

.intent-card {
  display: flex; align-items: center; gap: 14px;
  min-height: 72px; padding: 14px 16px;
  border: 2px solid var(--border-color);
  border-radius: var(--radius-md, 10px);
  background: var(--bg-card);
  box-shadow: var(--shadow-sm, 0 1px 4px rgba(0,0,0,0.12));
  cursor: pointer; text-align: left; width: 100%;
  transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
}
.intent-card:hover { border-color: var(--color-primary); background: var(--bg-secondary); box-shadow: var(--shadow-md, 0 2px 8px rgba(0,0,0,0.18)); }
.intent-card:active { transform: scale(0.99); }
.intent-card.selected { border-color: var(--color-primary); background: color-mix(in srgb, var(--color-primary) 8%, var(--bg-card)); }
.intent-card:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }

.intent-icon { font-size: 28px; flex-shrink: 0; }
.intent-text { display: flex; flex-direction: column; gap: 2px; flex: 1; }
.intent-title { font-size: calc(15px * var(--content-scale, 1)); font-weight: 600; color: var(--text-primary); }
.intent-subtitle { font-size: calc(13px * var(--content-scale, 1)); color: var(--text-muted); }
.check-mark { color: var(--color-primary); font-size: 18px; font-weight: 700; flex-shrink: 0; }
</style>
