# MQTT Integration 설계서

> 방식 A (중앙 Broker + Topic Prefix) 기반 상세 설계

## 1. 아키텍처

### 1.1 전체 구성 (다중 농장 지원)

```
라즈베리파이 #1 (abc123)          라즈베리파이 #2 (def456)
  ZNDongle-E (USB)                  ZNDongle-E (USB)
  Zigbee2MQTT                       Zigbee2MQTT
  base_topic:                       base_topic:
    farm/abc123/z2m                   farm/def456/z2m
       │                                │
       └──────── MQTT (1883) ───────────┘
                    │
    ┌───────────────┴───────────────┐
    │   맥미니 (172.30.1.60)         │
    │                               │
    │   Mosquitto (중앙 Broker)      │
    │        │                      │
    │   NestJS Backend (:3100)      │
    │   subscribe:                  │
    │     farm/+/z2m/#              │
    │        │                      │
    │   PostgreSQL (smartfarm_mqtt) │
    │   Vue 3 Frontend (:5174)     │
    └───────────────────────────────┘
```

### 1.2 MQTT 토픽 구조

```
farm/{gateway_id}/z2m/{device_name}              → 센서값 JSON
farm/{gateway_id}/z2m/{device_name}/availability  → online/offline
farm/{gateway_id}/z2m/{device_name}/set           ← 장비 제어 명령
farm/{gateway_id}/z2m/bridge/state                → 브릿지 상태
farm/{gateway_id}/z2m/bridge/devices              → 페어링된 장비 목록
farm/{gateway_id}/z2m/bridge/request/permit_join  ← 페어링 모드 요청
```

`gateway_id`: 각 라즈베리파이의 고유 식별자 (UUID 앞 12자리 또는 사용자 지정)

## 2. DB 스키마 변경

### 2.1 gateways 테이블 (신규)

```sql
CREATE TABLE gateways (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gateway_id VARCHAR(50) NOT NULL UNIQUE,   -- MQTT topic prefix (farm/{이값}/z2m)
  name VARCHAR(100) NOT NULL,               -- "석문리 하우스", "화성 농장"
  location VARCHAR(200),                    -- 주소 또는 위치 설명
  rpi_ip VARCHAR(45),                       -- 라즈베리파이 IP (관리용)
  status VARCHAR(20) DEFAULT 'offline',     -- online/offline (bridge/state 기반)
  last_seen TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_gateways_user ON gateways(user_id);
CREATE INDEX idx_gateways_gateway ON gateways(gateway_id);
```

### 2.2 devices 테이블 변경

```sql
-- 컬럼 변경
ALTER TABLE devices RENAME COLUMN tuya_device_id TO zigbee_ieee;     -- IEEE 802.15.4 주소
ALTER TABLE devices ADD COLUMN gateway_id UUID REFERENCES gateways(id);
ALTER TABLE devices ADD COLUMN friendly_name VARCHAR(100);           -- Zigbee2MQTT 표시명
ALTER TABLE devices ADD COLUMN zigbee_model VARCHAR(100);            -- 장비 모델 (e.g. TS0201)

-- 인덱스
CREATE INDEX idx_devices_gateway ON devices(gateway_id);
```

### 2.3 삭제 테이블

```sql
DROP TABLE IF EXISTS tuya_projects;
```

### 2.4 ERD 관계

```
users (1) ──── (N) gateways (1) ──── (N) devices
                       │
                       │ gateway_id (MQTT topic prefix)
                       │
              subscribe: farm/{gateway_id}/z2m/#
```

## 3. 백엔드 모듈 설계

### 3.1 신규 모듈: MqttModule

```
modules/mqtt/
├── mqtt.module.ts
├── mqtt.service.ts              -- MQTT 클라이언트 (connect, subscribe, publish)
├── mqtt-sensor.handler.ts       -- 센서 메시지 → sensor_data 저장
├── mqtt-device.handler.ts       -- availability → 온라인 상태 업데이트
├── mqtt-bridge.handler.ts       -- bridge/state → 게이트웨이 상태 업데이트
└── mqtt.types.ts                -- 타입 정의
```

### 3.2 MqttService 인터페이스

```typescript
@Injectable()
export class MqttService implements OnModuleInit, OnModuleDestroy {
  private client: MqttClient;

  // 앱 시작 시 자동 연결 + 구독
  async onModuleInit() {
    await this.connect();
    this.subscribeAll();
  }

  // MQTT Broker 연결
  async connect(): Promise<void> {
    this.client = mqtt.connect(process.env.MQTT_URL, {
      clientId: `smartfarm-backend-${Date.now()}`,
      clean: true,
      reconnectPeriod: 5000,
    });
  }

  // 전체 토픽 구독
  private subscribeAll() {
    // 모든 게이트웨이의 센서 데이터
    this.client.subscribe('farm/+/z2m/+', { qos: 1 });
    // 장비 가용성
    this.client.subscribe('farm/+/z2m/+/availability', { qos: 1 });
    // 브릿지 상태
    this.client.subscribe('farm/+/z2m/bridge/state', { qos: 1 });
    // 브릿지 장비 목록
    this.client.subscribe('farm/+/z2m/bridge/devices', { qos: 1 });

    this.client.on('message', (topic, payload) => {
      this.routeMessage(topic, payload);
    });
  }

  // 토픽 파싱 및 라우팅
  private routeMessage(topic: string, payload: Buffer) {
    // topic: "farm/{gatewayId}/z2m/{deviceName}" 등
    const parts = topic.split('/');
    // parts[0] = "farm", parts[1] = gatewayId, parts[2] = "z2m", parts[3+] = 나머지
    const gatewayId = parts[1];
    const rest = parts.slice(3).join('/');

    if (rest === 'bridge/state') {
      this.bridgeHandler.handleBridgeState(gatewayId, payload);
    } else if (rest === 'bridge/devices') {
      this.bridgeHandler.handleBridgeDevices(gatewayId, payload);
    } else if (rest.endsWith('/availability')) {
      const deviceName = rest.replace('/availability', '');
      this.deviceHandler.handleAvailability(gatewayId, deviceName, payload);
    } else if (!rest.includes('/')) {
      // farm/{gw}/z2m/{deviceName} → 센서 데이터
      this.sensorHandler.handleSensorData(gatewayId, rest, payload);
    }
  }

  // 장비 제어 (publish)
  async controlDevice(gatewayId: string, friendlyName: string, command: object): Promise<void> {
    const topic = `farm/${gatewayId}/z2m/${friendlyName}/set`;
    this.client.publish(topic, JSON.stringify(command), { qos: 1 });
  }

  // 페어링 모드 (publish)
  async permitJoin(gatewayId: string, enable: boolean, duration = 120): Promise<void> {
    const topic = `farm/${gatewayId}/z2m/bridge/request/permit_join`;
    this.client.publish(topic, JSON.stringify({ value: enable, time: duration }));
  }
}
```

### 3.3 MqttSensorHandler (sensor-collector 대체)

```typescript
@Injectable()
export class MqttSensorHandler {
  // Zigbee2MQTT 페이로드 키 → 내부 센서 타입 매핑
  private readonly SENSOR_MAP: Record<string, { field: string; unit: string }> = {
    temperature: { field: 'temperature', unit: '°C' },
    humidity:    { field: 'humidity', unit: '%' },
    co2:         { field: 'co2', unit: 'ppm' },
    illuminance_lux: { field: 'illuminance', unit: 'lux' },
    soil_moisture: { field: 'soil_moisture', unit: '%' },
    pressure:    { field: 'pressure', unit: 'hPa' },
  };

  async handleSensorData(gatewayId: string, deviceName: string, payload: Buffer) {
    const data = JSON.parse(payload.toString());

    // DB에서 장비 조회 (gateway_id + friendly_name)
    const device = await this.findDevice(gatewayId, deviceName);
    if (!device || device.deviceType !== 'sensor') return;

    // 페이로드의 모든 키를 순회하며 매핑된 센서 타입만 저장
    for (const [key, mapping] of Object.entries(this.SENSOR_MAP)) {
      if (data[key] == null) continue;
      const value = Number(data[key]);
      if (isNaN(value)) continue;

      await this.sensorsService.storeSensorData({
        deviceId: device.id,
        userId: device.userId,
        sensorType: mapping.field,
        value,
        unit: mapping.unit,
      });

      // WebSocket 브로드캐스트
      this.eventsGateway.broadcastSensorUpdate({
        deviceId: device.id,
        houseId: device.houseId,
        sensorType: mapping.field,
        value,
        unit: mapping.unit,
        status: 'normal',
        time: new Date().toISOString(),
      });
    }
  }
}
```

**핵심 변경**: Cron 5분 polling → MQTT 이벤트 드리븐. 센서가 값을 보낼 때마다 즉시 저장.

### 3.4 MqttDeviceHandler (온라인 상태 대체)

```typescript
@Injectable()
export class MqttDeviceHandler {
  // farm/{gw}/z2m/{name}/availability → {"state":"online"} or {"state":"offline"}
  async handleAvailability(gatewayId: string, deviceName: string, payload: Buffer) {
    const { state } = JSON.parse(payload.toString());
    const online = state === 'online';

    const device = await this.findDevice(gatewayId, deviceName);
    if (!device) return;

    if (device.online !== online) {
      await this.devicesRepo.update(device.id, { online, lastSeen: new Date() });
      this.eventsGateway.broadcastDeviceStatus(device.id, online);
    }
  }
}
```

**핵심 변경**: Cron 5분 polling (Tuya Cloud API) → MQTT availability 토픽 실시간 수신.

### 3.5 MqttBridgeHandler (게이트웨이 상태)

```typescript
@Injectable()
export class MqttBridgeHandler {
  // farm/{gw}/z2m/bridge/state → {"state":"online"}
  async handleBridgeState(gatewayId: string, payload: Buffer) {
    const { state } = JSON.parse(payload.toString());
    await this.gatewayRepo.update(
      { gatewayId },
      { status: state, lastSeen: new Date() },
    );
  }

  // farm/{gw}/z2m/bridge/devices → [{ieee_address, friendly_name, ...}]
  // 캐시에 저장 → GET /zigbee/devices/:gatewayId 에서 반환
  async handleBridgeDevices(gatewayId: string, payload: Buffer) {
    const devices = JSON.parse(payload.toString());
    this.deviceCache.set(gatewayId, devices);
  }
}
```

### 3.6 기존 모듈 수정 사항

#### devices.service.ts 변경

| 메서드 | Before (Tuya) | After (MQTT) |
|--------|--------------|--------------|
| `registerBatch()` | `tuyaDeviceId` 기반 등록 | `zigbeeIeee` + `gatewayId` 기반 등록 |
| `controlDevice()` | `TuyaService.sendDeviceCommand()` | `MqttService.controlDevice(gatewayId, friendlyName, cmd)` |
| `getDeviceStatus()` | `TuyaService.getDeviceStatus()` | DB의 최신 sensor_data + online 상태 반환 |
| `syncDeviceOnlineStatus()` | Tuya Cloud polling (삭제) | MQTT availability로 대체 (MqttDeviceHandler) |

#### automation-runner.service.ts 변경

| 메서드 | Before (Tuya) | After (MQTT) |
|--------|--------------|--------------|
| `executeAction()` | `TuyaService.sendDeviceCommand(credentials, tuyaDeviceId, commands)` | `MqttService.controlDevice(gatewayId, friendlyName, {state: 'ON'})` |
| 의존성 | `TuyaProject`, `TuyaService` 주입 | `MqttService` 주입 (TuyaProject 제거) |
| 커맨드 형식 | `[{code: 'switch_1', value: true}]` | `{state: 'ON'}` 또는 `{state: 'OFF'}` |

#### app.module.ts 변경

```typescript
// Before
imports: [TuyaModule, DevicesModule, SensorsModule, ...]

// After
imports: [MqttModule, GatewayManagerModule, DevicesModule, SensorsModule, ...]
// TuyaModule 삭제
```

### 3.7 신규 모듈: GatewayManagerModule

```
modules/gateway-manager/
├── gateway-manager.module.ts
├── gateway-manager.service.ts     -- Gateway CRUD
├── gateway-manager.controller.ts  -- REST API
└── entities/
    └── gateway.entity.ts          -- gateways 테이블 엔티티
```

#### API 엔드포인트

```
GET    /api/gateways                  → 내 게이트웨이 목록
POST   /api/gateways                  → 게이트웨이 등록
PUT    /api/gateways/:id              → 게이트웨이 수정
DELETE /api/gateways/:id              → 게이트웨이 삭제
GET    /api/gateways/:id/zigbee-devices → Zigbee2MQTT에서 장비 목록 (페어링된)
POST   /api/gateways/:id/permit-join   → 페어링 모드 ON/OFF
```

## 4. 프론트엔드 수정

### 4.1 장비 등록 위저드 변경

**현재 (Tuya)**:
```
Step 1: "Tuya 장비 불러오기" 버튼 → GET /tuya/devices
Step 2: 센서/액추에이터 분류
Step 3: 이름 지정
Step 4: 그룹 할당
```

**변경 (MQTT)**:
```
Step 0: 게이트웨이 선택 (드롭다운, 내 게이트웨이 목록)
Step 1: "Zigbee 장비 불러오기" 버튼 → GET /gateways/:id/zigbee-devices
Step 2: 센서/액추에이터 분류 (Zigbee device definition 기반)
Step 3: 이름 지정
Step 4: 그룹 할당
```

### 4.2 Zigbee 장비 자동 분류

```typescript
// Zigbee2MQTT device definition에서 type으로 자동 분류
const classifyDevice = (z2mDevice: ZigbeeDevice): 'sensor' | 'actuator' => {
  // exposes에 state(on/off)가 있으면 actuator
  if (z2mDevice.definition?.exposes?.some(e => e.type === 'switch' || e.type === 'light')) {
    return 'actuator';
  }
  // 나머지는 sensor
  return 'sensor';
};
```

### 4.3 삭제 대상 파일

```
frontend/src/utils/tuya-errors.ts                     → 삭제
frontend/src/components/admin/ProjectAssignModal.vue   → 삭제 (Tuya 프로젝트 할당)
```

### 4.4 수정 대상 파일

```
frontend/src/components/devices/DeviceRegistration.vue → Step 0 추가, Tuya→Zigbee
frontend/src/api/device.api.ts                        → 엔드포인트 변경
frontend/src/types/device.types.ts                    → tuyaDeviceId → zigbeeIeee
frontend/src/stores/device.store.ts                   → loadTuyaDevices → loadZigbeeDevices
frontend/src/views/Devices.vue                        → 게이트웨이 필터 추가
frontend/src/views/UserManagement.vue                 → Tuya 프로젝트 관련 제거
frontend/src/components/admin/UserFormModal.vue        → Tuya 필드 제거
```

### 4.5 신규 페이지/컴포넌트

```
frontend/src/api/gateway.api.ts                       → 게이트웨이 API
frontend/src/views/Gateways.vue                       → 게이트웨이 관리 페이지 (선택)
frontend/src/components/gateways/GatewayStatus.vue    → 게이트웨이 상태 카드 (선택)
```

## 5. 라즈베리파이 설정 (방식 A 전용)

### 5.1 Zigbee2MQTT configuration.yaml (수정)

```yaml
mqtt:
  base_topic: farm/{GATEWAY_ID}/z2m    # ← setup.sh에서 자동 치환
  server: mqtt://{MAC_MINI_IP}:1883    # ← 맥미니 중앙 Broker로 직접 연결
```

라즈베리파이에서 Mosquitto **불필요** (맥미니의 Broker 직접 사용).

### 5.2 setup.sh 수정 사항

```bash
# 대화형으로 gateway_id와 맥미니 IP 입력받기
read -p "게이트웨이 ID (예: farm01): " GATEWAY_ID
read -p "맥미니 IP (예: 172.30.1.60): " SERVER_IP

# configuration.yaml에 값 치환
sed -i "s/{GATEWAY_ID}/$GATEWAY_ID/" /opt/zigbee2mqtt/data/configuration.yaml
sed -i "s/{MAC_MINI_IP}/$SERVER_IP/" /opt/zigbee2mqtt/data/configuration.yaml
```

### 5.3 맥미니 Mosquitto 설정

```conf
# /etc/mosquitto/conf.d/smart-farm.conf
listener 1883 0.0.0.0
allow_anonymous true    # 개발용. 운영 시 인증 추가
persistence true
persistence_location /var/lib/mosquitto/
```

## 6. 구현 순서 (상세)

```
1. DB 마이그레이션 스크립트 작성
   - gateways 테이블 생성
   - devices.tuya_device_id → zigbee_ieee 리네임
   - devices.gateway_id 컬럼 추가
   - tuya_projects 테이블 DROP

2. Gateway 엔티티 + 모듈 생성
   - gateway.entity.ts
   - gateway-manager.module.ts / service.ts / controller.ts

3. MqttModule 구현
   - mqtt.service.ts (connect, subscribe, publish, routeMessage)
   - mqtt-sensor.handler.ts (센서 데이터 → sensor_data)
   - mqtt-device.handler.ts (availability → online 상태)
   - mqtt-bridge.handler.ts (bridge/state, bridge/devices)

4. DevicesService/Controller 수정
   - TuyaService 의존성 제거
   - MqttService로 교체
   - registerBatch → zigbeeIeee + gatewayId 기반
   - controlDevice → MQTT publish
   - syncDeviceOnlineStatus Cron 삭제

5. SensorCollectorService 전면 교체
   - Tuya polling Cron 삭제
   - MqttSensorHandler로 대체 (이벤트 드리븐)

6. AutomationRunnerService 수정
   - TuyaProject/TuyaService 의존성 제거
   - executeAction → MqttService.controlDevice()

7. TuyaModule 삭제
   - tuya.service.ts, tuya.controller.ts, tuya.module.ts 삭제
   - tuya-project.entity.ts 삭제
   - app.module.ts에서 TuyaModule 제거, MqttModule 추가

8. 프론트엔드 수정
   - DeviceRegistration.vue (게이트웨이 선택 + Zigbee 장비 로드)
   - device.api.ts, gateway.api.ts
   - Tuya 관련 파일 삭제

9. 라즈베리파이 setup.sh 업데이트
   - Mosquitto 설치 제거 (방식 A)
   - gateway_id/서버IP 대화형 입력
   - Zigbee2MQTT만 설치

10. 통합 테스트
    - 맥미니 Mosquitto + 라즈베리파이 Zigbee2MQTT 연결
    - 센서 페어링 → 실시간 데이터 수신
    - 스위치 제어
    - 자동화 룰 동작
```

## 7. 데이터 흐름 상세

### 7.1 센서 데이터 수신 플로우

```
Zigbee 센서 → ZNDongle-E → Zigbee2MQTT
  → publish: farm/abc123/z2m/온습도센서 {"temperature":25.3,"humidity":60}
  → Mosquitto (맥미니)
  → Backend MqttService.routeMessage()
  → MqttSensorHandler.handleSensorData("abc123", "온습도센서", payload)
    → devices 테이블에서 gateway_id=abc123, friendly_name=온습도센서 조회
    → sensor_data INSERT (temperature=25.3, humidity=60)
    → WebSocket broadcast → Frontend 실시간 업데이트
```

### 7.2 장비 제어 플로우

```
Frontend: POST /api/devices/:id/control {command: 'on'}
  → Backend DevicesService.controlDevice()
    → devices 테이블에서 장비 조회 → gatewayId, friendlyName 획득
    → MqttService.controlDevice("abc123", "스위치1", {state: "ON"})
      → publish: farm/abc123/z2m/스위치1/set {"state":"ON"}
      → Mosquitto → Zigbee2MQTT → ZNDongle-E → Zigbee 스위치 동작
```

### 7.3 자동화 실행 플로우

```
AutomationRunnerService (매분 Cron)
  → evaluateRuleConditions() → sensor_data에서 최신 값 조회 (기존과 동일)
  → conditions matched!
  → executeAction()
    → 장비 조회 → gatewayId, friendlyName 획득
    → MqttService.controlDevice(gatewayId, friendlyName, {state: "ON"})
```

## 8. MQTT 커맨드 매핑

### 8.1 Tuya → Zigbee2MQTT 커맨드 변환

| 기존 Tuya 커맨드 | Zigbee2MQTT 커맨드 |
|------------------|-------------------|
| `{code: 'switch_1', value: true}` | `{state: 'ON'}` |
| `{code: 'switch_1', value: false}` | `{state: 'OFF'}` |
| `{code: 'switch', value: true}` | `{state: 'ON'}` |
| `{code: 'percent_control', value: 50}` | `{position: 50}` |

### 8.2 buildMqttCommand 함수

```typescript
function buildMqttCommand(action: any): object {
  const command = action?.command;

  if (command === 'on' || command === 'open') {
    return { state: 'ON' };
  }
  if (command === 'off' || command === 'close') {
    return { state: 'OFF' };
  }
  if (command === 'position' && action?.parameters?.percentage != null) {
    return { position: Number(action.parameters.percentage) };
  }

  return { state: command === 'on' ? 'ON' : 'OFF' };
}
```
