<template>
  <div class="step-farm-admin">
    <h3 class="step-title">어느 농장의 룰을 만들까요?</h3>

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
        <div class="farm-info">
          <span class="farm-name">{{ farm.name }}</span>
          <span class="farm-meta">@{{ farm.username }}</span>
        </div>
        <span v-if="modelValue === farm.id" class="check-mark" aria-hidden="true">✓</span>
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
.step-title { font-size: calc(17px * var(--content-scale, 1)); font-weight: 600; color: var(--text-primary); margin: 0; }
.loading-msg, .empty-msg { color: var(--text-muted); font-size: calc(14px * var(--content-scale, 1)); }

.farm-list { display: flex; flex-direction: column; gap: 10px; }

.farm-card {
  display: flex; align-items: center; justify-content: space-between;
  min-height: 60px; padding: 14px 16px;
  border: 2px solid var(--border-color);
  border-radius: var(--radius-md, 10px);
  background: var(--bg-card);
  box-shadow: var(--shadow-sm, 0 1px 4px rgba(0,0,0,0.12));
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.farm-card:hover { border-color: var(--color-primary); background: var(--bg-secondary); }
.farm-card.selected { border-color: var(--color-primary); background: color-mix(in srgb, var(--color-primary) 8%, var(--bg-card)); }
.farm-card:focus-within { outline: 2px solid var(--color-primary); }

.farm-info { display: flex; flex-direction: column; gap: 2px; }
.farm-name { font-size: calc(15px * var(--content-scale, 1)); font-weight: 500; color: var(--text-primary); }
.farm-meta { font-size: calc(13px * var(--content-scale, 1)); color: var(--text-muted); }
.check-mark { color: var(--color-primary); font-size: 18px; font-weight: 700; }

.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0,0,0,0); }
</style>
