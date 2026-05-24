# Design: rpi-auto-device-provision

**Feature ID**: `rpi-auto-device-provision`
**작성일**: 2026-05-24
**기반 문서**: [01-plan/features/rpi-auto-device-provision.plan.md](../../01-plan/features/rpi-auto-device-provision.plan.md)
**상태**: Design

---

## 1. 아키텍처 결정

### 자동 등록 시점

| 옵션 | 설명 | 장점 | 단점 |
|---|---|---|---|
| A. onboard seed 직후 자동 trigger | `getOnboardDevices()` lazy seed가 12개 INSERT 후 즉시 devices 12개 INSERT | 첫 GET 한 번으로 양산 완성 | onboard lazy seed에 강한 결합 |
| **B. 명시적 endpoint `POST /api/devices/provision`** | `provisionFromOnboard(gatewayUuid)` 호출 | 명시적, 사용자 컨트롤 | UI에서 한 번 더 클릭 |
| C. register-tunnel-key 응답 직후 | 첫 부팅 시 자동 등록 | 가장 자동화 | machine_id 부재 시 실패 위험 |

### 결정: **A (lazy seed에 통합) + B (명시적 endpoint 보조)**

- 기본: `GET /api/gateway-env/:uuid/onboard` (lazy seed) → 12개 onboard INSERT → 즉시 devices 12개 INSERT
- 옵션: `POST /api/devices/provision-from-onboard?gatewayId=:uuid` 명시 트리거 (idempotent — 이미 있으면 skip)

근거: 양산 워크플로우에서 GatewayManagement 페이지를 보기 위해 자연스럽게 onboard 조회가 발생 → 그때 자동 provision 완성. 동시에 명시적 재트리거 endpoint로 controllability 확보.

---

## 2. 표준 매핑 규칙

`gateway_onboard_devices.slot_type` → `devices.{category, device_type, equipment_type}` 매핑:

| slot_type | category | device_type | equipment_type | paired_device | 비고 |
|---|---|---|---|---|---|
| `fan` | `fan` | `actuator` | `fan` | none | fan_1~4 |
| `irrigation_zone` | `irrigation` | `actuator` | `irrigation` | none | zone_1~4 |
| `mixer` | `irrigation` | `actuator` | `mixer` | none | 교반기 |
| `fertilizer_motor` | `irrigation` | `actuator` | `fertilizer_motor` | none | 액비 |
| `fertilizer_contact` | `irrigation` | `actuator` | `fertilizer_contact` | none | 액비 B접점 |
| `remote_control` | `control` | `actuator` | `remote_control` | none | 원격제어 |
| `opener_open` | `opener` | `actuator` | `opener_open` | `opener_close 의 device.id` | 인터록 자동 |
| `opener_close` | `opener` | `actuator` | `opener_close` | `opener_open 의 device.id` | 인터록 자동 |
| `vent_group` | `opener` | `group` | `vent_group` | none | hardware actuator 아니므로 device로 등록 안 함 (group 컨테이너) |
| `irrigation_group` | `irrigation` | `group` | `irrigation_group` | none | 동일 — device 등록 안 함 |

**provision 대상**: `slot_type ∈ {fan, irrigation_zone, mixer, fertilizer_motor, fertilizer_contact, remote_control, opener_open, opener_close}` 만. group은 제외.

기본 DEFAULT_SLOTS 12개 중 12개 모두 device 가능 (group 없음 — 옛 운영 PI는 group 있을 수 있으니 vent_group/irrigation_group은 skip 규칙).

---

## 3. 구현 항목

### 3.1 매핑 상수 (Backend)

`backend/src/modules/gateway-env/onboard-to-device-mapping.ts` (신규):
```typescript
import type { SlotType } from './entities/gateway-onboard-device.entity';

export interface DeviceTemplate {
  category: string;
  deviceType: string;
  equipmentType: string;
  provisionable: boolean;  // false면 device로 등록 안 함
}

export const ONBOARD_TO_DEVICE: Record<SlotType, DeviceTemplate> = {
  fan: { category: 'fan', deviceType: 'actuator', equipmentType: 'fan', provisionable: true },
  irrigation_zone: { category: 'irrigation', deviceType: 'actuator', equipmentType: 'irrigation', provisionable: true },
  mixer: { category: 'irrigation', deviceType: 'actuator', equipmentType: 'mixer', provisionable: true },
  fertilizer_motor: { category: 'irrigation', deviceType: 'actuator', equipmentType: 'fertilizer_motor', provisionable: true },
  fertilizer_contact: { category: 'irrigation', deviceType: 'actuator', equipmentType: 'fertilizer_contact', provisionable: true },
  remote_control: { category: 'control', deviceType: 'actuator', equipmentType: 'remote_control', provisionable: true },
  opener_open: { category: 'opener', deviceType: 'actuator', equipmentType: 'opener_open', provisionable: true },
  opener_close: { category: 'opener', deviceType: 'actuator', equipmentType: 'opener_close', provisionable: true },
  vent_group: { category: 'opener', deviceType: 'group', equipmentType: 'vent_group', provisionable: false },
  irrigation_group: { category: 'irrigation', deviceType: 'group', equipmentType: 'irrigation_group', provisionable: false },
};
```

### 3.2 GatewayEnvService에 provision 메서드 추가

```typescript
async provisionDevicesFromOnboard(gatewayUuid: string): Promise<{ created: number; skipped: number; pairs: number }> {
  const onboardSlots = await this.onboardRepo.find({
    where: { gatewayId: gatewayUuid }, order: { sortOrder: 'ASC' }
  });
  if (onboardSlots.length === 0) {
    return { created: 0, skipped: 0, pairs: 0 };
  }

  // 기존 device 조회 (idempotent — friendly_name == slot_key)
  const existing = await this.devicesRepo.find({ where: { gatewayId: gatewayUuid } });
  const existingKeys = new Set(existing.map(d => d.friendlyName));

  // 게이트웨이 + 사용자 정보
  const gateway = await this.gatewaysRepo.findOne({ where: { id: gatewayUuid } });
  if (!gateway) throw new NotFoundException('gateway not found');

  let created = 0, skipped = 0;
  const newDevices: Device[] = [];

  for (const slot of onboardSlots) {
    const template = ONBOARD_TO_DEVICE[slot.slotType];
    if (!template?.provisionable) { skipped++; continue; }
    if (existingKeys.has(slot.slotKey)) { skipped++; continue; }
    
    const device = this.devicesRepo.create({
      userId: gateway.userId,
      gatewayId: gatewayUuid,  // UUID (devices.gateway_id는 varchar 이지만 lgw-dev 패턴 보면 UUID 저장)
      friendlyName: slot.slotKey,
      name: slot.name,
      category: template.category,
      deviceType: template.deviceType,
      equipmentType: template.equipmentType,
      source: 'onboard',
      onboardDeviceId: slot.id,
      enabled: slot.enabled,
      online: false,
    });
    newDevices.push(device);
    created++;
  }

  // 저장
  const saved = await this.devicesRepo.save(newDevices);

  // opener_open ↔ opener_close paired_device_id 설정
  let pairs = 0;
  const openerOpen = saved.find(d => d.equipmentType === 'opener_open');
  const openerClose = saved.find(d => d.equipmentType === 'opener_close');
  if (openerOpen && openerClose) {
    openerOpen.pairedDeviceId = openerClose.id;
    openerClose.pairedDeviceId = openerOpen.id;
    await this.devicesRepo.save([openerOpen, openerClose]);
    pairs = 1;
  }

  this.logger.log(`Auto-provisioned ${created} devices for gateway ${gatewayUuid} (skipped ${skipped}, pairs ${pairs})`);
  return { created, skipped, pairs };
}
```

### 3.3 lazy seed에 통합

`getOnboardDevices(gatewayId)` 마지막에 자동 trigger:
```typescript
async getOnboardDevices(gatewayId: string): Promise<GatewayOnboardDevice[]> {
  // ... 기존 코드 ...
  
  // 첫 호출에서 onboard slots 생성된 경우 자동 device provision
  if (created > 0) {
    await this.provisionDevicesFromOnboard(gatewayId).catch(e =>
      this.logger.warn(`auto-provision 실패: ${e.message}`)
    );
  }
  
  return result;
}
```

### 3.4 명시적 endpoint

`gateway-env.controller.ts`:
```typescript
@Post(':gatewayId/onboard/provision-devices')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'farm_admin')
async provisionDevices(@Param('gatewayId') gatewayId: string) {
  return this.gatewayEnvService.provisionDevicesFromOnboard(gatewayId);
}
```

---

## 4. 검증 시나리오

### AT-01: 신규 게이트웨이 — onboard GET 시 자동 device provision
```bash
# 빈 게이트웨이 준비 (lgw-pilot01 devices 초기화)
DELETE FROM devices WHERE gateway_id='<lgw-pilot01-uuid>' AND source='onboard';
DELETE FROM gateway_onboard_devices WHERE gateway_id='<lgw-pilot01-uuid>';

# onboard GET (lazy seed)
curl GET /api/gateway-env/<uuid>/onboard
# Expected: 12개 onboard slot 생성
# Expected: 자동으로 8개 device INSERT (group 2개 제외)
```

### AT-02: 명시적 provision endpoint
```bash
curl POST /api/gateway-env/<uuid>/onboard/provision-devices
# Expected: { created: 8, skipped: 0, pairs: 1 }
```

### AT-03: 멱등성 (이미 있는 device는 skip)
```bash
# 위 AT-02 직후 동일 호출
curl POST /api/gateway-env/<uuid>/onboard/provision-devices
# Expected: { created: 0, skipped: 8, pairs: 0 (이미 매핑됨) }
```

### AT-04: paired_device_id 자동 인터록
```bash
PSQL "SELECT name, equipment_type, paired_device_id FROM devices WHERE gateway_id='<uuid>' AND equipment_type LIKE 'opener_%';"
# Expected: opener_open.paired_device_id = opener_close.id, vice versa
```

### AT-05: 자동화 룰 등록 가능
```bash
# fan_1 device로 룰 생성 시도
curl POST /api/automation/rules ...
# Expected: HTTP 201 — device가 등록되어 있으므로 룰 생성 가능
```

### AT-06: lgw-dev 영향 0
```bash
PSQL "SELECT COUNT(*) FROM devices WHERE gateway_id IN (SELECT id FROM gateways WHERE gateway_id='lgw-dev');"
# Expected: 변화 없음 (이미 있는 devices는 skip)
```

---

## 5. 위험 + 완화

| 위험 | 완화 |
|---|---|
| 자동 등록된 device가 운영자 의도와 다름 (12개 모두 vs 일부) | enabled=true 그대로, 운영자가 enabled=false로 비활성. provisioning은 register만 함 |
| paired_device_id 다른 paired_device와 충돌 | 단순 1-pair 가정. multi-vent_group 시나리오는 vent_group의 pair_key 활용 (Phase 2) |
| 기존 device와 friendly_name 충돌 | friendly_name = slot_key (unique within gateway) — DB constraint로 보장 |
| devices.gateway_id 타입 — VARCHAR vs UUID | lgw-dev 패턴 확인 결과 UUID 저장 (gateways.id 참조). 본 design 그대로 사용 |

---

## 6. 단계별 구현 순서 (Do Phase)

1. **매핑 상수** `onboard-to-device-mapping.ts` 신규
2. **`provisionDevicesFromOnboard()`** GatewayEnvService에 추가 + devicesRepo, gatewaysRepo inject
3. **lazy seed 자동 trigger** — `getOnboardDevices` 마지막에 호출
4. **endpoint 추가** — `POST /:gatewayId/onboard/provision-devices`
5. **TypeScript 검증** + nest watch 재컴파일
6. **lgw-pilot01에서 AT-01~06 실기 검증**

---

## 7. 회귀 영향

- lgw-dev: 기존 device 패턴(fan 4 + opener 2) 유지 — idempotent skip
- lgw-pilot01: 이전에 0건이었으므로 12 slots → 8 devices 자동 INSERT
- 다른 게이트웨이: 변경 없음 (명시적 호출 안 하면 변경 없음)
- 자동화 룰: 신규 device를 reference하여 작성 가능 → 운영성 향상
