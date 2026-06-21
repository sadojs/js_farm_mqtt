<template>
  <div class="dashboard-summary">
    <div class="summary-row">
      <div
        v-for="(card, i) in visibleCards"
        :key="i"
        :class="['summary-item', card.linkable && 'summary-item-link']"
        @click="card.linkable && router.push(card.route)"
      >
        <div :class="['summary-icon', card.iconClass]">
          <component :is="card.iconComponent" />
        </div>
        <div class="summary-text">
          <span class="summary-label">{{ card.label }}</span>
          <span class="summary-value-line">
            <span class="summary-number">{{ card.value }}</span>
            <span v-if="card.sublabel" class="summary-sublabel">{{ card.sublabel }}</span>
          </span>
        </div>
        <span v-if="card.linkable" class="summary-arrow">›</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, h, type Component } from 'vue'
import { useRouter } from 'vue-router'
import { useDeviceStore } from '../../stores/device.store'
import { useGroupStore } from '../../stores/group.store'
import { useAutomationStore } from '../../stores/automation.store'
import { useAuthStore } from '../../stores/auth.store'

const router = useRouter()
const deviceStore = useDeviceStore()
const groupStore = useGroupStore()
const automationStore = useAutomationStore()
const authStore = useAuthStore()

const isFarmUser = computed(() => authStore.isFarmUser)

const IconGroup: Component = { render: () => h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2' }, [h('path', { d: 'M3 9.5L12 3l9 6.5V21H3z' }), h('path', { d: 'M9 21V12h6v9' })]) }
const IconAuto: Component = { render: () => h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2' }, [h('circle', { cx: '12', cy: '12', r: '3' }), h('path', { d: 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z' })]) }
const IconSensor: Component = { render: () => h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2' }, [h('path', { d: 'M12 2L2 7l10 5 10-5-10-5z' }), h('path', { d: 'M2 17l10 5 10-5' }), h('path', { d: 'M2 12l10 5 10-5' })]) }

const sensorCount = computed(() => deviceStore.sensorDevices.length)
const groupCount = computed(() => groupStore.iotGroups.length)
const ruleCount = computed(() => automationStore.rules.length)
const ruleActive = computed(() => automationStore.rules.filter(r => r.enabled).length)

interface CardDef {
  value: string
  label: string
  sublabel?: string
  iconClass: string
  iconComponent: Component
  route: string
  linkable: boolean
}

const visibleCards = computed<CardDef[]>(() => {
  // 통일 정책: 활성 구역 + 자동 제어 (또는 farm_user의 농장 환경) 2개만 노출
  // 전체 장치 / 온라인 기기는 측정기 현황 + 가동 중인 장치 카드가 이미 보여주므로 중복
  if (isFarmUser.value) {
    return [
      { value: String(groupCount.value), label: '활성 구역', sublabel: '개 하우스', iconClass: 'group', iconComponent: IconGroup, route: '/groups', linkable: true },
      { value: String(sensorCount.value), label: '농장 환경', sublabel: '개 측정기', iconClass: 'sensor', iconComponent: IconSensor, route: '/sensors', linkable: true },
    ]
  }
  return [
    { value: String(groupCount.value), label: '활성 구역', sublabel: '개 하우스', iconClass: 'group', iconComponent: IconGroup, route: '/groups', linkable: true },
    { value: `${ruleActive.value} / ${ruleCount.value}`, label: '자동 제어', sublabel: '규칙 켜짐', iconClass: 'auto', iconComponent: IconAuto, route: '/automation', linkable: true },
  ]
})

onMounted(async () => {
  const promises: Promise<any>[] = []
  if (deviceStore.devices.length === 0) promises.push(deviceStore.fetchDevices())
  if (groupStore.groups.length === 0) promises.push(groupStore.fetchGroups())
  if (automationStore.rules.length === 0) promises.push(automationStore.fetchRules())
  await Promise.all(promises)
})
</script>

<style scoped>
.dashboard-summary {
  /* 부모(.hero-row)가 margin 관리 — 자체 margin 제거 */
  margin-bottom: 0;
  height: 100%;
}

.summary-row {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
}

.summary-item {
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: 14px;
  padding: 16px 18px;
  box-shadow: var(--shadow-card);
  display: flex;
  align-items: center;
  gap: 14px;
  opacity: 0.6;
  position: relative;
  flex: 1;
  min-height: 0;
}

.summary-item-link {
  opacity: 1;
  cursor: pointer;
  border-color: var(--accent);
  box-shadow: var(--shadow-card), 0 0 0 1px var(--accent);
  transition: background 0.15s, transform 0.15s, box-shadow 0.15s;
}

.summary-item-link:hover {
  background: var(--bg-hover);
  transform: translateY(-2px);
  box-shadow: var(--shadow-card-hover, 0 4px 16px rgba(0, 0, 0, 0.12)), 0 0 0 1px var(--accent);
}

.summary-item-link:active {
  transform: translateY(0);
}

.summary-arrow {
  font-size: calc(24px * var(--content-scale, 1));
  color: var(--accent);
  font-weight: 300;
  margin-left: auto;
  flex-shrink: 0;
  opacity: 0.6;
}

.summary-item-link:hover .summary-arrow {
  opacity: 1;
}

.summary-icon {
  width: 44px;
  height: 44px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.summary-icon svg {
  width: 22px;
  height: 22px;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.summary-icon.equip  { background: var(--accent-bg); color: var(--accent); }
.summary-icon.group  { background: var(--bg-info-banner); color: var(--text-info-banner); }
.summary-icon.auto   { background: var(--automation-bg); color: var(--automation-text); }
.summary-icon.online { background: var(--accent-bg); color: var(--accent); }
.summary-icon.sensor { background: #e8f5e9; color: #2e7d32; }

.summary-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-width: 0;
}

.summary-value-line {
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.summary-number {
  font-size: calc(28px * var(--content-scale, 1));
  font-weight: 700;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.summary-sublabel {
  font-size: calc(13px * var(--content-scale, 1));
  color: var(--text-muted);
  font-weight: 500;
}

.summary-label {
  font-size: calc(14px * var(--content-scale, 1));
  color: var(--text-secondary);
  font-weight: 600;
}

@media (max-width: 768px) {
  /* 모바일: 가로 2열 (2개 카드를 나란히) */
  .summary-row {
    flex-direction: row;
    gap: 10px;
    height: auto;
  }

  .summary-item {
    padding: 12px 12px;
    gap: 10px;
    border-radius: 12px;
    flex: 1 1 0;
  }

  .summary-icon {
    width: 38px;
    height: 38px;
  }

  .summary-icon svg {
    width: 18px;
    height: 18px;
  }

  .summary-label { white-space: nowrap; font-size: calc(13px * var(--content-scale, 1)); }
  .summary-sublabel { font-size: calc(11px * var(--content-scale, 1)); }
  .summary-number { font-size: calc(22px * var(--content-scale, 1)); }
  .summary-arrow { font-size: calc(16px * var(--content-scale, 1)); }
}
</style>
