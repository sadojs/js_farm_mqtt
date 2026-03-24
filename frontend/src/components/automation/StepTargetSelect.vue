<template>
  <div class="step-target">
    <h3 class="step-title">그룹 선택</h3>
    <p class="step-desc">자동화를 적용할 그룹을 선택하세요</p>

    <div v-if="groupStore.loading" class="loading">그룹 로딩 중...</div>
    <div v-else-if="groupStore.groups.length === 0" class="empty">
      등록된 그룹이 없습니다. 먼저 그룹을 만들어주세요.
    </div>
    <div v-else class="group-list">
      <div
        v-for="group in groupStore.groups"
        :key="group.id"
        class="group-card"
        :class="{ selected: modelValue === group.id }"
        @click="$emit('update:modelValue', group.id)"
      >
        <div class="group-icon">📁</div>
        <div class="group-info">
          <div class="group-name">{{ group.name }}</div>
          <div class="group-meta">
            장비 {{ group.devices?.length || 0 }}대
          </div>
        </div>
        <div v-if="modelValue === group.id" class="check-mark">✓</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useGroupStore } from '../../stores/group.store'

defineProps<{ modelValue?: string }>()
defineEmits<{ 'update:modelValue': [value: string] }>()

const groupStore = useGroupStore()
</script>

<style scoped>
.step-target { display: flex; flex-direction: column; gap: 16px; }
.step-title { font-size: 18px; font-weight: 700; color: var(--text-primary); margin: 0; }
.step-desc { font-size: 14px; color: var(--text-muted); margin: 0; }

.loading, .empty {
  text-align: center; padding: 32px; color: var(--text-muted); font-size: 14px;
}

.group-list { display: flex; flex-direction: column; gap: 8px; }

.group-card {
  display: flex; align-items: center; gap: 12px;
  padding: 14px 16px; border: 2px solid var(--border-input); border-radius: 12px;
  cursor: pointer; transition: all 0.15s;
}
.group-card:hover { border-color: #c8e6c9; background: var(--bg-hover); }
.group-card.selected { border-color: #4caf50; background: rgba(76, 175, 80, 0.1); }

.group-icon { font-size: 24px; }
.group-info { flex: 1; }
.group-name { font-size: 15px; font-weight: 600; color: var(--text-primary); }
.group-meta { font-size: 13px; color: var(--text-muted); margin-top: 2px; }

.check-mark {
  width: 24px; height: 24px; border-radius: 50%;
  background: #4caf50; color: white; font-size: 14px; font-weight: 700;
  display: flex; align-items: center; justify-content: center;
}
</style>
