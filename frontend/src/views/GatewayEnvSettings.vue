<template>
  <div class="page-container">
    <header class="page-header">
      <div class="header-row">
        <button class="btn-back" @click="$router.back()">← 뒤로</button>
        <div>
          <h2>환경 설정</h2>
          <p class="page-description">
            <span v-if="houseName" class="house-label">{{ houseName }} · </span>온보드 장치 및 Zigbee 장치 관리
          </p>
        </div>
      </div>
    </header>

    <div class="tab-bar">
      <button :class="['tab-btn', activeTab === 'onboard' && 'active']" @click="activeTab = 'onboard'">
        온보드 장치
      </button>
      <button :class="['tab-btn', activeTab === 'zigbee' && 'active']" @click="activeTab = 'zigbee'">
        Zigbee 장치 <span v-if="zigbeeDevices.length" class="tab-count">{{ zigbeeDevices.length }}</span>
      </button>
    </div>

    <div v-if="loadError" class="error-state">
      <p>⚠ {{ loadError }}</p>
      <p class="error-hint">서버 로그를 확인하거나 DB 마이그레이션이 적용됐는지 확인하세요.</p>
    </div>

    <div v-else-if="loading" class="loading-state">불러오는 중...</div>

    <!-- ── 온보드 탭 ── -->
    <div v-else-if="activeTab === 'onboard'" class="section">
      <!-- admin 전용: GPIO 핀 테스트 버튼 -->
      <div v-if="authStore.isAdmin" class="admin-tool-bar">
        <button class="btn-pinout" @click="showPinoutModal = true">📌 GPIO 배치도</button>
        <button class="btn-pin-test" @click="openOnboardPinTest">🔌 GPIO 핀 테스트</button>
      </div>
      <GpioRelayManager
        :gateway-id="gatewayId"
        :devices="onboardDevices"
        :irrigation-device-name="irrigationDeviceName"
        :irrigation-device-id="irrigationDeviceId"
        @open-timer="openTimerModal"
        @refresh="loadAllDevices"
        @irrigation-name-saved="irrigationDeviceName = $event"
      />
    </div>

    <!-- ── Zigbee 탭 ── -->
    <div v-else-if="activeTab === 'zigbee'" class="section">
      <div class="section-toolbar">
        <p class="section-desc">Zigbee 장치를 스캔하여 추가하거나 관리합니다.</p>
        <button class="btn-primary btn-sm" @click="openScan()">+ Zigbee 스캔</button>
      </div>

      <div v-if="zigbeeDevices.length === 0" class="empty-state">추가된 Zigbee 장치가 없습니다.</div>

      <div v-for="dev in zigbeeDevices" :key="dev.id" class="device-card">
        <div class="card-header">
          <div class="device-name-row">
            <span v-if="editingId !== dev.id" class="device-name">{{ dev.name }}</span>
            <input v-else v-model="editName" class="name-input" @keyup.enter="saveZigbeeName(dev)" @keyup.escape="cancelEdit()" />
            <button v-if="editingId !== dev.id" class="btn-icon" @click="startEdit(dev.id, dev.name)">✏</button>
            <template v-else>
              <button class="btn-icon btn-save" @click="saveZigbeeName(dev)">✓</button>
              <button class="btn-icon" @click="cancelEdit()">✕</button>
            </template>
          </div>
          <div class="card-actions">
            <!-- 관수: 채널 매핑 버튼 -->
            <button v-if="dev.equipmentType === 'irrigation'" class="btn-settings btn-sm" @click="openMappingModal(dev)">🔀 채널 매핑</button>
            <!-- 팬: 타이머 설정 버튼 (작은 아이콘) -->
            <button v-if="dev.equipmentType === 'fan'" class="btn-sm btn-timer" @click="openTimerModal(dev, 'fan-zigbee')" title="타이머 설정">⏱</button>
            <!-- 개폐기(열림 대표로만): 타이머 설정 -->
            <button v-if="dev.equipmentType === 'opener_open'" class="btn-sm btn-timer" @click="openTimerModal(dev, 'opener')" title="타이머 설정">⏱</button>
            <!-- admin 전용: 채널 테스트 -->
            <button v-if="authStore.isAdmin && dev.channelMapping && Object.keys(dev.channelMapping).length > 0" class="btn-test btn-sm" @click="openZigbeePinTest(dev)">🔌 테스트</button>
            <label class="toggle">
              <input type="checkbox" :checked="dev.enabled !== false" @change="toggleZigbee(dev)" />
              <span class="toggle-slider"></span>
            </label>
            <button class="btn-danger btn-sm" @click="removeZigbee(dev)">삭제</button>
          </div>
        </div>
        <div class="device-meta">
          <span class="meta-tag">{{ dev.equipmentType || dev.deviceType }}</span>
          <span class="meta-tag mono">{{ dev.friendlyName }}</span>
          <span v-if="dev.online" class="meta-tag online">온라인</span>
          <span v-else class="meta-tag offline">오프라인</span>
        </div>
        <!-- 팬/개폐기 타이머 배지 -->
        <div v-if="(dev.equipmentType === 'fan' || dev.equipmentType === 'opener_open') && (dev.deviceSettings?.operation_time || dev.deviceSettings?.standby_time)" class="timer-badge">
          <template v-if="dev.equipmentType === 'fan'">
            동작 {{ dev.deviceSettings?.operation_time ?? 50 }}분 · 대기 {{ dev.deviceSettings?.standby_time ?? 10 }}분
          </template>
          <template v-else>
            동작 {{ dev.deviceSettings?.operation_time ?? 30 }}초 · 대기 {{ dev.deviceSettings?.standby_time ?? 60 }}초
          </template>
        </div>
      </div>
    </div>

    <!-- ── 핀 테스트 모달 (admin only) ── -->
    <PinTestModal
      :visible="showPinTest"
      :gateway-id="gatewayId"
      :mode="pinTestMode"
      :zigbee-device="pinTestDevice"
      @close="showPinTest = false"
    />

    <!-- ── RPi 3B GPIO 배치도 모달 ── -->
    <div v-if="showPinoutModal" class="modal-overlay" @click.self="showPinoutModal = false">
      <div class="pinout-modal">
        <div class="pinout-header">
          <span>라즈베리파이 3B GPIO 핀 배치도</span>
          <button class="modal-close" @click="showPinoutModal = false">✕</button>
        </div>
        <div class="pinout-body">
          <p class="pinout-note">· 숫자는 <strong>BCM 번호</strong> 기준입니다 &nbsp;|&nbsp; 물리 핀 번호는 괄호 안에 표시</p>
          <div class="pinout-board">
            <div class="pinout-col">
              <div v-for="pin in leftPins" :key="pin.phys" class="pinout-row">
                <span class="pin-label-left">{{ pin.label }}</span>
                <span :class="['pin-circle', pin.type]">{{ pin.phys }}</span>
              </div>
            </div>
            <div class="pinout-col">
              <div v-for="pin in rightPins" :key="pin.phys" class="pinout-row right-row">
                <span :class="['pin-circle', pin.type]">{{ pin.phys }}</span>
                <span class="pin-label-right">{{ pin.label }}</span>
              </div>
            </div>
          </div>
          <div class="pinout-legend">
            <span class="legend-item"><span class="pin-circle gpio">●</span> GPIO (BCM)</span>
            <span class="legend-item"><span class="pin-circle power">●</span> 전원 3.3V/5V</span>
            <span class="legend-item"><span class="pin-circle gnd">●</span> GND</span>
            <span class="legend-item"><span class="pin-circle special">●</span> SPI/I2C/UART</span>
          </div>
        </div>
      </div>
    </div>

    <!-- ── 채널 매핑 모달 (Zigbee 관수) ── -->
    <div v-if="mappingModalDev" class="modal-overlay" @click.self="closeMappingModal">
      <div class="modal">
        <h3>채널 매핑 — {{ mappingModalDev.name }}</h3>
        <p class="modal-desc">Zigbee 스위치 코드와 관수 기능을 연결합니다. ({{ mappingChannelCount }}채널)</p>
        <div class="mapping-grid">
          <div v-for="(label, key) in activeMappingSlots" :key="key" class="mapping-row">
            <span class="mapping-label">{{ label }}</span>
            <select :value="getMappingValue(mappingModalDev, key)" @change="updateMapping(mappingModalDev, key, ($event.target as HTMLSelectElement).value)" class="mapping-select">
              <option value="">-</option>
              <option v-for="sw in mappingSwitchCodes" :key="sw" :value="sw">{{ sw }}</option>
            </select>
          </div>
        </div>
        <div class="modal-actions">
          <button class="btn-secondary" @click="closeMappingModal">취소</button>
          <button class="btn-primary" @click="saveMappingFor(mappingModalDev)">저장</button>
        </div>
      </div>
    </div>

    <!-- ── 타이머 설정 모달 (팬 / 개폐기) ── -->
    <div v-if="timerModalDev" class="modal-overlay" @click.self="closeTimerModal">
      <div class="modal modal-sm-fixed">
        <h3>타이머 설정 — {{ timerModalDev.name }}</h3>
        <p class="modal-desc">
          <template v-if="timerModalType === 'opener' || timerModalType === 'opener-onboard'">개폐기 동작·대기 시간을 설정합니다. (자동제어 룰에서만 적용)</template>
          <template v-else>유동팬 동작·대기 시간을 설정합니다. (자동제어 룰에서만 적용)</template>
        </p>
        <div class="timer-form">
          <div class="timer-row">
            <label class="timer-label">동작시간</label>
            <input type="number" v-model.number="timerOpTime" :min="1" :max="(timerModalType === 'opener' || timerModalType === 'opener-onboard') ? 300 : 240" class="timer-input" />
            <span class="timer-unit">{{ (timerModalType === 'opener' || timerModalType === 'opener-onboard') ? '초' : '분' }}</span>
          </div>
          <div class="timer-row">
            <label class="timer-label">대기시간</label>
            <input type="number" v-model.number="timerStbyTime" :min="1" :max="(timerModalType === 'opener' || timerModalType === 'opener-onboard') ? 300 : 120" class="timer-input" />
            <span class="timer-unit">{{ (timerModalType === 'opener' || timerModalType === 'opener-onboard') ? '초' : '분' }}</span>
          </div>
        </div>
        <div class="timer-defaults">
          기본값:
          <template v-if="timerModalType === 'opener' || timerModalType === 'opener-onboard'">동작 30초 · 대기 60초</template>
          <template v-else>동작 50분 · 대기 10분</template>
        </div>
        <div class="modal-actions">
          <button class="btn-secondary" @click="closeTimerModal">취소</button>
          <button class="btn-primary" @click="saveTimer" :disabled="timerSaving">{{ timerSaving ? '저장 중...' : '저장' }}</button>
        </div>
      </div>
    </div>

    <!-- Zigbee 스캔 모달 -->
    <div v-if="showScanModal" class="modal-overlay" @click.self="showScanModal = false">
      <div class="modal">
        <h3>Zigbee 장치 추가</h3>

        <!-- 페어링 진행 상태 배너 -->
        <div v-if="permitJoining" class="pairing-banner pairing-banner-active">
          <div class="pairing-banner-icon">📡</div>
          <div class="pairing-banner-text">
            <strong>새 장치 수신 대기 중 — {{ permitJoinSecondsLeft }}초</strong>
            <span>센서의 페어링 버튼을 길게 눌러주세요. 잡히면 자동으로 아래 목록에 나타납니다.</span>
          </div>
          <button class="btn-secondary btn-sm" @click="cancelPermitJoin">중지</button>
        </div>

        <div v-if="scanning && !permitJoining" class="loading-state">스캔 중...</div>

        <!-- 빈 상태: 추가할 새 장치 없음 → 페어링 가이드 -->
        <div
          v-else-if="scannedDevices.filter(d => !addedIeees.has(d.ieee_address)).length === 0 && !permitJoining"
          class="empty-pair-cta"
        >
          <div class="empty-pair-title">새로운 Zigbee 장치를 추가하시겠어요?</div>
          <p class="empty-pair-desc">
            아직 페어링되지 않은 장치는 목록에 표시되지 않습니다. <br />
            아래 버튼을 눌러 페어링 모드를 시작한 다음, 센서(예: 비 감지 센서)의 페어링 버튼을 길게 눌러 연결하세요.
          </p>
          <button class="btn-primary btn-pair-start" @click="startPermitJoin">
            📡 페어링 모드 시작 (120초)
          </button>
          <div class="empty-pair-secondary">
            이미 페어링된 장치를 다시 확인하려면
            <button class="link-btn" @click="runScan">목록 새로고침</button>
          </div>
        </div>
        <div v-else class="scan-list">
          <div v-for="sd in scannedDevices.filter(d => !addedIeees.has(d.ieee_address))" :key="sd.ieee_address"
            class="scan-item">
            <div class="scan-item-header">
              <div>
                <div class="scan-name">{{ sd.friendly_name }}</div>
                <div class="scan-meta">{{ sd.ieee_address }}<span v-if="sd.model_id"> · {{ sd.model_id }}</span></div>
              </div>
            </div>

            <!-- 이름 입력 -->
            <div class="scan-field">
              <label class="scan-field-label">이름</label>
              <input v-model="addFormName[sd.ieee_address]" class="scan-name-input" :placeholder="sd.friendly_name" />
            </div>

            <!-- 1단계: 측정기 / 장치 선택 -->
            <div class="dtype-toggle">
              <button
                :class="['dtype-btn', addForm[sd.ieee_address + '_type'] === 'sensor/other' && 'dtype-active']"
                @click="selectDeviceType(sd.ieee_address, 'sensor')">
                🌡 측정기
              </button>
              <button
                :class="['dtype-btn', addForm[sd.ieee_address + '_type']?.startsWith('actuator/') && 'dtype-active']"
                @click="selectDeviceType(sd.ieee_address, 'actuator')">
                ⚙ 장치
              </button>
            </div>

            <!-- 2단계: 장치 세부 유형 (장치 선택 시) -->
            <div v-if="addForm[sd.ieee_address + '_type']?.startsWith('actuator/')" class="equip-options">
              <button v-for="opt in EQUIPMENT_OPTIONS" :key="opt.value"
                :class="['equip-btn', addForm[sd.ieee_address + '_type'] === 'actuator/' + opt.value && 'equip-active']"
                @click="selectEquipType(sd.ieee_address, opt.value)">
                {{ opt.label }}
              </button>
            </div>

            <!-- 개폐기 경고 (한쪽만 선택된 경우) -->
            <div v-if="isOpenerSelected(sd.ieee_address) && !openerPairReady" class="opener-warning">
              ⚠ 개폐기는 열림/닫힘 세트로 함께 추가해야 합니다. 다른 장치에서도 개폐기를 선택해 주세요.
            </div>

            <!-- 추가 버튼 -->
            <div class="scan-actions">
                <button
                class="btn-primary btn-sm"
                :disabled="!canAdd(sd.ieee_address)"
                @click="handleAddDevice(sd)">
                {{ isOpenerSelected(sd.ieee_address) ? '쌍으로 추가' : '추가' }}
              </button>
            </div>
          </div>
        </div>
        <div class="modal-actions">
          <button class="btn-secondary" @click="showScanModal = false">닫기</button>
          <button class="btn-primary" @click="runScan()" :disabled="scanning">재스캔</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRoute } from 'vue-router'
import { gatewayEnvApi, type OnboardDevice, type ZigbeeDevice, type ZigbeeScannedDevice } from '@/api/gateway-env.api'
import { gatewayApi } from '@/api/gateway.api'
import { useNotificationStore } from '@/stores/notification.store'
import { useAuthStore } from '@/stores/auth.store'
import { detectChannelCount, AVAILABLE_SWITCH_CODES_8CH, AVAILABLE_SWITCH_CODES_12CH } from '@/types/device.types'
import GpioRelayManager from '@/components/gateway/GpioRelayManager.vue'
import PinTestModal from '@/components/gateway/PinTestModal.vue'

const route = useRoute()
const notif = useNotificationStore()
const authStore = useAuthStore()
const gatewayId = route.params.id as string
const houseName = computed(() => route.query.houseName as string | undefined)

// 핀 테스트 모달
const showPinTest = ref(false)
const pinTestMode = ref<'onboard' | 'zigbee'>('onboard')
const pinTestDevice = ref<ZigbeeDevice | null>(null)

// GPIO 배치도 모달
const showPinoutModal = ref(false)

interface PinDef { phys: number; label: string; type: 'gpio' | 'power' | 'gnd' | 'special' }
// 외부 전원 릴레이 사용 시 I2C/SPI/UART 핀도 일반 GPIO로 사용 가능 (type: 'gpio')
const allPins: PinDef[] = [
  { phys:  1, label: '3.3V',           type: 'power' },
  { phys:  2, label: '5V',             type: 'power' },
  { phys:  3, label: 'GPIO2 (SDA)',    type: 'gpio'  },
  { phys:  4, label: '5V',             type: 'power' },
  { phys:  5, label: 'GPIO3 (SCL)',    type: 'gpio'  },
  { phys:  6, label: 'GND',            type: 'gnd'   },
  { phys:  7, label: 'GPIO4',          type: 'gpio'  },
  { phys:  8, label: 'GPIO14 (TX)',    type: 'gpio'  },
  { phys:  9, label: 'GND',            type: 'gnd'   },
  { phys: 10, label: 'GPIO15 (RX)',    type: 'gpio'  },
  { phys: 11, label: 'GPIO17',         type: 'gpio'  },
  { phys: 12, label: 'GPIO18',         type: 'gpio'  },
  { phys: 13, label: 'GPIO27',         type: 'gpio'  },
  { phys: 14, label: 'GND',            type: 'gnd'   },
  { phys: 15, label: 'GPIO22',         type: 'gpio'  },
  { phys: 16, label: 'GPIO23',         type: 'gpio'  },
  { phys: 17, label: '3.3V',           type: 'power' },
  { phys: 18, label: 'GPIO24',         type: 'gpio'  },
  { phys: 19, label: 'GPIO10 (MOSI)',  type: 'gpio'  },
  { phys: 20, label: 'GND',            type: 'gnd'   },
  { phys: 21, label: 'GPIO9 (MISO)',   type: 'gpio'  },
  { phys: 22, label: 'GPIO25',         type: 'gpio'  },
  { phys: 23, label: 'GPIO11 (SCLK)',  type: 'gpio'  },
  { phys: 24, label: 'GPIO8 (CE0)',    type: 'gpio'  },
  { phys: 25, label: 'GND',            type: 'gnd'   },
  { phys: 26, label: 'GPIO7 (CE1)',    type: 'gpio'  },
  { phys: 27, label: 'ID_SD',          type: 'special' },
  { phys: 28, label: 'ID_SC',          type: 'special' },
  { phys: 29, label: 'GPIO5',          type: 'gpio'  },
  { phys: 30, label: 'GND',            type: 'gnd'   },
  { phys: 31, label: 'GPIO6',          type: 'gpio'  },
  { phys: 32, label: 'GPIO12',         type: 'gpio'  },
  { phys: 33, label: 'GPIO13',         type: 'gpio'  },
  { phys: 34, label: 'GND',            type: 'gnd'   },
  { phys: 35, label: 'GPIO19',         type: 'gpio'  },
  { phys: 36, label: 'GPIO16',         type: 'gpio'  },
  { phys: 37, label: 'GPIO26',         type: 'gpio'  },
  { phys: 38, label: 'GPIO20',         type: 'gpio'  },
  { phys: 39, label: 'GND',            type: 'gnd'   },
  { phys: 40, label: 'GPIO21',         type: 'gpio'  },
]
const leftPins = computed(() => allPins.filter(p => p.phys % 2 === 1))
const rightPins = computed(() => allPins.filter(p => p.phys % 2 === 0))

function openOnboardPinTest() {
  pinTestMode.value = 'onboard'
  pinTestDevice.value = null
  showPinTest.value = true
}

function openZigbeePinTest(dev: ZigbeeDevice) {
  pinTestMode.value = 'zigbee'
  pinTestDevice.value = dev
  showPinTest.value = true
}

const loading = ref(false)
const loadError = ref<string | null>(null)
const activeTab = ref<'onboard' | 'zigbee'>('onboard')
const onboardDevices = ref<OnboardDevice[]>([])
const zigbeeDevices = ref<ZigbeeDevice[]>([])

// 관주 컨트롤러 대표 이름
const irrigationDeviceId = ref<string | null>(null)
const irrigationDeviceName = ref<string>('')

const editingId = ref<string | null>(null)
const editName = ref('')
const mappingDraft = ref<Record<string, Record<string, string>>>({})
const showScanModal = ref(false)
const scanning = ref(false)
const scannedDevices = ref<ZigbeeScannedDevice[]>([])
const addForm = ref<Record<string, string>>({})
const addFormName = ref<Record<string, string>>({})
const addedIeees = ref<Set<string>>(new Set())
const addingOpener = ref<boolean>(false)

// ── 채널 매핑 모달 ──────────────────────────────────────────────
const mappingModalDev = ref<ZigbeeDevice | null>(null)

function openMappingModal(dev: ZigbeeDevice) {
  const vals = Object.values(dev.channelMapping ?? {}).filter(Boolean)
  const hasChannelInfo = vals.some(v => v.startsWith('switch_'))
  if (!hasChannelInfo) {
    notif.warning('채널 정보 없음', '이 장치는 채널 정보가 없어 관주 장치에 적합하지 않습니다. 올바른 릴레이 스위치 장치를 등록해 주세요.')
    return
  }
  mappingModalDev.value = dev
}

function closeMappingModal() {
  mappingModalDev.value = null
}

// ── 타이머 설정 모달 ─────────────────────────────────────────────
type TimerType = 'fan-onboard' | 'fan-zigbee' | 'opener' | 'opener-onboard'
const timerModalDev = ref<OnboardDevice | ZigbeeDevice | null>(null)
const timerModalType = ref<TimerType>('fan-onboard')
const timerOpTime = ref(50)
const timerStbyTime = ref(10)
const timerSaving = ref(false)

function openTimerModal(dev: OnboardDevice | ZigbeeDevice, type: TimerType) {
  timerModalDev.value = dev
  timerModalType.value = type
  if (type === 'opener') {
    const zDev = dev as ZigbeeDevice
    timerOpTime.value = zDev.deviceSettings?.operation_time ?? 30
    timerStbyTime.value = zDev.deviceSettings?.standby_time ?? 60
  } else if (type === 'opener-onboard') {
    // onboard 개폐기 vent_group 헤더 슬롯 (기본값 동작 30초 / 대기 60초)
    const oDev = dev as OnboardDevice
    timerOpTime.value = oDev.operationTime ?? 30
    timerStbyTime.value = oDev.standbyTime ?? 60
  } else if (type === 'fan-onboard') {
    const oDev = dev as OnboardDevice
    timerOpTime.value = oDev.operationTime ?? 50
    timerStbyTime.value = oDev.standbyTime ?? 10
  } else {
    const zDev = dev as ZigbeeDevice
    timerOpTime.value = zDev.deviceSettings?.operation_time ?? 50
    timerStbyTime.value = zDev.deviceSettings?.standby_time ?? 10
  }
}

function closeTimerModal() {
  timerModalDev.value = null
}

async function saveTimer() {
  if (!timerModalDev.value) return
  timerSaving.value = true
  try {
    if (timerModalType.value === 'fan-onboard' || timerModalType.value === 'opener-onboard') {
      const dev = timerModalDev.value as OnboardDevice
      await gatewayEnvApi.updateOnboard(gatewayId, dev.id, {
        operationTime: timerOpTime.value,
        standbyTime: timerStbyTime.value,
      })
      dev.operationTime = timerOpTime.value
      dev.standbyTime = timerStbyTime.value
    } else {
      const dev = timerModalDev.value as ZigbeeDevice
      await gatewayEnvApi.updateZigbee(gatewayId, dev.id, {
        deviceSettings: { operation_time: timerOpTime.value, standby_time: timerStbyTime.value },
      })
      dev.deviceSettings = { ...(dev.deviceSettings ?? {}), operation_time: timerOpTime.value, standby_time: timerStbyTime.value }
    }
    notif.success('저장 완료', '타이머 설정이 저장되었습니다.')
    closeTimerModal()
  } catch {
    notif.error('오류', '저장에 실패했습니다.')
  } finally {
    timerSaving.value = false
  }
}

const EQUIPMENT_OPTIONS = [
  { value: 'irrigation', label: '관주' },
  { value: 'fan', label: '환풍기(휀)' },
  { value: 'opener_open', label: '개폐기(열림)' },
  { value: 'opener_close', label: '개폐기(닫힘)' },
]

const IRRIGATION_SLOTS_8CH: Record<string, string> = {
  remote_control:       '원격제어 ON/OFF',
  fertilizer_b_contact: '액비/교반기 B접점',
  zone_1: '1구역 관주', zone_2: '2구역 관주', zone_3: '3구역 관주', zone_4: '4구역 관주',
  mixer: '교반기', fertilizer_motor: '액비',
}

const IRRIGATION_SLOTS_12CH: Record<string, string> = {
  remote_control:       '원격제어 ON/OFF',
  fertilizer_b_contact: '액비/교반기 B접점',
  zone_1: '1구역 관주', zone_2: '2구역 관주', zone_3: '3구역 관주', zone_4: '4구역 관주',
  zone_5: '5구역 관주', zone_6: '6구역 관주', zone_7: '7구역 관주', zone_8: '8구역 관주',
  mixer: '교반기', fertilizer_motor: '액비',
}

const mappingChannelCount = computed<8 | 12>(() => {
  if (!mappingModalDev.value) return 8
  const vals = Object.values(mappingModalDev.value.channelMapping ?? {}).filter(Boolean)
  return vals.length > 0 ? detectChannelCount(vals) : 8
})

const activeMappingSlots = computed(() =>
  mappingChannelCount.value === 12 ? IRRIGATION_SLOTS_12CH : IRRIGATION_SLOTS_8CH
)

const mappingSwitchCodes = computed(() =>
  mappingChannelCount.value === 12 ? AVAILABLE_SWITCH_CODES_12CH : AVAILABLE_SWITCH_CODES_8CH
)

function startEdit(id: string, name: string) {
  editingId.value = id
  editName.value = name
}

function cancelEdit() {
  editingId.value = null
  editName.value = ''
}

async function toggleZigbee(dev: ZigbeeDevice) {
  const newVal = dev.enabled === false ? true : false
  try {
    await gatewayEnvApi.updateZigbee(gatewayId, dev.id, { enabled: newVal })
    dev.enabled = newVal
  } catch { notif.error('오류', '상태 변경에 실패했습니다.') }
}

// Zigbee
async function saveZigbeeName(dev: ZigbeeDevice) {
  if (!editName.value.trim()) return
  try {
    await gatewayEnvApi.updateZigbee(gatewayId, dev.id, { name: editName.value.trim() })
    dev.name = editName.value.trim()
    cancelEdit()
    notif.success('저장 완료', '이름이 수정되었습니다.')
  } catch { notif.error('오류', '저장에 실패했습니다.') }
}

async function removeZigbee(dev: ZigbeeDevice) {
  if (!confirm(`"${dev.name}"을 삭제할까요?`)) return
  try {
    await gatewayEnvApi.removeZigbee(gatewayId, dev.id)
    zigbeeDevices.value = zigbeeDevices.value.filter(d => d.id !== dev.id)
    notif.success('삭제 완료', '장치가 삭제되었습니다.')
  } catch { notif.error('오류', '삭제에 실패했습니다.') }
}

function getMappingValue(dev: ZigbeeDevice, slotKey: string) {
  return mappingDraft.value[dev.id]?.[slotKey] ?? dev.channelMapping?.[slotKey] ?? ''
}

function updateMapping(dev: ZigbeeDevice, slotKey: string, value: string) {
  if (!mappingDraft.value[dev.id]) {
    mappingDraft.value[dev.id] = { ...(dev.channelMapping ?? {}) }
  }
  mappingDraft.value[dev.id][slotKey] = value
}

async function saveMappingFor(dev: ZigbeeDevice) {
  const mapping = mappingDraft.value[dev.id] ?? dev.channelMapping ?? {}
  try {
    const res = await gatewayEnvApi.updateZigbee(gatewayId, dev.id, { channelMapping: mapping })
    dev.channelMapping = res.data.channelMapping
    notif.success('저장 완료', '채널 매핑이 저장되었습니다.')
    closeMappingModal()
  } catch { notif.error('오류', '채널 매핑 저장에 실패했습니다.') }
}

// 장치 유형 선택
function selectDeviceType(ieee: string, dt: 'sensor' | 'actuator') {
  addForm.value[ieee + '_type'] = dt === 'sensor' ? 'sensor/other' : 'actuator/'
}

function selectEquipType(ieee: string, equip: string) {
  addForm.value[ieee + '_type'] = 'actuator/' + equip
  if (equip === 'opener_open' || equip === 'opener_close') {
    notif.warning('개폐기 선택', '개폐기는 열림/닫힘 세트로 함께 추가해야 합니다. 다른 장치에서도 개폐기를 선택해 주세요.')
  }
}

function isOpenerSelected(ieee: string) {
  const t = addForm.value[ieee + '_type']
  return t === 'actuator/opener_open' || t === 'actuator/opener_close'
}

const openerOpenPending = computed(() =>
  scannedDevices.value.filter(d =>
    addForm.value[d.ieee_address + '_type'] === 'actuator/opener_open' &&
    !addedIeees.value.has(d.ieee_address)
  )
)
const openerClosePending = computed(() =>
  scannedDevices.value.filter(d =>
    addForm.value[d.ieee_address + '_type'] === 'actuator/opener_close' &&
    !addedIeees.value.has(d.ieee_address)
  )
)
const openerPairReady = computed(() =>
  openerOpenPending.value.length >= 1 && openerClosePending.value.length >= 1
)

function canAdd(ieee: string): boolean {
  const t = addForm.value[ieee + '_type']
  if (!t || t === 'actuator/') return false
  if (isOpenerSelected(ieee)) return openerPairReady.value
  return true
}

async function handleAddDevice(sd: ZigbeeScannedDevice) {
  if (isOpenerSelected(sd.ieee_address)) {
    if (!openerPairReady.value) {
      notif.error('추가 불가', '개폐기는 열림/닫힘 세트로 함께 추가해야 합니다.')
      return
    }
    await addOpenerPairAuto()
  } else {
    await addZigbeeDevice(sd)
  }
}

// Scan
// ── 페어링 모드 (permit_join) ───────────────────────────
const permitJoining = ref(false)
const permitJoinSecondsLeft = ref(0)
let permitJoinInterval: ReturnType<typeof setInterval> | null = null
let permitJoinRescanInterval: ReturnType<typeof setInterval> | null = null

async function startPermitJoin() {
  try {
    await gatewayApi.permitJoin(gatewayId, true)
    permitJoining.value = true
    permitJoinSecondsLeft.value = 120
    notif.success('페어링 모드 시작', '120초 동안 새 Zigbee 장치를 수락합니다. 센서의 페어링 버튼을 눌러주세요.')

    // 카운트다운
    permitJoinInterval = setInterval(() => {
      permitJoinSecondsLeft.value -= 1
      if (permitJoinSecondsLeft.value <= 0) {
        stopPermitJoinTimers()
        permitJoining.value = false
      }
    }, 1000)

    // 페어링 중 5초마다 자동 재스캔 (새 장치가 들어오는지 확인)
    permitJoinRescanInterval = setInterval(() => { runScan() }, 5000)
  } catch (e: any) {
    notif.error('페어링 모드 실패', e?.response?.data?.message || '게이트웨이가 온라인인지 확인하세요.')
  }
}

function stopPermitJoinTimers() {
  if (permitJoinInterval) { clearInterval(permitJoinInterval); permitJoinInterval = null }
  if (permitJoinRescanInterval) { clearInterval(permitJoinRescanInterval); permitJoinRescanInterval = null }
}

async function cancelPermitJoin() {
  stopPermitJoinTimers()
  permitJoining.value = false
  permitJoinSecondsLeft.value = 0
  try {
    await gatewayApi.permitJoin(gatewayId, false)
    notif.success('페어링 모드 중지', '새 장치 수신을 중지했습니다.')
  } catch {
    // 무시
  }
}

// 모달 닫히거나 페이지 떠날 때 타이머 정리
watch(showScanModal, (open) => {
  if (!open && permitJoining.value) {
    stopPermitJoinTimers()
    permitJoining.value = false
  }
})
onBeforeUnmount(stopPermitJoinTimers)

async function openScan() {
  showScanModal.value = true
  await runScan()
}

async function runScan() {
  scanning.value = true
  scannedDevices.value = []
  addForm.value = {}
  addFormName.value = {}
  // Pre-populate with already-registered IEEE addresses so they're excluded from scan results
  addedIeees.value = new Set(zigbeeDevices.value.map(d => d.zigbeeIeee).filter(Boolean) as string[])
  try {
    const res = await gatewayEnvApi.scanZigbee(gatewayId)
    scannedDevices.value = Array.isArray(res.data) ? res.data : []
  } catch (e: any) {
    const status = e?.response?.status
    const msg = status === 403 ? '접근 권한이 없습니다.' : '스캔에 실패했습니다. 게이트웨이가 온라인인지 확인하세요.'
    notif.error('스캔 오류', msg)
  } finally { scanning.value = false }
}

async function addZigbeeDevice(sd: ZigbeeScannedDevice) {
  const typeStr = addForm.value[sd.ieee_address + '_type'] || ''
  const [deviceType, equipmentType] = typeStr.split('/')
  const customName = addFormName.value[sd.ieee_address]?.trim() || sd.friendly_name
  try {
    const res = await gatewayEnvApi.addZigbee(gatewayId, {
      zigbeeIeee: sd.ieee_address,
      friendlyName: sd.friendly_name,
      zigbeeModel: sd.model_id,
      name: customName,
      category: equipmentType || deviceType,
      deviceType: deviceType as 'sensor' | 'actuator',
      equipmentType: equipmentType as any,
      online: false,
    })
    zigbeeDevices.value.push(res.data)
    addedIeees.value = new Set([...addedIeees.value, sd.ieee_address])
    notif.success('추가 완료', `${customName}이 추가되었습니다.`)
  } catch { notif.error('오류', '장치 추가에 실패했습니다.') }
}

async function addOpenerPairAuto() {
  const openSd = openerOpenPending.value[0]
  const closeSd = openerClosePending.value[0]
  if (!openSd || !closeSd) return
  const openName = addFormName.value[openSd.ieee_address]?.trim() || openSd.friendly_name
  const closeName = addFormName.value[closeSd.ieee_address]?.trim() || closeSd.friendly_name
  const groupName = openName
  addingOpener.value = true
  try {
    const openRes = await gatewayEnvApi.addZigbee(gatewayId, {
      zigbeeIeee: openSd.ieee_address,
      friendlyName: openSd.friendly_name,
      zigbeeModel: openSd.model_id,
      name: openName,
      category: 'opener_open',
      deviceType: 'actuator',
      equipmentType: 'opener_open' as any,
      online: false,
      openerGroupName: groupName,
    })
    const closeRes = await gatewayEnvApi.addZigbee(gatewayId, {
      zigbeeIeee: closeSd.ieee_address,
      friendlyName: closeSd.friendly_name,
      zigbeeModel: closeSd.model_id,
      name: closeName,
      category: 'opener_close',
      deviceType: 'actuator',
      equipmentType: 'opener_close' as any,
      online: false,
      pairedDeviceId: openRes.data.id,
      openerGroupName: groupName,
    })
    zigbeeDevices.value.push(openRes.data, closeRes.data)
    addedIeees.value = new Set([...addedIeees.value, openSd.ieee_address, closeSd.ieee_address])
    notif.success('추가 완료', `개폐기 세트 "${groupName}"이 추가되었습니다.`)
  } catch { notif.error('오류', '개폐기 쌍 추가에 실패했습니다.') }
  finally { addingOpener.value = false }
}

async function loadAllDevices() {
  loading.value = true
  loadError.value = null
  try {
    const res = await gatewayEnvApi.getAllDevices(gatewayId)
    onboardDevices.value = res.data.onboard
    zigbeeDevices.value = res.data.zigbee
    if (res.data.irrigationDevice) {
      irrigationDeviceId.value = res.data.irrigationDevice.id
      irrigationDeviceName.value = res.data.irrigationDevice.name
    }
  } catch (e: any) {
    const status = e?.response?.status
    if (status === 404) loadError.value = '게이트웨이를 찾을 수 없습니다.'
    else if (status === 403) loadError.value = '접근 권한이 없습니다.'
    else loadError.value = '데이터를 불러오지 못했습니다. DB 마이그레이션이 적용됐는지 확인하세요.'
    notif.error('오류', loadError.value)
  } finally { loading.value = false }
}

onMounted(loadAllDevices)
</script>

<style scoped>
.header-row { display: flex; align-items: center; gap: 16px; }
.btn-back {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 6px 12px;
  cursor: pointer;
  font-size: 13px;
  white-space: nowrap;
  color: var(--text-primary);
}
.btn-back:hover { background: var(--bg-hover); }

.tab-bar { display: flex; gap: 4px; border-bottom: 2px solid var(--border-color); margin-bottom: 20px; }
.tab-btn {
  background: none; border: none; padding: 10px 20px;
  font-size: 14px; cursor: pointer; color: var(--text-secondary);
  border-bottom: 2px solid transparent; margin-bottom: -2px;
}
.tab-btn.active { color: #3b82f6; border-bottom-color: #3b82f6; font-weight: 600; }
.tab-count { background: #3b82f6; color: #fff; border-radius: 10px; padding: 1px 6px; font-size: 11px; margin-left: 4px; }

.section { display: flex; flex-direction: column; gap: 16px; }
.section-desc { font-size: 13px; color: var(--text-secondary); margin: 0 0 4px; }
.section-toolbar { display: flex; justify-content: space-between; align-items: flex-start; }

.slot-group { display: flex; flex-direction: column; gap: 8px; }
.slot-group-title { font-size: 13px; font-weight: 700; color: var(--text-secondary); padding: 4px 0; border-bottom: 1px solid var(--border-color); margin-bottom: 4px; }
.slot-group-body { display: flex; flex-direction: column; gap: 8px; }

.irrigation-name-bar {
  display: flex; align-items: center; gap: 8px;
  background: var(--bg-secondary); border: 1px solid var(--border-color);
  border-radius: 8px; padding: 10px 14px; margin-bottom: 4px;
}
.irrigation-name-label { font-size: 13px; color: var(--text-secondary); white-space: nowrap; }
.irrigation-name-value { font-size: 15px; font-weight: 600; }

.fixed-channel-badge { font-size: 11px; color: var(--text-muted); background: var(--bg-secondary); border-radius: 6px; padding: 2px 8px; display: inline-block; width: fit-content; }

.timer-badge { font-size: 11px; color: #3b82f6; background: rgba(59,130,246,.1); border-radius: 6px; padding: 2px 10px; display: inline-block; width: fit-content; }

.device-card {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.card-header { display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; }
.card-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  flex-wrap: wrap;          /* 좁은 화면에서 줄바꿈 허용 (이전: nowrap → 겹침 발생) */
  justify-content: flex-end;
}
.device-name-row { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; }
.slot-type-icon { font-size: 16px; flex-shrink: 0; }
.device-name { font-size: 15px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-primary); }
.name-input {
  border: 1px solid #3b82f6;
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 14px;
  background: var(--bg-input);
  color: var(--text-primary);
  flex: 1;
  max-width: 220px;
}
.btn-icon {
  background: none; border: none; cursor: pointer;
  color: var(--text-muted); font-size: 13px; padding: 2px 4px;
}
.btn-icon:hover { color: var(--text-primary); }
.btn-save { color: #16a34a !important; }

.btn-settings {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 4px 8px;
  cursor: pointer;
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
}
.btn-settings:hover { background: var(--bg-hover); }

/* 타이머 버튼 — GpioRelayManager와 동일한 작은 아이콘 스타일 */
.btn-sm.btn-timer {
  background: transparent;
  border: 1px solid var(--border-color, #d1d5db);
  border-radius: 5px;
  cursor: pointer;
  font-size: 12px;
  color: var(--text-secondary, #555);
  padding: 3px 8px;
}
.btn-sm.btn-timer:hover { background: var(--bg-hover, #f3f4f6); }

/* Toggle switch */
.toggle { position: relative; display: inline-flex; align-items: center; cursor: pointer; flex-shrink: 0; }
.toggle input { opacity: 0; width: 0; height: 0; position: absolute; }
.toggle-slider {
  position: relative;       /* ::before가 슬라이더 내부에 위치하도록 (이전: 부모 .toggle에 absolute로 떠 있어 겹침) */
  display: block;
  width: 38px;
  height: 22px;
  background: var(--border-color);
  border-radius: 11px;
  transition: background .2s;
  flex-shrink: 0;
}
.toggle-slider::before {
  content: ''; position: absolute; width: 16px; height: 16px; top: 3px; left: 3px;
  background: #fff; border-radius: 50%; transition: transform .2s; box-shadow: 0 1px 2px rgba(0,0,0,.2);
}
.toggle input:checked + .toggle-slider { background: #3b82f6; }
.toggle input:checked + .toggle-slider::before { transform: translateX(16px); }

/* Zigbee */
.device-meta { display: flex; gap: 6px; flex-wrap: wrap; }
.meta-tag { font-size: 11px; padding: 2px 8px; border-radius: 8px; background: var(--bg-secondary); color: var(--text-secondary); }
.meta-tag.mono { font-family: monospace; }
.meta-tag.online { background: rgba(34,197,94,.15); color: #16a34a; }
.meta-tag.offline { background: var(--bg-secondary); color: var(--text-muted); }

/* Mapping modal grid */
.mapping-grid { display: flex; flex-direction: column; gap: 6px; padding: 12px; background: var(--bg-secondary); border-radius: 8px; max-height: 360px; overflow-y: auto; }
.mapping-row { display: flex; align-items: center; gap: 10px; }
.mapping-label { font-size: 13px; width: 100px; color: var(--text-secondary); flex-shrink: 0; }
.mapping-select {
  border: 1px solid var(--border-color);
  border-radius: 4px;
  padding: 4px 6px;
  font-size: 13px;
  background: var(--bg-input);
  color: var(--text-primary);
  flex: 1;
}

/* Timer modal */
.modal-sm-fixed { max-width: 360px; }
.timer-form { display: flex; flex-direction: column; gap: 12px; }
.timer-row { display: flex; align-items: center; gap: 10px; }
.timer-label { font-size: 14px; color: var(--text-secondary); width: 70px; flex-shrink: 0; }
.timer-input {
  width: 80px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 6px 8px;
  font-size: 15px;
  text-align: center;
  background: var(--bg-input);
  color: var(--text-primary);
}
.timer-unit { font-size: 13px; color: var(--text-secondary); }
.timer-defaults { font-size: 12px; color: var(--text-muted); margin-top: 4px; }

/* Scan modal */

/* 페어링 진행 배너 (페어링 모드 활성 시) */
.pairing-banner {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 14px; margin-bottom: 14px;
  border-radius: 10px;
}
.pairing-banner-active {
  background: color-mix(in srgb, var(--color-primary, #4caf50) 12%, var(--bg-card));
  border: 1px solid var(--color-primary, #4caf50);
  animation: pairingPulse 1.6s ease-in-out infinite;
}
@keyframes pairingPulse {
  0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--color-primary, #4caf50) 30%, transparent); }
  50% { box-shadow: 0 0 0 6px color-mix(in srgb, var(--color-primary, #4caf50) 0%, transparent); }
}
.pairing-banner-icon { font-size: 28px; line-height: 1; }
.pairing-banner-text { flex: 1; display: flex; flex-direction: column; gap: 2px; }
.pairing-banner-text strong { color: var(--text-primary); font-size: 14px; }
.pairing-banner-text span { color: var(--text-secondary); font-size: 12px; }

/* 빈 상태: 새 장치 페어링 CTA */
.empty-pair-cta {
  display: flex; flex-direction: column; align-items: center;
  gap: 14px; padding: 28px 20px; text-align: center;
  background: var(--bg-secondary); border-radius: 10px;
}
.empty-pair-title { font-size: 16px; font-weight: 700; color: var(--text-primary); }
.empty-pair-desc { font-size: 13px; color: var(--text-secondary); line-height: 1.6; margin: 0; }
.btn-pair-start {
  padding: 12px 24px; font-size: 15px; font-weight: 600;
}
.empty-pair-secondary { font-size: 12px; color: var(--text-muted); margin-top: 4px; }
.link-btn {
  background: none; border: none; color: var(--color-primary, #4caf50);
  cursor: pointer; text-decoration: underline; font-size: 12px; padding: 0;
}

.scan-list { display: flex; flex-direction: column; gap: 10px; max-height: 420px; overflow-y: auto; }
.scan-item {
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--bg-card);
}
.scan-item-done { background: var(--bg-secondary); opacity: 0.7; }
.scan-item-header { display: flex; justify-content: space-between; align-items: flex-start; }
.scan-name { font-size: 14px; font-weight: 600; color: var(--text-primary); }
.scan-meta { font-size: 11px; font-family: monospace; color: var(--text-muted); }
.scan-field { display: flex; align-items: center; gap: 8px; }
.scan-field-label { font-size: 12px; color: var(--text-secondary); width: 60px; flex-shrink: 0; }
.scan-name-input {
  flex: 1; border: 1px solid var(--border-color);
  border-radius: 4px; padding: 4px 8px; font-size: 13px;
  background: var(--bg-input); color: var(--text-primary);
}
.scan-actions { display: flex; gap: 8px; align-items: center; justify-content: flex-end; }
.added-badge { font-size: 12px; color: #16a34a; font-weight: 600; white-space: nowrap; }

/* Device type 2-step selection */
.dtype-toggle { display: flex; gap: 8px; }
.dtype-btn {
  flex: 1; padding: 8px 12px; border: 1.5px solid var(--border-color);
  border-radius: 8px; background: var(--bg-card); cursor: pointer; font-size: 13px;
  color: var(--text-primary); transition: all .15s;
}
.dtype-btn:hover { background: var(--bg-hover); }
.dtype-btn.dtype-active {
  border-color: #3b82f6; background: rgba(59,130,246,.1);
  color: #3b82f6; font-weight: 600;
}

.equip-options { display: flex; flex-wrap: wrap; gap: 6px; }
.equip-btn {
  padding: 5px 12px; border: 1.5px solid var(--border-color);
  border-radius: 20px; background: var(--bg-card); cursor: pointer; font-size: 12px;
  color: var(--text-primary); transition: all .15s;
}
.equip-btn:hover { background: var(--bg-hover); }
.equip-btn.equip-active {
  border-color: #3b82f6; background: rgba(59,130,246,.1);
  color: #3b82f6; font-weight: 600;
}

.opener-warning {
  font-size: 12px; color: var(--warning-text, #92400e); background: var(--warning-bg, #fffbeb);
  border: 1px solid var(--warning-border, #fde68a); border-radius: 6px; padding: 8px 10px;
}

/* Buttons */
.btn-primary {
  background: #3b82f6; color: #fff; border: none;
  border-radius: 6px; padding: 8px 16px; cursor: pointer; font-size: 14px;
}
.btn-primary:hover:not(:disabled) { background: #2563eb; }
.btn-primary:disabled { opacity: .5; cursor: not-allowed; }
.btn-secondary {
  background: var(--bg-card); border: 1px solid var(--border-color);
  border-radius: 6px; padding: 6px 12px; cursor: pointer; font-size: 13px;
  color: var(--text-secondary);
}
.btn-secondary:hover { background: var(--bg-hover); }
.btn-danger {
  background: transparent; border: 1px solid rgba(220,38,38,.4); color: #dc2626;
  border-radius: 6px; padding: 4px 10px; cursor: pointer; font-size: 12px;
}
.btn-danger:hover { background: rgba(220,38,38,.08); }
.btn-test {
  background: rgba(34,197,94,.1); border: 1px solid rgba(34,197,94,.4); color: #16a34a;
  border-radius: 6px; padding: 4px 10px; cursor: pointer; font-size: 12px;
}
.btn-test:hover { background: rgba(34,197,94,.2); }
.btn-sm { font-size: 12px; padding: 4px 10px; }

/* Admin 핀 테스트 툴바 */
.admin-tool-bar {
  display: flex; justify-content: flex-end; gap: 8px; margin-bottom: 8px;
}
.btn-pin-test, .btn-pinout {
  padding: 7px 16px; border-radius: 8px; font-size: 13px; font-weight: 600;
  cursor: pointer; transition: all 0.15s;
}
.btn-pin-test {
  border: 1px solid rgba(34,197,94,.4); background: rgba(34,197,94,.1); color: #16a34a;
}
.btn-pin-test:hover { background: rgba(34,197,94,.2); }
.btn-pinout {
  border: 1px solid var(--border-color); background: var(--bg-card); color: var(--text-secondary);
}
.btn-pinout:hover { background: var(--bg-hover); }

/* Modal */
.modal-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,.5);
  display: flex; align-items: center; justify-content: center; z-index: 999;
}
.modal {
  background: var(--bg-card); border-radius: 12px; padding: 24px;
  width: 480px; max-width: 90vw; display: flex; flex-direction: column; gap: 16px;
  max-height: 80vh; overflow-y: auto;
}
.modal h3 { margin: 0; font-size: 17px; color: var(--text-primary); }
.modal-desc { font-size: 13px; color: var(--text-secondary); margin: 0; }
.modal-actions { display: flex; gap: 8px; justify-content: flex-end; }

.loading-state { padding: 40px; text-align: center; color: var(--text-secondary); }
.empty-state { padding: 40px; text-align: center; color: var(--text-secondary); }
.error-state { padding: 20px; background: rgba(220,38,38,.08); border-radius: 8px; color: #dc2626; border: 1px solid rgba(220,38,38,.2); }
.error-hint { font-size: 12px; color: var(--text-muted); margin-top: 4px; }

/* ── GPIO 배치도 모달 ─────────────────────────── */
.pinout-modal {
  background: var(--bg-card);
  border-radius: 14px;
  width: 680px;
  max-width: 96vw;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 60px rgba(0,0,0,.35);
}
.pinout-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 20px; border-bottom: 1px solid var(--border-color);
  font-size: 15px; font-weight: 700; color: var(--text-primary);
  flex-shrink: 0;
}
.modal-close {
  background: none; border: none; font-size: 16px; cursor: pointer;
  color: var(--text-muted); padding: 2px 6px;
}
.modal-close:hover { color: var(--text-primary); }
.pinout-body {
  padding: 16px 20px; overflow-y: auto;
  display: flex; flex-direction: column; gap: 12px;
}
.pinout-note {
  font-size: 12px; color: var(--text-muted); margin: 0;
  padding: 6px 10px; background: var(--bg-secondary); border-radius: 6px;
}
.pinout-board {
  display: flex; gap: 12px; justify-content: center;
}
.pinout-col { display: flex; flex-direction: column; gap: 3px; }
.pinout-row {
  display: flex; align-items: center; gap: 6px;
  height: 28px;
}
.right-row { flex-direction: row-reverse; }
.pin-label-left {
  font-size: 11px; color: var(--text-secondary);
  text-align: right; width: 110px; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis;
}
.pin-label-right {
  font-size: 11px; color: var(--text-secondary);
  text-align: left; width: 110px; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis;
}
.pin-circle {
  width: 26px; height: 26px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 10px; font-weight: 700; flex-shrink: 0;
}
.pin-circle.gpio    { background: #3b82f6; color: #fff; }
.pin-circle.power   { background: #ef4444; color: #fff; }
.pin-circle.gnd     { background: #374151; color: #fff; }
.pin-circle.special { background: #f59e0b; color: #fff; }

.pinout-legend {
  display: flex; flex-wrap: wrap; gap: 12px;
  padding: 10px 14px; background: var(--bg-secondary);
  border-radius: 8px; font-size: 12px; color: var(--text-secondary);
}
.legend-item { display: flex; align-items: center; gap: 5px; }
.legend-item .pin-circle {
  width: 16px; height: 16px; font-size: 10px;
}
</style>
