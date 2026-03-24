<template>
  <div class="page-container">
    <header class="page-header">
      <div>
        <h2>자동화 룰</h2>
        <p class="page-description">센서 값에 따라 장비를 자동으로 제어합니다</p>
      </div>
      <button class="btn-primary" @click="openWizard()">+ 룰 추가</button>
    </header>

    <div class="automation-tabs">
      <button class="tab" :class="{ active: activeTab === 'all' }" @click="activeTab = 'all'">전체 ({{ rules.length }})</button>
      <button v-if="SHOW_OPENER_TAB" class="tab" :class="{ active: activeTab === 'opener' }" @click="activeTab = 'opener'">개폐기 ({{ openerRules.length }})</button>
      <button class="tab" :class="{ active: activeTab === 'fan' }" @click="activeTab = 'fan'">환풍기 ({{ fanRules.length }})</button>
      <button class="tab" :class="{ active: activeTab === 'irrigation' }" @click="activeTab = 'irrigation'">관수 ({{ irrigationRules.length }})</button>
      <button class="tab" :class="{ active: activeTab === 'other' }" @click="activeTab = 'other'">기타 ({{ otherRules.length }})</button>
    </div>

    <!-- 로딩 -->
    <div v-if="loading" class="loading-state">룰 목록을 불러오는 중...</div>

    <!-- 빈 상태 -->
    <div v-else-if="filteredRules.length === 0" class="empty-state">
      <p>등록된 자동화 룰이 없습니다.</p>
      <button class="btn-primary" @click="openWizard()">첫 번째 룰 만들기</button>
    </div>

    <!-- 룰 목록 -->
    <div v-else class="rules-grid">
      <div
        v-for="rule in filteredRules"
        :key="rule.id"
        class="rule-card"
        @click="openWizard(rule)"
      >
        <!-- 카드 헤더 -->
        <div class="rule-header">
          <h3 class="rule-name">{{ rule.name }}</h3>
          <div class="rule-header-right">
            <span :class="['active-badge', rule.enabled ? 'enabled' : 'disabled']">
              {{ rule.enabled ? '활성' : '비활성' }}
            </span>
            <button class="btn-icon-sm" @click.stop="handleDelete(rule)" aria-label="삭제">🗑</button>
          </div>
        </div>

        <!-- 대상 -->
        <div class="rule-target">
          <span class="target-text">{{ targetLabel(rule) }}</span>
          <span class="rule-type-badge">{{ ruleTypeLabel(rule) }}</span>
        </div>

        <!-- 관수 룰: 스케줄 정보 -->
        <template v-if="isIrrigationConditions(rule.conditions)">
          <div class="rule-body irrigation-body">
            <div class="irrigation-schedule-row">
              <span class="section-title">스케줄</span>
              <span class="section-content">{{ formatIrrigationSchedule(rule.conditions) }}</span>
            </div>
            <div class="irrigation-schedule-row">
              <span class="section-title">구역</span>
              <span class="section-content">{{ formatIrrigationZones(rule.conditions) }}</span>
            </div>
          </div>
        </template>

        <!-- 일반 룰: 조건 / 동작 2단 -->
        <template v-else>
          <div class="rule-body">
            <div class="rule-section condition">
              <span class="section-title">조건</span>
              <span class="section-content">{{ formatConditionGroup(rule.conditions) }}</span>
            </div>
            <div class="rule-section action">
              <span class="section-title">동작</span>
              <span class="section-content">{{ formatAction(rule.actions) }}</span>
            </div>
          </div>
        </template>

        <!-- 장비 목록 -->
        <div v-if="getRuleDeviceNames(rule).length > 0" class="rule-devices">
          <span class="device-label">대상 장비:</span>
          <span class="device-names">{{ getRuleDeviceNames(rule).join(', ') }}</span>
        </div>

        <!-- 카드 하단 -->
        <div class="rule-footer">
          <span class="priority-badge">우선순위 {{ rule.priority }}</span>
          <label class="toggle-switch" @click.stop>
            <input type="checkbox" :checked="rule.enabled" @change="handleToggle(rule.id)" />
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div>
    </div>

    <!-- 위저드 모달 -->
    <RuleWizardModal
      :visible="wizardOpen"
      :editRule="editingRule"
      @close="wizardOpen = false"
      @saved="onRuleSaved"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useAutomationStore } from '../stores/automation.store'
import { useGroupStore } from '../stores/group.store'
import { useDeviceStore } from '../stores/device.store'
import { formatAction, formatConditionGroup, isIrrigationConditions, formatIrrigationSchedule, formatIrrigationZones } from '../utils/automation-helpers'
import { useConfirm } from '../composables/useConfirm'
import { useNotificationStore } from '../stores/notification.store'
import type { AutomationRule } from '../types/automation.types'
import RuleWizardModal from '../components/automation/RuleWizardModal.vue'

const automationStore = useAutomationStore()
const groupStore = useGroupStore()
const deviceStore = useDeviceStore()
const notify = useNotificationStore()
const { confirm } = useConfirm()

type RuleKind = 'opener' | 'fan' | 'irrigation' | 'other'
type TabType = 'all' | RuleKind
// 개폐기 탭 표시 여부 (당분간 미사용, 필요 시 true로 변경)
const SHOW_OPENER_TAB = false
const activeTab = ref<TabType>('all')
const wizardOpen = ref(false)
const editingRule = ref<AutomationRule | null>(null)

const rules = computed(() => automationStore.rules)
const loading = computed(() => automationStore.loading)

function getRuleDeviceNames(rule: AutomationRule): string[] {
  const actions = rule.actions as any
  const deviceIds: string[] = actions?.targetDeviceIds || []
  if (deviceIds.length === 0) return []
  const group = groupStore.groups.find(g => g.id === rule.groupId)
  if (!group) return []
  return deviceIds
    .map(id => group.devices?.find(d => d.id === id))
    .filter(Boolean)
    .map(d => d!.name)
}

function detectRuleKind(rule: AutomationRule): RuleKind {
  const actions = rule.actions as any
  const deviceIds: string[] = actions?.targetDeviceIds || []
  if (deviceIds.length === 0) return 'other'

  function toRuleKind(et: string | undefined): RuleKind | null {
    if (!et || et === 'other') return null
    if (et === 'opener_open' || et === 'opener_close') return 'opener'
    if (et === 'fan' || et === 'irrigation') return et
    return null
  }

  for (const id of deviceIds) {
    const device = deviceStore.devices.find(d => d.id === id)
    const kind = toRuleKind(device?.equipmentType)
    if (kind) return kind
  }

  const group = groupStore.groups.find(g => g.id === rule.groupId)
  if (group) {
    for (const id of deviceIds) {
      const device = group.devices?.find(d => d.id === id)
      const kind = toRuleKind(device?.equipmentType)
      if (kind) return kind
    }
  }

  return 'other'
}

const openerRules = computed(() => rules.value.filter(r => detectRuleKind(r) === 'opener'))
const fanRules = computed(() => rules.value.filter(r => detectRuleKind(r) === 'fan'))
const irrigationRules = computed(() => rules.value.filter(r => detectRuleKind(r) === 'irrigation'))
const otherRules = computed(() => rules.value.filter(r => detectRuleKind(r) === 'other'))

const filteredRules = computed(() => {
  if (activeTab.value === 'all') return rules.value
  if (activeTab.value === 'opener') return openerRules.value
  if (activeTab.value === 'fan') return fanRules.value
  if (activeTab.value === 'irrigation') return irrigationRules.value
  return otherRules.value
})

const EQUIPMENT_LABELS: Record<RuleKind, string> = {
  opener: '개폐기',
  fan: '환풍기',
  irrigation: '관수',
  other: '기타',
}

function ruleTypeLabel(rule: AutomationRule) {
  return EQUIPMENT_LABELS[detectRuleKind(rule)]
}

function targetLabel(rule: AutomationRule) {
  const group = groupStore.groups.find(g => g.id === rule.groupId)
  if (!group) return '미지정'
  if (!rule.houseId) return `${group.name} (그룹 전체)`
  const house = (group.houses || []).find(h => h.id === rule.houseId)
  return house ? `${group.name} > ${house.name}` : `${group.name} (하우스 미지정)`
}

function openWizard(rule?: AutomationRule) {
  editingRule.value = rule || null
  wizardOpen.value = true
}

async function handleToggle(id: string) {
  const rule = rules.value.find(r => r.id === id)
  const newState = rule ? !rule.enabled : true
  try {
    await automationStore.toggleRule(id)
    notify.success('적용 완료', `${rule?.name || '룰'}이(가) ${newState ? '활성화' : '비활성화'}되었습니다`)
  } catch {
    notify.error('적용 실패', '룰 상태 변경에 실패했습니다')
  }
}

async function handleDelete(rule: AutomationRule) {
  const ok = await confirm({
    title: '룰 삭제',
    message: `"${rule.name}" 룰을 삭제하시겠습니까?`,
    confirmText: '삭제',
    variant: 'danger',
  })
  if (!ok) return
  try {
    await automationStore.removeRule(rule.id)
  } catch (err) {
    console.error('삭제 실패:', err)
  }
}

function onRuleSaved() {
  // store에서 이미 fetchRules를 호출하므로 별도 처리 불필요
}

onMounted(async () => {
  await Promise.all([
    automationStore.fetchRules(),
    groupStore.fetchGroups(),
    deviceStore.fetchDevices(),
  ])
})
</script>

<style scoped>
.page-container {
  padding: 24px;
  max-width: 1200px;
  margin: 0 auto;
}

.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 20px;
  flex-wrap: wrap;
  gap: 12px;
}
.page-header h2 { font-size: calc(32px * var(--content-scale, 1)); font-weight: 700; color: var(--text-primary); }
.page-description { color: var(--text-secondary); font-size: calc(16px * var(--content-scale, 1)); margin-top: 4px; }

.btn-primary {
  padding: 14px 28px; background: var(--accent); color: white; border: none;
  border-radius: 8px; font-weight: 600; font-size: calc(16px * var(--content-scale, 1)); cursor: pointer;
  transition: background 0.2s;
}
.btn-primary:hover { background: var(--accent-hover); }

.automation-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 24px;
  overflow-x: auto;
  background: var(--bg-badge);
  border-radius: 10px;
  padding: 4px;
}

.tab {
  padding: 8px 16px;
  border: none;
  border-radius: 8px;
  background: none;
  font-size: calc(14px * var(--content-scale, 1));
  font-weight: 500;
  color: var(--text-link);
  cursor: pointer;
  transition: background 0.2s, color 0.2s;
  white-space: nowrap;
}
.tab.active {
  background: var(--bg-secondary);
  color: var(--text-primary);
  box-shadow: var(--shadow-card);
}

.loading-state, .empty-state {
  text-align: center; padding: 60px 20px; color: var(--text-muted); font-size: calc(16px * var(--content-scale, 1));
}
.empty-state .btn-primary { margin-top: 16px; }

.rules-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
  gap: 16px;
}

.rule-card {
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: 14px;
  padding: 20px;
  box-shadow: var(--shadow-card);
  cursor: pointer;
  transition: transform 0.15s, box-shadow 0.15s;
}
.rule-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-card-hover, 0 4px 16px rgba(0, 0, 0, 0.12));
}

.rule-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.rule-name {
  font-size: calc(20px * var(--content-scale, 1));
  font-weight: 600;
  color: var(--text-primary);
}

.rule-header-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.active-badge {
  padding: 4px 12px;
  border-radius: 6px;
  font-size: calc(14px * var(--content-scale, 1));
  font-weight: 600;
}
.active-badge.enabled { background: var(--accent-bg); color: var(--accent); }
.active-badge.disabled { background: var(--bg-hover); color: var(--text-muted); }

.btn-icon-sm {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: calc(14px * var(--content-scale, 1));
  transition: background 0.2s;
}
.btn-icon-sm:hover { background: var(--danger-bg); }

.rule-target {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 14px;
}

.target-text {
  font-size: calc(15px * var(--content-scale, 1));
  color: var(--accent);
  font-weight: 500;
}

.rule-type-badge {
  padding: 3px 10px;
  background: var(--bg-badge);
  border-radius: 6px;
  font-size: calc(13px * var(--content-scale, 1));
  font-weight: 600;
  color: var(--text-secondary);
}

/* 조건/동작 2단 */
.rule-body {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-bottom: 14px;
}

.rule-section {
  padding: 12px;
  border-radius: 10px;
}

.rule-section.condition {
  background: var(--bg-condition);
}

.rule-section.action {
  background: var(--bg-action);
}

.section-title {
  display: block;
  font-size: calc(13px * var(--content-scale, 1));
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 6px;
  text-transform: uppercase;
}

.section-content {
  font-size: calc(15px * var(--content-scale, 1));
  color: var(--text-primary);
  line-height: 1.5;
}

.irrigation-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 14px;
}

.irrigation-schedule-row {
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--bg-condition);
}

.rule-devices {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 12px;
  font-size: calc(15px * var(--content-scale, 1));
}
.device-label { color: var(--text-muted); font-weight: 500; }
.device-names { color: var(--text-secondary); }

.rule-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 12px;
  border-top: 1px solid var(--border-light);
}

.priority-badge {
  font-size: calc(14px * var(--content-scale, 1));
  color: var(--text-muted);
}

/* 토글 */
.toggle-switch {
  position: relative;
  display: inline-block;
  width: 48px;
  height: 26px;
  cursor: pointer;
}
.toggle-switch input { opacity: 0; width: 0; height: 0; }
.toggle-slider {
  position: absolute; cursor: pointer;
  top: 0; left: 0; right: 0; bottom: 0;
  background: var(--toggle-off); border-radius: 26px;
  transition: background 0.3s;
}
.toggle-slider:before {
  content: ''; position: absolute;
  height: 20px; width: 20px;
  left: 3px; bottom: 3px;
  background: white; border-radius: 50%;
  transition: transform 0.3s;
}
input:checked + .toggle-slider { background: var(--toggle-on); }
input:checked + .toggle-slider:before { transform: translateX(22px); }

@media (max-width: 768px) {
  .page-container { padding: 16px; }
  .page-header h2 { font-size: calc(24px * var(--content-scale, 1)); }
  .rules-grid { grid-template-columns: 1fr; }
  .rule-body { grid-template-columns: 1fr; }
}
</style>
