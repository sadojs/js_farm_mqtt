<template>
  <div class="step-farm">
    <div class="step-head">
      <h3 class="step-title">어느 구역에 적용할까요?</h3>
      <p class="step-desc">자동 제어를 적용할 하우스/구역을 선택하세요</p>
    </div>

    <div v-if="groupStore.loading" class="loading-msg">구역 목록을 불러오는 중...</div>

    <div v-else-if="sortedGroups.length === 0" class="empty-msg">
      {{ farmUserId ? '이 농장에 등록된 구역이 없습니다.' : '등록된 구역이 없습니다.' }}
    </div>

    <div v-else class="group-list" role="radiogroup" aria-label="구역 선택">
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
        <!-- 좌측 격자 아이콘 -->
        <span class="zone-icon" :class="{ active: modelValue === group.id }" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 9.5L12 3l9 6.5V21H3z" />
            <path d="M9 21V12h6v9" />
          </svg>
        </span>
        <!-- 본문 -->
        <div class="group-info">
          <span class="group-name">{{ group.name }}</span>
          <span class="group-meta">{{ formatMeta(group) }}</span>
        </div>
        <!-- 우측 라디오 원 -->
        <span class="radio-mark" :class="{ checked: modelValue === group.id }" aria-hidden="true">
          <svg v-if="modelValue === group.id" viewBox="0 0 24 24" width="14" height="14" fill="none"
            stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </span>
      </label>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useGroupStore } from '@/stores/group.store'

const props = defineProps<{
  modelValue: string | null
  farmUserId?: string | null
}>()
const emit = defineEmits<{
  'update:modelValue': [v: string]
  proceed: []
}>()

const groupStore = useGroupStore()

const sortedGroups = computed(() => {
  const all = groupStore.iotGroups
  const filtered = props.farmUserId
    ? all.filter(g => (g as any).userId === props.farmUserId)
    : all
  return [...filtered].sort((a, b) => a.name.localeCompare(b.name))
})

function handleSelect(id: string) {
  emit('update:modelValue', id)
  emit('proceed')
}

// 구역 메타 — "작물 · 측정기 N · 장치 N" 형식 (있을 때만 표시)
function formatMeta(group: any): string {
  const parts: string[] = []
  // 작물 정보 — 그룹의 첫 하우스의 작물 (선택적)
  const crop = group.houses?.[0]?.crop || group.cropName
  if (crop) parts.push(String(crop))
  const devices = group.devices ?? []
  const sensorCount = devices.filter((d: any) => d.deviceType === 'sensor').length
  const actuatorCount = devices.filter((d: any) => d.deviceType === 'actuator').length
  if (sensorCount > 0) parts.push(`측정기 ${sensorCount}`)
  if (actuatorCount > 0) parts.push(`장치 ${actuatorCount}`)
  if (parts.length === 0) parts.push(`장비 ${devices.length}개`)
  return parts.join(' · ')
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

.group-list { display: flex; flex-direction: column; gap: 10px; }

.group-card {
  display: flex; align-items: center; gap: 14px;
  min-height: 64px; padding: 14px 16px;
  border: 1.5px solid var(--border-color);
  border-radius: 13px;
  background: var(--bg-card);
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.group-card:hover { border-color: var(--primary, var(--color-primary, #4caf50)); background: var(--bg-hover); }
.group-card.selected {
  border-color: var(--primary, var(--color-primary, #4caf50));
  background: color-mix(in srgb, var(--primary, #4caf50) 8%, var(--bg-card));
}
.group-card:focus-within { outline: 2px solid var(--primary, #4caf50); outline-offset: 2px; }

/* 구역 아이콘 칩 (격자 아이콘) */
.zone-icon {
  width: 34px; height: 34px;
  border-radius: 9px;
  display: inline-flex; align-items: center; justify-content: center;
  background: var(--bg-hover, #eef2f6);
  color: var(--text-muted, #9ca3af);
  flex-shrink: 0;
  transition: background 0.15s, color 0.15s;
}
.zone-icon.active {
  background: color-mix(in srgb, var(--primary, #4caf50) 12%, transparent);
  color: var(--primary, #4caf50);
}

.group-info { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
.group-name {
  font-size: calc(15px * var(--content-scale, 1));
  font-weight: 700;
  color: var(--text-primary);
}
.group-meta {
  font-size: calc(12px * var(--content-scale, 1));
  color: var(--text-muted);
}

/* 우측 라디오 원 (selected 시 채워진 체크) */
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
