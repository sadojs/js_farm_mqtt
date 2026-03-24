# Design: automation-device-v2

> Date: 2026-02-21 | Plan: automation-device-v2.plan.md

## 1. 데이터 구조 변경

### 1-1. EquipmentType 확장 (device.types.ts + device.entity.ts)

```typescript
// 변경 전: 'opener' | 'fan' | 'irrigation' | 'other'
// 변경 후:
export type EquipmentType = 'fan' | 'irrigation' | 'opener_open' | 'opener_close' | 'other'
```

### 1-2. Device 인터페이스 확장 (device.types.ts)

```typescript
export interface Device {
  // ... 기존 필드
  pairedDeviceId?: string      // 개폐기 페어링: 상대 장비 ID
  openerGroupName?: string     // 개폐기 대표 이름
}
```

### 1-3. devices 테이블 컬럼 추가

```sql
ALTER TABLE devices ADD COLUMN paired_device_id UUID REFERENCES devices(id);
ALTER TABLE devices ADD COLUMN opener_group_name VARCHAR(255);
```

### 1-4. Condition 인터페이스 확장 (automation.types.ts)

```typescript
export interface Condition {
  // ... 기존 필드
  deviation?: number           // FR-02: 히스테리시스 편차값
  timeSlots?: { start: number; end: number }[]  // FR-03: 시간대 배열
  repeat?: boolean             // FR-03: 반복 여부
  relay?: boolean              // FR-04: 릴레이 동작대기
  relayOnMinutes?: number      // FR-04: 동작 시간 (기본 50)
  relayOffMinutes?: number     // FR-04: 정지 시간 (기본 10)
}
```

### 1-5. WizardFormData 변경 (automation.types.ts)

```typescript
export interface WizardFormData {
  groupId?: string
  sensorDeviceIds: string[]
  actuatorDeviceId?: string        // 변경: 배열 → 단일 (FR-01)
  // actuatorCommand 제거 (FR-01)
  conditions: ConditionGroup
  name: string
  description: string
  priority: number
}
```

### 1-6. RuleAction 변경 (automation.types.ts)

```typescript
export interface RuleAction {
  targetDeviceId: string           // 단일 장비 ID (FR-01)
  sensorDeviceIds?: string[]
  // command는 조건에서 자동 결정 (히스테리시스: ON/OFF 자동, 시간: 시작=ON/종료=OFF)
}
```

## 2. 컴포넌트별 상세 설계

### 2-1. StepActuatorSelect.vue (FR-01)

**변경점:**
- 체크박스(멀티) → **라디오(단일)** 선택
- 동작 설정(ON/OFF) 섹션 **삭제**
- `actuators` computed: `equipmentType`가 `opener_open`/`opener_close` 인 장비 **필터 제외**

```html
<!-- 라디오 선택으로 변경 -->
<div class="radio-mark" :class="{ checked: selectedId === device.id }">
  <span v-if="selectedId === device.id">●</span>
</div>
```

**Props 변경:**
```typescript
// 변경 전: deviceIds: string[], command: 'on'|'off'
// 변경 후:
defineProps<{
  selectedId?: string
  groupId?: string
}>()
defineEmits<{
  'update:selectedId': [value: string]
}>()
```

### 2-2. StepConditionBuilder.vue (FR-02, FR-03, FR-04)

**A. 히스테리시스 UI (FR-02)** - 장비=fan + 필드=temperature/humidity:

```html
<div v-if="isFanHysteresis(cond)" class="hysteresis-row">
  <label>기준값</label>
  <input type="number" v-model="cond.value" />
  <span class="unit">{{ getUnit(cond.field) }}</span>
  <label>편차</label>
  <input type="number" v-model="cond.deviation" min="0" />
  <span class="unit">{{ getUnit(cond.field) }}</span>
  <div class="hysteresis-preview">
    ON: {{ cond.value + (cond.deviation||0) }}이상 / OFF: {{ cond.value - (cond.deviation||0) }}이하
  </div>
</div>
```

**B. 미구현 필드 (FR-02)** - rain, uv, dew_point 선택 시:

```html
<div v-if="isUnimplemented(cond.field)" class="unimplemented-badge">
  미구현 (추후 업데이트 예정)
</div>
```
- `isUnimplemented(field)`: `['rain', 'uv', 'dew_point'].includes(field)`
- 미구현 필드 선택 시 `canProceed` emit → false

**C. 시간대 스케줄러 UI (FR-03)** - timeOnly + fan:

```html
<div v-if="timeOnly && isFan" class="time-scheduler">
  <div v-for="(slot, i) in timeSlots" class="time-slot">
    <input type="number" v-model="slot.start" min="0" max="23" /> 시
    <span>~</span>
    <input type="number" v-model="slot.end" min="0" max="23" /> 시
    <button @click="removeSlot(i)">✕</button>
  </div>
  <button @click="addSlot">+ 시간대 추가</button>

  <div class="day-selector">
    <button v-for="d in DAYS" :class="{ active: selectedDays.includes(d.value) }" @click="toggleDay(d.value)">
      {{ d.label }}
    </button>
  </div>

  <label class="repeat-toggle">
    <input type="checkbox" v-model="repeat" /> 매주 반복
  </label>
</div>
```

**DAYS 상수:**
```typescript
const DAYS = [
  { value: 1, label: '월' }, { value: 2, label: '화' },
  { value: 3, label: '수' }, { value: 4, label: '목' },
  { value: 5, label: '금' }, { value: 6, label: '토' },
  { value: 7, label: '일' },
]
```

**D. 릴레이 동작대기 (FR-04)** - fan인 경우 모든 조건에:

```html
<div v-if="isFan" class="relay-option">
  <label class="relay-toggle">
    <input type="checkbox" v-model="cond.relay" />
    동작대기 (50분 ON / 10분 OFF 반복)
  </label>
</div>
```

**새 Props:**
```typescript
defineProps<{
  modelValue: ConditionGroup
  timeOnly?: boolean
  equipmentType?: string   // 추가: 선택된 장비의 equipmentType
}>()
defineEmits<{
  'update:modelValue': [value: ConditionGroup]
  'update:canProceed': [value: boolean]  // 추가: 미구현 필드 선택 시 false
}>()
```

### 2-3. DeviceRegistration.vue (FR-05, FR-06)

**A. 장비 타입 옵션 변경 (FR-05):**

```typescript
const EQUIPMENT_TYPE_OPTIONS = [
  { value: 'other', label: '기타' },
  { value: 'irrigation', label: '관수' },
  { value: 'fan', label: '환풍기(휀)' },
  { value: 'opener_open', label: '개폐기(열림)' },
  { value: 'opener_close', label: '개폐기(닫힘)' },
]
```

**B. 개폐기 페어링 검증 (FR-06):**

```typescript
const openerOpenDevices = computed(() =>
  selectedDevices.filter(d => d.equipmentType === 'opener_open')
)
const openerCloseDevices = computed(() =>
  selectedDevices.filter(d => d.equipmentType === 'opener_close')
)
const hasOpenerType = computed(() =>
  openerOpenDevices.value.length > 0 || openerCloseDevices.value.length > 0
)
const openerPairValid = computed(() => {
  if (!hasOpenerType.value) return true
  return openerOpenDevices.value.length === 1 && openerCloseDevices.value.length === 1
})
const canProceedStep2 = computed(() => {
  if (!hasOpenerType.value) return selectedDevices.length > 0
  return openerPairValid.value
})
```

**C. 이름 설정 단계 (FR-06):**
- 개폐기 쌍이 있을 경우: 대표 이름 1개 입력 (openerGroupName)
- 개별 장비 이름은 자동 생성: `{대표이름} (열림)`, `{대표이름} (닫힘)`

**D. 등록 API 요청:**
```typescript
// 개폐기인 경우 pairedDeviceId 상호 설정
const registerPayload = {
  devices: [
    { ...openDevice, openerGroupName, pairedDeviceId: 'PLACEHOLDER_CLOSE' },
    { ...closeDevice, openerGroupName, pairedDeviceId: 'PLACEHOLDER_OPEN' },
  ],
  houseId,
}
```

### 2-4. Devices.vue - 개폐기 인터록 (FR-07)

**A. 개폐기 그룹 표시:**

```html
<div v-for="openerGroup in openerGroups" class="opener-group-card">
  <div class="opener-title">{{ openerGroup.groupName }}</div>
  <div class="opener-controls">
    <div class="opener-row">
      <span>개폐기(열림)</span>
      <button @click="interlockControl(openerGroup, 'open')"
        :class="{ active: openerGroup.openDevice.switchState }">
        {{ openerGroup.openDevice.switchState ? 'ON' : 'OFF' }}
      </button>
    </div>
    <div class="opener-row">
      <span>개폐기(닫힘)</span>
      <button @click="interlockControl(openerGroup, 'close')"
        :class="{ active: openerGroup.closeDevice.switchState }">
        {{ openerGroup.closeDevice.switchState ? 'ON' : 'OFF' }}
      </button>
    </div>
  </div>
</div>
```

**B. 인터록 시퀀스:**

```typescript
async function interlockControl(group: OpenerGroup, action: 'open' | 'close') {
  const targetDevice = action === 'open' ? group.openDevice : group.closeDevice
  const oppositeDevice = action === 'open' ? group.closeDevice : group.openDevice

  // 이미 ON이면 OFF만
  if (targetDevice.switchState) {
    await deviceStore.controlDevice(targetDevice.id, [{ code: 'switch_1', value: false }])
    return
  }

  // 반대쪽이 ON이면: 먼저 OFF → 1.5초 대기 → 대상 ON
  if (oppositeDevice.switchState) {
    await deviceStore.controlDevice(oppositeDevice.id, [{ code: 'switch_1', value: false }])
    await new Promise(resolve => setTimeout(resolve, 1500))
  }

  await deviceStore.controlDevice(targetDevice.id, [{ code: 'switch_1', value: true }])
}
```

## 3. 백엔드 변경

### 3-1. device.entity.ts

```typescript
@Column({ name: 'paired_device_id', nullable: true })
pairedDeviceId: string;

@Column({ name: 'opener_group_name', nullable: true })
openerGroupName: string;
```

### 3-2. devices.service.ts - 개폐기 페어 등록

`registerBatch` 수정: 개폐기 쌍 감지 → pairedDeviceId 상호 설정

### 3-3. automation-runner.service.ts - 히스테리시스 로직

`evaluateSingleCondition` 수정:

```typescript
// deviation이 있는 경우 (히스테리시스)
if (condition.deviation != null && condition.deviation > 0) {
  const base = Number(condition.value)
  const dev = Number(condition.deviation)
  const onThreshold = base + dev    // 이 이상이면 ON
  const offThreshold = base - dev   // 이 이하이면 OFF

  if (actualNum >= onThreshold) return { matched: true, ... }   // ON
  if (actualNum <= offThreshold) return { matched: false, ... }  // OFF
  // 사이 값: 현재 상태 유지 (마지막 상태 기준)
  return { matched: this.getLastDeviceState(rule), ... }
}
```

### 3-4. automation-runner.service.ts - 시간대 스케줄러

`evaluateSingleCondition` 수정:

```typescript
if (condition.timeSlots?.length) {
  const currentHour = now.getHours()
  const weekdayMatched = this.isWeekdayMatched(condition, now)
  if (!weekdayMatched) return { matched: false, ... }

  for (const slot of condition.timeSlots) {
    if (currentHour === slot.start) return { matched: true, action: 'on', ... }
    if (currentHour === slot.end) return { matched: true, action: 'off', ... }
  }
  // 동작 시간대 내인지 확인 (릴레이용)
  const inActiveSlot = condition.timeSlots.some(s =>
    currentHour >= s.start && currentHour < s.end
  )
  return { matched: false, inActiveSlot, ... }
}
```

### 3-5. automation-runner.service.ts - 릴레이 동작

릴레이 로직은 `executeRule` 에서 처리:

```typescript
if (condition.relay) {
  const minuteInHour = now.getMinutes()
  const cycleLength = (condition.relayOnMinutes || 50) + (condition.relayOffMinutes || 10)
  const cyclePosition = minuteInHour % cycleLength
  const isOnPhase = cyclePosition < (condition.relayOnMinutes || 50)
  // isOnPhase면 ON, 아니면 OFF 명령
}
```

## 4. RuleWizardModal.vue 위저드 흐름 변경

**기존 5단계:** 그룹 → 센서 → 장비(멀티+동작) → 조건 → 확인
**변경 5단계:** 그룹 → 센서 → 장비(단일) → 조건(히스테리시스/시간/릴레이) → 확인

- Step 3: `StepActuatorSelect` props 변경 (deviceIds → selectedId)
- Step 4: `StepConditionBuilder`에 `equipmentType` 전달
- Step 5: 확인 페이지에서 히스테리시스/시간대 정보 표시

**canNext 로직 변경 (Step 4):**
```typescript
// 미구현 필드 선택 시 비활성화
const step4CanNext = computed(() => {
  const allConditions = form.conditions.groups.flatMap(g => g.conditions)
  return !allConditions.some(c => ['rain', 'uv', 'dew_point'].includes(c.field))
})
```

## 5. 구현 순서 (7 Phase)

| Phase | FR | 작업 | 파일 |
|-------|-----|------|------|
| 1 | FR-05 | EquipmentType 변경 + 옵션 UI | device.types.ts, device.entity.ts, DeviceRegistration.vue |
| 2 | FR-06 | 개폐기 페어링 검증 + 등록 | DeviceRegistration.vue, devices.service.ts |
| 3 | FR-07 | 개폐기 인터록 제어 UI + 로직 | Devices.vue, device.store.ts |
| 4 | FR-01 | 장비 단일 선택 + 개폐기 숨김 | StepActuatorSelect.vue, RuleWizardModal.vue, automation.types.ts |
| 5 | FR-02 | 히스테리시스 조건 UI + 백엔드 | StepConditionBuilder.vue, automation-runner.service.ts |
| 6 | FR-03 | 시간대 스케줄러 UI + 백엔드 | StepConditionBuilder.vue, automation-runner.service.ts |
| 7 | FR-04 | 릴레이 동작대기 | StepConditionBuilder.vue, automation-runner.service.ts |
