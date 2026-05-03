<template>
  <div class="step-farm">
    <h3 class="step-title">어느 농장에서 사용할까요?</h3>

    <div v-if="groupStore.loading" class="loading-msg">농장 목록을 불러오는 중...</div>

    <div v-else-if="sortedGroups.length === 0" class="empty-msg">
      등록된 농장이 없습니다.
    </div>

    <div v-else class="group-list" role="radiogroup" aria-label="농장 선택">
      <label
        v-for="group in sortedGroups"
        :key="group.id"
        class="group-card"
        :class="{ selected: modelValue === group.id }"
      >
        <input
          type="radio"
          :value="group.id"
          :checked="modelValue === group.id"
          class="sr-only"
          @change="handleSelect(group.id)"
        />
        <div class="group-info">
          <span class="group-name">{{ group.name }}</span>
          <span class="group-meta">장비 {{ group.devices?.length ?? 0 }}개</span>
        </div>
        <span v-if="modelValue === group.id" class="check-mark" aria-hidden="true">✓</span>
      </label>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useGroupStore } from '@/stores/group.store'

defineProps<{ modelValue: string | null }>()
const emit = defineEmits<{
  'update:modelValue': [v: string]
  proceed: []
}>()

const groupStore = useGroupStore()

const sortedGroups = computed(() => {
  return [...groupStore.groups].sort((a, b) => a.name.localeCompare(b.name))
})

function handleSelect(id: string) {
  emit('update:modelValue', id)
  emit('proceed')
}

onMounted(async () => {
  if (groupStore.groups.length === 0) {
    await groupStore.fetchGroups()
  }
  if (sortedGroups.value.length === 1) {
    handleSelect(sortedGroups.value[0].id)
  }
})
</script>

<style scoped>
.step-farm { display: flex; flex-direction: column; gap: 16px; }
.step-title { font-size: calc(17px * var(--content-scale, 1)); font-weight: 600; color: var(--text-primary); margin: 0; }
.loading-msg, .empty-msg { color: var(--text-muted); font-size: calc(14px * var(--content-scale, 1)); }

.group-list { display: flex; flex-direction: column; gap: 10px; }

.group-card {
  display: flex; align-items: center; justify-content: space-between;
  min-height: 60px; padding: 14px 16px;
  border: 2px solid var(--border-color);
  border-radius: var(--radius-md, 10px);
  background: var(--bg-card);
  box-shadow: var(--shadow-sm, 0 1px 4px rgba(0,0,0,0.12));
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.group-card:hover { border-color: var(--color-primary); background: var(--bg-secondary); }
.group-card.selected { border-color: var(--color-primary); background: color-mix(in srgb, var(--color-primary) 8%, var(--bg-card)); }
.group-card:focus-within { outline: 2px solid var(--color-primary); }

.group-info { display: flex; flex-direction: column; gap: 2px; }
.group-name { font-size: calc(15px * var(--content-scale, 1)); font-weight: 500; color: var(--text-primary); }
.group-meta { font-size: calc(13px * var(--content-scale, 1)); color: var(--text-muted); }
.check-mark { color: var(--color-primary); font-size: 18px; font-weight: 700; }

.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0,0,0,0); }
</style>
