<template>
  <div class="step-farm-admin">
    <div class="step-head">
      <h3 class="step-title">어느 농장의 룰을 만들까요?</h3>
      <p class="step-desc">대상 농장을 선택하세요 (플랫폼 관리자 전용)</p>
    </div>

    <div v-if="loading" class="loading-msg">농장 목록을 불러오는 중...</div>

    <div v-else-if="farms.length === 0" class="empty-msg">
      등록된 농장이 없습니다.
    </div>

    <div v-else class="farm-list" role="radiogroup" aria-label="농장 선택">
      <label
        v-for="farm in farms"
        :key="farm.id"
        class="farm-card"
        :class="{ selected: modelValue === farm.id }"
      >
        <input
          type="radio"
          :value="farm.id"
          :checked="modelValue === farm.id"
          class="sr-only"
          @change="handleSelect(farm.id)"
        />
        <!-- 좌측 농장 아이콘 칩 -->
        <span class="farm-icon" :class="{ active: modelValue === farm.id }" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M2 22h20" />
            <path d="M4 22V10l8-6 8 6v12" />
            <path d="M9 22V14h6v8" />
            <path d="M12 10v0" />
          </svg>
        </span>
        <div class="farm-info">
          <span class="farm-name">{{ farm.name }}</span>
          <span class="farm-meta">@{{ farm.username }}</span>
        </div>
        <!-- 우측 라디오 원 -->
        <span class="radio-mark" :class="{ checked: modelValue === farm.id }" aria-hidden="true">
          <svg v-if="modelValue === farm.id" viewBox="0 0 24 24" width="14" height="14" fill="none"
            stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </span>
      </label>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { groupApi } from '@/api/group.api'
import type { FarmAdmin } from '@/types/group.types'

defineProps<{ modelValue: string | null }>()
const emit = defineEmits<{
  'update:modelValue': [v: string]
  proceed: []
}>()

const loading = ref(true)
const farms = ref<FarmAdmin[]>([])

function handleSelect(id: string) {
  emit('update:modelValue', id)
  emit('proceed')
}

onMounted(async () => {
  try {
    const res = await groupApi.getFarmAdmins()
    farms.value = res.data
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.step-farm-admin { display: flex; flex-direction: column; gap: 16px; }

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

.loading-msg, .empty-msg { color: var(--text-muted); font-size: calc(14px * var(--content-scale, 1)); }

.farm-list { display: flex; flex-direction: column; gap: 10px; }

.farm-card {
  display: flex; align-items: center; gap: 14px;
  min-height: 64px; padding: 14px 16px;
  border: 1.5px solid var(--border-color);
  border-radius: 13px;
  background: var(--bg-card);
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.farm-card:hover { border-color: var(--primary, var(--color-primary, #4caf50)); background: var(--bg-hover); }
.farm-card.selected {
  border-color: var(--primary, var(--color-primary, #4caf50));
  background: color-mix(in srgb, var(--primary, #4caf50) 8%, var(--bg-card));
}
.farm-card:focus-within { outline: 2px solid var(--primary, #4caf50); outline-offset: 2px; }

.farm-icon {
  width: 34px; height: 34px;
  border-radius: 9px;
  display: inline-flex; align-items: center; justify-content: center;
  background: var(--bg-hover, #eef2f6);
  color: var(--text-muted, #9ca3af);
  flex-shrink: 0;
  transition: background 0.15s, color 0.15s;
}
.farm-icon.active {
  background: color-mix(in srgb, var(--primary, #4caf50) 12%, transparent);
  color: var(--primary, #4caf50);
}

.farm-info { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
.farm-name {
  font-size: calc(15px * var(--content-scale, 1));
  font-weight: 700;
  color: var(--text-primary);
}
.farm-meta {
  font-size: calc(12px * var(--content-scale, 1));
  color: var(--text-muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

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

.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0,0,0,0); }
</style>
