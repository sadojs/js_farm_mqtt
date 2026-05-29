# Design: 라즈베리파이 폴백 채널-핀 매핑 동기화

**Feature ID**: `rpi-fallback-channel-sync`
**작성일**: 2026-05-21
**기반 문서**: [01-plan/features/rpi-fallback-channel-sync.plan.md](../../01-plan/features/rpi-fallback-channel-sync.plan.md)
**선행 사이클**: [rpi-emergency-failover.design.md](./rpi-emergency-failover.design.md)
**상태**: Design

---

## 1. 아키텍처 개요

### 변경 범위 (선행 사이클 대비 증분만)

```
[선행 사이클에서 구현됨]                     [본 사이클 추가/변경]
┌────────────────────────────────┐         ┌──────────────────────────────────┐
│ FallbackConfigService          │         │ + buildChannelMapping(gatewayId)  │
│  publishSync() ──────────────►│  ──►   │ + @OnEvent('device.changed')      │
│                                │         │ + sync payload v2 (channelMapping)│
└────────────────────────────────┘         └──────────────────────────────────┘
              │
              ▼
         farm/{gw}/fallback/rules/sync (retained)
              │
              ▼
┌────────────────────────────────┐         ┌──────────────────────────────────┐
│ RPi rule-store                 │         │ + channelMapping 캐시              │
│  applySync(payload) ──────────►│  ──►   │ + getChannels(category)           │
│                                │         │ + findMapping(channel) → {slot,pin}│
└────────────────────────────────┘         └──────────────────────────────────┘
              │
              ▼
┌────────────────────────────────┐         ┌──────────────────────────────────┐
│ rule-evaluator 4종              │         │ - 하드코딩된 *_CHANNELS 상수 제거   │
│  IRRIGATION_CHANNELS = [...]   │  ──►   │ + store.getChannels('irrigation') │
└────────────────────────────────┘         └──────────────────────────────────┘
              │
              ▼
┌────────────────────────────────┐         ┌──────────────────────────────────┐
│ RelayBridge.setRelay(channel)  │  ──►   │ + channel → {slot,pin} 변환       │
│  payload: {channel, state}     │         │ + gpio-agent 호환 payload         │
└────────────────────────────────┘         │   {slot, pin, state, bypass}     │
                                            └──────────────────────────────────┘
```

### 핵심 설계 원칙

1. **단일 진실 원천(SSoT)**: 서버 DB의 `devices.gpio_pin` + `channel-mapping.constants.ts`가 권위
2. **자동 동기화**: 서버 device 변경 시 즉시 `device.changed` 이벤트 → fallback sync 재발행 (retained → RPi 재연결 시에도 자동 복원)
3. **선행 사이클 변경 최소화**: `fallback/rules/sync` 메시지 스키마 확장 + retained 메시지 유지. version 단조증가 idempotent 유지
4. **GPIO Agent 호환**: gpio-agent payload `{slot, pin, state, requestId}`에 맞춤
5. **등록된 채널만 동기화**: 8ch/12ch 구분 컬럼 추가 없이, devices 테이블에 등록된 channel만 RPi로 전송. 미등록 채널은 폴백에서 무시

---

## 2. 데이터 모델 — DB 스키마 변경 없음

> **설계 결정 정정 (2026-05-21)**: 초기 설계는 `devices.gpio_pin` + `channel-mapping.constants.ts`를 가정했으나, 실제 코드베이스에서는 `gateway_onboard_devices` 테이블이 매핑 테이블 역할을 함. 이 테이블이 이미 slot_key + slot_type + gpio_pin을 모두 보유하므로 channel-mapping.constants 의존 제거.

### 활용 테이블: `gateway_onboard_devices`

| 컬럼 | 의미 | 본 사이클에서의 사용 |
|------|------|---------------------|
| `gateway_id` (UUID) | 소속 게이트웨이 | gateways.id로 → gateways.gateway_id (VARCHAR)로 조인 후 sync |
| `slot_key` (VARCHAR) | 채널 의미명 (예: `zone_1`, `fan_1`, `mixer`) | sync 메시지의 `channel` 필드 |
| `slot_type` (VARCHAR) | 카테고리: `irrigation_zone`/`irrigation_group`/`fan`/`opener_open`/`opener_close`/`fertilizer_contact`/`mixer`/`fertilizer_motor`/`remote_control`/`vent_group` | fallback 카테고리 분류용 |
| `gpio_pin` (INT, NULL 가능) | BCM 핀 번호 (2~27) | `pin` 필드 |
| `enabled` (BOOLEAN) | 슬롯 활성화 여부 | false면 sync 제외 |
| `name` (VARCHAR) | 표시명 (예: "1구역 관주") | (옵션) UI 표시용 메타 |

### slot_type → fallback 카테고리 매핑

```
'irrigation_zone'     →  irrigation
'irrigation_group'    →  irrigation
'fan'                 →  fan          (fan_1~fan_4 4개 슬롯 가능)
'opener_open'         →  opener.open
'opener_close'        →  opener.close
'fertilizer_contact'  →  fertilizer
'mixer'               →  fertilizer
'fertilizer_motor'    →  fertilizer
'remote_control'      →  제외 (폴백 적용 안 함)
'vent_group'          →  제외 (폴백 적용 안 함)
```

### 신규 마이그레이션
**없음** (DB 스키마 무변경)

### 동작 정책
- `gpio_pin`이 NULL인 슬롯 → sync에서 제외 (warn log)
- `enabled=false`인 슬롯 → sync에서 제외
- `slot_type`이 매핑 표에 없는 값 → 제외 (`remote_control`/`vent_group` 포함)
- 동일 카테고리에 여러 슬롯 → 모두 포함 (예: 환기팬 4개면 폴백 시 4개 모두 ON/OFF)

---

## 3. MQTT 메시지 변경 (선행 사이클 확장)

### 3.1 `farm/{gw}/fallback/rules/sync` (Server → RPi) — Payload v2

기존 payload에 `channelMapping` 필드 추가. 다른 필드는 동일.

```jsonc
{
  "version": 5,
  "config": { /* 기존: heartbeat/opener/irrigation/fan 등 */ },
  "schedule": [ /* 기존: 12개월 스케줄 */ ],

  // ─── v2 신규 ───
  "channelMapping": {
    "irrigation": [
      { "channel": "zone_1", "slot": "switch_2", "pin": 17 },
      { "channel": "zone_2", "slot": "switch_3", "pin": 27 },
      { "channel": "zone_3", "slot": "switch_4", "pin": 22 },
      { "channel": "zone_4", "slot": "switch_5", "pin": 23 }
    ],
    "fertilizer": [
      { "channel": "fertilizer_b_contact", "slot": "switch_6", "pin": 24 },
      { "channel": "mixer",                "slot": "switch_usb1", "pin": 25 },
      { "channel": "fertilizer_motor",     "slot": "switch_usb2", "pin": 26 }
    ],
    "fan": [
      { "channel": "fan", "slot": "switch_7", "pin": 5 }
    ],
    "opener": {
      "open":  [{ "channel": "opener_open",  "slot": "switch_8", "pin": 6 }],
      "close": [{ "channel": "opener_close", "slot": "switch_9", "pin": 13 }]
    }
  }
}
```

**호환성**:
- 구버전 RPi (channelMapping 인식 못 함) → 기존 동작 유지 (선행 사이클 상태)
- 신버전 RPi에 channelMapping 없는 v1 메시지 수신 → channelMapping null → 폴백 진입 시 emergency-stop (안전 우선)

**version 정책**:
- `channelMapping` 변경(=device CRUD) 시에도 version++ → RPi가 idempotent 처리
- 룰 변경 + 매핑 변경이 같이 일어나도 단일 publish에 통합

### 3.2 신규 토픽 없음
모든 변경은 기존 `fallback/rules/sync` 토픽 안에서 처리.

---

## 4. 백엔드 모듈 변경

### 4.1 `FallbackConfigService.buildChannelMapping()` 신규 메서드

```ts
// fallback-config.service.ts (의사 코드)
import { DEFAULT_CHANNEL_MAPPING_8CH, DEFAULT_CHANNEL_MAPPING_12CH } from '../devices/channel-mapping.constants';

private async buildChannelMapping(gatewayId: string) {
  // 1. gateway의 모든 actuator device 조회
  const devices = await this.deviceRepo.find({
    where: { gatewayId: <UUID>, deviceType: 'actuator' },
  });

  // 2. equipment_type별로 분류 + slot 매핑 결정
  // 8ch/12ch 자동 감지: 등록된 channel 중 'zone_5'~'zone_8'이 있으면 12ch로 판단
  const has12ch = devices.some(d => ['zone_5','zone_6','zone_7','zone_8'].includes(d.channel));
  const slotMap = has12ch ? DEFAULT_CHANNEL_MAPPING_12CH : DEFAULT_CHANNEL_MAPPING_8CH;

  const result = {
    irrigation: [], fertilizer: [], fan: [],
    opener: { open: [], close: [] },
  };

  for (const d of devices) {
    if (d.gpioPin == null) continue;  // 핀 미설정 device 제외
    const slot = slotMap[d.channel];  // channel → slot 변환
    if (!slot) continue;              // 미지원 channel 무시

    const entry = { channel: d.channel, slot, pin: d.gpioPin };

    switch (d.equipmentType) {
      case 'irrigation':    result.irrigation.push(entry); break;
      case 'fertilizer':    result.fertilizer.push(entry); break;
      case 'fan':           result.fan.push(entry); break;
      case 'opener_open':   result.opener.open.push(entry); break;
      case 'opener_close':  result.opener.close.push(entry); break;
    }
  }
  return result;
}
```

`publishSync()` 메서드 확장:
```ts
async publishSync(gatewayId: string) {
  const { config, schedule } = await this.getFullConfig(gatewayId);
  const channelMapping = await this.buildChannelMapping(gatewayId);   // 신규
  await this.mqtt.publishFallbackRulesSync(gatewayId, {
    version: config.version,
    config: { /* 기존 */ },
    schedule: [ /* 기존 */ ],
    channelMapping,                                                    // 신규
  });
}
```

### 4.2 자동 sync 트리거 — EventEmitter 기반

**이벤트 발행 측** (`DevicesService` + 관련 모듈):

```ts
// devices.service.ts
import { EventEmitter2 } from '@nestjs/event-emitter';

async create(dto: CreateDeviceDto) {
  const device = await this.repo.save(...);
  this.eventEmitter.emit('device.changed', { gatewayId: device.gatewayId });
  return device;
}

async update(id: string, dto: UpdateDeviceDto) {
  // ... 기존 로직
  // gpioPin 또는 equipmentType 변경 시에만 이벤트 발행 (불필요 sync 억제)
  if ('gpioPin' in dto || 'equipmentType' in dto || 'channel' in dto) {
    this.eventEmitter.emit('device.changed', { gatewayId: existing.gatewayId });
  }
}

async remove(id: string) {
  const target = await this.repo.findOneOrFail({ where: { id } });
  await this.repo.delete(id);
  this.eventEmitter.emit('device.changed', { gatewayId: target.gatewayId });
}
```

**이벤트 구독 측** (`FallbackConfigService`):

```ts
@OnEvent('device.changed', { async: true })
async handleDeviceChanged(payload: { gatewayId: string }) {
  await this.bumpVersionAndSync(payload.gatewayId);  // 기존 메서드 재사용
}
```

> 기존 `bumpVersionAndSync()`는 version 증가 + publish 둘 다 수행. 그대로 활용.

### 4.3 Module 의존성

```
DevicesModule (이벤트 발행)
   │ EventEmitterModule (이미 app.module에 forRoot로 등록됨)
   │
FallbackConfigModule (이벤트 구독)
```

`FallbackConfigModule`에 `DevicesModule` import 불필요 (EventEmitter는 글로벌). 단 entity는 이미 import됨.

### 4.4 변경 영향이 없는 부분
- DB 마이그레이션: 추가 없음
- MQTT 토픽: 새 토픽 없음 (페이로드만 v2)
- REST API: 변경 없음 (UI는 자동으로 최신 매핑 표시 — Phase 3 후속)

---

## 5. RPi 측 변경

### 5.1 `lib/rule-store.js` 신규 메서드

```js
// 기존 cache 구조에 channelMapping 추가
class RuleStore {
  applySync(payload) {
    // ... 기존 검증 + cache 갱신
    this.cache = {
      version, config, schedule,
      channelMapping: payload.channelMapping || null,  // 신규
    };
    this.persist();
  }

  channelMapping() {
    return this.cache?.channelMapping || null;
  }

  /**
   * 카테고리별 채널명 배열 반환.
   * @param category 'irrigation' | 'fertilizer' | 'fan' | 'opener_open' | 'opener_close'
   */
  getChannels(category) {
    const cm = this.channelMapping();
    if (!cm) return [];
    if (category === 'opener_open')  return (cm.opener?.open  || []).map(e => e.channel);
    if (category === 'opener_close') return (cm.opener?.close || []).map(e => e.channel);
    return (cm[category] || []).map(e => e.channel);
  }

  /**
   * 채널명 → {slot, pin} 매핑 조회.
   */
  findMapping(channel) {
    const cm = this.channelMapping();
    if (!cm) return null;
    const allEntries = [
      ...(cm.irrigation || []),
      ...(cm.fertilizer || []),
      ...(cm.fan || []),
      ...(cm.opener?.open || []),
      ...(cm.opener?.close || []),
    ];
    return allEntries.find(e => e.channel === channel) || null;
  }
}
```

기본값 `DEFAULT_RULES`에는 `channelMapping: null` 추가 (cold boot 시 매핑 없음을 의미).

### 5.2 `lib/rule-evaluator/*.js` 동적 채널 조회로 변경

**`irrigation.js`**:
```js
// 기존: const IRRIGATION_CHANNELS = ['zone_1', ...];  ← 제거
function evaluate({ cfg, state, now, relay, queue, store }) {
  if (!cfg.irrigationEnabled) return;
  const channels = store.getChannels('irrigation');   // 동적 조회
  for (const ch of channels) {
    // ... 기존 onSince 타임아웃 로직
  }
}
module.exports = { evaluate };  // 상수 export 제거
```

**`fertilizer.js`, `fan.js`** 동일 패턴.

**`opener.js`**:
```js
function evaluate({ cfg, store, state, rainActive, now, relay, queue }) {
  // ...
  const openChannels = store.getChannels('opener_open');
  const closeChannels = store.getChannels('opener_close');
  // setOpenerIntent 내부에서 위 배열 사용
}
```

**`rule-evaluator/index.js`** `emergencyStopAll()`:
```js
emergencyStopAll() {
  const all = [
    ...this.store.getChannels('irrigation'),
    ...this.store.getChannels('fertilizer'),
    ...this.store.getChannels('fan'),
    ...this.store.getChannels('opener_open'),
    ...this.store.getChannels('opener_close'),
  ];
  for (const ch of all) this.relay.setRelay(ch, false, 'emergency-stop');
}
```

### 5.3 `lib/relay-bridge.js` channel → pin 변환

```js
class RelayBridge {
  constructor({ client, gatewayId, store }) {  // store 주입
    this.client = client;
    this.gatewayId = gatewayId;
    this.store = store;
  }

  setRelay(channel, state, reason) {
    if (!this.client?.connected) return;
    const mapping = this.store.findMapping(channel);
    if (!mapping) {
      console.warn(`[RELAY-BRIDGE] 채널 ${channel} 매핑 없음 — drop`);
      return;
    }
    const payload = JSON.stringify({
      slot: mapping.slot,
      pin: mapping.pin,
      state,
      source: 'fallback',
      bypass: true,                     // command-gate 우회
      reason: reason || 'fallback-rule',
      requestId: Date.now(),
      ts: new Date().toISOString(),
    });
    this.client.publish(`farm/${this.gatewayId}/gpio/relay`, payload, { qos: 1 });
  }
}
```

### 5.4 폴백 진입 시 안전망

`index.js`의 mode-state-machine 진입 콜백에서, `channelMapping`이 null이면 즉시 emergency-stop:

```js
if (changed && fsm.mode === 'fallback') {
  if (!store.channelMapping()) {
    console.error('[FALLBACK] channelMapping 미동기화 — emergency-stop 발행');
    evaluator.emergencyStopAll();  // store에 매핑 없어도 작동 가능하도록 fallback case 추가 필요
  }
}
```

→ Plan §6 첫 번째 위험("매핑 미수신 → 무동작")의 완화책.

→ 더 단순한 완화: `emergencyStopAll()`이 매핑 없으면 광범위 패턴(switch_1~12 OFF)을 발행하는 fallback path 추가.

---

## 6. 작업 순서 (Do 단계)

### Phase A — 백엔드 (1.5일)
1. `FallbackConfigService.buildChannelMapping()` 구현 + Devices repo 주입
2. `publishSync()` 확장 → payload v2 (channelMapping 포함)
3. `@OnEvent('device.changed')` 핸들러 추가
4. `DevicesService.create/update/remove`에 `eventEmitter.emit('device.changed')` 호출 추가
5. unit smoke: 매핑 빌더 결과 확인

### Phase B — RPi (2일)
6. `rule-store.js`에 channelMapping 캐시 + 3개 메서드
7. rule-evaluator 4종에서 하드코딩 제거 → store 동적 조회
8. `relay-bridge.js`에 store 주입 + channel→pin 변환
9. `index.js`에서 RelayBridge 생성 시 store 전달
10. 폴백 진입 시 매핑 미동기화 안전망 (emergencyStopAll fallback path)

### Phase C — 통합 + E2E (1.5일)
11. 백엔드 빌드 + RPi 구문 체크
12. 실기 E2E (장치 추가 → MQTT sync → 폴백 동작 확인)
13. 8ch/12ch 자동 감지 검증
14. 회귀 테스트 (online 모드 정상 동작 여부)

**총 5일** (Plan 추정과 일치)

---

## 7. E2E 테스트 시나리오

| # | 시나리오 | 기대 결과 |
|---|----------|-----------|
| 1 | 신규 zone_5 device 등록 (gpio_pin=18) | MQTT `fallback/rules/sync` 즉시 발행, RPi rules.json에 zone_5 매핑 추가 |
| 2 | zone_3 device 삭제 | sync 재발행, RPi에서 zone_3 매핑 제거 → 폴백 시 zone_3 무시 |
| 3 | zone_2의 gpio_pin을 17→18로 변경 | sync 재발행, RPi가 즉시 새 핀으로 매핑 |
| 4 | 폴백 모드에서 zone_1 ON → 30분 경과 | RelayBridge가 `{slot:'switch_2', pin:17, state:false}` publish → gpio-agent가 정확히 BCM 17 OFF |
| 5 | 12ch 컨트롤러로 zone_5~8 등록 후 폴백 진입 | RPi가 8개 zone 모두 타임아웃 평가 |
| 6 | RPi 재부팅 후 retained sync 자동 수신 | channelMapping 복원, 정상 동작 |
| 7 | 백엔드 다운 + RPi 단독 부팅 (매핑 없음) | 폴백 진입 시 emergencyStopAll 발행 (안전 우선) |
| 8 | 동시에 룰 변경 + device 변경 발생 | 두 변경이 단일 sync 메시지로 통합 (debounce 또는 단순 version++ 2회 모두 처리) |
| 9 | gpio_pin이 NULL인 device 등록 | sync에서 제외 (warn log) |
| 10 | 미지원 channel(`unknown_x`) 등록 | sync에서 제외 (warn log) |

---

## 8. 위험 및 완화

| 위험 | 영향 | 완화책 |
|------|------|--------|
| 매핑 미수신 RPi → 폴백 시 무동작 | High | 폴백 진입 시 매핑 null이면 즉시 emergencyStopAll (안전 우선) |
| EventEmitter 이벤트 누락 (트랜잭션 롤백 등) | Medium | 정기 sync (예: 1시간마다) 추가 또는 사용자 수동 resync 버튼 활용 |
| 동시 device CRUD 발생 시 race condition | Low | DB row level lock + version 단조증가 idempotent |
| 12ch 자동 감지 오인 (zone_5만 등록된 경우) | Low | zone_5만 있어도 12ch로 판단 — 정확함. 잘못된 결과 없음 |
| 매핑 변경 직후 폴백 진입 (sync 미반영) | Low | retained 메시지 + RPi 재시작 시 자동 복원으로 결국 정합 |
| Devices module → FallbackConfig 의존성 우회 | None | EventEmitter 패턴으로 모듈 간 직접 의존 없음 |

---

## 9. 회귀 영향 (선행 사이클 보호)

| 선행 사이클 기능 | 영향 | 확인 방법 |
|------------------|------|----------|
| 폴백 룰 데이터 동기화 | ✅ 무영향 (페이로드 v2 호환) | 시나리오 6 |
| 월별 스케줄 평가 | ✅ 무영향 (opener channel만 동적화) | 시나리오 4 |
| 빗물 override | ✅ 무영향 (opener 채널 동적 조회만 변경) | 별도 |
| WebSocket mode-change | ✅ 무영향 | 별도 |
| systemd 서비스 | ✅ 무영향 | 별도 |
| UI 페이지 | ✅ 무영향 (백엔드 sync만 변경) | 별도 |

---

## 10. 결정 요청

1. **이 설계로 `/pdca do rpi-fallback-channel-sync` 진행할까요?**
2. **시드 채널 매핑 처리**: 운영 중인 농장의 `devices.gpio_pin`이 모두 정확히 입력되어 있나요? NULL이 많으면 본 사이클 진행 전에 데이터 정합성 작업 필요할 수 있습니다.
3. **회귀 테스트 우선순위**: 본 사이클 완료 후 선행 사이클의 E2E 시나리오 10종도 다시 돌릴까요? (시간 절약 위해 spot check 권장)
