<template>
  <div class="milestones-tab">
    <div v-for="batch in batches" :key="batch.id" class="batch-section">
      <h4 class="batch-title">
        {{ CROP_LABELS[batch.cropType] ?? batch.cropType }}
        <span class="sowing-info">파종일: {{ batch.sowingDate }}</span>
      </h4>

      <div v-if="loading[batch.id]" class="loading">불러오는 중...</div>
      <div v-else-if="milestonesData[batch.id]">
        <div class="milestone-list">
          <div
            v-for="m in milestonesData[batch.id].milestones"
            :key="m.id"
            class="milestone-item"
            :class="m.status"
          >
            <div class="milestone-icon">
              <span v-if="m.status === 'done'">✅</span>
              <span v-else-if="m.status === 'imminent'">🔔</span>
              <span v-else>⏳</span>
            </div>
            <div class="milestone-body">
              <div class="milestone-title-row">
                <span class="milestone-name">{{ m.title }}</span>
                <span class="milestone-type-tag" :class="m.milestoneType">
                  {{ milestoneTypeLabel(m.milestoneType) }}
                </span>
                <span
                  v-if="m.priority === 'high'"
                  class="priority-badge"
                >중요</span>
              </div>
              <div class="milestone-threshold">목표 GDD: {{ m.gddThreshold }}°C</div>
              <div v-if="m.description" class="milestone-desc">{{ m.description }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { cropManagementApi } from '../api/crop-management.api'
import { CROP_LABELS } from '../types/crop-management.types'
import type { CropBatch, MilestonesResponse } from '../types/crop-management.types'

const props = defineProps<{ batches: CropBatch[] }>()

const loading = ref<Record<string, boolean>>({})
const milestonesData = ref<Record<string, MilestonesResponse>>({})

onMounted(async () => {
  for (const batch of props.batches) {
    loading.value[batch.id] = true
    try {
      milestonesData.value[batch.id] = await cropManagementApi.getMilestones(batch.id)
    } finally {
      loading.value[batch.id] = false
    }
  }
})

function milestoneTypeLabel(type: string) {
  const labels: Record<string, string> = {
    pest_control: '방제',
    fertilizer: '시비',
    pruning: '순따기',
    stage: '생육단계',
  }
  return labels[type] ?? type
}
</script>

<style scoped>
.milestones-tab {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.batch-section {
  background: var(--card-bg, #fff);
  border-radius: 12px;
  padding: 16px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.batch-title {
  font-size: 15px;
  font-weight: 600;
  margin: 0 0 14px;
  color: var(--text-primary, #222);
}

.sowing-info {
  font-size: 12px;
  font-weight: 400;
  color: var(--text-secondary, #888);
  margin-left: 8px;
}

.loading {
  color: var(--text-secondary, #888);
  font-size: 13px;
  padding: 12px 0;
}

.milestone-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.milestone-item {
  display: flex;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--input-bg, #f8f9fa);
}

.milestone-item.done {
  opacity: 0.55;
}

.milestone-item.imminent {
  background: #fff8e1;
  border-left: 3px solid #ff9800;
}

.milestone-icon {
  font-size: 18px;
  flex-shrink: 0;
  margin-top: 1px;
}

.milestone-body {
  flex: 1;
}

.milestone-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 4px;
}

.milestone-name {
  font-size: 14px;
  font-weight: 500;
}

.milestone-type-tag {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 10px;
  background: #e0f2f1;
  color: #00695c;
}

.milestone-type-tag.pest_control {
  background: #fce4ec;
  color: #c62828;
}

.milestone-type-tag.fertilizer {
  background: #e8f5e9;
  color: #2e7d32;
}

.milestone-type-tag.pruning {
  background: #ede7f6;
  color: #4527a0;
}

.priority-badge {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 10px;
  background: #ff5722;
  color: #fff;
}

.milestone-threshold {
  font-size: 11px;
  color: var(--text-secondary, #888);
  margin-bottom: 2px;
}

.milestone-desc {
  font-size: 12px;
  color: var(--text-secondary, #666);
  line-height: 1.4;
}

/* 다크모드 */
#app.theme-dark .milestone-item.imminent {
  background: rgba(255, 152, 0, 0.15);
}
</style>
