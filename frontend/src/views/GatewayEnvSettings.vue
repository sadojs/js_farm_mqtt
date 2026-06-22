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

      <div v-for="dev in zigbeeRootDevices" :key="dev.id" class="device-card"
        :class="{ 'card-enabled': (dev.equipmentType === 'irrigation' && zigbeeAnyActive(dev)) || (dev.equipmentType === 'controller' && controllerAnyActive(dev)) }">
        <div class="card-header" :class="{ 'card-header-clickable': dev.equipmentType === 'irrigation' || dev.equipmentType === 'controller' }"
          @click="(dev.equipmentType === 'irrigation' || dev.equipmentType === 'controller') && toggleZigbeeExpand(dev.id)">
          <div class="device-name-row">
            <span v-if="editingId !== dev.id" class="device-name">{{ dev.name }}</span>
            <input v-else v-model="editName" class="name-input" @click.stop @keyup.enter="saveZigbeeName(dev)" @keyup.escape="cancelEdit()" />
            <button v-if="editingId !== dev.id" class="btn-icon" @click.stop="startEdit(dev.id, dev.name)">✏</button>
            <template v-else>
              <button class="btn-icon btn-save" @click.stop="saveZigbeeName(dev)">✓</button>
              <button class="btn-icon" @click.stop="cancelEdit()">✕</button>
            </template>
          </div>
          <div class="card-actions" @click.stop>
            <!-- 관수: 활성 채널 수 표시 -->
            <span v-if="dev.equipmentType === 'irrigation'" class="zb-meta-chip">
              {{ zigbeeChannelCountFor(dev) }}채널 · 활성 {{ zigbeeActiveCount(dev) }}
            </span>
            <span v-else-if="dev.equipmentType === 'controller'" class="zb-meta-chip">
              {{ controllerChildren(dev).length }}{{ controllerModeOf(dev) === 'opener' ? '쌍 개폐기' : '개 유동팬' }} · 활성 {{ controllerActiveUnitsCount(dev) }}
            </span>
            <!-- 팬: 타이머 설정 버튼 -->
            <button v-if="dev.equipmentType === 'fan'" class="btn-sm btn-timer" @click.stop="openTimerModal(dev, 'fan-zigbee')" title="타이머 설정">⏱</button>
            <!-- 개폐기 타이머 -->
            <button v-if="dev.equipmentType === 'opener_open'" class="btn-sm btn-timer" @click.stop="openTimerModal(dev, 'opener')" title="타이머 설정">⏱</button>
            <!-- 단일 채널 지그비 액추에이터 (fan, opener_open, opener_close): inline ON/OFF 테스트 -->
            <template v-if="authStore.isAdmin && isSingleChannelZigbeeActuator(dev)">
              <button class="relay-btn on btn-sm" @click.stop="testSingleZigbee(dev, true)" title="테스트 ON">ON</button>
              <button class="relay-btn off btn-sm" @click.stop="testSingleZigbee(dev, false)" title="테스트 OFF">OFF</button>
            </template>
            <!-- device-replacement: 🔄 교체 버튼 (FR-13: 환경설정 Zigbee 탭의 device row에만 노출) -->
            <button v-if="authStore.isAdmin && canReplace(dev)" class="btn-replace btn-sm"
              @click.stop="openReplaceModal(dev)" title="동일 기종 새 장치로 교체 (기존 룰/매핑 보존)">
              🔄 교체
            </button>
            <label class="toggle">
              <input type="checkbox" :checked="dev.enabled !== false" @change="toggleZigbee(dev)" />
              <span class="toggle-slider"></span>
            </label>
            <button class="btn-danger btn-sm" @click.stop="removeZigbee(dev)">삭제</button>
            <span v-if="dev.equipmentType === 'irrigation' || dev.equipmentType === 'controller'" class="expand-arrow">
              {{ expandedZigbeeIds.has(dev.id) ? '▲' : '▼' }}
            </span>
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
        <!-- 관수 채널 그리드 (onboard 동일 스타일, expand 시) -->
        <div v-if="dev.equipmentType === 'irrigation' && expandedZigbeeIds.has(dev.id)" class="card-body">
          <div class="channel-grid">
            <div v-for="(slot, i) in zigbeeChannelSlots(dev)" :key="slot.key" class="channel-row"
              :class="{ 'ch-inactive': !slot.enabled }">
              <div class="ch-num" :style="{ background: '#0ea5e922', borderColor: '#0ea5e955', color: '#0ea5e9' }">
                {{ i + 1 }}
              </div>
              <div class="ch-name">{{ slot.label }}</div>
              <div class="pin-wrap">
                <span class="pin-label">CH</span>
                <select class="pin-select" :value="slot.code"
                  @change="updateZigbeeMapping(dev, slot.key, ($event.target as HTMLSelectElement).value)">
                  <option v-for="sw in zigbeeAvailableSwitchesFor(dev, slot.key)" :key="sw" :value="sw">{{ sw }}</option>
                </select>
              </div>
              <button class="relay-btn on" :disabled="!slot.code || !slot.enabled"
                @click="zigbeeTestChannel(dev, slot.code, true)">ON</button>
              <button class="relay-btn off" :disabled="!slot.code || !slot.enabled"
                @click="zigbeeTestChannel(dev, slot.code, false)">OFF</button>
              <label class="toggle toggle-sm">
                <input type="checkbox" :checked="slot.enabled"
                  @change="toggleZigbeeChannel(dev, slot.key)" />
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>
          <div class="bulk-actions">
            <button class="btn-bulk" @click="zigbeeBulkActivate(dev, true)">전체 활성화</button>
            <button class="btn-bulk" @click="zigbeeBulkActivate(dev, false)">전체 비활성화</button>
          </div>
        </div>

        <!-- Controller (fan/opener) 채널 그리드 -->
        <div v-if="dev.equipmentType === 'controller' && expandedZigbeeIds.has(dev.id)" class="card-body">
          <!-- 유동팬: 1ch = 1 fan, 개별 이름 ✏ -->
          <div v-if="controllerModeOf(dev) === 'fan'" class="channel-grid">
            <div v-for="(child, i) in controllerChildren(dev)" :key="child.id" class="channel-row"
              :class="{ 'ch-inactive': isChildDisabled(dev, child) }">
              <div class="ch-num" :style="{ background: '#0ea5e922', borderColor: '#0ea5e955', color: '#0ea5e9' }">
                {{ i + 1 }}
              </div>
              <!-- 이름 ✏ -->
              <template v-if="editingChildId === child.id">
                <input v-model="editChildName" class="ch-name-input"
                  @keyup.enter="saveChildName(child)" @keyup.escape="cancelChildEdit()" @click.stop />
                <button class="btn-icon btn-save" @click.stop="saveChildName(child)">✓</button>
                <button class="btn-icon" @click.stop="cancelChildEdit()">✕</button>
              </template>
              <template v-else>
                <span class="ch-name">{{ child.name }}</span>
                <button class="btn-icon" @click.stop="startChildEdit(child)" title="이름 변경">✏</button>
              </template>
              <div class="pin-wrap">
                <span class="pin-label">CH</span>
                <select class="pin-select" :value="child.channelCode"
                  @change="updateChildChannelCode(dev, child, ($event.target as HTMLSelectElement).value)">
                  <option v-for="sw in availableChannelCodesFor(dev, child)" :key="sw" :value="sw">{{ sw }}</option>
                </select>
              </div>
              <button class="relay-btn on" :disabled="isChildDisabled(dev, child)"
                @click="controllerTestChild(dev, child, true)">ON</button>
              <button class="relay-btn off" :disabled="isChildDisabled(dev, child)"
                @click="controllerTestChild(dev, child, false)">OFF</button>
              <label class="toggle toggle-sm">
                <input type="checkbox" :checked="!isChildDisabled(dev, child)"
                  @change="toggleChildEnabled(dev, child)" />
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>

          <!-- 개폐기 페어: 1쌍 = open+close, 페어 대표 이름 ✏ 편집 -->
          <div v-else-if="controllerModeOf(dev) === 'opener'" class="channel-grid">
            <div v-for="(pair, pi) in controllerOpenerPairs(dev)" :key="pair.groupName" class="opener-pair-block"
              :class="{ 'ch-inactive': isPairDisabled(dev, pair) }">
              <div class="opener-pair-header">
                <div class="ch-num" :style="{ background: '#0ea5e922', borderColor: '#0ea5e955', color: '#0ea5e9' }">{{ pi + 1 }}</div>
                <template v-if="editingPairGroup === pair.groupName">
                  <input v-model="editPairName" class="ch-name-input"
                    @keyup.enter="savePairName(pair)" @keyup.escape="cancelPairEdit()" @click.stop
                    placeholder="예: 옥수수밭, 천창A 등" autofocus />
                  <button class="btn-icon btn-save" @click.stop="savePairName(pair)" title="저장">✓</button>
                  <button class="btn-icon" @click.stop="cancelPairEdit()" title="취소">✕</button>
                </template>
                <template v-else>
                  <span class="ch-name pair-name" @click.stop="startPairEdit(pair)" title="클릭하여 이름 변경">{{ pair.groupName }}</span>
                  <button class="btn-icon btn-edit-prominent" @click.stop="startPairEdit(pair)" title="페어 이름 변경">✏ 이름</button>
                </template>
                <label class="toggle toggle-sm" style="margin-left:auto;">
                  <input type="checkbox" :checked="!isPairDisabled(dev, pair)"
                    @change="togglePairEnabled(dev, pair)" />
                  <span class="toggle-slider"></span>
                </label>
              </div>
              <div class="opener-sub-row">
                <span class="opener-sub-label">열림</span>
                <div class="pin-wrap">
                  <span class="pin-label">CH</span>
                  <select class="pin-select" :value="pair.openChild.channelCode"
                    @change="updateChildChannelCode(dev, pair.openChild, ($event.target as HTMLSelectElement).value)">
                    <option v-for="sw in availableChannelCodesFor(dev, pair.openChild)" :key="sw" :value="sw">{{ sw }}</option>
                  </select>
                </div>
                <button class="relay-btn on" :disabled="isPairDisabled(dev, pair)"
                  @click="controllerTestChild(dev, pair.openChild, true)">ON</button>
                <button class="relay-btn off" :disabled="isPairDisabled(dev, pair)"
                  @click="controllerTestChild(dev, pair.openChild, false)">OFF</button>
              </div>
              <div class="opener-sub-row">
                <span class="opener-sub-label">닫힘</span>
                <div class="pin-wrap">
                  <span class="pin-label">CH</span>
                  <select class="pin-select" :value="pair.closeChild.channelCode"
                    @change="updateChildChannelCode(dev, pair.closeChild, ($event.target as HTMLSelectElement).value)">
                    <option v-for="sw in availableChannelCodesFor(dev, pair.closeChild)" :key="sw" :value="sw">{{ sw }}</option>
                  </select>
                </div>
                <button class="relay-btn on" :disabled="isPairDisabled(dev, pair)"
                  @click="controllerTestChild(dev, pair.closeChild, true)">ON</button>
                <button class="relay-btn off" :disabled="isPairDisabled(dev, pair)"
                  @click="controllerTestChild(dev, pair.closeChild, false)">OFF</button>
              </div>
            </div>
          </div>
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

    <!-- ── device-replacement: 교체 모달 (admin only) ── -->
    <DeviceReplaceModal
      :visible="showReplaceModal"
      :device-id="replaceTargetId"
      :gateway-uuid="gatewayId"
      @close="closeReplaceModal"
      @replaced="onDeviceReplaced"
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
        <p class="modal-desc">
          Zigbee 스위치 코드와 관수 기능을 연결합니다. ({{ mappingChannelCount }}채널)<br>
          <small class="modal-hint">⊘ 비활성화로 설정하면 자동제어룰/구역관리에서 해당 채널이 숨겨집니다.</small>
        </p>
        <div class="mapping-grid">
          <div v-for="(label, key) in activeMappingSlots" :key="key" class="mapping-row">
            <span class="mapping-label">{{ label }}</span>
            <select :value="getMappingValue(mappingModalDev, key)" @change="updateMapping(mappingModalDev, key, ($event.target as HTMLSelectElement).value)" class="mapping-select" :class="{ disabled: !getMappingValue(mappingModalDev, key) }">
              <option value="">⊘ 비활성화</option>
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

            <!-- 자동 감지 안내 배지 -->
            <div v-if="isMultiChannelDevice(sd)" class="detected-banner">
              🎛 <strong>다채널 컨트롤러</strong>로 감지되었습니다 — 관수/유동팬/개폐기 페어 중 선택하세요
              <span v-if="z2mReportedDescription(sd)" class="detected-hint-inline">
                (z2m 보고: {{ z2mReportedDescription(sd) }} — 실제 채널 수가 다를 수 있으니 아래에서 확인)
              </span>
            </div>

            <!-- 1단계: 측정기 / 장치 / 컨트롤러 선택 -->
            <!-- 다채널 컨트롤러로 감지된 경우 측정기/단일 장치 옵션은 숨김 (혼동 방지) -->
            <div class="dtype-toggle">
              <button v-if="!isMultiChannelDevice(sd)"
                :class="['dtype-btn', addForm[sd.ieee_address + '_type'] === 'sensor/other' && 'dtype-active']"
                @click="selectDeviceType(sd.ieee_address, 'sensor')">
                🌡 측정기
              </button>
              <button v-if="!isMultiChannelDevice(sd)"
                :class="['dtype-btn', addForm[sd.ieee_address + '_type']?.startsWith('actuator/') && 'dtype-active']"
                @click="selectDeviceType(sd.ieee_address, 'actuator')">
                ⚙ 장치
              </button>
              <button v-if="isMultiChannelDevice(sd)"
                :class="['dtype-btn', addForm[sd.ieee_address + '_type']?.startsWith('controller/') && 'dtype-active']"
                @click="selectDeviceType(sd.ieee_address, 'controller')">
                🎛 컨트롤러 ({{ detectControllerChannelCount(sd) }}ch)
              </button>
              <!-- escape hatch: 다채널 감지 결과를 거부하고 측정기/단일 장치로 처리 -->
              <button v-if="isMultiChannelDevice(sd)"
                class="dtype-btn dtype-btn-secondary"
                :class="{ 'dtype-active': addForm[sd.ieee_address + '_type'] === 'sensor/other' || addForm[sd.ieee_address + '_type']?.startsWith('actuator/') }"
                @click="selectDeviceType(sd.ieee_address, 'actuator')"
                title="다채널 감지를 무시하고 단일 장치로 추가 (드물게 z2m 메타데이터 부정확한 경우)">
                기타…
              </button>
            </div>

            <!-- 2단계 (장치): 장치 세부 유형 -->
            <div v-if="addForm[sd.ieee_address + '_type']?.startsWith('actuator/')" class="equip-options">
              <button v-for="opt in EQUIPMENT_OPTIONS" :key="opt.value"
                :class="['equip-btn', addForm[sd.ieee_address + '_type'] === 'actuator/' + opt.value && 'equip-active']"
                @click="selectEquipType(sd.ieee_address, opt.value)">
                {{ opt.label }}
              </button>
            </div>

            <!-- 2단계 (컨트롤러): 모드 선택 + 채널 수 -->
            <div v-if="addForm[sd.ieee_address + '_type']?.startsWith('controller/')" class="equip-options">
              <button v-for="opt in CONTROLLER_MODE_OPTIONS" :key="opt.value"
                :class="['equip-btn', addForm[sd.ieee_address + '_type'] === 'controller/' + opt.value && 'equip-active']"
                @click="selectControllerMode(sd.ieee_address, opt.value)">
                {{ opt.label }}
              </button>
            </div>

            <!-- 컨트롤러 채널 수 선택 (모델로 자동 감지되지 않는 경우 fallback) -->
            <div v-if="addForm[sd.ieee_address + '_type']?.startsWith('controller/')" class="controller-extra">
              <label class="scan-field-label">채널 수</label>
              <div class="dtype-toggle dtype-toggle-sm">
                <button :class="['dtype-btn', controllerCh[sd.ieee_address] === 8 && 'dtype-active']"
                  @click="controllerCh[sd.ieee_address] = 8">8채널</button>
                <button :class="['dtype-btn', controllerCh[sd.ieee_address] === 12 && 'dtype-active']"
                  @click="controllerCh[sd.ieee_address] = 12">12채널</button>
              </div>
              <div class="controller-hint" v-if="controllerCh[sd.ieee_address] === 12 && addForm[sd.ieee_address + '_type'] === 'controller/opener'">
                ⓘ 12채널 개폐기는 기본 6쌍 (열림/닫힘 인접 채널)으로 생성됩니다
              </div>
              <div class="controller-hint" v-else-if="controllerCh[sd.ieee_address] === 8 && addForm[sd.ieee_address + '_type'] === 'controller/opener'">
                ⓘ 8채널 개폐기는 기본 4쌍 (열림/닫힘 인접 채널)으로 생성됩니다
              </div>
              <div class="controller-hint" v-else-if="addForm[sd.ieee_address + '_type'] === 'controller/fan'">
                ⓘ 유동팬은 각 채널이 1개의 독립 팬으로 등록됩니다 ({{ controllerCh[sd.ieee_address] || 8 }}개)
              </div>
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
                {{
                  addForm[sd.ieee_address + '_type']?.startsWith('controller/') ? '컨트롤러 등록' :
                  isOpenerSelected(sd.ieee_address) ? '쌍으로 추가' : '추가'
                }}
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
import { detectChannelCount, AVAILABLE_SWITCH_CODES_8CH, AVAILABLE_SWITCH_CODES_12CH, FUNCTION_LABELS } from '@/types/device.types'
import { deviceApi } from '@/api/device.api'
import GpioRelayManager from '@/components/gateway/GpioRelayManager.vue'
import PinTestModal from '@/components/gateway/PinTestModal.vue'
import DeviceReplaceModal from '@/components/devices/DeviceReplaceModal.vue'

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

const loading = ref(false)
const loadError = ref<string | null>(null)
const activeTab = ref<'onboard' | 'zigbee'>('onboard')
const onboardDevices = ref<OnboardDevice[]>([])
const zigbeeDevices = ref<ZigbeeDevice[]>([])

// Zigbee 관수 인라인 채널 카드 — onboard 동일 패턴 (매핑은 보존, enabled 별도 관리)
// Controller card 상태 — root만 v-for에 표시
const zigbeeRootDevices = computed(() => zigbeeDevices.value.filter(d => !d.parentDeviceId))

function controllerChildren(parent: ZigbeeDevice): ZigbeeDevice[] {
  return zigbeeDevices.value
    .filter(d => d.parentDeviceId === parent.id)
    .sort((a, b) => {
      // channel_code 숫자 추출 후 정렬 (switch_1 < switch_2 < ... < switch_12)
      const num = (s: string | null | undefined) => Number((s ?? '').replace(/^switch_/, '')) || 0
      return num(a.channelCode) - num(b.channelCode)
    })
}

function controllerModeOf(parent: ZigbeeDevice): 'fan' | 'opener' | null {
  const children = controllerChildren(parent)
  if (children.length === 0) return null
  const first = children[0]
  if (first.equipmentType === 'fan') return 'fan'
  if (first.equipmentType === 'opener_open' || first.equipmentType === 'opener_close') return 'opener'
  return null
}

interface OpenerPairInfo { groupName: string; openChild: ZigbeeDevice; closeChild: ZigbeeDevice }
function controllerOpenerPairs(parent: ZigbeeDevice): OpenerPairInfo[] {
  const children = controllerChildren(parent)
  const byGroup = new Map<string, { open?: ZigbeeDevice; close?: ZigbeeDevice }>()
  for (const c of children) {
    const g = c.openerGroupName ?? c.name
    if (!byGroup.has(g)) byGroup.set(g, {})
    if (c.equipmentType === 'opener_open') byGroup.get(g)!.open = c
    else if (c.equipmentType === 'opener_close') byGroup.get(g)!.close = c
  }
  const result: OpenerPairInfo[] = []
  for (const [groupName, { open, close }] of byGroup) {
    if (open && close) result.push({ groupName, openChild: open, closeChild: close })
  }
  return result
}

function parentDisabledSet(parent: ZigbeeDevice): Set<string> {
  return new Set<string>(((parent as any).disabledChannels ?? []) as string[])
}

function isChildDisabled(parent: ZigbeeDevice, child: ZigbeeDevice): boolean {
  return parentDisabledSet(parent).has(child.id)
}

function isPairDisabled(parent: ZigbeeDevice, pair: OpenerPairInfo): boolean {
  const set = parentDisabledSet(parent)
  return set.has(pair.openChild.id) || set.has(pair.closeChild.id)
}

function controllerAnyActive(parent: ZigbeeDevice): boolean {
  return controllerChildren(parent).some(c => !isChildDisabled(parent, c))
}

function controllerActiveUnitsCount(parent: ZigbeeDevice): number {
  const mode = controllerModeOf(parent)
  if (mode === 'fan') return controllerChildren(parent).filter(c => !isChildDisabled(parent, c)).length
  if (mode === 'opener') return controllerOpenerPairs(parent).filter(p => !isPairDisabled(parent, p)).length
  return 0
}

function availableChannelCodesFor(parent: ZigbeeDevice, child: ZigbeeDevice): string[] {
  // parent.zigbeeModel에서 채널 수 추정 (예: TS0601_switch_8 → 8)
  const m = (parent as any).zigbeeModel?.toLowerCase?.().match(/_switch_(\d+)/)
  const total = m ? Number(m[1]) : 8
  const codes = Array.from({ length: total }, (_, i) => `switch_${i + 1}`)
  const used = new Set<string>()
  for (const c of controllerChildren(parent)) {
    if (c.id !== child.id && c.channelCode) used.add(c.channelCode)
  }
  return codes.filter(c => !used.has(c))
}

async function updateChildChannelCode(_parent: ZigbeeDevice, child: ZigbeeDevice, value: string) {
  try {
    const { data } = await deviceApi.updateChannelCode(child.id, value)
    child.channelCode = (data as any).channelCode ?? value
  } catch (e: any) {
    notif.error('저장 실패', e?.response?.data?.message ?? '채널 코드 변경 실패')
  }
}

async function controllerTestChild(_parent: ZigbeeDevice, child: ZigbeeDevice, state: boolean) {
  // 자기 channel_code로 z2m publish (backend가 parent friendlyName + state_lN 자동 변환)
  // 개폐기 페어 인터록도 controlDevice 호출 path를 통해 자동 적용 (devices.service.ts:572)
  try {
    await deviceApi.control(child.id, [{ code: child.channelCode ?? 'state', value: state }])
  } catch (e: any) {
    notif.error('테스트 실패', `${child.name} ${state ? 'ON' : 'OFF'} 실패`)
  }
}

// 단일 채널 지그비 액추에이터 판정 — 멀티채널(irrigation/controller)과 children 제외
function isSingleChannelZigbeeActuator(dev: ZigbeeDevice): boolean {
  if (dev.deviceType !== 'actuator') return false
  if (dev.parentDeviceId) return false  // child는 별도 UI 통해 테스트
  return dev.equipmentType === 'fan'
    || dev.equipmentType === 'opener_open'
    || dev.equipmentType === 'opener_close'
}

// 단일 채널 지그비 액추에이터 테스트 — 개폐기 페어 인터록은 backend에서 자동 처리
async function testSingleZigbee(dev: ZigbeeDevice, state: boolean) {
  try {
    await deviceApi.control(dev.id, [{ code: 'switch_1', value: state }])
    notif.success(state ? 'ON 명령' : 'OFF 명령', dev.name)
  } catch (e: any) {
    notif.error('테스트 실패', `${dev.name} ${state ? 'ON' : 'OFF'} 실패`)
  }
}

// ── device-replacement: 교체 진입점 (FR-13 환경설정 Zigbee 탭에서만) ──
const showReplaceModal = ref(false)
const replaceTargetId = ref<string | null>(null)

function canReplace(dev: ZigbeeDevice): boolean {
  // zigbee actuator + sensor 모두 교체 가능, child는 parent를 통해서만 교체
  if (dev.parentDeviceId) return false
  return true
}

function openReplaceModal(dev: ZigbeeDevice) {
  replaceTargetId.value = dev.id
  showReplaceModal.value = true
}

function closeReplaceModal() {
  showReplaceModal.value = false
  replaceTargetId.value = null
}

async function onDeviceReplaced(_payload: { deviceId: string; oldIeee: string; newIeee: string }) {
  // 교체 완료 후 device 목록 재로드 (새 IEEE 반영)
  await loadAllDevices()
}

async function toggleChildEnabled(parent: ZigbeeDevice, child: ZigbeeDevice) {
  const enabled = isChildDisabled(parent, child)
  const key = child.channelCode || ''
  if (!key) return
  try {
    const { data } = await deviceApi.updateChannelEnabled(parent.id, key, enabled)
    ;(parent as any).disabledChannels = (data as any).disabledChannels ?? []
  } catch (e: any) {
    notif.error('저장 실패', '활성 상태 변경 실패')
  }
}

async function togglePairEnabled(parent: ZigbeeDevice, pair: OpenerPairInfo) {
  const wasActive = !isPairDisabled(parent, pair)
  // 한 번에 두 child 처리 (열림 + 닫힘 같은 상태로) — key는 child.channelCode
  for (const child of [pair.openChild, pair.closeChild]) {
    const key = child.channelCode || ''
    if (!key) continue
    try {
      const { data } = await deviceApi.updateChannelEnabled(parent.id, key, wasActive ? false : true)
      ;(parent as any).disabledChannels = (data as any).disabledChannels ?? []
    } catch { /* continue */ }
  }
}

// 이름 편집 — child(유동팬)
const editingChildId = ref<string | null>(null)
const editChildName = ref('')
function startChildEdit(child: ZigbeeDevice) { editingChildId.value = child.id; editChildName.value = child.name }
function cancelChildEdit() { editingChildId.value = null; editChildName.value = '' }
async function saveChildName(child: ZigbeeDevice) {
  const newName = editChildName.value.trim()
  if (!newName) { cancelChildEdit(); return }
  try {
    const { data } = await deviceApi.rename(child.id, newName)
    child.name = data.name
  } catch { notif.error('저장 실패', '이름 변경 실패') }
  cancelChildEdit()
}

// 이름 편집 — 페어 대표 (페어 양쪽 device의 opener_group_name + name 자동 동기화는 backend updateByUser에서)
const editingPairGroup = ref<string | null>(null)
const editPairName = ref('')
function startPairEdit(pair: OpenerPairInfo) { editingPairGroup.value = pair.groupName; editPairName.value = pair.groupName }
function cancelPairEdit() { editingPairGroup.value = null; editPairName.value = '' }
async function savePairName(pair: OpenerPairInfo) {
  const newName = editPairName.value.trim()
  if (!newName) { cancelPairEdit(); return }
  try {
    // 열림 device 이름을 "{newName} 열림"으로 변경 — backend가 opener_group_name + paired 동기화
    await deviceApi.rename(pair.openChild.id, `${newName} 열림`)
    await deviceApi.rename(pair.closeChild.id, `${newName} 닫힘`)
    pair.openChild.name = `${newName} 열림`
    pair.closeChild.name = `${newName} 닫힘`
    pair.openChild.openerGroupName = newName
    pair.closeChild.openerGroupName = newName
  } catch { notif.error('저장 실패', '페어 이름 변경 실패') }
  cancelPairEdit()
}

const expandedZigbeeIds = ref<Set<string>>(new Set())
function toggleZigbeeExpand(id: string) {
  if (expandedZigbeeIds.value.has(id)) expandedZigbeeIds.value.delete(id)
  else expandedZigbeeIds.value.add(id)
  expandedZigbeeIds.value = new Set(expandedZigbeeIds.value)
}

interface ZbChannelSlot { key: string; label: string; code: string; enabled: boolean }
function zigbeeDisabledSet(dev: ZigbeeDevice): Set<string> {
  return new Set<string>(((dev as any).disabledChannels ?? []) as string[])
}

function zigbeeChannelSlots(dev: ZigbeeDevice): ZbChannelSlot[] {
  const mapping = (dev.channelMapping ?? {}) as Record<string, string>
  const disabled = zigbeeDisabledSet(dev)
  const order = [
    'remote_control', 'fertilizer_b_contact',
    'zone_1', 'zone_2', 'zone_3', 'zone_4', 'zone_5', 'zone_6', 'zone_7', 'zone_8',
    'mixer', 'fertilizer_motor',
  ]
  return order
    .filter(k => k in mapping)
    .map(k => ({ key: k, label: FUNCTION_LABELS[k] ?? k, code: mapping[k] ?? '', enabled: !disabled.has(k) }))
}

function zigbeeChannelCountFor(dev: ZigbeeDevice): 8 | 12 {
  const vals = Object.values(dev.channelMapping ?? {}).filter(Boolean)
  return detectChannelCount(vals as string[], (dev as any).zigbeeModel)
}

function zigbeeActiveCount(dev: ZigbeeDevice): number {
  return zigbeeChannelSlots(dev).filter(s => s.enabled).length
}

function zigbeeAnyActive(dev: ZigbeeDevice): boolean {
  return zigbeeActiveCount(dev) > 0
}

function zigbeeAvailableSwitchesFor(dev: ZigbeeDevice, currentKey: string): string[] {
  const count = zigbeeChannelCountFor(dev)
  const all = count === 12 ? AVAILABLE_SWITCH_CODES_12CH : AVAILABLE_SWITCH_CODES_8CH
  // 다른 슬롯이 이미 사용 중인 코드는 제외 (현재 슬롯이 쓰는 건 유지)
  const mapping = (dev.channelMapping ?? {}) as Record<string, string>
  const used = new Set<string>()
  for (const [k, v] of Object.entries(mapping)) {
    if (k !== currentKey && v) used.add(v)
  }
  return all.filter(sw => !used.has(sw))
}

// 매핑(switch 코드) 변경 — 사용자가 dropdown으로 switch 선택
async function updateZigbeeMapping(dev: ZigbeeDevice, key: string, value: string) {
  const next = { ...(dev.channelMapping ?? {}), [key]: value }
  try {
    const { data } = await deviceApi.updateChannelMapping(dev.id, next as any)
    dev.channelMapping = (data as any).channelMapping ?? next
  } catch (e: any) {
    notif.error('저장 실패', e?.response?.data?.message ?? '채널 매핑 저장 실패')
  }
}

// 활성/비활성 토글 — 매핑은 보존, deviceSettings.disabledChannels만 갱신
async function toggleZigbeeChannel(dev: ZigbeeDevice, key: string) {
  const disabled = zigbeeDisabledSet(dev)
  const enabled = disabled.has(key) // 현재 비활성 → 활성화
  try {
    const { data } = await deviceApi.updateChannelEnabled(dev.id, key, enabled)
    ;(dev as any).disabledChannels = (data as any).disabledChannels ?? []
  } catch (e: any) {
    notif.error('저장 실패', e?.response?.data?.message ?? '채널 활성 상태 저장 실패')
  }
}

async function zigbeeBulkActivate(dev: ZigbeeDevice, enable: boolean) {
  const slots = zigbeeChannelSlots(dev)
  // 매핑된 모든 채널을 enable/disable 일괄 처리 — 직렬 호출 (간단함 우선)
  for (const s of slots) {
    if (enable === s.enabled) continue
    try {
      const { data } = await deviceApi.updateChannelEnabled(dev.id, s.key, enable)
      ;(dev as any).disabledChannels = (data as any).disabledChannels ?? []
    } catch { /* 개별 실패 시 계속 */ }
  }
}

async function zigbeeTestChannel(dev: ZigbeeDevice, switchCode: string, state: boolean) {
  if (!switchCode) return
  try {
    await gatewayEnvApi.testZigbeeChannel(gatewayId, {
      friendlyName: dev.friendlyName,
      switchCode, state,
      durationMs: state ? 2000 : undefined,
    })
  } catch (e: any) {
    notif.error('테스트 실패', `${switchCode} 명령 실패`)
  }
}

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

// ── 채널 매핑 모달 (legacy — 인라인 카드로 대체됨, 일부 코드 호환용 유지) ──
const mappingModalDev = ref<ZigbeeDevice | null>(null)

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

// 컨트롤러 모드 (다채널 zigbee 컨트롤러 일괄 등록용)
const CONTROLLER_MODE_OPTIONS = [
  { value: 'irrigation', label: '🚿 관수' },
  { value: 'fan',        label: '🌀 유동팬' },
  { value: 'opener',     label: '🚪 개폐기 페어' },
]

// 채널별 기본값 (모델로 자동 감지되면 거기 맞춰 초기화)
const controllerCh = ref<Record<string, 8 | 12>>({})

// 다채널 컨트롤러 여부 — backend가 추론한 detectedChannelCount 우선, fallback으로 model_id
function isMultiChannelDevice(sd: ZigbeeScannedDevice): boolean {
  if (sd.detectedChannelCount === 8 || sd.detectedChannelCount === 12) return true
  const m = sd.model_id || ''
  return /_switch_(8|12)/i.test(m) || /switch_(8|12)$/i.test(m)
}

// z2m이 보고한 'N gang switch' / 'N channel' 설명 추출 (실제 채널 수 불확실 경고용)
function z2mReportedDescription(sd: ZigbeeScannedDevice): string | null {
  const desc = sd.definition?.description || ''
  const m = desc.match(/(\d+)\s*(gang|channel|ch\b)/i)
  return m ? `${m[1]}${m[2]}` : null
}

function detectControllerChannelCount(sd: ZigbeeScannedDevice): 8 | 12 {
  if (sd.detectedChannelCount === 12) return 12
  if (sd.detectedChannelCount === 8) return 8
  const m = sd.model_id || ''
  const match = m.toLowerCase().match(/_switch_(\d+)/) || m.toLowerCase().match(/switch_(\d+)$/)
  if (match) return Number(match[1]) >= 12 ? 12 : 8
  return 8
}

function selectControllerMode(ieee: string, mode: string) {
  addForm.value[ieee + '_type'] = 'controller/' + mode
}

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
function selectDeviceType(ieee: string, dt: 'sensor' | 'actuator' | 'controller') {
  if (dt === 'sensor') addForm.value[ieee + '_type'] = 'sensor/other'
  else if (dt === 'actuator') addForm.value[ieee + '_type'] = 'actuator/'
  else {
    addForm.value[ieee + '_type'] = 'controller/'
    // 모델 자동 감지값으로 채널 수 초기화 (detectedChannelCount 우선)
    const sd = scannedDevices.value.find(d => d.ieee_address === ieee)
    if (sd && !controllerCh.value[ieee]) {
      controllerCh.value[ieee] = detectControllerChannelCount(sd)
    }
  }
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
  if (!t || t === 'actuator/' || t === 'controller/') return false
  if (isOpenerSelected(ieee)) return openerPairReady.value
  if (t.startsWith('controller/')) return !!controllerCh.value[ieee]
  return true
}

async function handleAddDevice(sd: ZigbeeScannedDevice) {
  const t = addForm.value[sd.ieee_address + '_type'] || ''
  if (t.startsWith('controller/')) {
    await addZigbeeControllerDevice(sd)
    return
  }
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

async function addZigbeeControllerDevice(sd: ZigbeeScannedDevice) {
  const t = addForm.value[sd.ieee_address + '_type'] || ''
  const mode = t.split('/')[1] as 'irrigation' | 'fan' | 'opener'
  const ch = controllerCh.value[sd.ieee_address] || 8
  try {
    const res = await gatewayEnvApi.addZigbeeController(gatewayId, {
      ieee: sd.ieee_address,
      friendlyName: sd.friendly_name,
      zigbeeModel: sd.model_id || '',
      channelCount: ch,
      mode,
    })
    zigbeeDevices.value.push(res.data.controller, ...res.data.children)
    addedIeees.value = new Set([...addedIeees.value, sd.ieee_address])
    const label = mode === 'irrigation' ? '관수' : mode === 'fan' ? '유동팬' : '개폐기 페어'
    notif.success('컨트롤러 등록 완료', `${ch}채널 ${label} 컨트롤러가 등록되었습니다.`)
  } catch (e: any) {
    notif.error('오류', e?.response?.data?.message || '컨트롤러 등록에 실패했습니다.')
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
  // 1) DB에서 최신 zigbee device 목록 reload — 외부(z2m UI)에서 직접 삭제했거나
  //    backend cleanup이 발생한 경우 frontend cache가 stale일 수 있음 → 항상 새로고침
  try {
    await loadAllDevices()
  } catch { /* 무시하고 계속 — 스캔이라도 시도 */ }
  // 2) Pre-populate with already-registered IEEE addresses so they're excluded from scan results
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
.device-card.card-enabled { border-color: #0ea5e9; }

.card-header { display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; }
.card-header-clickable { cursor: pointer; user-select: none; }
.card-header-clickable:hover { background: var(--bg-hover, rgba(0,0,0,.02)); border-radius: 6px; }
.expand-arrow { font-size: 11px; color: var(--text-secondary, #9ca3af); margin-left: 4px; }
.zb-meta-chip { font-size: 12px; color: var(--text-secondary); padding: 2px 8px; background: var(--bg-secondary, #f3f4f6); border-radius: 10px; }

/* 채널 그리드 — GpioRelayManager와 동일 스타일 (onboard 일관성) */
.card-body { display: flex; flex-direction: column; gap: 10px; padding-top: 8px; border-top: 1px solid var(--border-color); }
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

/* 컨트롤러 모드 — fan / opener pair UI */
.opener-pair-block {
  display: flex; flex-direction: column; gap: 4px;
  padding: 8px 10px;
  background: var(--bg-secondary, #f9fafb);
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: 8px;
  transition: opacity 0.15s;
}
.opener-pair-block.ch-inactive { opacity: 0.5; }
.opener-pair-header { display: flex; align-items: center; gap: 8px; }
.opener-sub-row {
  display: flex; align-items: center; gap: 8px;
  padding: 4px 8px 4px 26px;
  border-left: 2px solid var(--border-color, #e5e7eb);
  margin-left: 10px;
}
.opener-sub-label {
  font-size: 11px; font-weight: 700;
  color: var(--text-secondary, #6b7280);
  min-width: 32px;
}
.pair-name {
  font-weight: 600;
  color: var(--text-primary, #111);
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  transition: background 0.15s;
}
.pair-name:hover {
  background: rgba(59,130,246,.1);
  text-decoration: underline;
  text-decoration-style: dashed;
  text-underline-offset: 3px;
}
.btn-replace {
  background: rgba(139,92,246,.1);
  border: 1px solid rgba(139,92,246,.4);
  color: #7c3aed;
  border-radius: 5px; padding: 4px 10px; font-size: 12px; cursor: pointer;
  font-weight: 600;
}
.btn-replace:hover { background: rgba(139,92,246,.2); }
.btn-edit-prominent {
  font-size: 11px !important;
  padding: 3px 8px !important;
  border: 1px solid var(--border-color, #d1d5db) !important;
  border-radius: 4px !important;
  background: var(--bg-card, #fff) !important;
  color: var(--text-secondary, #6b7280) !important;
  cursor: pointer;
}
.btn-edit-prominent:hover {
  background: rgba(59,130,246,.1) !important;
  color: #2563eb !important;
  border-color: #3b82f6 !important;
}
.ch-name-input {
  border: 1px solid #3b82f6;
  border-radius: 4px;
  padding: 3px 6px;
  font-size: 12px;
  background: var(--bg-input, #fff);
  color: var(--text-primary, #111);
  flex: 1;
  min-width: 80px;
  max-width: 180px;
}

.ch-num {
  width: 22px; height: 22px; border-radius: 5px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  font-size: 10px; font-weight: 800; border: 1px solid;
}
.ch-name { font-size: 12px; color: var(--text-primary, #333); flex: 1; min-width: 70px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pin-wrap { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
.pin-label { font-size: 10px; color: var(--text-secondary, #6b7280); }
.pin-select { background: var(--bg-input, #fff); border: 1px solid var(--border-color, #d1d5db); border-radius: 6px; padding: 3px 6px; font-size: 12px; color: var(--text-primary, #111); cursor: pointer; min-width: 90px; }
.pin-select:focus { outline: 2px solid var(--primary, #3b82f6); outline-offset: 1px; }
.relay-btn { padding: 3px 9px; border-radius: 5px; font-size: 11px; font-weight: 700; cursor: pointer; border: 1px solid; transition: all 0.15s; flex-shrink: 0; }
.relay-btn.on { background: #dcfce7; border-color: #86efac; color: #15803d; }
.relay-btn.on:hover:not(:disabled) { background: #bbf7d0; }
.relay-btn.off { background: #fee2e2; border-color: #fca5a5; color: #dc2626; }
.relay-btn.off:hover:not(:disabled) { background: #fecaca; }
.relay-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.toggle-sm .toggle-slider { width: 32px; height: 18px; border-radius: 9px; }
.toggle-sm .toggle-slider::before { width: 12px; height: 12px; top: 3px; left: 3px; }
.toggle-sm input:checked + .toggle-slider::before { transform: translateX(14px); }
.bulk-actions { display: flex; gap: 6px; flex-wrap: wrap; padding-top: 4px; border-top: 1px dashed var(--border-color, #e5e7eb); }
.btn-bulk { padding: 5px 12px; border-radius: 5px; font-size: 11px; background: var(--bg-card, #fff); border: 1px solid var(--border-color, #d1d5db); color: var(--text-secondary, #6b7280); cursor: pointer; }
.btn-bulk:hover { background: var(--bg-hover, #f3f4f6); }
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
  padding: 4px 10px;
  cursor: pointer;
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: max-content;     /* 컨테이너 좁아져도 텍스트 잘리지 않도록 보장 */
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
.modal-hint { color: var(--text-muted, #888); font-size: 12px; }
.mapping-select.disabled { color: var(--text-muted, #999); background: var(--bg-secondary, #f5f5f5); }
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
  padding: 4px 0;
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

/* 다채널 컨트롤러 자동 감지 안내 배너 */
.detected-banner {
  font-size: 12px;
  color: #1e3a8a;
  background: rgba(59,130,246,.12);
  border: 1px solid rgba(59,130,246,.35);
  border-radius: 6px;
  padding: 6px 10px;
}
.detected-hint-inline {
  display: block;
  font-size: 11px;
  color: #6b7280;
  margin-top: 3px;
  font-weight: normal;
}
.dtype-btn-secondary {
  background: var(--bg-card);
  color: var(--text-secondary, #6b7280);
  border-style: dashed;
}

/* 컨트롤러 모드 (다채널 zigbee 일괄 등록) 추가 영역 */
.controller-extra {
  display: flex; flex-direction: column; gap: 6px;
  padding: 8px 10px;
  background: rgba(59,130,246,.06);
  border: 1px solid rgba(59,130,246,.25);
  border-radius: 8px;
}
.dtype-toggle-sm { gap: 4px; }
.dtype-toggle-sm .dtype-btn { padding: 4px 10px; font-size: 12px; }
.controller-hint {
  font-size: 11px; color: var(--text-secondary, #6b7280);
  padding: 4px 0 0;
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

@media (max-width: 768px) {
  .page-container { padding: 4px 0; }
}
</style>
