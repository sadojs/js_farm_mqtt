<template>
  <div class="page-container">
    <header class="page-header">
      <div>
        <h2>생육관리</h2>
        <p class="page-description">적산온도 기반 생육 단계 추적 및 수확 예측</p>
      </div>
      <button class="btn-add" @click="openModal()">+ 파종 등록</button>
    </header>

    <!-- 탭 -->
    <div class="tab-bar">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        class="tab-btn"
        :class="{ active: activeTab === tab.id }"
        @click="activeTab = tab.id"
      >
        {{ tab.label }}
      </button>
    </div>

    <!-- ── 탭 1: 생육 현황 ── -->
    <div v-if="activeTab === 'status'" class="tab-content">
      <div v-if="loading" class="loading-state">불러오는 중...</div>

      <div v-else-if="batches.length === 0" class="empty-state">
        <div class="empty-icon">🌱</div>
        <p>등록된 파종 정보가 없습니다.</p>
        <button class="btn-primary" @click="openModal()">파종 정보 입력</button>
      </div>

      <!-- 구역별 그룹 렌더링 -->
      <template v-else>
        <!-- 구역이 지정된 배치들 (구역별 섹션) -->
        <div
          v-for="group in groupsWithBatches"
          :key="group.id"
          class="zone-section"
        >
          <div class="zone-header">
            <span class="zone-icon">🏠</span>
            <span class="zone-name">{{ group.name }}</span>
            <span class="zone-batch-count">{{ group.batches.length }}건</span>
            <button class="btn-zone-add" @click="openModal(group.id)" title="이 구역에 파종 등록">
              + 파종
            </button>
          </div>

          <div class="batch-grid">
            <div v-for="batch in group.batches" :key="batch.id" class="batch-card">
              <div class="batch-card-header">
                <div>
                  <span class="crop-name">{{ CROP_LABELS[batch.cropType] ?? batch.cropType }}</span>
                  <span class="seedling-tag">{{ SEEDLING_LABELS[batch.seedlingType] ?? batch.seedlingType }}</span>
                </div>
                <button class="btn-delete" @click="removeBatch(batch.id)">✕</button>
              </div>
              <div class="sowing-date">파종일: {{ batch.sowingDate }}</div>
              <GddCard :batchId="batch.id" @update-offset="openOffsetPicker(batch)" />
            </div>
          </div>
        </div>

        <!-- 구역 미지정 배치들 -->
        <div v-if="ungroupedBatches.length > 0" class="zone-section">
          <div class="zone-header">
            <span class="zone-icon">📋</span>
            <span class="zone-name">구역 미지정</span>
            <span class="zone-batch-count">{{ ungroupedBatches.length }}건</span>
          </div>

          <div class="batch-grid">
            <div v-for="batch in ungroupedBatches" :key="batch.id" class="batch-card">
              <div class="batch-card-header">
                <div>
                  <span class="crop-name">{{ CROP_LABELS[batch.cropType] ?? batch.cropType }}</span>
                  <span class="seedling-tag">{{ SEEDLING_LABELS[batch.seedlingType] ?? batch.seedlingType }}</span>
                </div>
                <button class="btn-delete" @click="removeBatch(batch.id)">✕</button>
              </div>
              <div class="sowing-date">파종일: {{ batch.sowingDate }}</div>
              <GddCard :batchId="batch.id" @update-offset="openOffsetPicker(batch)" />
            </div>
          </div>
        </div>
      </template>
    </div>

    <!-- ── 탭 2: 방제·시비 일정 ── -->
    <div v-if="activeTab === 'milestones'" class="tab-content">
      <div v-if="batches.length === 0" class="empty-state">
        <p>파종 정보를 먼저 등록해주세요.</p>
      </div>
      <MilestonesTab v-else :batches="batches" />
    </div>

    <!-- ── 탭 3: 수확 예측 ── -->
    <div v-if="activeTab === 'harvest'" class="tab-content">
      <div v-if="batches.length === 0" class="empty-state">
        <p>파종 정보를 먼저 등록해주세요.</p>
      </div>
      <HarvestTab v-else :batches="batches" />
    </div>

    <!-- 파종 등록 모달 -->
    <CropBatchModal
      v-if="showModal"
      :groups="groups"
      :initial-group-id="modalDefaultGroupId"
      @close="showModal = false"
      @created="onBatchCreated"
    />

    <!-- 오프셋 설정 모달 -->
    <OffsetPickerModal
      v-if="offsetPickerBatch"
      :batch-id="offsetPickerBatch.id"
      :group-id="offsetPickerBatch.groupId"
      :crop-type="offsetPickerBatch.cropType"
      :current-offset="offsetPickerBatch.greenhouseOffset ?? 8"
      :current-strategy="(offsetPickerBatch.offsetSource as any) ?? 'default'"
      @close="offsetPickerBatch = null"
      @applied="(p) => onOffsetApplied(p, offsetPickerBatch!)"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, defineAsyncComponent } from 'vue'
import { cropManagementApi } from './api/crop-management.api'
import CropBatchModal from './CropBatchModal.vue'
import { CROP_LABELS, SEEDLING_LABELS } from './types/crop-management.types'
import type { CropBatch } from './types/crop-management.types'

// 탭별 하위 컴포넌트 (lazy load)
const GddCard = defineAsyncComponent(() => import('./components/GddCard.vue'))
const MilestonesTab = defineAsyncComponent(() => import('./components/MilestonesTab.vue'))
const HarvestTab = defineAsyncComponent(() => import('./components/HarvestTab.vue'))
const OffsetPickerModal = defineAsyncComponent(() => import('./components/OffsetPickerModal.vue'))

const tabs = [
  { id: 'status', label: '생육 현황' },
  { id: 'milestones', label: '방제·시비 일정' },
  { id: 'harvest', label: '수확 예측' },
]
const activeTab = ref<string>('status')
const showModal = ref(false)
const modalDefaultGroupId = ref<string | undefined>(undefined)
const batches = ref<CropBatch[]>([])
const groups = ref<Array<{ id: string; name: string }>>([])
const loading = ref(false)
const offsetPickerBatch = ref<CropBatch | null>(null)

// 구역별 배치 그룹핑 (실제 배치가 있는 구역만)
const groupsWithBatches = computed(() => {
  return groups.value
    .map((g) => ({
      ...g,
      batches: batches.value.filter((b) => b.groupId === g.id),
    }))
    .filter((g) => g.batches.length > 0)
})

// 구역 미지정 배치
const ungroupedBatches = computed(() =>
  batches.value.filter((b) => !b.groupId)
)

onMounted(async () => {
  loading.value = true
  try {
    const [batchList, groupList] = await Promise.all([
      cropManagementApi.getBatches(),
      fetchGroups(),
    ])
    batches.value = batchList
    groups.value = groupList
  } finally {
    loading.value = false
  }
})

async function fetchGroups() {
  try {
    const res = await fetch('/api/groups', {
      headers: { Authorization: `Bearer ${localStorage.getItem('accessToken')}` },
    })
    if (!res.ok) return []
    const data = await res.json()
    return (data as any[]).map((g: any) => ({ id: g.id, name: g.name }))
  } catch {
    return []
  }
}

function openModal(groupId?: string) {
  modalDefaultGroupId.value = groupId
  showModal.value = true
}

async function removeBatch(id: string) {
  if (!confirm('이 파종 정보를 삭제할까요?')) return
  await cropManagementApi.deleteBatch(id)
  batches.value = batches.value.filter((b) => b.id !== id)
}

function onBatchCreated(batch: CropBatch) {
  batches.value.unshift(batch)
}

function openOffsetPicker(batch: CropBatch) {
  offsetPickerBatch.value = batch
}

function onOffsetApplied(payload: { offset: number; source: string; borrowedGroupId?: string }, batch: CropBatch) {
  // 로컬 배치 데이터 업데이트 (재조회 없이 즉시 반영)
  const idx = batches.value.findIndex((b) => b.id === batch.id)
  if (idx !== -1) {
    batches.value[idx] = {
      ...batches.value[idx],
      greenhouseOffset: payload.offset,
      offsetSource: payload.source as any,
      borrowedGroupId: payload.borrowedGroupId ?? null,
    }
  }
  offsetPickerBatch.value = null
}
</script>

<style scoped>
/* ── 헤더 레이아웃 ── */
.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
  gap: 12px;
  flex-wrap: wrap;
}

.page-header h2 {
  font-size: var(--font-size-display, 22px);
  font-weight: 700;
  color: var(--text-primary, #222);
  margin: 0;
}

.page-description {
  color: var(--text-secondary, #888);
  font-size: var(--font-size-label, 13px);
  margin-top: 4px;
}

/* ── 헤더 버튼 (사이트 공통 btn-primary 스타일 준수) ── */
.btn-add {
  padding: 10px 20px;
  background: var(--primary-color, #4caf50);
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: var(--font-size-body, 14px);
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  transition: background 0.2s;
}

.btn-add:hover {
  background: var(--primary-dark, #388e3c);
}

/* ── 탭 ── */
.tab-bar {
  display: flex;
  gap: 4px;
  padding: 0 0 16px;
  border-bottom: 1px solid var(--border-color, #eee);
  margin-bottom: 16px;
  overflow-x: auto;
}

.tab-btn {
  padding: 8px 16px;
  border: 1px solid var(--border-color, #ddd);
  border-radius: 20px;
  background: none;
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
  color: var(--text-secondary, #666);
}

.tab-btn.active {
  background: var(--primary-color, #4caf50);
  color: #fff;
  border-color: var(--primary-color, #4caf50);
}

.tab-content {
  min-height: 200px;
}

/* ── 상태 ── */
.loading-state,
.empty-state {
  text-align: center;
  padding: 40px 20px;
  color: var(--text-secondary, #888);
}

.empty-icon {
  font-size: 48px;
  margin-bottom: 12px;
}

.btn-primary {
  margin-top: 12px;
  padding: 10px 20px;
  background: var(--primary-color, #4caf50);
  color: #fff;
  border: none;
  border-radius: 20px;
  font-size: 14px;
  cursor: pointer;
}

/* ── 구역 섹션 ── */
.zone-section {
  margin-bottom: 28px;
}

.zone-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 2px solid var(--border-color, #e8f5e9);
}

.zone-icon {
  font-size: 16px;
}

.zone-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary, #222);
}

.zone-batch-count {
  font-size: 12px;
  color: var(--text-secondary, #888);
  background: var(--input-bg, #f5f5f5);
  padding: 2px 8px;
  border-radius: 10px;
}

.btn-zone-add {
  margin-left: auto;
  padding: 4px 12px;
  background: none;
  border: 1px solid var(--primary-color, #4caf50);
  color: var(--primary-color, #4caf50);
  border-radius: 14px;
  font-size: 12px;
  cursor: pointer;
}

.btn-zone-add:hover {
  background: var(--primary-color, #4caf50);
  color: #fff;
}

/* ── 배치 카드 ── */
.batch-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
}

.batch-card {
  background: var(--card-bg, #fff);
  border-radius: 12px;
  padding: 16px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.batch-card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 8px;
}

.crop-name {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary, #222);
}

.seedling-tag {
  font-size: 11px;
  padding: 2px 8px;
  background: #e8f5e9;
  color: #2e7d32;
  border-radius: 10px;
  margin-left: 8px;
}

.sowing-date {
  font-size: 12px;
  color: var(--text-secondary, #888);
  margin-bottom: 12px;
}

.btn-delete {
  background: none;
  border: none;
  color: var(--text-secondary, #aaa);
  font-size: 14px;
  cursor: pointer;
  padding: 2px 4px;
}
</style>
