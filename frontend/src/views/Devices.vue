<template>
  <div class="page-container">
    <header class="page-header">
      <div>
        <h2>장치 관리</h2>
        <p class="page-description">농장 장치와 측정기를 관리합니다</p>
      </div>
      <div class="header-actions">
        <!-- MQTT에서는 실시간 동기화됨 -->
        <button v-if="!authStore.isFarmUser" class="btn-primary" @click="showRegistrationModal = true">+ 장치 추가</button>
      </div>
    </header>

    <!-- 검색 + 탭 필터 -->
    <div class="filter-bar">
      <div class="search-box">
        <span class="search-icon">🔍</span>
        <input
          v-model="searchQuery"
          type="text"
          placeholder="장치 이름으로 검색..."
          class="search-input"
        />
      </div>
      <div class="tab-filter">
        <button class="tab" :class="{ active: activeTab === 'all' }" @click="activeTab = 'all'">
          전체 ({{ deviceStore.devices.length }})
        </button>
        <button class="tab" :class="{ active: activeTab === 'actuator' }" @click="activeTab = 'actuator'">
          장치 ({{ actuatorDevices.length }})
        </button>
        <button class="tab" :class="{ active: activeTab === 'sensor' }" @click="activeTab = 'sensor'">
          측정기 ({{ sensorDevices.length }})
        </button>
      </div>
    </div>

    <!-- 로딩 상태 -->
    <div v-if="deviceStore.loading" class="loading-state">
      <p>장치 목록을 불러오는 중...</p>
    </div>

    <!-- 장치 없음 -->
    <EmptyState
      v-else-if="filteredDevices.length === 0"
      :icon="searchQuery
        ? '<circle cx=\'11\' cy=\'11\' r=\'8\'/><line x1=\'21\' y1=\'21\' x2=\'16.65\' y2=\'16.65\'/>'
        : '<path d=\'M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9\'/><path d=\'M13.73 21a2 2 0 0 1-3.46 0\'/>'"
      :title="searchQuery ? '검색 결과가 없습니다' : '아직 등록된 장치가 없습니다'"
      :description="searchQuery ? '다른 검색어를 입력해보세요.' : '측정기 동기화를 통해 장치를 가져와 등록하세요.'"
      :action-label="!searchQuery && !authStore.isFarmUser ? '+ 장치 등록하기' : undefined"
      :action-fn="!searchQuery && !authStore.isFarmUser ? () => { showRegistrationModal = true } : undefined"
    />

    <!-- 개폐기 그룹 -->
    <div v-if="openerGroups.length > 0 && (activeTab === 'all' || activeTab === 'actuator')" class="opener-groups">
      <div v-for="group in openerGroups" :key="group.groupName" class="opener-group-card">
        <div class="card-top" style="margin-bottom: 16px;">
          <span :class="['status-dot', (group.openDevice.online || group.closeDevice.online) ? 'online' : 'offline']"></span>
          <span class="type-badge actuator">장치</span>
          <div class="card-title">
            <div class="card-title-name">
              <template v-if="renamingDeviceId === group.openDevice.id">
                <input
                  ref="renameInput"
                  v-model="renameValue"
                  class="rename-input"
                  maxlength="50"
                  @keyup.enter="submitRename(group.openDevice.id)"
                  @keyup.esc="cancelRename"
                  @blur="cancelRename"
                />
                <button class="btn-rename-ok" @mousedown.prevent="submitRename(group.openDevice.id)">✓</button>
              </template>
              <template v-else>
                <h4>{{ group.groupName }}</h4>
                <button
                  v-if="authStore.isAdmin || authStore.isFarmAdmin"
                  class="btn-rename"
                  @click="startRename(group.openDevice.id, group.groupName)"
                  title="이름 변경"
                >✎</button>
              </template>
            </div>
            <span class="card-category">개폐기</span>
          </div>
          <button class="btn-icon-delete" @click="handleRemoveOpenerGroup(group)" title="장치 삭제" aria-label="삭제">삭제</button>
        </div>
        <div class="opener-controls">
          <div class="opener-row">
            <span class="opener-label">열림</span>
            <span :class="['status-dot', group.openDevice.online ? 'online' : 'offline']"></span>
            <div class="opener-toggle-area" :class="{ disabled: !group.openDevice.online }">
              <label class="toggle-switch" @click.prevent="group.openDevice.online && !interlocking && interlockControl(group, 'open')">
                <input type="checkbox" :checked="group.openDevice.switchState === true" :disabled="!group.openDevice.online || interlocking" />
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>
          <div class="opener-row">
            <span class="opener-label">닫힘</span>
            <span :class="['status-dot', group.closeDevice.online ? 'online' : 'offline']"></span>
            <div class="opener-toggle-area" :class="{ disabled: !group.closeDevice.online }">
              <label class="toggle-switch" @click.prevent="group.closeDevice.online && !interlocking && interlockControl(group, 'close')">
                <input type="checkbox" :checked="group.closeDevice.switchState === true" :disabled="!group.closeDevice.online || interlocking" />
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 관수 장치 그룹 -->
    <div v-if="irrigationDevices.length > 0 && (activeTab === 'all' || activeTab === 'actuator')" class="irrigation-groups">
      <div v-for="device in irrigationDevices" :key="device.id" class="irrigation-group-card">
        <div class="card-top" style="margin-bottom: 16px;">
          <span :class="['status-dot', device.online ? 'online' : 'offline']"></span>
          <span class="type-badge actuator">장치</span>
          <div class="card-title">
            <div class="card-title-name">
              <template v-if="renamingDeviceId === device.id">
                <input
                  ref="renameInput"
                  v-model="renameValue"
                  class="rename-input"
                  maxlength="50"
                  @keyup.enter="submitRename(device.id)"
                  @keyup.esc="cancelRename"
                  @blur="cancelRename"
                />
                <button class="btn-rename-ok" @mousedown.prevent="submitRename(device.id)">✓</button>
              </template>
              <template v-else>
                <h4>{{ device.name }}</h4>
                <button
                  v-if="authStore.isAdmin || authStore.isFarmAdmin"
                  class="btn-rename"
                  @click="startRename(device.id, device.name)"
                  title="이름 변경"
                >✎</button>
              </template>
            </div>
            <span class="card-category">관수장치</span>
          </div>
          <button class="btn-status" @click="openIrrigationStatusModal(device)">상태</button>
          <button class="btn-icon-delete" @click="handleRemoveDevice(device.id)" title="장치 삭제" aria-label="삭제">삭제</button>
        </div>
        <div class="irrigation-controls">
          <div class="irrigation-row">
            <span class="irrigation-label">원격제어 ON/OFF</span>
            <span :class="['status-dot', device.online ? 'online' : 'offline']"></span>
            <div class="irrigation-toggle-area" :class="{ disabled: !device.online }">
              <label class="toggle-switch" @click.prevent="device.online && irrigationControlling === null && handleIrrigationControl(device, getMapping(device)['remote_control'])">
                <input type="checkbox" :checked="device.switchStates?.[getMapping(device)['remote_control']] === true" :disabled="!device.online || irrigationControlling !== null" />
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>
          <div class="irrigation-row">
            <span class="irrigation-label">액비/교반기 B접점</span>
            <span :class="['status-dot', device.online ? 'online' : 'offline']"></span>
            <div class="irrigation-toggle-area disabled">
              <label class="toggle-switch">
                <input type="checkbox" :checked="device.switchStates?.[getMapping(device)['fertilizer_b_contact']] === true" disabled />
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>
        </div>
        <!-- 구역 매핑 설정 패널 (admin/farm_admin 전용) -->
        <IrrigationChannelMappingPanel :device="device" />
      </div>
    </div>

    <!-- 장치 목록 -->
    <div v-if="filteredDevices.length > 0" class="devices-grid">
      <div
        v-for="device in filteredDevices"
        :key="device.id"
        class="device-card"
      >
        <!-- 카드 상단 -->
        <div class="card-top">
          <span :class="['status-dot', device.online ? 'online' : 'offline']"></span>
          <span :class="['type-badge', device.deviceType === 'sensor' ? 'sensor' : 'actuator']">
            {{ device.deviceType === 'sensor' ? '측정기' : '장치' }}
          </span>
          <div class="card-title">
            <div class="card-title-name">
              <template v-if="renamingDeviceId === device.id">
                <input
                  ref="renameInput"
                  v-model="renameValue"
                  class="rename-input"
                  maxlength="50"
                  @keyup.enter="submitRename(device.id)"
                  @keyup.esc="cancelRename"
                  @blur="cancelRename"
                />
                <button class="btn-rename-ok" @mousedown.prevent="submitRename(device.id)">✓</button>
              </template>
              <template v-else>
                <h4>{{ device.name }}</h4>
                <button
                  v-if="authStore.isAdmin || authStore.isFarmAdmin"
                  class="btn-rename"
                  @click="startRename(device.id, device.name)"
                  title="이름 변경"
                >✎</button>
              </template>
            </div>
            <span class="card-category">{{ getCategoryLabel(device.category) }}</span>
          </div>
        </div>

        <!-- 센서: 칩 스타일 표시 -->
        <div v-if="device.deviceType === 'sensor'" class="card-sensor-chips">
          <template v-if="device.sensorData && Object.keys(device.sensorData).length > 0">
            <span v-for="(val, key) in getTopSensorData(device.sensorData)" :key="key" class="sensor-chip">
              {{ SENSOR_META[key as string]?.label || key }} <b>{{ formatSensorVal(key as string, val as number) }}{{ SENSOR_META[key as string]?.unit || '' }}</b>
            </span>
          </template>
          <div v-else-if="device.online" class="sensor-loading">데이터 로딩 중...</div>
          <div v-else class="sensor-offline">오프라인</div>
        </div>

        <!-- 장치: 토글 스위치 -->
        <div v-else class="card-control">
          <div class="toggle-row" :class="{ disabled: !device.online }">
            <span class="toggle-label">
              {{ device.switchState === true ? '가동중' : device.switchState === false ? '정지' : '상태 미확인' }}
            </span>
            <label class="toggle-switch" @click.prevent="device.online && handleControl(device.id, !device.switchState)">
              <input type="checkbox" :checked="device.switchState === true" :disabled="!device.online || controllingId === device.id" />
              <span class="toggle-slider"></span>
            </label>
          </div>
        </div>

        <!-- 카드 하단 -->
        <div class="card-footer">
          <span class="last-seen">{{ formatLastSeen(device.lastSeen) }}</span>
          <div class="card-actions">
            <button class="btn-icon-delete" @click="handleRemoveDevice(device.id)" title="장치 삭제" aria-label="삭제">삭제</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 관수 상태 모달 -->
    <IrrigationStatusModal
      :visible="showIrrigationStatusModal"
      :device="irrigationStatusDevice"
      @close="showIrrigationStatusModal = false"
    />

    <DeviceRegistration
      :is-open="showRegistrationModal"
      @close="showRegistrationModal = false"
      @registered="handleDeviceRegistered"
    />

    <DeleteBlockingModal
      :show="blockingModal.show"
      :type="blockingModal.type"
      :target-name="blockingModal.targetName"
      :rules="blockingModal.rules"
      :groups="blockingModal.groups"
      @close="blockingModal.show = false"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue'
import DeviceRegistration from '@/components/devices/DeviceRegistration.vue'
import IrrigationChannelMappingPanel from '@/components/devices/IrrigationChannelMappingPanel.vue'
import IrrigationStatusModal from '@/components/devices/IrrigationStatusModal.vue'
import DeleteBlockingModal from '@/components/common/DeleteBlockingModal.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import { useDeviceStore } from '@/stores/device.store'
import { useAuthStore } from '@/stores/auth.store'
import { useConfirm } from '@/composables/useConfirm'
import { useNotificationStore } from '@/stores/notification.store'
import { useAutomationStore } from '@/stores/automation.store'
import { deviceApi } from '@/api/device.api'
import type { Device, DependencyRule, ChannelMapping } from '@/types/device.types'
import { FUNCTION_LABELS } from '@/types/device.types'

const deviceStore = useDeviceStore()
const authStore = useAuthStore()
const notify = useNotificationStore()
const automationStore = useAutomationStore()
const { confirm } = useConfirm()
const showRegistrationModal = ref(false)
const searchQuery = ref('')
const activeTab = ref<'all' | 'actuator' | 'sensor'>('all')

// 장치명 인라인 편집
const renamingDeviceId = ref<string | null>(null)
const renameValue = ref('')
const renameInput = ref<HTMLInputElement | null>(null)

function startRename(deviceId: string, currentName: string) {
  renamingDeviceId.value = deviceId
  renameValue.value = currentName
  nextTick(() => renameInput.value?.focus())
}

function cancelRename() {
  renamingDeviceId.value = null
  renameValue.value = ''
}

async function submitRename(deviceId: string) {
  const trimmed = renameValue.value.trim()
  if (!trimmed) { cancelRename(); return }
  try {
    const { data } = await deviceApi.rename(deviceId, trimmed)
    const device = deviceStore.devices.find(d => d.id === deviceId)
    if (device) device.name = data.name
    notify.success('이름 변경 완료', `장치 이름이 "${data.name}"으로 변경되었습니다`)
  } catch {
    notify.error('이름 변경 실패', '저장에 실패했습니다')
  } finally {
    cancelRename()
  }
}

// 삭제 차단 모달 상태
const blockingModal = ref<{
  show: boolean
  type: 'device' | 'opener-pair' | 'group'
  targetName: string
  rules: DependencyRule[]
  groups?: { id: string; name: string }[]
}>({
  show: false,
  type: 'device',
  targetName: '',
  rules: [],
})

const sensorDevices = computed(() => deviceStore.sensorDevices)
const actuatorDevices = computed(() => deviceStore.actuatorDevices)

// 개폐기 그룹 (pairedDeviceId로 쌍 매칭)
interface OpenerGroup {
  groupName: string
  openDevice: Device
  closeDevice: Device
}
const openerGroups = computed<OpenerGroup[]>(() => {
  const opens = deviceStore.devices.filter(d => d.equipmentType === 'opener_open' && d.pairedDeviceId)
  return opens.map(od => {
    const cd = deviceStore.devices.find(d => d.id === od.pairedDeviceId)
    if (!cd) return null
    return { groupName: od.openerGroupName || od.name, openDevice: od, closeDevice: cd }
  }).filter(Boolean) as OpenerGroup[]
})

const interlocking = ref(false)

async function interlockControl(group: OpenerGroup, action: 'open' | 'close') {
  if (interlocking.value) return
  const targetDevice = action === 'open' ? group.openDevice : group.closeDevice
  const oppositeDevice = action === 'open' ? group.closeDevice : group.openDevice

  interlocking.value = true
  const loadingId = notify.add('info', '적용 중...', `${targetDevice.name} ${action === 'open' ? '열림' : '닫힘'} 명령 전송 중`, 0)
  try {
    // 이미 ON이면 OFF만
    if (targetDevice.switchState) {
      const result = await deviceStore.controlDevice(targetDevice.id, [{ code: 'switch_1', value: false }])
      if (!result.success) {
        notify.remove(loadingId)
        notify.error('제어 실패', result.msg || '장치 제어에 실패했습니다')
        return
      }
      targetDevice.switchState = false
      const v = await deviceStore.verifyDeviceStatus(targetDevice.id, 'switch_1', false)
      notify.remove(loadingId)
      if (v.verified) {
        notify.success('적용 완료', `${targetDevice.name} OFF`)
      } else if (v.actualValue !== undefined) {
        notify.warning('상태 미변경', '명령은 전달되었으나 장치 상태가 변경되지 않았습니다')
        targetDevice.switchState = v.actualValue
      }
      return
    }
    // 반대쪽이 ON이면: 먼저 OFF → 1.5초 대기
    if (oppositeDevice.switchState) {
      const offResult = await deviceStore.controlDevice(oppositeDevice.id, [{ code: 'switch_1', value: false }])
      if (!offResult.success) {
        notify.remove(loadingId)
        notify.error('제어 실패', offResult.msg || '장치 제어에 실패했습니다')
        return
      }
      oppositeDevice.switchState = false
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
    // 타겟 ON
    const result = await deviceStore.controlDevice(targetDevice.id, [{ code: 'switch_1', value: true }])
    if (!result.success) {
      notify.remove(loadingId)
      notify.error('제어 실패', result.msg || '장치 제어에 실패했습니다')
      return
    }
    targetDevice.switchState = true
    const v = await deviceStore.verifyDeviceStatus(targetDevice.id, 'switch_1', true)
    notify.remove(loadingId)
    if (v.verified) {
      notify.success('적용 완료', `${targetDevice.name} ${action === 'open' ? '열림' : '닫힘'}`)
    } else if (v.actualValue !== undefined) {
      notify.warning('상태 미변경', '명령은 전달되었으나 장치 상태가 변경되지 않았습니다')
      targetDevice.switchState = v.actualValue
    }
  } catch (err) {
    console.error('인터록 제어 실패:', err)
    notify.remove(loadingId)
    notify.error('제어 실패', '네트워크 오류가 발생했습니다')
  } finally {
    interlocking.value = false
  }
}

// 관수 장치
const irrigationDevices = computed(() =>
  deviceStore.devices.filter(d => d.equipmentType === 'irrigation')
)
const irrigationDeviceIds = computed(() => new Set(irrigationDevices.value.map(d => d.id)))
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

async function handleIrrigationControl(device: Device, switchCode: string) {
  if (irrigationControlling.value) return

  const mapping = deviceStore.getEffectiveMapping(device)
  const isRemoteControl = mapping['remote_control'] === switchCode
  const currentVal = device.switchStates?.[switchCode] ?? false
  const newVal = !currentVal

  // FR-04: 원격제어 OFF 시 확인 다이얼로그
  if (isRemoteControl && !newVal) {
    const deviceStatus = automationStore.getDeviceIrrigationStatus(device.id)
    const enabledCount = deviceStatus?.enabledRuleCount || 0
    if (enabledCount > 0) {
      const ok = await confirm({
        title: '원격제어 끄기',
        message: `원격제어를 끄면 이 장치의 자동 제어 설정 ${enabledCount}개도 비활성화됩니다.${deviceStatus?.isRunning ? '\n현재 가동 중인 관주도 중단됩니다.' : ''}`,
        confirmText: '끄기',
        variant: 'danger',
      })
      if (!ok) return
    }
  }

  irrigationControlling.value = device.id
  const label = getMappingLabel(device, switchCode)
  const loadingId = notify.add('info', '적용 중...', `${label} ${newVal ? 'ON' : 'OFF'} 명령 전송 중`, 0)
  try {
    const result = await deviceStore.controlDevice(device.id, [{ code: switchCode, value: newVal }])
    if (!result.success) {
      notify.remove(loadingId)
      notify.error('제어 실패', result.msg || '장치 제어에 실패했습니다')
      return
    }
    if (!device.switchStates) device.switchStates = {}
    device.switchStates[switchCode] = newVal
    const verification = await deviceStore.verifyDeviceStatus(device.id, switchCode, newVal)
    notify.remove(loadingId)
    if (verification.verified) {
      notify.success('적용 완료', `${label} ${newVal ? 'ON' : 'OFF'}`)
    } else if (verification.actualValue !== undefined) {
      notify.warning('상태 미변경', '명령은 전달되었으나 장치 상태가 변경되지 않았습니다')
      device.switchStates[switchCode] = verification.actualValue
    } else {
      notify.warning('상태 확인 실패', '장치 상태를 확인할 수 없습니다')
    }

    // FR-04: 원격제어 OFF 후 룰 일괄 비활성화
    if (isRemoteControl && !newVal) {
      const bulkResult = await automationStore.bulkDisableByDevice(device.id)
      if (bulkResult.disabledCount > 0) {
        notify.info('자동 제어 비활성화', `자동 제어 설정 ${bulkResult.disabledCount}개가 비활성화되었습니다`)
      }
    }
  } catch (err) {
    console.error('관주 장치 제어 실패:', err)
    notify.remove(loadingId)
    notify.error('제어 실패', '네트워크 오류가 발생했습니다')
  } finally {
    irrigationControlling.value = null
  }
}

// 개폐기 쌍의 ID 목록 (개별 카드에서 제외용)
const openerDeviceIds = computed(() => {
  const ids = new Set<string>()
  for (const g of openerGroups.value) {
    ids.add(g.openDevice.id)
    ids.add(g.closeDevice.id)
  }
  return ids
})

const filteredDevices = computed(() => {
  let list: Device[] = []
  if (activeTab.value === 'all') list = deviceStore.devices
  else if (activeTab.value === 'sensor') list = sensorDevices.value
  else list = actuatorDevices.value

  // 개폐기, 관수 장치는 별도 카드로 표시되므로 제외
  list = list.filter(d => !openerDeviceIds.value.has(d.id) && !irrigationDeviceIds.value.has(d.id))

  if (searchQuery.value.trim()) {
    const q = searchQuery.value.trim().toLowerCase()
    list = list.filter(d => d.name.toLowerCase().includes(q))
  }
  return list
})

const SENSOR_META: Record<string, { label: string; icon: string; unit: string }> = {
  temperature: { label: '온도', icon: '🌡️', unit: '°C' },
  humidity: { label: '습도', icon: '💧', unit: '%' },
  co2: { label: 'CO2', icon: '🌫️', unit: 'ppm' },
  rainfall: { label: '강우량', icon: '🌧️', unit: 'mm' },
  uv: { label: 'UV', icon: '☀️', unit: '' },
  dew_point: { label: '이슬점', icon: '💦', unit: '°C' },
  light: { label: '조도', icon: '💡', unit: 'lux' },
  soil_moisture: { label: '토양수분', icon: '🌱', unit: '%' },
  ph: { label: 'PH', icon: '⚗️', unit: '' },
  ec: { label: 'EC', icon: '⚡', unit: 'mS/cm' },
}

function getTopSensorData(sensorData: Record<string, number | null | undefined>): Record<string, number> {
  const entries = Object.entries(sensorData)
    .filter(([k, v]) => v != null && k in SENSOR_META) as [string, number][]
  return Object.fromEntries(entries)
}

const formatSensorVal = (field: string, value: number): string => {
  if (value == null) return '-'
  if (['temperature', 'dew_point', 'ph', 'ec', 'rainfall'].includes(field)) return value.toFixed(1)
  if (['co2', 'light'].includes(field)) return Math.round(value).toLocaleString()
  return Math.round(value).toString()
}

const getCategoryLabel = (category: string): string => {
  const labels: Record<string, string> = {
    'wk': '환풍기', 'fs': '환풍기',
    'cl': '개폐기', 'mc': '개폐기',
    'dj': '조명', 'dd': '조명',
    'bh': '관주', 'sfkzq': '관주',
    'wsdcg': '온습도계', 'co2bj': 'CO2 측정기', 'ldcg': '토양 측정기',
    'mcs': '통합 측정기', 'ywbj': '우량계', 'pm25': '미세먼지',
    'qxj': '기상관측 측정기', 'hjjcy': '환경검측기',
  }
  return labels[category] || category
}

const formatLastSeen = (lastSeen?: string) => {
  if (!lastSeen) return '-'
  const date = new Date(lastSeen)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return '방금 전'
  if (diffMin < 60) return `${diffMin}분 전`
  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return `${diffHour}시간 전`
  return `${Math.floor(diffHour / 24)}일 전`
}

onMounted(async () => {
  await deviceStore.fetchDevices()
  automationStore.fetchIrrigationStatus()
})

const handleDeviceRegistered = () => {
  deviceStore.fetchDevices()
}

const controllingId = ref<string | null>(null)

const handleControl = async (deviceId: string, turnOn: boolean) => {
  if (controllingId.value) return
  controllingId.value = deviceId
  const device = deviceStore.devices.find(d => d.id === deviceId)
  const loadingId = notify.add('info', '적용 중...', `${device?.name || '장치'} ${turnOn ? 'ON' : 'OFF'} 명령 전송 중`, 0)
  try {
    const result = await deviceStore.controlDevice(deviceId, [{ code: 'switch_1', value: turnOn }])
    if (!result.success) {
      notify.remove(loadingId)
      notify.error('제어 실패', result.msg || '장치 제어에 실패했습니다')
      return
    }
    if (device) device.switchState = turnOn
    const verification = await deviceStore.verifyDeviceStatus(deviceId, 'switch_1', turnOn)
    notify.remove(loadingId)
    if (verification.verified) {
      notify.success('적용 완료', `${device?.name || '장치'} ${turnOn ? 'ON' : 'OFF'}`)
    } else if (verification.actualValue !== undefined && device) {
      notify.warning('상태 미변경', '명령은 전달되었으나 장치 상태가 변경되지 않았습니다')
      device.switchState = verification.actualValue
    } else {
      notify.warning('상태 확인 실패', '장치 상태를 확인할 수 없습니다')
    }
  } catch (err: any) {
    console.error('장치 제어 실패:', err)
    notify.remove(loadingId)
    notify.error('제어 실패', '네트워크 오류가 발생했습니다')
    if (device) device.switchState = !turnOn
  } finally {
    controllingId.value = null
  }
}

const handleRemoveDevice = async (id: string) => {
  try {
    const { data: deps } = await deviceApi.getDependencies(id)
    const device = deviceStore.devices.find(d => d.id === id)

    if (!deps.canDelete) {
      blockingModal.value = {
        show: true,
        type: 'device',
        targetName: device?.name ?? '',
        rules: deps.automationRules,
        groups: deps.groups,
      }
      return
    }

    const ok = await confirm({
      title: '장치 삭제',
      message: `"${device?.name ?? '이 장치'}"를 삭제하시겠습니까?`,
      confirmText: '삭제',
      variant: 'danger',
    })
    if (!ok) return
    await deviceStore.removeDevice(id)
  } catch (err: any) {
    console.error('장치 삭제 실패:', err)
    alert('장치 삭제에 실패했습니다.')
  }
}

const handleRemoveOpenerGroup = async (group: OpenerGroup) => {
  try {
    const { data: deps } = await deviceApi.getDependencies(group.openDevice.id)

    if (!deps.canDelete) {
      const allRules = [
        ...deps.automationRules,
        ...(deps.pairedDeviceAutomationRules ?? []),
      ]
      blockingModal.value = {
        show: true,
        type: 'opener-pair',
        targetName: group.groupName,
        rules: allRules,
        groups: deps.groups,
      }
      return
    }

    const ok = await confirm({
      title: '개폐기 삭제',
      message: `"${group.groupName}" 개폐기(열림/닫힘)를 모두 삭제하시겠습니까?`,
      confirmText: '삭제',
      variant: 'danger',
    })
    if (!ok) return

    await deviceApi.removeOpenerPair(group.openDevice.id)
    await deviceStore.fetchDevices()
  } catch (err: any) {
    console.error('개폐기 삭제 실패:', err)
    alert('개폐기 삭제에 실패했습니다.')
  }
}


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

.page-header h2 {
  font-size: calc(32px * var(--content-scale, 1));
  font-weight: 700;
  color: var(--text-primary);
}

.page-description {
  color: var(--text-secondary);
  font-size: calc(16px * var(--content-scale, 1));
  margin-top: 4px;
}

.header-actions {
  display: flex;
  gap: 10px;
}

.btn-primary {
  padding: 14px 28px;
  background: var(--accent);
  color: white;
  border: none;
  border-radius: 8px;
  font-weight: 600;
  font-size: calc(16px * var(--content-scale, 1));
  cursor: pointer;
  transition: background 0.2s;
}
.btn-primary:hover { background: var(--accent-hover); }

.btn-outline {
  padding: 12px 24px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  font-weight: 500;
  font-size: calc(15px * var(--content-scale, 1));
  cursor: pointer;
  transition: border-color 0.2s, background 0.2s;
}
.btn-outline:hover { border-color: var(--accent); background: var(--accent-bg); }
.btn-outline:disabled { opacity: 0.5; cursor: not-allowed; }

/* 검색 + 탭 */
.filter-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 24px;
  flex-wrap: wrap;
}

.search-box {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--bg-input);
  border: 1px solid var(--border-input);
  border-radius: 10px;
  padding: 0 14px;
  flex: 1;
  min-width: 200px;
  max-width: 360px;
}

.search-icon {
  font-size: calc(16px * var(--content-scale, 1));
  color: var(--text-muted);
}

.search-input {
  flex: 1;
  border: none;
  outline: none;
  padding: 12px 0;
  font-size: calc(15px * var(--content-scale, 1));
  background: none;
}

.tab-filter {
  display: flex;
  gap: 4px;
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
  text-align: center;
  padding: 60px 20px;
  color: var(--text-secondary);
  font-size: calc(16px * var(--content-scale, 1));
}
.empty-icon { font-size: 64px; margin-bottom: 16px; }
.empty-state h3 { font-size: calc(22px * var(--content-scale, 1)); color: var(--text-primary); margin-bottom: 8px; }
.empty-state p { margin-bottom: 24px; font-size: calc(16px * var(--content-scale, 1)); }

/* 장치 그리드 */
.devices-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
}

.device-card {
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: 14px;
  padding: 20px;
  box-shadow: var(--shadow-card);
  display: flex;
  flex-direction: column;
  gap: 14px;
}

/* 카드 상단 */
.card-top {
  display: flex;
  align-items: center;
  gap: 10px;
}

.status-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}
.status-dot.online { background: var(--toggle-on); }
.status-dot.offline { background: var(--border-color); }

.type-badge {
  padding: 4px 12px;
  border-radius: 6px;
  font-size: calc(14px * var(--content-scale, 1));
  font-weight: 600;
  flex-shrink: 0;
}
.type-badge.actuator { background: var(--bg-actuator); color: var(--accent); }
.type-badge.sensor { background: var(--sensor-bg); color: var(--sensor-accent); }

.card-title {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.card-title-name {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: 4px;
}

.card-title h4 {
  font-size: calc(16px * var(--content-scale, 1));
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}

.btn-rename {
  background: none; border: none; color: var(--text-secondary);
  font-size: 13px; cursor: pointer; padding: 0 4px;
  vertical-align: middle; opacity: 0.6;
}
.btn-rename:hover { opacity: 1; color: var(--accent, #4caf50); }

.rename-input {
  width: calc(100% - 32px);
  padding: 2px 6px;
  border: 1px solid var(--accent, #4caf50);
  border-radius: 4px;
  font-size: calc(16px * var(--content-scale, 1));
  font-weight: 600;
  background: var(--bg-primary);
  color: var(--text-primary);
  outline: none;
}

.btn-rename-ok {
  padding: 2px 6px; border: none;
  background: var(--accent, #4caf50); color: #fff;
  border-radius: 4px; font-size: 12px; cursor: pointer; margin-left: 4px;
}

.card-category {
  font-size: calc(13px * var(--content-scale, 1));
  color: var(--text-muted);
}

/* 센서 칩 스타일 */
.card-sensor-chips {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.sensor-chip {
  display: inline-block;
  padding: 3px 10px;
  background: var(--sensor-value-bg);
  border-radius: 14px;
  font-size: var(--font-size-caption);
  color: var(--sensor-accent);
  white-space: nowrap;
}

.sensor-chip b {
  font-weight: 700;
  margin-left: 2px;
}

.sensor-loading, .sensor-offline {
  font-size: calc(14px * var(--content-scale, 1));
  color: var(--text-muted);
  text-align: center;
  padding: 8px;
}

/* 장치 토글 */
.card-control {
  padding: 12px;
  background: var(--bg-actuator);
  border-radius: 10px;
}

.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.toggle-row.disabled {
  opacity: 0.4;
  pointer-events: none;
}

.toggle-label {
  font-size: calc(15px * var(--content-scale, 1));
  font-weight: 600;
  color: var(--accent);
}

.toggle-switch {
  position: relative;
  display: inline-block;
  width: 52px;
  height: 28px;
  cursor: pointer;
}

.toggle-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.toggle-slider {
  position: absolute;
  cursor: pointer;
  top: 0; left: 0; right: 0; bottom: 0;
  background: var(--toggle-off);
  border-radius: 28px;
  transition: background 0.3s;
}

.toggle-slider:before {
  content: '';
  position: absolute;
  height: 22px;
  width: 22px;
  left: 3px;
  bottom: 3px;
  background: white;
  border-radius: 50%;
  transition: transform 0.3s;
}

input:checked + .toggle-slider {
  background: var(--toggle-on);
}

input:checked + .toggle-slider:before {
  transform: translateX(24px);
}

/* 카드 하단 */
.card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 12px;
  border-top: 1px solid var(--border-light);
}

.last-seen {
  font-size: calc(13px * var(--content-scale, 1));
  color: var(--text-muted);
}

.btn-icon-delete {
  padding: 6px 14px;
  min-height: 44px;
  min-width: 44px;
  background: var(--bg-card);
  color: var(--danger);
  border: 1px solid var(--danger);
  border-radius: 6px;
  font-size: calc(13px * var(--content-scale, 1));
  cursor: pointer;
  transition: background 0.2s, color 0.2s;
}
.btn-icon-delete:hover { background: var(--danger); color: white; }

/* 개폐기 그룹 */
.opener-groups {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
  margin-bottom: 24px;
}

.opener-group-card {
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: 14px;
  padding: 20px;
  box-shadow: var(--shadow-card);
}

.opener-controls {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.opener-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.opener-label {
  font-size: calc(15px * var(--content-scale, 1));
  font-weight: 500;
  color: var(--text-secondary);
  min-width: 40px;
}

.opener-btn {
  flex: 1;
  padding: 10px 16px;
  border: 1px solid var(--border-input);
  border-radius: 8px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: calc(15px * var(--content-scale, 1));
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s, color 0.2s, border-color 0.2s;
}

.opener-btn.active {
  background: var(--accent);
  color: white;
  border-color: var(--accent);
}

.opener-btn.disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.opener-btn:hover:not(.disabled):not(.active) {
  border-color: var(--accent);
  background: var(--accent-bg);
}

/* 관수 장치 그룹 */
.irrigation-groups {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
  margin-bottom: 24px;
}

.irrigation-group-card {
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: 14px;
  padding: 20px;
  box-shadow: var(--shadow-card);
}

.irrigation-controls {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.irrigation-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.irrigation-label {
  flex: 1;
  font-size: calc(15px * var(--content-scale, 1));
  font-weight: 500;
  color: var(--text-secondary);
}

/* 토글 영역 래퍼 */
.opener-toggle-area,
.irrigation-toggle-area {
  margin-left: auto;
}
.opener-toggle-area.disabled,
.irrigation-toggle-area.disabled {
  opacity: 0.4;
  pointer-events: none;
}

/* 상태 버튼 */
.btn-status {
  padding: 6px 14px;
  background: var(--bg-secondary);
  color: var(--text-link);
  border: 1px solid var(--border-input);
  border-radius: 6px;
  font-size: calc(13px * var(--content-scale, 1));
  font-weight: 600;
  cursor: pointer;
  transition: border-color 0.2s, background 0.2s;
}
.btn-status:hover {
  border-color: var(--accent);
  background: var(--accent-bg);
}


@media (max-width: 768px) {
  .page-container { padding: 16px; }
  .page-header h2 { font-size: calc(24px * var(--content-scale, 1)); }

  .header-actions { width: 100%; }
  .header-actions .btn-outline,
  .header-actions .btn-primary { flex: 1; text-align: center; }

  .filter-bar { flex-direction: column; gap: 12px; }
  .search-box { display: none; }
  .tab-filter { width: 100%; }
  .tab { flex: 1; text-align: center; }

  .devices-grid { grid-template-columns: 1fr; gap: 10px; }
  .device-card { padding: 14px; gap: 10px; border-radius: 12px; }
  .opener-group-card { padding: 14px; border-radius: 12px; }
  .irrigation-group-card { padding: 14px; border-radius: 12px; }

  .card-top { gap: 8px; }
  .btn-icon-delete { padding: 0 18px; line-height: 1.8; }
  .btn-status { padding: 0 18px; line-height: 1.8; }
  .type-badge { padding: 0 18px; line-height: 1.8; }
}
</style>
