<template>
  <div class="gdd-card">
    <div v-if="loading" class="gdd-loading">계산 중...</div>
    <div v-else-if="error" class="gdd-error">{{ error }}</div>
    <template v-else-if="gdd">
      <!-- 소스 배지 -->
      <div class="source-row">
        <span class="source-badge" :style="{ color: gdd.sourceBadge.color }">
          {{ gdd.sourceBadge.emoji }} {{ gdd.sourceBadge.label }}
        </span>
      </div>

      <!-- 오프셋 출처 안내 (커뮤니티/기본값 사용 시) -->
      <div v-if="offsetNotice" class="offset-notice" :class="gdd.offsetInfo?.strategy">
        <span class="offset-notice-text">{{ offsetNotice }}</span>
        <button class="btn-offset-update" @click="emit('update-offset')">보정값 설정</button>
      </div>

      <!-- 생육 단계 -->
      <div class="stage-row">
        <span class="stage-emoji">{{ gdd.stage.emoji }}</span>
        <span class="stage-label">{{ gdd.stage.label }}</span>
      </div>

      <!-- 프로그레스 바 -->
      <div class="progress-wrap">
        <div class="progress-bar">
          <div class="progress-fill" :style="{ width: gdd.progressPct + '%' }" />
        </div>
        <span class="progress-text">
          {{ gdd.currentGdd.toFixed(0) }} / {{ gdd.targetGdd }}°C
          ({{ gdd.progressPct }}%)
        </span>
      </div>

      <!-- 일평균 -->
      <div class="daily-avg">일평균 +{{ gdd.dailyAvg }}°C/일</div>

      <!-- 타임라인 토글 -->
      <button class="btn-timeline-toggle" @click="showTimeline = !showTimeline">
        {{ showTimeline ? '▲ 타임라인 접기' : '▼ 생육 타임라인 보기' }}
      </button>

      <div v-if="showTimeline" class="timeline-wrap">
        <GddTimeline :batch-id="batchId" />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { cropManagementApi } from '../api/crop-management.api'
import GddTimeline from './GddTimeline.vue'
import type { GddResult } from '../types/crop-management.types'

const props = defineProps<{ batchId: string }>()
const emit = defineEmits<{ (e: 'update-offset'): void }>()

const gdd = ref<GddResult | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)
const showTimeline = ref(false)

const offsetNotice = computed(() => {
  const s = gdd.value?.offsetInfo?.strategy
  if (!s || s === 'calibrated' || s === 'manual') return null
  const v = gdd.value!.offsetInfo.value
  if (s === 'borrowed') return `다른 하우스 보정값 사용 중 (+${v}°C)`
  if (s === 'community') return `커뮤니티 평균 사용 중 (+${v}°C)`
  return `기본값 사용 중 (+${v}°C) — 실내 보정값을 설정하면 정확도가 높아집니다`
})

onMounted(async () => {
  try {
    gdd.value = await cropManagementApi.getGdd(props.batchId)
  } catch {
    error.value = 'GDD 조회 실패'
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.gdd-card {
  font-size: 13px;
}

.gdd-loading, .gdd-error {
  color: var(--text-secondary, #888);
  font-size: 12px;
  padding: 8px 0;
}

.source-row {
  margin-bottom: 6px;
}

.source-badge {
  font-size: 11px;
}

.stage-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 10px;
}

.stage-emoji {
  font-size: 20px;
}

.stage-label {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary, #222);
}

.progress-wrap {
  margin-bottom: 6px;
}

.progress-bar {
  height: 8px;
  background: var(--border-color, #e0e0e0);
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 4px;
}

.progress-fill {
  height: 100%;
  background: var(--primary-color, #4caf50);
  border-radius: 4px;
  transition: width 0.4s ease;
}

.progress-text {
  font-size: 11px;
  color: var(--text-secondary, #666);
}

.daily-avg {
  font-size: 11px;
  color: var(--text-secondary, #888);
  margin-bottom: 10px;
}

.btn-timeline-toggle {
  width: 100%;
  padding: 6px;
  background: none;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 6px;
  font-size: 12px;
  color: var(--text-secondary, #666);
  cursor: pointer;
  text-align: center;
}

.btn-timeline-toggle:hover {
  background: var(--input-bg, #f5f5f5);
}

.offset-notice {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 8px;
  margin-bottom: 10px;
  font-size: 11px;
  flex-wrap: wrap;
}

.offset-notice.community {
  background: #e3f2fd;
  color: #1565c0;
}

.offset-notice.borrowed {
  background: #e8f5e9;
  color: #2e7d32;
}

.offset-notice.default {
  background: #fff3e0;
  color: #e65100;
}

.offset-notice-text {
  flex: 1;
  line-height: 1.4;
}

.btn-offset-update {
  padding: 3px 8px;
  border-radius: 8px;
  border: 1px solid currentColor;
  background: none;
  font-size: 11px;
  cursor: pointer;
  color: inherit;
  white-space: nowrap;
  opacity: 0.85;
}

.btn-offset-update:hover {
  opacity: 1;
}

.timeline-wrap {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border-color, #eee);
}
</style>
