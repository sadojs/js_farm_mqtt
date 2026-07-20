<template>
  <div class="page-container">
    <header class="page-header">
      <div>
        <h2>구역 관리</h2>
        <p class="page-description">장치를 구역으로 묶어 관리합니다</p>
      </div>
      <div class="header-actions">
        <!-- MQTT에서는 실시간 동기화됨 -->
        <button class="btn-bulk-control" @click="showBulkControl = true" title="일괄 제어 — 유동팬·개폐기를 한 번에 제어">
          <span class="bc-bolt">⚡</span><span class="btn-label">일괄 제어</span>
        </button>
        <button
          class="btn-secondary btn-visibility"
          @click="showVisibilityModal = true"
          :title="isFarmUser ? '관리자에게 문의' : '구역 표시 설정 — IoT 화면에서 보이는 구역을 설정합니다'"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          <span class="btn-label">구역 표시 설정</span>
          <span v-if="hiddenZoneCount > 0" class="badge-hidden"><span class="hz-text">· 숨김 </span>{{ hiddenZoneCount }}</span>
        </button>
        <button v-if="!isFarmUser" class="btn-primary btn-add-zone" @click="showGroupCreationModal = true" title="구역 추가">
          <span class="add-plus">+</span><span class="btn-label"> 구역 추가</span>
        </button>
      </div>
    </header>

    <!-- 일괄제어로 정지된 자동제어 룰 원복 배너 -->
    <div v-if="!isFarmUser && bulkStoppedRules.length > 0" class="bulk-restore-banner">
      <div class="brb-text">
        <span class="brb-icon">⏸</span>
        <span>일괄제어로 정지된 자동제어 룰 <b>{{ bulkStoppedRules.length }}개</b> —
          <span class="brb-names">{{ bulkStoppedRules.map(r => r.name).join(', ') }}</span>
        </span>
      </div>
      <button class="brb-restore" :disabled="restoringBulk" @click="restoreBulk">
        {{ restoringBulk ? '원복 중…' : '↩ 자동제어 원복' }}
      </button>
    </div>

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
            <button v-if="!isFarmUser" class="btn-icon btn-edit-toggle" :class="{ active: isGroupEditing(group.id) }"
              @click="toggleGroupEdit(group.id)"
              :title="isGroupEditing(group.id) ? '편집 완료' : '편집 (이름변경·순서이동)'"
              :aria-label="isGroupEditing(group.id) ? '편집 완료' : '편집'">{{ isGroupEditing(group.id) ? '완료' : '✎' }}</button>
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
              <div v-for="device in getGroupSensors(group)" :key="device.id"
                :class="['sub-card sensor', { reorderable: !isFarmUser && isGroupEditing(group.id), dragging: reorderDraggingId === device.id }]"
                :style="reorderDragStyle(device.id)"
                :data-reorder-id="device.id" :data-reorder-group="group.id + ':sensor'">
                <span v-if="!isFarmUser && isGroupEditing(group.id)" class="drag-grip" title="길게 눌러 순서 이동"
                  @pointerdown="reorderPress($event, device.id, group.id + ':sensor', getGroupSensors(group).map(d => d.id))"></span>
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
                    <span class="sub-card-name" :class="{ editable: isGroupEditing(group.id) }"
                      @click.stop="isGroupEditing(group.id) && startDeviceRename(device.id, device.name)"
                      :title="isGroupEditing(group.id) ? '눌러서 이름 변경' : undefined">{{ device.name }}</span>
                    <button
                      v-if="!isFarmUser && isGroupEditing(group.id)"
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
                <!-- 우적센서: 비 감지 자동 제어(강제 닫힘) on/off — 오동작 시 강제로 개폐기 열기용 -->
                <button
                  v-if="isRainSensor(device) && !isFarmUser"
                  type="button"
                  class="rain-override-btn"
                  :class="{ 'is-on': !(device as any).rainOverrideDisabled, 'is-off': (device as any).rainOverrideDisabled }"
                  @click.stop="toggleRainOverrideBtn(device)"
                  :title="(device as any).rainOverrideDisabled
                    ? '비 감지 자동 닫힘이 꺼져 있습니다. 클릭하여 다시 켜기'
                    : '비 감지 시 개폐기를 자동으로 닫습니다. 오동작 시 끄면 강제로 열 수 있습니다.'"
                >
                  <span>{{ (device as any).rainOverrideDisabled ? '🌂' : '☔' }}</span>
                  <span>비 감지 자동 제어 {{ (device as any).rainOverrideDisabled ? '꺼짐' : '켜짐' }}</span>
                </button>
              </div>
            </div>
            <div v-if="!isFarmUser && isGroupEditing(group.id) && getGroupSensors(group).length > 1" class="reorder-hint">⇅ 길게 눌러 순서 이동</div>
          </template>

          <!-- 장치(액추에이터 + 개폐기 + 관수) 목록 -->
          <template v-if="getGroupActuators(group).length > 0 || getGroupOpenerGroups(group).length > 0 || getGroupIrrigationDevices(group).length > 0">
            <div class="section-label actuator">장치 ({{ getGroupActuators(group).length + getGroupOpenerGroups(group).length + getGroupIrrigationDevices(group).length }})</div>
            <div class="device-sub-grid">
              <!-- 개폐기 그룹 카드 -->
              <div v-for="og in getGroupOpenerGroups(group)" :key="og.groupName"
                :class="['sub-card actuator', { reorderable: !isFarmUser && isGroupEditing(group.id), dragging: reorderDraggingId === og.openDevice.id, 'timer-active': !!openerTimerOf(og) }]"
                :style="reorderDragStyle(og.openDevice.id)"
                :data-reorder-id="og.openDevice.id" :data-reorder-group="group.id + ':opener'"
                @pointerdown="onTimerPress('opener', og.openDevice, isGroupEditing(group.id))"
                @pointerup="clearTimerPress" @pointerleave="clearTimerPress" @pointercancel="clearTimerPress">
                <span v-if="!isFarmUser && isGroupEditing(group.id)" class="drag-grip" title="길게 눌러 순서 이동"
                  @pointerdown="reorderPress($event, og.openDevice.id, group.id + ':opener', getGroupOpenerGroups(group).map(o => o.openDevice.id), Object.fromEntries(getGroupOpenerGroups(group).map(o => [o.openDevice.id, o.closeDevice.id])))"></span>
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
                    <span class="sub-card-name" :class="{ editable: isGroupEditing(group.id) }"
                      @click.stop="isGroupEditing(group.id) && startOpenerGroupRename(og)"
                      :title="isGroupEditing(group.id) ? '눌러서 이름 변경' : undefined">{{ og.groupName }}</span>
                    <button
                      v-if="!isFarmUser && isGroupEditing(group.id)"
                      class="btn-rename-mini"
                      @click.stop="startOpenerGroupRename(og)"
                      title="이름 변경"
                    >✎</button>
                  </template>
                  <span class="type-tag actuator type-tag-opener">개폐기</span>
                  <span v-if="openerTimerOf(og)" class="timer-badge" @click.stop="cancelDeviceTimerFromCard(og.openDevice)" title="타이머 해제 → 자동제어 복귀">
                    <span class="timer-dot"></span>{{ openerTimerOf(og)!.direction === 'open' ? '열기' : '닫기' }} {{ formatCountdown(openerTimerOf(og)!.until) }}<span class="timer-x">✕</span>
                  </span>
                </div>
                <div class="sub-card-control" :class="{ disabled: !og.openDevice.online }">
                  <span class="control-label">열림</span>
                  <label class="toggle-switch" @click.prevent="!consumeLongPress() && og.openDevice.online && !openerInterlocking && handleOpenerInterlock(og, 'open')">
                    <input type="checkbox" :checked="og.openDevice.online && og.openDevice.switchState === true" :disabled="!og.openDevice.online || openerInterlocking" />
                    <span class="toggle-slider"></span>
                  </label>
                </div>
                <div class="sub-card-control" :class="{ disabled: !og.closeDevice.online }">
                  <span class="control-label">닫힘</span>
                  <label class="toggle-switch" @click.prevent="!consumeLongPress() && og.closeDevice.online && !openerInterlocking && handleOpenerInterlock(og, 'close')">
                    <input type="checkbox" :checked="og.closeDevice.online && og.closeDevice.switchState === true" :disabled="!og.closeDevice.online || openerInterlocking" />
                    <span class="toggle-slider"></span>
                  </label>
                </div>
              </div>
              <!-- 관수 장치 카드 -->
              <div v-for="device in getGroupIrrigationDevices(group)" :key="device.id"
                :class="['sub-card actuator', { reorderable: !isFarmUser && isGroupEditing(group.id), dragging: reorderDraggingId === device.id, 'timer-active': !!irrigationTimerSummary(device) }]"
                :style="reorderDragStyle(device.id)"
                :data-reorder-id="device.id" :data-reorder-group="group.id + ':irrigation'"
                @pointerdown="onIrrigationTimerPress(device, isGroupEditing(group.id))"
                @pointerup="clearTimerPress" @pointerleave="clearTimerPress" @pointercancel="clearTimerPress">
                <span v-if="!isFarmUser && isGroupEditing(group.id)" class="drag-grip" title="길게 눌러 순서 이동"
                  @pointerdown="reorderPress($event, device.id, group.id + ':irrigation', getGroupIrrigationDevices(group).map(d => d.id))"></span>
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
                    <span class="sub-card-name" :class="{ editable: isGroupEditing(group.id) }"
                      @click.stop="isGroupEditing(group.id) && startDeviceRename(device.id, device.name)"
                      :title="isGroupEditing(group.id) ? '눌러서 이름 변경' : undefined">{{ device.name }}</span>
                    <button
                      v-if="!isFarmUser && isGroupEditing(group.id)"
                      class="btn-rename-mini"
                      @click.stop="startDeviceRename(device.id, device.name)"
                      title="이름 변경"
                    >✎</button>
                  </template>
                  <button class="btn-status-sm" @click="openIrrigationStatusModal(device)">상태</button>
                  <span class="type-tag actuator type-tag-irrigation">관주</span>
                  <span v-if="irrigationTimerSummary(device)" class="timer-badge" @click.stop="openIrrigationTimerModal(device)" title="채널별 타이머 관리">
                    <span class="timer-dot"></span>{{ irrigationTimerSummary(device)!.count }}채널 · {{ formatCountdown(irrigationTimerSummary(device)!.until) }}
                  </span>
                </div>
                <div class="sub-card-control" :class="{ disabled: !device.online }">
                  <span class="control-label">원격제어</span>
                  <label class="toggle-switch" @click.prevent="!consumeLongPress() && device.online && handleIrrigationControl(device, getMapping(device)['remote_control'])">
                    <input type="checkbox" :checked="device.online && device.switchStates?.[getMapping(device)['remote_control']] === true" :disabled="!device.online || irrigationControlling === device.id" />
                    <span class="toggle-slider"></span>
                  </label>
                </div>
                <div class="sub-card-control disabled">
                  <span class="control-label">액비/교반기</span>
                  <label class="toggle-switch">
                    <input type="checkbox" :checked="device.online && device.switchStates?.[getMapping(device)['fertilizer_b_contact']] === true" disabled />
                    <span class="toggle-slider"></span>
                  </label>
                </div>
              </div>
              <!-- 일반 장치 카드 -->
              <div v-for="device in getGroupActuators(group)" :key="device.id"
                :class="['sub-card actuator', { reorderable: !isFarmUser && isGroupEditing(group.id), dragging: reorderDraggingId === device.id, 'timer-active': isActive(device.overrideUntil) }]"
                :style="reorderDragStyle(device.id)"
                :data-reorder-id="device.id" :data-reorder-group="group.id + ':actuator'"
                @pointerdown="onTimerPress('fan', device, isGroupEditing(group.id))"
                @pointerup="clearTimerPress" @pointerleave="clearTimerPress" @pointercancel="clearTimerPress">
                <span v-if="!isFarmUser && isGroupEditing(group.id)" class="drag-grip" title="길게 눌러 순서 이동"
                  @pointerdown="reorderPress($event, device.id, group.id + ':actuator', getGroupActuators(group).map(d => d.id))"></span>
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
                    <span class="sub-card-name" :class="{ editable: isGroupEditing(group.id) }"
                      @click.stop="isGroupEditing(group.id) && startDeviceRename(device.id, device.name)"
                      :title="isGroupEditing(group.id) ? '눌러서 이름 변경' : undefined">{{ device.name }}</span>
                    <button
                      v-if="!isFarmUser && isGroupEditing(group.id)"
                      class="btn-rename-mini"
                      @click.stop="startDeviceRename(device.id, device.name)"
                      title="이름 변경"
                    >✎</button>
                  </template>
                  <span class="type-tag actuator">{{ getEquipmentLabel(device) }}</span>
                  <span v-if="isActive(device.overrideUntil)" class="timer-badge" @click.stop="cancelDeviceTimerFromCard(device)" title="타이머 해제 → 자동제어 복귀">
                    <span class="timer-dot"></span>{{ formatCountdown(device.overrideUntil) }}<span class="timer-x">✕</span>
                  </span>
                  <span v-else-if="device.userOverride" class="manual-override-badge"
                    title="자동제어 룰의 의도와 다르게 수동으로 변경됨. 다시 룰 의도와 같은 상태로 토글하면 자동제어로 복귀합니다.">
                    🖐 수동
                  </span>
                </div>
                <div class="sub-card-control" :class="{ disabled: !device.online }">
                  <span class="control-label">{{ !device.online ? '오프라인' : (isActive(device.overrideUntil) ? '타이머 가동중' : device.switchState === true ? '가동중' : '정지') }}</span>
                  <label class="toggle-switch" @click.prevent="!consumeLongPress() && device.online && handleControl(device.id, !device.switchState)">
                    <input type="checkbox" :checked="device.online && device.switchState === true" :disabled="!device.online || controllingId === device.id" />
                    <span class="toggle-slider"></span>
                  </label>
                </div>
              </div>
            </div>
            <div v-if="!isFarmUser && isGroupEditing(group.id) && (getGroupActuators(group).length + getGroupOpenerGroups(group).length + getGroupIrrigationDevices(group).length) > 1" class="reorder-hint">⇅ 길게 눌러 순서 이동</div>
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
                :class="{ 'is-off': !rule.enabled, reorderable: !isFarmUser && isGroupEditing(group.id), dragging: ruleReorderDraggingId === rule.id }"
                :style="ruleReorderDragStyle(rule.id)"
                :data-reorder-id="rule.id"
                :data-reorder-group="'grouprules:' + group.id"
                @click="openEditRule(rule)"
              >
                <span
                  v-if="!isFarmUser && isGroupEditing(group.id)"
                  class="drag-grip"
                  title="길게 눌러 순서 이동"
                  @click.stop
                  @pointerdown="ruleReorderPress($event, rule.id, 'grouprules:' + group.id, getGroupRules(group.id).map(r => r.id))"
                ></span>
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

    <!-- 숨김 안내 배너 -->
    <div v-if="hiddenZoneCount > 0 && !loading" class="hidden-banner">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
      <span>IoT 미사용 구역 <strong>{{ hiddenZoneCount }}개</strong>가 숨겨져 있습니다 (방재·농작업 일정에는 계속 표시됨).</span>
      <button class="link-btn" @click="showVisibilityModal = true">구역 표시 설정에서 변경</button>
    </div>

    <BulkControlModal
      v-if="showBulkControl"
      :groups="groups"
      @close="showBulkControl = false"
      @rules-changed="onBulkRulesChanged"
    />

    <ZoneVisibilityModal
      v-if="showVisibilityModal"
      :groups="allGroups"
      :can-edit="!isFarmUser"
      @close="showVisibilityModal = false"
    />

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

    <!-- 임시 타이머 시트 (팬·개폐기) -->
    <DeviceTimerSheet
      :visible="timerSheetOpen"
      :title="timerSheetTitle"
      :subtitle="timerSheetSub"
      :show-direction="timerSheetKind === 'opener'"
      :submitting="timerSubmitting"
      @close="timerSheetOpen = false"
      @start="onTimerStart"
    />

    <!-- 관수 채널별 타이머 모달 (길게누름) -->
    <IrrigationTimerModal
      :visible="irrigationTimerModalOpen"
      :device-id="irrigationTimerDeviceId"
      @close="irrigationTimerModalOpen = false"
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
import { useRoute } from 'vue-router'
import { useGroupStore } from '../stores/group.store'
import { useDeviceStore } from '../stores/device.store'
import { useAutomationStore } from '../stores/automation.store'
import { useAuthStore } from '../stores/auth.store'
import GroupCreation from '@/components/groups/GroupCreation.vue'
import AddDeviceModal from '@/components/groups/AddDeviceModal.vue'
import IrrigationStatusModal from '@/components/devices/IrrigationStatusModal.vue'
import IrrigationTimerModal from '@/components/devices/IrrigationTimerModal.vue'
import DeviceTimerSheet from '@/components/devices/DeviceTimerSheet.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import EquipmentIcon from '@/components/common/EquipmentIcon.vue'
import EnvConfigModal from '@/components/groups/EnvConfigModal.vue'
import ZoneNotesPanel from '@/components/groups/ZoneNotesPanel.vue'
import { zoneNotesApi } from '@/api/zone-notes.api'
import RemoveDeviceModal from '@/components/groups/RemoveDeviceModal.vue'
import ZoneVisibilityModal from '@/components/groups/ZoneVisibilityModal.vue'
import BulkControlModal from '@/components/groups/BulkControlModal.vue'
import AutomationEditModal from '@/components/automation/AutomationEditModal.vue'
import DeleteBlockingModal from '@/components/common/DeleteBlockingModal.vue'
import { useConfirm } from '../composables/useConfirm'
import { useReorder } from '../composables/useReorder'
import { useTimerTick } from '../composables/useTimerTick'
import { getEquipmentLabel } from '../utils/device-labels'
import { useNotificationStore } from '../stores/notification.store'
import { groupApi } from '../api/group.api'
import { deviceApi } from '../api/device.api'
import { automationApi } from '@/api/automation.api'
import { gatewayApi } from '@/api/gateway.api'
import type { HouseGroup } from '../types/group.types'
import type { Gateway } from '../types/device.types'
import type { Device, DependencyRule, ChannelMapping } from '../types/device.types'
import { FUNCTION_LABELS } from '../types/device.types'
import type { AutomationRule } from '../types/automation.types'
import { formatConditionGroup, isIrrigationConditions, formatIrrigationSchedule, formatIrrigationZones } from '../utils/automation-helpers'

const route = useRoute()
const groupStore = useGroupStore()
const deviceStore = useDeviceStore()
const automationStore = useAutomationStore()
const authStore = useAuthStore()
const { isFarmUser, isAdmin } = authStore
const { confirm } = useConfirm()
const { press: reorderPress, draggingId: reorderDraggingId, dragStyle: reorderDragStyle } = useReorder({
  setOrder: (id, v) => { const d = deviceStore.devices.find(x => x.id === id); if (d) d.displayOrder = v },
  getOrder: (id) => deviceStore.devices.find(x => x.id === id)?.displayOrder ?? 0,
  persist: (orders) => deviceApi.reorder(orders),
})
// 자동제어룰 순서 드래그 (구역관리 창의 구역별 룰 목록)
const { press: ruleReorderPress, draggingId: ruleReorderDraggingId, dragStyle: ruleReorderDragStyle } = useReorder({
  setOrder: (id, v) => { const r = automationStore.rules.find(x => x.id === id); if (r) r.displayOrder = v },
  getOrder: (id) => automationStore.rules.find(x => x.id === id)?.displayOrder ?? 0,
  persist: (orders) => automationApi.reorderRules(orders),
})
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

// 인라인 이름 입력에 커서 자동 포커스 + 전체 선택(사용자가 바로 타이핑 가능)
function focusRenameInput() {
  nextTick(() => {
    const el = document.querySelector('.rename-input-inline') as HTMLInputElement | null
    if (el) { el.focus(); el.select() }
  })
}

function startDeviceRename(deviceId: string, currentName: string) {
  renamingDeviceId.value = deviceId
  renameDeviceValue.value = currentName
  focusRenameInput()
}

function startOpenerGroupRename(og: { groupName: string; openDevice: Device; closeDevice: Device }) {
  renamingOpenerGroup.value = og.groupName
  renameDeviceValue.value = og.groupName
  focusRenameInput()
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
// 메인 그리드는 IoT 활성 구역만 노출. 비활성 구역은 우측 상단 "구역 표시 설정" 모달에서 관리.
const groups = computed(() => [...groupStore.iotGroups].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0)))
const allGroups = computed(() => [...groupStore.groups].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0)))
const hiddenZoneCount = computed(() => groupStore.hiddenZoneCount)
const loading = computed(() => groupStore.loading)
const showVisibilityModal = ref(false)
const showBulkControl = ref(false)

// 일괄제어로 정지된 자동제어 룰 (원복 배너)
const bulkStoppedRules = ref<{ id: string; name: string }[]>([])
const restoringBulk = ref(false)

async function loadBulkStopped() {
  if (isFarmUser) return
  try {
    bulkStoppedRules.value = (await automationApi.getBulkStoppedRules()).data
  } catch {
    bulkStoppedRules.value = []
  }
}

// 일괄제어로 룰이 정지되면 원복 배너 + 룰 상태(스토어)를 즉시 갱신 (새로고침 불필요)
async function onBulkRulesChanged() {
  await Promise.all([
    loadBulkStopped(),
    automationStore.fetchRules().catch(() => undefined),
  ])
}

async function restoreBulk() {
  if (restoringBulk.value) return
  restoringBulk.value = true
  try {
    const { restored } = (await automationApi.restoreBulkStoppedRules()).data
    bulkStoppedRules.value = []
    await automationStore.fetchRules().catch(() => undefined)
    notify.success('자동제어 원복', `룰 ${restored.length}개를 다시 켰습니다.`)
  } catch {
    notify.error('오류', '자동제어 원복에 실패했습니다.')
  } finally {
    restoringBulk.value = false
  }
}

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
  loadBulkStopped()
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

// 구역별 편집 모드 — 켜면 드래그 손잡이 + 이름 인라인 수정이 나타남(평상시엔 숨김)
const editingGroups = ref(new Set<string>())
const isGroupEditing = (groupId: string): boolean => editingGroups.value.has(groupId)
const toggleGroupEdit = (groupId: string) => {
  if (editingGroups.value.has(groupId)) {
    editingGroups.value.delete(groupId)
    cancelDeviceRename() // 편집 종료 시 진행 중이던 이름 수정 취소
  } else {
    editingGroups.value.add(groupId)
  }
}

// 카드 정렬 순서 — store(낙관적 업데이트 대상)의 displayOrder 우선, 없으면 group.devices 값
const orderOf = (id: string, fallback?: number): number =>
  deviceStore.devices.find(sd => sd.id === id)?.displayOrder ?? fallback ?? 0

const getGroupSensors = (group: HouseGroup): Device[] =>
  (group.devices || []).filter(d => d.deviceType === 'sensor').map(d => {
    const storeDevice = deviceStore.devices.find(sd => sd.id === d.id)
    return storeDevice
      ? { ...d, sensorData: storeDevice.sensorData, online: storeDevice.online, enabled: storeDevice.enabled, rainOverrideDisabled: (storeDevice as any).rainOverrideDisabled }
      : d
  }).filter(d => d.enabled !== false)  // 비활성화된 측정기(우적센서 등)는 구역관리에서 숨김
    .sort((a, b) => orderOf(a.id, a.displayOrder) - orderOf(b.id, b.displayOrder))

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
  }).filter(Boolean)
    // 개폐기는 대표(open) 장치의 displayOrder 기준 정렬
    .sort((a, b) => orderOf(a!.openDevice.id, a!.openDevice.displayOrder) - orderOf(b!.openDevice.id, b!.openDevice.displayOrder)) as OpenerGroupInfo[]
}

const getGroupActuators = (group: HouseGroup): Device[] => {
  const openerIds = getOpenerPairIds(group)
  return (group.devices || [])
    .filter(d => d.deviceType === 'actuator' && !openerIds.has(d.id) && d.equipmentType !== 'irrigation')
    .map(d => {
      const storeDevice = deviceStore.devices.find(sd => sd.id === d.id)
      // 전체 스프레드 — switchState/online 뿐 아니라 overrideUntil/userOverride 등 타이머 필드도 반영
      return storeDevice ? { ...d, ...storeDevice } : d
    })
    .sort((a, b) => orderOf(a.id, a.displayOrder) - orderOf(b.id, b.displayOrder))
}

// 관수 장치
const getGroupIrrigationDevices = (group: HouseGroup): Device[] => {
  return (group.devices || [])
    .filter(d => d.equipmentType === 'irrigation')
    .map(d => {
      const storeDevice = deviceStore.devices.find(sd => sd.id === d.id)
      return storeDevice ? { ...d, ...storeDevice } : d
    })
    .sort((a, b) => orderOf(a.id, a.displayOrder) - orderOf(b.id, b.displayOrder))
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
    // 관주 상태 갱신 + 페어 B접점 등 최신 switchStates 재조회
    // (원격제어는 fertilizer_b_contact와 페어로 동작 — 토글만으론 페어 스위치 표시가 안 바뀜)
    if (isRemoteControl) {
      await Promise.all([
        automationStore.fetchIrrigationStatus(),
        deviceStore.fetchDevices(),
      ])
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

// 비 감지 자동 제어(강제 닫힘) on/off 토글 — 우적센서 오동작 시 강제로 개폐기 열기용.
// rainOverrideDisabled=true 면 비 감지 이벤트를 무시(자동 닫힘 안 함).
async function toggleRainOverrideBtn(device: any) {
  const next = !device.rainOverrideDisabled
  try {
    await deviceApi.updateRainOverrideDisabled(device.id, next)
    device.rainOverrideDisabled = next
    const sd = deviceStore.devices.find(d => d.id === device.id)
    if (sd) (sd as any).rainOverrideDisabled = next
    notify.success(
      next ? '비 감지 자동 제어 끔' : '비 감지 자동 제어 켬',
      next ? '비가 와도 개폐기를 자동으로 닫지 않습니다. 강제로 열 수 있습니다.'
           : '비 감지 시 개폐기를 자동으로 닫습니다.',
    )
  } catch {
    notify.error('오류', '비 감지 자동 제어 변경에 실패했습니다.')
  }
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

  // ── 자동제어 룰 동작 중 수동 조작 가드 ──
  // 개폐기는 자동제어와 수동이 공존하지 않는다(듀티사이클·인터록 충돌). 활성 룰이 있으면
  // 먼저 정지해야 수동 제어가 유지된다. 정지하지 않으면 다음 tick에 룰이 다시 제어해버림.
  // (재개는 사용자가 자동제어 페이지에서 직접 — 룰이 여러 개일 수 있으므로 자동 재개 없음)
  let rulesStopped = false
  if (!isFarmUser) {
    try {
      const active = (await automationApi.getActiveRulesForDevice(targetDevice.id)).data
      if (active && active.length > 0) {
        const names = active.map(r => `• ${r.name}`).join('\n')
        const go = await confirm({
          title: '자동제어 룰이 동작 중입니다',
          message:
            `${group.groupName} 개폐기를 제어 중인 자동제어 룰 ${active.length}개가 있습니다.\n${names}\n\n` +
            `수동으로 조작하려면 이 룰들을 정지해야 합니다. 정지하고 수동 제어할까요?\n` +
            `(다시 사용하려면 자동 제어 페이지에서 룰을 켜세요.)`,
          confirmText: '정지하고 수동 제어',
          cancelText: '취소',
          variant: 'warning',
        })
        if (!go) return
        const { stopped } = (await automationApi.stopActiveRulesForDevice(targetDevice.id)).data
        rulesStopped = stopped.length > 0
        if (stopped.length > 0) {
          // 룰 목록 캐시 갱신 → 구역관리 페이지의 룰 on/off 상태가 즉시 반영
          // (미갱신 시 새로고침/재진입 전까지 활성으로 표시되던 문제)
          await automationStore.fetchRules().catch(() => undefined)
          notify.info('자동제어 정지', `룰 ${stopped.length}개를 정지했습니다. 재개하려면 자동 제어에서 다시 켜세요.`)
        }
      }
    } catch (e) {
      // 활성 룰 조회 실패해도 수동 제어 자체는 진행 (안내만 생략)
      console.warn('활성 룰 조회/정지 실패:', e)
    }
  }

  // ── 비 감지 자동 제어(강제 닫힘) 동작 중 수동 '열기' 가드 ──
  // 비 감지로 개폐기가 닫혀 있을 때 수동으로 열려면 먼저 비 감지 자동 제어를 꺼야
  // 다음 비 감지에 다시 닫히지 않는다. (자동제어 룰 팝업과 동일 패턴)
  if (action === 'open' && !isFarmUser) {
    const rainingSensors = deviceStore.devices.filter((d: any) =>
      isRainSensor(d) && d.enabled !== false && !d.rainOverrideDisabled &&
      Number((d.sensorData as any)?.rain_detection) >= 1,
    )
    if (rainingSensors.length > 0) {
      const go = await confirm({
        title: '비 감지 자동 제어가 동작 중입니다',
        message:
          `현재 비가 감지되어 개폐기가 자동으로 닫히고 있습니다. 수동으로 열어도 비 감지가 계속되면 다시 닫힙니다.\n\n` +
          `비 감지 자동 제어를 끄고 여시겠습니까?\n(다시 켜려면 측정기 카드의 '비 감지 자동 제어' 버튼을 누르세요.)`,
        confirmText: '끄고 열기',
        cancelText: '취소',
        variant: 'warning',
      })
      if (!go) return
      for (const rs of rainingSensors) {
        try {
          await deviceApi.updateRainOverrideDisabled(rs.id, true)
          ;(rs as any).rainOverrideDisabled = true
        } catch (e) { console.warn('비 감지 자동 제어 끄기 실패:', e) }
      }
      notify.info('비 감지 자동 제어 끔', '비가 와도 자동으로 닫지 않습니다. 다시 켜려면 측정기 카드에서 켜세요.')
    }
  }

  openerInterlocking.value = true
  const loadingId = notify.add('info', '적용 중...', `${targetDevice.name} ${action === 'open' ? '열림' : '닫힘'} 명령 전송 중`, 0)
  try {
    // 이미 ON이면 OFF만 (자동 타이머도 취소).
    // 단 방금 룰을 정지한 경우(rulesStopped)는 sticky로 남은 '가동중' 상태를 무시하고
    // 사용자가 누른 방향을 강제로 ON 한다. (룰이 열림을 sticky ON 표시하던 중 클릭하면
    // '이미 ON→OFF'로 뒤집혀 여는 대신 꺼지던 문제 방지 — 수동 시 동작/대기 로직 무시)
    if (!rulesStopped && targetDevice.switchState) {
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
      // (활성 룰은 함수 진입 시점에 이미 정지 처리되므로, 여기서 재제어 안내 불필요)
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
      // UI측 여유 대기(1초). 실제 '동시 ON 금지' 인터록은 백엔드가 ON 명령마다
      // 반대쪽 OFF→1초→타겟 ON 으로 서버측에서 강제하므로, 이 값과 무관하게 안전.
      await new Promise(resolve => setTimeout(resolve, 1000))
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

// ── 임시 타이머 (팬·개폐기 = 장치 단위 / 관수 = 채널 단위) ──
const { formatCountdown, isActive } = useTimerTick()

type TimerKind = 'fan' | 'opener'
const timerSheetOpen = ref(false)
const timerSheetKind = ref<TimerKind>('fan')
const timerSheetDevice = ref<Device | null>(null)
const timerSheetTitle = ref('')
const timerSheetSub = ref('')
const timerSubmitting = ref(false)

// 길게 누름(0.5s) → 타이머 시트. 짧은 탭은 기존 토글 유지.
let timerPressTimer: ReturnType<typeof setTimeout> | null = null
const timerLongPressed = ref(false)

function clearTimerPress() {
  if (timerPressTimer) { clearTimeout(timerPressTimer); timerPressTimer = null }
}

function onTimerPress(kind: TimerKind, device: Device, editing: boolean) {
  if (editing || !device.online) return // 편집(정렬) 모드·오프라인은 제외
  clearTimerPress()
  timerLongPressed.value = false
  timerPressTimer = setTimeout(() => {
    timerLongPressed.value = true
    openTimerSheet(kind, device)
  }, 500)
}

// 길게 눌러 시트가 열렸으면 뒤따르는 토글 click 1회 무시
function consumeLongPress(): boolean {
  if (timerLongPressed.value) { timerLongPressed.value = false; return true }
  return false
}

// 관수 카드 길게누름 → 채널별 타이머 모달
const irrigationTimerModalOpen = ref(false)
const irrigationTimerDeviceId = ref<string | null>(null)
function onIrrigationTimerPress(device: Device, editing: boolean) {
  if (editing || !device.online) return
  clearTimerPress()
  timerLongPressed.value = false
  timerPressTimer = setTimeout(() => {
    timerLongPressed.value = true
    openIrrigationTimerModal(device)
  }, 500)
}
function openIrrigationTimerModal(device: Device) {
  irrigationTimerDeviceId.value = device.id
  irrigationTimerModalOpen.value = true
}

function openTimerSheet(kind: TimerKind, device: Device) {
  timerSheetKind.value = kind
  timerSheetDevice.value = device
  if (kind === 'opener') {
    timerSheetTitle.value = `${device.openerGroupName || device.name} 타이머`
    timerSheetSub.value = '설정 시간 동안 방향을 유지하고, 만료 시 자동제어로 복귀합니다.'
  } else {
    timerSheetTitle.value = `${device.name} 타이머`
    timerSheetSub.value = '설정 시간 동안 가동하고, 만료 시 자동제어로 복귀합니다.'
  }
  timerSheetOpen.value = true
}

async function onTimerStart(payload: { durationMinutes: number; direction?: 'open' | 'close' }) {
  const device = timerSheetDevice.value
  if (!device) return
  timerSubmitting.value = true
  try {
    await deviceApi.setTimer(device.id, {
      durationMinutes: payload.durationMinutes,
      ...(timerSheetKind.value === 'opener' ? { direction: payload.direction } : { value: true }),
    })
    timerSheetOpen.value = false
    notify.success('타이머 시작', `${device.openerGroupName || device.name} — ${Math.floor(payload.durationMinutes / 60) ? Math.floor(payload.durationMinutes / 60) + '시간 ' : ''}${payload.durationMinutes % 60 ? (payload.durationMinutes % 60) + '분' : ''}`.trim())
    await deviceStore.fetchDevices()
  } catch (err: any) {
    notify.error('타이머 실패', err?.response?.data?.message || '타이머 설정에 실패했습니다')
  } finally {
    timerSubmitting.value = false
  }
}

// 카드의 카운트다운 배지 ✕ — 타이머 해제(자동제어 복귀)
async function cancelDeviceTimerFromCard(device: Device) {
  try {
    await deviceApi.cancelTimer(device.id)
    notify.info('타이머 해제', `${device.openerGroupName || device.name} — 자동제어로 복귀`)
    await deviceStore.fetchDevices()
  } catch {
    notify.error('해제 실패', '타이머 해제에 실패했습니다')
  }
}

// 개폐기 그룹의 활성 타이머(둘 중 아무 device의 override) — 배지 표시용
function openerTimerOf(og: OpenerGroupInfo): { until: string; direction: 'open' | 'close' } | null {
  for (const d of [og.openDevice, og.closeDevice]) {
    const store = deviceStore.devices.find(x => x.id === d.id) as any
    if (store?.overrideUntil && isActive(store.overrideUntil)) {
      return { until: store.overrideUntil, direction: store.overrideDirection || (d === og.openDevice ? 'open' : 'close') }
    }
  }
  return null
}

// 관수 카드 헤더 배지 — 활성 채널 타이머 요약 { count, maxUntil }
function irrigationTimerSummary(device: Device): { count: number; until: string } | null {
  const store = deviceStore.devices.find(x => x.id === device.id) as any
  const ov = store?.channelOverrides as Record<string, { until: string }> | undefined
  if (!ov) return null
  let count = 0
  let soonest = ''
  for (const key of Object.keys(ov)) {
    const until = ov[key]?.until
    if (until && isActive(until)) {
      count++
      if (!soonest || new Date(until).getTime() < new Date(soonest).getTime()) soonest = until
    }
  }
  return count > 0 ? { count, until: soonest } : null
}

// 자동화 룰
const getGroupRules = (groupId: string): AutomationRule[] =>
  automationStore.rules.filter(r => r.groupId === groupId)
    .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))

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

.btn-visibility {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 12px 18px;
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: 8px;
  color: var(--text-secondary);
  font-weight: 600; font-size: 14px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.btn-visibility:hover { background: var(--bg-hover); border-color: var(--accent); color: var(--text-primary); }
.badge-hidden { font-size: 13px; color: var(--text-muted); font-weight: 600; }
.btn-bulk-control {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 12px 18px; border-radius: 8px; cursor: pointer;
  background: #ef6c00; color: #fff; border: none;
  font-weight: 700; font-size: calc(14px * var(--content-scale, 1));
  transition: background 0.15s;
}
.btn-bulk-control:hover { background: #e65100; }
.btn-bulk-control .bc-bolt { font-size: calc(15px * var(--content-scale, 1)); }

.hidden-banner {
  margin-top: 14px;
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 12px 16px;
  background: var(--bg-card);
  border: 1px dashed var(--border-card);
  border-radius: 10px;
  color: var(--text-secondary); font-size: 13px;
}
.hidden-banner svg { color: var(--text-muted); flex-shrink: 0; }
.hidden-banner strong { color: var(--text-primary); }
.link-btn {
  background: none; border: none; padding: 0;
  color: var(--accent); font-weight: 700; cursor: pointer; text-decoration: underline;
  margin-left: auto;
}

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
  margin-right: 8px;      /* 구역 이름과 간격 */
  vertical-align: middle;
}

.group-title h3 {
  font-size: calc(15px * var(--content-scale, 1));  /* 농가 배지와 어울리게 축소 */
  font-weight: 600;
  color: var(--text-primary);
  display: inline;
  vertical-align: middle;
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
  /* minmax(0, ...) 필수 — 1fr 만 쓰면 자식의 min-content 가 viewport 를 넘쳐
     그리드가 부모를 밀어내 모바일 가로 잘림 발생 */
  grid-template-columns: repeat(auto-fill, minmax(min(260px, 100%), 1fr));
  gap: 10px;
}

.sub-card {
  background: var(--bg-hover);
  border-radius: 12px;
  padding: 16px;
  border: 1px solid var(--border-light);
  min-width: 0;
  overflow: hidden;
}

/* 카드 드래그 정렬 (구역관리) */
.sub-card.reorderable {
  position: relative;
  padding-left: 30px;
  /* 모바일 롱프레스 시 텍스트 선택/복사 콜아웃 방지 */
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
}
/* 이름 변경 입력은 선택/편집 가능하게 복원 */
.sub-card.reorderable .rename-input-inline { user-select: text; -webkit-user-select: text; }
.drag-grip {
  position: absolute;
  left: 6px;
  top: 0;
  bottom: 0;
  width: 16px;
  height: 22px;
  margin: auto 0;
  cursor: grab;
  touch-action: none;         /* grip 위에서만 드래그(카드 본문은 스크롤 보존) */
  color: var(--text-muted);
  opacity: 0.7;
  /* 6점(2열×3행) 그립 — 배경 도트 */
  background-image:
    radial-gradient(currentColor 1.3px, transparent 1.6px),
    radial-gradient(currentColor 1.3px, transparent 1.6px);
  background-size: 5px 7px;
  background-position: 3px 2px, 8px 2px;
  background-repeat: repeat-y;
}
.drag-grip:hover { opacity: 1; }
.drag-grip:active { cursor: grabbing; }
.sub-card.dragging {
  /* transform 은 커서 추적을 위해 인라인(:style)에서 지정 */
  box-shadow: 0 14px 30px rgba(0, 0, 0, 0.16);
  pointer-events: none; /* 드래그 중 아래 카드를 힛테스트하도록 */
  border-color: var(--primary, var(--accent));
  user-select: none;
  will-change: transform;
}
.sub-card.dragging .drag-grip { color: var(--primary, var(--accent)); opacity: 1; }
.reorder-hint {
  font-size: var(--font-size-caption, 12px);
  color: var(--text-muted);
  text-align: center;
  padding: 4px 0 2px;
  user-select: none;
}

.sub-card-top {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  flex-wrap: wrap;
  row-gap: 6px;
  min-width: 0;
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
/* 편집 모드에서 이름은 눌러서 바로 수정 가능(커서 + 점선 밑줄로 어포던스 표시) */
.sub-card-name.editable {
  cursor: text;
  text-decoration: underline dotted;
  text-underline-offset: 3px;
  text-decoration-color: var(--border-color, #cbd5e1);
}
/* 구역 헤더 '편집' 토글 — 켜짐 상태 강조 */
.btn-edit-toggle.active {
  background: var(--accent, #4caf50);
  color: #fff;
  border-color: var(--accent, #4caf50);
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

/* 임시 타이머 (시안) — 자동=초록·수동=주황과 구분 */
.sub-card.timer-active {
  background: #ecfeff;
  border-color: #06b6d4;
}
.timer-badge {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: calc(11px * var(--content-scale, 1));
  font-weight: 800;
  padding: 2px 6px 2px 7px;
  border-radius: 999px;
  background: #ecfeff;
  color: #0e7490;
  border: 1px solid #67e8f9;
  white-space: nowrap;
  flex-shrink: 0;
  cursor: pointer;
  font-variant-numeric: tabular-nums;
}
.timer-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: #06b6d4; flex-shrink: 0;
  animation: timer-blink 1s steps(1) infinite;
}
@keyframes timer-blink { 50% { opacity: 0.25; } }
.timer-x {
  width: 15px; height: 15px; border-radius: 5px;
  background: #fff; border: 1px solid #06b6d4; color: #0e7490;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 9px; margin-left: 1px;
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
/* 룰 순서 드래그 (grip 은 위 .drag-grip 스타일 공용) */
.rule-row.d2.reorderable {
  position: relative;
  padding-left: 38px;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
}
.rule-row.d2 .drag-grip { left: 12px; }
.rule-row.d2.dragging {
  box-shadow: 0 12px 26px rgba(0, 0, 0, 0.16);
  background: var(--bg-card);
  z-index: 5;
  pointer-events: none;
  user-select: none;
}

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
  /* 모바일은 좌우 여백 압축 — 화면을 가능한 한 카드에 양보 */
  .page-container { padding: 4px 0; }
  /* 대시보드처럼 제목줄에 아이콘 버튼 배치 — 설명 숨김 + nowrap 으로 한 줄 고정 */
  .page-header { flex-wrap: nowrap; align-items: center; }
  .page-header > div:first-child { flex: 1; min-width: 0; }
  .page-header .page-description { display: none; }
  .page-header h2 { font-size: calc(24px * var(--content-scale, 1)); white-space: nowrap; }
  /* 상단 액션 버튼: 모바일은 아이콘만(글씨 제거) — 새로고침 버튼처럼 정사각 아이콘 버튼 */
  .page-header .header-actions { flex-shrink: 0; gap: 8px; }
  .page-header .header-actions .btn-label { display: none; }
  .page-header .header-actions > .btn-bulk-control,
  .page-header .header-actions > .btn-visibility,
  .page-header .header-actions > .btn-primary {
    width: 44px; height: 44px; min-width: 44px; padding: 0;
    display: inline-flex; align-items: center; justify-content: center; gap: 0;
    position: relative; flex: 0 0 auto;
  }
  .page-header .header-actions .btn-bulk-control .bc-bolt { font-size: calc(18px * var(--content-scale, 1)); }
  .page-header .header-actions .btn-add-zone .add-plus { font-size: calc(24px * var(--content-scale, 1)); font-weight: 700; line-height: 1; }
  /* 숨김 개수: 아이콘 우상단 배지로 */
  .page-header .header-actions .badge-hidden {
    position: absolute; top: -5px; right: -5px;
    min-width: 17px; height: 17px; padding: 0 4px;
    background: #ef6c00; color: #fff; border-radius: 9px;
    font-size: 10px; font-weight: 800;
    display: flex; align-items: center; justify-content: center;
  }
  .page-header .header-actions .badge-hidden .hz-text { display: none; }
  /* 모바일 2열 — minmax(0, 1fr) 필수(1fr 만으로는 자식 min-content 가 viewport 폭을 넘겨 가로 잘림).
     측정기·장치 카드만 2열, 자동제어룰 리스트는 아래에서 1열 유지. */
  .device-sub-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  /* 모바일: 제목 + 옵션 버튼을 한 줄에(수량 배지 제거로 공간 확보). 제목은 한 줄 말줄임,
     버튼 묶음은 유지. 버튼은 한 줄에 들어가도록 살짝 축소. */
  .group-header { align-items: center; gap: 6px; }
  .group-title { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .farm-owner-badge { font-size: 10px; padding: 1px 7px; margin-right: 5px; }
  .group-header-actions {
    justify-content: flex-end;
    flex-wrap: nowrap;
    gap: 3px;
    flex-shrink: 0;
  }
  .group-header-actions .btn-icon {
    min-width: 32px; min-height: 32px;
    width: 32px; height: 32px;
    padding: 0;
    flex-shrink: 0;
  }
  .group-header-actions .btn-memo {
    position: relative;          /* 배지 absolute 기준 */
    /* 다른 아이콘 버튼(.btn-icon)과 완전히 동일한 박스 — 크기·모양·정렬 통일 */
    box-sizing: border-box;
    width: 32px; height: 32px;
    min-width: 32px; min-height: 32px;
    padding: 0;
    gap: 0;
    border-radius: 8px;
    flex-shrink: 0;
    justify-content: center;
  }
  .group-header-actions .btn-memo .memo-text { display: none; }   /* 라벨 숨김 — 아이콘만 */
  .group-header-actions .btn-memo .memo-count {
    /* 배지를 우상단으로 띄워 버튼 폭에 영향 X */
    position: absolute;
    top: -4px;
    right: -4px;
    min-width: 16px; height: 16px;
    padding: 0 4px;
    font-size: 10px;
    border: 2px solid var(--bg-card, #fff);
  }
  .group-header-actions .device-count-badge {
    padding: 0 10px;
    line-height: 30px;
    height: 32px;
    font-size: 12px;
    flex-shrink: 0;
  }
  .btn-sm { padding: 0 18px; line-height: 1.8; }
  /* '상태' 버튼: 2열 컴팩트 카드에선 작은 pill 로(전역 button min-height:44px 해제,
     옆 타입태그와 높이·radius·글씨 통일) */
  .btn-status-sm {
    padding: 3px 9px;
    min-height: 0;
    line-height: 1.4;
    font-size: calc(11px * var(--content-scale, 1));
    border-radius: 6px;
  }
  .type-tag { padding: 0 18px; line-height: 1.8; }
  /* 카드 내부 좌우에 일정한 여백을 줘서 이름·설명·아이콘·본문이 카드 가장자리에
     붙지 않고 나란히 정렬되도록 한다. */
  .group-card { padding: 0; }
  .group-header { padding: 11px 14px; }
  .group-body { padding: 0 12px 12px; }

  /* 모바일 2열 카드 밀도 — 여백·손잡이·토글 압축(글씨 크기는 폰트 설정 3단계 --content-scale 그대로 유지) */
  .device-sub-grid { gap: 8px; }
  .section-label { padding: 4px 10px; }
  .sub-card { padding: 9px 10px; }
  .sub-card.reorderable { padding-left: 22px; }
  .sub-card-top { margin-bottom: 4px; gap: 5px; row-gap: 4px; }
  .sub-card-control { padding: 3px 0; }
  .sub-card-sensor-chips { gap: 4px; }
  .sensor-chip { padding: 2px 8px; font-size: 11px; }
  .reorder-hint { padding: 2px 0 0; }
  /* 2열은 카드 폭이 좁아 기존 글씨면 장치명이 잘림 → 3단계 기능은 유지(--content-scale 곱셈 그대로)하고
     2열 전용 기준 크기만 낮춰 이름이 읽히게 함. 3단계 확대/축소는 그대로 작동. */
  /* 이름은 최소폭 보장 → 타입태그가 인라인으로 이름을 짓눌러 'ㅏ'처럼 잘리는 것 방지.
     짧은 이름은 태그와 한 줄 유지, 긴 이름은 태그가 다음 줄로 자연스럽게 내려감. */
  .sub-card-name { font-size: calc(12.5px * var(--content-scale, 1)); min-width: 5.5em; }
  /* 컨트롤 라벨은 줄바꿈 금지(카드가 세로로 길어지는 것 방지) — 넘치면 말줄임 */
  .control-label {
    font-size: calc(12.5px * var(--content-scale, 1));
    min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .type-tag { font-size: calc(11px * var(--content-scale, 1)); padding: 2px 7px; }
  .sub-card-value.muted { font-size: calc(12px * var(--content-scale, 1)); }
  /* 좁은 2열 카드에서 손잡이 폭 축소 */
  .drag-grip { left: 4px; width: 14px; }
  /* 컴팩트 토글(48×26 → 38×20) — 좁은 카드에서 라벨 공간 확보 */
  .toggle-switch { width: 38px; height: 20px; }
  .toggle-slider { border-radius: 20px; }
  .toggle-slider:before { height: 16px; width: 16px; left: 2px; bottom: 2px; }
  input:checked + .toggle-slider:before { transform: translateX(18px); }
  /* 자동제어룰 행은 1열 유지 + 상하 여백만 컴팩트 */
  .rule-row.d2 { padding: 10px 12px; min-height: 40px; }
}

/* 일괄제어 정지 룰 원복 배너 */
.bulk-restore-banner {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  margin-bottom: 14px; padding: 10px 14px; border-radius: 10px;
  background: rgba(245, 158, 11, 0.1); border: 1px solid #fcd34d;
}
.brb-text { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-primary, #333); min-width: 0; }
.brb-icon { font-size: 15px; flex-shrink: 0; }
.brb-text b { color: #b45309; }
.brb-names { color: var(--text-secondary, #6b7280); font-size: 12px; }
.brb-restore {
  flex-shrink: 0; padding: 7px 14px; border-radius: 8px; cursor: pointer; font-weight: 700; font-size: 13px;
  background: #f59e0b; color: #fff; border: none; transition: filter 0.15s;
}
.brb-restore:hover:not(:disabled) { filter: brightness(0.95); }
.brb-restore:disabled { opacity: 0.6; cursor: not-allowed; }
#app.theme-dark .bulk-restore-banner { background: rgba(245,158,11,0.14); border-color: rgba(245,158,11,0.45); }

/* 우적센서: 비 감지 자동 제어 토글 버튼 (측정기 카드) */
.rain-override-btn {
  display: flex; align-items: center; justify-content: center; gap: 5px; width: 100%;
  margin-top: 6px; padding: 5px 8px; border-radius: 6px; cursor: pointer;
  font-size: 11px; font-weight: 700; border: 1px solid; transition: filter 0.15s;
}
.rain-override-btn.is-on { background: #eff6ff; border-color: #bfdbfe; color: #2563eb; }
.rain-override-btn.is-off { background: #fef3c7; border-color: #fde68a; color: #b45309; }
.rain-override-btn:hover { filter: brightness(0.97); }
#app.theme-dark .rain-override-btn.is-on { background: rgba(59,130,246,0.15); border-color: rgba(59,130,246,0.4); color: #93c5fd; }
#app.theme-dark .rain-override-btn.is-off { background: rgba(245,158,11,0.15); border-color: rgba(245,158,11,0.4); color: #fbbf24; }
</style>
