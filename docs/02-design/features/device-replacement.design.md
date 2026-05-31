---
template: design
version: 1.2
description: device-replacement Hot Swap 설계 — 호환성 매트릭스 + 트랜잭션 흐름 + UI
---

# device-replacement Design Document

> **Summary**: 동일 기종 장치 교체 시 `devices.id`를 유지한 채 zigbee 식별자만 swap → 모든 룰/매핑/페어/구역 할당 자동 보존
>
> **Project**: smart-farm-mqtt
> **Version**: 0.x
> **Author**: ohjeongseok
> **Date**: 2026-05-30
> **Status**: Draft
> **Planning Doc**: [device-replacement.plan.md](../../01-plan/features/device-replacement.plan.md)

---

## 1. Overview

### 1.1 Design Goals

1. **Zero downtime**: 운영 중 룰 비활성화 / 재설정 불필요
2. **Idempotent**: 같은 IEEE로 두 번 호출해도 안전 (멱등)
3. **Atomic**: TypeORM 트랜잭션으로 부분 실패 시 완전 rollback
4. **Auditability**: activity_logs 100% 기록 (oldIeee, newIeee, preserved 개수)
5. **Safety-first**: 진행 중 관수 timeline 또는 룰 사이클 active 시 명시 confirm 강제

### 1.2 Design Principles

- **ID 보존 원칙**: `devices.id`(UUID PK)를 유지 → 모든 FK 참조 자동 보존
- **호환성 엄격 정책**: zigbee_model 정확 일치 + equipment_type 일치 + 채널 수 일치
- **트랜잭션 경계 명확화**: DB write는 1개 트랜잭션, MQTT publish는 트랜잭션 외부 (best-effort)
- **단일 진입점**: `replaceDeviceTx(oldDeviceId, newIeee, newFriendlyName)` helper로 통합
- **UI 일관성**: onboard, zigbee 구분 없이 카드에서 동일한 "🔄 교체" 액션 노출 (onboard는 별도 안내)

---

## 2. Architecture

### 2.1 Component Diagram

```
┌──────────────────┐   1. preview      ┌─────────────────────┐
│ DeviceReplace    │ ─────────────────▶│ DevicesController    │
│ Modal (Frontend) │ ◀─────────────────│ getReplacePreview()  │
└──────────────────┘   counts          └──────────┬──────────┘
        │                                          │
        │ 2. permit_join                           ▼
        ▼                                ┌─────────────────────┐
┌──────────────────┐                     │ DevicesService       │
│ MQTT Broker      │◀────────────────────│ scanCompatible()     │
│ z2m bridge       │                     └──────────┬──────────┘
└──────┬───────────┘                                │
       │  bridge/devices                            ▼
       ▼                                  ┌──────────────────────┐
┌──────────────────┐  3. select          │ DevicesService        │
│ MqttBridgeHandler│ ─────────────────▶  │ replaceDeviceTx()     │
│ handleBridgeDevs │  newIeee/newFriendly│  (transaction)        │
└──────────────────┘                     └──────────┬───────────┘
                                                    │
                  ┌─────────────────────────────────┼───────────────────────┐
                  ▼                                 ▼                       ▼
        ┌──────────────────┐            ┌────────────────────┐    ┌───────────────────┐
        │ devices table     │            │ z2m bridge/request │    │ activity_logs      │
        │ UPDATE row by id  │            │ /device/remove old │    │ INSERT replace log │
        └──────────────────┘            └────────────────────┘    └───────────────────┘
```

### 2.2 Data Flow

```
운영자 → "🔄 교체" 클릭
   ↓
[GET] /api/devices/:id/replace-preview
   → { rulesCount, mappingKeys, pairedDeviceName, hasRunningTimeline, compatibility }
   ↓
운영자 → 영향 확인 + "스캔 시작"
   ↓
[POST] /api/gateways/:id/permit-join { enable: true }
   ↓
30초 동안 z2m bridge/devices 토픽 watch (WebSocket으로 전달)
   ↓
호환 후보 device 목록 (zigbee_model 일치 + 등록 안 됨)
   ↓
운영자 → 후보 선택 + (timeline 있을 시) "안전 중단 후 교체" confirm
   ↓
[POST] /api/devices/:id/replace { newIeee, newFriendlyName }
   ↓
DevicesService.replaceDeviceTx() — 트랜잭션
  ├─ 1. assertCompatible() 재검증 (race condition 방지)
  ├─ 2. assertSafe() — 진행 중 timeline / running rule 검사
  ├─ 3. 페어인 경우 페어 device도 함께 트랜잭션에 포함
  ├─ 4. devices UPDATE { zigbee_ieee, friendly_name, last_seen, online, zigbee_model? }
  ├─ 5. activity_logs INSERT
  ↓ (트랜잭션 commit)
   ↓
[best-effort] z2m bridge/request/device/remove (옛 IEEE)
   ↓
[POST] /api/gateways/:id/permit-join { enable: false }
   ↓
응답 → Frontend: 카드 새로고침 + 토스트
```

### 2.3 Dependencies

| Component | Depends On | Purpose |
|-----------|-----------|---------|
| DevicesService.replaceDeviceTx | DataSource (TypeORM transaction), MqttService (z2m remove), ActivityLogService | DB 트랜잭션 + MQTT cleanup + 로그 |
| getReplacePreview | AutomationRulesRepo, DevicesRepo, IrrigationScheduler.getActiveByDevice | 영향 카운트 + 진행 중 timeline 확인 |
| Frontend Modal | gatewayApi.permitJoin, deviceApi.replacePreview/replace, useWebSocket(z2m:devices) | 스캔 + UI |

---

## 3. Compatibility Matrix (FR-02)

### 3.1 호환 기준 (모든 항목 일치 필수)

| 항목 | 검증 방법 | 불일치 시 처리 |
|------|----------|--------------|
| `equipment_type` | 정확 일치 (`fan`, `irrigation`, `opener_open`, `opener_close`, `other`) | 후보에서 제외 |
| `zigbee_model` | 대소문자 무시 정확 일치 (예: `TS0601_switch_8`) | 후보에서 제외 |
| 채널 수 (irrigation only) | `detectChannelCount(channelMapping values, zigbeeModel)` 동일 | 후보에서 제외 |
| z2m `interview_completed` | true | 후보에서 제외 (페어링 미완료) |
| 이미 등록됨 | `devices.zigbee_ieee = newIeee` 존재 시 | 후보에서 제외 (다른 device로 사용 중) |

### 3.2 모델별 페어 처리 정책

| equipment_type | 페어 처리 | 비고 |
|----------------|----------|------|
| `fan`, `irrigation`, `other` | 단일 device 교체 | |
| `opener_open` / `opener_close` | **페어 동시 교체 강제** — 양쪽 모두 호환 후보 선택 필수 | 인터록 일관성 |
| `sensor` (deviceType) | 단일 device 교체 (paired 없음) | |

### 3.3 채널 수 호환 매트릭스 (irrigation)

| 옛 device 채널 | 새 device 채널 | 허용 |
|--------------|--------------|:----:|
| 8CH onboard | 8CH onboard | ✅ |
| 8CH zigbee (switch_7/8) | 8CH zigbee (switch_7/8) | ✅ |
| 8CH onboard | 8CH zigbee | ❌ (source 변경은 별도 마이그레이션) |
| 12CH | 12CH | ✅ |
| 8CH | 12CH | ❌ (out-of-scope per Plan §2.2) |

---

## 4. Backend Design

### 4.1 신규 API

#### `GET /api/devices/:id/replace-preview`

**역할**: 교체 전 영향 분석. 호환 device 후보 검색하지 않고 메타정보만 반환.

**Response**:
```json
{
  "device": {
    "id": "uuid",
    "name": "HK_온습도",
    "equipmentType": "other",
    "zigbeeModel": "SNZB-02P",
    "zigbeeIeee": "0xf044...",
    "friendlyName": "0xf044...",
    "source": "zigbee",
    "channelCount": null
  },
  "impact": {
    "rulesCount": 3,
    "ruleNames": ["고온시 환풍기", "관수 룰", "..."],
    "mappingKeys": [],
    "pairedDeviceId": null,
    "pairedDeviceName": null,
    "hasRunningTimeline": false,
    "houseName": "hk-house"
  },
  "compatibility": {
    "requireModel": "SNZB-02P",
    "requireEquipmentType": "other",
    "requireChannelCount": null,
    "requirePair": false
  }
}
```

#### `POST /api/devices/:id/replace`

**역할**: 실제 교체 실행. 트랜잭션 + 감사 로그.

**Body**:
```json
{
  "newIeee": "0xa4c1...",
  "newFriendlyName": "0xa4c1...",
  "newZigbeeModel": "SNZB-02P",   // 호환 재검증용
  "pairedNewIeee": "0xb55d..." ,  // opener 페어인 경우만
  "pairedNewFriendlyName": "0xb55d...",
  "forceStopRunningTimeline": false  // FR-09 — true일 때만 진행 중 timeline 강제 중단
}
```

**Response**:
```json
{
  "success": true,
  "deviceId": "uuid",
  "oldIeee": "0xf044...",
  "newIeee": "0xa4c1...",
  "pairedDeviceId": null,
  "preserved": {
    "rules": 3,
    "mappingKeys": 0,
    "houseId": "uuid"
  }
}
```

**Error Responses**:
| Code | Reason | Body |
|------|--------|------|
| 400 | 호환성 미달 (`zigbee_model` 불일치 등) | `{ error: "incompatible", detail: "..." }` |
| 400 | 새 IEEE가 이미 등록된 다른 device | `{ error: "duplicate_ieee", existingDeviceId: "..." }` |
| 409 | 진행 중 timeline 있고 `forceStopRunningTimeline=false` | `{ error: "running_timeline", deviceName: "..." }` |
| 409 | 페어인데 `pairedNewIeee` 누락 | `{ error: "pair_required", pairedDeviceName: "..." }` |
| 500 | 트랜잭션 실패 | `{ error: "transaction_failed", message: "..." }` |

### 4.2 신규 Service 메서드

#### `DevicesService.replaceDeviceTx()`

```typescript
async replaceDeviceTx(args: {
  oldDeviceId: string;
  newIeee: string;
  newFriendlyName: string;
  newZigbeeModel?: string;
  pairedNewIeee?: string;
  pairedNewFriendlyName?: string;
  forceStopRunningTimeline?: boolean;
  user: { id: string; name: string };
}): Promise<ReplaceResult> {
  return this.dataSource.transaction(async (mgr) => {
    // 1. 옛 device 조회 + 잠금 (FOR UPDATE)
    const oldDevice = await mgr.findOne(Device, {
      where: { id: args.oldDeviceId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!oldDevice) throw new NotFoundException();

    // 2. 호환성 재검증 (race condition 방지)
    this.assertCompatible(oldDevice, {
      zigbeeModel: args.newZigbeeModel,
      // equipment_type / channel count는 옛 device 기준 동일성 가정
    });

    // 3. 새 IEEE 중복 검사
    const dup = await mgr.findOne(Device, { where: { zigbeeIeee: args.newIeee } });
    if (dup && dup.id !== args.oldDeviceId) {
      throw new ConflictException({ error: 'duplicate_ieee', existingDeviceId: dup.id });
    }

    // 4. 진행 중 timeline 검사
    if (this.irrigationScheduler.getActiveByDevice(oldDevice.friendlyName)) {
      if (!args.forceStopRunningTimeline) {
        throw new ConflictException({ error: 'running_timeline', deviceName: oldDevice.name });
      }
      await this.irrigationScheduler.stopByDevice(oldDevice.friendlyName);
    }

    // 5. 페어 처리 (opener)
    let pairedDevice: Device | null = null;
    if (oldDevice.pairedDeviceId) {
      if (!args.pairedNewIeee) {
        throw new ConflictException({ error: 'pair_required', pairedDeviceName: '...' });
      }
      pairedDevice = await mgr.findOne(Device, {
        where: { id: oldDevice.pairedDeviceId },
        lock: { mode: 'pessimistic_write' },
      });
      // 페어 새 IEEE 중복 검사
      const pairDup = await mgr.findOne(Device, { where: { zigbeeIeee: args.pairedNewIeee } });
      if (pairDup && pairDup.id !== pairedDevice?.id) {
        throw new ConflictException({ error: 'duplicate_ieee', existingDeviceId: pairDup.id });
      }
    }

    // 6. UPDATE — 같은 row, 식별자만 swap
    const oldIeee = oldDevice.zigbeeIeee;
    const oldFriendly = oldDevice.friendlyName;
    oldDevice.zigbeeIeee = args.newIeee;
    oldDevice.friendlyName = args.newFriendlyName;
    if (args.newZigbeeModel) oldDevice.zigbeeModel = args.newZigbeeModel;
    oldDevice.lastSeen = new Date();
    oldDevice.online = true;
    await mgr.save(oldDevice);

    let pairedOldIeee: string | undefined;
    if (pairedDevice && args.pairedNewIeee) {
      pairedOldIeee = pairedDevice.zigbeeIeee;
      pairedDevice.zigbeeIeee = args.pairedNewIeee;
      pairedDevice.friendlyName = args.pairedNewFriendlyName!;
      if (args.newZigbeeModel) pairedDevice.zigbeeModel = args.newZigbeeModel;
      pairedDevice.lastSeen = new Date();
      pairedDevice.online = true;
      await mgr.save(pairedDevice);
    }

    // 7. 영향 받은 자원 카운트 (감사 로그용)
    const rulesCount = await mgr.count(AutomationRule, {
      where: [
        { actions: Raw(alias => `${alias} @> '{"targetDeviceId":"${oldDevice.id}"}'::jsonb`) },
        // targetDeviceIds 배열 검색 별도
      ],
    });

    // 8. activity_logs
    await this.activityLog.log({
      userId: args.user.id,
      userName: args.user.name,
      action: 'device.replace',
      targetType: 'device',
      targetId: oldDevice.id,
      targetName: oldDevice.name,
      details: {
        oldIeee, newIeee: args.newIeee,
        oldFriendlyName: oldFriendly, newFriendlyName: args.newFriendlyName,
        pairedOldIeee, pairedNewIeee: args.pairedNewIeee,
        preserved: { rules: rulesCount, mappingKeys: Object.keys(oldDevice.channelMapping ?? {}).length },
      },
    });

    return {
      success: true,
      deviceId: oldDevice.id,
      oldIeee, newIeee: args.newIeee,
      pairedDeviceId: pairedDevice?.id ?? null,
      preserved: { rules: rulesCount, mappingKeys: 0, houseId: oldDevice.houseId },
    };
  });
  // 트랜잭션 commit 후 best-effort:
  // - z2m bridge/request/device/remove (옛 IEEE)
  // - z2m bridge/request/device/remove (페어 옛 IEEE)
}
```

#### `DevicesService.assertCompatible()` (private)

```typescript
private assertCompatible(
  oldDevice: Device,
  candidate: { zigbeeModel?: string; equipmentType?: string }
): void {
  if (candidate.zigbeeModel && oldDevice.zigbeeModel &&
      candidate.zigbeeModel.toLowerCase() !== oldDevice.zigbeeModel.toLowerCase()) {
    throw new BadRequestException({
      error: 'incompatible',
      detail: `모델 불일치: 기존 ${oldDevice.zigbeeModel} vs 새 ${candidate.zigbeeModel}`,
    });
  }
  if (candidate.equipmentType && candidate.equipmentType !== oldDevice.equipmentType) {
    throw new BadRequestException({
      error: 'incompatible',
      detail: `장치 유형 불일치: ${oldDevice.equipmentType} vs ${candidate.equipmentType}`,
    });
  }
  // irrigation: 채널 수 검증 (channelMapping 보존 위해 동일해야)
  if (oldDevice.equipmentType === 'irrigation') {
    // 위저드 detectChannelCount 동일 호출
  }
}
```

### 4.3 z2m 정리 (best-effort, 트랜잭션 외부)

```typescript
// 트랜잭션 commit 후
try {
  await this.mqttService.removeZigbeeDevice(gatewayId, oldIeee);
  if (pairedOldIeee) await this.mqttService.removeZigbeeDevice(gatewayId, pairedOldIeee);
} catch (err) {
  // 실패해도 DB 상태는 commit 됨 — 운영자가 수동 z2m UI에서 정리 가능
  this.logger.warn(`z2m old device cleanup 실패: ${err.message}`);
}
```

신규 MQTT 메서드 `removeZigbeeDevice` — 토픽 `farm/{gw}/z2m/bridge/request/device/remove` payload `{"id": "0xf044..."}`.

### 4.4 페어 트랜잭션 SQL 시나리오

```sql
-- 트랜잭션 시작
BEGIN;

-- 옛 device 1 잠금
SELECT * FROM devices WHERE id = $oldOpenId FOR UPDATE;
-- 옛 device 2 (페어) 잠금
SELECT * FROM devices WHERE id = $oldCloseId FOR UPDATE;

-- 중복 IEEE 검사
SELECT id FROM devices WHERE zigbee_ieee IN ($newOpenIeee, $newCloseIeee);

-- swap
UPDATE devices SET zigbee_ieee=$newOpenIeee, friendly_name=$newOpenFriendly, online=true, last_seen=now()
WHERE id=$oldOpenId;
UPDATE devices SET zigbee_ieee=$newCloseIeee, friendly_name=$newCloseFriendly, online=true, last_seen=now()
WHERE id=$oldCloseId;

INSERT INTO activity_logs (...) VALUES (...);

COMMIT;
```

---

## 5. Frontend Design

### 5.1 진입 위치

| 페이지 | 위치 | 표시 조건 |
|--------|------|----------|
| 구역관리 (`Groups.vue`) | 장치 카드 우측 케밥 메뉴 "🔄 교체" | zigbee device (onboard는 안내 모달) |
| 환경설정 (`GatewayEnvSettings.vue`) | Zigbee 탭 device row 액션 영역 "🔄 교체" | 모든 zigbee device |

### 5.2 DeviceReplaceModal.vue 와이어프레임

```
┌────────────────────────────────────────────────┐
│  🔄 장치 교체 — HK_온습도               ✕     │
├────────────────────────────────────────────────┤
│  ⚠️ 다음 자원이 자동으로 보존됩니다:           │
│  • 자동제어룰 3개                              │
│  • 채널 매핑 0개 (해당 없음)                   │
│  • 페어링 없음                                 │
│  • 구역 할당: hk-house                         │
│                                                │
│  호환 조건:                                    │
│  • 모델: SNZB-02P (정확 일치)                  │
│  • 유형: 측정기                                │
│                                                │
│  [현재 상태]                                   │
│  IEEE: 0xf044d3fffefa1c92                      │
│  이름: HK_온습도                               │
│                                                │
│  [후보 스캔]  ← 클릭 시 z2m permit_join 30s   │
│                                                │
│  ⏳ 스캔 중... 새 장치를 페어링 모드로 두세요  │
│                                                │
│  [발견된 호환 장치]                            │
│  ☑ 0xa4c1380b8b5e9df7 (SNZB-02P) ✓ 호환      │
│  ☐ 0xb55d4c... (SNZB-02P) ✓ 호환             │
│                                                │
│                          [취소] [교체 실행]    │
└────────────────────────────────────────────────┘
```

### 5.3 페어 개폐기 모달 (확장)

```
┌────────────────────────────────────────────────┐
│  🔄 장치 페어 교체 — 천창 그룹 1               │
├────────────────────────────────────────────────┤
│  ⚠️ 페어 개폐기 (열기+닫기) 동시 교체 필요     │
│                                                │
│  열기 장치:                                    │
│  현재: 0xa4c138... (TS0011)                    │
│  새것: [후보 dropdown ▼]                       │
│                                                │
│  닫기 장치:                                    │
│  현재: 0xa4c139... (TS0011)                    │
│  새것: [후보 dropdown ▼]                       │
│                                                │
│  보존: 룰 2개, 페어링 인터록, 타이머 설정      │
└────────────────────────────────────────────────┘
```

### 5.4 진행 중 timeline 경고

```
┌────────────────────────────────────────────────┐
│  ⚠️ 진행 중인 관수가 있습니다                  │
│                                                │
│  현재 "매일 저녁 관수" 룰이 실행 중입니다.     │
│  교체하려면 진행 중인 관수를 안전 중단해야      │
│  합니다.                                       │
│                                                │
│  [☐] 진행 중 관수를 중단하고 교체 진행         │
│                                                │
│                          [취소] [교체 실행]    │
└────────────────────────────────────────────────┘
```

### 5.5 useDeviceReplace 컴포저블

```typescript
export function useDeviceReplace(deviceId: Ref<string>) {
  const preview = ref<ReplacePreview | null>(null)
  const candidates = ref<CompatibleDevice[]>([])
  const scanning = ref(false)
  const error = ref<string | null>(null)

  async function loadPreview() { /* GET preview */ }
  async function startScan(gatewayId: string, durationMs = 30000) {
    scanning.value = true
    await gatewayApi.permitJoin(gatewayId, true)
    // useWebSocket → z2m:devices 이벤트 listen
    setTimeout(() => stopScan(gatewayId), durationMs)
  }
  async function executeReplace(args: ReplaceArgs) { /* POST replace */ }

  return { preview, candidates, scanning, error, loadPreview, startScan, executeReplace }
}
```

### 5.6 WebSocket 이벤트 추가

기존 `gateway:status` 패턴을 따라 신규 이벤트:

| Event | Payload | 사용처 |
|-------|---------|--------|
| `z2m:device-added` | `{ gatewayId, ieee, friendlyName, model, equipmentType }` | DeviceReplaceModal 후보 목록 실시간 갱신 |

backend `MqttBridgeHandler.handleBridgeDevices`가 새 device 발견 시 emit.

---

## 6. Convention / Folder Structure

```
backend/src/modules/devices/
├── devices.service.ts
│   └── + replaceDeviceTx(), assertCompatible(), private compatibility helpers
├── devices.controller.ts
│   └── + GET /:id/replace-preview, POST /:id/replace
└── dto/
    ├── replace-device.dto.ts          (신규)
    └── replace-preview.dto.ts          (신규)

backend/src/modules/mqtt/
└── mqtt.service.ts
    └── + removeZigbeeDevice(gatewayId, ieee)

frontend/src/components/devices/
└── DeviceReplaceModal.vue              (신규)

frontend/src/composables/
└── useDeviceReplace.ts                 (신규)

frontend/src/api/
└── device.api.ts
    └── + replacePreview(), replace()
```

---

## 7. Test Strategy

### 7.1 단위 테스트 (backend)

| Suite | 검증 |
|-------|------|
| `assertCompatible` | model/equipmentType/channelCount 일치/불일치 5케이스 |
| `replaceDeviceTx (zigbee 온습도)` | UPDATE 정상 + 활동로그 + 채널매핑 미변경 + houseId 유지 |
| `replaceDeviceTx (페어 개폐기)` | 양쪽 동시 swap + paired_device_id 양방향 유지 |
| `replaceDeviceTx (중복 IEEE)` | ConflictException + rollback |
| `replaceDeviceTx (진행 중 timeline + forceStop=false)` | ConflictException, timeline 미중단 |
| `replaceDeviceTx (진행 중 timeline + forceStop=true)` | stopByDevice 호출 + swap 진행 |
| `replaceDeviceTx (트랜잭션 실패 시뮬)` | DB 상태 변화 0건 |

### 7.2 E2E (smart-farm-test SKILL.md §14 신규)

**시나리오 R-1**: zigbee 온습도 교체
1. mtest 농장의 HK_온습도 device → 새 0xa4c1... 페어링
2. 교체 모달에서 미리보기 → 룰 3개 보존 표시
3. 교체 실행 → 응답 success + preserved.rules=3
4. 자동제어룰에서 sensor_device_id 변경 없음 확인
5. 새 IEEE에서 측정 데이터 정상 수신 확인 (sensor_data에 동일 device_id로 row)

**시나리오 R-2**: 8CH zigbee 관수 컨트롤러 교체
1. HK_지그비릴레이 (TS0601_switch_8) → 새 동일 모델 페어링
2. channel_mapping 보존 확인 (mixer=switch_7, fertilizer_motor=switch_8 그대로)
3. disabledChannels 보존 확인
4. 자동제어룰 targetDeviceId 변경 없음 확인

**시나리오 R-3**: 페어 개폐기 동시 교체
1. 천창 그룹 1 (open + close 페어) → 새 페어 IEEE 2개 페어링
2. 한쪽만 선택 시 422 차단 검증
3. 양쪽 동시 교체 → paired_device_id 양방향 유지

**시나리오 R-4**: 진행 중 관수 안전성
1. 21:30 관수 룰 실행 중 (timeline active)
2. 교체 시도 → 409 + forceStop 옵션 표시
3. forceStop=true로 재시도 → stopByDevice 호출 + swap

**시나리오 R-5**: 호환성 차단
1. SNZB-02P 옛 device 교체 시 TS0201을 선택 → 400 incompatible

---

## 8. Risks / Edge Cases (Plan §5 보완)

| Edge Case | 처리 |
|-----------|------|
| z2m이 새 device를 페어링 직후 자동으로 옛 IEEE로 분리하지 않음 | 트랜잭션 후 best-effort remove 호출 + 실패 시 운영자 안내 |
| 운영자가 동시에 다른 device를 페어링 모드로 추가 | 호환 조건 매칭으로 자동 필터링 (irrelevant device는 후보 목록에서 제외) |
| 페어 개폐기 한쪽 페어링만 성공 | 30초 timeout 후 후보 목록에 한쪽만 표시 → 운영자가 두 번째 시도 |
| 옛 device의 zigbee_model이 NULL | 호환 검증 skip (admin 강제 허용 옵션 별도 검토) |
| 진행 중 cancel — 운영자가 모달을 도중 닫음 | permit_join이 비활성으로 자동 되돌림 (cleanup) |
| 동일 IEEE로 connector 끊긴 후 재페어링 (자기 자신과 교체) | 멱등 — newIeee == oldIeee이면 no-op + 로그만 기록 |

---

## 9. Migration / Backward Compatibility

- **DB 스키마 변경 없음** — 기존 `devices` 컬럼 + `activity_logs.action` enum 확장만
- **기존 API 영향 없음** — 신규 endpoint 추가만
- **기존 룰 데이터 영향 없음** — device.id 보존이라 마이그레이션 불필요

---

## 10. Implementation Order (Do Phase 가이드)

1. **Backend (1-2일)**
   - `replace-device.dto.ts`, `replace-preview.dto.ts`
   - `DevicesService.assertCompatible()`, `replaceDeviceTx()`
   - `DevicesController` 신규 2개 endpoint
   - `MqttService.removeZigbeeDevice()`
   - 단위 테스트 7개 작성

2. **Frontend (1-2일)**
   - `DeviceReplaceModal.vue` (5.2 와이어프레임 기반)
   - `useDeviceReplace.ts` 컴포저블
   - `device.api.ts`에 endpoint 메서드 추가
   - Groups.vue / GatewayEnvSettings.vue 카드 케밥에 "🔄 교체" 추가
   - useWebSocket에 `z2m:device-added` 핸들러

3. **MqttBridgeHandler** — 신규 device 발견 시 `z2m:device-added` 이벤트 broadcast

4. **E2E** — smart-farm-test SKILL.md §14 5개 시나리오

5. **문서**
   - DEVICE_CONTROL_LOGIC.md §교체 정책 섹션
   - smart-farm-test SKILL.md §14

---

## 11. Additional Considerations (zigbee-channel-actuator 의존 + JSONB + Realtime)

본 섹션은 `zigbee-channel-actuator` 기능과 함께 사용될 때 발생하는 3개 추가 케이스를 처리한다.

### 11.1 Controller(Parent) 교체 — Children 자동 보존 + IEEE 동시 swap

**컨텍스트**: `zigbee-channel-actuator`로 생성된 다채널 zigbee 컨트롤러는
- 1개 parent (`equipment_type='controller'`, `parent_device_id=NULL`) — 자동제어 타겟 아님
- N개 children (`parent_device_id=parent.id`, `equipment_type ∈ {fan, opener_open, opener_close}`, `channel_code='switch_N'`) — 자동제어 타겟

**제약**: parent와 children은 **같은 zigbee_ieee** 공유 (migration 022 `idx_devices_zigbee_ieee_root_per_gateway`는 root only). z2m에서는 1개 device로 인식된다.

**교체 정책**:
| 항목 | 처리 |
|------|------|
| 진입점 | parent device card에서만 "🔄 교체" — children에는 비노출 (단일 child만 교체 불가) |
| 호환성 | parent의 `zigbee_model` + 채널 수 + `mode`(parent.category=`fan`/`opener`) 일치 |
| Children 보존 | parent.id, child.id 모두 UUID 유지 — 모든 자동제어룰, paired_device_id, openerGroupName, channel_code, disabledChannels 자동 보존 |
| IEEE swap 범위 | parent + 모든 children의 `zigbee_ieee`, `friendly_name`을 트랜잭션 내에서 일괄 swap (children도 같은 IEEE 공유) |
| children 룰 영향 | 각 child는 device.id 그대로 → automation_rules.target_device_id 보존 |

**replaceDeviceTx 확장**:
```typescript
// Section 4.2 replaceDeviceTx 트랜잭션 6단계에서 controller 분기 추가
if (oldDevice.equipmentType === 'controller') {
  // 모든 children도 같은 IEEE/friendlyName 동시 swap
  const children = await mgr.find(Device, {
    where: { parentDeviceId: oldDevice.id },
    lock: { mode: 'pessimistic_write' },
  });
  for (const child of children) {
    child.zigbeeIeee = args.newIeee;
    child.friendlyName = args.newFriendlyName;
    if (args.newZigbeeModel) child.zigbeeModel = args.newZigbeeModel;
    child.lastSeen = new Date();
    child.online = true;
  }
  await mgr.save(children);
}
```

**호환성 재정의 (assertCompatible 확장)**:
```typescript
if (oldDevice.equipmentType === 'controller') {
  // parent.category ('fan' | 'opener') + children 채널 수 동일성
  const oldChildCount = await this.devicesRepo.count({ where: { parentDeviceId: oldDevice.id } });
  // 새 컨트롤러 모델 정보로 채널 수 추론 — TS0601_switch_8/12
  const newChannelCount = this.detectControllerChannelCount(args.newZigbeeModel);
  if (newChannelCount !== oldChildCount) {
    throw new BadRequestException({ error: 'incompatible', detail: `채널 수 불일치 (기존 ${oldChildCount}ch vs 새 ${newChannelCount}ch)` });
  }
}
```

**UI**:
- Controller card "🔄 교체" 클릭 시 preview는 `impact.controllerChildren=N`, `impact.childRules=K` 도 표시
- DeviceReplaceModal 안내 문구: "이 컨트롤러를 교체하면 {N}개 채널의 모든 룰/매핑이 그대로 보존됩니다"

### 11.2 deviceSettings JSONB 필드 보존 (rainOverrideDisabled, disabledChannels, switchStates 등)

**보존 대상 (자동)**: `devices.device_settings` JSONB는 컬럼이 UPDATE 대상 아님 → 그대로 유지
| 키 | 보존 이유 |
|------|----------|
| `disabledChannels` (string[]) | 채널 활성/비활성 상태 (irrigation + controller) |
| `rainOverrideDisabled` (boolean) | 우적센서 false-positive 방지 토글 |
| `switchStates` (Record) | 마지막 ON/OFF 상태 캐시 |
| `switchState` (boolean) | 단일 채널 디바이스 마지막 상태 |
| `operationTime` / `standbyTime` | 펄스 사이클 사용자 설정 |
| 임의 future 키 | JSONB이므로 마이그레이션 불필요 자동 보존 |

**테스트 시나리오 R-6** (§7.2 추가):
1. zigbee 관수 컨트롤러 `disabledChannels=['zone_3', 'zone_4']` 상태에서 교체
2. 교체 후 `disabledChannels=['zone_3', 'zone_4']` 그대로 유지 검증
3. 우적센서 `rainOverrideDisabled=true` 상태에서 교체 → 교체 후에도 true 유지

**테스트 시나리오 R-7**: 컨트롤러 교체 후 children의 disabledChannels (parent device_settings에 저장됨) 동일 유지

### 11.3 WebSocket Broadcast — `device:replaced` 이벤트

**기존**: §5.6에서 `z2m:device-added` (스캔 후보 발견 이벤트)만 정의됨

**추가**: 교체 완료 후 frontend 즉시 새로고침 위해 신규 이벤트:

| Event | Payload | 사용처 |
|-------|---------|--------|
| `device:replaced` | `{ deviceId, oldIeee, newIeee, gatewayId, preservedRules, pairedDeviceId? }` | 모든 device card / wizard / dashboard 자동 갱신 |
| `device:replaced` (controller) | `{ deviceId, oldIeee, newIeee, gatewayId, childrenIds: string[], preservedRules }` | controller card + children rows 일괄 갱신 |

**backend emit**:
```typescript
// replaceDeviceTx 트랜잭션 commit 후 (best-effort)
this.eventsGateway.emit('device:replaced', {
  deviceId: oldDevice.id,
  oldIeee, newIeee: args.newIeee,
  gatewayId: oldDevice.gatewayId,
  preservedRules: rulesCount,
  pairedDeviceId: pairedDevice?.id ?? null,
  childrenIds: oldDevice.equipmentType === 'controller'
    ? childrenIdsList
    : undefined,
});
```

**frontend handler** (`useWebSocket.ts`):
```typescript
socket.on('device:replaced', (data) => {
  // 1. 영향 받은 device row(들) 새로고침
  deviceStore.refreshById(data.deviceId);
  if (data.pairedDeviceId) deviceStore.refreshById(data.pairedDeviceId);
  if (data.childrenIds) data.childrenIds.forEach(id => deviceStore.refreshById(id));
  // 2. 알림 표시
  notif.info('장치 교체 완료', `${data.preservedRules}개 룰이 보존되었습니다`);
});
```

### 11.4 신규 테스트 시나리오 추가 (§7.2 확장)

| ID | 시나리오 | 검증 포인트 |
|----|----------|------------|
| R-6 | deviceSettings 보존 (disabledChannels) | 교체 전후 `disabledChannels`, `rainOverrideDisabled`, `operationTime` 동일 |
| R-7 | Controller (8ch fan) 교체 | parent + 8 children 모두 IEEE swap, children device.id 유지, 자동제어룰 보존 |
| R-8 | Controller (8ch opener 4쌍) 교체 | parent + 8 children IEEE swap, paired_device_id 양방향 유지, openerGroupName 유지 |
| R-9 | Controller 채널 수 불일치 차단 | 8ch parent → 12ch model 선택 시 400 incompatible |
| R-10 | `device:replaced` WebSocket broadcast | 교체 후 5초 내 frontend dashboard/wizard 자동 갱신 |

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-05-30 | 초안 작성 (Plan FR-01~12 매핑 + 호환성 매트릭스 + 트랜잭션 코드 + UI 와이어프레임 + 테스트) | ohjeongseok |
| 0.2 | 2026-05-31 | §11 추가 — zigbee-channel-actuator parent/child 처리, deviceSettings JSONB 보존, `device:replaced` WebSocket broadcast, R-6~R-10 테스트 시나리오 | ohjeongseok |
