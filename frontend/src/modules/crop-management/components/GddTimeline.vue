<template>
  <div class="gdd-timeline">
    <div v-if="loading" class="tl-loading">타임라인 불러오는 중...</div>
    <div v-else-if="error" class="tl-error">{{ error }}</div>
    <div v-else-if="timeline" class="tl-body">

      <!-- 헤더: 현재 GDD / 목표 -->
      <div class="tl-header">
        <div class="tl-gdd-now">
          <span class="tl-gdd-val">{{ timeline.currentGdd.toFixed(0) }}°C</span>
          <span class="tl-gdd-label">현재 적산온도</span>
        </div>
        <div class="tl-progress-bar-wrap">
          <div class="tl-progress-bar">
            <div
              class="tl-progress-fill"
              :style="{ width: progressPct + '%' }"
            />
            <!-- 마일스톤 눈금 -->
            <div
              v-for="m in keyMilestones"
              :key="m.gddThreshold"
              class="tl-milestone-tick"
              :class="m.reachedDate ? 'done' : 'upcoming'"
              :style="{ left: (m.gddThreshold / timeline.targetGdd * 100) + '%' }"
              :title="m.title + ' (' + m.gddThreshold + '°C)'"
            />
          </div>
          <div class="tl-bar-labels">
            <span>0</span>
            <span>{{ timeline.targetGdd }}°C</span>
          </div>
        </div>
        <div class="tl-gdd-target">
          <span class="tl-gdd-val">{{ timeline.targetGdd }}°C</span>
          <span class="tl-gdd-label">수확 목표</span>
        </div>
      </div>

      <!-- 수직 타임라인 -->
      <div class="tl-track">
        <div class="tl-line" />

        <!-- 파종일 (시작점) -->
        <div class="tl-event sowing">
          <div class="tl-dot start" />
          <div class="tl-event-content">
            <div class="tl-event-gdd">GDD 0°C</div>
            <div class="tl-event-title">🌱 파종</div>
            <div class="tl-event-date">{{ formatDate(timeline.sowingDate) }}</div>
          </div>
        </div>

        <!-- 완료된 마일스톤 -->
        <template v-for="m in doneMilestones" :key="'done-' + m.gddThreshold">
          <div class="tl-event done">
            <div class="tl-dot done" />
            <div class="tl-event-content">
              <div class="tl-event-gdd">GDD {{ m.gddThreshold }}°C</div>
              <div class="tl-event-title">
                {{ milestoneEmoji(m.milestoneType) }} {{ m.title }}
              </div>
              <div class="tl-event-date">{{ formatDate(m.reachedDate!) }}</div>
            </div>
          </div>
        </template>

        <!-- 현재 위치 -->
        <div class="tl-event current">
          <div class="tl-dot current" />
          <div class="tl-event-content">
            <div class="tl-event-gdd highlight">GDD {{ timeline.currentGdd.toFixed(0) }}°C</div>
            <div class="tl-event-title">📍 오늘 ({{ formatDate(todayStr) }})</div>
            <div class="tl-event-date stage-badge">{{ currentStage.emoji }} {{ currentStage.label }}</div>
          </div>
        </div>

        <!-- 향후 마일스톤 (아직 도달 못한 것) -->
        <template v-for="m in upcomingMilestones" :key="'up-' + m.gddThreshold">
          <div class="tl-event upcoming">
            <div class="tl-dot upcoming" />
            <div class="tl-event-content">
              <div class="tl-event-gdd">GDD {{ m.gddThreshold }}°C</div>
              <div class="tl-event-title">
                {{ milestoneEmoji(m.milestoneType) }} {{ m.title }}
              </div>
              <div class="tl-event-date upcoming-date">
                <template v-if="m.estimatedDate">
                  {{ formatDate(m.estimatedDate) }} 예상
                  <span class="days-hint">(약 {{ daysUntil(m.gddThreshold) }}일 후)</span>
                </template>
                <template v-else>
                  약 {{ daysUntil(m.gddThreshold) }}일 후 예상
                </template>
              </div>
            </div>
          </div>
        </template>

        <!-- 수확 (목표) -->
        <div class="tl-event harvest">
          <div class="tl-dot harvest" />
          <div class="tl-event-content">
            <div class="tl-event-gdd">GDD {{ timeline.targetGdd }}°C</div>
            <div class="tl-event-title">✂️ 예상 수확</div>
            <div class="tl-event-date">{{ formatDate(timeline.estimatedHarvestDate) }}</div>
          </div>
        </div>
      </div>

    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { cropManagementApi } from '../api/crop-management.api'
import { resolveGrowthStage } from '../utils/growth-stage'
import type { GddTimeline, TimelineMilestone } from '../types/crop-management.types'

const props = defineProps<{ batchId: string }>()

const timeline = ref<GddTimeline | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)

const todayStr = new Date().toISOString().split('T')[0]

onMounted(async () => {
  try {
    timeline.value = await cropManagementApi.getTimeline(props.batchId)
  } catch {
    error.value = '타임라인 데이터를 불러올 수 없습니다.'
  } finally {
    loading.value = false
  }
})

const progressPct = computed(() => {
  if (!timeline.value) return 0
  return Math.min(Math.round((timeline.value.currentGdd / timeline.value.targetGdd) * 100), 100)
})

const currentStage = computed(() => {
  if (!timeline.value) return { emoji: '🌱', label: '파종' }
  return resolveGrowthStage(timeline.value.currentGdd)
})

// 우선순위 높은 마일스톤만 표시 (stage + pest_control + fertilizer 중 high)
const keyMilestones = computed<TimelineMilestone[]>(() => {
  return timeline.value?.milestones ?? []
})

const doneMilestones = computed<TimelineMilestone[]>(() =>
  (timeline.value?.milestones ?? []).filter(m => m.reachedDate !== null)
)

const upcomingMilestones = computed<TimelineMilestone[]>(() =>
  (timeline.value?.milestones ?? []).filter(m => m.reachedDate === null)
)

function formatDate(dateStr: string | null) {
  if (!dateStr) return '-'
  const d = new Date(dateStr)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

function milestoneEmoji(type: string) {
  const map: Record<string, string> = {
    stage: '📍', pest_control: '🔴', fertilizer: '🌿', pruning: '✂️',
  }
  return map[type] ?? '📌'
}

// 작물별 최소 일일 GDD (봄철 초기 데이터 부족 시 과도한 예측 방지)
const CROP_MIN_DAILY: Record<string, number> = {
  tomato: 5, cherry_tomato: 5, cucumber: 5, strawberry: 2, paprika: 5,
}

function daysUntil(targetGdd: number): number {
  if (!timeline.value) return 0
  const remaining = Math.max(targetGdd - timeline.value.currentGdd, 0)
  const minDaily = CROP_MIN_DAILY[timeline.value.cropType ?? ''] ?? 5
  const rawAvg = timeline.value.dailyPoints.length > 0
    ? timeline.value.currentGdd / timeline.value.dailyPoints.length
    : minDaily
  const avg = Math.max(rawAvg, minDaily)
  return Math.round(remaining / avg)
}
</script>

<style scoped>
.gdd-timeline {
  padding: 4px 0;
}

.tl-loading, .tl-error {
  padding: 16px 0;
  color: var(--text-secondary, #888);
  font-size: 13px;
  text-align: center;
}

/* ─── 헤더 프로그레스 ─── */
.tl-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
}

.tl-gdd-now, .tl-gdd-target {
  flex-shrink: 0;
  text-align: center;
}

.tl-gdd-val {
  display: block;
  font-size: 15px;
  font-weight: 700;
  color: var(--primary-color, #4caf50);
}

.tl-gdd-label {
  display: block;
  font-size: 10px;
  color: var(--text-secondary, #888);
}

.tl-progress-bar-wrap {
  flex: 1;
}

.tl-progress-bar {
  position: relative;
  height: 10px;
  background: var(--border-color, #e0e0e0);
  border-radius: 5px;
  overflow: visible;
  margin-bottom: 4px;
}

.tl-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #81c784, #4caf50);
  border-radius: 5px;
  transition: width 0.5s ease;
}

.tl-milestone-tick {
  position: absolute;
  top: -3px;
  width: 3px;
  height: 16px;
  border-radius: 2px;
  transform: translateX(-50%);
}

.tl-milestone-tick.done {
  background: #4caf50;
}

.tl-milestone-tick.upcoming {
  background: #bdbdbd;
}

.tl-bar-labels {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  color: var(--text-secondary, #aaa);
}

/* ─── 수직 타임라인 ─── */
.tl-track {
  position: relative;
  padding-left: 28px;
}

.tl-line {
  position: absolute;
  left: 8px;
  top: 12px;
  bottom: 12px;
  width: 2px;
  background: linear-gradient(180deg, #4caf50 0%, #e0e0e0 60%, #e0e0e0 100%);
}

.tl-event {
  position: relative;
  display: flex;
  gap: 12px;
  padding-bottom: 20px;
  align-items: flex-start;
}

.tl-dot {
  position: absolute;
  left: -24px;
  top: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  flex-shrink: 0;
  border: 2px solid #fff;
}

.tl-dot.start {
  background: #4caf50;
  box-shadow: 0 0 0 2px #4caf50;
}

.tl-dot.done {
  background: #4caf50;
}

.tl-dot.current {
  background: #ff9800;
  box-shadow: 0 0 0 3px rgba(255, 152, 0, 0.3);
  width: 18px;
  height: 18px;
  left: -25px;
}

.tl-dot.upcoming {
  background: #e0e0e0;
  border-color: #bdbdbd;
}

.tl-dot.harvest {
  background: #f44336;
  box-shadow: 0 0 0 2px rgba(244, 67, 54, 0.3);
}

.tl-event-content {
  flex: 1;
}

.tl-event-gdd {
  font-size: 11px;
  color: var(--text-secondary, #888);
  margin-bottom: 2px;
}

.tl-event-gdd.highlight {
  color: #ff9800;
  font-weight: 600;
}

.tl-event-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary, #222);
  margin-bottom: 2px;
}

.tl-event-date {
  font-size: 12px;
  color: var(--text-secondary, #888);
}

.stage-badge {
  display: inline-block;
  padding: 2px 8px;
  background: rgba(255, 152, 0, 0.12);
  color: #e65100;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 500;
}

.upcoming-date {
  color: #757575;
  font-style: italic;
}

.days-hint {
  font-size: 11px;
  color: #9e9e9e;
  margin-left: 4px;
}

.tl-event.done .tl-event-title,
.tl-event.sowing .tl-event-title {
  color: #388e3c;
}

.tl-event.upcoming .tl-event-title {
  color: var(--text-secondary, #666);
}

.tl-event.harvest .tl-event-title {
  color: #c62828;
}

/* 다크모드 */
#app.theme-dark .tl-dot {
  border-color: var(--card-bg);
}
</style>
