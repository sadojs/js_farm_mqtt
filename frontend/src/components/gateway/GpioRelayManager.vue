<template>
  <div class="gpio-manager">

    <!-- 상태 요약 바 -->
    <div class="summary-grid">
      <div v-for="s in summaryItems" :key="s.label" class="summary-card">
        <div class="summary-value" :style="{ color: s.color }">{{ s.value }}</div>
        <div class="summary-label">{{ s.label }}</div>
      </div>
    </div>

    <!-- 핀 충돌 경고 -->
    <div v-if="conflictPins.length > 0" class="conflict-banner">
      ⚠ GPIO 핀 충돌: BCM {{ uniqueConflictPins.join(', ') }} — 중복 배정된 핀이 있습니다.
    </div>

    <!-- 장치 추가 버튼 -->
    <div class="toolbar">
      <span class="toolbar-hint">장치를 자유롭게 추가하고 GPIO 핀을 배정하세요</span>
      <button class="btn-add-device" @click="showAddModal = true">+ 장치 추가</button>
    </div>

    <!-- 장치 목록 (플랫) -->
    <div v-if="deviceGroups.length === 0" class="empty-state">
      <div class="empty-icon">📭</div>
      <div class="empty-title">등록된 장치가 없습니다</div>
      <div class="empty-hint">상단 "+ 장치 추가" 버튼으로 장치를 추가하세요</div>
    </div>

    <div v-for="group in deviceGroups" :key="group.groupId" class="device-card"
      :style="{ '--type-color': typeMeta(group.type).color }"
      :class="{ 'card-enabled': isGroupEnabled(group) }">

      <!-- 카드 헤더 -->
      <div class="card-header" @click="toggleExpand(group.groupId)">
        <div class="card-icon-wrap">
          <span class="card-type-icon">{{ typeMeta(group.type).icon }}</span>
        </div>
        <div class="card-info">
          <div class="card-name-row">
            <template v-if="editingGroupId !== group.groupId">
              <span class="card-name">{{ group.name }}</span>
              <button class="btn-icon" @click.stop="startEditGroup(group)">✏</button>
            </template>
            <template v-else>
              <input v-model="editName" class="name-inline-input" @click.stop
                @keyup.enter="saveGroupName(group)" @keyup.escape="cancelEdit" />
              <button class="btn-icon btn-ok" @click.stop="saveGroupName(group)">✓</button>
              <button class="btn-icon" @click.stop="cancelEdit">✕</button>
            </template>
          </div>
          <div class="card-meta">
            <span class="type-label" :style="{ color: typeMeta(group.type).color }">
              {{ typeMeta(group.type).label }}
            </span>
            · {{ group.channels.length }}채널 ·
            <span :class="groupAssigned(group) === group.channels.length ? 'text-ok' : 'text-warn'">
              핀배정 {{ groupAssigned(group) }}/{{ group.channels.length }}
            </span>
            · 활성 {{ groupActiveCount(group) }}
          </div>
        </div>
        <div class="card-controls" @click.stop>
          <!-- 동작/대기 타이머는 '장치 설정' 탭(게이트웨이 공통)으로 이동 -->
          <label class="toggle">
            <input type="checkbox" :checked="isGroupEnabled(group)" @change="toggleGroupEnabled(group)" />
            <span class="toggle-slider"></span>
          </label>
          <button class="btn-delete-device" @click.stop="confirmDelete(group)" title="삭제">삭제</button>
          <span class="expand-arrow">{{ expandedIds.has(group.groupId) ? '▲' : '▼' }}</span>
        </div>
      </div>

      <!-- 채널 목록 -->
      <div v-if="expandedIds.has(group.groupId)" class="card-body">
        <!-- 개폐기 인터록 경고 -->
        <div v-if="group.type === 'vent'" class="interlock-warn">
          ⚠ 열기/닫기 동시 ON 금지 — Pi 에이전트에서 인터록이 적용되지 않으므로 주의하세요.
        </div>

        <div class="channel-grid">
          <div v-for="(dev, i) in group.channels" :key="dev.id" class="channel-row"
            :class="{ 'ch-inactive': !dev.enabled }">
            <div class="ch-num" :style="{ background: typeMeta(group.type).color + '22', borderColor: typeMeta(group.type).color + '55', color: typeMeta(group.type).color }">
              {{ i + 1 }}
            </div>
            <div class="ch-name">{{ dev.name }}</div>
            <div class="pin-wrap">
              <span class="pin-label">BCM</span>
              <select class="pin-select" :value="dev.gpioPin ?? ''" @change="updatePin(dev, $event)">
                <option value="">-- 미배정</option>
                <option v-for="pin in BCM_PINS" :key="pin" :value="pin"
                  :disabled="isPinUsedByOther(dev.id, pin)">
                  {{ pin }}{{ isPinUsedByOther(dev.id, pin) ? ' (사용중)' : '' }}
                </option>
              </select>
            </div>
            <button class="relay-btn on" :disabled="!dev.gpioPin" @click="sendRelay(dev, true)">ON</button>
            <button class="relay-btn off" :disabled="!dev.gpioPin" @click="sendRelay(dev, false)">OFF</button>
            <label class="toggle toggle-sm">
              <input type="checkbox" :checked="dev.enabled" @change="toggleDevice(dev)" />
              <span class="toggle-slider"></span>
            </label>
          </div>
        </div>

        <div class="bulk-actions">
          <button class="btn-bulk" @click="bulkEnable(group.channels, true)">전체 활성화</button>
          <button class="btn-bulk" @click="bulkEnable(group.channels, false)">전체 비활성화</button>
          <button class="btn-bulk btn-bulk-danger" @click="clearPins(group.channels)">핀 초기화</button>
        </div>
      </div>
    </div>

    <!-- 우적센서 (무전압 접점, BCM21 고정) — 활성/비활성 토글만 -->
    <div v-if="rainSensor" class="device-card rain-card"
      :style="{ '--type-color': '#3b82f6' }"
      :class="{ 'card-enabled': rainSensor.enabled }">
      <div class="card-header rain-header">
        <div class="card-icon-wrap"><span class="card-type-icon">☔</span></div>
        <div class="card-info">
          <div class="card-name-row">
            <span class="card-name">{{ rainSensor.name }}</span>
          </div>
          <div class="card-meta">
            <span class="type-label" style="color:#3b82f6">무전압 접점 우적센서</span>
            · <span class="pin-fixed">BCM 21 (Pin 40) 고정</span>
            · <span :class="rainSensor.enabled ? 'text-ok' : 'text-warn'">
              {{ rainSensor.enabled ? '활성' : '비활성' }}
            </span>
          </div>
        </div>
        <div class="card-controls">
          <label class="toggle">
            <input type="checkbox" :checked="rainSensor.enabled" @change="toggleRain" />
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div>
      <div class="rain-hint">
        비 감지 시 소속 구역의 개폐기를 강제로 닫습니다. 핀은 BCM21(물리 40번)으로 고정이며
        변경·삭제할 수 없습니다. <strong>무전압 접점만 연결</strong>하세요 — 외부 전원 입력 시 파손 위험.
      </div>
    </div>

    <!-- GPIO 핀 현황 -->
    <div class="pin-map-section">
      <div class="pin-map-title">GPIO 핀 배정 현황 (BCM 번호순)</div>
      <div class="pin-map-grid">
        <div v-for="pin in BCM_PINS" :key="pin" class="pin-cell"
          :class="getPinCellClass(pin)" :title="getPinTitle(pin)">
          <div class="pin-num">{{ pin }}</div>
          <div class="pin-icon">{{ getPinIcon(pin) }}</div>
        </div>
      </div>
    </div>

    <!-- ── 장치 추가 모달 (JSX 스타일) ── -->
    <div v-if="showAddModal" class="modal-overlay" @click.self="closeAddModal">
      <div class="modal add-modal">
        <div class="modal-top-row">
          <h3>+ 장치 추가</h3>
          <button class="btn-close" @click="closeAddModal">✕</button>
        </div>

        <!-- 장치 유형 선택 -->
        <div class="field-section">
          <div class="field-label">장치 유형</div>
          <div class="type-list">
            <div v-for="(meta, key) in DEVICE_TYPES" :key="key"
              class="type-card"
              :class="{ 'type-card-selected': addForm.type === key }"
              :style="addForm.type === key ? { borderColor: meta.color, background: meta.color + '14' } : {}"
              @click="selectType(key as DeviceType)">
              <span class="type-card-icon">{{ meta.icon }}</span>
              <div class="type-card-info">
                <div class="type-card-label" :style="{ color: addForm.type === key ? meta.color : undefined }">
                  {{ meta.label }}
                </div>
                <div class="type-card-desc">{{ meta.desc }}</div>
              </div>

              <!-- 관수: 8ch / 12ch 인라인 선택 -->
              <div v-if="addForm.type === key && key === 'irrigation'" class="ch-selector" @click.stop>
                <button v-for="n in [8, 12]" :key="n"
                  class="ch-opt-btn"
                  :class="{ 'ch-opt-active': addForm.channels === n }"
                  :style="addForm.channels === n ? { borderColor: meta.color, background: meta.color + '22', color: meta.color } : {}"
                  @click.stop="addForm.channels = n as 8 | 12">
                  {{ n }}ch
                </button>
              </div>

              <!-- 라디오 인디케이터 -->
              <div class="radio-outer" :style="{ borderColor: addForm.type === key ? meta.color : undefined }">
                <div v-if="addForm.type === key" class="radio-inner" :style="{ background: meta.color }"></div>
              </div>
            </div>
          </div>
        </div>

        <!-- 이름 입력 (유형 선택 후 표시) -->
        <div v-if="addForm.type" class="field-section">
          <div class="field-label">장치 이름</div>
          <input v-model="addForm.name" class="modal-input"
            placeholder="예: A동 관수, 동쪽 개폐기"
            @keyup.enter="confirmAdd" />
        </div>

        <!-- GPIO 여유 표시 -->
        <div v-if="addForm.type" class="gpio-info"
          :class="neededPins > remaining ? 'gpio-warn' : 'gpio-ok'">
          <span class="gpio-label">필요 GPIO:</span>
          <span class="gpio-needed" :class="neededPins > remaining ? 'text-danger' : 'text-ok'">{{ neededPins }}핀</span>
          <span class="gpio-sep"> / 남은 GPIO: </span>
          <span :class="remaining < 5 ? 'text-warn' : 'gpio-remaining'">{{ remaining }}핀</span>
        </div>

        <!-- 추가 버튼 -->
        <button class="btn-add-confirm"
          :class="{ 'btn-add-ready': canAdd }"
          :disabled="adding"
          @click="confirmAdd">
          {{ adding ? '추가 중...' : canAdd ? '✅ 장치 추가' : addForm.type ? '이름을 입력하세요' : '유형을 선택하세요' }}
        </button>
      </div>
    </div>

    <!-- ── 삭제 확인 모달 ── -->
    <div v-if="deleteTarget" class="modal-overlay" @click.self="deleteTarget = null">
      <div class="modal modal-sm">
        <h3>장치 삭제</h3>
        <p class="modal-desc">
          <strong>{{ deleteTarget.name }}</strong>을(를) 삭제할까요?<br />
          <span v-if="deleteTarget.channels.length > 1" class="warn-text">
            ⚠ {{ deleteTarget.channels.length }}개 채널이 모두 삭제됩니다.
          </span>
        </p>
        <div class="modal-actions">
          <button class="btn-secondary" @click="deleteTarget = null">취소</button>
          <button class="btn-danger" :disabled="deleting" @click="doDelete">
            {{ deleting ? '삭제 중...' : '삭제' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { gatewayEnvApi, type OnboardDevice } from '@/api/gateway-env.api'
import { gpioApi } from '@/api/gpio.api'
import { useNotificationStore } from '@/stores/notification.store'
import { USABLE_BCM_PINS, RESERVED_BCM_PINS } from '@/utils/gpio-pins'

// ─── 타입 ────────────────────────────────────────────────────────
type DeviceType = 'fan' | 'irrigation' | 'vent'

interface DeviceGroup {
  groupId: string
  deleteId: string
  type: DeviceType
  name: string
  pairKey: string | null
  isLegacy: boolean
  isLegacyIrrigation: boolean
  header: OnboardDevice | null
  channels: OnboardDevice[]
}

// ─── 상수 ────────────────────────────────────────────────────────
// 릴레이 제어용 안전 GPIO 핀 (I2C/SPI/UART 핀 + 우적센서 예약핀 BCM21 제외)
const BCM_PINS = USABLE_BCM_PINS.filter(p => !RESERVED_BCM_PINS.includes(p))

const DEVICE_TYPES: Record<DeviceType, { label: string; icon: string; color: string; desc: string }> = {
  irrigation: { label: '관수 릴레이', icon: '💧', color: '#0ea5e9', desc: '채널 수 선택 가능 (8 / 12)' },
  vent:       { label: '개폐기',      icon: '🪟', color: '#10b981', desc: '열기/닫기 고정 2채널' },
  fan:        { label: '유동팬',      icon: '🌀', color: '#f59e0b', desc: 'ON/OFF 고정 1채널' },
}

const HEADER_SLOT_TYPES = new Set(['irrigation_group', 'vent_group'])

// ─── Props / Emits ───────────────────────────────────────────────
const props = defineProps<{
  gatewayId: string
  devices: OnboardDevice[]
  irrigationDeviceName: string
  irrigationDeviceId: string | null
}>()

const emit = defineEmits<{
  openTimer: [dev: OnboardDevice, type: 'fan-onboard' | 'opener-onboard']
  refresh: []
  irrigationNameSaved: [name: string]
}>()

const notif = useNotificationStore()

// 우적센서 슬롯은 릴레이/핀 배정 대상이 아니므로 그룹·핀 계산에서 분리한다.
const relayDevices = computed(() => props.devices.filter(d => d.slotType !== 'rain_sensor'))
const rainSensor = computed<OnboardDevice | null>(
  () => props.devices.find(d => d.slotType === 'rain_sensor') ?? null,
)

// ─── 장치 그룹 계산 ─────────────────────────────────────────────
const deviceGroups = computed<DeviceGroup[]>(() => {
  const groups: DeviceGroup[] = []
  const devices = relayDevices.value

  // 1. 레거시 팬 (pairKey=null, slotType=fan) → 각각 독립 카드
  for (const dev of devices.filter(d => d.slotType === 'fan' && d.pairKey === null)) {
    groups.push({
      groupId: dev.id,
      deleteId: dev.id,
      type: 'fan',
      name: dev.name,
      pairKey: null,
      isLegacy: true,
      isLegacyIrrigation: false,
      header: dev,
      channels: [dev],
    })
  }

  // 2. 레거시 관수 그룹 (pairKey=null, non-fan) → 하나의 카드
  const legacyNonFan = devices.filter(
    d => d.pairKey === null && d.slotType !== 'fan' && !HEADER_SLOT_TYPES.has(d.slotType)
  )
  if (legacyNonFan.length > 0) {
    groups.push({
      groupId: 'legacy-irrigation',
      deleteId: legacyNonFan[0].id,
      type: 'irrigation',
      name: props.irrigationDeviceName || '관주 컨트롤러',
      pairKey: null,
      isLegacy: true,
      isLegacyIrrigation: true,
      header: null,
      channels: legacyNonFan,
    })
  }

  // 3. 동적 그룹 (pairKey != null)
  const dynMap = new Map<string, { header: OnboardDevice | null; channels: OnboardDevice[] }>()
  for (const d of devices.filter(d => d.pairKey !== null)) {
    const key = d.pairKey!
    if (!dynMap.has(key)) dynMap.set(key, { header: null, channels: [] })
    const g = dynMap.get(key)!
    if (HEADER_SLOT_TYPES.has(d.slotType)) g.header = d
    else g.channels.push(d)
  }

  for (const [pairKey, g] of dynMap) {
    // 동적 팬: 헤더 없이 채널에 fan 슬롯 1개
    if (!g.header) {
      const fanSlot = g.channels.find(c => c.slotType === 'fan')
      if (fanSlot) {
        groups.push({
          groupId: pairKey,
          deleteId: fanSlot.id,
          type: 'fan',
          name: fanSlot.name,
          pairKey,
          isLegacy: false,
          isLegacyIrrigation: false,
          header: fanSlot,
          channels: [fanSlot],
        })
      }
      continue
    }

    const type: DeviceType =
      g.header.slotType === 'irrigation_group' ? 'irrigation'
      : g.header.slotType === 'vent_group' ? 'vent'
      : 'fan'

    groups.push({
      groupId: pairKey,
      deleteId: g.header.id,
      type,
      name: g.header.name,
      pairKey,
      isLegacy: false,
      isLegacyIrrigation: false,
      header: g.header,
      channels: g.channels,
    })
  }

  return groups
})

// ─── 그룹 헬퍼 ──────────────────────────────────────────────────
function typeMeta(type: DeviceType) { return DEVICE_TYPES[type] }
function isGroupEnabled(group: DeviceGroup) { return group.channels.some(c => c.enabled) }
function groupAssigned(group: DeviceGroup) { return group.channels.filter(c => c.gpioPin !== null).length }
function groupActiveCount(group: DeviceGroup) { return group.channels.filter(c => c.enabled).length }

// ─── 핀 충돌 / 요약 ─────────────────────────────────────────────
const allUsedPins = computed(() =>
  relayDevices.value.map(d => d.gpioPin).filter((p): p is number => p !== null)
)
const conflictPins = computed(() =>
  allUsedPins.value.filter((p, i) => allUsedPins.value.indexOf(p) !== i)
)
const uniqueConflictPins = computed(() => [...new Set(conflictPins.value)])
const uniqueUsed = computed(() => new Set(allUsedPins.value).size)

const totalChannels = computed(() =>
  deviceGroups.value.reduce((s, g) => s + g.channels.length, 0)
)
const assignedChannels = computed(() =>
  deviceGroups.value.reduce((s, g) => s + groupAssigned(g), 0)
)

const summaryItems = computed(() => [
  { label: '장치 수',    value: deviceGroups.value.length, color: '#a78bfa' },
  { label: '총 채널',   value: totalChannels.value, color: '#60a5fa' },
  { label: '핀 배정됨', value: `${assignedChannels.value}/${totalChannels.value}`,
    color: assignedChannels.value === totalChannels.value ? '#22c55e' : '#f59e0b' },
  { label: 'GPIO 사용', value: `${uniqueUsed.value}/${BCM_PINS.length}`, color: '#0ea5e9' },
  { label: 'GPIO 여유', value: BCM_PINS.length - uniqueUsed.value,
    color: BCM_PINS.length - uniqueUsed.value < 5 ? '#ef4444' : '#6b7280' },
  { label: '핀 충돌',   value: uniqueConflictPins.value.length > 0
    ? `⚠ ${uniqueConflictPins.value.length}개` : '없음',
    color: uniqueConflictPins.value.length > 0 ? '#ef4444' : '#22c55e' },
])

// ─── 카드 확장 ──────────────────────────────────────────────────
const expandedIds = ref<Set<string>>(new Set())

function toggleExpand(groupId: string) {
  if (expandedIds.value.has(groupId)) expandedIds.value.delete(groupId)
  else expandedIds.value.add(groupId)
}

// ─── 이름 편집 ──────────────────────────────────────────────────
const editingGroupId = ref<string | null>(null)
const editName = ref('')

function startEditGroup(group: DeviceGroup) {
  editingGroupId.value = group.groupId
  editName.value = group.name
}

function cancelEdit() {
  editingGroupId.value = null
  editName.value = ''
}

async function saveGroupName(group: DeviceGroup) {
  if (!editName.value.trim()) return
  try {
    if (group.isLegacyIrrigation) {
      // 레거시 관수: Zigbee 대표 장치 이름 API
      await gatewayEnvApi.updateIrrigationName(props.gatewayId, editName.value.trim())
      emit('irrigationNameSaved', editName.value.trim())
    } else if (group.header) {
      // 헤더 슬롯 이름 업데이트
      await gatewayEnvApi.updateOnboard(props.gatewayId, group.header.id, { name: editName.value.trim() })
      group.header.name = editName.value.trim()
    } else if (group.channels[0]) {
      // 팬 단일 슬롯
      await gatewayEnvApi.updateOnboard(props.gatewayId, group.channels[0].id, { name: editName.value.trim() })
      group.channels[0].name = editName.value.trim()
    }
    cancelEdit()
    notif.success('저장 완료', '이름이 수정되었습니다.')
  } catch {
    notif.error('오류', '이름 저장에 실패했습니다.')
  }
}

// ─── 채널 조작 ──────────────────────────────────────────────────
function isPinUsedByOther(deviceId: string, pin: number): boolean {
  return relayDevices.value.some(d => d.id !== deviceId && d.gpioPin === pin)
}

async function toggleGroupEnabled(group: DeviceGroup) {
  const newVal = !isGroupEnabled(group)
  await bulkEnable(group.channels, newVal)
}

async function toggleDevice(dev: OnboardDevice) {
  const newVal = !dev.enabled
  try {
    await gatewayEnvApi.updateOnboard(props.gatewayId, dev.id, { enabled: newVal })
    dev.enabled = newVal
  } catch {
    notif.error('오류', '상태 변경에 실패했습니다.')
  }
}

async function toggleRain() {
  const rs = rainSensor.value
  if (!rs) return
  const newVal = !rs.enabled
  // 비활성화 경고: 우적센서는 구역에 매핑되어 비 감지 자동 닫힘에 사용 중
  if (!newVal && !window.confirm(
    '우적센서를 비활성화하시겠습니까?\n\n이 센서는 구역에 매핑되어 비 감지 자동 닫힘에 사용 중입니다. ' +
    '비활성화하면 비가 와도 개폐기가 자동으로 닫히지 않으며, 구역관리·대시보드에서도 숨겨집니다.',
  )) return
  try {
    await gatewayEnvApi.updateOnboard(props.gatewayId, rs.id, { enabled: newVal })
    rs.enabled = newVal
    notif.success(
      newVal ? '우적센서 활성화' : '우적센서 비활성화',
      newVal ? '비 감지 시 개폐기가 자동으로 닫힙니다.' : '우적 신호 발행이 중단됩니다.',
    )
  } catch {
    notif.error('오류', '우적센서 상태 변경에 실패했습니다.')
  }
}

async function updatePin(dev: OnboardDevice, event: Event) {
  const val = (event.target as HTMLSelectElement).value
  const pin = val === '' ? null : Number(val)
  try {
    await gatewayEnvApi.updateOnboard(props.gatewayId, dev.id, { gpioPin: pin })
    dev.gpioPin = pin
  } catch {
    notif.error('오류', 'GPIO 핀 저장에 실패했습니다.')
    ;(event.target as HTMLSelectElement).value = dev.gpioPin?.toString() ?? ''
  }
}

async function sendRelay(dev: OnboardDevice, state: boolean) {
  if (!dev.gpioPin) { notif.warning('핀 미배정', 'GPIO 핀이 배정되지 않았습니다.'); return }
  try {
    await gpioApi.sendRelayCommand(props.gatewayId, { slot: dev.slotKey, pin: dev.gpioPin, state })
    notif.success('명령 발행', `${dev.name} → ${state ? 'ON' : 'OFF'}`)
  } catch {
    notif.error('오류', '명령 발행에 실패했습니다.')
  }
}

async function bulkEnable(targets: OnboardDevice[], enable: boolean) {
  const changed = targets.filter(d => d.enabled !== enable)
  await Promise.allSettled(changed.map(async dev => {
    try {
      await gatewayEnvApi.updateOnboard(props.gatewayId, dev.id, { enabled: enable })
      dev.enabled = enable
    } catch { /* ignore individual */ }
  }))
}

async function clearPins(targets: OnboardDevice[]) {
  await Promise.allSettled(targets.filter(d => d.gpioPin !== null).map(async dev => {
    try {
      await gatewayEnvApi.updateOnboard(props.gatewayId, dev.id, { gpioPin: null })
      dev.gpioPin = null
    } catch { /* ignore */ }
  }))
  notif.success('초기화 완료', '핀 배정이 초기화되었습니다.')
}

// ─── 장치 추가 모달 ─────────────────────────────────────────────
const showAddModal = ref(false)
const addForm = ref<{ type: DeviceType | null; name: string; channels: 8 | 12 }>({
  type: null, name: '', channels: 8,
})
const adding = ref(false)

const remaining = computed(() => BCM_PINS.length - uniqueUsed.value)
const neededPins = computed(() => {
  if (!addForm.value.type) return 0
  if (addForm.value.type === 'irrigation') return addForm.value.channels
  if (addForm.value.type === 'vent') return 2
  return 1
})
const canAdd = computed(() =>
  !!addForm.value.type && addForm.value.name.trim().length > 0 && neededPins.value <= remaining.value
)

function selectType(type: DeviceType) {
  addForm.value.type = type
  addForm.value.name = DEVICE_TYPES[type].label  // 유형 선택 시 이름 자동 채움
}

function closeAddModal() {
  showAddModal.value = false
  addForm.value = { type: null, name: '', channels: 8 }
}

async function confirmAdd() {
  if (!canAdd.value || adding.value || !addForm.value.type) return
  adding.value = true
  try {
    await gatewayEnvApi.createOnboard(props.gatewayId, {
      type: addForm.value.type,
      name: addForm.value.name.trim(),
      channels: addForm.value.type === 'irrigation' ? addForm.value.channels : undefined,
    })
    closeAddModal()
    emit('refresh')
    notif.success('추가 완료', `${DEVICE_TYPES[addForm.value.type!].label}이(가) 추가되었습니다.`)
  } catch {
    notif.error('오류', '장치 추가에 실패했습니다.')
  } finally {
    adding.value = false
  }
}

// ─── 장치 삭제 ──────────────────────────────────────────────────
const deleteTarget = ref<DeviceGroup | null>(null)
const deleting = ref(false)

function confirmDelete(group: DeviceGroup) {
  deleteTarget.value = group
}

async function doDelete() {
  if (!deleteTarget.value || deleting.value) return
  deleting.value = true
  try {
    await gatewayEnvApi.deleteOnboard(props.gatewayId, deleteTarget.value.deleteId)
    deleteTarget.value = null
    emit('refresh')
    notif.success('삭제 완료', '장치가 삭제되었습니다.')
  } catch {
    notif.error('오류', '삭제에 실패했습니다.')
  } finally {
    deleting.value = false
  }
}

// ─── GPIO 핀 맵 ─────────────────────────────────────────────────
function getPinEntry(pin: number) {
  const dev = relayDevices.value.find(d => d.gpioPin === pin)
  if (!dev) return null
  const group = deviceGroups.value.find(g => g.channels.some(c => c.id === dev.id))
  return { dev, type: group?.type ?? 'fan' as DeviceType }
}

function getPinCellClass(pin: number): string {
  if (conflictPins.value.includes(pin)) return 'pin-conflict'
  const e = getPinEntry(pin)
  if (!e) return 'pin-free'
  return `pin-${e.type}`
}

function getPinIcon(pin: number): string {
  if (conflictPins.value.includes(pin)) return '⚠'
  const e = getPinEntry(pin)
  return e ? typeMeta(e.type).icon : '—'
}

function getPinTitle(pin: number): string {
  const e = getPinEntry(pin)
  return e ? `${e.dev.name} (BCM ${pin})` : `BCM ${pin} — 미사용`
}
</script>

<style scoped>
.gpio-manager { display: flex; flex-direction: column; gap: 14px; }

/* 요약 바 */
.summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(90px, 1fr));
  gap: 8px;
}
.summary-card {
  background: var(--bg-card, #fff);
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: 8px;
  padding: 10px 12px;
  text-align: center;
}
.summary-value { font-size: 17px; font-weight: 800; }
.summary-label { font-size: 10px; color: var(--text-secondary, #6b7280); margin-top: 2px; }

/* 충돌 배너 */
.conflict-banner {
  background: #fef2f2; border: 1px solid #fca5a5;
  border-radius: 8px; padding: 10px 14px; font-size: 13px; color: #dc2626;
}

/* 툴바 */
.toolbar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 4px 0;
}
.toolbar-hint { font-size: 11px; color: var(--text-secondary, #9ca3af); }
.btn-add-device {
  display: flex; align-items: center; gap: 4px;
  padding: 8px 16px; border-radius: 8px; font-size: 13px; font-weight: 700;
  background: transparent;
  border: 1px solid #22c55e;
  color: #16a34a;
  cursor: pointer; transition: all 0.15s;
}
.btn-add-device:hover { background: #f0fdf4; }

/* 빈 상태 */
.empty-state {
  text-align: center; padding: 48px 20px;
  border: 1px dashed var(--border-color, #d1d5db);
  border-radius: 12px;
  color: var(--text-secondary, #9ca3af);
}
.empty-icon { font-size: 36px; margin-bottom: 10px; }
.empty-title { font-size: 14px; font-weight: 600; margin-bottom: 4px; }
.empty-hint { font-size: 11px; }

/* 장치 카드 */
.device-card {
  background: var(--bg-card, #fff);
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: 12px;
  overflow: hidden;
  transition: border-color 0.2s;
}
.device-card.card-enabled { border-color: var(--type-color, #3b82f6); border-opacity: 0.4; }

.card-header {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 14px; cursor: pointer; user-select: none;
}
.card-header:hover { background: var(--bg-hover, #f9fafb); }

.card-icon-wrap {
  width: 38px; height: 38px; border-radius: 9px; flex-shrink: 0;
  background: color-mix(in srgb, var(--type-color, #3b82f6) 15%, transparent);
  display: flex; align-items: center; justify-content: center;
}
.card-type-icon { font-size: 20px; }

.card-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.card-name-row { display: flex; align-items: center; gap: 6px; }
.card-name { font-size: 14px; font-weight: 600; color: var(--text-primary, #111); }
.type-label { font-size: 11px; font-weight: 600; }
.card-meta { font-size: 11px; color: var(--text-secondary, #6b7280); }

.card-controls { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.btn-sm.btn-timer {
  background: transparent; border: 1px solid var(--border-color, #d1d5db);
  border-radius: 5px; cursor: pointer; font-size: 12px;
  color: var(--text-secondary, #555); padding: 3px 8px;
}
.btn-sm.btn-timer:hover { background: var(--bg-hover, #f3f4f6); }
.btn-delete-device {
  background: none; border: 1px solid var(--border-color, #e5e7eb);
  color: var(--text-secondary, #9ca3af); border-radius: 5px;
  padding: 2px 8px; font-size: 11px; cursor: pointer;
}
.btn-delete-device:hover { border-color: #fca5a5; color: #ef4444; background: #fef2f2; }
.expand-arrow { font-size: 11px; color: var(--text-secondary, #9ca3af); }

/* 인라인 이름 편집 */
.name-inline-input {
  border: 1px solid var(--primary, #3b82f6); border-radius: 4px;
  padding: 3px 8px; font-size: 14px;
  background: var(--bg-input, #fff); color: var(--text-primary, #111);
  width: 160px;
}
.btn-icon {
  background: none; border: none; cursor: pointer;
  color: var(--text-secondary, #9ca3af); font-size: 13px; padding: 2px 4px;
}
.btn-icon:hover { color: var(--text-primary, #333); }
.btn-ok { color: #16a34a !important; }

/* 카드 본문 */
.card-body {
  border-top: 1px solid var(--border-color, #e5e7eb);
  padding: 10px 14px;
  display: flex; flex-direction: column; gap: 8px;
}

/* 배지 */
.timer-badge {
  font-size: 11px; color: #1d4ed8; background: #eff6ff;
  border-radius: 6px; padding: 2px 10px; display: inline-block; width: fit-content;
}
.interlock-warn {
  font-size: 11px; color: #b45309; background: #fffbeb;
  border: 1px solid #fde68a; border-radius: 6px; padding: 6px 10px;
}

/* 채널 그리드 */
.channel-grid { display: flex; flex-direction: column; gap: 6px; }
.channel-row {
  display: flex; align-items: center; gap: 8px;
  padding: 7px 10px;
  background: var(--bg-secondary, #f9fafb);
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: 8px;
  transition: opacity 0.15s;
}
.channel-row.ch-inactive { opacity: 0.5; }
.ch-num {
  width: 22px; height: 22px; border-radius: 5px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  font-size: 10px; font-weight: 800; border: 1px solid;
}
.ch-name {
  font-size: 12px; color: var(--text-primary, #333);
  flex: 1; min-width: 70px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* 핀 선택 */
.pin-wrap { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
.pin-label { font-size: 10px; color: var(--text-secondary, #6b7280); }
.pin-select {
  background: var(--bg-input, #fff);
  border: 1px solid var(--border-color, #d1d5db);
  border-radius: 6px; padding: 3px 6px; font-size: 12px;
  color: var(--text-primary, #111); cursor: pointer; min-width: 80px;
}
.pin-select:focus { outline: 2px solid var(--primary, #3b82f6); outline-offset: 1px; }

/* 릴레이 버튼 */
.relay-btn {
  padding: 3px 9px; border-radius: 5px; font-size: 11px; font-weight: 700;
  cursor: pointer; border: 1px solid; transition: all 0.15s; flex-shrink: 0;
}
.relay-btn.on { background: #dcfce7; border-color: #86efac; color: #15803d; }
.relay-btn.on:hover:not(:disabled) { background: #bbf7d0; }
.relay-btn.off { background: #fee2e2; border-color: #fca5a5; color: #dc2626; }
.relay-btn.off:hover:not(:disabled) { background: #fecaca; }
.relay-btn:disabled { opacity: 0.4; cursor: not-allowed; }

/* 토글 */
.toggle { position: relative; display: inline-flex; align-items: center; cursor: pointer; flex-shrink: 0; }
.toggle input { opacity: 0; width: 0; height: 0; position: absolute; }
.toggle-slider {
  display: block; width: 38px; height: 22px;
  background: #d1d5db; border-radius: 11px; transition: background 0.2s;
}
.toggle-slider::before {
  content: ''; position: absolute;
  width: 16px; height: 16px; top: 3px; left: 3px;
  background: #fff; border-radius: 50%; transition: transform 0.2s;
  box-shadow: 0 1px 2px rgba(0,0,0,.2);
}
.toggle input:checked + .toggle-slider { background: var(--primary, #3b82f6); }
.toggle input:checked + .toggle-slider::before { transform: translateX(16px); }
.toggle-sm .toggle-slider { width: 32px; height: 18px; border-radius: 9px; }
.toggle-sm .toggle-slider::before { width: 12px; height: 12px; top: 3px; left: 3px; }
.toggle-sm input:checked + .toggle-slider::before { transform: translateX(14px); }

/* 일괄 조작 */
.bulk-actions {
  display: flex; gap: 6px; flex-wrap: wrap;
  padding-top: 4px; border-top: 1px solid var(--border-color, #e5e7eb);
}
.btn-bulk {
  padding: 5px 12px; border-radius: 5px; font-size: 11px;
  background: var(--bg-card, #fff);
  border: 1px solid var(--border-color, #d1d5db);
  color: var(--text-secondary, #6b7280); cursor: pointer;
}
.btn-bulk:hover { background: var(--bg-hover, #f3f4f6); }
.btn-bulk-danger { color: #dc2626 !important; border-color: #fca5a5 !important; }
.btn-bulk-danger:hover { background: #fef2f2 !important; }

/* 색상 헬퍼 */
.text-ok { color: #16a34a; }
.text-warn { color: #d97706; }
.text-danger { color: #dc2626; }

/* 우적센서 카드 */
.rain-card { cursor: default; }
.rain-header { cursor: default; }
.rain-header:hover { background: transparent; }
.pin-fixed {
  font-size: 11px; font-weight: 600; color: #2563eb;
  background: #eff6ff; border-radius: 4px; padding: 1px 6px;
}
.rain-hint {
  border-top: 1px solid var(--border-color, #e5e7eb);
  padding: 8px 14px; font-size: 11px; line-height: 1.5;
  color: var(--text-secondary, #6b7280);
}
#app.theme-dark .pin-fixed { color: #93c5fd; background: rgba(59, 130, 246, 0.15); }

/* GPIO 핀 맵 */
.pin-map-section { padding-top: 4px; }
.pin-map-title { font-size: 11px; color: var(--text-secondary, #6b7280); margin-bottom: 8px; }
.pin-map-grid { display: flex; flex-wrap: wrap; gap: 5px; }
.pin-cell {
  width: 44px; padding: 6px 4px; border-radius: 7px;
  text-align: center; border: 1px solid; cursor: default; transition: all 0.15s;
}
.pin-cell.pin-free { background: var(--bg-card, #fff); border-color: var(--border-color, #e5e7eb); }
.pin-cell.pin-fan { background: #fffbeb; border-color: #fde68a; }
.pin-cell.pin-irrigation { background: #eff6ff; border-color: #bfdbfe; }
.pin-cell.pin-vent { background: #ecfdf5; border-color: #a7f3d0; }
.pin-cell.pin-conflict { background: #fef2f2; border-color: #fca5a5; }
.pin-num { font-size: 11px; font-weight: 800; color: var(--text-primary, #333); }
.pin-cell.pin-free .pin-num { color: var(--text-secondary, #9ca3af); }
.pin-cell.pin-fan .pin-num { color: #d97706; }
.pin-cell.pin-irrigation .pin-num { color: #1d4ed8; }
.pin-cell.pin-vent .pin-num { color: #059669; }

/* 다크모드: 핀셀 배경 반투명 */
#app.theme-dark .pin-cell.pin-fan { background: rgba(245, 158, 11, 0.18); border-color: rgba(245, 158, 11, 0.4); }
#app.theme-dark .pin-cell.pin-irrigation { background: rgba(59, 130, 246, 0.18); border-color: rgba(59, 130, 246, 0.4); }
#app.theme-dark .pin-cell.pin-vent { background: rgba(34, 197, 94, 0.18); border-color: rgba(34, 197, 94, 0.4); }
#app.theme-dark .pin-cell.pin-conflict { background: rgba(239, 68, 68, 0.18); border-color: rgba(239, 68, 68, 0.4); }
#app.theme-dark .pin-cell.pin-fan .pin-num { color: #fbbf24; }
#app.theme-dark .pin-cell.pin-irrigation .pin-num { color: #93c5fd; }
#app.theme-dark .pin-cell.pin-vent .pin-num { color: #86efac; }

/* 다크모드: 릴레이 버튼 ON/OFF */
#app.theme-dark .relay-btn.on { background: rgba(34, 197, 94, 0.18); border-color: rgba(34, 197, 94, 0.4); color: #86efac; }
#app.theme-dark .relay-btn.on:hover:not(:disabled) { background: rgba(34, 197, 94, 0.28); }
#app.theme-dark .relay-btn.off { background: rgba(239, 68, 68, 0.18); border-color: rgba(239, 68, 68, 0.4); color: #fca5a5; }
#app.theme-dark .relay-btn.off:hover:not(:disabled) { background: rgba(239, 68, 68, 0.28); }

/* 다크모드: 토글 thumb (흰색 → 어두운 베이지) + 삭제 버튼 hover */
#app.theme-dark .toggle-slider::before { background: #d4d4d4; }
#app.theme-dark .btn-delete-device:hover { background: rgba(239, 68, 68, 0.15); }

/* 다크모드: 작은 정보 배지 */
#app.theme-dark .pin-info-text { color: #93c5fd; background: rgba(59, 130, 246, 0.15); }
#app.theme-dark .conflict-warn { color: #fbbf24; background: rgba(245, 158, 11, 0.15); }
.pin-cell.pin-conflict .pin-num { color: #dc2626; }
.pin-icon { font-size: 10px; margin-top: 2px; }

/* ── 모달 공통 ── */
.modal-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.5);
  display: flex; align-items: center; justify-content: center;
  z-index: 1000; padding: 16px;
}
.modal {
  background: var(--bg-card, #fff);
  border-radius: 14px; padding: 24px;
  width: 420px; max-width: 100%;
  display: flex; flex-direction: column; gap: 16px;
  box-shadow: 0 20px 50px rgba(0,0,0,0.2);
}
.modal-sm { width: 300px; }
.modal h3 { font-size: 16px; font-weight: 700; margin: 0; color: var(--text-primary, #111); }
.modal-desc { font-size: 13px; color: var(--text-secondary, #555); margin: 0; line-height: 1.5; }
.warn-text { color: #d97706; font-size: 12px; }
.modal-actions { display: flex; gap: 8px; justify-content: flex-end; }

/* ── 장치 추가 모달 ── */
.add-modal { width: 440px; }
.modal-top-row {
  display: flex; align-items: center; justify-content: space-between;
}
.btn-close {
  background: none; border: none; font-size: 18px; cursor: pointer;
  color: var(--text-secondary, #9ca3af); line-height: 1;
}
.btn-close:hover { color: var(--text-primary, #333); }

.field-section { display: flex; flex-direction: column; gap: 8px; }
.field-label { font-size: 11px; color: var(--text-secondary, #6b7280); font-weight: 600; letter-spacing: 0.5px; }

/* 유형 카드 목록 */
.type-list { display: flex; flex-direction: column; gap: 8px; }
.type-card {
  display: flex; align-items: center; gap: 12px;
  border: 2px solid var(--border-color, #e5e7eb);
  border-radius: 10px; padding: 10px 14px; cursor: pointer;
  background: var(--bg-card, #fff);
  transition: all 0.15s;
}
.type-card:hover { border-color: var(--primary, #3b82f6); }
.type-card-selected { /* border/bg set via :style */ }
.type-card-icon { font-size: 22px; flex-shrink: 0; }
.type-card-info { flex: 1; }
.type-card-label { font-size: 13px; font-weight: 700; color: var(--text-secondary, #555); }
.type-card-desc { font-size: 11px; color: var(--text-secondary, #9ca3af); margin-top: 2px; }

/* 8ch / 12ch 선택 버튼 */
.ch-selector { display: flex; gap: 6px; flex-shrink: 0; }
.ch-opt-btn {
  padding: 3px 10px; border-radius: 5px; font-size: 11px; cursor: pointer;
  border: 1px solid var(--border-color, #d1d5db);
  background: var(--bg-card, #fff); color: var(--text-secondary, #6b7280);
  transition: all 0.15s;
}

/* 라디오 인디케이터 */
.radio-outer {
  width: 18px; height: 18px; border-radius: 50%;
  border: 2px solid var(--border-color, #d1d5db);
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.radio-inner { width: 8px; height: 8px; border-radius: 50%; }

/* 이름 입력 */
.modal-input {
  border: 1px solid var(--border-color, #d1d5db); border-radius: 8px;
  padding: 10px 12px; font-size: 13px;
  background: var(--bg-input, #fff); color: var(--text-primary, #111);
  width: 100%; box-sizing: border-box;
}
.modal-input:focus { outline: 2px solid var(--primary, #3b82f6); outline-offset: 1px; border-color: transparent; }

/* GPIO 여유 정보 */
.gpio-info {
  border-radius: 8px; padding: 8px 12px; font-size: 11px;
}
.gpio-ok { background: #f0fdf4; border: 1px solid #bbf7d0; }
.gpio-warn { background: #fef2f2; border: 1px solid #fecaca; }
.gpio-label { color: var(--text-secondary, #6b7280); }
.gpio-sep { color: var(--text-secondary, #9ca3af); }
.gpio-remaining { color: var(--text-secondary, #6b7280); }
.gpio-needed { font-weight: 700; }

/* 추가 확인 버튼 */
.btn-add-confirm {
  width: 100%; padding: 12px; border-radius: 8px; font-size: 13px; font-weight: 700;
  cursor: not-allowed;
  background: var(--bg-hover, #f3f4f6);
  border: 1px solid var(--border-color, #e5e7eb);
  color: var(--text-secondary, #9ca3af);
  transition: all 0.2s;
}
.btn-add-confirm.btn-add-ready {
  cursor: pointer;
  background: #f0fdf4;
  border-color: #22c55e;
  color: #15803d;
}
.btn-add-confirm.btn-add-ready:hover { background: #dcfce7; }
.btn-add-confirm:disabled { opacity: 0.7; }

/* 공통 버튼 */
.btn-secondary {
  padding: 8px 16px; border-radius: 6px; font-size: 13px; font-weight: 600;
  background: var(--bg-card, #fff);
  border: 1px solid var(--border-color, #d1d5db);
  color: var(--text-secondary, #555); cursor: pointer;
}
.btn-secondary:hover { background: var(--bg-hover, #f3f4f6); }
.btn-danger {
  padding: 8px 16px; border-radius: 6px; font-size: 13px; font-weight: 600;
  background: #ef4444; color: #fff; border: none; cursor: pointer;
}
.btn-danger:hover:not(:disabled) { background: #dc2626; }
.btn-danger:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
