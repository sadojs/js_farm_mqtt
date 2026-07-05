<script setup lang="ts">
import { computed } from 'vue'
import type { OpenerSchedule } from '../../types/emergency-failover.types'

const props = defineProps<{
  openerEnabled: boolean
  openerRainOverride: boolean
  schedule: OpenerSchedule[]
}>()
const emit = defineEmits<{
  (e: 'update:openerEnabled', v: boolean): void
  (e: 'update:openerRainOverride', v: boolean): void
  (e: 'edit-month', month: number): void
}>()

const monthLabels = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월']

const scheduleByMonth = computed(() => {
  const map = new Map<number, OpenerSchedule>()
  for (const s of props.schedule) map.set(s.month, s)
  return map
})
</script>

<template>
  <section class="card">
    <h3>개폐기 백업 스케줄 <span class="backup-badge">온습도계 이상 시</span></h3>
    <p class="hint" style="margin: 0 0 12px;">
      ⓘ 온습도계가 정상일 때는 위 「개폐기 온습도 조건」이 우선합니다.
      온습도계가 동작하지 않을 때(측정값 없음/오래됨)만 아래 월별 시간 스케줄이 백업으로 동작합니다.
    </p>
    <div class="toggle-row">
      <label>
        <input
          type="checkbox"
          :checked="openerEnabled"
          @change="emit('update:openerEnabled', ($event.target as HTMLInputElement).checked)"
        />
        폴백 활성
      </label>
      <label>
        <input
          type="checkbox"
          :checked="openerRainOverride"
          @change="emit('update:openerRainOverride', ($event.target as HTMLInputElement).checked)"
        />
        빗물 센서 override (ACTIVE 시 즉시 CLOSE)
      </label>
    </div>
    <div class="month-grid">
      <button
        v-for="m in 12"
        :key="m"
        class="month-card"
        :class="{
          'inactive': !scheduleByMonth.get(m)?.enabled,
          'always-open': scheduleByMonth.get(m)?.mode === 'always-open' && scheduleByMonth.get(m)?.enabled
        }"
        @click="emit('edit-month', m)"
      >
        <div class="month-label">{{ monthLabels[m - 1] }}</div>
        <div class="month-detail" v-if="scheduleByMonth.get(m)?.enabled">
          <template v-if="scheduleByMonth.get(m)?.mode === 'always-open'">
            24h OPEN
          </template>
          <template v-else>
            {{ scheduleByMonth.get(m)?.openTime?.slice(0,5) }} - {{ scheduleByMonth.get(m)?.closeTime?.slice(0,5) }}
          </template>
        </div>
        <div class="month-detail muted" v-else>＋ 추가</div>
      </button>
    </div>
  </section>
</template>

<style scoped>
.card {
  background: var(--card-bg, #fff); border-radius: 12px;
  padding: 16px 20px; margin-bottom: 16px;
  border: 1px solid var(--border-color, #e5e5e5);
}
.card h3 { margin: 0 0 12px 0; font-size: 16px; display: flex; align-items: center; gap: 8px; }
.backup-badge {
  font-size: 11px; font-weight: 700; color: var(--warning-text, #b45309);
  background: var(--warning-bg, #fff8ec); border: 1px solid var(--warning-border, #fde3b0);
  border-radius: 6px; padding: 2px 8px;
}
.hint {
  background: var(--info-bg, #f0f4f8); padding: 8px 12px; border-radius: 6px;
  font-size: 13px; color: var(--text-secondary, #555); line-height: 1.5;
}
.toggle-row { display: flex; gap: 24px; margin-bottom: 12px; flex-wrap: wrap; }
.toggle-row label { display: flex; align-items: center; gap: 6px; cursor: pointer; }
.month-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; }
.month-card {
  border: 1px solid var(--border-color, #ddd); border-radius: 8px;
  padding: 12px 8px; cursor: pointer; text-align: center;
  background: var(--card-bg, #fff); color: var(--text, #333);
  transition: transform 0.1s, box-shadow 0.1s;
}
.month-card:hover { transform: translateY(-2px); box-shadow: 0 4px 8px rgba(0,0,0,0.06); }
.month-card.inactive { opacity: 0.5; border-style: dashed; }
.month-card.always-open { background: #e8f5e9; border-color: #66bb6a; }
.month-label { font-weight: bold; font-size: 14px; }
.month-detail { font-size: 12px; margin-top: 4px; }
.month-detail.muted { color: var(--text-secondary, #999); }
@media (max-width: 768px) { .month-grid { grid-template-columns: repeat(3, 1fr); } }
</style>
