# Plan: 라즈베리파이 폴백 채널-핀 매핑 동기화

**Feature ID**: `rpi-fallback-channel-sync`
**작성일**: 2026-05-21
**작성자**: bkit PDCA (sadojs@gmail.com)
**선행 사이클**: `rpi-emergency-failover` (Match Rate 98%)
**상태**: Plan

---

## 1. 배경 및 문제 정의

선행 PDCA 사이클(`rpi-emergency-failover`)에서 발견된 **운영 차원의 미구현 부분**을 해결하기 위한 분리 사이클입니다.

### 발견된 문제 (운영 불가)

선행 사이클 완료 후 사용자 검토에서 다음 4가지 핵심 누락이 식별되었습니다:

1. **fallback-engine의 RelayBridge가 gpio-agent와 호환되지 않음**
   - `gpio-agent`는 `{ slot, pin: BCM번호, state }` 형식 메시지를 받음
   - `RelayBridge.setRelay()`는 `{ channel: 'zone_1', state }`만 publish — `pin` 필드 없음
   - **결과**: 폴백 모드에서 룰이 평가돼도 실제 릴레이는 안 움직임

2. **장치 채널이 RPi 코드에 하드코딩됨**
   ```js
   const IRRIGATION_CHANNELS = ['zone_1', 'zone_2', 'zone_3', 'zone_4']; // 8ch 가정
   ```
   - 12채널 컨트롤러 사용 시 `zone_5~8` 미인식
   - 농장별로 다른 장치 구성 대응 불가

3. **장치 추가/삭제 시 RPi 자동 갱신 없음**
   - 서버에서 device CRUD 또는 `gpio_pin` 변경 시 RPi에 동기화하는 메커니즘 없음
   - UI에서 장치 추가해도 폴백에선 인식 못 함

4. **setup.sh는 인프라만 설치 — 장치 매핑은 별도 동기화 필요**
   - 라즈베리파이 양산 시점에 농장 구성 모르므로 setup.sh로 처리 불가능
   - 동적 동기화 필수

---

## 2. 목표 (Goal)

**최소 목표 (Must-Have)**:
- fallback-engine이 폴백 모드에서 실제 GPIO 릴레이를 정확히 제어
- 농장별 채널 구성(8ch/12ch + 실제 등록된 zone 수)을 RPi가 동기화 받음
- 서버에서 device 추가/삭제/gpio_pin 변경 시 RPi에 자동 반영

**확장 목표 (Nice-to-Have, 본 사이클 제외)**:
- 채널 매핑 자체를 UI에서 편집 (현재는 `channel-mapping.constants.ts` 기본값 사용)
- 매핑 변경 이력 추적

---

## 3. 범위 (Scope)

### In Scope
- `fallback/rules/sync` 메시지에 `channelMapping` 필드 추가 (channel → BCM pin 매핑)
- 서버 device CRUD에서 fallback sync 자동 트리거
- RPi `rule-store`에 channelMapping 저장
- RPi `RelayBridge`에서 channel → pin 변환 + gpio-agent 호환 payload 발행
- 8ch/12ch 자동 감지 (gateway 또는 device controller_type 활용)
- E2E: 장치 추가 → sync 메시지 → 폴백 동작 확인

### Out of Scope
- 채널 매핑 자체 변경 (DB 스키마 추가, UI 편집 — 후속 PDCA)
- 채널 매핑 변경 이력 추적
- 다중 컨트롤러 (한 게이트웨이에 8ch + 12ch 동시) — 현재 1게이트웨이 1컨트롤러 가정

---

## 4. 기술 접근

### 4.1 서버 → RPi 동기화 payload 확장

기존 `fallback/rules/sync` 메시지에 `channelMapping` 추가:

```jsonc
{
  "version": 5,
  "config": { ... 기존 폴백 설정 ... },
  "schedule": [ ... 월별 스케줄 ... ],
  // 신규 추가
  "channelMapping": {
    "irrigation": [
      { "channel": "zone_1", "slot": "switch_2", "pin": 17 },
      { "channel": "zone_2", "slot": "switch_3", "pin": 27 },
      { "channel": "zone_3", "slot": "switch_4", "pin": 22 },
      { "channel": "zone_4", "slot": "switch_5", "pin": 23 }
    ],
    "fertilizer": [
      { "channel": "fertilizer_b_contact", "slot": "switch_6", "pin": 24 },
      { "channel": "mixer", "slot": "switch_usb1", "pin": 25 },
      { "channel": "fertilizer_motor", "slot": "switch_usb2", "pin": 26 }
    ],
    "fan": [
      { "channel": "fan", "slot": "switch_7", "pin": 5 }
    ],
    "opener": {
      "open": [{ "channel": "opener_open", "slot": "switch_8", "pin": 6 }],
      "close": [{ "channel": "opener_close", "slot": "switch_9", "pin": 13 }]
    }
  }
}
```

> **출처**: 백엔드에서 `devices` 테이블의 `gpio_pin` + `channel-mapping.constants.ts`의 channel ↔ slot 매핑을 조합해 빌드.

### 4.2 자동 sync 트리거

`DevicesService` (또는 `GpioService`)의 CRUD 메서드에 sync 호출 훅 추가:

```ts
// devices.service.ts
async create(...) {
  const device = await this.repo.save(...);
  await this.fallbackConfigService.publishSync(device.gatewayId); // 추가
  return device;
}
```

또는 이벤트 기반 (`EventEmitter`):
```ts
this.eventEmitter.emit('device.changed', { gatewayId });
// fallback-config.service가 @OnEvent로 받아서 publishSync 호출
```

→ 두 번째 방식 권장 (모듈 간 직접 의존 줄임).

### 4.3 RPi 측 변경

**`rule-store.js`**:
- `channelMapping` 캐시 + getter 메서드 추가

**`rule-evaluator/*.js`**:
- 하드코딩된 `*_CHANNELS` 상수 제거
- `store.getChannels('irrigation')` 등 동적 조회로 변경

**`relay-bridge.js`**:
- `setRelay(channel, state, reason)` → 내부에서 store로부터 `{slot, pin}` 조회 후 gpio-agent 호환 payload 발행

```js
setRelay(channel, state, reason) {
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
    bypass: true,
    requestId: Date.now(),
  });
  this.client.publish(`farm/${gw}/gpio/relay`, payload, { qos: 1 });
}
```

### 4.4 8ch/12ch 자동 감지

후보 위치:
- `gateways.controller_type` 컬럼 (없으면 추가) — `'8ch'` | `'12ch'`
- 또는 `devices.controller_type` (디바이스별)
- 또는 `channel-mapping.constants.ts`에서 등록된 channel 개수로 자동 판단

→ 가장 간단한 접근: **백엔드가 sync 빌드 시 등록된 devices의 channel + gpio_pin만 포함**. 8ch/12ch 구분 없이 실제 등록된 채널만 동기화. 등록 안 된 채널은 fallback-engine이 무시.

---

## 5. 작업량 산정

| 작업 | 위치 | 시간 |
|------|------|------|
| 1. `channelMapping` 빌드 서비스 (devices + constants 조회) | backend `fallback-config.service.ts` | 0.5일 |
| 2. `fallback/rules/sync` payload에 `channelMapping` 추가 | backend | 0.5일 |
| 3. `DevicesService` 변경 → 자동 sync 트리거 (event 기반) | backend devices module | 0.5일 |
| 4. `OnEvent('device.changed')` 핸들러 in fallback-config | backend | 0.5일 |
| 5. RPi `rule-store`에 channelMapping 저장 + getter | RPi `rule-store.js` | 0.5일 |
| 6. RPi rule-evaluator 4종 채널 동적화 | RPi `rule-evaluator/*` | 1일 |
| 7. RPi `relay-bridge` channel → pin 변환 | RPi `relay-bridge.js` | 0.5일 |
| 8. emergency-stop도 동적 채널 사용 | RPi `rule-evaluator/index.js` | 0.5일 |
| 9. E2E 테스트 (장치 추가 → sync → 동작) | qa-monitor | 0.5일 |
| **합계** | | **약 5일** |

> 선행 사이클의 4.5일 추정에 emergency-stop 동적화(8번)와 정확한 OnEvent 구현(4번) 추가하여 5일로 조정.

---

## 6. 위험 및 완화

| 위험 | 영향 | 완화책 |
|------|------|--------|
| 장치 매핑 미수신 RPi가 폴백 진입 → 무동작 | High | RPi가 channelMapping 없으면 폴백 진입 시 즉시 emergency-stop 발행 (이전 상태 OFF) |
| sync 빈도 증가로 MQTT 부하 | Low | device CRUD 빈도는 분당 1회 미만 — 부담 없음 |
| 12ch 게이트웨이에서 channel 8개만 등록된 경우 | Medium | "등록된 channel만 동기화" 정책 → 정확히 등록한 만큼만 동작 |
| 룰은 enable인데 매핑이 없는 경우 | Medium | UI에서 경고 표시 + RPi 측 log warn |
| 폴백 모드 중 sync 메시지 수신 | Low | rules/sync는 retained이므로 진입 직후에도 최신값 자동 수신 |

---

## 7. 의사결정 요청

1. **이대로 Plan 승인하고 `/pdca design rpi-fallback-channel-sync` 진행할까요?**
2. **선행 사이클 (`rpi-emergency-failover`) 처리 방법**:
   - **A**: 현재 상태에서 `/pdca report rpi-emergency-failover` 작성 + "Known Limitation: 채널-핀 매핑 미동기화 — 본 사이클로 분리" 명시 (권장)
   - **B**: 선행 사이클을 보류 상태로 두고 본 사이클 완료 후 통합 report
   - **C**: 두 사이클을 합쳐 단일 report (rpi-emergency-failover에 본 사이클 결과 포함)
3. **8ch/12ch 처리 방법**:
   - **A**: 등록된 device만 동기화 (controller_type 컬럼 없이) — 권장
   - **B**: `gateways.controller_type` 컬럼 추가 후 명시적 구분

---

## 8. 다음 단계 (Plan 승인 시)

```
/pdca design rpi-fallback-channel-sync
```

Design 문서에서 다룰 항목:
- `fallback/rules/sync` payload v2 명세 (channelMapping 스키마)
- EventEmitter 기반 device.changed 이벤트 명세
- RPi rule-store 신규 메서드 (`getChannels(category)`, `findMapping(channel)`)
- E2E 시나리오 (장치 CRUD → 폴백 동작 7종)
- 마이그레이션 필요 여부 (현재로선 불필요 예상)
