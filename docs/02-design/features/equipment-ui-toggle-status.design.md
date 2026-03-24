# Design: 장비 관리 UI 개선 - 토글 변환 및 관수 상태 모달

## Feature ID
`equipment-ui-toggle-status`

## Date
2026-02-22

## Reference
- Plan: `docs/01-plan/features/equipment-ui-toggle-status.plan.md`

---

## 1. Overview

장비 관리(Devices.vue) 및 그룹 관리(Groups.vue)의 개폐기/관수 장비 UI를 개선한다.
프론트엔드 뷰 2개 파일만 수정하며, 백엔드 및 타입 변경 없음.

---

## 2. 수정 대상 파일 요약

| File | Line Range | FR | 변경 내용 |
|------|-----------|-----|----------|
| `frontend/src/views/Devices.vue` | 56-59 | FR-02 | 개폐기 헤더에 "장비" 뱃지 추가 |
| `frontend/src/views/Devices.vue` | 60-84 | FR-01 | 개폐기 ON/OFF 버튼 → toggle-switch |
| `frontend/src/views/Devices.vue` | 92-95 | FR-04 | 관수 헤더에 "상태" 버튼 추가 |
| `frontend/src/views/Devices.vue` | 97-121 | FR-03 | 관수 ON/OFF 버튼 → toggle-switch |
| `frontend/src/views/Devices.vue` | 신규 | FR-04 | 관수 상태 모달 template + script + style |
| `frontend/src/views/Groups.vue` | 97-117 | FR-05 | 관수 카드에 "상태" 버튼 + 상태 모달 |

**신규 파일**: 없음
**백엔드 변경**: 없음
**타입 변경**: 없음

---

## 3. 상세 설계

### 3.1 FR-01: 개폐기 ON/OFF 버튼 → 토글 스위치

**현재 코드** (Devices.vue Lines 60-84):
```html
<div class="opener-row">
  <span class="opener-label">열림</span>
  <span :class="['status-dot', ...]"></span>
  <button class="opener-btn" :class="{ active: ..., disabled: ... }" ...>
    {{ group.openDevice.switchState ? 'ON' : 'OFF' }}
  </button>
</div>
```

**변경 후**:
```html
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
```

**설계 포인트**:
- `opener-btn` 버튼을 `toggle-switch` label로 교체
- `@click.prevent`로 기본 동작 방지 후 `interlockControl()` 직접 호출
- `interlocking` ref를 :disabled와 @click 조건 모두에서 확인
- `.opener-toggle-area.disabled`로 비활성 시 opacity 처리
- 닫힘(close) 행도 동일 패턴

### 3.2 FR-02: 개폐기 "장비" 뱃지 추가

**현재 코드** (Devices.vue Lines 56-59):
```html
<div class="opener-header">
  <div class="opener-title">{{ group.groupName }}</div>
  <button class="btn-icon-delete" ...>삭제</button>
</div>
```

**변경 후**:
```html
<div class="opener-header">
  <div class="opener-title">{{ group.groupName }}</div>
  <span class="type-badge actuator">장비</span>
  <button class="btn-icon-delete" ...>삭제</button>
</div>
```

**설계 포인트**:
- 기존 `.type-badge.actuator` 클래스 재사용 (Devices.vue Line 585에 스타일 이미 정의)
- 제목과 삭제 버튼 사이에 배치

### 3.3 FR-03: 관수 ON/OFF 버튼 → 토글 스위치

**현재 코드** (Devices.vue Lines 97-121):
```html
<div class="irrigation-row">
  <span class="irrigation-label">타이머 전원/B접점</span>
  <span :class="['status-dot', ...]"></span>
  <button class="opener-btn" ...>{{ ... ? 'ON' : 'OFF' }}</button>
</div>
```

**변경 후**:
```html
<div class="irrigation-row">
  <span class="irrigation-label">타이머 전원/B접점</span>
  <span :class="['status-dot', device.online ? 'online' : 'offline']"></span>
  <div class="irrigation-toggle-area" :class="{ disabled: !device.online }">
    <label class="toggle-switch" @click.prevent="device.online && !irrigationControlling && handleIrrigationControl(device, 'switch_1')">
      <input type="checkbox" :checked="device.switchStates?.switch_1 === true" :disabled="!device.online || irrigationControlling !== null" />
      <span class="toggle-slider"></span>
    </label>
  </div>
</div>
```

**설계 포인트**:
- `opener-btn`을 `toggle-switch`로 교체
- 교반기/B접점(`switch_usb1`) 행도 동일 패턴

### 3.4 FR-04: 관수 상태 모달 (Devices.vue)

#### 3.4.1 상태 버튼 위치

**변경 후** (irrigation-header):
```html
<div class="irrigation-header">
  <div class="irrigation-title">{{ device.name }}</div>
  <button class="btn-status" @click="openIrrigationStatusModal(device)">상태</button>
  <span class="type-badge actuator">장비</span>
  <button class="btn-icon-delete" ...>삭제</button>
</div>
```

#### 3.4.2 Script 추가

```typescript
// 관수 상태 모달
const showIrrigationStatusModal = ref(false)
const irrigationStatusDevice = ref<Device | null>(null)

const IRRIGATION_SWITCH_LABELS: Record<string, string> = {
  switch_1: '타이머 전원/B접점',
  switch_2: '1구역 관수',
  switch_3: '2구역 관수',
  switch_4: '3구역 관수',
  switch_5: '4구역 관수',
  switch_6: '5구역 관수',
  switch_usb1: '교반기 모터/B접점',
  switch_usb2: '액비모터',
}

const openIrrigationStatusModal = (device: Device) => {
  irrigationStatusDevice.value = device
  showIrrigationStatusModal.value = true
}
```

#### 3.4.3 모달 Template

Groups.vue의 기존 인라인 모달 패턴(`modal-overlay` + `add-device-modal`)을 참조하여 동일한 구조로 구현.

```html
<!-- 관수 상태 모달 -->
<div v-if="showIrrigationStatusModal && irrigationStatusDevice" class="modal-overlay" @click.self="showIrrigationStatusModal = false">
  <div class="status-modal">
    <div class="status-modal-header">
      <h3>{{ irrigationStatusDevice.name }} - 스위치 상태</h3>
      <button class="close-btn" @click="showIrrigationStatusModal = false">✕</button>
    </div>
    <div class="status-modal-body">
      <div
        v-for="(label, code) in IRRIGATION_SWITCH_LABELS"
        :key="code"
        class="status-row"
      >
        <span class="status-row-label">{{ label }}</span>
        <span
          class="status-row-value"
          :class="irrigationStatusDevice.switchStates?.[code] ? 'on' : 'off'"
        >
          {{ irrigationStatusDevice.switchStates?.[code] ? 'ON' : 'OFF' }}
        </span>
      </div>
    </div>
  </div>
</div>
```

#### 3.4.4 모달 CSS

```css
/* 관수 상태 모달 */
.modal-overlay {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: var(--overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 20px;
}

.status-modal {
  background: var(--bg-card);
  border-radius: 16px;
  width: 100%;
  max-width: 420px;
  box-shadow: var(--shadow-modal);
}

.status-modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 24px;
  border-bottom: 1px solid var(--border-color);
}

.status-modal-header h3 {
  font-size: calc(18px * var(--content-scale, 1));
  font-weight: 600;
  margin: 0;
}

.close-btn {
  background: none;
  border: none;
  font-size: 20px;
  color: var(--text-muted);
  cursor: pointer;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.status-modal-body {
  padding: 16px 24px 24px;
}

.status-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 0;
  border-bottom: 1px solid var(--border-light);
}
.status-row:last-child {
  border-bottom: none;
}

.status-row-label {
  font-size: calc(15px * var(--content-scale, 1));
  font-weight: 500;
  color: var(--text-primary);
}

.status-row-value {
  font-size: calc(14px * var(--content-scale, 1));
  font-weight: 600;
  padding: 4px 12px;
  border-radius: 6px;
}
.status-row-value.on {
  background: var(--accent-bg);
  color: var(--accent);
}
.status-row-value.off {
  background: var(--bg-badge);
  color: var(--text-muted);
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
```

### 3.5 FR-05: 그룹 관리 관수 상태 모달 (Groups.vue)

#### 3.5.1 상태 버튼 위치

관수 카드의 `sub-card-top` 아래, 토글 컨트롤 위에 상태 버튼을 배치:

```html
<div v-for="device in getGroupIrrigationDevices(group)" :key="device.id" class="sub-card actuator">
  <div class="sub-card-top">
    <span :class="['status-dot', device.online ? 'online' : 'offline']"></span>
    <span class="sub-card-name">{{ device.name }}</span>
    <button class="btn-status-sm" @click="openIrrigationStatusModal(device)">상태</button>
    <span class="type-tag actuator">관수</span>
  </div>
  <!-- 기존 토글 컨트롤 유지 -->
</div>
```

#### 3.5.2 Script 추가 (Groups.vue)

```typescript
// 관수 상태 모달
const showIrrigationStatusModal = ref(false)
const irrigationStatusDevice = ref<Device | null>(null)

const IRRIGATION_SWITCH_LABELS: Record<string, string> = {
  switch_1: '타이머 전원/B접점',
  switch_2: '1구역 관수',
  switch_3: '2구역 관수',
  switch_4: '3구역 관수',
  switch_5: '4구역 관수',
  switch_6: '5구역 관수',
  switch_usb1: '교반기 모터/B접점',
  switch_usb2: '액비모터',
}

const openIrrigationStatusModal = (device: Device) => {
  irrigationStatusDevice.value = device
  showIrrigationStatusModal.value = true
}
```

#### 3.5.3 모달 Template (Groups.vue)

Devices.vue와 동일한 모달 구조를 Groups.vue `</template>` 바로 앞에 추가.
단, Groups.vue에는 이미 `modal-overlay` 클래스가 사용 중(장비 추가 모달)이므로 동일 클래스 재사용.

#### 3.5.4 CSS 추가 (Groups.vue)

```css
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
```

모달 스타일(`.status-modal`, `.status-row` 등)은 Devices.vue와 동일하게 적용.

---

## 4. 추가 CSS (Devices.vue)

### 4.1 토글 영역 래퍼

```css
.opener-toggle-area,
.irrigation-toggle-area {
  margin-left: auto;
}
.opener-toggle-area.disabled,
.irrigation-toggle-area.disabled {
  opacity: 0.4;
  pointer-events: none;
}
```

---

## 5. 구현 순서 (4 Phase, 7 Step)

### Phase 1: 개폐기 UI 개선 (FR-01, FR-02)
| Step | 파일 | 작업 |
|------|------|------|
| 1-1 | Devices.vue template | 개폐기 헤더에 `<span class="type-badge actuator">장비</span>` 추가 |
| 1-2 | Devices.vue template | 개폐기 열림/닫힘의 `opener-btn` → `toggle-switch` 교체 |
| 1-3 | Devices.vue style | `.opener-toggle-area` CSS 추가 |

### Phase 2: 관수 토글 변환 (FR-03)
| Step | 파일 | 작업 |
|------|------|------|
| 2-1 | Devices.vue template | 관수 `opener-btn` 2개 → `toggle-switch` 교체 |
| 2-2 | Devices.vue style | `.irrigation-toggle-area` CSS 추가 |

### Phase 3: 관수 상태 모달 (FR-04, FR-05)
| Step | 파일 | 작업 |
|------|------|------|
| 3-1 | Devices.vue script | `IRRIGATION_SWITCH_LABELS`, `showIrrigationStatusModal`, `irrigationStatusDevice`, `openIrrigationStatusModal` 추가 |
| 3-2 | Devices.vue template | irrigation-header에 "상태" 버튼 추가 |
| 3-3 | Devices.vue template | 모달 overlay + status-modal 추가 |
| 3-4 | Devices.vue style | `.modal-overlay`, `.status-modal`, `.status-row`, `.btn-status` CSS 추가 |
| 3-5 | Groups.vue script | 동일한 상수/ref/함수 추가 |
| 3-6 | Groups.vue template | 관수 카드에 "상태" 버튼 추가 |
| 3-7 | Groups.vue template | 모달 overlay + status-modal 추가 |
| 3-8 | Groups.vue style | `.btn-status-sm`, 모달 CSS 추가 |

### Phase 4: 빌드 검증
| Step | 작업 |
|------|------|
| 4-1 | `npm run build` (Vite) 통과 확인 |

---

## 6. 데이터 흐름

```
[장비 관리 페이지]
  개폐기 토글 → interlockControl() → deviceStore.controlDevice() → Tuya API
  관수 토글 → handleIrrigationControl() → deviceStore.controlDevice() → Tuya API
  관수 상태 버튼 → openIrrigationStatusModal(device) → 모달 표시
    └─ device.switchStates 참조 (이미 fetchDeviceStatus()에서 로드됨)

[그룹 관리 페이지]
  관수 상태 버튼 → openIrrigationStatusModal(device) → 모달 표시
    └─ deviceStore에서 최신 switchStates 참조
```

추가 API 호출 없음. 기존 `fetchAllActuatorStatuses()`에서 이미 로드된 `switchStates` 데이터를 읽기 전용으로 표시.

---

## 7. 영향도 분석

| 항목 | 영향 |
|------|------|
| 기능 변경 | ON/OFF 버튼 → 토글 (동작 로직 동일, UI만 변경) |
| 신규 기능 | 관수 상태 모달 (읽기 전용, 부가 정보) |
| 기존 기능 영향 | 없음 (인터록 제어, 관수 제어 로직 변경 없음) |
| Backend 영향 | 없음 |
| DB 영향 | 없음 |
| 타입 변경 | 없음 |
