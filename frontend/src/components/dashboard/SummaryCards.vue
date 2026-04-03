<template>
  <div class="dashboard-summary">
    <div class="summary-row">
      <div :class="['summary-item', !isFarmUser && 'summary-item-link']" @click="navigateTo('/devices', true)">
        <div class="summary-icon equip">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
        </div>
        <div class="summary-text">
          <span class="summary-number">{{ actuatorCount + sensorCount }}</span>
          <span class="summary-label">전체 장치</span>
        </div>
      </div>

      <div class="summary-item summary-item-link" @click="navigateTo('/groups', false)">
        <div class="summary-icon group">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        </div>
        <div class="summary-text">
          <span class="summary-number">{{ groupCount }}</span>
          <span class="summary-label">활성 그룹</span>
        </div>
      </div>

      <div :class="['summary-item', !isFarmUser && 'summary-item-link']" @click="navigateTo('/automation', true)">
        <div class="summary-icon auto">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        </div>
        <div class="summary-text">
          <span class="summary-number">{{ ruleActive }} / {{ ruleCount }}</span>
          <span class="summary-label">자동화 룰</span>
        </div>
      </div>

      <div :class="['summary-item', !isFarmUser && 'summary-item-link']" @click="navigateTo('/devices', true)">
        <div class="summary-icon online">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        </div>
        <div class="summary-text">
          <span class="summary-number">{{ onlineTotal }}</span>
          <span class="summary-label">온라인 기기</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
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
const sensorCount = computed(() => deviceStore.sensorDevices.length)
const actuatorCount = computed(() => deviceStore.actuatorDevices.length)
const groupCount = computed(() => groupStore.groups.length)
const ruleCount = computed(() => automationStore.rules.length)
const ruleActive = computed(() => automationStore.rules.filter(r => r.enabled).length)
const onlineTotal = computed(() => deviceStore.onlineDevices.length)

function navigateTo(route: string, denyFarmUser: boolean) {
  if (denyFarmUser && isFarmUser.value) return
  router.push(route)
}

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
}

.summary-item-link {
  cursor: pointer;
  transition: background 0.15s, transform 0.15s;
}
.summary-item-link:hover {
  background: var(--bg-hover);
  transform: translateY(-1px);
}
.summary-item-link:active { transform: translateY(0); }

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
    gap: 12px;
  }
  .summary-item { padding: 14px 16px; }
  .summary-number { font-size: calc(20px * var(--content-scale, 1)); }
}
</style>
