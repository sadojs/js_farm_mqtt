---
template: design
version: 1.2
description: Zigbee 8/12채널 컨트롤러를 다중 유동팬/페어 개폐기로 활용 — Design
---

# zigbee-channel-actuator Design Document

> **Summary**: 1 zigbee 컨트롤러 = 1 parent + N children. 기존 device.id 기반 자동제어룰/publish 흐름 무변경, 매핑 계층만 확장
>
> **Project**: smart-farm-mqtt
> **Version**: 0.x
> **Author**: ohjeongseok
> **Date**: 2026-05-30
> **Status**: Draft
> **Planning Doc**: [zigbee-channel-actuator.plan.md](../../01-plan/features/zigbee-channel-actuator.plan.md)

---

## 1. Overview

### 1.1 Design Goals

1. **장치 작동 로직 무변경** — automation-runner, irrigation-scheduler, mqtt-bridge.handler의 동작 100% 보존
2. **단일 publish path** — child device → parent의 friendlyName + 자기 channel_code로 publish (이미 있는 `publishDeviceSwitch`만 확장)
3. **자동제어룰 호환** — 룰의 targetDeviceId는 child device.id를 가리킴. 룰 자체 변경 없음
4. **인라인 카드 일관성** — 관수/유동팬/개폐기 3가지 변종이 동일 컴포넌트 사용
5. **회귀 무사고** — 기존 onboard 관수/유동팬/개폐기 + 단일 zigbee fan/opener + zigbee 관수 모두 동작 그대로

### 1.2 Design Principles

- **child는 진짜 device row** — 자동제어룰의 1:1 FK 호환
- **parent는 관리 객체** — 자동제어 타겟 아님, 카드 헤더로만 표시
- **인터록 재사용** — 기존 publishDeviceSwitch의 페어 인터록 로직 그대로
- **이름 동기화** — 페어 대표 rename → child 추종 (기존 opener_group_name 패턴 재사용)
- **단계적 확정** — 5결정 확정사항 외 추가 가정 금지

---

## 2. Architecture

### 2.1 Component Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│ Frontend (GatewayEnvSettings.vue Zigbee 탭)                     │
│                                                                 │
│  ┌────────────────────────┐    ┌──────────────────────────┐    │
│  │ + Zigbee 스캔 모달     │───▶│ Actuator Type 선택 단계  │    │
│  │ (z2m permit_join)      │    │ (관수/유동팬/개폐기)     │    │
│  └────────────────────────┘    └──────────┬───────────────┘    │
│                                            │                    │
│                                            ▼                    │
│  ┌────────────────────────────────────────────────┐            │
│  │ ZigbeeControllerCard.vue (3가지 mode)           │            │
│  │  - irrigation: 기존 인라인 카드 그대로          │            │
│  │  - fan: 유동팬 N개 row + 개별 이름 ✏          │            │
│  │  - opener: N/2쌍 row + 페어 대표 이름 ✏       │            │
│  └────────────────────────────────────────────────┘            │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼ POST /gateway-env/{gw}/zigbee-controller
┌─────────────────────────────────────────────────────────────────┐
│ Backend                                                         │
│                                                                 │
│  ┌────────────────────────────────────────────────┐            │
│  │ GatewayEnvService.createZigbeeController(...)   │            │
│  │  - mode='irrigation' → 기존 zigbee device 1개   │            │
│  │  - mode='fan'        → parent + N children      │            │
│  │  - mode='opener'     → parent + N/2 페어        │            │
│  └────────────────────────────────────────────────┘            │
│                                                                 │
│  publishDeviceSwitch(device, gateway, switchCode, value):       │
│   ├ device.parent_device_id 있으면:                            │
│   │   parent = await deviceRepo.findOne(parent_device_id)      │
│   │   friendlyName = parent.friendly_name                      │
│   │   payloadKey = translateSwitchKeyForZ2m(channel_code,      │
│   │                                          parent.zigbeeModel)│
│   ├ 인터록: opener_open/close + ON 명령이면 paired 먼저 OFF    │
│   └ z2m publish (기존 path)                                     │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Data Flow — 유동팬 8ch 등록

```
운영자 → "+ Zigbee 스캔" 클릭
   ↓
[Backend] permit_join 활성 (기존 endpoint 재사용)
   ↓
[z2m] TS0601_switch_8 컨트롤러 페어링 완료 → bridge/devices broadcast
   ↓
[Frontend] 발견 토스트 + "사용 방식 선택" 버튼
   ↓
운영자: 유동팬 선택 → 미리보기 → 등록
   ↓
[Frontend] POST /gateway-env/{gw}/zigbee-controller
  body: {
    ieee: '0xa4c1...',
    friendlyName: '0xa4c1...',
    zigbeeModel: 'TS0601_switch_8',
    channelCount: 8,
    mode: 'fan',
  }
   ↓
[Backend] createZigbeeController (transaction)
   1. parent INSERT
   2. for i in 1..8:
        child INSERT (channel_code: switch_i, name: '{gw.name}_유동팬{i}')
   3. activity_logs INSERT
   ↓
응답 → 카드 expand 상태로 표시
```

### 2.3 Dependencies

| Component | Depends On | Purpose |
|-----------|-----------|---------|
| ZigbeeControllerService.createController | DataSource, deviceRepo, activityLog | 트랜잭션 N row 일괄 INSERT |
| DevicesService.publishDeviceSwitch | deviceRepo (parent lookup) | child → parent friendlyName 변환 |
| ZigbeeControllerCard.vue | gatewayEnvApi, deviceApi (child rename, channel toggle) | UI |
| Wizard StepDeviceByIntent | deviceStore + group filter | child device 정상 후보 노출 |

---

## 3. Database Migration

### 3.1 Migration 022 — `device_parent_channel.sql`

```sql
-- 022_device_parent_channel.sql

-- 1. devices 테이블 신규 컬럼
ALTER TABLE devices
  ADD COLUMN parent_device_id uuid REFERENCES devices(id) ON DELETE CASCADE,
  ADD COLUMN channel_code varchar(32);

-- 2. parent 빠른 조회 인덱스
CREATE INDEX idx_devices_parent_device_id ON devices(parent_device_id);

-- 3. controller에만 unique IEEE (child는 parent와 동일 IEEE 공유)
DROP INDEX IF EXISTS idx_devices_zigbee_ieee;  -- 기존 인덱스가 있으면 제거
CREATE UNIQUE INDEX idx_devices_zigbee_ieee_root
  ON devices(zigbee_ieee)
  WHERE parent_device_id IS NULL AND zigbee_ieee IS NOT NULL;

-- 4. (선택) controller equipment_type 추가 — TypeScript enum과 정렬
COMMENT ON COLUMN devices.parent_device_id IS 'Zigbee 다채널 컨트롤러의 child일 때 parent device.id';
COMMENT ON COLUMN devices.channel_code IS 'child의 z2m payload 키 (switch_1 ~ switch_12)';
```

**Rollback**:
```sql
DROP INDEX IF EXISTS idx_devices_zigbee_ieee_root;
DROP INDEX IF EXISTS idx_devices_parent_device_id;
ALTER TABLE devices DROP COLUMN parent_device_id, DROP COLUMN channel_code;
-- 기존 unique IEEE 인덱스 복구 (필요 시)
```

### 3.2 Device Entity 확장

```typescript
@Entity('devices')
export class Device {
  // ... 기존 필드 ...

  @Column({ name: 'parent_device_id', type: 'uuid', nullable: true })
  parentDeviceId?: string | null;

  @Column({ name: 'channel_code', type: 'varchar', length: 32, nullable: true })
  channelCode?: string | null;
}
```

기존 `equipment_type` enum에 `'controller'` 추가:
```typescript
equipmentType: 'fan' | 'irrigation' | 'opener_open' | 'opener_close' | 'mixer' | 'controller' | 'other'
```

---

## 4. Backend Design

### 4.1 Service — `GatewayEnvService.createZigbeeController()`

```typescript
async createZigbeeController(
  gatewayId: string,
  dto: {
    ieee: string;
    friendlyName: string;
    zigbeeModel: string;
    channelCount: 8 | 12;
    mode: 'irrigation' | 'fan' | 'opener';
  },
  userId: string,
  role: string,
): Promise<{ controller: Device; children: Device[] }> {
  const gw = await this.assertGatewayOwner(gatewayId, userId, role);

  // 중복 IEEE 검사 (root만)
  const dup = await this.deviceRepo.findOne({
    where: { zigbeeIeee: dto.ieee, parentDeviceId: IsNull() } as any,
  });
  if (dup) throw new ConflictException(`이미 등록된 컨트롤러: ${dto.ieee}`);

  // gateway 이름 기준 — 기본 이름 prefix
  const gwName = (gw.name && gw.name.trim()) || gw.gatewayId;

  return this.dataSource.transaction(async (mgr) => {
    if (dto.mode === 'irrigation') {
      // 기존 zigbee 관수 device 1개 (변화 없음)
      const dev = mgr.create(Device, {
        userId: gw.userId, gatewayId, houseId: gw.houseId ?? undefined,
        name: `${gwName}_관수`,
        category: 'irrigation', deviceType: 'actuator',
        equipmentType: 'irrigation', source: 'zigbee',
        zigbeeIeee: dto.ieee, friendlyName: dto.friendlyName,
        zigbeeModel: dto.zigbeeModel,
        channelMapping: getDefaultMappingByCount(dto.channelCount, 'zigbee'),
      });
      const saved = await mgr.save(dev);
      return { controller: saved, children: [] };
    }

    // parent (controller) — 자동제어 타겟 아님
    const parent = await mgr.save(mgr.create(Device, {
      userId: gw.userId, gatewayId, houseId: gw.houseId ?? undefined,
      name: dto.mode === 'fan' ? `${gwName}_유동팬컨트롤러` : `${gwName}_개폐기컨트롤러`,
      category: dto.mode === 'fan' ? 'fan' : 'opener',
      deviceType: 'actuator',
      equipmentType: 'controller',
      source: 'zigbee',
      zigbeeIeee: dto.ieee,
      friendlyName: dto.friendlyName,
      zigbeeModel: dto.zigbeeModel,
    }));

    const children: Device[] = [];

    if (dto.mode === 'fan') {
      // N개 유동팬 child — 각 채널이 1 fan
      for (let i = 1; i <= dto.channelCount; i++) {
        const child = await mgr.save(mgr.create(Device, {
          userId: gw.userId, gatewayId, houseId: gw.houseId ?? undefined,
          parentDeviceId: parent.id,
          name: `${gwName}_유동팬${i}`,
          category: 'fan', deviceType: 'actuator',
          equipmentType: 'fan', source: 'zigbee',
          zigbeeIeee: dto.ieee,         // parent와 동일 (DB 인덱스는 root에만 unique)
          friendlyName: dto.friendlyName,
          zigbeeModel: dto.zigbeeModel,
          channelCode: `switch_${i}`,
        }));
        children.push(child);
      }
    } else {
      // 개폐기 페어: 인접 채널 (1+2, 3+4, ...)
      const pairCount = dto.channelCount / 2;
      for (let p = 1; p <= pairCount; p++) {
        const openCh = p * 2 - 1;
        const closeCh = p * 2;
        const groupName = `${gwName}_개폐기${p}`;
        const openDev = await mgr.save(mgr.create(Device, {
          userId: gw.userId, gatewayId, houseId: gw.houseId ?? undefined,
          parentDeviceId: parent.id,
          name: `${groupName} 열림`,
          openerGroupName: groupName,
          category: 'opener', deviceType: 'actuator',
          equipmentType: 'opener_open', source: 'zigbee',
          zigbeeIeee: dto.ieee, friendlyName: dto.friendlyName,
          zigbeeModel: dto.zigbeeModel,
          channelCode: `switch_${openCh}`,
        }));
        const closeDev = await mgr.save(mgr.create(Device, {
          userId: gw.userId, gatewayId, houseId: gw.houseId ?? undefined,
          parentDeviceId: parent.id,
          name: `${groupName} 닫힘`,
          openerGroupName: groupName,
          category: 'opener', deviceType: 'actuator',
          equipmentType: 'opener_close', source: 'zigbee',
          zigbeeIeee: dto.ieee, friendlyName: dto.friendlyName,
          zigbeeModel: dto.zigbeeModel,
          channelCode: `switch_${closeCh}`,
        }));
        // 페어 양방향
        openDev.pairedDeviceId = closeDev.id;
        closeDev.pairedDeviceId = openDev.id;
        await mgr.save([openDev, closeDev]);
        children.push(openDev, closeDev);
      }
    }

    // activity log
    await this.activityLog.log({
      userId, userName: '...',
      action: 'device.controller.add',
      targetType: 'device', targetId: parent.id, targetName: parent.name,
      details: { mode: dto.mode, channelCount: dto.channelCount, childrenCount: children.length, ieee: dto.ieee },
    });

    return { controller: parent, children };
  });
}
```

### 4.2 publishDeviceSwitch 확장 (작동 로직 무변경 핵심)

```typescript
async publishDeviceSwitch(device, gateway, switchCode, value): Promise<void> {
  if (device.source === 'onboard') {
    // 기존 onboard path (변경 없음)
    return this.publishOnboardRelay(gateway.gatewayId, gateway.id, switchCode, value);
  }

  // zigbee path — child device 분기 추가
  let publishFriendlyName = device.friendlyName;
  let publishKey = switchCode;
  let publishModel = (device as any).zigbeeModel;

  if (device.parentDeviceId) {
    // child device — parent의 friendlyName 사용 + 자기 channel_code를 키로
    const parent = await this.devicesRepo.findOne({ where: { id: device.parentDeviceId } });
    if (!parent) throw new BadRequestException('parent controller 미발견');
    publishFriendlyName = parent.friendlyName!;
    publishKey = (device as any).channelCode ?? switchCode;
    publishModel = (parent as any).zigbeeModel ?? publishModel;
  }

  if (!publishFriendlyName) {
    throw new BadRequestException(`device ${device.id}: friendlyName 미설정`);
  }

  const z2mKey = this.translateSwitchKeyForZ2m(publishKey, publishModel);
  await this.mqttService.controlDevice(gateway.gatewayId, publishFriendlyName, { [z2mKey]: value });
}
```

**기존 publishOnboardRelay, 자동제어 publishDeviceSwitch 호출자(scheduler, automation-runner)는 변경 없음**.

### 4.3 페어 인터록 (기존 로직 그대로 재사용)

기존 `devices.service.ts:controlDevice`의 페어 인터록 분기:
- `equipmentType === 'opener_*'` + `isOnCmd` + `pairedDeviceId` 존재
- paired device → 반대편 OFF + 1초 대기 → 목표 ON

→ child opener도 동일하게 `paired_device_id`가 있으므로 **추가 코드 없이 자동 적용**.

테스트 ON/OFF 버튼은 `controlDevice` 호출 경로를 그대로 사용하므로 인터록 자동 적용.

### 4.4 이름 동기화 (기존 fix 재사용)

`updateByUser`의 opener 이름 동기화 (이미 구현됨):
- name이 `"{X} 열림|닫힘|열기|닫기"` 패턴이면 X 추출 → 본인 + 페어의 `opener_group_name = X`
- vent_group 슬롯(onboard)도 동시 갱신

→ zigbee 페어 개폐기에서도 페어 대표 이름 변경 시 자동 추종 (코드 그대로).

### 4.5 신규 / 변경 API

| Method | Path | Body | 용도 |
|--------|------|------|------|
| POST | `/gateway-env/:gatewayId/zigbee-controller` | `{ ieee, friendlyName, zigbeeModel, channelCount, mode }` | 컨트롤러 + child 일괄 등록 |
| DELETE | `/devices/:id` (기존) | - | parent 삭제 시 CASCADE로 child 자동 삭제 — 룰 의존성 검사 강화 |
| PATCH | `/devices/:id/name` (기존) | `{ name }` | child 이름 변경 (유동팬 개별 / 개폐기 페어 대표) |
| PATCH | `/devices/:id/channel-enabled` (기존) | `{ key, enabled }` | 유동팬 채널별 + 개폐기 페어 단위 토글 |
| GET | `/gateway-env/:gw/all-devices` (기존) | - | 응답에 parent + children 모두 포함 |

### 4.6 자동제어룰 위저드 device 후보 추출 변경

[StepDeviceByIntent.vue](frontend/src/components/automation/v2/StepDeviceByIntent.vue)와 [StepIrrigationDevice.vue](frontend/src/components/automation/v2/StepIrrigationDevice.vue):

| Intent | 후보 추출 로직 |
|--------|--------------|
| **fan** | `equipmentType === 'fan'` (변경 없음) → **child fan도 자동 노출** (child가 entity row이므로) |
| **opener** | `equipmentType === 'opener_open'` (변경 없음) → **child opener도 자동 노출** |
| **irrigation** | `equipmentType === 'irrigation'` (변경 없음) |

**추가 필터**: `equipment_type !== 'controller'` (parent는 위저드에서 안 보임). 사실상 자연 필터 (`controller`는 어떤 intent에도 매칭 안 됨).

**핵심**: 위저드 코드는 **변경 없음**. child가 정상 device로 인식되므로 기존 필터가 자동 적용.

---

## 5. Frontend Design

### 5.1 Zigbee 스캔 모달 확장 — Actuator Type 선택 단계

[GatewayEnvSettings.vue](frontend/src/views/GatewayEnvSettings.vue) 기존 + Zigbee 스캔 모달 흐름:

```
[기존] permit_join → device 발견 → 단순 등록
   ↓
[변경] permit_join → device 발견 → "사용 방식 선택" Step
   ↓
   ┌──────────────────────────────────────────┐
   │ 🔍 발견된 컨트롤러                       │
   │                                          │
   │ ● TS0601_switch_8 (8채널)                │
   │   IEEE 0xa4c1...                         │
   │                                          │
   │ 어떻게 사용하시겠어요?                   │
   │ ┌────────┐ ┌────────┐ ┌────────┐        │
   │ │ 💧 관수 │ │ 🌬 유동팬│ │ 🚪 개폐기│   │
   │ │ 1대    │ │ 8개    │ │ 4쌍    │        │
   │ └────────┘ └────────┘ └────────┘        │
   │                                          │
   │ 게이트웨이: hk-house                     │
   │ 미리보기 이름:                           │
   │   hk-house_유동팬1 ~ hk-house_유동팬8    │
   │                                          │
   │              [취소] [등록]               │
   └──────────────────────────────────────────┘
```

단일 채널 device(예: TS0001 1ch 환풍기)는 기존 등록 흐름 그대로 (type 선택 단계 skip).

### 5.2 `ZigbeeControllerCard.vue` (신규 컴포넌트, 3가지 mode)

기존 인라인 카드를 추상화:

```vue
<template>
  <div class="device-card" :class="{ 'card-enabled': anyActive }">
    <div class="card-header" @click="toggleExpand">
      <span class="device-name">{{ controller.name }}</span>
      <span class="zb-meta-chip">{{ channelCount }}채널 · {{ summaryByMode }}</span>
      ...
    </div>
    <div v-if="expanded" class="card-body">
      <!-- mode 분기 -->
      <FanChildrenGrid v-if="mode==='fan'" :parent="controller" :children="children" />
      <OpenerPairsGrid v-else-if="mode==='opener'" :parent="controller" :children="children" />
      <IrrigationChannelGrid v-else :device="controller" />
    </div>
  </div>
</template>
```

#### 5.2.1 FanChildrenGrid

```
1  hk-house_유동팬1 ✏    CH [switch_1▼]  ON OFF  ●
2  hk-house_유동팬2 ✏    CH [switch_2▼]  ON OFF  ●
...
```

- ✏ 클릭 → inline 이름 input → enter/blur로 저장 (`PATCH /devices/:id/name`)
- CH dropdown → channel_code 변경 (PATCH `/devices/:id/channel-code` 신규? — 또는 channelMapping 패턴 재사용)
- ON / OFF → `controlDevice(child.id, [{code: child.channel_code, value: true/false}])`
- ● 활성 토글 → `PATCH /devices/:id/channel-enabled` (기존 endpoint 재사용)

#### 5.2.2 OpenerPairsGrid

```
▼ hk-house_개폐기1 ✏                          ●
  ├ 열림   CH [switch_1▼]  ON OFF
  └ 닫힘   CH [switch_2▼]  ON OFF
▼ hk-house_개폐기2 ✏ ...                       ●
```

- 페어 대표 ✏ → 페어 대표 이름 변경 → backend updateByUser가 자동으로 양쪽 child 이름 추종 (기존 fix)
- 열림/닫힘 라벨 고정 (✏ 없음)
- ● 토글 → 페어 양쪽 disabledChannels에 동시 추가/제거 (페어 단위)
- ON/OFF → `controlDevice` 호출. 기존 인터록 자동 적용 (반대편 ON이면 OFF + 1초 대기)

### 5.3 channel_code 변경 dropdown

dropdown 옵션: parent의 channelCount에 따라 `switch_1 ~ switch_N`. 다른 child가 이미 쓰는 코드는 옵션에서 제외.

저장은 새 PATCH endpoint:
```
PATCH /devices/:id/channel-code  body: { channelCode: 'switch_3' }
```

또는 기존 `channel-mapping` endpoint 재활용 안 함 (parent에는 channelMapping 없어도 됨 — child가 직접 channel_code 보유).

### 5.4 자동제어룰 위저드 (변경 없음)

기존 코드가 child device를 정상 후보로 자동 노출. 추가 작업 없음.

---

## 6. Backward Compatibility / 작동 로직 무변경 보장

| 영역 | 기존 동작 | child도 동일 동작 |
|------|----------|-----------------|
| 자동제어룰 평가 (automation-runner) | rule.actions.targetDeviceId로 device 조회 후 controlDevice 호출 | child device.id를 룰이 가리킴 → 동일 path |
| 페어 인터록 | opener_open/close + paired_device_id로 처리 | child도 paired_device_id 보유 → 동일 path |
| publishDeviceSwitch | source=onboard / zigbee 분기 | zigbee 분기 안에서 child면 parent friendlyName 사용 (1행 추가) |
| 룰 sticky ON (relayActivePhase) | child device.deviceSettings에 저장 | 동일 (별도 처리 불필요) |
| mqtt-bridge.handler GPIO 상태 sync | zigbee는 GPIO 안 씀 (영향 없음) | 영향 없음 |
| 관수 device 매핑 | 기존 그대로 | mode='irrigation'는 child 안 만듦 — 완전 호환 |

**핵심**: 기존 코드의 device 분기 로직은 `equipment_type`을 기준으로 함. child도 `equipment_type='fan'` 또는 `'opener_open/close'`이므로 자동 호환.

---

## 7. Test Strategy — 전체 회귀 + 신규 시나리오

### 7.1 신규 기능 E2E (smart-farm-test SKILL.md §15)

#### Scenario MC-1: 유동팬 8ch 등록 + 자동제어 룰
1. 환경설정 → Zigbee 스캔 → TS0601_switch_8 발견 → "유동팬" 선택
2. 등록 → 8 child device 생성 확인 (DB)
3. 카드 expand → 8개 row + 기본 이름 `hk-house_유동팬1~8`
4. 유동팬1 이름을 "환기팬" 으로 변경 → DB 반영 확인
5. 자동제어룰 신규 생성 → 유동팬 intent → 후보에 8개 모두 노출
6. 룰 활성화 → publish 시 `state_l1` 발행 (Pi journal 확인)

#### Scenario MC-2: 개폐기 8ch 등록 + 인터록
1. 등록 → 4 페어 (8 child) 생성 + paired_device_id 양방향 확인
2. 페어 대표 이름 "천창1" 변경 → `천창1 열림`, `천창1 닫힘` 자동 추종
3. 카드에서 페어1 열림 ON 테스트 → BCM 토글 + 인터록 확인 (닫힘이 ON이었으면 먼저 OFF + 1초 대기)
4. 자동제어룰 → 개폐기 intent → 4 페어 대표만 노출
5. 룰 동작 시 publish path 확인

#### Scenario MC-3: 12ch 컨트롤러 (둘 다)
1. 12ch + 유동팬 → 12 children
2. 12ch + 개폐기 → 6 페어

#### Scenario MC-4: 채널 활성/비활성 토글
1. 유동팬 child 일부 비활성 → 자동제어 위저드 후보에서 제외 확인
2. 개폐기 페어 토글 → 양쪽 child 동시 비활성 확인

#### Scenario MC-5: 컨트롤러 삭제 + 룰 의존성
1. 룰이 사용 중인 child가 포함된 컨트롤러 삭제 시도 → 차단
2. 룰 미사용 시 삭제 → child 모두 cascade 삭제

#### Scenario MC-6: 채널 코드 변경
1. switch_1 → switch_5로 변경 → publish 시 새 코드 사용
2. 다른 child가 쓰는 코드 선택 시 차단

### 7.2 회귀 테스트 매트릭스 — 기존 기능 무사고

| # | 영역 | 시나리오 | 기대 결과 | 어디서 검증 |
|---|------|---------|----------|-----------|
| R-1 | onboard 관수 | 1번 밸브 ON 룰 21:00 실행 | BCM 18 토글 + switchStates sync | gpio-agent journal + DB |
| R-2 | onboard 유동팬 | 습도 80%+5 룰 가동 | BCM 17 사이클 + sticky ON | DB device_settings |
| R-3 | onboard 페어 개폐기 | 온도 hysteresis on → open / off → close | 페어 자동 라우팅 + 인터록 | gpio-agent BCM 24/25 |
| R-4 | zigbee 관수 (8ch) | HK_지그비릴레이 8ch + 룰 | state_l1~8 publish + 채널 매핑 보존 | z2m set 토픽 |
| R-5 | zigbee 단일 유동팬 (1ch) | TS0001 fan 직접 등록 + 룰 | state publish 정상 | z2m 토픽 |
| R-6 | 자동제어룰 위저드 zone 필터 | 비활성 zone은 valve 후보에서 제외 | 활성만 노출 | UI |
| R-7 | IrrigationStatusModal | 비활성 채널은 모달 row에 미노출 | mappingKeys 필터 적용 | UI |
| R-8 | 환경설정 zigbee 관수 인라인 카드 | 채널 토글 + dropdown | disabledChannels 갱신, 매핑 보존 | UI + DB |
| R-9 | 우적센서 | rain/rain_intensity 도착 | sensor_data 정상 저장 | DB |
| R-10 | 관수 스케줄러 timeline | zone 매핑 없으면 skip | timeline에 미포함 | scheduler log |
| R-11 | mqtt-bridge GPIO 상태 sync | onboard irrigation device 매칭 | switchStates relay_X 갱신 | DB |
| R-12 | 게이트웨이 권한 | farm_admin은 자기 소유만 | admin은 전체 | API |
| R-13 | 작업 내역 관수 시각 표시 | 시작 → 종료 chip `"21:30 → 21:50"` | 두 시각 명시 | UI |

### 7.3 검증 방법

| 단계 | 도구 |
|------|------|
| 단위 테스트 | jest (backend service 테스트) |
| API 검증 | curl + 응답 JSON 검사 |
| MQTT 검증 | mosquitto_sub로 publish 토픽/payload 캡처 |
| Pi GPIO 검증 | SSH journal `BCM N → HIGH/LOW` 로그 확인 |
| DB 검증 | psql 쿼리 |
| Frontend | vue-tsc + 브라우저 + Playwright(가능 시) |

### 7.4 자동화 회귀 테스트 (선택)

기존 `tests/e2e/` 디렉토리에 추가:
- `tests/e2e/zigbee-controller-fan.ts` — MC-1 자동화
- `tests/e2e/zigbee-controller-opener.ts` — MC-2 자동화
- `tests/e2e/regression-r1-r13.ts` — R-1~R-13 자동화

---

## 8. Folder Structure

```
backend/src/modules/
├── gateway-env/
│   ├── gateway-env.service.ts (createZigbeeController 신규)
│   └── gateway-env.controller.ts (POST :gw/zigbee-controller 신규)
├── devices/
│   ├── devices.service.ts (publishDeviceSwitch child 분기, channel-code endpoint)
│   ├── devices.controller.ts (PATCH :id/channel-code 신규)
│   └── entities/device.entity.ts (parentDeviceId + channelCode 컬럼 추가)
└── (기타 영향 없음)

backend/database/migrations/
└── 022_device_parent_channel.sql  (신규)

frontend/src/views/
└── GatewayEnvSettings.vue (스캔 모달 type 선택 단계 + 카드 컴포넌트 추출)

frontend/src/components/gateway/
└── ZigbeeControllerCard.vue       (신규 — 3가지 mode)
    ├── FanChildrenGrid.vue        (sub)
    ├── OpenerPairsGrid.vue        (sub)
    └── IrrigationChannelGrid.vue  (기존 인라인 카드 추출)
```

---

## 9. Risks / Edge Cases (Plan §5 보완)

| Edge Case | 처리 |
|-----------|------|
| 같은 채널 코드 두 child에 매핑 시도 | 트랜잭션 안에서 충돌 검사 + ConflictException |
| 페어 대표 토글로 한쪽만 disabled 상태 (data 불일치) | createController에서 항상 두 child 동시 처리 + UI 강제 |
| parent 삭제 시 룰이 child 참조 중 | dependency 검사 (`device.deletePreCheck`) — 기존 패턴 재사용 |
| migration 022 적용 시 기존 zigbee 관수 device 영향 | parent_device_id IS NULL이므로 unique 인덱스 호환. data 무변경 |
| TS0001 같은 1ch device 새로 추가 | 기존 zigbee 등록 흐름 그대로 (type 선택 단계 skip) — channelCount=1 인식 |
| 비-Tuya 다채널 (Sonoff 4ch 등) | 1차 out-of-scope (Plan §2.2). zigbee_model 화이트리스트로 필터 |

---

## 10. Implementation Order (Do Phase)

1. **DB 마이그레이션 022** + Device entity 확장
2. **Backend ZigbeeControllerService.createZigbeeController()** + DTO
3. **Backend publishDeviceSwitch 확장** — child 분기 (1줄 추가)
4. **Backend PATCH /devices/:id/channel-code** endpoint
5. **단위 테스트** — createController (3 modes), publishDeviceSwitch (child branch)
6. **Frontend ZigbeeControllerCard.vue** + 3 sub grids
7. **Frontend GatewayEnvSettings.vue** — 스캔 모달 type 선택 단계
8. **신규 E2E 시나리오 MC-1 ~ MC-6** 검증
9. **회귀 매트릭스 R-1 ~ R-13** 검증
10. **DEVICE_CONTROL_LOGIC.md §다중채널 actuator** 섹션
11. **smart-farm-test SKILL.md §15** 시나리오 추가

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-05-30 | 초안 — 5결정 확정 반영 (인접 페어, 삭제 후 재등록, 6쌍, 채널별 독립 토글, 이름 패턴), 회귀 매트릭스 13건 포함 | ohjeongseok |
