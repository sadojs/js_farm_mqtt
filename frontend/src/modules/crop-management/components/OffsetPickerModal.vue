<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal-content">
      <div class="modal-header">
        <h3>하우스 보정값 설정</h3>
        <button class="btn-close" @click="$emit('close')">✕</button>
      </div>

      <div class="modal-body">
        <!-- 현재 오프셋 상태 -->
        <div class="current-info">
          <div class="current-label">현재 적용 중</div>
          <div class="current-value" :class="currentStrategy">
            {{ currentStrategyLabel }} : +{{ currentOffset }}°C
          </div>
        </div>

        <div class="divider" />

        <!-- 수동 입력 -->
        <div class="section">
          <p class="section-title">직접 입력</p>
          <div class="input-row">
            <input
              type="number"
              v-model.number="manualOffset"
              step="0.1"
              min="-10"
              max="30"
              placeholder="예: 7.5"
            />
            <span class="unit">°C</span>
            <button class="btn-apply" @click="apply(manualOffset, 'manual', undefined)">적용</button>
          </div>
          <p class="hint">실내 온도가 외기보다 평균적으로 더 높은 값을 입력하세요.</p>
        </div>

        <!-- 추천값 -->
        <div v-if="loadingSuggestions" class="loading">추천값 불러오는 중...</div>
        <template v-else-if="suggestions">
          <div class="section" v-if="suggestions.otherGroups.length > 0">
            <p class="section-title">내 다른 하우스 보정값</p>
            <button
              v-for="og in suggestions.otherGroups"
              :key="og.groupId"
              class="chip green"
              @click="apply(og.offset, 'borrowed', og.groupId)"
            >
              {{ og.groupName }} +{{ og.offset }}°C
            </button>
          </div>

          <div class="section" v-if="suggestions.communityAverage">
            <p class="section-title">
              커뮤니티 평균
              <span class="sample-count">({{ suggestions.communityAverage.sampleCount }}개 농장 데이터)</span>
            </p>
            <button
              class="chip blue"
              @click="apply(suggestions.communityAverage!.offset, 'community', undefined)"
            >
              +{{ suggestions.communityAverage.offset }}°C 적용
            </button>
            <p class="hint">실내 센서를 보유한 다른 농장의 측정값 평균입니다.</p>
          </div>

          <div v-if="suggestions.otherGroups.length === 0 && !suggestions.communityAverage" class="no-suggestions">
            아직 다른 농장 데이터가 충분하지 않습니다.<br>
            실내 센서를 연결하면 자동으로 보정됩니다.
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { cropManagementApi } from '../api/crop-management.api'
import type { OffsetSuggestion, OffsetStrategy } from '../types/crop-management.types'

const props = defineProps<{
  batchId: string
  groupId: string | null
  cropType: string
  currentOffset: number
  currentStrategy: OffsetStrategy
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'applied', payload: { offset: number; source: string; borrowedGroupId?: string }): void
}>()

const manualOffset = ref<number>(props.currentOffset)
const suggestions = ref<OffsetSuggestion | null>(null)
const loadingSuggestions = ref(false)

const STRATEGY_LABELS: Record<OffsetStrategy, string> = {
  calibrated: '자동 보정',
  manual: '수동 입력',
  borrowed: '다른 하우스 차용',
  community: '커뮤니티 평균',
  default: '기본값',
}

const currentStrategyLabel = STRATEGY_LABELS[props.currentStrategy] ?? props.currentStrategy

onMounted(async () => {
  if (!props.groupId && !props.cropType) return
  loadingSuggestions.value = true
  try {
    suggestions.value = await cropManagementApi.getOffsetSuggestions(
      props.groupId ?? '',
      props.cropType,
    )
  } catch {
    // 오류 무시
  } finally {
    loadingSuggestions.value = false
  }
})

async function apply(offset: number, source: string, borrowedGroupId?: string) {
  if (offset == null || isNaN(offset)) return
  try {
    await cropManagementApi.updateBatch(props.batchId, {
      greenhouseOffset: offset,
      offsetSource: source as any,
      borrowedGroupId: borrowedGroupId ?? undefined,
    })
    emit('applied', { offset, source, borrowedGroupId })
    emit('close')
  } catch {
    alert('저장 실패. 다시 시도해주세요.')
  }
}
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1100;
  padding: 16px;
}

.modal-content {
  background: var(--card-bg, #fff);
  border-radius: 16px;
  width: 100%;
  max-width: 420px;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color, #eee);
  position: sticky;
  top: 0;
  background: var(--card-bg, #fff);
  z-index: 1;
}

.modal-header h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.btn-close {
  background: none;
  border: none;
  font-size: 18px;
  cursor: pointer;
  color: var(--text-secondary, #888);
  padding: 4px 8px;
}

.modal-body {
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.current-info {
  background: var(--input-bg, #f5f5f5);
  border-radius: 10px;
  padding: 12px;
}

.current-label {
  font-size: 11px;
  color: var(--text-secondary, #888);
  margin-bottom: 4px;
}

.current-value {
  font-size: 14px;
  font-weight: 600;
}

.current-value.community { color: #1565c0; }
.current-value.borrowed  { color: #2e7d32; }
.current-value.default   { color: #e65100; }
.current-value.calibrated { color: #2e7d32; }
.current-value.manual    { color: #555; }

.divider {
  height: 1px;
  background: var(--border-color, #eee);
  margin: 0 -20px;
}

.section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.section-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary, #666);
  margin: 0;
}

.sample-count {
  font-weight: 400;
  color: var(--text-secondary, #999);
}

.input-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.input-row input {
  flex: 1;
  padding: 8px 10px;
  border: 1px solid var(--border-color, #ddd);
  border-radius: 8px;
  font-size: 14px;
  background: var(--input-bg, #fff);
  color: var(--text-primary, #333);
}

.unit {
  font-size: 13px;
  color: var(--text-secondary, #888);
}

.btn-apply {
  padding: 8px 16px;
  background: var(--primary-color, #4caf50);
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
}

.chip {
  display: inline-flex;
  align-items: center;
  padding: 5px 12px;
  border-radius: 16px;
  font-size: 12px;
  cursor: pointer;
  margin: 2px 4px 2px 0;
  border: 1px solid;
  background: none;
}

.chip.green {
  background: #e8f5e9;
  color: #2e7d32;
  border-color: #a5d6a7;
}

.chip.blue {
  background: #e3f2fd;
  color: #1565c0;
  border-color: #90caf9;
}

.hint {
  font-size: 11px;
  color: var(--text-secondary, #999);
  margin: 0;
  line-height: 1.4;
}

.loading, .no-suggestions {
  font-size: 12px;
  color: var(--text-secondary, #888);
  text-align: center;
  padding: 12px;
  line-height: 1.5;
}

#app.theme-dark .modal-content,
#app.theme-dark .modal-header {
  background: var(--card-bg);
}
</style>
