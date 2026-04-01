<template>
  <div class="page-container">
    <header class="page-header">
      <div>
        <h2>그룹 관리</h2>
        <p class="page-description">장비를 그룹으로 묶어 관리합니다</p>
      </div>
      <div class="header-actions">
        <!-- MQTT에서는 실시간 동기화됨 -->
        <button v-if="!isFarmUser" class="btn-primary" @click="showGroupCreationModal = true">+ 그룹 추가</button>
      </div>
    </header>

    <div v-if="loading" class="loading-state">그룹 목록을 불러오는 중...</div>

    <EmptyState
      v-else-if="groups.length === 0"
      icon="<path d='M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2'/><circle cx='9' cy='7' r='4'/><path d='M23 21v-2a4 4 0 0 0-3-3.87'/><path d='M16 3.13a4 4 0 0 1 0 7.75'/>"
      title="그룹이 없습니다"
      description="장비를 그룹으로 묶어 한눈에 관리하세요."
      :action-label="!isFarmUser ? '+ 그룹 만들기' : undefined"
      :action-fn="!isFarmUser ? () => { showGroupCreationModal = true } : undefined"
    />

    <div v-else class="groups-list">
      <div v-for="group in groups" :key="group.id" class="group-card">
        <!-- 그룹 헤더 -->
        <div class="group-header">
          <div class="group-title">
            <h3>{{ group.name }}</h3>
            <p v-if="group.description" class="group-desc">{{ group.description }}</p>
          </div>
          <div class="group-header-actions">
            <span class="device-count-badge">{{ getGroupSensors(group).length + getGroupActuators(group).length + getGroupOpenerGroups(group).length }}개 장비</span>
            <button v-if="!isFarmUser" class="btn-icon" @click="openEnvConfig(group)" title="환경설정" aria-label="환경설정">⚙</button>
            <button v-if="!isFarmUser" class="btn-icon" @click="openAddDeviceModal(group)" title="장비 추가" aria-label="장비 추가">+</button>
            <button v-if="!isFarmUser && hasAssignedDevices(group)" class="btn-icon" @click="openRemoveDeviceModal(group)" title="장비 제거" aria-label="장비 제거">−</button>
            <button v-if="!isFarmUser" class="btn-icon danger" @click="deleteGroup(group)" title="그룹 삭제" aria-label="삭제">🗑</button>
            <button class="btn-icon" @click="toggleCollapse(group.id)" :title="collapsedGroups.has(group.id) ? '펼치기' : '접기'" :aria-label="collapsedGroups.has(group.id) ? '펼치기' : '접기'">
              {{ collapsedGroups.has(group.id) ? '▶' : '▼' }}
            </button>
          </div>
        </div>

        <!-- 그룹 내 장비 (접기/펼치기) -->
        <div v-if="!collapsedGroups.has(group.id)" class="group-body">
          <!-- 장비 없음 -->
          <div v-if="!group.devices || group.devices.length === 0" class="no-devices">
            <p>할당된 장비가 없습니다</p>
            <button v-if="!isFarmUser" class="btn-sm" @click="openAddDeviceModal(group)">+ 장비 추가</button>
          </div>

          <!-- 센서 목록 -->
          <template v-if="getGroupSensors(group).length > 0">
            <div class="section-label sensor">센서 ({{ getGroupSensors(group).length }})</div>
            <div class="device-sub-grid">
              <div v-for="device in getGroupSensors(group)" :key="device.id" class="sub-card sensor">
                <div class="sub-card-top">
                  <span :class="['status-dot', device.online ? 'online' : 'offline']"></span>
                  <span class="sub-card-name">{{ device.name }}</span>
                  <span class="type-tag sensor">센서</span>
                </div>
                <div v-if="device.sensorData && Object.keys(device.sensorData).length > 0" class="sub-card-sensor-grid">
                  <div v-for="(val, key) in getTopSensorData(device.sensorData)" :key="key" class="sensor-grid-item">
                    <span class="sensor-grid-value">{{ formatSensorVal(key as string, val as number) }}<span class="sensor-grid-unit">{{ getSensorUnit(key as string) }}</span></span>
                    <span class="sensor-grid-label">{{ SENSOR_LABELS[key as string] || key }}</span>
                  </div>
                </div>
                <div v-else class="sub-card-value muted">{{ device.online ? '로딩 중...' : '오프라인' }}</div>
              </div>
            </div>
          </template>

          <!-- 장비(액추에이터 + 개폐기 + 관수) 목록 -->
          <template v-if="getGroupActuators(group).length > 0 || getGroupOpenerGroups(group).length > 0 || getGroupIrrigationDevices(group).length > 0">
            <div class="section-label actuator">장비 ({{ getGroupActuators(group).length + getGroupOpenerGroups(group).length + getGroupIrrigationDevices(group).length }})</div>
            <div class="device-sub-grid">
              <!-- 개폐기 그룹 카드 -->
              <div v-for="og in getGroupOpenerGroups(group)" :key="og.groupName" class="sub-card actuator">
                <div class="sub-card-top">
                  <span :class="['status-dot', og.openDevice.online || og.closeDevice.online ? 'online' : 'offline']"></span>
                  <span class="sub-card-name">{{ og.groupName }}</span>
                  <span class="type-tag actuator">개폐기</span>
                </div>
                <div class="sub-card-control" :class="{ disabled: !og.openDevice.online }">
                  <span class="control-label">열림</span>
                  <label class="toggle-switch" @click.prevent="og.openDevice.online && handleControl(og.openDevice.id, !og.openDevice.switchState)">
                    <input type="checkbox" :checked="og.openDevice.switchState === true" :disabled="!og.openDevice.online || controllingId === og.openDevice.id" />
                    <span class="toggle-slider"></span>
                  </label>
                </div>
                <div class="sub-card-control" :class="{ disabled: !og.closeDevice.online }">
                  <span class="control-label">닫힘</span>
                  <label class="toggle-switch" @click.prevent="og.closeDevice.online && handleControl(og.closeDevice.id, !og.closeDevice.switchState)">
                    <input type="checkbox" :checked="og.closeDevice.switchState === true" :disabled="!og.closeDevice.online || controllingId === og.closeDevice.id" />
                    <span class="toggle-slider"></span>
                  </label>
                </div>
              </div>
              <!-- 관수 장비 카드 -->
              <div v-for="device in getGroupIrrigationDevices(group)" :key="device.id" class="sub-card actuator">
                <div class="sub-card-top">
                  <span :class="['status-dot', device.online ? 'online' : 'offline']"></span>
                  <span class="sub-card-name">{{ device.name }}</span>
                  <button class="btn-status-sm" @click="openIrrigationStatusModal(device)">상태</button>
                  <span class="type-tag actuator">관수</span>
                </div>
                <div class="sub-card-control" :class="{ disabled: !device.online }">
                  <span class="control-label">원격제어 ON/OFF</span>
                  <label class="toggle-switch" @click.prevent="device.online && handleIrrigationControl(device, getMapping(device)['remote_control'])">
                    <input type="checkbox" :checked="device.switchStates?.[getMapping(device)['remote_control']] === true" :disabled="!device.online || irrigationControlling === device.id" />
                    <span class="toggle-slider"></span>
                  </label>
                </div>
                <div class="sub-card-control disabled">
                  <span class="control-label">액비/교반기 B접점</span>
                  <label class="toggle-switch">
                    <input type="checkbox" :checked="device.switchStates?.[getMapping(device)['fertilizer_b_contact']] === true" disabled />
                    <span class="toggle-slider"></span>
                  </label>
                </div>
                <!-- 채널 매핑 설정 패널 (admin/farm_admin 전용) -->
                <IrrigationChannelMappingPanel :device="device" />
              </div>
              <!-- 일반 장비 카드 -->
              <div v-for="device in getGroupActuators(group)" :key="device.id" class="sub-card actuator">
                <div class="sub-card-top">
                  <span :class="['status-dot', device.online ? 'online' : 'offline']"></span>
                  <span class="sub-card-name">{{ device.name }}</span>
                  <span class="type-tag actuator">장비</span>
                </div>
                <div class="sub-card-control" :class="{ disabled: !device.online }">
                  <span class="control-label">{{ device.switchState === true ? '가동중' : '정지' }}</span>
                  <label class="toggle-switch" @click.prevent="device.online && handleControl(device.id, !device.switchState)">
                    <input type="checkbox" :checked="device.switchState === true" :disabled="!device.online || controllingId === device.id" />
                    <span class="toggle-slider"></span>
                  </label>
                </div>
              </div>
            </div>
          </template>

          <!-- 자동화 룰 -->
          <template v-if="getGroupRules(group.id).length > 0">
            <div class="section-label automation">자동화 ({{ getGroupRules(group.id).length }})</div>
            <div class="rules-list">
              <div v-for="rule in getGroupRules(group.id)" :key="rule.id" class="rule-row clickable" @click="openEditRule(rule)">
                <span class="rule-name">{{ rule.name }}</span>
                <span class="rule-summary">{{ getRuleSummary(rule) }}</span>
                <label class="toggle-switch" @click.stop>
                  <input type="checkbox" :checked="rule.enabled" @change="toggleRule(rule.id)" />
                  <span class="toggle-slider"></span>
                </label>
              </div>
            </div>
          </template>
        </div>
      </div>
    </div>

    <GroupCreation
      :show="showGroupCreationModal"
      @close="showGroupCreationModal = false"
      @created="handleGroupCreated"
    />

    <AddDeviceModal
      :show="showAddDeviceModal"
      :target-group="addDeviceTargetGroup"
      :unassigned-devices="unassignedDevices"
      @close="showAddDeviceModal = false"
      @added="showAddDeviceModal = false"
    />

    <!-- 관수 상태 모달 -->
    <IrrigationStatusModal
      :visible="showIrrigationStatusModal"
      :device="irrigationStatusDevice"
      @close="showIrrigationStatusModal = false"
    />

    <!-- 자동화 편집 모달 -->
    <AutomationEditModal
      :visible="showEditRuleModal"
      :rule="editingRule"
      @close="showEditRuleModal = false"
      @saved="onRuleEdited"
    />

    <EnvConfigModal
      :show="showEnvConfigModal"
      :group="envConfigGroup"
      @close="showEnvConfigModal = false"
    />

    <RemoveDeviceModal
      :show="showRemoveDeviceModal"
      :target-group="removeTargetGroup"
      :sensors="removeModalSensors"
      :openers="removeModalOpeners"
      :irrigations="removeModalIrrigation"
      :actuators="removeModalActuators"
      @close="showRemoveDeviceModal = false"
      @removed="() => {}"
    />

    <DeleteBlockingModal
      :show="blockingModal.show"
      :type="blockingModal.type"
      :target-name="blockingModal.targetName"
      :rules="blockingModal.rules"
      @close="blockingModal.show = false"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch, onBeforeUnmount } from 'vue'
import { useRoute } from 'vue-router'
import { useGroupStore } from '../stores/group.store'
import { useDeviceStore } from '../stores/device.store'
import { useAutomationStore } from '../stores/automation.store'
import { useAuthStore } from '../stores/auth.store'
import GroupCreation from '@/components/groups/GroupCreation.vue'
import AddDeviceModal from '@/components/groups/AddDeviceModal.vue'
import IrrigationChannelMappingPanel from '@/components/devices/IrrigationChannelMappingPanel.vue'
import IrrigationStatusModal from '@/components/devices/IrrigationStatusModal.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import EnvConfigModal from '@/components/groups/EnvConfigModal.vue'
import RemoveDeviceModal from '@/components/groups/RemoveDeviceModal.vue'
import AutomationEditModal from '@/components/automation/AutomationEditModal.vue'
import DeleteBlockingModal from '@/components/common/DeleteBlockingModal.vue'
import { useConfirm } from '../composables/useConfirm'
import { useNotificationStore } from '../stores/notification.store'
import { groupApi } from '../api/group.api'
import type { HouseGroup } from '../types/group.types'
import type { Device, DependencyRule, ChannelMapping } from '../types/device.types'
import { FUNCTION_LABELS } from '../types/device.types'
import type { AutomationRule } from '../types/automation.types'
import { formatConditionGroup } from '../utils/automation-helpers'

const route = useRoute()
const groupStore = useGroupStore()
const deviceStore = useDeviceStore()
const automationStore = useAutomationStore()
const authStore = useAuthStore()
const { isFarmUser } = authStore
const { confirm } = useConfirm()
const notify = useNotificationStore()
const showGroupCreationModal = ref(false)

// 삭제 차단 모달 상태
const blockingModal = ref<{
  show: boolean
  type: 'device' | 'opener-pair' | 'group'
  targetName: string
  rules: DependencyRule[]
}>({
  show: false,
  type: 'group',
  targetName: '',
  rules: [],
})
const groups = computed(() => groupStore.groups)
const loading = computed(() => groupStore.loading)

const collapsedGroups = ref(new Set<string>())

// 장비 추가 모달
const showAddDeviceModal = ref(false)
const addDeviceTargetGroup = ref<HouseGroup | null>(null)

onMounted(async () => {
  await Promise.all([
    groupStore.fetchGroups(),
    deviceStore.fetchDevices(),
    automationStore.fetchRules(),
  ])
  const envConfigGroupId = route.query.envConfig as string | undefined
  if (envConfigGroupId) {
    const target = groupStore.groups.find(g => g.id === envConfigGroupId)
    if (target) openEnvConfig(target)
  }
})

const toggleCollapse = (groupId: string) => {
  if (collapsedGroups.value.has(groupId)) {
    collapsedGroups.value.delete(groupId)
  } else {
    collapsedGroups.value.add(groupId)
  }
}

const getGroupSensors = (group: HouseGroup): Device[] =>
  (group.devices || []).filter(d => d.deviceType === 'sensor').map(d => {
    const storeDevice = deviceStore.devices.find(sd => sd.id === d.id)
    return storeDevice ? { ...d, sensorData: storeDevice.sensorData, online: storeDevice.online } : d
  })

// 개폐기 쌍 ID (개별 표시 제외용)
const getOpenerPairIds = (group: HouseGroup): Set<string> => {
  const devices = group.devices || []
  const ids = new Set<string>()
  for (const d of devices) {
    if ((d.equipmentType === 'opener_open' || d.equipmentType === 'opener_close') && d.pairedDeviceId) {
      ids.add(d.id)
    }
  }
  return ids
}

// 개폐기 그룹 대표 목록
interface OpenerGroupInfo {
  groupName: string
  openDevice: Device
  closeDevice: Device
}
const getGroupOpenerGroups = (group: HouseGroup): OpenerGroupInfo[] => {
  const devices = group.devices || []
  const opens = devices.filter(d => d.equipmentType === 'opener_open' && d.pairedDeviceId)
  return opens.map(od => {
    const cd = devices.find(d => d.id === od.pairedDeviceId)
    if (!cd) return null
    const storeOpen = deviceStore.devices.find(sd => sd.id === od.id)
    const storeClose = deviceStore.devices.find(sd => sd.id === cd.id)
    return {
      groupName: od.openerGroupName || od.name,
      openDevice: storeOpen ? { ...od, switchState: storeOpen.switchState, online: storeOpen.online } : od,
      closeDevice: storeClose ? { ...cd, switchState: storeClose.switchState, online: storeClose.online } : cd,
    }
  }).filter(Boolean) as OpenerGroupInfo[]
}

const getGroupActuators = (group: HouseGroup): Device[] => {
  const openerIds = getOpenerPairIds(group)
  return (group.devices || [])
    .filter(d => d.deviceType === 'actuator' && !openerIds.has(d.id) && d.equipmentType !== 'irrigation')
    .map(d => {
      const storeDevice = deviceStore.devices.find(sd => sd.id === d.id)
      return storeDevice ? { ...d, switchState: storeDevice.switchState, online: storeDevice.online } : d
    })
}

// 관수 장비
const getGroupIrrigationDevices = (group: HouseGroup): Device[] => {
  return (group.devices || [])
    .filter(d => d.equipmentType === 'irrigation')
    .map(d => {
      const storeDevice = deviceStore.devices.find(sd => sd.id === d.id)
      return storeDevice ? { ...d, switchStates: storeDevice.switchStates, online: storeDevice.online } : d
    })
}

const irrigationControlling = ref<string | null>(null)

// 관수 상태 모달
const showIrrigationStatusModal = ref(false)
const irrigationStatusDevice = ref<Device | null>(null)

function getMapping(device: Device): ChannelMapping {
  return deviceStore.getEffectiveMapping(device)
}

function getMappingLabel(device: Device, switchCode: string): string {
  const mapping = getMapping(device)
  const found = (Object.entries(mapping) as [keyof ChannelMapping, string][]).find(([, sw]) => sw === switchCode)
  return found ? FUNCTION_LABELS[found[0]] : switchCode
}

const openIrrigationStatusModal = (device: Device) => {
  irrigationStatusDevice.value = device
  showIrrigationStatusModal.value = true
}

const handleIrrigationControl = async (device: Device, switchCode: string) => {
  if (irrigationControlling.value) return
  irrigationControlling.value = device.id
  const currentVal = device.switchStates?.[switchCode] ?? false
  const newVal = !currentVal
  const label = getMappingLabel(device, switchCode)
  const loadingId = notify.add('info', '적용 중...', `${label} ${newVal ? 'ON' : 'OFF'} 명령 전송 중`, 0)
  try {
    const result = await deviceStore.controlDevice(device.id, [{ code: switchCode, value: newVal }])
    if (!result.success) {
      notify.remove(loadingId)
      notify.error('제어 실패', result.msg || '장비 제어에 실패했습니다')
      return
    }
    const storeDevice = deviceStore.devices.find(d => d.id === device.id)
    if (storeDevice) {
      if (!storeDevice.switchStates) storeDevice.switchStates = {}
      storeDevice.switchStates[switchCode] = newVal
    }
    const verification = await deviceStore.verifyDeviceStatus(device.id, switchCode, newVal)
    notify.remove(loadingId)
    if (verification.verified) {
      notify.success('적용 완료', `${label} ${newVal ? 'ON' : 'OFF'}`)
    } else if (verification.actualValue !== undefined && storeDevice) {
      notify.warning('상태 미변경', '명령은 전달되었으나 장비 상태가 변경되지 않았습니다')
      if (!storeDevice.switchStates) storeDevice.switchStates = {}
      storeDevice.switchStates[switchCode] = verification.actualValue
    } else {
      notify.warning('상태 확인 실패', '장비 상태를 확인할 수 없습니다')
    }
  } catch (err: any) {
    console.error('관수 장비 제어 실패:', err)
    notify.remove(loadingId)
    notify.error('제어 실패', '네트워크 오류가 발생했습니다')
  } finally {
    irrigationControlling.value = null
  }
}

const SENSOR_LABELS: Record<string, string> = {
  temperature: '온도', humidity: '습도', co2: 'CO2',
  rainfall: '강우량', uv: 'UV', dew_point: '이슬점',
}

const ALLOWED_SENSOR_FIELDS = new Set(['temperature', 'humidity', 'co2', 'rainfall', 'uv', 'dew_point'])

function getTopSensorData(sensorData: Record<string, number | null | undefined>): Record<string, number> {
  const entries = Object.entries(sensorData).filter(([k, v]) => v != null && ALLOWED_SENSOR_FIELDS.has(k)) as [string, number][]
  return Object.fromEntries(entries)
}

const formatSensorVal = (field: string, value: number): string => {
  if (value == null) return '-'
  if (['temperature', 'dew_point', 'ph', 'ec', 'rainfall'].includes(field)) return value.toFixed(1)
  if (['co2', 'light'].includes(field)) return Math.round(value).toLocaleString()
  return Math.round(value).toString()
}

const getSensorUnit = (field: string): string => {
  const units: Record<string, string> = {
    temperature: '°C', humidity: '%', co2: 'ppm', rainfall: 'mm',
    uv: '', dew_point: '°C', light: 'lux',
    soil_moisture: '%', ph: '', ec: 'mS/cm',
  }
  return units[field] || ''
}

// 장비 제어
const controllingId = ref<string | null>(null)

const handleControl = async (deviceId: string, turnOn: boolean) => {
  if (controllingId.value) return
  controllingId.value = deviceId
  const device = deviceStore.devices.find(d => d.id === deviceId)
  const loadingId = notify.add('info', '적용 중...', `${device?.name || '장비'} ${turnOn ? 'ON' : 'OFF'} 명령 전송 중`, 0)
  try {
    const result = await deviceStore.controlDevice(deviceId, [{ code: 'switch_1', value: turnOn }])
    if (!result.success) {
      notify.remove(loadingId)
      notify.error('제어 실패', result.msg || '장비 제어에 실패했습니다')
      return
    }
    if (device) device.switchState = turnOn
    const verification = await deviceStore.verifyDeviceStatus(deviceId, 'switch_1', turnOn)
    notify.remove(loadingId)
    if (verification.verified) {
      notify.success('적용 완료', `${device?.name || '장비'} ${turnOn ? 'ON' : 'OFF'}`)
    } else if (verification.actualValue !== undefined && device) {
      notify.warning('상태 미변경', '명령은 전달되었으나 장비 상태가 변경되지 않았습니다')
      device.switchState = verification.actualValue
    } else {
      notify.warning('상태 확인 실패', '장비 상태를 확인할 수 없습니다')
    }
  } catch (err: any) {
    console.error('장비 제어 실패:', err)
    notify.remove(loadingId)
    notify.error('제어 실패', '네트워크 오류가 발생했습니다')
    if (device) device.switchState = !turnOn
  } finally {
    controllingId.value = null
  }
}

// 자동화 룰
const getGroupRules = (groupId: string): AutomationRule[] =>
  automationStore.rules.filter(r => r.groupId === groupId)

const getRuleSummary = (rule: AutomationRule): string => {
  const condText = formatConditionGroup(rule.conditions)
  const actions = rule.actions as any
  const cmd = actions?.command === 'on' ? 'ON' : actions?.command === 'off' ? 'OFF' : ''
  const count = actions?.targetDeviceIds?.length || 0
  if (count > 0 && cmd) return `${condText} → ${count}개 장비 ${cmd}`
  return condText
}

const toggleRule = async (ruleId: string) => {
  try {
    await automationStore.toggleRule(ruleId)
  } catch (err) {
    console.error('룰 토글 실패:', err)
  }
}

// 자동화 편집 모달
const showEditRuleModal = ref(false)
const editingRule = ref<AutomationRule | null>(null)

const openEditRule = (rule: AutomationRule) => {
  editingRule.value = rule
  showEditRuleModal.value = true
}

const onRuleEdited = () => {
  automationStore.fetchRules()
}

const unassignedDevices = computed(() => {
  const assignedIds = new Set(
    groups.value.flatMap(g => (g.devices || []).map(d => d.id))
  )
  // 개폐기는 opener_open만 대표로 보여주고 opener_close는 숨김
  // (그룹에 추가할 때 opener_open 선택 시 쌍인 opener_close도 함께 추가됨)
  return deviceStore.devices.filter(d => {
    if (assignedIds.has(d.id)) return false
    if (d.equipmentType === 'opener_close' && d.pairedDeviceId) return false
    return true
  })
})

const handleGroupCreated = () => {
  showGroupCreationModal.value = false
}

const deleteGroup = async (group: HouseGroup) => {
  const { data: deps } = await groupApi.getDependencies(group.id)

  if (!deps.canDelete) {
    blockingModal.value = {
      show: true,
      type: 'group',
      targetName: group.name,
      rules: deps.automationRules,
    }
    return
  }

  const ok = await confirm({
    title: '그룹 삭제',
    message: `"${group.name}" 그룹을 삭제하시겠습니까?`,
    confirmText: '삭제',
    variant: 'danger',
  })
  if (!ok) return
  try {
    await groupStore.removeGroup(group.id)
  } catch (err) {
    console.error('그룹 삭제 실패:', err)
    alert('그룹 삭제에 실패했습니다.')
  }
}

// ── 장비 제거 모달 ──
const showRemoveDeviceModal = ref(false)
const removeTargetGroup = ref<HouseGroup | null>(null)

const hasAssignedDevices = (group: HouseGroup) =>
  (group.devices || []).length > 0

const openRemoveDeviceModal = (group: HouseGroup) => {
  removeTargetGroup.value = group
  showRemoveDeviceModal.value = true
}

const removeModalSensors = computed(() =>
  removeTargetGroup.value ? getGroupSensors(removeTargetGroup.value) : []
)
const removeModalOpeners = computed(() =>
  removeTargetGroup.value ? getGroupOpenerGroups(removeTargetGroup.value) : []
)
const removeModalIrrigation = computed(() =>
  removeTargetGroup.value ? getGroupIrrigationDevices(removeTargetGroup.value) : []
)
const removeModalActuators = computed(() =>
  removeTargetGroup.value ? getGroupActuators(removeTargetGroup.value) : []
)

const openAddDeviceModal = (group: HouseGroup) => {
  addDeviceTargetGroup.value = group
  showAddDeviceModal.value = true
}

// ── 환경설정 ──
const showEnvConfigModal = ref(false)
const envConfigGroup = ref<HouseGroup | null>(null)

function openEnvConfig(group: HouseGroup) {
  envConfigGroup.value = group
  showEnvConfigModal.value = true
}

// 모달 열림 시 배경 스크롤 차단
const anyModalOpen = computed(() => showAddDeviceModal.value || showEnvConfigModal.value || showIrrigationStatusModal.value || showRemoveDeviceModal.value)
watch(anyModalOpen, (open) => {
  document.body.style.overflow = open ? 'hidden' : ''
})
onBeforeUnmount(() => { document.body.style.overflow = '' })
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
  margin-bottom: 24px;
  flex-wrap: wrap;
  gap: 12px;
}

.page-header h2 { font-size: calc(28px * var(--content-scale, 1)); font-weight: 700; color: var(--text-primary); }
.page-description { color: var(--text-secondary); font-size: calc(14px * var(--content-scale, 1)); margin-top: 4px; }

.header-actions {
  display: flex;
  gap: 10px;
}

.btn-primary {
  padding: 14px 28px; background: var(--accent); color: white; border: none;
  border-radius: 8px; font-weight: 600; font-size: calc(16px * var(--content-scale, 1)); cursor: pointer;
  transition: background 0.2s;
}
.btn-primary:hover:not(:disabled) { background: var(--accent-hover); }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

.btn-outline {
  padding: 12px 24px; background: var(--bg-secondary); color: var(--text-primary);
  border: 1px solid var(--border-color); border-radius: 8px; font-weight: 500;
  font-size: calc(15px * var(--content-scale, 1)); cursor: pointer;
  transition: border-color 0.2s, background 0.2s;
}
.btn-outline:hover:not(:disabled) { border-color: var(--accent); background: var(--accent-bg); }
.btn-outline:disabled { opacity: 0.5; cursor: not-allowed; }

.loading-state, .empty-state {
  text-align: center; padding: 60px 20px; color: var(--text-secondary); font-size: calc(16px * var(--content-scale, 1));
}
.empty-state .btn-primary { margin-top: 16px; }

/* 그룹 리스트 */
.groups-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.group-card {
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: 14px;
  box-shadow: var(--shadow-card);
  overflow: hidden;
}

.group-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px;
  gap: 12px;
}

.group-title {
  flex: 1;
  min-width: 0;
}

.group-title h3 {
  font-size: calc(18px * var(--content-scale, 1));
  font-weight: 600;
  color: var(--text-primary);
}

.group-desc {
  font-size: calc(13px * var(--content-scale, 1));
  color: var(--text-muted);
  margin-top: 4px;
}

.group-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.device-count-badge {
  padding: 4px 12px;
  background: var(--bg-badge);
  border-radius: 20px;
  font-size: calc(13px * var(--content-scale, 1));
  font-weight: 500;
  color: var(--text-secondary);
  white-space: nowrap;
}

.btn-icon {
  width: 36px;
  height: 36px;
  min-width: 44px;
  min-height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-hover);
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-size: calc(14px * var(--content-scale, 1));
  color: var(--text-link);
  transition: background 0.2s;
}
.btn-icon:hover { background: var(--border-light); }
.btn-icon.danger:hover { background: var(--danger-bg); color: var(--danger); }

/* 그룹 본문 */
.group-body {
  padding: 0 20px 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.section-label {
  font-size: calc(13px * var(--content-scale, 1));
  font-weight: 600;
  padding: 6px 12px;
  border-radius: 6px;
  display: inline-block;
}
.section-label.sensor { background: var(--sensor-bg); color: var(--sensor-accent); }
.section-label.actuator { background: var(--accent-bg); color: var(--accent); }
.section-label.automation { background: var(--automation-bg); color: var(--automation-text); }

.device-sub-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 10px;
}

.sub-card {
  background: var(--bg-hover);
  border-radius: 12px;
  padding: 16px;
  border: 1px solid var(--border-light);
}

.sub-card-top {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.status-dot.online { background: var(--toggle-on); }
.status-dot.offline { background: var(--border-color); }

.sub-card-name {
  flex: 1;
  font-size: calc(14px * var(--content-scale, 1));
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.type-tag {
  font-size: calc(13px * var(--content-scale, 1));
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 6px;
  flex-shrink: 0;
}
.type-tag.sensor { background: var(--sensor-bg); color: var(--sensor-accent); }
.type-tag.actuator { background: var(--accent-bg); color: var(--accent); }

.sub-card-sensor-grid {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  padding: 2px 0;
}

.sensor-grid-item {
  text-align: center;
  padding: 4px 4px;
  min-width: 50px;
}

.sensor-grid-value {
  display: block;
  font-size: calc(18px * var(--content-scale, 1));
  font-weight: 700;
  color: var(--sensor-accent);
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
}

.sensor-grid-unit {
  font-size: calc(11px * var(--content-scale, 1));
  font-weight: 500;
  color: var(--text-muted);
  margin-left: 1px;
}

.sensor-grid-label {
  display: block;
  font-size: calc(11px * var(--content-scale, 1));
  color: var(--text-muted);
  margin-top: 2px;
}

.sub-card-value.muted {
  font-size: calc(13px * var(--content-scale, 1));
  font-weight: 400;
  color: var(--text-muted);
}

.sub-card-control {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 0;
}

.sub-card-control + .sub-card-control {
  border-top: 1px solid var(--border-light);
}

.sub-card-control.disabled {
  opacity: 0.4;
  pointer-events: none;
}

.control-label {
  font-size: calc(14px * var(--content-scale, 1));
  font-weight: 600;
  color: var(--accent);
}

/* 토글 스위치 */
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

/* 작은 토글 */
.toggle-switch-sm {
  position: relative;
  display: inline-block;
  width: 36px;
  height: 20px;
  flex-shrink: 0;
}
.toggle-switch-sm input { opacity: 0; width: 0; height: 0; }
.toggle-slider-sm {
  position: absolute; cursor: pointer;
  top: 0; left: 0; right: 0; bottom: 0;
  background: var(--toggle-off); border-radius: 20px;
  transition: background 0.3s;
}
.toggle-slider-sm:before {
  content: ''; position: absolute;
  height: 14px; width: 14px;
  left: 3px; bottom: 3px;
  background: white; border-radius: 50%;
  transition: transform 0.3s;
}
input:checked + .toggle-slider-sm { background: var(--toggle-on); }
input:checked + .toggle-slider-sm:before { transform: translateX(16px); }

/* 자동화 룰 */
.rules-list {
  background: var(--bg-hover);
  border-radius: 10px;
  overflow: hidden;
}

.rule-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  font-size: calc(13px * var(--content-scale, 1));
  border-bottom: 1px solid var(--border-light);
}
.rule-row:last-child { border-bottom: none; }
.rule-row.clickable { cursor: pointer; transition: background 0.15s; }
.rule-row.clickable:hover { background: var(--bg-secondary); }
.rule-name { font-weight: 600; color: var(--text-primary); white-space: nowrap; }
.rule-summary { flex: 1; color: var(--text-muted); font-size: calc(13px * var(--content-scale, 1)); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.no-devices {
  padding: 24px;
  text-align: center;
  background: var(--bg-hover);
  border-radius: 10px;
}
.no-devices p { color: var(--text-muted); font-size: calc(13px * var(--content-scale, 1)); margin: 0 0 8px; }

.btn-sm {
  padding: 8px 16px;
  background: var(--bg-badge);
  border: none;
  border-radius: 8px;
  font-size: calc(14px * var(--content-scale, 1));
  cursor: pointer;
  color: var(--text-secondary);
  transition: background 0.2s;
}
.btn-sm:hover { background: var(--border-color); }


/* 관수 상태 버튼 (소형) */
.btn-status-sm {
  padding: 2px 8px;
  background: var(--bg-secondary);
  color: var(--text-link);
  border: 1px solid var(--border-input);
  border-radius: 4px;
  font-size: calc(12px * var(--content-scale, 1));
  font-weight: 600;
  cursor: pointer;
  flex-shrink: 0;
  transition: border-color 0.2s, background 0.2s;
}
.btn-status-sm:hover {
  border-color: var(--accent);
  background: var(--accent-bg);
}

@media (max-width: 768px) {
  .page-container { padding: 16px; }
  .page-header h2 { font-size: calc(24px * var(--content-scale, 1)); }
  .device-sub-grid { grid-template-columns: 1fr; }
  .group-header { flex-direction: column; align-items: flex-start; }
  .group-header-actions { width: 100%; justify-content: flex-end; }
  .btn-icon { min-width: 44px; min-height: 44px; }
}
</style>
