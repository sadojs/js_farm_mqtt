<template>
  <div class="page-container">
    <header class="page-header">
      <div>
        <h2>구역 관리</h2>
        <p class="page-description">장치를 구역으로 묶어 관리합니다</p>
      </div>
      <div class="header-actions">
        <!-- MQTT에서는 실시간 동기화됨 -->
        <button v-if="!isFarmUser" class="btn-primary" @click="showGroupCreationModal = true">+ 구역 추가</button>
      </div>
    </header>

    <div v-if="loading" class="loading-state">구역 목록을 불러오는 중...</div>

    <EmptyState
      v-else-if="groups.length === 0"
      icon="<path d='M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2'/><circle cx='9' cy='7' r='4'/><path d='M23 21v-2a4 4 0 0 0-3-3.87'/><path d='M16 3.13a4 4 0 0 1 0 7.75'/>"
      title="구역이 없습니다"
      description="장치를 구역으로 묶어 한눈에 관리하세요."
      :action-label="!isFarmUser ? '+ 구역 만들기' : undefined"
      :action-fn="!isFarmUser ? () => { showGroupCreationModal = true } : undefined"
    />

    <div v-else class="groups-list">
      <div v-for="group in groups" :key="group.id" class="group-card">
        <!-- 그룹 헤더 -->
        <div class="group-header">
          <div class="group-title">
            <span v-if="isAdmin && group.ownerName" class="farm-owner-badge">🏠 {{ group.ownerName }}</span>
            <template v-if="renamingGroupId === group.id">
              <div class="rename-form">
                <input
                  ref="renameGroupInput"
                  v-model="renameGroupValue"
                  class="rename-group-input"
                  maxlength="50"
                  placeholder="구역명"
                  @keyup.enter="submitRenameGroup(group)"
                  @keyup.esc="cancelRenameGroup"
                />
                <input
                  v-model="renameDescValue"
                  class="rename-desc-input"
                  maxlength="100"
                  placeholder="설명 (선택)"
                  @keyup.enter="submitRenameGroup(group)"
                  @keyup.esc="cancelRenameGroup"
                />
                <div class="rename-actions">
                  <button class="btn-rename-ok" @mousedown.prevent="submitRenameGroup(group)">저장</button>
                  <button class="btn-rename-cancel" @mousedown.prevent="cancelRenameGroup">취소</button>
                </div>
              </div>
            </template>
            <template v-else>
              <h3>{{ group.name }}</h3>
              <button
                v-if="!isFarmUser"
                class="btn-rename-group"
                @click="startRenameGroup(group.id, group.name, group.description)"
                title="이름/설명 변경"
              >✎</button>
            </template>
            <p v-if="group.description && renamingGroupId !== group.id" class="group-desc">{{ group.description }}</p>
          </div>
          <div class="group-header-actions">
            <span class="device-count-badge">{{ getGroupSensors(group).length + getGroupActuators(group).length + getGroupOpenerGroups(group).length }}개 장치</span>
            <button
              class="btn-memo"
              :class="{ 'has-notes': noteCount(group.id) > 0 }"
              @click="openZoneNotes(group)"
              title="구역 메모"
              aria-label="구역 메모"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              <span class="memo-text">메모</span>
              <span v-if="noteCount(group.id) > 0" class="memo-count">{{ noteCount(group.id) }}</span>
            </button>
            <button v-if="!isFarmUser" class="btn-icon" @click="openEnvConfig(group)" title="환경설정" aria-label="환경설정">⚙</button>
            <button v-if="!isFarmUser" class="btn-icon btn-add-gw-icon" @click="openAddGatewayModal(group)" title="게이트웨이 추가" aria-label="게이트웨이 추가">🍓+</button>
            <button v-if="!isFarmUser" class="btn-icon danger" @click="deleteGroup(group)" title="구역 삭제" aria-label="삭제">🗑</button>
            <button class="btn-icon" @click="toggleCollapse(group.id)" :title="collapsedGroups.has(group.id) ? '펼치기' : '접기'" :aria-label="collapsedGroups.has(group.id) ? '펼치기' : '접기'">
              {{ collapsedGroups.has(group.id) ? '▶' : '▼' }}
            </button>
          </div>
        </div>

        <!-- 그룹 내 장치 (접기/펼치기) -->
        <div v-if="!collapsedGroups.has(group.id)" class="group-body">
          <!-- 장치 없음 -->
          <div v-if="!group.devices || group.devices.length === 0" class="no-devices">
            <p>활성화된 장치가 없습니다</p>
            <p v-if="!isFarmUser" class="no-devices-hint">게이트웨이 환경 설정에서 장치를 활성화하세요</p>
          </div>

          <!-- 센서 목록 -->
          <template v-if="getGroupSensors(group).length > 0">
            <div class="section-label sensor">측정기 ({{ getGroupSensors(group).length }})</div>
            <div class="device-sub-grid">
              <div v-for="device in getGroupSensors(group)" :key="device.id" class="sub-card sensor">
                <div class="sub-card-top">
                  <!-- 타입 아이콘 칩 (헤더 순서 통일: [칩][상태점+이름+✎][배지]) -->
                  <EquipmentIcon
                    :type="isRainSensor(device) ? 'rain' : 'sensor'"
                    :active="device.online"
                    :size="20"
                    :title="isRainSensor(device) ? '우적센서' : '측정기'"
                  />
                  <span :class="['status-dot', device.online ? 'online' : 'offline']"></span>
                  <template v-if="renamingDeviceId === device.id">
                    <input
                      v-model="renameDeviceValue"
                      class="rename-input-inline"
                      maxlength="50"
                      @keyup.enter="submitDeviceRename(device.id)"
                      @keyup.esc="cancelDeviceRename"
                      @blur="cancelDeviceRename"
                      @click.stop
                    />
                    <button class="btn-rename-ok" @mousedown.prevent="submitDeviceRename(device.id)">✓</button>
                  </template>
                  <template v-else>
                    <span class="sub-card-name">{{ device.name }}</span>
                    <button
                      v-if="!isFarmUser"
                      class="btn-rename-mini"
                      @click.stop="startDeviceRename(device.id, device.name)"
                      title="이름 변경"
                    >✎</button>
                  </template>
                  <span class="type-tag sensor">측정기</span>
                </div>
                <div v-if="device.sensorData && Object.keys(getTopSensorData(device.sensorData)).length > 0" class="sub-card-sensor-chips">
                  <span v-for="(val, key) in getTopSensorData(device.sensorData)" :key="key" class="sensor-chip">
                    {{ SENSOR_LABELS[key as string] || key }} <b>{{ formatSensorVal(key as string, val as number) }}{{ getSensorUnit(key as string) }}</b>
                  </span>
                </div>
                <!-- 배터리형 이벤트 센서(TS0207 등): 데이터 없어도 "정상" 표시 -->
                <div v-else-if="device.online && isEventSensor(device)" class="sub-card-sensor-chips">
                  <span class="sensor-chip">
                    {{ SENSOR_LABELS[eventSensorField(device)] }} <b>{{ formatSensorVal(eventSensorField(device), 0) }}</b>
                  </span>
                </div>
                <div v-else class="sub-card-value muted">{{ device.online ? '신호 대기' : '오프라인' }}</div>
              </div>
            </div>
          </template>

          <!-- 장치(액추에이터 + 개폐기 + 관수) 목록 -->
          <template v-if="getGroupActuators(group).length > 0 || getGroupOpenerGroups(group).length > 0 || getGroupIrrigationDevices(group).length > 0">
            <div class="section-label actuator">장치 ({{ getGroupActuators(group).length + getGroupOpenerGroups(group).length + getGroupIrrigationDevices(group).length }})</div>
            <div class="device-sub-grid">
              <!-- 개폐기 그룹 카드 -->
              <div v-for="og in getGroupOpenerGroups(group)" :key="og.groupName" class="sub-card actuator">
                <div class="sub-card-top">
                  <EquipmentIcon
                    type="opener"
                    :active="(og.openDevice.online || og.closeDevice.online) && (og.openDevice.switchState === true || og.closeDevice.switchState === true)"
                    :size="20"
                    title="개폐기"
                  />
                  <span :class="['status-dot', og.openDevice.online || og.closeDevice.online ? 'online' : 'offline']"></span>
                  <template v-if="renamingOpenerGroup === og.groupName">
                    <input
                      v-model="renameDeviceValue"
                      class="rename-input-inline"
                      maxlength="50"
                      @keyup.enter="submitOpenerGroupRename(og)"
                      @keyup.esc="cancelDeviceRename"
                      @blur="cancelDeviceRename"
                      @click.stop
                    />
                    <button class="btn-rename-ok" @mousedown.prevent="submitOpenerGroupRename(og)">✓</button>
                  </template>
                  <template v-else>
                    <span class="sub-card-name">{{ og.groupName }}</span>
                    <button
                      v-if="!isFarmUser"
                      class="btn-rename-mini"
                      @click.stop="startOpenerGroupRename(og)"
                      title="이름 변경"
                    >✎</button>
                  </template>
                  <span class="type-tag actuator type-tag-opener">개폐기</span>
                </div>
                <div class="sub-card-control" :class="{ disabled: !og.openDevice.online }">
                  <span class="control-label">열림</span>
                  <label class="toggle-switch" @click.prevent="og.openDevice.online && !openerInterlocking && handleOpenerInterlock(og, 'open')">
                    <input type="checkbox" :checked="og.openDevice.switchState === true" :disabled="!og.openDevice.online || openerInterlocking" />
                    <span class="toggle-slider"></span>
                  </label>
                </div>
                <div class="sub-card-control" :class="{ disabled: !og.closeDevice.online }">
                  <span class="control-label">닫힘</span>
                  <label class="toggle-switch" @click.prevent="og.closeDevice.online && !openerInterlocking && handleOpenerInterlock(og, 'close')">
                    <input type="checkbox" :checked="og.closeDevice.switchState === true" :disabled="!og.closeDevice.online || openerInterlocking" />
                    <span class="toggle-slider"></span>
                  </label>
                </div>
              </div>
              <!-- 관수 장치 카드 -->
              <div v-for="device in getGroupIrrigationDevices(group)" :key="device.id" class="sub-card actuator">
                <div class="sub-card-top">
                  <EquipmentIcon
                    type="irrigation"
                    :active="device.online && device.switchStates?.[getMapping(device)['remote_control']] === true"
                    :size="20"
                    title="관주"
                  />
                  <span :class="['status-dot', device.online ? 'online' : 'offline']"></span>
                  <template v-if="renamingDeviceId === device.id">
                    <input
                      v-model="renameDeviceValue"
                      class="rename-input-inline"
                      maxlength="50"
                      @keyup.enter="submitDeviceRename(device.id)"
                      @keyup.esc="cancelDeviceRename"
                      @blur="cancelDeviceRename"
                      @click.stop
                    />
                    <button class="btn-rename-ok" @mousedown.prevent="submitDeviceRename(device.id)">✓</button>
                  </template>
                  <template v-else>
                    <span class="sub-card-name">{{ device.name }}</span>
                    <button
                      v-if="!isFarmUser"
                      class="btn-rename-mini"
                      @click.stop="startDeviceRename(device.id, device.name)"
                      title="이름 변경"
                    >✎</button>
                  </template>
                  <button class="btn-status-sm" @click="openIrrigationStatusModal(device)">상태</button>
                  <span class="type-tag actuator type-tag-irrigation">관주</span>
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
              </div>
              <!-- 일반 장치 카드 -->
              <div v-for="device in getGroupActuators(group)" :key="device.id" class="sub-card actuator">
                <div class="sub-card-top">
                  <EquipmentIcon
                    :type="device.equipmentType"
                    :active="device.online && device.switchState === true"
                    :size="20"
                    :title="device.equipmentType ?? ''"
                  />
                  <span :class="['status-dot', device.online ? 'online' : 'offline']"></span>
                  <template v-if="renamingDeviceId === device.id">
                    <input
                      v-model="renameDeviceValue"
                      class="rename-input-inline"
                      maxlength="50"
                      @keyup.enter="submitDeviceRename(device.id)"
                      @keyup.esc="cancelDeviceRename"
                      @blur="cancelDeviceRename"
                      @click.stop
                    />
                    <button class="btn-rename-ok" @mousedown.prevent="submitDeviceRename(device.id)">✓</button>
                  </template>
                  <template v-else>
                    <span class="sub-card-name">{{ device.name }}</span>
                    <button
                      v-if="!isFarmUser"
                      class="btn-rename-mini"
                      @click.stop="startDeviceRename(device.id, device.name)"
                      title="이름 변경"
                    >✎</button>
                  </template>
                  <span class="type-tag actuator">장치</span>
                  <span v-if="device.userOverride" class="manual-override-badge"
                    title="자동제어 룰의 의도와 다르게 수동으로 변경됨. 다시 룰 의도와 같은 상태로 토글하면 자동제어로 복귀합니다.">
                    🖐 수동
                  </span>
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

          <!-- 자동 제어 설정 — D2 컴팩트 행 (Automation.vue와 동일 패턴) -->
          <template v-if="getGroupRules(group.id).length > 0">
            <div class="section-label automation">
              자동 제어 ({{ getGroupRules(group.id).length }})
              <span class="rules-active-meta">· {{ getGroupRulesActiveCount(group.id) }} 켜짐</span>
            </div>
            <div class="rules-list zone-card">
              <div
                v-for="rule in getGroupRules(group.id)"
                :key="rule.id"
                class="rule-row d2"
                :class="{ 'is-off': !rule.enabled }"
                @click="openEditRule(rule)"
              >
                <EquipmentIcon
                  :type="detectRuleKind(rule)"
                  :active="rule.enabled"
                  :size="20"
                  :title="ruleKindLabel(rule)"
                />
                <div class="rule-row-main">
                  <div class="rule-row-title">
                    <span class="rule-row-name">{{ rule.name }}</span>
                    <span class="rule-row-sub">{{ ruleKindLabel(rule) }}</span>
                  </div>
                  <div class="rule-row-cond">
                    <span class="cond-badge" :class="`cond-badge-${conditionKindOf(rule)}`">{{ conditionKindLabelOf(rule) }}</span>
                    <span class="cond-text">{{ conditionTextOf(rule) }}</span>
                    <span class="cond-arrow" aria-hidden="true">→</span>
                    <span class="action-text">{{ actionTextOf(rule) }}</span>
                  </div>
                </div>
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

    <ZoneNotesPanel
      :show="showZoneNotes"
      :zone-id="zoneNotesGroup?.id || ''"
      :zone-name="zoneNotesGroup?.name || ''"
      @close="showZoneNotes = false"
      @changed="loadNoteCounts"
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

    <!-- 게이트웨이 추가 모달 -->
    <div v-if="addGwModalGroup" class="modal-overlay" @click.self="closeAddGwModal">
      <div class="modal-sm">
        <div class="modal-sm-header">
          <h3>라즈베리파이 추가</h3>
          <button class="btn-icon" @click="closeAddGwModal">✕</button>
        </div>
        <p class="modal-sm-desc">{{ addGwModalGroup.name }} 구역에 추가할 라즈베리파이를 선택하세요.</p>
        <div v-if="addGwAvailable.length === 0" class="modal-empty">할당 가능한 게이트웨이가 없습니다.</div>
        <div v-else class="gw-pick-list">
          <div
            v-for="gw in addGwAvailable"
            :key="gw.id"
            class="gw-pick-item"
            :class="{ selected: addGwSelectedIds.includes(gw.id) }"
            @click="toggleAddGw(gw.id)"
          >
            <input type="checkbox" :checked="addGwSelectedIds.includes(gw.id)" @click.stop @change="toggleAddGw(gw.id)" />
            <span class="gw-pick-name">{{ gw.name }}</span>
            <span class="gw-pick-id">{{ gw.gatewayId }}</span>
            <span :class="['status-dot-sm', gw.agentStatus === 'online' || gw.status === 'online' ? 'online' : 'offline']"></span>
          </div>
        </div>
        <div class="modal-sm-footer">
          <button class="btn-secondary btn-sm" @click="closeAddGwModal">취소</button>
          <button class="btn-primary btn-sm" :disabled="addGwSelectedIds.length === 0 || addGwLoading" @click="confirmAddGateways">
            {{ addGwLoading ? '추가 중...' : `추가 (${addGwSelectedIds.length})` }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useGroupStore } from '../stores/group.store'
import { useDeviceStore } from '../stores/device.store'
import { useAutomationStore } from '../stores/automation.store'
import { useAuthStore } from '../stores/auth.store'
import GroupCreation from '@/components/groups/GroupCreation.vue'
import AddDeviceModal from '@/components/groups/AddDeviceModal.vue'
import IrrigationStatusModal from '@/components/devices/IrrigationStatusModal.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import EquipmentIcon from '@/components/common/EquipmentIcon.vue'
import EnvConfigModal from '@/components/groups/EnvConfigModal.vue'
import ZoneNotesPanel from '@/components/groups/ZoneNotesPanel.vue'
import { zoneNotesApi } from '@/api/zone-notes.api'
import RemoveDeviceModal from '@/components/groups/RemoveDeviceModal.vue'
import AutomationEditModal from '@/components/automation/AutomationEditModal.vue'
import DeleteBlockingModal from '@/components/common/DeleteBlockingModal.vue'
import { useConfirm } from '../composables/useConfirm'
import { useNotificationStore } from '../stores/notification.store'
import { groupApi } from '../api/group.api'
import { deviceApi } from '../api/device.api'
import { gatewayApi } from '@/api/gateway.api'
import type { HouseGroup } from '../types/group.types'
import type { Gateway } from '../types/device.types'
import type { Device, DependencyRule, ChannelMapping } from '../types/device.types'
import { FUNCTION_LABELS } from '../types/device.types'
import type { AutomationRule } from '../types/automation.types'
import { formatConditionGroup, isIrrigationConditions, formatIrrigationSchedule, formatIrrigationZones } from '../utils/automation-helpers'

const route = useRoute()
useRouter()
const groupStore = useGroupStore()
const deviceStore = useDeviceStore()
const automationStore = useAutomationStore()
const authStore = useAuthStore()
const { isFarmUser, isAdmin } = authStore
const { confirm } = useConfirm()
const notify = useNotificationStore()
const showGroupCreationModal = ref(false)

// 구역명/설명 인라인 편집
const renamingGroupId = ref<string | null>(null)
const renameGroupValue = ref('')
const renameDescValue = ref('')
const renameGroupInput = ref<HTMLInputElement | null>(null)

function startRenameGroup(groupId: string, currentName: string, currentDesc?: string) {
  renamingGroupId.value = groupId
  renameGroupValue.value = currentName
  renameDescValue.value = currentDesc ?? ''
  nextTick(() => renameGroupInput.value?.focus())
}

function cancelRenameGroup() {
  renamingGroupId.value = null
  renameGroupValue.value = ''
  renameDescValue.value = ''
}

async function submitRenameGroup(group: HouseGroup) {
  const trimmed = renameGroupValue.value.trim()
  if (!trimmed) { cancelRenameGroup(); return }
  try {
    await groupApi.updateGroup(group.id, { name: trimmed, description: renameDescValue.value.trim() || undefined })
    await groupStore.fetchGroups()
    notify.success('수정 완료', `구역 정보가 저장되었습니다`)
  } catch {
    notify.error('수정 실패', '저장에 실패했습니다')
  } finally {
    cancelRenameGroup()
  }
}

// 장치명 인라인 편집 (sub-card 안)
const renamingDeviceId = ref<string | null>(null)
const renameDeviceValue = ref('')
const renamingOpenerGroup = ref<string | null>(null)

function startDeviceRename(deviceId: string, currentName: string) {
  renamingDeviceId.value = deviceId
  renameDeviceValue.value = currentName
}

function startOpenerGroupRename(og: { groupName: string; openDevice: Device; closeDevice: Device }) {
  renamingOpenerGroup.value = og.groupName
  renameDeviceValue.value = og.groupName
}

function cancelDeviceRename() {
  // blur 이벤트와 클릭 충돌 방지를 위해 약간 지연
  setTimeout(() => {
    renamingDeviceId.value = null
    renamingOpenerGroup.value = null
    renameDeviceValue.value = ''
  }, 150)
}

async function submitDeviceRename(deviceId: string) {
  const trimmed = renameDeviceValue.value.trim()
  if (!trimmed) { cancelDeviceRename(); return }
  try {
    const { data } = await deviceApi.rename(deviceId, trimmed)
    const device = deviceStore.devices.find(d => d.id === deviceId)
    if (device) device.name = data.name
    await groupStore.fetchGroups()
    notify.success('이름 변경 완료', `"${data.name}"으로 변경되었습니다`)
  } catch {
    notify.error('이름 변경 실패', '저장에 실패했습니다')
  } finally {
    renamingDeviceId.value = null
    renameDeviceValue.value = ''
  }
}

async function submitOpenerGroupRename(og: { groupName: string; openDevice: Device; closeDevice: Device }) {
  const trimmed = renameDeviceValue.value.trim()
  if (!trimmed) { cancelDeviceRename(); return }
  try {
    // 개폐기는 열림/닫힘 두 device의 openerGroupName이 함께 이름이므로
    // openDevice를 새 이름으로 + 두 device의 이름도 업데이트
    await Promise.all([
      deviceApi.rename(og.openDevice.id, `${trimmed} 열기`),
      deviceApi.rename(og.closeDevice.id, `${trimmed} 닫기`),
    ])
    await groupStore.fetchGroups()
    notify.success('이름 변경 완료', `"${trimmed}"으로 변경되었습니다`)
  } catch {
    notify.error('이름 변경 실패', '저장에 실패했습니다')
  } finally {
    renamingOpenerGroup.value = null
    renameDeviceValue.value = ''
  }
}

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

// 장치 추가 모달
const showAddDeviceModal = ref(false)
const addDeviceTargetGroup = ref<HouseGroup | null>(null)

// 게이트웨이 목록
const gateways = ref<Gateway[]>([])

async function loadGateways() {
  try {
    const res = await gatewayApi.getAll()
    gateways.value = res.data as unknown as Gateway[]
  } catch { /* ignore */ }
}

function getGroupGateways(group: HouseGroup): Gateway[] {
  const houseIds = new Set(group.houses.map(h => h.id))
  return gateways.value.filter(gw => gw.houseId && houseIds.has(gw.houseId))
}

// 게이트웨이 추가 모달
const addGwModalGroup = ref<HouseGroup | null>(null)
const addGwSelectedIds = ref<string[]>([])
const addGwLoading = ref(false)

function openAddGatewayModal(group: HouseGroup) {
  addGwModalGroup.value = group
  addGwSelectedIds.value = []
}

function closeAddGwModal() {
  addGwModalGroup.value = null
  addGwSelectedIds.value = []
}

function toggleAddGw(id: string) {
  const idx = addGwSelectedIds.value.indexOf(id)
  if (idx === -1) addGwSelectedIds.value.push(id)
  else addGwSelectedIds.value.splice(idx, 1)
}

// 이미 이 구역에 할당된 게이트웨이는 목록에서 제외
const addGwAvailable = computed(() => {
  if (!addGwModalGroup.value) return []
  const assignedIds = new Set(getGroupGateways(addGwModalGroup.value).map(g => g.id))
  return gateways.value.filter(g => !assignedIds.has(g.id))
})

async function confirmAddGateways() {
  if (!addGwModalGroup.value || addGwSelectedIds.value.length === 0) return
  addGwLoading.value = true
  try {
    for (const gwId of addGwSelectedIds.value) {
      await gatewayApi.assignZone(gwId, addGwModalGroup.value.id)
    }
    await loadGateways()
    await groupStore.fetchGroups()
    notify.success('추가 완료', `게이트웨이 ${addGwSelectedIds.value.length}개가 추가되었습니다.`)
    closeAddGwModal()
  } catch (e: any) {
    const status = e?.response?.status
    const msg = e?.response?.data?.message || '게이트웨이 추가에 실패했습니다.'
    notify.error(status === 409 ? '이미 할당된 게이트웨이' : '오류', msg)
  } finally {
    addGwLoading.value = false
  }
}

onMounted(async () => {
  await Promise.all([
    groupStore.fetchGroups(),
    deviceStore.fetchDevices(),
    automationStore.fetchRules(),
    loadGateways(),
  ])
  automationStore.fetchIrrigationStatus()
  loadNoteCounts()
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

// 관수 장치
const getGroupIrrigationDevices = (group: HouseGroup): Device[] => {
  return (group.devices || [])
    .filter(d => d.equipmentType === 'irrigation')
    .map(d => {
      const storeDevice = deviceStore.devices.find(sd => sd.id === d.id)
      return storeDevice ? { ...d, ...storeDevice } : d
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
      notify.warning('상태 미변경', '명령은 전달되었으나 장치 상태가 변경되지 않았습니다')
      if (!storeDevice.switchStates) storeDevice.switchStates = {}
      storeDevice.switchStates[switchCode] = verification.actualValue
    } else {
      notify.warning('상태 확인 실패', '장치 상태를 확인할 수 없습니다')
    }

    // FR-04: 원격제어 OFF 후 설정 일괄 비활성화
    if (isRemoteControl && !newVal) {
      const bulkResult = await automationStore.bulkDisableByDevice(device.id)
      if (bulkResult.disabledCount > 0) {
        notify.info('자동 제어 비활성화', `자동 제어 설정 ${bulkResult.disabledCount}개가 비활성화되었습니다`)
      }
    }
    // 관주 상태 갱신
    if (isRemoteControl) {
      await automationStore.fetchIrrigationStatus()
    }
  } catch (err: any) {
    console.error('관주 장치 제어 실패:', err)
    notify.remove(loadingId)
    notify.error('제어 실패', '네트워크 오류가 발생했습니다')
  } finally {
    irrigationControlling.value = null
  }
}

const SENSOR_LABELS: Record<string, string> = {
  temperature: '온도', humidity: '습도', co2: 'CO2',
  rainfall: '강우량', uv: 'UV', dew_point: '이슬점',
  rain_detection: '비 감지', pressure: '기압',
}

// 배터리형 이벤트 센서 모델 → 기본 channel 매핑 (sensor_data 이력이 없어도 안정 상태 표시)
const EVENT_SENSOR_MODEL_FIELD: Record<string, string> = {
  TS0207: 'rain_detection',
}

function isEventSensor(device: any): boolean {
  return !!EVENT_SENSOR_MODEL_FIELD[device?.zigbeeModel]
}
function eventSensorField(device: any): string {
  return EVENT_SENSOR_MODEL_FIELD[device?.zigbeeModel] || ''
}

// 우적/비 감지 센서 — EquipmentIcon 'rain' 타입 사용 (DeviceStatusCards와 동일 로직)
function isRainSensor(device: any): boolean {
  // 1) sensorData에 rain_* 필드 존재
  const data = device?.sensorData as any
  if (data && ('rain_detection' in data || 'rain_intensity' in data || 'rainfall' in data)) return true
  // 2) 모델/이름 기반 (페어링 직후 reading 없어도 아이콘 표시)
  const model = (device?.zigbeeModel || '').toLowerCase()
  if (model.includes('ts0207') || model.includes('rain')) return true
  const name = (device?.name || '').toLowerCase()
  if (name.includes('우적') || name.includes('rain')) return true
  return false
}

const ALLOWED_SENSOR_FIELDS = new Set(['temperature', 'humidity', 'co2', 'rainfall', 'uv', 'dew_point', 'rain_detection', 'pressure'])

function getTopSensorData(sensorData: Record<string, number | null | undefined>): Record<string, number> {
  const entries = Object.entries(sensorData).filter(([k, v]) => v != null && ALLOWED_SENSOR_FIELDS.has(k)) as [string, number][]
  return Object.fromEntries(entries)
}

const formatSensorVal = (field: string, value: number): string => {
  if (value == null) return '-'
  if (field === 'rain_detection') return value > 0 ? '🌧 감지' : '☀ 정상'
  if (['temperature', 'dew_point', 'ph', 'ec', 'rainfall'].includes(field)) return value.toFixed(1)
  if (['co2', 'light'].includes(field)) return Math.round(value).toLocaleString()
  return Math.round(value).toString()
}

const getSensorUnit = (field: string): string => {
  const units: Record<string, string> = {
    temperature: '°C', humidity: '%', co2: 'ppm', rainfall: 'mm',
    uv: '', dew_point: '°C', light: 'lux',
    soil_moisture: '%', ph: '', ec: 'mS/cm',
    rain_detection: '', pressure: 'hPa',
  }
  return units[field] || ''
}

// 장치 제어
const controllingId = ref<string | null>(null)
const openerInterlocking = ref(false)
// 개폐기 자동 OFF 타이머 추적 (인터록에서 OFF 명령 취소용)
const openerAutoOffTimers = new Map<string, ReturnType<typeof setTimeout>>()
// (직접 제어 시에는 자동 OFF 없음 — 자동제어 룰에서만 동작/대기 시간 적용됨)

async function handleOpenerInterlock(group: OpenerGroupInfo, action: 'open' | 'close') {
  if (openerInterlocking.value) return
  const targetDevice = action === 'open' ? group.openDevice : group.closeDevice
  const oppositeDevice = action === 'open' ? group.closeDevice : group.openDevice

  openerInterlocking.value = true
  const loadingId = notify.add('info', '적용 중...', `${targetDevice.name} ${action === 'open' ? '열림' : '닫힘'} 명령 전송 중`, 0)
  try {
    // 이미 ON이면 OFF만 (자동 타이머도 취소)
    if (targetDevice.switchState) {
      if (openerAutoOffTimers.has(targetDevice.id)) {
        clearTimeout(openerAutoOffTimers.get(targetDevice.id))
        openerAutoOffTimers.delete(targetDevice.id)
      }
      const result = await deviceStore.controlDevice(targetDevice.id, [{ code: 'switch_1', value: false }])
      if (!result.success) {
        notify.remove(loadingId)
        notify.error('제어 실패', result.msg || '장치 제어에 실패했습니다')
        return
      }
      const storeTarget = deviceStore.devices.find(d => d.id === targetDevice.id)
      if (storeTarget) storeTarget.switchState = false
      const v = await deviceStore.verifyDeviceStatus(targetDevice.id, 'switch_1', false)
      notify.remove(loadingId)
      if (v.verified) {
        notify.success('적용 완료', `${targetDevice.name} OFF`)
      } else if (v.actualValue !== undefined) {
        notify.warning('상태 미변경', '명령은 전달되었으나 장치 상태가 변경되지 않았습니다')
        if (storeTarget) storeTarget.switchState = v.actualValue
      }
      return
    }
    // 반대쪽이 ON이면: 먼저 OFF → 3초 대기 (릴레이 접점 아크 소멸 + 안전 간격)
    if (oppositeDevice.switchState) {
      const offResult = await deviceStore.controlDevice(oppositeDevice.id, [{ code: 'switch_1', value: false }])
      if (!offResult.success) {
        notify.remove(loadingId)
        notify.error('제어 실패', offResult.msg || '장치 제어에 실패했습니다')
        return
      }
      const storeOpposite = deviceStore.devices.find(d => d.id === oppositeDevice.id)
      if (storeOpposite) storeOpposite.switchState = false
      await new Promise(resolve => setTimeout(resolve, 3000))
    }
    // 타겟 ON
    const result = await deviceStore.controlDevice(targetDevice.id, [{ code: 'switch_1', value: true }])
    if (!result.success) {
      notify.remove(loadingId)
      notify.error('제어 실패', result.msg || '장치 제어에 실패했습니다')
      return
    }
    const storeTarget = deviceStore.devices.find(d => d.id === targetDevice.id)
    if (storeTarget) storeTarget.switchState = true
    const v = await deviceStore.verifyDeviceStatus(targetDevice.id, 'switch_1', true)
    notify.remove(loadingId)
    if (v.verified) {
      notify.success('적용 완료', `${targetDevice.name} ${action === 'open' ? '열림' : '닫힘'}`)
      // 직접 제어 시 자동 OFF 없음 — 자동제어 룰에서만 동작/대기 시간 적용
      // (개폐기 본체에 리밋이 있어 안전, 사용자는 수동으로 OFF 가능)
    } else if (v.actualValue !== undefined) {
      notify.warning('상태 미변경', '명령은 전달되었으나 장치 상태가 변경되지 않았습니다')
      if (storeTarget) storeTarget.switchState = v.actualValue
    }
  } catch (err) {
    console.error('인터록 제어 실패:', err)
    notify.remove(loadingId)
    notify.error('제어 실패', '네트워크 오류가 발생했습니다')
  } finally {
    openerInterlocking.value = false
  }
}

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

// 자동화 룰
const getGroupRules = (groupId: string): AutomationRule[] =>
  automationStore.rules.filter(r => r.groupId === groupId)

const getGroupRulesActiveCount = (groupId: string): number =>
  getGroupRules(groupId).filter(r => r.enabled).length

// getRuleSummary: 이전 디자인에서 사용 — D2 디자인은 conditionTextOf + actionTextOf로 대체.
const _getRuleSummary = (rule: AutomationRule): string => {
  const condText = formatConditionGroup(rule.conditions)
  const actions = rule.actions as any
  const cmd = actions?.command === 'on' ? 'ON' : actions?.command === 'off' ? 'OFF' : ''
  const count = actions?.targetDeviceIds?.length || 0
  if (count > 0 && cmd) return `${condText} → ${count}개 장치 ${cmd}`
  return condText
}
void _getRuleSummary

// ── D2 디자인 보조 (Automation.vue와 동일 패턴) ──
type RuleKind = 'opener' | 'fan' | 'irrigation' | 'other'
function detectRuleKind(rule: AutomationRule): RuleKind {
  const actions = rule.actions as any
  const deviceIds: string[] = actions?.targetDeviceIds || (actions?.targetDeviceId ? [actions.targetDeviceId] : [])
  for (const id of deviceIds) {
    const device = deviceStore.devices.find(d => d.id === id)
    const et = device?.equipmentType
    if (!et) continue
    if (et === 'opener_open' || et === 'opener_close') return 'opener'
    if (et === 'fan' || et === 'irrigation') return et
  }
  return 'other'
}
const RULE_KIND_LABELS: Record<RuleKind, string> = {
  opener: '개폐기',
  fan: '환풍기',
  irrigation: '관주',
  other: '기타',
}
function ruleKindLabel(rule: AutomationRule): string {
  return RULE_KIND_LABELS[detectRuleKind(rule)]
}

const CONDITION_KIND_LABELS: Record<string, string> = {
  time: '시간',
  weather: '날씨',
  hybrid: '복합',
  irrigation: '관주 일정',
}
function conditionKindOf(rule: AutomationRule): 'time' | 'weather' | 'hybrid' | 'irrigation' {
  if (isIrrigationConditions(rule.conditions)) return 'irrigation'
  return (rule.ruleType as any) ?? 'time'
}
function conditionKindLabelOf(rule: AutomationRule): string {
  return CONDITION_KIND_LABELS[conditionKindOf(rule)] || ''
}
function conditionTextOf(rule: AutomationRule): string {
  if (isIrrigationConditions(rule.conditions)) return formatIrrigationSchedule(rule.conditions)
  return formatConditionGroup(rule.conditions)
}
function actionTextOf(rule: AutomationRule): string {
  if (isIrrigationConditions(rule.conditions)) return formatIrrigationZones(rule.conditions)
  const actions = rule.actions as any
  const deviceIds: string[] = actions?.targetDeviceIds || (actions?.targetDeviceId ? [actions.targetDeviceId] : [])
  const names: string[] = []
  for (const id of deviceIds) {
    const device = deviceStore.devices.find(d => d.id === id)
    if (device) names.push(device.name)
  }
  if (names.length === 0) return '대상 장치 없음'
  let suffix = ''
  if (actions?.command) {
    const cmd = String(actions.command).toLowerCase()
    if (cmd === 'on' || cmd === 'open') suffix = ' ON'
    else if (cmd === 'off' || cmd === 'close') suffix = ' OFF'
  }
  return `${names.join(', ')}${suffix}`
}

const toggleRule = async (ruleId: string) => {
  try {
    const rule = automationStore.rules.find(r => r.id === ruleId)
    const newState = rule ? !rule.enabled : true
    // FR-03: 관주 설정 활성화 시 원격제어 자동 ON
    const isIrrigationEnable = newState && (rule?.conditions as any)?.type === 'irrigation'
    await automationStore.toggleRule(ruleId, isIrrigationEnable ? { autoEnableRemote: true } : undefined)

    if ((rule?.conditions as any)?.type === 'irrigation') {
      // 관주 설정 활성화 시: 원격제어 + B접점 낙관적 즉시 반영 (전파 지연 우회)
      if (isIrrigationEnable) {
        const actions = rule?.actions as any
        const deviceIds: string[] = [
          ...(Array.isArray(actions?.targetDeviceIds) ? actions.targetDeviceIds : []),
          ...(actions?.targetDeviceId ? [actions.targetDeviceId] : []),
        ]
        for (const deviceId of deviceIds) {
          const device = deviceStore.devices.find(d => d.id === deviceId)
          if (device) {
            const mapping = deviceStore.getEffectiveMapping(device)
            if (!device.switchStates) device.switchStates = {}
            if (mapping['remote_control']) device.switchStates[mapping['remote_control']] = true
            if (mapping['fertilizer_b_contact']) device.switchStates[mapping['fertilizer_b_contact']] = true
          }
        }
      }
      // 설정 토글 후 장치 상태 + 관주 상태 갱신
      await Promise.all([
        automationStore.fetchIrrigationStatus(),
        deviceStore.fetchDevices(),
      ])
    }
  } catch (err) {
    console.error('설정 토글 실패:', err)
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
    title: '구역 삭제',
    message: `"${group.name}" 구역을 삭제하시겠습니까?`,
    confirmText: '삭제',
    variant: 'danger',
  })
  if (!ok) return
  try {
    await groupStore.removeGroup(group.id)
  } catch (err) {
    console.error('구역 삭제 실패:', err)
    alert('구역 삭제에 실패했습니다.')
  }
}

// ── 장치 제거 모달 ──
const showRemoveDeviceModal = ref(false)
const removeTargetGroup = ref<HouseGroup | null>(null)



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


// ── 환경설정 ──
const showEnvConfigModal = ref(false)
const envConfigGroup = ref<HouseGroup | null>(null)

function openEnvConfig(group: HouseGroup) {
  envConfigGroup.value = group
  showEnvConfigModal.value = true
}

// ── 구역 메모 ──
const showZoneNotes = ref(false)
const zoneNotesGroup = ref<HouseGroup | null>(null)
const noteCounts = ref<Record<string, number>>({})

function noteCount(zoneId: string): number {
  return noteCounts.value[zoneId] || 0
}
function openZoneNotes(group: HouseGroup) {
  zoneNotesGroup.value = group
  showZoneNotes.value = true
}
async function loadNoteCounts() {
  try {
    const res = await zoneNotesApi.counts()
    noteCounts.value = res.data
  } catch {
    /* 무시 — 배지 미표시 */
  }
}

// 모달 열림 시 배경 스크롤 차단
const anyModalOpen = computed(() => showAddDeviceModal.value || showEnvConfigModal.value || showIrrigationStatusModal.value || showRemoveDeviceModal.value || showZoneNotes.value)
watch(anyModalOpen, (open) => {
  document.body.style.overflow = open ? 'hidden' : ''
})
// 관수 가동 중 상태 폴링 (15초 간격)
let statusPollTimer: ReturnType<typeof setInterval> | null = null
function startStatusPolling() {
  if (statusPollTimer) return
  statusPollTimer = setInterval(async () => {
    await Promise.all([
      automationStore.fetchIrrigationStatus(),
      deviceStore.fetchDevices(),
    ])
  }, 15000)
}
function stopStatusPolling() {
  if (statusPollTimer) {
    clearInterval(statusPollTimer)
    statusPollTimer = null
  }
}
watch(() => automationStore.irrigationStatus, (statuses) => {
  const hasRunning = statuses.some(s => s.isRunning || s.enabledRuleCount > 0)
  if (hasRunning) startStatusPolling()
  else stopStatusPolling()
}, { immediate: true })

onBeforeUnmount(() => {
  document.body.style.overflow = ''
  stopStatusPolling()
  // 남은 개폐기 자동 OFF 타이머 모두 취소
  for (const timerId of openerAutoOffTimers.values()) clearTimeout(timerId)
  openerAutoOffTimers.clear()
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

.farm-owner-badge {
  display: inline-block;
  font-size: 11px;
  font-weight: 600;
  color: #6366f1;
  background: rgba(99, 102, 241, 0.1);
  border: 1px solid rgba(99, 102, 241, 0.25);
  border-radius: 10px;
  padding: 2px 10px;
  margin-bottom: 4px;
}

.group-title h3 {
  font-size: calc(18px * var(--content-scale, 1));
  font-weight: 600;
  color: var(--text-primary);
  display: inline;
}

.btn-rename-group {
  background: none; border: none; color: var(--text-secondary);
  font-size: 14px; cursor: pointer; padding: 0 4px;
  vertical-align: middle; opacity: 0.6;
}
.btn-rename-group:hover { opacity: 1; color: var(--accent, #4caf50); }

/* sub-card 안 미니 이름 편집 버튼 */
.btn-rename-mini {
  background: none; border: none; color: var(--text-muted);
  font-size: 12px; cursor: pointer; padding: 0 4px;
  opacity: 0.5; vertical-align: middle;
}
.btn-rename-mini:hover { opacity: 1; color: var(--accent, #4caf50); }
.btn-rename-ok {
  background: var(--accent, #4caf50); color: #fff; border: none;
  border-radius: 4px; padding: 2px 8px; font-size: 12px; cursor: pointer;
  margin-left: 4px;
}
.rename-input-inline {
  padding: 2px 6px; border: 1px solid var(--accent, #4caf50);
  border-radius: 4px; font-size: 13px; font-weight: 600;
  background: var(--bg-input); color: var(--text-primary);
  outline: none; flex: 1; min-width: 100px;
}

.rename-form {
  display: flex; flex-direction: column; gap: 6px; min-width: 240px;
}
.rename-actions { display: flex; gap: 6px; }

.rename-group-input {
  padding: 5px 10px; border: 1px solid var(--accent, #4caf50);
  border-radius: 6px; font-size: calc(15px * var(--content-scale, 1));
  font-weight: 600; background: var(--bg-primary); color: var(--text-primary);
  outline: none; width: 100%;
}

.rename-desc-input {
  padding: 4px 10px; border: 1px solid var(--border-color, #d1d5db);
  border-radius: 6px; font-size: calc(13px * var(--content-scale, 1));
  background: var(--bg-primary); color: var(--text-secondary);
  outline: none; width: 100%;
}
.rename-desc-input:focus { border-color: var(--accent, #4caf50); }

.btn-rename-ok {
  padding: 4px 12px; border: none;
  background: var(--accent, #4caf50); color: #fff;
  border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer;
}
.btn-rename-cancel {
  padding: 4px 10px; border: 1px solid var(--border-color, #d1d5db);
  background: transparent; color: var(--text-secondary);
  border-radius: 6px; font-size: 12px; cursor: pointer;
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

/* 구역 메모 버튼 — 메모 있으면 초록, 없으면 회색. 고정 점 없음. */
.btn-memo {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 44px;
  padding: 0 14px;
  border: none;
  border-radius: 12px;
  background: #f4f4f6;
  color: var(--text-secondary);
  font-size: calc(13px * var(--content-scale, 1));
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.2s, color 0.2s;
}
.btn-memo svg { width: 17px; height: 17px; }
.btn-memo:hover { background: var(--bg-active); }
.btn-memo.has-notes { background: #e8f5e9; color: #2e7d32; }
.btn-memo .memo-count {
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 999px;
  background: #2e7d32;
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-variant-numeric: tabular-nums;
}
#app.theme-dark .btn-memo { background: var(--bg-hover); color: var(--text-secondary); }
#app.theme-dark .btn-memo.has-notes { background: var(--accent-bg); color: var(--accent); }

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
.section-label.gateway { background: #e0f2fe; color: #0369a1; }

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
/* actuator는 기본 초록(primary) — 유동팬/기타 장치 */
.type-tag.actuator { background: var(--accent-bg); color: var(--accent); }
/* 개폐기 = 주황 */
.type-tag.type-tag-opener {
  background: color-mix(in srgb, var(--device-opener, #ff9800) 14%, transparent);
  color: var(--device-opener, #b45309);
}
/* 관주 = 파랑/cyan */
.type-tag.type-tag-irrigation {
  background: color-mix(in srgb, var(--device-irrigation, #00bcd4) 14%, transparent);
  color: #0277bd;
}

/* 수동 우회 배지 — 자동제어 룰 의도와 다르게 수동 조작된 상태 표시 */
.manual-override-badge {
  display: inline-flex; align-items: center; gap: 3px;
  font-size: calc(11px * var(--content-scale, 1));
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 6px;
  background: rgba(245,158,11,.14);
  color: #b45309;
  white-space: nowrap;
  flex-shrink: 0;
}

.sub-card-sensor-chips {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.sensor-chip {
  display: inline-block;
  padding: 3px 10px;
  background: var(--sensor-value-bg, var(--sensor-bg));
  border-radius: 14px;
  font-size: var(--font-size-caption);
  color: var(--sensor-accent);
  white-space: nowrap;
}

.sensor-chip b {
  font-weight: 700;
  margin-left: 2px;
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

/* 관수 원격제어 (자동화 섹션 내) */
.irrigation-remote-section {
  background: var(--bg-hover);
  border-radius: 10px;
  margin-bottom: 8px;
}
.irrigation-remote-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border-light);
}
.irrigation-remote-row:last-child { border-bottom: none; }
.irrigation-remote-label {
  font-size: calc(13px * var(--content-scale, 1));
  font-weight: 600;
  color: var(--text-secondary);
}

/* 자동화 룰 */
.rules-list {
  background: var(--bg-hover);
  border-radius: 10px;
  overflow: hidden;
}

/* D2: 자동제어 설정 페이지(Automation.vue)와 동일한 컴팩트 행 패턴 */
.rules-list.zone-card {
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: 14px;
  box-shadow: var(--shadow-card);
}

.rules-active-meta {
  font-size: calc(12px * var(--content-scale, 1));
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
  font-weight: 500;
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
.rule-name { font-size: var(--font-size-label) !important; font-weight: 600; color: var(--text-primary); white-space: nowrap; }
.rule-summary { flex: 1; color: var(--text-muted); font-size: calc(13px * var(--content-scale, 1)); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* D2 컴팩트 행 — Automation.vue와 동일 패턴 */
.rule-row.d2 {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 14px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border-light);
  cursor: pointer;
  transition: background 0.12s;
}
.rule-row.d2:last-child { border-bottom: none; }
.rule-row.d2:hover { background: var(--bg-hover); }
.rule-row.d2.is-off { opacity: 0.72; }

.rule-row.d2 .rule-row-main { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.rule-row.d2 .rule-row-title { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.rule-row.d2 .rule-row-name {
  font-size: calc(15px * var(--content-scale, 1));
  font-weight: 600;
  color: var(--text-primary);
}
.rule-row.d2 .rule-row-sub {
  font-size: calc(12px * var(--content-scale, 1));
  color: var(--text-muted);
}
.rule-row.d2 .rule-row-cond {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  font-size: calc(13px * var(--content-scale, 1));
  color: var(--text-secondary);
  line-height: 1.5;
}
.rule-row.d2 .cond-text { color: var(--text-secondary); }
.rule-row.d2 .cond-arrow { color: var(--text-muted); font-weight: 700; }
.rule-row.d2 .action-text { color: var(--text-primary); font-weight: 500; }

.rule-row.d2 .cond-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: calc(11px * var(--content-scale, 1));
  font-weight: 700;
  letter-spacing: 0.02em;
  flex-shrink: 0;
}
.rule-row.d2 .cond-badge-time      { background: rgba(21,101,192,.10);  color: #1565c0; }
.rule-row.d2 .cond-badge-weather   { background: rgba(2,119,189,.10);   color: #0277bd; }
.rule-row.d2 .cond-badge-hybrid    { background: rgba(106,27,154,.10);  color: #6a1b9a; }
.rule-row.d2 .cond-badge-irrigation{ background: rgba(0,131,143,.10);   color: #00838f; }

@media (max-width: 768px) {
  .rule-row.d2 {
    grid-template-columns: auto 1fr auto;
    gap: 10px;
    padding: 13px 14px;
    min-height: 44px;
  }
  .rule-row.d2 .rule-row-name { font-size: calc(14px * var(--content-scale, 1)); }
  .rule-row.d2 .rule-row-cond { font-size: calc(12px * var(--content-scale, 1)); gap: 6px; }
}

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
.btn-env {
  background: transparent;
  border: 1px solid var(--border-color, #d1d5db);
  color: var(--text-secondary, #555);
  border-radius: 6px;
  cursor: pointer;
}
.btn-env:hover { background: var(--bg-hover, #f3f4f6); }

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

/* Gateway section */
.gateway-section-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.btn-add-gw {
  background: #e0f2fe; border: none; color: #0369a1; border-radius: 6px;
  cursor: pointer; font-size: 12px; padding: 3px 10px;
}
.btn-add-gw:hover { background: #bae6fd; }
.gw-card { display: flex; flex-direction: column; gap: 6px; }
.gw-card-meta { font-size: 11px; color: var(--text-secondary); font-family: monospace; }
.gw-id-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: block; }
.gw-empty-hint {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 14px; font-size: 13px;
  color: var(--text-secondary); background: var(--bg-hover);
  border-radius: 8px;
}

/* Gateway add modal */
.modal-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,.5);
  display: flex; align-items: center; justify-content: center; z-index: 1000;
}
.modal-sm {
  background: var(--bg-card); border-radius: 14px; padding: 24px;
  width: 440px; max-width: 92vw; max-height: 80vh;
  display: flex; flex-direction: column; gap: 14px;
  border: 1px solid var(--border-color);
}
.modal-sm-header { display: flex; justify-content: space-between; align-items: center; }
.modal-sm-header h3 { margin: 0; font-size: 17px; font-weight: 700; }
.modal-sm-desc { font-size: 13px; color: var(--text-secondary); margin: 0; }
.modal-empty { font-size: 13px; color: var(--text-muted); padding: 16px; text-align: center; background: var(--bg-secondary); border-radius: 8px; }
.gw-pick-list { display: flex; flex-direction: column; gap: 6px; overflow-y: auto; max-height: 260px; }
.gw-pick-item {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px; border: 1.5px solid var(--border-input);
  border-radius: 8px; cursor: pointer;
}
.gw-pick-item:hover { background: var(--bg-hover); }
.gw-pick-item.selected { border-color: #3b82f6; background: rgba(59,130,246,.05); }
.gw-pick-name { flex: 1; font-size: 14px; font-weight: 600; }
.gw-pick-id { font-size: 11px; color: var(--text-secondary); font-family: monospace; }
.status-dot-sm { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.status-dot-sm.online { background: #22c55e; }
.status-dot-sm.offline { background: #d1d5db; }
.modal-sm-footer { display: flex; gap: 8px; justify-content: flex-end; }

@media (max-width: 768px) {
  .page-container { padding: 16px; }
  .page-header h2 { font-size: calc(24px * var(--content-scale, 1)); }
  .device-sub-grid { grid-template-columns: 1fr; }
  .group-header { flex-direction: column; align-items: flex-start; }
  .group-header-actions { width: 100%; justify-content: flex-end; }
  .btn-icon { min-width: 44px; min-height: 44px; }
  .btn-sm { padding: 0 18px; line-height: 1.8; }
  .btn-status-sm { padding: 0 18px; line-height: 1.8; }
  .device-count-badge { padding: 0 18px; line-height: 1.8; }
  .type-tag { padding: 0 18px; line-height: 1.8; }
  .group-card { padding: 0; }
  .group-header { padding: 14px; }
  .group-body { padding: 0 14px 14px; }
}
</style>
