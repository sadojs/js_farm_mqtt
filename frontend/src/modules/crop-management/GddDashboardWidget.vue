<template>
  <div class="gdd-dashboard-widget">
    <div class="widget-header">
      <h3>🌱 생육 현황</h3>
      <router-link to="/crop-management" class="widget-link">전체 보기 →</router-link>
    </div>

    <div v-if="loading" class="widget-loading">불러오는 중...</div>

    <div v-else-if="items.length === 0" class="widget-empty">
      <p>아직 파종 정보가 없습니다.</p>
      <router-link to="/crop-management" class="btn-cta">🌱 파종 정보 입력</router-link>
    </div>

    <div v-else>
      <!-- 배치 선택 탭 (여러 배치 있을 때) -->
      <div v-if="items.length > 1" class="batch-tabs">
        <button
          v-for="(item, i) in items"
          :key="item.batchId"
          class="batch-tab"
          :class="{ active: selectedIdx === i }"
          @click="selectedIdx = i"
        >
          <span v-if="item.groupName" class="tab-group">{{ item.groupName }}</span>
          {{ cropLabel(item.cropType) }}
        </button>
      </div>

      <!-- 선택된 배치 타임라인 -->
      <template v-if="selected">
        <div class="batch-meta">
          <div class="batch-meta-left">
            <span v-if="selected.groupName" class="group-chip">🏠 {{ selected.groupName }}</span>
            <span class="crop-name">{{ cropLabel(selected.cropType) }}</span>
          </div>
          <span class="source-badge" :style="{ color: selected.gdd.sourceBadge.color }">
            {{ selected.gdd.sourceBadge.emoji }} {{ selected.gdd.sourceBadge.label }}
          </span>
        </div>

        <!-- 간이 타임라인 바 -->
        <div class="mini-timeline">
          <div class="mini-bar-wrap">
            <div class="mini-bar">
              <!-- 완료 구간 -->
              <div class="mini-fill" :style="{ width: progressPct + '%' }" />
              <!-- 마일스톤 눈금 -->
              <div
                v-for="m in selected.milestones"
                :key="m.gddThreshold"
                class="mini-tick"
                :class="{ done: m.status === 'done', imminent: m.status === 'imminent' }"
                :style="{ left: (m.gddThreshold / selected.gdd.targetGdd * 100) + '%' }"
                :title="m.title"
              />
              <!-- 현재 위치 표시 -->
              <div class="mini-now" :style="{ left: progressPct + '%' }" title="오늘">
                <div class="mini-now-dot" />
              </div>
            </div>
            <div class="mini-bar-labels">
              <span>파종</span>
              <span>수확 {{ selected.gdd.targetGdd }}°C</span>
            </div>
          </div>
        </div>

        <!-- 주요 이벤트 -->
        <div class="event-list">
          <!-- 현재 단계 -->
          <div class="event-item current">
            <span class="ev-dot now" />
            <span class="ev-label">
              {{ selected.gdd.stage.emoji }} {{ selected.gdd.stage.label }}
              <span class="ev-gdd">{{ selected.gdd.currentGdd.toFixed(0) }}°C 누적</span>
            </span>
          </div>
          <!-- 다음 마일스톤 목록 (최대 3개) -->
          <div
            v-for="(m, i) in upcomingMilestones"
            :key="m.gddThreshold"
            class="event-item next"
            :class="{ imminent: m.status === 'imminent' }"
          >
            <span class="ev-dot" :class="i === 0 ? 'next-first' : 'next-later'" />
            <div class="ev-content">
              <span class="ev-label">{{ m.title }}</span>
              <div class="ev-meta">
                <span class="ev-gdd">잔여 {{ Math.max(0, m.gddThreshold - selected.gdd.currentGdd).toFixed(0) }}°C</span>
                <span v-if="m.estimatedDate" class="ev-date">예상 {{ formatDate(m.estimatedDate) }}</span>
              </div>
            </div>
          </div>
          <div v-if="upcomingMilestones.length === 0" class="event-item done-all">
            <span class="ev-dot done" />
            <span class="ev-label">모든 주요 일정 완료 🎉</span>
          </div>
        </div>

        <p class="schedule-note">※ 예상 날짜는 현재 기온 추이 기반으로 실제와 다를 수 있습니다.</p>

        <router-link
          :to="'/crop-management'"
          class="btn-detail"
        >전체 타임라인 보기</router-link>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { cropManagementApi } from './api/crop-management.api'
import { CROP_LABELS } from './types/crop-management.types'
import type { CropType, DashboardItem, MilestoneItem } from './types/crop-management.types'

interface DashboardItemWithMilestones extends DashboardItem {
  milestones: MilestoneItem[]
}

const items = ref<DashboardItemWithMilestones[]>([])
const loading = ref(true)
const selectedIdx = ref(0)

const selected = computed(() => items.value[selectedIdx.value] ?? null)

const progressPct = computed(() => {
  if (!selected.value) return 0
  return Math.min(Math.round((selected.value.gdd.currentGdd / selected.value.gdd.targetGdd) * 100), 100)
})

const upcomingMilestones = computed((): MilestoneItem[] => {
  if (!selected.value) return []
  return selected.value.milestones.filter(m => m.status !== 'done').slice(0, 3)
})

onMounted(async () => {
  loading.value = true
  try {
    const dashboard = await cropManagementApi.getDashboard()
    // 마일스톤도 함께 로드
    const enriched = await Promise.all(
      dashboard.map(async (d) => {
        try {
          const { milestones } = await cropManagementApi.getMilestones(d.batchId)
          return { ...d, milestones }
        } catch {
          return { ...d, milestones: [] }
        }
      })
    )
    items.value = enriched
  } catch {
    items.value = []
  } finally {
    loading.value = false
  }
})

function cropLabel(type: string) {
  return CROP_LABELS[type as CropType] ?? type
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr)
  return `${d.getMonth() + 1}/${d.getDate()}`
}
</script>

<style scoped>
.gdd-dashboard-widget {
  background: var(--card-bg, #fff);
  border-radius: 12px;
  padding: 16px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.widget-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 14px;
}

.widget-header h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.widget-link {
  font-size: 12px;
  color: var(--primary-color, #4caf50);
  text-decoration: none;
}

.widget-loading, .widget-empty {
  text-align: center;
  padding: 20px 0;
  color: var(--text-secondary, #888);
  font-size: 14px;
}

.btn-cta {
  display: inline-block;
  margin-top: 8px;
  padding: 8px 16px;
  background: var(--primary-color, #4caf50);
  color: #fff;
  border-radius: 20px;
  text-decoration: none;
  font-size: 13px;
}

.batch-tabs {
  display: flex;
  gap: 6px;
  margin-bottom: 12px;
  overflow-x: auto;
}

.batch-tab {
  padding: 4px 12px;
  border: 1px solid var(--border-color, #ddd);
  border-radius: 16px;
  font-size: 12px;
  background: none;
  cursor: pointer;
  white-space: nowrap;
  color: var(--text-secondary, #666);
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
}

.tab-group {
  font-size: 10px;
  color: var(--text-secondary, #aaa);
  line-height: 1;
}

.batch-tab.active {
  background: var(--primary-color, #4caf50);
  color: #fff;
  border-color: var(--primary-color, #4caf50);
}

.batch-meta {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 12px;
  gap: 8px;
}

.batch-meta-left {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.group-chip {
  font-size: 11px;
  color: var(--text-secondary, #666);
}

.crop-name {
  font-weight: 600;
  font-size: 14px;
}

.source-badge {
  font-size: 11px;
}

/* ── 간이 타임라인 바 ── */
.mini-timeline {
  margin-bottom: 14px;
}

.mini-bar-wrap {
  position: relative;
}

.mini-bar {
  position: relative;
  height: 12px;
  background: var(--border-color, #e8e8e8);
  border-radius: 6px;
  overflow: visible;
  margin-bottom: 4px;
}

.mini-fill {
  height: 100%;
  background: linear-gradient(90deg, #a5d6a7, #4caf50);
  border-radius: 6px;
  position: relative;
}

.mini-tick {
  position: absolute;
  top: -2px;
  width: 3px;
  height: 16px;
  border-radius: 2px;
  background: #bdbdbd;
  transform: translateX(-50%);
  z-index: 1;
}

.mini-tick.done {
  background: #388e3c;
}

.mini-tick.imminent {
  background: #ff9800;
}

.mini-now {
  position: absolute;
  top: -4px;
  transform: translateX(-50%);
  z-index: 2;
}

.mini-now-dot {
  width: 20px;
  height: 20px;
  background: #ff9800;
  border: 3px solid #fff;
  border-radius: 50%;
  box-shadow: 0 0 0 2px rgba(255, 152, 0, 0.4);
}

.mini-bar-labels {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  color: var(--text-secondary, #aaa);
}

/* ── 이벤트 목록 ── */
.event-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 14px;
}

.event-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 13px;
}

.ev-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.ev-dot.now {
  background: #ff9800;
  box-shadow: 0 0 0 3px rgba(255, 152, 0, 0.2);
}

.ev-dot.next-first {
  background: #fff;
  border: 2px solid #4caf50;
}

.ev-dot.next-later {
  background: #e0e0e0;
  border: 2px solid #bdbdbd;
}

.ev-dot.done {
  background: #c8e6c9;
  border: 2px solid #81c784;
}

.event-item.imminent .ev-dot.next-first {
  border-color: #ff9800;
  box-shadow: 0 0 0 2px rgba(255, 152, 0, 0.2);
}

.ev-label {
  color: var(--text-primary, #333);
}

.ev-content {
  display: flex;
  flex-direction: column;
  gap: 1px;
  flex: 1;
}

.ev-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ev-gdd {
  font-size: 11px;
  color: var(--text-secondary, #888);
}

.ev-date {
  font-size: 11px;
  font-weight: 600;
  color: var(--primary-color, #4caf50);
}

.event-item.imminent .ev-date {
  color: #e65100;
}

.schedule-note {
  font-size: 10px;
  color: var(--text-secondary, #aaa);
  margin: 0 0 10px;
  line-height: 1.4;
}

.btn-detail {
  display: block;
  text-align: center;
  padding: 8px;
  background: var(--input-bg, #f5f5f5);
  border-radius: 8px;
  font-size: 12px;
  color: var(--primary-color, #4caf50);
  text-decoration: none;
  font-weight: 500;
}

/* 다크모드 */
#app.theme-dark .gdd-dashboard-widget {
  background: var(--card-bg);
}
</style>
