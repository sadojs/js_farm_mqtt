# Design: 관수 장비 릴레이 채널 동적 매핑 (MQTT 버전)

> **Feature**: irrigation-relay-mapping (MQTT)
> **Project**: smart-farm-mqtt
> **Date**: 2026-03-30
> **Plan**: [irrigation-relay-mapping.plan.md](../../01-plan/features/irrigation-relay-mapping.plan.md)
> **Reference**: smart-farm-platform 동일 기능 (Match Rate 96%)

---

## 1. 신규 파일: channel-mapping.constants.ts

**경로**: `backend/src/modules/devices/channel-mapping.constants.ts`

```typescript
export const DEFAULT_CHANNEL_MAPPING = {
  remote_control:       'switch_1',
  zone_1:               'switch_2',
  zone_2:               'switch_3',
  zone_3:               'switch_4',
  zone_4:               'switch_5',
  fertilizer_b_contact: 'switch_6',
  mixer:                'switch_usb1',
  fertilizer_motor:     'switch_usb2',
};

export const FUNCTION_LABELS: Record<string, string> = {
  remote_control:       '원격제어 ON/OFF',
  zone_1:               '1구역 관수',
  zone_2:               '2구역 관수',
  zone_3:               '3구역 관수',
  zone_4:               '4구역 관수',
  fertilizer_b_contact: '액비/교반기 B접점',
  mixer:                '교반기',
  fertilizer_motor:     '액비모터',
};

export const AVAILABLE_SWITCH_CODES = [
  'switch_1', 'switch_2', 'switch_3', 'switch_4',
  'switch_5', 'switch_6', 'switch_usb1', 'switch_usb2',
];
```

---

## 2. DB 스키마 변경

**파일**: `backend/database/migration-002-channel-mapping.sql`

```sql
-- 채널 매핑 컬럼 추가
ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS channel_mapping JSONB DEFAULT NULL;

COMMENT ON COLUMN devices.channel_mapping IS
  '관수 장비 릴레이 채널 매핑 (NULL이면 기본값 사용)';
```

> **주의**: `backend/database/schema.sql`의 devices 테이블 정의에도 컬럼 추가

---

## 3. Backend 변경

### 3-1. device.entity.ts

```typescript
@Column({ name: 'channel_mapping', type: 'jsonb', nullable: true })
channelMapping: Record<string, string> | null;
```

### 3-2. devices.service.ts

**추가 메서드 3개**

#### getEffectiveMapping(device)
```typescript
getEffectiveMapping(device: Device): Record<string, string> {
  return device.channelMapping ?? { ...DEFAULT_CHANNEL_MAPPING };
}
```

#### updateChannelMapping(id, userId, role, mapping)
```typescript
async updateChannelMapping(
  id: string,
  userId: string,
  role: string,
  mapping: Record<string, string>,
): Promise<Device> {
  if (role !== 'admin' && role !== 'farm_admin') {
    throw new ForbiddenException('채널 매핑 수정 권한이 없습니다.');
  }
  const device = await this.devicesRepo.findOne({ where: { id, userId } });
  if (!device) throw new NotFoundException('장비를 찾을 수 없습니다.');
  if (device.equipmentType !== 'irrigation') {
    throw new BadRequestException('관수 장비만 채널 매핑을 설정할 수 있습니다.');
  }
  // 유효한 switch 코드 검증
  const invalid = Object.values(mapping).filter(
    v => v !== '' && !AVAILABLE_SWITCH_CODES.includes(v),
  );
  if (invalid.length > 0) {
    throw new BadRequestException(`유효하지 않은 switch 코드: ${invalid.join(', ')}`);
  }
  device.channelMapping = mapping;
  return this.devicesRepo.save(device);
}
```

#### controlDevice() 수정 — 원격제어 연동 (MQTT 버전)

```typescript
async controlDevice(id: string, userId: string, commands: { code: string; value: any }[]) {
  const device = await this.devicesRepo.findOne({ where: { id, userId } });
  if (!device) throw new NotFoundException('장비를 찾을 수 없습니다.');
  if (!device.friendlyName) throw new BadRequestException('friendly_name이 설정되지 않았습니다.');

  const gateway = device.gatewayId
    ? await this.gatewayRepo.findOne({ where: { id: device.gatewayId } })
    : null;
  if (!gateway) throw new NotFoundException('게이트웨이를 찾을 수 없습니다.');

  // 관수 장비 원격제어 연동
  if (device.equipmentType === 'irrigation') {
    const mapping = this.getEffectiveMapping(device);
    const remoteSwitch = mapping['remote_control'];
    const remoteCmd = commands.find(c => c.code === remoteSwitch);

    if (remoteCmd) {
      if (remoteCmd.value === true) {
        // 원격제어 ON → fertilizer_b_contact ON
        const bContactSwitch = mapping['fertilizer_b_contact'];
        await this.mqttService.controlDevice(gateway.gatewayId, device.friendlyName, {
          [bContactSwitch]: true,
        });
      } else if (remoteCmd.value === false) {
        // 원격제어 OFF → fertilizer_b_contact OFF + 모든 관수 스위치 OFF
        const allSwitches = Object.values(mapping).filter(Boolean);
        const offPayload: Record<string, any> = {};
        for (const sw of allSwitches) offPayload[sw] = false;
        await this.mqttService.controlDevice(gateway.gatewayId, device.friendlyName, offPayload);
        return { success: true, deviceId: device.id, command: offPayload };
      }
    }
  }

  const mqttCommand = this.buildMqttCommand(commands);
  await this.mqttService.controlDevice(gateway.gatewayId, device.friendlyName, mqttCommand);
  this.logger.log(`장비 제어: ${device.name} → ${JSON.stringify(mqttCommand)}`);
  return { success: true, deviceId: device.id, command: mqttCommand };
}
```

> **MQTT 특이사항**: `buildMqttCommand()` 변환은 일반 명령에만 적용. 원격제어 연동 시 switch 코드를 직접 Zigbee2MQTT 페이로드로 사용.

### 3-3. devices.controller.ts

```typescript
@Patch(':id/channel-mapping')
updateChannelMapping(
  @Param('id') id: string,
  @CurrentUser() user: any,
  @Body() body: { mapping: Record<string, string> },
) {
  const effectiveUserId = this.getEffectiveUserId(user);
  return this.devicesService.updateChannelMapping(id, effectiveUserId, user.role, body.mapping);
}
```

> Roles 데코레이터 범위: 기존 `@Roles('admin', 'farm_admin')` 컨트롤러 레벨 적용으로 별도 설정 불필요.

### 3-4. irrigation-scheduler.service.ts

**변경 사항 5개**

1. **import 추가**
```typescript
import { DEFAULT_CHANNEL_MAPPING } from '../devices/channel-mapping.constants';
import { DevicesService } from '../devices/devices.service';
```

2. **생성자에 DevicesService 주입**
```typescript
constructor(
  // ... 기존 파라미터
  private readonly devicesService: DevicesService,
) {}
```

3. **ZONE_SWITCH_MAP 제거** + **ZONE_FUNCTION_KEY 추가**
```typescript
// 제거: const ZONE_SWITCH_MAP ...

// 추가
const ZONE_FUNCTION_KEY: Record<number, string> = {
  1: 'zone_1', 2: 'zone_2', 3: 'zone_3', 4: 'zone_4',
};
```

4. **startIrrigation() — 매핑 로드 + 원격제어 체크**
```typescript
private async startIrrigation(rule: AutomationRule, conditions: any) {
  // ... device 조회 (기존 동일)

  // 채널 매핑 로드
  const mapping = this.devicesService.getEffectiveMapping(device);

  // 원격제어 상태 체크 (switch_states 컬럼이 없으면 스킵)
  const remoteSwitch = mapping['remote_control'];
  if (device.switchStates && remoteSwitch in device.switchStates) {
    if (device.switchStates[remoteSwitch] === false) {
      this.logger.log(`스케줄 스킵: 원격제어(${remoteSwitch}) OFF — ${rule.name}`);
      return;
    }
  }

  // 타임라인 생성 (mapping 파라미터 추가)
  const timeline = this.buildTimeline(conditions, mapping);
  // ... 나머지 기존 동일
}
```

> **MQTT 원격제어 체크 방식**: Tuya 버전과 달리 실시간 API 조회 불가. 대신 `device.switchStates` JSONB 컬럼 사용 (미구현 시 스킵하고 진행).

5. **buildTimeline() — 동적 매핑 + mixer.enabled + 버그 수정**
```typescript
private buildTimeline(conditions: any, mapping: Record<string, string>): ScheduledAction[] {
  const actions: ScheduledAction[] = [];
  const zones = (conditions.zones || []).filter((z: any) => z.enabled);
  const fertilizer = conditions.fertilizer || { duration: 0, preStopWait: 0 };

  let offsetMs = 0;

  for (const zone of zones) {
    const zoneDuration = zone.duration * 60000;
    const waitTime = zone.waitTime * 60000;
    const fertDuration = fertilizer.duration * 60000;
    const fertPreStop = fertilizer.preStopWait * 60000;
    const fnKey = ZONE_FUNCTION_KEY[zone.zone];
    if (!fnKey) continue;
    const switchCode = mapping[fnKey];
    if (!switchCode) continue;

    // 구역 ON
    actions.push({ time: offsetMs, type: 'zone_on', switchCode, value: true, label: `${zone.name} ON` });

    // 교반기 ON (mixer.enabled 시에만)
    if (conditions.mixer?.enabled && mapping['mixer']) {
      actions.push({
        time: offsetMs, type: 'mixer_on',
        switchCode: mapping['mixer'], value: true, label: `교반기 ON (${zone.name})`,
      });
    }

    // 액비모터 ON/OFF (페어링 보장: fertStartOffset > 0 이어야 ON 발송)
    if (fertDuration > 0 && mapping['fertilizer_motor']) {
      const fertStartOffset = zoneDuration - fertDuration - fertPreStop;
      const fertEndOffset = zoneDuration - fertPreStop;
      if (fertStartOffset > 0 && fertEndOffset > 0) {  // ← 버그 수정: 두 조건 모두 충족 시에만
        actions.push({
          time: offsetMs + fertStartOffset, type: 'fertilizer_on',
          switchCode: mapping['fertilizer_motor'], value: true,
          label: `액비모터 ON (${zone.name})`,
        });
        actions.push({
          time: offsetMs + fertEndOffset, type: 'fertilizer_off',
          switchCode: mapping['fertilizer_motor'], value: false,
          label: `액비모터 OFF (${zone.name})`,
        });
      }
    }

    // 구역 OFF
    actions.push({ time: offsetMs + zoneDuration, type: 'zone_off', switchCode, value: false, label: `${zone.name} OFF` });

    // 교반기 OFF (mixer.enabled 시에만)
    if (conditions.mixer?.enabled && mapping['mixer']) {
      actions.push({
        time: offsetMs + zoneDuration, type: 'mixer_off',
        switchCode: mapping['mixer'], value: false, label: `교반기 OFF (${zone.name})`,
      });
    }

    offsetMs += zoneDuration + waitTime;
  }

  actions.sort((a, b) => a.time - b.time);
  return actions;
}
```

---

## 4. Frontend 변경

### 4-1. types/device.types.ts

```typescript
export interface ChannelMapping {
  remote_control:       string;
  zone_1:               string;
  zone_2:               string;
  zone_3:               string;
  zone_4:               string;
  fertilizer_b_contact: string;
  mixer:                string;
  fertilizer_motor:     string;
}

export const DEFAULT_CHANNEL_MAPPING: ChannelMapping = {
  remote_control:       'switch_1',
  zone_1:               'switch_2',
  zone_2:               'switch_3',
  zone_3:               'switch_4',
  zone_4:               'switch_5',
  fertilizer_b_contact: 'switch_6',
  mixer:                'switch_usb1',
  fertilizer_motor:     'switch_usb2',
};

export const FUNCTION_LABELS: Record<keyof ChannelMapping, string> = {
  remote_control:       '원격제어 ON/OFF',
  zone_1:               '1구역 관수',
  zone_2:               '2구역 관수',
  zone_3:               '3구역 관수',
  zone_4:               '4구역 관수',
  fertilizer_b_contact: '액비/교반기 B접점',
  mixer:                '교반기',
  fertilizer_motor:     '액비모터',
};

export const AVAILABLE_SWITCH_CODES = [
  'switch_1', 'switch_2', 'switch_3', 'switch_4',
  'switch_5', 'switch_6', 'switch_usb1', 'switch_usb2',
];

// Device 타입에 추가
export interface Device {
  // ... 기존 필드
  channelMapping?: ChannelMapping | null;
  switchStates?: Record<string, boolean>;  // 기존
}
```

### 4-2. stores/device.store.ts

```typescript
import { DEFAULT_CHANNEL_MAPPING, type ChannelMapping } from '../types/device.types'

// 추가 함수
function getEffectiveMapping(device: Device): ChannelMapping {
  return device.channelMapping
    ? { ...DEFAULT_CHANNEL_MAPPING, ...device.channelMapping }
    : { ...DEFAULT_CHANNEL_MAPPING }
}

async function updateChannelMapping(deviceId: string, mapping: ChannelMapping) {
  await api.patch(`/devices/${deviceId}/channel-mapping`, { mapping })
  const device = devices.value.find(d => d.id === deviceId)
  if (device) device.channelMapping = mapping
}

// return에 추가
return { ..., getEffectiveMapping, updateChannelMapping }
```

### 4-3. views/Devices.vue

**변경 1: IRRIGATION_SWITCH_LABELS → 동적 매핑 사용**

```typescript
import { DEFAULT_CHANNEL_MAPPING, FUNCTION_LABELS, AVAILABLE_SWITCH_CODES, type ChannelMapping } from '../types/device.types'

// 제거: const IRRIGATION_SWITCH_LABELS ...
// 대신 장비별 getMapping(device) 사용
function getMapping(device: Device): ChannelMapping {
  return deviceStore.getEffectiveMapping(device)
}
```

**변경 2: 관수 컨트롤 행**

```vue
<!-- 변경 전: switch_1 토글 "타이머 전원/B접점" -->
<!-- 변경 후: remote_control 토글 "원격제어 ON/OFF" -->
<div class="irrigation-row">
  <span class="irrigation-label">원격제어 ON/OFF</span>
  <div class="irrigation-toggle-area" :class="{ disabled: !device.online }">
    <label class="toggle-switch"
      @click.prevent="device.online && irrigationControlling === null &&
        handleIrrigationControl(device, getMapping(device)['remote_control'])">
      <input type="checkbox"
        :checked="device.switchStates?.[getMapping(device)['remote_control']] === true"
        :disabled="!device.online || irrigationControlling !== null" />
      <span class="slider"></span>
    </label>
  </div>
</div>

<!-- 변경 전: switch_usb1 토글 "교반기/B접점" (조작 가능) -->
<!-- 변경 후: fertilizer_b_contact 표시만 (조작 불가) -->
<div class="irrigation-row">
  <span class="irrigation-label">액비/교반기 B접점</span>
  <div class="irrigation-toggle-area disabled">
    <label class="toggle-switch">
      <input type="checkbox"
        :checked="device.switchStates?.[getMapping(device)['fertilizer_b_contact']] === true"
        disabled />
      <span class="slider"></span>
    </label>
  </div>
</div>
```

**변경 3: 채널 매핑 설정 패널 (admin/farm_admin 전용)**

```vue
<div v-if="authStore.isAdmin || authStore.isFarmAdmin" class="channel-mapping-panel">
  <label class="section-label">채널 매핑 설정</label>
  <div v-for="fnKey in MAPPING_FUNCTION_KEYS" :key="fnKey" class="mapping-row">
    <span class="mapping-label">{{ FUNCTION_LABELS[fnKey] }}</span>
    <select
      :value="getMapping(device)[fnKey]"
      @change="handleMappingChange(device, fnKey, ($event.target as HTMLSelectElement).value)"
    >
      <option v-for="sw in AVAILABLE_SWITCH_CODES" :key="sw"
        :value="sw"
        :class="{ 'option-duplicate': isDuplicate(device, fnKey, sw) }"
      >{{ sw }}</option>
    </select>
  </div>
  <div class="mapping-actions">
    <button @click="saveMappingForDevice(device)">저장</button>
    <button @click="resetMappingForDevice(device)">기본값 복원</button>
  </div>
</div>
```

**변경 4: 스위치 상태 모달 — IRRIGATION_SWITCH_LABELS 동적 변환**

```vue
<div v-for="(val, code) in irrigationStatusDevice.switchStates" :key="code">
  <span>{{ getMappingLabel(irrigationStatusDevice, code) }}</span>
  <span :class="val ? 'on' : 'off'">{{ val ? 'ON' : 'OFF' }}</span>
</div>
```

```typescript
function getMappingLabel(device: Device, code: string): string {
  const mapping = getMapping(device)
  const found = Object.entries(mapping).find(([, sw]) => sw === code)
  return found ? FUNCTION_LABELS[found[0]] || code : code
}
```

### 4-4. views/Groups.vue

Devices.vue와 동일한 패턴으로 변경:
- `getMapping(device)`, `handleIrrigationControl`, 채널 매핑 패널
- `authStore` 전체 객체 참조 (이미 수정됨)

### 4-5. types/automation.types.ts

`IrrigationConditions` 인터페이스에서 `timerSwitch` 제거:

```typescript
export interface IrrigationConditions {
  type: 'irrigation';
  startTime: string;
  zones: IrrigationZoneConfig[];
  mixer: { enabled: boolean };
  fertilizer: { duration: number; preStopWait: number };
  schedule: { days: number[]; repeat: boolean };
  // timerSwitch 제거
}
```

### 4-6. utils/automation-helpers.ts

```typescript
export function createDefaultIrrigationConditions(): IrrigationConditions {
  return {
    type: 'irrigation',
    startTime: '10:00',
    zones: [
      { zone: 1, name: '1구역', duration: 30, waitTime: 5, enabled: true },
      { zone: 2, name: '2구역', duration: 30, waitTime: 5, enabled: true },
      { zone: 3, name: '3구역', duration: 30, waitTime: 5, enabled: true },
      { zone: 4, name: '4구역', duration: 30, waitTime: 5, enabled: true },
      // zone 5 제거
    ],
    mixer: { enabled: false },
    fertilizer: { duration: 10, preStopWait: 5 },
    schedule: { days: [1, 2, 3, 4, 5, 6, 0], repeat: true },
    // timerSwitch 제거
  };
}
```

### 4-7. components/automation/StepIrrigationCondition.vue

smart-farm-platform의 구현과 동일하게 적용:

- `timerSwitch` 행 제거
- `channelMapping?: ChannelMapping`, `editableMapping?: boolean` props 추가
- `update:channelMapping` emit 추가
- zone 필터: `.filter(z => z.zone <= 4)`
- 각 zone/mixer/fertilizer_motor 행에 switch-hint 표시 (조회 전용)
- `editableMapping` true 시 드롭다운으로 switch 코드 선택 가능
- `applySwitch()`: 중복 배정 시 기존 보유자 초기화
- "관수 채널 설정" 섹션 (remote_control, fertilizer_b_contact) 추가
- "원격제어 채널 설정" 섹션 (remote_control, fertilizer_b_contact)

### 4-8. components/automation/RuleWizardModal.vue

smart-farm-platform의 구현과 동일하게 적용:

- `localChannelMapping` shallowRef로 즉시 UI 반영
- `canEditMapping`: `isAdmin || isFarmAdmin`
- `handleMappingUpdate()`: 즉시 로컬 반영 + API 저장
- StepIrrigationCondition에 `:channelMapping`, `:editableMapping`, `@update:channelMapping` 전달

---

## 5. MQTT 버전 특이사항

### 5-1. buildMqttCommand() 호환성

기존 `buildMqttCommand()`는 `switch_1 → state: ON/OFF` 로 변환한다.
채널 매핑에서 remote_control = switch_1인 경우, 이 변환이 적용된다.
**관수 스위치 (switch_2~switch_6, switch_usb1, switch_usb2)는 변환 없이 직접 전달** (line 165: `result[cmd.code] = cmd.value`).

```typescript
// Zigbee2MQTT 페이로드 예시 (irrigation-scheduler에서 직접 전달)
{ switch_2: true }   // 1구역 ON
{ switch_usb1: true } // 교반기 ON
```

### 5-2. 원격제어 체크 (scheduler)

MQTT 버전은 실시간 상태 조회가 불가하므로 `device.switchStates` JSONB 컬럼 기반 체크.
컬럼 미존재/값 없음 시 → 스케줄 진행 (smart-farm-platform의 `catch` 블록과 동일 동작).

> `switchStates` 컬럼은 현재 이 Feature 범위에서는 스케줄러 읽기 용도로만 사용.
> 실시간 업데이트는 향후 MQTT 상태 핸들러 개선 과제로 분리.

---

## 6. 구현 체크리스트

- [ ] migration-002-channel-mapping.sql — channel_mapping 컬럼
- [ ] channel-mapping.constants.ts — 신규 상수 파일
- [ ] device.entity.ts — channelMapping 필드
- [ ] devices.service.ts — getEffectiveMapping, updateChannelMapping, controlDevice 원격제어
- [ ] devices.controller.ts — PATCH :id/channel-mapping
- [ ] irrigation-scheduler.service.ts — ZONE_SWITCH_MAP 제거, 동적 매핑, mixer.enabled, 버그 수정
- [ ] types/device.types.ts — ChannelMapping, 상수
- [ ] types/automation.types.ts — timerSwitch 제거
- [ ] utils/automation-helpers.ts — zone 4개, timerSwitch 제거
- [ ] stores/device.store.ts — getEffectiveMapping, updateChannelMapping
- [ ] views/Devices.vue — 원격제어 토글, B접점 표시전용, 채널 매핑 패널
- [ ] views/Groups.vue — Devices.vue 동일
- [ ] components/automation/StepIrrigationCondition.vue — channelMapping, zone 4개, switch-hint
- [ ] components/automation/RuleWizardModal.vue — localChannelMapping, handleMappingUpdate

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 1.0 | 2026-03-30 | Initial design (smart-farm-platform 96% 기준 MQTT 적용) | Claude |
