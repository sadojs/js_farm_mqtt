<template>
  <div class="page-container">
    <header class="page-header">
      <div>
        <h2>자동 제어 설정</h2>
        <p class="page-description">측정값·시간·날씨에 따라 장치를 자동으로 제어합니다</p>
      </div>
      <div class="page-header-right">
        <span v-if="mainTab === 'rules' && rules.length > 0" class="active-summary"
          :title="`총 ${rules.length}개 중 ${activeRuleCount}개 켜짐`">
          <span class="active-summary-dot"></span>
          <strong>{{ activeRuleCount }}</strong> / {{ rules.length }} 켜짐
        </span>
        <button v-if="mainTab === 'rules'" class="btn-primary" @click="openWizard()">+ 설정 추가</button>
      </div>
    </header>

    <!-- 메인 탭: 규칙 목록 | 실행 로그 -->
    <div class="main-tabs">
      <button class="main-tab" :class="{ active: mainTab === 'rules' }" @click="mainTab = 'rules'">설정 목록</button>
      <button class="main-tab" :class="{ active: mainTab === 'logs' }" @click="mainTab = 'logs'">실행 기록</button>
    </div>

    <!-- 규칙 목록 탭 -->
    <template v-if="mainTab === 'rules'">
    <div class="automation-tabs">
      <button class="tab" :class="{ active: activeTab === 'all' }" @click="activeTab = 'all'">전체 <span class="tab-count">{{ rules.length }}</span></button>
      <button v-if="SHOW_OPENER_TAB" class="tab" :class="{ active: activeTab === 'opener' }" @click="activeTab = 'opener'">개폐기 <span class="tab-count">{{ openerRules.length }}</span></button>
      <button class="tab" :class="{ active: activeTab === 'fan' }" @click="activeTab = 'fan'">환풍기 <span class="tab-count">{{ fanRules.length }}</span></button>
      <button class="tab" :class="{ active: activeTab === 'irrigation' }" @click="activeTab = 'irrigation'">관주 <span class="tab-count">{{ irrigationRules.length }}</span></button>
      <button class="tab" :class="{ active: activeTab === 'other' }" @click="activeTab = 'other'">기타 <span class="tab-count">{{ otherRules.length }}</span></button>
    </div>

    <!-- 로딩 -->
    <div v-if="loading" class="loading-state">설정 목록을 불러오는 중...</div>

    <!-- 빈 상태 -->
    <EmptyState
      v-else-if="filteredRules.length === 0"
      icon="<circle cx='12' cy='12' r='3'/><path d='M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z'/>"
      title="자동 제어 설정이 없습니다"
      description="측정값에 따라 장치를 자동으로 제어하는 설정을 만들어보세요."
      action-label="+ 첫 번째 설정 만들기"
      :action-fn="() => openWizard()"
    />

    <!-- 구역별 그룹 + 컴팩트 행 리스트 -->
    <div v-else class="rule-groups">
      <section v-for="grp in rulesGroupedByZone" :key="grp.key" class="zone-section">
        <header class="zone-header">
          <span class="zone-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 9.5L12 3l9 6.5V21H3z" />
              <path d="M9 21V12h6v9" />
            </svg>
          </span>
          <span class="zone-name">{{ grp.label }}</span>
          <span class="zone-meta">규칙 {{ grp.rules.length }}개 · {{ grp.activeCount }} 켜짐</span>
        </header>
        <div class="zone-card">
          <div
            v-for="rule in grp.rules"
            :key="rule.id"
            class="rule-row"
            :class="{ 'is-off': !rule.enabled, reorderable: true, dragging: reorderDraggingId === rule.id }"
            :style="reorderDragStyle(rule.id)"
            :data-reorder-id="rule.id"
            :data-reorder-group="'rules:' + grp.key"
            :title="targetLabel(rule)"
            @click="openWizard(rule)"
          >
            <span
              class="drag-grip"
              title="길게 눌러 순서 이동"
              @click.stop
              @pointerdown="reorderPress($event, rule.id, 'rules:' + grp.key, grp.rules.map(r => r.id))"
            ></span>
            <!-- 좌측: 장치 타입 아이콘 -->
            <EquipmentIcon
              :type="detectRuleKind(rule)"
              :active="rule.enabled"
              :size="20"
              :title="ruleTypeLabel(rule)"
            />

            <!-- 본문: 규칙명 + 보조 + 조건 + 동작 -->
            <div class="rule-row-main">
              <div class="rule-row-title">
                <span class="rule-row-name">{{ rule.name }}</span>
                <span class="rule-row-sub">{{ ruleTypeLabel(rule) }}<span v-if="houseSubLabel(rule)"> · {{ houseSubLabel(rule) }}</span></span>
              </div>
              <div class="rule-row-cond">
                <span class="cond-badge" :class="`cond-badge-${conditionKind(rule)}`">{{ conditionKindLabel(rule) }}</span>
                <span class="cond-text">{{ conditionText(rule) }}</span>
                <span class="cond-arrow" aria-hidden="true">→</span>
                <span class="action-text">{{ actionText(rule) }}</span>
              </div>
            </div>

            <!-- 우측: 토글 + 케밥 -->
            <label class="toggle-switch" @click.stop>
              <input type="checkbox" :checked="rule.enabled" @change="handleToggle(rule.id)" />
              <span class="toggle-slider"></span>
            </label>
            <button class="btn-kebab" @click.stop="handleDelete(rule)" :aria-label="`${rule.name} 삭제`" title="삭제">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
                <circle cx="12" cy="5" r="1.6" />
                <circle cx="12" cy="12" r="1.6" />
                <circle cx="12" cy="19" r="1.6" />
              </svg>
            </button>
          </div>
        </div>
      </section>
    </div>

    </template>
    <!-- //규칙 목록 탭 -->

    <!-- 위저드 모달 (수정: V1, 신규: V2) -->
    <RuleWizardModal
      :visible="wizardOpen"
      :editRule="editingRule"
      @close="wizardOpen = false"
      @saved="onRuleSaved"
    />
    <IntentWizardModal
      v-if="showIntentWizard"
      @close="showIntentWizard = false"
      @switch-to-legacy="handleSwitchToLegacy"
      @saved="onRuleSaved"
    />

    <!-- 실행 기록 탭 → 작업 내역 페이지 안내 -->
    <div v-if="mainTab === 'logs'" class="log-redirect">
      <p>실행 기록이 작업 내역 페이지로 이동했습니다.</p>
      <router-link to="/activity-log" class="btn-link">작업 내역 보기 →</router-link>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useAutomationStore } from '../stores/automation.store'
import { useGroupStore } from '../stores/group.store'
import { useDeviceStore } from '../stores/device.store'
import { formatConditionGroup, isIrrigationConditions, formatIrrigationSchedule, formatIrrigationZones } from '../utils/automation-helpers'
import { useConfirm } from '../composables/useConfirm'
import { useReorder } from '../composables/useReorder'
import { automationApi } from '../api/automation.api'
import { useNotificationStore } from '../stores/notification.store'
import type { AutomationRule } from '../types/automation.types'
import RuleWizardModal from '../components/automation/RuleWizardModal.vue'
import IntentWizardModal from '../components/automation/v2/IntentWizardModal.vue'
import EmptyState from '../components/common/EmptyState.vue'
import EquipmentIcon from '../components/common/EquipmentIcon.vue'
// AutomationLogTimeline → 작업 내역 페이지로 이전됨

const automationStore = useAutomationStore()
const groupStore = useGroupStore()
const deviceStore = useDeviceStore()
const notify = useNotificationStore()
const { confirm } = useConfirm()

type RuleKind = 'opener' | 'fan' | 'irrigation' | 'other'
type TabType = 'all' | RuleKind
// 개폐기 탭 표시 여부 (당분간 미사용, 필요 시 true로 변경)
const SHOW_OPENER_TAB = true
const activeTab = ref<TabType>('all')

// 메인 탭: 규칙 목록 / 실행 로그
const mainTab = ref<'rules' | 'logs'>('rules')

const wizardOpen = ref(false)
const showIntentWizard = ref(false)
const editingRule = ref<AutomationRule | null>(null)

const rules = computed(() => automationStore.rules)
const loading = computed(() => automationStore.loading)

// 자동제어룰 순서 드래그 (구역 섹션 내). displayOrder 낙관적 갱신 + 서버 저장.
const { press: reorderPress, draggingId: reorderDraggingId, dragStyle: reorderDragStyle } = useReorder({
  setOrder: (id, v) => { const r = automationStore.rules.find(x => x.id === id); if (r) r.displayOrder = v },
  getOrder: (id) => automationStore.rules.find(x => x.id === id)?.displayOrder ?? 0,
  persist: (orders) => automationApi.reorderRules(orders),
})

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
  irrigation: '관주',
  other: '기타',
}

function ruleTypeLabel(rule: AutomationRule) {
  return EQUIPMENT_LABELS[detectRuleKind(rule)]
}

function targetLabel(rule: AutomationRule) {
  const group = groupStore.groups.find(g => g.id === rule.groupId)
  if (!group) return '미지정'
  if (!rule.houseId) return `${group.name} (구역 전체)`
  const house = (group.houses || []).find(h => h.id === rule.houseId)
  return house ? `${group.name} > ${house.name}` : `${group.name} (하우스 미지정)`
}

function openWizard(rule?: AutomationRule) {
  editingRule.value = rule || null
  if (!rule) {
    showIntentWizard.value = true
  } else {
    wizardOpen.value = true
  }
}

function handleSwitchToLegacy() {
  showIntentWizard.value = false
  editingRule.value = null
  wizardOpen.value = true
}

async function handleToggle(id: string) {
  const rule = rules.value.find(r => r.id === id)
  const newState = rule ? !rule.enabled : true
  try {
    // FR-03: 관주 설정 활성화 시 autoEnableRemote 전달
    const isIrrigationEnable = newState && (rule?.conditions as any)?.type === 'irrigation'
    await automationStore.toggleRule(id, isIrrigationEnable ? { autoEnableRemote: true } : undefined)
    notify.success('적용 완료', `${rule?.name || '설정'}이(가) ${newState ? '활성화' : '비활성화'}되었습니다`)
  } catch {
    notify.error('적용 실패', '설정 상태 변경에 실패했습니다')
  }
}

async function handleDelete(rule: AutomationRule) {
  const ok = await confirm({
    title: '설정 삭제',
    message: `"${rule.name}" 설정을 삭제하시겠습니까?`,
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

// ── D2 디자인 보조 (UI 표시 전용 — 데이터/판정 로직 변경 없음) ──

// 헤더 우측: N/M 켜짐 요약
const activeRuleCount = computed(() => rules.value.filter(r => r.enabled).length)

// 조건 타입(시간/날씨/복합/관주) — 뱃지 표시용
function conditionKind(rule: AutomationRule): 'time' | 'weather' | 'hybrid' | 'irrigation' {
  if (isIrrigationConditions(rule.conditions)) return 'irrigation'
  return rule.ruleType as any
}
const CONDITION_KIND_LABELS: Record<string, string> = {
  time: '시간',
  weather: '날씨',
  hybrid: '복합',
  irrigation: '관주 일정',
}
function conditionKindLabel(rule: AutomationRule): string {
  return CONDITION_KIND_LABELS[conditionKind(rule)] || ''
}

// 조건 텍스트 (행 표시용 — 기존 formatConditionGroup 그대로)
function conditionText(rule: AutomationRule): string {
  if (isIrrigationConditions(rule.conditions)) return formatIrrigationSchedule(rule.conditions)
  return formatConditionGroup(rule.conditions)
}

// 동작 텍스트 (관주: 구역 / 일반: 장치 + 액션 요약)
function actionText(rule: AutomationRule): string {
  if (isIrrigationConditions(rule.conditions)) {
    return formatIrrigationZones(rule.conditions)
  }
  const names = getRuleDeviceNames(rule)
  if (names.length === 0) return '대상 장치 없음'
  const actions = rule.actions as any
  // 액션 command 가 있으면 함께 표시
  let suffix = ''
  if (actions?.command) {
    const cmd = String(actions.command).toLowerCase()
    if (cmd === 'on' || cmd === 'open') suffix = ' ON'
    else if (cmd === 'off' || cmd === 'close') suffix = ' OFF'
  }
  return `${names.join(', ')}${suffix}`
}

// 하우스 보조 라벨 (구역 전체이면 빈 문자열)
function houseSubLabel(rule: AutomationRule): string {
  const group = groupStore.groups.find(g => g.id === rule.groupId)
  if (!group || !rule.houseId) return ''
  const house = (group.houses || []).find(h => h.id === rule.houseId)
  return house?.name ?? ''
}

// 구역별 그룹화 (필터링된 규칙을 groupId로 묶음)
interface ZoneGroup {
  key: string
  label: string
  rules: AutomationRule[]
  activeCount: number
}
const rulesGroupedByZone = computed<ZoneGroup[]>(() => {
  const buckets = new Map<string, ZoneGroup>()
  // 활성 IoT 구역 순서로 표시. 비활성 구역에 연결된 룰은 "미지정" 으로 떨어짐 — 룰 자체는 유지.
  for (const g of groupStore.iotGroups) {
    buckets.set(g.id, { key: g.id, label: g.name, rules: [], activeCount: 0 })
  }
  const unassignedKey = '__unassigned__'
  buckets.set(unassignedKey, { key: unassignedKey, label: '미지정', rules: [], activeCount: 0 })

  for (const r of filteredRules.value) {
    const key = r.groupId && buckets.has(r.groupId) ? r.groupId : unassignedKey
    const b = buckets.get(key)!
    b.rules.push(r)
    if (r.enabled) b.activeCount += 1
  }
  // 각 구역 내 룰은 displayOrder 순 (드래그 정렬 반영)
  for (const b of buckets.values()) {
    b.rules.sort((a, c) => ((a as any).displayOrder ?? 0) - ((c as any).displayOrder ?? 0))
  }
  // 비어있는 그룹 제외 + 미지정은 맨 뒤
  const arr: ZoneGroup[] = []
  for (const [k, v] of buckets) {
    if (k === unassignedKey) continue
    if (v.rules.length > 0) arr.push(v)
  }
  const unassigned = buckets.get(unassignedKey)!
  if (unassigned.rules.length > 0) arr.push(unassigned)
  return arr
})

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

/* 메인 탭 (규칙 목록 / 실행 로그) */
.main-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 16px;
  border-bottom: 2px solid var(--border-light);
}

.main-tab {
  padding: 10px 20px;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  margin-bottom: -2px;
  font-size: calc(15px * var(--content-scale, 1));
  font-weight: 600;
  color: var(--text-muted);
  cursor: pointer;
  transition: color 0.2s, border-color 0.2s;
}

.main-tab.active {
  color: var(--accent);
  border-bottom-color: var(--accent);
}

.main-tab:hover:not(.active) {
  color: var(--text-secondary);
}


.loading-state {
  text-align: center;
  padding: 60px 20px;
  color: var(--text-muted);
  font-size: calc(15px * var(--content-scale, 1));
}

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
.log-redirect {
  text-align: center; padding: 60px 20px; color: var(--text-muted); font-size: calc(15px * var(--content-scale, 1));
}
.log-redirect .btn-link {
  display: inline-block; margin-top: 12px; padding: 10px 24px;
  background: var(--accent); color: white; border-radius: 10px;
  text-decoration: none; font-weight: 600; font-size: calc(14px * var(--content-scale, 1));
}
.empty-state .btn-primary { margin-top: 16px; }

/* 헤더 우측 영역 */
.page-header-right {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}
.active-summary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: calc(14px * var(--content-scale, 1));
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}
.active-summary strong { color: var(--text-primary); font-weight: 700; }
.active-summary-dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: #22c55e;
  box-shadow: 0 0 0 3px rgba(34,197,94,.15);
}

/* 카테고리 탭 카운트 (괄호 대신 칩) */
.tab-count {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 7px;
  border-radius: 9px;
  background: var(--bg-hover);
  font-size: calc(12px * var(--content-scale, 1));
  font-weight: 600;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}
.tab.active .tab-count { background: var(--accent-bg); color: var(--accent); }

/* ── D2: 구역별 그룹 + 컴팩트 행 ── */
.rule-groups {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.zone-section { display: flex; flex-direction: column; gap: 10px; }

.zone-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 4px;
}
.zone-icon {
  width: 24px; height: 24px;
  display: inline-flex; align-items: center; justify-content: center;
  color: var(--accent);
}
.zone-icon svg { width: 18px; height: 18px; stroke-linecap: round; stroke-linejoin: round; }
.zone-name {
  font-size: calc(16px * var(--content-scale, 1));
  font-weight: 700;
  color: var(--text-primary);
}
.zone-meta {
  font-size: calc(13px * var(--content-scale, 1));
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.zone-card {
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: 14px;
  box-shadow: var(--shadow-card);
  overflow: hidden;
}

.rule-row {
  display: grid;
  grid-template-columns: auto 1fr auto auto;
  align-items: center;
  gap: 14px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border-light);
  cursor: pointer;
  transition: background 0.12s;
}
.rule-row:last-child { border-bottom: none; }
.rule-row:hover { background: var(--bg-hover); }
.rule-row.is-off { opacity: 0.72; }

/* 룰 순서 드래그 */
.rule-row.reorderable { position: relative; padding-left: 40px; }
.rule-row .drag-grip {
  position: absolute;
  left: 14px; top: 0; bottom: 0;
  width: 16px; height: 22px; margin: auto 0;
  cursor: grab; touch-action: none;
  color: var(--text-muted); opacity: 0.6;
  background-image:
    radial-gradient(currentColor 1.3px, transparent 1.6px),
    radial-gradient(currentColor 1.3px, transparent 1.6px);
  background-size: 5px 7px;
  background-position: 3px 2px, 8px 2px;
  background-repeat: repeat-y;
}
.rule-row .drag-grip:hover { opacity: 1; }
.rule-row.dragging {
  box-shadow: 0 12px 26px rgba(0, 0, 0, 0.16);
  background: var(--bg-card);
  z-index: 5;
  pointer-events: none;
  user-select: none;
}

.rule-row-main { display: flex; flex-direction: column; gap: 6px; min-width: 0; }

.rule-row-title { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.rule-row-name {
  font-size: calc(15px * var(--content-scale, 1));
  font-weight: 600;
  color: var(--text-primary);
}
.rule-row-sub {
  font-size: calc(12px * var(--content-scale, 1));
  color: var(--text-muted);
}

.rule-row-cond {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  font-size: calc(13px * var(--content-scale, 1));
  color: var(--text-secondary);
  line-height: 1.5;
}
.cond-text { color: var(--text-secondary); }
.cond-arrow { color: var(--text-muted); font-weight: 700; }
.action-text { color: var(--text-primary); font-weight: 500; }

/* 조건 타입 뱃지 — 4색 (인라인 상수) */
.cond-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: calc(11px * var(--content-scale, 1));
  font-weight: 700;
  letter-spacing: 0.02em;
  flex-shrink: 0;
}
.cond-badge-time      { background: rgba(21,101,192,.10);  color: #1565c0; }
.cond-badge-weather   { background: rgba(2,119,189,.10);   color: #0277bd; }
.cond-badge-hybrid    { background: rgba(106,27,154,.10);  color: #6a1b9a; }
.cond-badge-irrigation{ background: rgba(0,131,143,.10);   color: #00838f; }

/* 토글 — 기존 디자인 유지 */
.toggle-switch {
  position: relative;
  display: inline-block;
  width: 44px;
  height: 24px;
  cursor: pointer;
  flex-shrink: 0;
}
.toggle-switch input { opacity: 0; width: 0; height: 0; }
.toggle-slider {
  position: absolute; cursor: pointer;
  top: 0; left: 0; right: 0; bottom: 0;
  background: var(--toggle-off); border-radius: 24px;
  transition: background 0.3s;
}
.toggle-slider:before {
  content: ''; position: absolute;
  height: 18px; width: 18px;
  left: 3px; bottom: 3px;
  background: white; border-radius: 50%;
  transition: transform 0.3s;
}
input:checked + .toggle-slider { background: var(--toggle-on); }
input:checked + .toggle-slider:before { transform: translateX(20px); }

/* 케밥 (삭제) */
.btn-kebab {
  width: 32px; height: 32px;
  display: inline-flex; align-items: center; justify-content: center;
  background: none; border: none;
  border-radius: 8px;
  color: var(--text-muted);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  flex-shrink: 0;
}
.btn-kebab:hover { background: var(--danger-bg, rgba(239,68,68,.1)); color: var(--danger, #dc2626); }

/* ── 모바일 (≤768px) — 동일 패턴, 행 세로 풀기 ── */
@media (max-width: 768px) {
  .page-container { padding: 4px 0; }
  .page-header h2 { font-size: calc(24px * var(--content-scale, 1)); }
  .page-description { font-size: calc(13px * var(--content-scale, 1)); }
  .btn-primary { padding: 10px 16px; font-size: calc(14px * var(--content-scale, 1)); }

  .rule-groups { gap: 18px; }

  /* 컴팩트 행: 좌측 아이콘 + 본문 + 우측(토글/케밥) 가로 / 본문 내부는 세로 풀기 */
  .rule-row {
    grid-template-columns: auto 1fr auto auto;
    gap: 10px;
    padding: 13px 14px;
    min-height: 44px;  /* 터치 타깃 */
  }
  .rule-row-name { font-size: calc(14px * var(--content-scale, 1)); }
  .rule-row-cond {
    gap: 6px;
    font-size: calc(12px * var(--content-scale, 1));
  }
  .cond-arrow { display: inline; }
  .toggle-switch { width: 48px; height: 26px; }
  .toggle-slider:before { height: 20px; width: 20px; left: 3px; bottom: 3px; }
  input:checked + .toggle-slider:before { transform: translateX(22px); }
}
</style>
