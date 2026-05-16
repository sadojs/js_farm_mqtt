# Design: gpio-relay-manager

> Plan 문서 기반 상세 설계. GPIO 26핀(BCM 2~27) 배정 UI + GPIO 릴레이 제어 파이프라인.

---

## 1. 시스템 아키텍처

```
┌──────────────────────────────────────────────────────────────┐
│  Frontend (Vue 3)                                            │
│  GatewayEnvSettings.vue                                      │
│    └─ GpioRelayManager.vue ──► PATCH /gateway-env/:gw/onboard/:id  │
│                            ──► POST  /gpio/:gatewayId/relay  │
└──────────────────────┬───────────────────────────────────────┘
                       │ HTTP
┌──────────────────────▼───────────────────────────────────────┐
│  Backend (NestJS)                                            │
│  GatewayEnvModule  ──► updateOnboardDevice (gpioPin 저장)    │
│  GpioModule (신규) ──► MqttService.publishGpioCommand()      │
└──────────────────────┬───────────────────────────────────────┘
                       │ MQTT: farm/{gatewayId}/gpio/relay
┌──────────────────────▼───────────────────────────────────────┐
│  Raspberry Pi                                                │
│  gpio-agent (Node.js + onoff)                                │
│    구독: farm/{gatewayId}/gpio/relay                          │
│    발행: farm/{gatewayId}/gpio/status                         │
│    → GPIO 핀 HIGH/LOW 제어                                   │
└──────────────────────────────────────────────────────────────┘
```

---

## 2. GPIO 핀 사양

### 사용 가능 BCM 핀 (총 26개)
```javascript
BCM_PINS = [2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27]
```

### 핀 배정 규칙
- 1 슬롯 → 1 GPIO 핀
- 핀 중복 배정 시 프론트에서 경고 표시 (저장은 허용, 운영 주의)
- `NULL` = 미배정 (정상 상태, GPIO 제어 불가)
- 핀 번호 0~1 (SDA/SCL 기본용), 28~40 (Compute용) 제외

---

## 3. DB 설계

### Migration 013: `gateway_onboard_devices.gpio_pin`
```sql
-- 파일: backend/database/migrations/013_gpio_pin.sql
ALTER TABLE gateway_onboard_devices
  ADD COLUMN IF NOT EXISTS gpio_pin INT DEFAULT NULL;

COMMENT ON COLUMN gateway_onboard_devices.gpio_pin
  IS 'Raspberry Pi BCM GPIO 핀 번호 (2~27), NULL=미배정';
```

### 변경 후 `gateway_onboard_devices` 스키마
| 컬럼 | 타입 | 변경 |
|------|------|------|
| id | UUID PK | 기존 |
| gateway_id | UUID FK | 기존 |
| slot_key | VARCHAR(50) | 기존 |
| slot_type | VARCHAR(50) | 기존 |
| pair_key | VARCHAR(50) | 기존 |
| name | VARCHAR(100) | 기존 |
| enabled | BOOLEAN | 기존 |
| sort_order | INT | 기존 |
| operation_time | INT | 기존 |
| standby_time | INT | 기존 |
| **gpio_pin** | **INT NULL** | **신규** |
| created_at | TIMESTAMPTZ | 기존 |
| updated_at | TIMESTAMPTZ | 기존 |

---

## 4. 백엔드 설계

### 4-1. Entity 변경 (최소)
**`gateway-onboard-device.entity.ts`**
```typescript
@Column({ name: 'gpio_pin', nullable: true, type: 'int' })
gpioPin: number | null;
```

### 4-2. DTO 변경 (최소)
**`update-onboard-device.dto.ts`**
```typescript
@IsOptional()
@IsInt()
@Min(2)
@Max(27)
gpioPin?: number | null;
```

### 4-3. Service 변경 (최소)
**`gateway-env.service.ts`** — `updateOnboardDevice` 메서드에 1줄 추가
```typescript
if ('gpioPin' in dto) device.gpioPin = dto.gpioPin ?? null;
```

### 4-4. 신규 GPIO 모듈
```
backend/src/modules/gpio/
├── gpio.module.ts
├── gpio.controller.ts
└── gpio.service.ts
```

#### `gpio.controller.ts`
```typescript
@Controller('gpio')
@UseGuards(JwtAuthGuard, RolesGuard)
export class GpioController {
  // POST /gpio/:gatewayId/relay
  // Body: { slot: string, pin: number, state: boolean, durationMs?: number }
  @Post(':gatewayId/relay')
  @Roles('admin', 'farm_admin')
  async sendRelayCommand(
    @Param('gatewayId') gatewayId: string,
    @Body() body: GpioRelayCommandDto,
    @CurrentUser() user: any,
  )
}
```

#### `gpio.service.ts`
```typescript
async sendRelayCommand(gatewayId: string, cmd: GpioRelayCommandDto): Promise<void> {
  // Gateway 조회 → string gatewayId 변환
  const gw = await this.gatewayRepo.findOne({ where: { id: gatewayId } });
  if (!gw) throw new NotFoundException();
  await this.mqttService.publishGpioRelay(gw.gatewayId, cmd);
}
```

#### `MqttService.publishGpioRelay()` (mqtt.service.ts 메서드 추가)
```typescript
async publishGpioRelay(gatewayId: string, cmd: {
  slot: string; pin: number; state: boolean; durationMs?: number;
}): Promise<void> {
  const topic = `farm/${gatewayId}/gpio/relay`;
  this.client.publish(topic, JSON.stringify({ ...cmd, requestId: Date.now() }), { qos: 1 });
}
```

#### `GpioRelayCommandDto`
```typescript
export class GpioRelayCommandDto {
  @IsString() slot: string;       // 'zone_1', 'fan_1', etc.
  @IsInt() @Min(2) @Max(27) pin: number;
  @IsBoolean() state: boolean;
  @IsOptional() @IsInt() @Min(0) durationMs?: number;
}
```

### 4-5. MQTT 토픽 구독 추가
**`mqtt.service.ts`** — `subscribeAll()` 에 구독 추가
```typescript
'farm/+/gpio/status',  // Pi GPIO 상태 응답
```

**`routeMessage()`** 에 라우팅 추가
```typescript
if (namespace === 'gpio' && parts[3] === 'status') {
  this.bridgeHandler.handleGpioStatus(gatewayId, payload);
  return;
}
```

**`mqtt-bridge.handler.ts`** — `handleGpioStatus()` 추가
```typescript
async handleGpioStatus(gatewayId: string, payload: Buffer) {
  // { slot, pin, state, timestamp } 로깅만 (v1)
  const data = JSON.parse(payload.toString());
  this.logger.log(`GPIO 상태 [${gatewayId}] ${data.slot}: pin=${data.pin} state=${data.state}`);
}
```

---

## 5. 프론트엔드 설계

### 5-1. 파일 구조
```
frontend/src/
├── components/gateway/
│   └── GpioRelayManager.vue    ← 신규 (메인 컴포넌트)
├── views/
│   └── GatewayEnvSettings.vue  ← 온보드 탭 내용 교체
└── api/
    └── gateway-env.api.ts      ← gpioPin 필드 추가 + gpio API 추가
```

### 5-2. API 변경사항
**`gateway-env.api.ts`**
```typescript
// OnboardDevice 인터페이스에 추가
export interface OnboardDevice {
  // ...기존 필드...
  gpioPin: number | null;       // 신규
}

// updateOnboard 파라미터에 추가
updateOnboard: (gatewayId, deviceId, data: {
  name?: string; enabled?: boolean;
  operationTime?: number; standbyTime?: number;
  gpioPin?: number | null;     // 신규
})
```

**신규 `gpio.api.ts`**
```typescript
export const gpioApi = {
  sendRelayCommand: (gatewayId: string, cmd: {
    slot: string; pin: number; state: boolean; durationMs?: number;
  }) => apiClient.post(`/gpio/${gatewayId}/relay`, cmd),
}
```

### 5-3. `GpioRelayManager.vue` 컴포넌트 설계

#### Props / Emits
```typescript
// Props
interface Props {
  gatewayId: string
  onboardDevices: OnboardDevice[]
}
// Emits
// 'update:device' — 슬롯 변경 시 부모에 알림
```

#### 내부 상태
```typescript
const BCM_PINS = [2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27]

// 슬롯을 그룹으로 분류
const fanSlots   = computed(() => props.onboardDevices.filter(d => d.slotType === 'fan'))
const irrigSlots = computed(() => props.onboardDevices.filter(d => d.slotType !== 'fan'))

// 카드 펼침 상태
const expandedFans   = ref<Set<string>>(new Set())
const irrigExpanded  = ref(true)

// 전체 사용 중인 핀 목록 (중복 감지용)
const allUsedPins = computed(() => 
  props.onboardDevices.map(d => d.gpioPin).filter(Boolean) as number[]
)
const conflictPins = computed(() =>
  allUsedPins.value.filter((p, i) => allUsedPins.value.indexOf(p) !== i)
)
```

#### 저장 방식
```typescript
async function updateGpioPin(device: OnboardDevice, pin: number | null) {
  await gatewayEnvApi.updateOnboard(gatewayId, device.id, { gpioPin: pin })
  device.gpioPin = pin  // 로컬 즉시 반영
  notif.success('저장', `${device.name} GPIO 핀 배정 저장`)
}
```

### 5-4. UI 레이아웃 (섹션별)

#### A. 상태 요약 바
```
┌────────┬────────┬─────────────┬──────────────┬──────────────┐
│ 장치 수 │ 총 채널 │ 핀 배정됨   │ GPIO 사용    │  핀 충돌     │
│   5    │   16   │  12 / 16   │  12 / 26     │  없음 ✓     │
└────────┴────────┴─────────────┴──────────────┴──────────────┘
```

#### B. 팬 장치 카드 (fan_1 ~ fan_4 각각)
```
┌─────────────────────────────────────────────────────┐
│ 🌀 유동팬 1번  [●○○○ 핀배정 0/1 · 활성 1]  [토글] [▼]│
├─────────────────────────────────────────────────────┤
│  [1] ON/OFF │ BCM [ 드롭다운 ▼ ] │ [활성 토글]       │
└─────────────────────────────────────────────────────┘
```

#### C. 관수 릴레이 카드 (한 장, 슬롯 전체 포함)
```
┌─────────────────────────────────────────────────────┐
│ 💧 관수 릴레이  [●●○○ 핀배정 N/14 · 활성 N]  [▼]    │
├─────────────────────────────────────────────────────┤
│  [1] 원격제어 ON/OFF │ BCM [드롭다운] │ [토글]        │
│  [2] 액비/교반기 B접점│ BCM [드롭다운] │ [토글]        │
│  [3] 1구역 관주      │ BCM [드롭다운] │ [토글]        │
│  ...                                                │
│  [14] 액비           │ BCM [드롭다운] │ [토글]        │
│  ─────────────────────────────────────────────────  │
│  [전체 활성화] [전체 비활성화] [핀 초기화]             │
└─────────────────────────────────────────────────────┘
```

#### D. GPIO 핀 현황 시각화 (하단)
```
GPIO 핀 배정 현황 (BCM 번호순)
┌──┐ ┌──┐ ┌──┐ ┌──┐ ... 총 26개 핀 격자
│ 2│ │ 3│ │ 4│ │ 5│
│🌀│ │💧│ │ —│ │⚠️│  ← 충돌 시 ⚠️ 빨간색
└──┘ └──┘ └──┘ └──┘
```

#### E. 핀 충돌 경고 배너
```
⚠️ GPIO 핀 충돌: BCM 17, 23 — 중복 배정된 핀이 있습니다.
```

### 5-5. GatewayEnvSettings.vue 변경
```vue
<!-- 온보드 탭: 기존 슬롯 그룹 → GpioRelayManager로 교체 -->
<div v-else-if="activeTab === 'onboard'" class="section">
  <GpioRelayManager
    :gateway-id="gatewayId"
    :onboard-devices="onboardDevices"
    @device-updated="refreshDevices"
  />
</div>
```

---

## 6. 라즈베리파이 GPIO 에이전트 설계

### 6-1. 파일 구조
```
raspberry-pi/gpio-agent/
├── index.js          ← 메인 에이전트
├── package.json
└── README.md

raspberry-pi/systemd/
└── gpio-agent.service
```

### 6-2. `package.json`
```json
{
  "name": "gpio-agent",
  "version": "1.0.0",
  "main": "index.js",
  "dependencies": {
    "mqtt": "^5.0.0",
    "onoff": "^6.0.3"
  }
}
```

### 6-3. `index.js` 설계
```javascript
// 환경변수
// GATEWAY_ID, MQTT_SERVER, MQTT_USERNAME?, MQTT_PASSWORD?

const TOPIC_RELAY  = `farm/${GATEWAY_ID}/gpio/relay`
const TOPIC_STATUS = `farm/${GATEWAY_ID}/gpio/status`
const BCM_VALID = new Set([2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,
                            17,18,19,20,21,22,23,24,25,26,27])

// GPIO 핀 인스턴스 캐시 (Gpio 객체 재사용)
const gpioCache = new Map() // pin → Gpio instance

function getGpioPin(pin) {
  if (!gpioCache.has(pin)) {
    const { Gpio } = require('onoff')
    gpioCache.set(pin, new Gpio(pin, 'out'))
  }
  return gpioCache.get(pin)
}

// MQTT 메시지 처리
async function handleRelayCommand(payload) {
  const { slot, pin, state, durationMs, requestId } = JSON.parse(payload)
  
  if (!BCM_VALID.has(pin)) {
    console.warn(`[GPIO] 유효하지 않은 핀: BCM ${pin}`)
    return
  }

  const gpioPin = getGpioPin(pin)
  const level = state ? 1 : 0
  gpioPin.writeSync(level)
  console.log(`[GPIO] BCM ${pin} (${slot}) → ${state ? 'HIGH' : 'LOW'}`)

  // 상태 응답 발행
  client.publish(TOPIC_STATUS, JSON.stringify({
    requestId, slot, pin, state, timestamp: new Date().toISOString()
  }), { qos: 1 })

  // durationMs 있으면 자동 해제
  if (durationMs && durationMs > 0) {
    setTimeout(() => {
      gpioPin.writeSync(0)  // 반드시 OFF
      client.publish(TOPIC_STATUS, JSON.stringify({
        slot, pin, state: false, timestamp: new Date().toISOString(), auto: true
      }))
    }, durationMs)
  }
}

// 종료 시 모든 핀 해제
process.on('SIGTERM', () => {
  gpioCache.forEach(gpio => { gpio.writeSync(0); gpio.unexport() })
  process.exit(0)
})
```

### 6-4. systemd 서비스 (`gpio-agent.service`)
```ini
[Unit]
Description=Smart Farm GPIO Relay Agent
After=network.target gpio-agent.service

[Service]
Type=simple
User=pi
WorkingDirectory=/opt/gpio-agent
Environment=NODE_ENV=production
EnvironmentFile=/etc/smartfarm/gpio-agent.env
ExecStart=/usr/bin/node index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

### 6-5. 환경변수 파일 (`/etc/smartfarm/gpio-agent.env`)
```bash
GATEWAY_ID=lgw-dev
MQTT_SERVER=mqtt://172.30.1.42:1883
MQTT_USERNAME=
MQTT_PASSWORD=
```

---

## 7. 데이터 흐름

### 7-1. GPIO 핀 배정 저장 흐름
```
User clicks pin dropdown
  → updateGpioPin(device, pin)
  → PATCH /gateway-env/{gwId}/onboard/{deviceId}
    Body: { gpioPin: 17 }
  → GatewayEnvService.updateOnboardDevice()
    → gateway_onboard_devices.gpio_pin = 17
  → 응답: 저장된 OnboardDevice
  → 프론트 로컬 상태 업데이트
  → GPIO 핀 현황 시각화 즉시 갱신
```

### 7-2. GPIO 릴레이 제어 흐름
```
User toggles relay (예: 관수 구역 1 ON)
  → POST /gpio/{gwId}/relay
    Body: { slot: 'zone_1', pin: 17, state: true, durationMs: 30000 }
  → GpioService.sendRelayCommand()
  → MqttService.publishGpioRelay('lgw-dev', ...)
  → MQTT: farm/lgw-dev/gpio/relay
      {"slot":"zone_1","pin":17,"state":true,"durationMs":30000}
  → Pi gpio-agent 수신
  → onoff: Gpio(17, 'out').writeSync(1)
  → 30초 후 자동 OFF
  → MQTT: farm/lgw-dev/gpio/status
      {"slot":"zone_1","pin":17,"state":false,"auto":true}
  → 백엔드 수신 → 로그
```

---

## 8. API 명세

### PATCH `/gateway-env/:gatewayId/onboard/:id`
기존 API 확장 (Breaking change 없음)
```json
// Request Body (추가 필드)
{ "gpioPin": 17 }         // 배정
{ "gpioPin": null }       // 해제

// Response (추가 필드)
{ "id": "...", "gpioPin": 17, ...기존 필드 }
```

### POST `/gpio/:gatewayId/relay`
신규 API
```json
// Request Body
{
  "slot": "zone_1",
  "pin": 17,
  "state": true,
  "durationMs": 30000
}

// Response
{ "success": true, "message": "GPIO 명령 발행 완료" }
```

---

## 9. 에러 처리

| 상황 | 처리 |
|------|------|
| Pi 오프라인 | MQTT publish 성공 여부 무관 — 프론트에서 "명령 발행됨" 표시 |
| 유효하지 않은 BCM 핀 | 백엔드 DTO validation (Min(2), Max(27)) |
| 핀 중복 배정 | 저장은 허용, 프론트에서 경고 배너만 표시 |
| onoff 라이브러리 없음 (Pi 아닌 환경) | `try/catch` → 로그 출력 후 continue |
| GPIO 권한 없음 | gpio-agent 실행 시 sudo 또는 gpio 그룹 필요 |

---

## 10. 구현 체크리스트

### DB (1개 파일)
- [ ] `backend/database/migrations/013_gpio_pin.sql`

### Backend (5개 파일)
- [ ] `gateway-onboard-device.entity.ts` — gpioPin 컬럼
- [ ] `update-onboard-device.dto.ts` — gpioPin 필드
- [ ] `gateway-env.service.ts` — gpioPin 저장 처리 (1줄)
- [ ] `backend/src/modules/gpio/` 모듈 (controller, service, module, dto)
- [ ] `mqtt.service.ts` — publishGpioRelay() 추가
- [ ] `mqtt-bridge.handler.ts` — handleGpioStatus() 추가
- [ ] `mqtt.service.ts` — subscribeAll()에 gpio/status 추가
- [ ] `app.module.ts` — GpioModule 등록

### Frontend (3개 파일)
- [ ] `frontend/src/components/gateway/GpioRelayManager.vue` (신규)
- [ ] `frontend/src/api/gpio.api.ts` (신규)
- [ ] `frontend/src/api/gateway-env.api.ts` — gpioPin 타입 추가
- [ ] `frontend/src/views/GatewayEnvSettings.vue` — 온보드 탭 교체

### Raspberry Pi (3개 파일)
- [ ] `raspberry-pi/gpio-agent/index.js` (신규)
- [ ] `raspberry-pi/gpio-agent/package.json` (신규)
- [ ] `raspberry-pi/systemd/gpio-agent.service` (신규)
