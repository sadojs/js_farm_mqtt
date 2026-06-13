<template>
  <div class="manager-wrap">
    <div class="manager-header">
      <p class="manager-desc">방울토마토 표준 작업 + 우리 농장만의 작업을 추가하세요</p>
      <button v-if="isAdmin" class="btn-primary" @click="$emit('add')">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        작업 추가
      </button>
    </div>

    <ul class="type-list">
      <li v-for="t in taskTypes" :key="t.id" :class="['type-row', { hidden: t.hidden }]">
        <span class="type-emoji-wrap" :style="{ background: t.color + '22' }">
          <span class="type-emoji">{{ t.emoji }}</span>
        </span>
        <div class="type-info">
          <div class="type-label">{{ t.label }}</div>
          <div class="type-sub">
            {{ t.isStandard ? '표준 작업' : '커스텀' }} · 전 구역 공통
            <span v-if="t.hidden" class="hidden-badge">숨김</span>
          </div>
        </div>
        <span class="color-swatch" :style="{ background: t.color }"></span>
        <div class="actions">
          <button class="icon-btn" :title="t.hidden ? '표시' : '숨김'" @click="$emit('toggle-hidden', t)" v-if="isAdmin">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <path v-if="!t.hidden" d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
              <circle v-if="!t.hidden" cx="12" cy="12" r="3"/>
              <path v-else d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
              <line v-if="t.hidden" x1="1" y1="1" x2="23" y2="23"/>
            </svg>
          </button>
          <button class="icon-btn" title="편집" @click="$emit('edit', t)" v-if="isAdmin">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button v-if="isAdmin && !t.isStandard" class="icon-btn danger" title="삭제" @click="$emit('delete', t)">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/></svg>
          </button>
        </div>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import type { WorkTaskType, Palette } from '../types/work-log.types'

defineProps<{
  taskTypes: WorkTaskType[]
  palette: Palette
  isAdmin: boolean
}>()

defineEmits<{
  (e: 'add'): void
  (e: 'edit', t: WorkTaskType): void
  (e: 'toggle-hidden', t: WorkTaskType): void
  (e: 'delete', t: WorkTaskType): void
}>()
</script>

<style scoped>
.manager-wrap {
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: 14px;
  padding: 18px;
  box-shadow: var(--shadow-card);
}
.manager-header {
  display: flex; justify-content: space-between; align-items: center;
  margin-bottom: 14px; gap: 10px; flex-wrap: wrap;
}
.manager-desc { margin: 0; color: var(--text-secondary); font-size: 13px; }
.btn-primary {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 8px 14px;
  background: var(--accent); color: #fff;
  border: none; border-radius: 8px;
  font-size: 13px; font-weight: 600; cursor: pointer;
}

.type-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.type-row {
  display: grid;
  grid-template-columns: auto 1fr auto auto;
  align-items: center;
  gap: 14px;
  padding: 14px 16px;
  background: var(--bg-secondary, var(--bg-hover));
  border: 1px solid var(--border-light);
  border-radius: 12px;
}
.type-row.hidden { opacity: 0.55; }

.type-emoji-wrap {
  display: inline-flex; align-items: center; justify-content: center;
  width: 40px; height: 40px;
  border-radius: 10px;
  font-size: 20px;
}
.type-info { min-width: 0; }
.type-label { font-size: 14px; font-weight: 700; color: var(--text-primary); }
.type-sub { font-size: 11px; color: var(--text-muted); margin-top: 2px; display: flex; align-items: center; gap: 6px; }
.hidden-badge {
  padding: 1px 6px;
  background: var(--bg-badge);
  border-radius: 999px;
  font-size: 10px;
  color: var(--text-muted);
}

.color-swatch {
  width: 18px; height: 18px; border-radius: 50%;
  border: 2px solid var(--bg-card);
  box-shadow: 0 0 0 1px var(--border-light);
}

.actions { display: flex; gap: 4px; }
.icon-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 30px; height: 30px;
  border: 1px solid var(--border-light);
  background: var(--bg-card);
  color: var(--text-muted);
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;
}
.icon-btn:hover { background: var(--bg-hover); color: var(--text-primary); }
.icon-btn.danger:hover { background: rgba(244, 67, 54, 0.08); color: #c62828; border-color: rgba(244, 67, 54, 0.3); }
</style>
