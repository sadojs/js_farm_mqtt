# Design: platform-v2-upgrade

> 스마트팜 플랫폼 대규모 구조 개편 — 상세 설계
> 작성일: 2026-05-08
> Plan 참조: docs/01-plan/features/platform-v2-upgrade.plan.md

---

## 1. DB 스키마 DDL

### 1-1. 신규 테이블: `gateway_onboard_devices`

```sql
CREATE TABLE gateway_onboard_devices (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gateway_id       UUID NOT NULL REFERENCES gateways(id) ON DELETE CASCADE,
  slot_key         VARCHAR(50) NOT NULL,
  slot_type        VARCHAR(50) NOT NULL
    CHECK (slot_type IN (
      'opener_open', 'opener_close', 'fan',
      'irrigation_zone', 'remote_control',
      'fertilizer_contact', 'mixer', 'fertilizer_motor'
    )),
  pair_key         VARCHAR(50),           -- 개폐기 쌍: opener_1, opener_2, opener_3
  name             VARCHAR(100) NOT NULL,
  enabled          BOOLEAN NOT NULL DEFAULT true,
  sort_order       INT NOT NULL DEFAULT 0,
  -- irrigation_config 컬럼 제거: 온보드 관수는 GPIO 순서 고정, 채널 매핑 불필요
  -- 관수 스케줄은 자동화 설정(automation_rules)에서 관리
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(gateway_id, slot_key)
);

CREATE INDEX idx_onboard_gateway ON gateway_onboard_devices(gateway_id);
CREATE INDEX idx_onboard_slot_type ON gateway_onboard_devices(gateway_id, slot_type);

CREATE TRIGGER update_onboard_devices_updated_at
  BEFORE UPDATE ON gateway_onboard_devices
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

**온보드 관수 정책:**
- 온보드 GPIO 관수 구역은 채널 순서 고정 (채널 매핑 불필요)
- 활성화/비활성화 토글과 이름 변경만 허용
- 관수 스케줄은 `자동화 > 관수 설정`에서 관리 (`automation_rules` 테이블)

**17개 기본 슬롯 데이터 (초기화 시 INSERT):**
```sql
-- 게이트웨이 ID를 :gatewayId 로 치환
INSERT INTO gateway_onboard_devices
  (gateway_id, slot_key, slot_type, pair_key, name, sort_order) VALUES
  (:gw, 'opener_1_open',     'opener_open',        'opener_1', '개폐기 1번 열림', 1),
  (:gw, 'opener_1_close',    'opener_close',       'opener_1', '개폐기 1번 닫힘', 2),
  (:gw, 'opener_2_open',     'opener_open',        'opener_2', '개폐기 2번 열림', 3),
  (:gw, 'opener_2_close',    'opener_close',       'opener_2', '개폐기 2번 닫힘', 4),
  (:gw, 'opener_3_open',     'opener_open',        'opener_3', '개폐기 3번 열림', 5),
  (:gw, 'opener_3_close',    'opener_close',       'opener_3', '개폐기 3번 닫힘', 6),
  (:gw, 'fan_1',             'fan',                NULL,       '유동휀 1번',       7),
  (:gw, 'fan_2',             'fan',                NULL,       '유동휀 2번',       8),
  (:gw, 'fan_3',             'fan',                NULL,       '유동휀 3번',       9),
  (:gw, 'remote_control',    'remote_control',     NULL,       '원격제어',        10),
  (:gw, 'fertilizer_contact','fertilizer_contact', NULL,       '액비/교반기 B접점',11),
  (:gw, 'zone_1',            'irrigation_zone',    NULL,       '1구역 관주',      12),
  (:gw, 'zone_2',            'irrigation_zone',    NULL,       '2구역 관주',      13),
  (:gw, 'zone_3',            'irrigation_zone',    NULL,       '3구역 관주',      14),
  (:gw, 'zone_4',            'irrigation_zone',    NULL,       '4구역 관주',      15),
  (:gw, 'mixer',             'mixer',              NULL,       '교반기',          16),
  (:gw, 'fertilizer_motor',  'fertilizer_motor',   NULL,       '액비',            17);
```

### 1-2. 기존 테이블 변경: `gateways`

```sql
ALTER TABLE gateways
  ADD COLUMN IF NOT EXISTS house_id UUID REFERENCES houses(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_gateways_house ON gateways(house_id);
```

### 1-3. 기존 테이블 변경: `devices`

```sql
ALTER TABLE devices
  ALTER COLUMN zigbee_ieee DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'zigbee'
    CHECK (source IN ('zigbee', 'onboard')),
  ADD COLUMN IF NOT EXISTS onboard_device_id UUID
    REFERENCES gateway_onboard_devices(id) ON DELETE SET NULL;

-- 기존 레코드 마이그레이션: source = 'zigbee'
UPDATE devices SET source = 'zigbee' WHERE source IS NULL;

CREATE INDEX IF NOT EXISTS idx_devices_source ON devices(source);
CREATE INDEX IF NOT EXISTS idx_devices_onboard ON devices(onboard_device_id);
```

### 1-4. 기존 테이블 변경: `automation_rules`

스키마 변경 없음 (JSONB conditions 내부 확장만).

**conditions JSON 스키마 확장 예시:**
```json
{
  "logicOp": "AND",
  "items": [
    {
      "type": "temperature",
      "sensor_device_id": "uuid-of-specific-sensor",
      "operator": ">",
      "value": 28
    },
    {
      "type": "humidity",
      "sensor_device_id": null,
      "operator": "<",
      "value": 60
    }
  ]
}
```
> `sensor_device_id`가 `null`이면 기존 로직(구역 대표 센서) 그대로 동작.

---

## 2. 백엔드 모듈 설계

### 2-1. 신규 모듈: `gateway-env`

**디렉터리 구조:**
```
backend/src/modules/gateway-env/
  gateway-env.module.ts
  gateway-env.controller.ts
  gateway-env.service.ts
  entities/
    gateway-onboard-device.entity.ts
  dto/
    update-onboard-device.dto.ts
    add-zigbee-device.dto.ts
    update-zigbee-device.dto.ts
```

#### `gateway-onboard-device.entity.ts`

```typescript
@Entity('gateway_onboard_devices')
export class GatewayOnboardDevice {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ name: 'gateway_id' }) gatewayId: string;

  @Column({ name: 'slot_key' }) slotKey: string;

  @Column({ name: 'slot_type' }) slotType: string;

  @Column({ name: 'pair_key', nullable: true }) pairKey: string | null;

  @Column() name: string;

  @Column({ default: true }) enabled: boolean;

  @Column({ name: 'sort_order', default: 0 }) sortOrder: number;

  // irrigation_config 제거: 온보드 관수는 GPIO 순서 고정, 채널 매핑 불필요

  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
```

#### `update-onboard-device.dto.ts`

```typescript
export class UpdateOnboardDeviceDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
  // irrigationConfig 제거: 온보드 관수 스케줄은 자동화 설정에서 관리
}
```

#### `add-zigbee-device.dto.ts` (기존 devices DTO 재활용)

```typescript
export class AddZigbeeDeviceDto {
  @IsString() zigbeeIeee: string;
  @IsString() friendlyName: string;
  @IsString() zigbeeModel: string;
  @IsString() name: string;
  @IsString() category: string;
  @IsIn(['sensor', 'actuator']) deviceType: string;
  @IsOptional() @IsString() equipmentType?: string;
  @IsOptional() @IsString() pairedDeviceId?: string;
  @IsOptional() @IsString() openerGroupName?: string;
  @IsOptional() houseId?: string;
}
```

#### API 엔드포인트 (`gateway-env.controller.ts`)

```
@Controller('api/gateway-env')
@UseGuards(JwtAuthGuard, RolesGuard)

GET    /:gatewayId/onboard
  → onboard 장치 17개 목록 (없으면 자동 초기화 후 반환)
  → 개폐기는 pair_key 기준으로 쌍 묶어 반환

PATCH  /:gatewayId/onboard/:id
  → name, enabled, irrigationConfig 업데이트
  → @Roles('admin', 'farm_admin')

GET    /:gatewayId/zigbee
  → gateway의 source='zigbee' devices 목록

POST   /:gatewayId/zigbee
  → Zigbee 장치 추가 (기존 DevicesService.create 로직)
  → @Roles('admin', 'farm_admin')

PATCH  /:gatewayId/zigbee/:id
  → name, houseId, channelMapping 수정
  → @Roles('admin', 'farm_admin')

DELETE /:gatewayId/zigbee/:id
  → 장치 삭제
  → @Roles('admin', 'farm_admin')

GET    /:gatewayId/zigbee/scan
  → 페어링 대기 장치 목록 (MqttService 통해 bridge/devices 조회)
```

#### `gateway-env.service.ts` 주요 메서드

```typescript
// onboard 장치 초기화 (없으면 17개 INSERT)
async ensureOnboardDevices(gatewayId: string): Promise<GatewayOnboardDevice[]>

// onboard 장치 목록 (개폐기 쌍 묶기)
async getOnboardDevices(gatewayId: string): Promise<OnboardDeviceGrouped[]>

// onboard 장치 수정
async updateOnboardDevice(id: string, dto: UpdateOnboardDeviceDto, userId: string): Promise<GatewayOnboardDevice>

// Zigbee 장치 추가
async addZigbeeDevice(gatewayId: string, dto: AddZigbeeDeviceDto, userId: string): Promise<Device>

// Zigbee 장치 수정
async updateZigbeeDevice(id: string, dto: UpdateZigbeeDeviceDto, userId: string): Promise<Device>

// Zigbee 장치 삭제
async removeZigbeeDevice(id: string, userId: string): Promise<void>
```

**개폐기 쌍 묶기 응답 타입:**
```typescript
type OnboardDeviceGrouped =
  | { kind: 'opener'; pairKey: string; name: string; enabled: boolean;
      open: GatewayOnboardDevice; close: GatewayOnboardDevice }
  | { kind: 'single'; device: GatewayOnboardDevice };
```

---

### 2-2. `gateway-manager` 모듈 변경

#### 추가 엔드포인트

```
PATCH /api/gateways/:id
  → 기존 name, location 외 house_id 할당 추가

GET   /api/gateways/:id/onboard-init
  → 수동 초기화 트리거 (이미 존재하면 반환만)
  → GatewayEnvService.ensureOnboardDevices() 호출
```

#### `gateway.entity.ts` 변경

```typescript
@Column({ name: 'house_id', nullable: true })
houseId: string | null;
```

---

### 2-3. `devices` 모듈 변경

- `GET /api/devices` — `enabled=true`인 onboard devices와 zigbee devices 통합 반환
  - 기존 조회 로직에서 `source='zigbee'` 필터 제거 (onboard도 포함)
  - 단, 비활성화된 onboard(enabled=false)는 제외
- `DELETE /api/devices/:id` — **제거** (gateway-env에서만 가능)
- `PATCH /api/devices/:id/name` — **제거** (gateway-env에서만 가능)
- `DevicesService.controlDevice()` — 개폐기 인터록 로직 통합

**개폐기 인터록 통합 (`devices.service.ts`):**
```typescript
async controlDevice(deviceId: string, state: boolean, userId: string) {
  const device = await this.devicesRepo.findOneByOrFail({ id: deviceId });

  if (device.equipmentType === 'opener_open' || device.equipmentType === 'opener_close') {
    await this.applyOpenerInterlock(device, state, userId);
    return;
  }
  // 일반 장치 제어
  await this.publishControl(device, state);
}

private async applyOpenerInterlock(device: Device, targetState: boolean, userId: string) {
  if (!targetState) {
    // OFF: 즉시
    await this.publishControl(device, false);
    return;
  }
  // ON 전: 반대쪽 OFF 확인
  const pairedId = device.pairedDeviceId;
  if (pairedId) {
    await this.publishControl({ id: pairedId } as Device, false);
    await new Promise(r => setTimeout(r, 1000));
  }
  await this.publishControl(device, true);
}
```

---

### 2-4. `automation` 모듈 변경

#### `AutomationRunnerService` — 조건 평가 로직

```typescript
private async evaluateCondition(condition: any, userId: string): Promise<boolean> {
  if (condition.type === 'temperature' || condition.type === 'humidity') {
    const sensorValue = await this.getSensorValue(
      condition.type,
      userId,
      condition.sensor_device_id ?? null  // null이면 구역 대표 센서
    );
    return this.compare(sensorValue, condition.operator, condition.value);
  }
  // 기타 조건 처리...
}

private async getSensorValue(
  sensorType: string,
  userId: string,
  specificDeviceId: string | null
): Promise<number> {
  if (specificDeviceId) {
    // 지정된 특정 센서 장치의 최신 데이터
    const row = await this.dataSource.query(`
      SELECT value FROM sensor_data
      WHERE device_id = $1 AND sensor_type = $2
      ORDER BY time DESC LIMIT 1
    `, [specificDeviceId, sensorType]);
    return row[0]?.value ?? 0;
  }
  // 기존 로직: 사용자 전체 최신 평균값
  const row = await this.dataSource.query(`
    SELECT AVG(value) as value FROM sensor_data
    WHERE user_id = $1 AND sensor_type = $2
      AND time > NOW() - INTERVAL '10 minutes'
  `, [userId, sensorType]);
  return row[0]?.value ?? 0;
}
```

#### `create-rule.dto.ts` 변경

```typescript
// 기존 conditionItem에 sensor_device_id 필드 추가
export class ConditionItemDto {
  @IsString() type: string;
  @IsOptional() @IsUUID() sensor_device_id?: string | null;
  @IsString() operator: string;
  @IsNumber() value: number;
}
```

---

## 3. 프론트엔드 설계

### 3-1. 신규 페이지: `GatewayEnvSettings.vue`

**경로:** `/gateways/:id/env`
**접근 권한:** admin, farm_admin (denyFarmUser)

**레이아웃:**
```
[뒤로가기] 게이트웨이 환경 설정 — {gatewayName}

┌─ 온보드 장치 (GPIO/릴레이) ──────────────────────────────┐
│ [개폐기 섹션]                                             │
│   개폐기 1  [이름 편집 아이콘]  [활성화 토글]             │
│   개폐기 2  [이름 편집 아이콘]  [활성화 토글]             │
│   개폐기 3  [이름 편집 아이콘]  [활성화 토글]             │
│                                                          │
│ [유동휀 섹션]                                             │
│   유동휀 1  [이름 편집 아이콘]  [활성화 토글]             │
│   유동휀 2  [이름 편집 아이콘]  [활성화 토글]             │
│   유동휀 3  [이름 편집 아이콘]  [활성화 토글]             │
│                                                          │
│ [기타 장치 섹션]                                          │
│   원격제어        [이름 편집 아이콘]  [활성화 토글]        │
│   액비/교반기 B접점 [이름 편집 아이콘]  [활성화 토글]      │
│   교반기          [이름 편집 아이콘]  [활성화 토글]        │
│   액비            [이름 편집 아이콘]  [활성화 토글]        │
│                                                          │
│ [관수 구역 섹션]                                          │
│   1구역 관주 [이름 편집] [활성화] [채널 설정▼] [스케줄▼]  │
│   2구역 관주  ...                                        │
│   3구역 관주  ...                                        │
│   4구역 관주  ...                                        │
└──────────────────────────────────────────────────────────┘

┌─ Zigbee 장치 ─────────────────────────────────────────┐
│ (추가된 Zigbee 장치 목록)                               │
│   [장치명]  [카테고리]  [이름 수정]  [설정]  [삭제]     │
│                                                        │
│                          [+ Zigbee 장치 추가]          │
└────────────────────────────────────────────────────────┘
```

**컴포넌트 트리:**
```
GatewayEnvSettings.vue
├── OnboardDeviceSection.vue
│   ├── OpenerPairRow.vue          -- 개폐기 쌍 (열림/닫힘 한 행)
│   ├── SingleDeviceRow.vue        -- 일반 단일 장치 행
│   └── IrrigationZoneRow.vue      -- 관수 구역 (채널 + 스케줄 확장)
│       ├── ChannelMappingPanel.vue -- 채널 매핑 설정
│       └── SchedulePanel.vue      -- 스케줄 목록 + 추가/수정
├── ZigbeeDeviceSection.vue
│   ├── ZigbeeDeviceRow.vue
│   └── ZigbeeAddWizard.vue        -- 기존 장치 추가 위저드 재사용
└── InlineNameEditor.vue           -- 공용 인라인 이름 편집
```

**API 연동 (`gateway-env.api.ts`):**
```typescript
export const gatewayEnvApi = {
  getOnboard: (gatewayId: string) =>
    client.get(`/api/gateway-env/${gatewayId}/onboard`),

  updateOnboard: (gatewayId: string, id: string, data: UpdateOnboardDevicePayload) =>
    client.patch(`/api/gateway-env/${gatewayId}/onboard/${id}`, data),

  getZigbee: (gatewayId: string) =>
    client.get(`/api/gateway-env/${gatewayId}/zigbee`),

  addZigbee: (gatewayId: string, data: AddZigbeeDevicePayload) =>
    client.post(`/api/gateway-env/${gatewayId}/zigbee`, data),

  updateZigbee: (gatewayId: string, id: string, data: UpdateZigbeeDevicePayload) =>
    client.patch(`/api/gateway-env/${gatewayId}/zigbee/${id}`, data),

  deleteZigbee: (gatewayId: string, id: string) =>
    client.delete(`/api/gateway-env/${gatewayId}/zigbee/${id}`),

  scanZigbee: (gatewayId: string) =>
    client.get(`/api/gateway-env/${gatewayId}/zigbee/scan`),
};
```

---

### 3-2. 변경 페이지: `GatewayManagement.vue`

- 게이트웨이 카드에 **"환경 설정"** 버튼 추가
  ```vue
  <button @click="$router.push(`/gateway-env/${gw.id}`)">환경 설정</button>
  ```
- 게이트웨이 수정 모달에 **구역(House) 선택 드롭다운** 추가
  - houses API에서 목록 조회 후 `<select>` 렌더링
  - `PATCH /api/gateways/:id` 에 `house_id` 포함

---

### 3-3. 변경 페이지: `Groups.vue` (구역 관리)

- 구역 생성/수정 시 **게이트웨이 할당 드롭다운** 추가
  - gateways API 목록 → `<select>`
  - 저장 시 `PATCH /api/gateways/:gatewayId` with `{ house_id: houseId }`

---

### 3-4. 변경 페이지: `Devices.vue`

- **삭제 버튼 제거** (환경설정에서만 가능)
- **이름 수정 버튼 제거** (환경설정에서만 가능)
- 조회 시 onboard(enabled=true) + zigbee 통합 목록 표시

---

### 3-5. 자동화 조건 컴포넌트 변경

**`StepConditionSensor.vue` (또는 유사 컴포넌트):**

온도/습도 조건 추가 시:
```vue
<template>
  <div v-if="isEnvCondition(condition.type)">
    <label>기준 센서</label>
    <select v-model="condition.sensor_device_id">
      <option :value="null">구역 대표 센서 (기본)</option>
      <option v-for="s in availableSensors" :key="s.id" :value="s.id">
        {{ s.name }}
      </option>
    </select>
  </div>
</template>
```
- `availableSensors`: 현재 사용자의 온습도 type sensor 장치 목록
- 저장 시 `sensor_device_id: null | uuid` 포함

---

## 4. 라우터 변경

**`frontend/src/router/index.ts` 추가:**
```typescript
{
  path: '/gateways/:id/env',
  name: 'gateway-env',
  component: () => import('@/views/GatewayEnvSettings.vue'),
  meta: { requiresAuth: true, denyFarmUser: true },
},
```

---

## 5. 마이그레이션 실행 순서

1. `ALTER TABLE gateways ADD COLUMN house_id`
2. `CREATE TABLE gateway_onboard_devices`
3. `ALTER TABLE devices` (zigbee_ieee nullable, source, onboard_device_id 추가)
4. `UPDATE devices SET source = 'zigbee'` (기존 데이터)
5. 각 게이트웨이 방문 시 onboard 17개 자동 생성 (`ensureOnboardDevices`)
   - 또는 migration script로 기존 게이트웨이 일괄 초기화

---

## 6. 구현 순서 (Do Phase 참조용)

| 순서 | 작업 | 파일 |
|------|------|------|
| 1 | DB 마이그레이션 SQL 작성 및 실행 | `backend/database/` |
| 2 | `GatewayOnboardDevice` 엔티티 + 모듈 생성 | `gateway-env/` |
| 3 | `gateway-env.service.ts` — onboard CRUD | `gateway-env/` |
| 4 | `gateway-env.controller.ts` — API 라우트 | `gateway-env/` |
| 5 | `app.module.ts` — GatewayEnvModule 등록 | `app.module.ts` |
| 6 | `gateway.entity.ts` — house_id 컬럼 추가 | `gateway-manager/` |
| 7 | `gateway-manager.service.ts` — house_id 할당 | `gateway-manager/` |
| 8 | `devices.service.ts` — 인터록 통합 + 조회 변경 | `devices/` |
| 9 | `automation-runner.service.ts` — sensor_device_id 평가 | `automation/` |
| 10 | `gateway-env.api.ts` 프론트엔드 API 모듈 | `frontend/api/` |
| 11 | `GatewayEnvSettings.vue` 신규 페이지 | `frontend/views/` |
| 12 | 서브컴포넌트 (OnboardDeviceSection 등) | `frontend/components/gateway-env/` |
| 13 | `GatewayManagement.vue` — 환경설정 버튼 + house_id UI | `frontend/views/` |
| 14 | `Groups.vue` — 게이트웨이 할당 드롭다운 | `frontend/views/` |
| 15 | `Devices.vue` — 삭제/이름수정 버튼 제거 | `frontend/views/` |
| 16 | `router/index.ts` — 새 라우트 추가 | `frontend/router/` |
| 17 | 자동화 조건 센서 선택 UI | `frontend/components/automation/` |

---

## 7. 비기능 요구사항

- onboard 장치 초기화는 멱등성 보장 (`INSERT ... ON CONFLICT DO NOTHING`)
- 개폐기 인터록 타이밍: OFF → 1000ms 딜레이 → ON (기존 voice.service.ts 기준)
- zigbee 장치 삭제 시 해당 device의 sensor_data는 FK CASCADE로 자동 삭제
- GatewayEnvSettings 페이지는 farm_admin만 접근 (farm_user 접근 불가)
