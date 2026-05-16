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
          <span class="summary-number">{{ card.value }}</span>
          <span class="summary-label">{{ card.label }}</span>
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

const IconDevice: Component = { render: () => h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2' }, [h('path', { d: 'M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9' }), h('path', { d: 'M13.73 21a2 2 0 0 1-3.46 0' })]) }
const IconGroup: Component = { render: () => h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2' }, [h('path', { d: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2' }), h('circle', { cx: '9', cy: '7', r: '4' }), h('path', { d: 'M23 21v-2a4 4 0 0 0-3-3.87' }), h('path', { d: 'M16 3.13a4 4 0 0 1 0 7.75' })]) }
const IconAuto: Component = { render: () => h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2' }, [h('circle', { cx: '12', cy: '12', r: '3' }), h('path', { d: 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z' })]) }
const IconOnline: Component = { render: () => h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2' }, [h('path', { d: 'M22 11.08V12a10 10 0 1 1-5.93-9.14' }), h('polyline', { points: '22 4 12 14.01 9 11.01' })]) }
const IconSensor: Component = { render: () => h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2' }, [h('path', { d: 'M12 2L2 7l10 5 10-5-10-5z' }), h('path', { d: 'M2 17l10 5 10-5' }), h('path', { d: 'M2 12l10 5 10-5' })]) }

const sensorCount = computed(() => deviceStore.sensorDevices.length)
const actuatorCount = computed(() => deviceStore.actuatorDevices.length)
const groupCount = computed(() => groupStore.groups.length)
const ruleCount = computed(() => automationStore.rules.length)
const ruleActive = computed(() => automationStore.rules.filter(r => r.enabled).length)
const onlineTotal = computed(() => deviceStore.onlineDevices.length)

interface CardDef {
  value: string
  label: string
  iconClass: string
  iconComponent: Component
  route: string
  linkable: boolean
}

const visibleCards = computed<CardDef[]>(() => {
  if (isFarmUser.value) {
    return [
      { value: String(groupCount.value), label: '활성 구역', iconClass: 'group', iconComponent: IconGroup, route: '/groups', linkable: true },
      { value: String(sensorCount.value), label: '농장 환경', iconClass: 'sensor', iconComponent: IconSensor, route: '/sensors', linkable: true },
      { value: String(actuatorCount.value + sensorCount.value), label: '전체 장치', iconClass: 'equip', iconComponent: IconDevice, route: '', linkable: false },
      { value: String(onlineTotal.value), label: '온라인 기기', iconClass: 'online', iconComponent: IconOnline, route: '', linkable: false },
    ]
  }
  return [
    { value: String(actuatorCount.value + sensorCount.value), label: '전체 장치', iconClass: 'equip', iconComponent: IconDevice, route: '/gateways', linkable: true },
    { value: String(groupCount.value), label: '활성 구역', iconClass: 'group', iconComponent: IconGroup, route: '/groups', linkable: true },
    { value: `${ruleActive.value} / ${ruleCount.value}`, label: '자동 제어 설정', iconClass: 'auto', iconComponent: IconAuto, route: '/automation', linkable: true },
    { value: String(onlineTotal.value), label: '온라인 기기', iconClass: 'online', iconComponent: IconOnline, route: '/gateways', linkable: true },
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
  margin-bottom: 20px;
}

.summary-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
}

.summary-item {
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: 14px;
  padding: 18px 20px;
  box-shadow: var(--shadow-card);
  display: flex;
  align-items: center;
  gap: 14px;
  opacity: 0.6;
  position: relative;
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
}

.summary-number {
  font-size: calc(24px * var(--content-scale, 1));
  font-weight: 700;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
}

.summary-label {
  font-size: calc(14px * var(--content-scale, 1));
  color: var(--text-muted);
  margin-top: 2px;
}

@media (max-width: 768px) {
  .summary-row {
    grid-template-columns: repeat(2, 1fr);
    gap: 10px;
  }

  .dashboard-summary {
    margin-bottom: 12px;
  }

  .summary-row {
    margin-bottom: 0;
  }

  .summary-item {
    padding: 10px 10px;
    gap: 10px;
    border-radius: 12px;
  }

  .summary-icon {
    width: 38px;
    height: 38px;
  }

  .summary-icon svg {
    width: 18px;
    height: 18px;
  }

  .summary-label {
    white-space: nowrap;
  }

  .summary-number {
    font-size: calc(20px * var(--content-scale, 1));
  }

  .summary-arrow {
    font-size: calc(16px * var(--content-scale, 1));
  }
}
</style>
