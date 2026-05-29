# Smart Farm MQTT — Device Control Logic

> 장치 제어 / 자동화 룰 평가 / 폴백 동작 로직의 **실제 동작 규칙**을 소스 코드에서 직접 추출. 모든 항목에 근거 파일/라인을 명시. 추측은 ⚠️로 표시.

---

## 1. 장치 분류

테이블: `devices.equipment_type` ([schema.sql:102](../backend/database/schema.sql#L102))

| equipment_type | 의미 | 제어 방식 |
|----------------|------|-----------|
| `fan` | 유동/환기팬 | ON/OFF (Zigbee 또는 onboard GPIO) |
| `irrigation` | 관수 컨트롤러 (8/12CH 릴레이 보드) | 채널 매핑 기반 스위치 다중 제어 |
| `opener_open` | 개폐기 — 열림 모터 | ON/OFF (페어 인터록 필수) |
| `opener_close` | 개폐기 — 닫힘 모터 | ON/OFF (페어 인터록 필수) |
| `other` | 기타 | 일반 ON/OFF |

연결 방식 (`devices.source`):
- `onboard`: RPi GPIO 핀에 직결된 릴레이 → `farm/{gw}/gpio/relay` 토픽
- (그 외): Zigbee 장치 → `farm/{gw}/z2m/{friendlyName}/set` 토픽

근거: [devices.service.ts:294-353](../backend/src/modules/devices/devices.service.ts#L294-L353)

### 1.1 단일 라우팅 진입점 — `publishDeviceSwitch()`
사용자 직접 제어 / 자동화 스케줄러 / 강제 중단 등 **모든 경로가 같은 helper를 통해 publish**합니다.

```ts
async publishDeviceSwitch(device, gateway, switchCode, value) {
  if (device.source === 'onboard') {
    await publishOnboardRelay(gateway.gatewayId, gateway.id, switchCode, value);
    // → farm/{gw}/gpio/relay  {slot, pin, state, requestId}
  } else {
    await mqttService.controlDevice(gateway.gatewayId, device.friendlyName, { [switchCode]: value });
    // → farm/{gw}/z2m/{friendly}/set  {switchCode: state}
  }
}
```
- onboard slot lookup은 **반드시 `gateway_id`로 필터** ([devices.service.ts:48-68](../backend/src/modules/devices/devices.service.ts#L48-L68)) — 동일 `slot_key`가 여러 게이트웨이에 존재할 수 있음
- `gpio_pin` 미할당 슬롯(예: `remote_control` 논리 슬롯)은 silently skip — DB `device_settings.switchStates`에만 기록되어 UI 상태 유지
- 호출 위치:
  - 사용자/UI: `devices.service.ts` `controlDevice()` 안의 onboard 분기
  - 자동화 메인 파이프라인: `irrigation-scheduler.service.ts:199`
  - 자동화 강제 중단: `irrigation-scheduler.service.ts:408`

---

## 2. GPIO 하드웨어 동작 규칙

### 2.1 핀 범위
- 허용 BCM 핀: **2~27** ([gpio-agent/index.js:23-26](../raspberry-pi/gpio-agent/index.js#L23-L26))
- I2C/SPI/UART 점유 핀은 raspi-config 또는 dtoverlay로 일반 GPIO로 전환해야 사용 가능

### 2.2 GPIO Chip
| Pi 모델 | gpiochip |
|---------|----------|
| RPi 3B / 3B+ / 4 | `gpiochip0` |
| RPi 5 | `gpiochip4` |

환경변수 `GPIO_CHIP` 으로 지정. 기본값 `gpiochip0` ([gpio-agent/index.js:13](../raspberry-pi/gpio-agent/index.js#L13))

### 2.3 Active LOW / Active HIGH
릴레이 모듈에 따라 다름:
- `GPIO_ACTIVE_LOW=true`: ON=핀 LOW(0), OFF=핀 HIGH(1)
- `GPIO_ACTIVE_LOW=false` (기본): ON=핀 HIGH(1), OFF=핀 LOW(0)

변환 로직: [gpio-agent/index.js:94-98](../raspberry-pi/gpio-agent/index.js#L94-L98)
```javascript
const level = ACTIVE_LOW ? (state ? 0 : 1) : (state ? 1 : 0);
```

### 2.4 Open-Drain 모드 (3.3V GPIO → 5V VCC 릴레이 안전 차단)
`GPIO_OPEN_DRAIN=true`이면 `gpioset --drive open-drain --bias pull-up` 사용:
- LOW: GPIO 0V → 옵토커플러 ON (릴레이 ON)
- HIGH-Z + pull-up: IN 핀 ~3.79V → 옵토커플러 OFF (전류 0.01mA, 릴레이 완전 OFF)

근거: [gpio-agent/index.js:55-65](../raspberry-pi/gpio-agent/index.js#L55-L65)

### 2.5 안전 초기화 핀
`GPIO_INIT_PINS=17,27` 처럼 쉼표로 지정하면 gpio-agent 부팅 시 해당 핀들을 강제 OFF로 초기화 — 부팅 직후 의도치 않은 ON 방지.

근거: [gpio-agent/index.js:29-30, 192-198](../raspberry-pi/gpio-agent/index.js#L192-L198)

### 2.6 자동 OFF 타이머 (`durationMs`)
서버가 `{ pin, state: true, durationMs: 30000 }`로 publish하면 30초 후 자동 OFF — gpio-agent 내부 타이머. 같은 핀에 새 명령이 오면 기존 타이머 취소. ([gpio-agent/index.js:159-173](../raspberry-pi/gpio-agent/index.js#L159-L173))

### 2.7 고아 프로세스 정리
gpio-agent 재시작 시 이전 `gpioset` 프로세스가 GPIO 칩을 점유한 채로 죽어 있으면 "Device or resource busy" 발생. 시작 시 `pkill -9 -f "gpioset.*${GPIO_CHIP}"` 로 강제 정리 ([gpio-agent/index.js:34-38](../raspberry-pi/gpio-agent/index.js#L34-L38))

---

## 3. 개폐기 (Opener) — 인터록 규칙

### 3.1 페어 구조
- `opener_open` + `opener_close` 두 장치를 등록하면 등록 단계에서 자동으로 `paired_device_id` 양방향 연결됨
- 코드: [devices.service.ts:171-185](../backend/src/modules/devices/devices.service.ts#L171-L185)
- 둘이 동시에 ON되면 모터 단락/소손 위험 → 반드시 **반대편 OFF → 1초 대기 → 목표 ON** 순서

### 3.2 백엔드 ON 명령 시 인터록
사용자/자동화가 `controlDevice(open ON)` 호출하면:

1. `device.equipmentType === 'opener_*'` && `isOnCmd === true` && `pairedDeviceId` 존재 → 인터록 분기
2. `paired` 장치 조회 → 그 게이트웨이에:
   - paired가 onboard면: `publishGpioRelay({ pin, state: false })`
   - paired가 Zigbee면: `controlDevice(... { state: 'OFF' })`
3. `await new Promise(r => setTimeout(r, 1000))` — **정확히 1초 대기**
4. 목표 장치 ON 명령 publish

근거: [devices.service.ts:294-322](../backend/src/modules/devices/devices.service.ts#L294-L322)

### 3.3 자동화 룰 평가 시 페어 라우팅
자동화 룰이 단일 장치만 가리켜도 히스테리시스 방향에 따라 페어를 바꿔 실행:
- `hysteresisAction === 'on'` (온도 ≥ ON 임계) → 열림(`opener_open`) 장치
- `hysteresisAction === 'off'` (온도 ≤ OFF 임계) → 닫힘(`opener_close`) 장치

코드: `resolveOpenerTargets()` — [automation-runner.service.ts:819-837](../backend/src/modules/automation/automation-runner.service.ts#L819-L837)

### 3.4 우적 우회 (Rain Override) — 최우선
- 비 감지(`rain` 또는 `rain_detection`) ACTIVE인 동안 개폐기 룰은 **자동 skip** (모드 무관)
- 폴백 모드에서도 RPi `rain-override` 모듈이 모든 모드 무시하고 강제 CLOSE
- 코드: [automation-runner.service.ts:121-124](../backend/src/modules/automation/automation-runner.service.ts#L121-L124), [fallback-engine/lib/rule-evaluator/opener.js:54-57](../raspberry-pi/fallback-engine/lib/rule-evaluator/opener.js#L54-L57)

### 3.5 종속성 잠금
- 자동화 룰이 참조 중인 개폐기는 **개별 삭제 불가** → `DELETE /devices/:id/opener-pair` 로 쌍 단위만
- 코드: [devices.service.ts:463-493](../backend/src/modules/devices/devices.service.ts#L463-L493)

### 3.6 예시 시나리오

#### 예 A — 온도 기반 개폐 (히스테리시스)
**조건**:
```json
{
  "field": "internal_temp", "operator": "gt", "value": 28, "deviation": 2,
  "relay": true, "relayOnSeconds": 30, "relayOffSeconds": 60
}
```
- ON 임계 = 28+2 = **30°C**, OFF 임계 = 28−2 = **26°C**
- 26 ~ 30°C 사이는 `hold` (현 상태 유지) — 채터링 방지
- relay 모드: 30초 ON / 60초 OFF 펄스 (1사이클 90초)

**타임라인** (외부 온도가 25 → 31 → 27 → 25로 변하는 경우):

| 시각 | 온도 | hysteresisAction | 페어 라우팅 | 동작 |
|------|------|------------------|-------------|------|
| 09:00 | 25°C | (조건 미발화) | — | 정지 |
| 09:30 | 31°C | `on` (≥30) | `opener_open` 선택 | 30s ON / 60s OFF 펄스 시작 |
| 09:32 | 30°C | `on` | `opener_open` | 펄스 계속 (epoch 기준 사이클) |
| 10:00 | 27°C | `hold` (26~30) | — | **현 상태 유지** (계속 펄스) |
| 10:15 | 25°C | `off` (≤26) | `opener_close` 자동 스위칭 | 30s ON / 60s OFF 펄스 (닫힘) |

→ 사용자는 1개 룰에 1개 장치(예: `opener_open`)만 지정해도, 히스테리시스가 'off'면 `resolveOpenerTargets()`가 페어인 `opener_close`로 자동 전환 ([automation-runner.service.ts:819-837](../backend/src/modules/automation/automation-runner.service.ts#L819-L837)).

#### 예 B — 습도 기반 개폐 (단방향 트리거)
**조건**:
```json
{ "field": "internal_humidity", "operator": "gt", "value": 85, "relay": true, "relayOnSeconds": 30, "relayOffSeconds": 90 }
```
- `deviation` 없음 → 히스테리시스 비사용, `operator > 85`만 평가
- 룰이 활성 동안: 30s 열림 / 90s 정지 사이클 (epoch 기준)
- 습도 ≤ 85가 되면 다음 evaluation cycle에서 `matched=false`로 펄스 중단

**타임라인** (습도가 80 → 88 → 86 → 84로 변하는 경우):

| 시각 | 습도 | matched | 동작 |
|------|------|---------|------|
| 08:00 | 80% | false | 정지 |
| 08:10 | 88% | true | 30s `opener_open` ON → 90s OFF (반복) |
| 08:30 | 86% | true | 반복 계속 |
| 08:45 | 84% | false | 다음 펄스 중단 (현재 ON 중이면 자연 OFF) |

#### 예 C — 시간 기반 개폐
**조건**:
```json
{ "field": "time", "operator": "between", "value": [600, 1080], "daysOfWeek": [1,2,3,4,5], "relay": true, "relayOnMinutes": 5, "relayOffMinutes": 30 }
```
- 10:00 ~ 18:00 (600~1080분), 월~금
- 5분 ON / 30분 OFF 펄스 (분 단위 사이클, `value[0]=600` 기준점)
- 페어 라우팅: 시간 룰은 hysteresis 없이 `command: 'on'` (개폐기는 사용자가 룰 actions에서 `opener_open` 명시 필요)

**타임라인** (월요일):

| 시각 | elapsedMin from 10:00 | cyclePosition (mod 35) | isOnPhase | 동작 |
|------|----------------------|------------------------|-----------|------|
| 10:00 | 0 | 0 | true | 열림 ON |
| 10:05 | 5 | 5 | false | 열림 OFF (30분 대기 시작) |
| 10:35 | 35 | 0 | true | 열림 ON (2번째 사이클) |
| ... | ... | ... | ... | 18:00까지 13.7회 반복 |
| 18:00 | 480 | — | — | 시간 조건 종료, 룰 사이클 비활성 |

근거: [automation-runner.service.ts:754-793](../backend/src/modules/automation/automation-runner.service.ts#L754-L793)

---

## 4. 유동팬 (Fan)

### 4.1 일반 모드 (자동화 룰 + 시간 슬롯 / 센서 임계값)
- 시간 기반: `conditions.timeSlots: [{start, end}]` (분단위 또는 시간단위 자동 정규화)
- 센서 기반: `deviation`을 주면 자동 히스테리시스 — 온도 > value+dev → ON, 온도 < value-dev → OFF
- 코드: [automation-runner.service.ts:373-413](../backend/src/modules/automation/automation-runner.service.ts#L373-L413)

### 4.2 폴백 모드
- `fallback_configs.fan_enabled`가 true이고, 외부 온도 센서가 있을 때만 동작
- ON 임계: `fan_on_temp` (기본 35°C), OFF 임계: `fan_off_temp` (기본 28°C)
- DB 제약: `CHECK (fan_on_temp > fan_off_temp)` — 히스테리시스 안전성 보장
- 다중 팬 슬롯(fan_1~fan_4 등) 동시 제어
- 코드: [fallback-engine/lib/rule-evaluator/fan.js](../raspberry-pi/fallback-engine/lib/rule-evaluator/fan.js)

### 4.3 예시 시나리오

#### 예 A — 온도 히스테리시스 (가장 흔한 패턴)
**조건**:
```json
{ "field": "internal_temp", "operator": "gt", "value": 30, "deviation": 2 }
```
- ON 임계 = 30+2 = **32°C**, OFF 임계 = 30−2 = **28°C**

**동작**: 단순 ON/OFF (relay 모드 아님) — 매분 평가에서 `hysteresisAction`에 따라 즉시 전환

| 시각 | 내부 온도 | hysteresisAction | lastState | 액션 |
|------|----------|------------------|-----------|------|
| 12:00 | 27°C | `off` (≤28) | inactive | 동작 없음 (이미 OFF) |
| 12:15 | 33°C | `on` (≥32) | inactive → active | **팬 ON** publish |
| 12:30 | 30°C | `hold` (28~32) | active | 유지 (계속 ON) |
| 12:45 | 27°C | `off` (≤28) | active → inactive | **팬 OFF** publish |

#### 예 B — 습도 기반 환기 (단방향)
**조건**:
```json
{ "field": "internal_humidity", "operator": "gt", "value": 80 }
```
- `deviation` 없음 → 즉시 트리거 (80% 초과 시 ON, 이하 시 OFF)
- ⚠️ 채터링 위험 — 79~81% 경계에서 빈번한 ON/OFF 가능. `deviation: 3` 추가 권장 (77/83)

| 시각 | 습도 | matched | 액션 |
|------|------|---------|------|
| 06:00 | 75% | false | 동작 없음 |
| 06:20 | 82% | true | 팬 ON |
| 06:35 | 79% | false | 팬 OFF |

#### 예 C — 시간 슬롯 (낮 환기)
**조건**:
```json
{ "field": "internal_temp", "operator": "any", "timeSlots": [{"start": 600, "end": 1080}], "daysOfWeek": [1,2,3,4,5,6,7] }
```
- 매일 10:00~18:00 (600~1080분)
- `timeSlots` 진입/이탈 시점에 발화 ([automation-runner.service.ts:391-413](../backend/src/modules/automation/automation-runner.service.ts#L391-L413))

| 시각 | currentMinutes | 평가 | 액션 |
|------|----------------|------|------|
| 09:59 | 599 | inActiveSlot=false | 동작 없음 |
| 10:00 | 600 | **start 일치 → timeAction='on'** | 팬 ON |
| 14:00 | 840 | inActiveSlot=true (현재 ON 유지) | 유지 |
| 18:00 | 1080 | **end 일치 → timeAction='off'** | 팬 OFF |

---

## 5. 관수 (Irrigation)

### 5.1 채널 매핑 (8CH / 12CH)
컨트롤러 보드의 물리 스위치 코드 → 기능 매핑.

**8채널 기본 ([channel-mapping.constants.ts:1-11](../backend/src/modules/devices/channel-mapping.constants.ts#L1-L11))**:
```
remote_control       → switch_1
zone_1               → switch_2
zone_2               → switch_3
zone_3               → switch_4
zone_4               → switch_5
fertilizer_b_contact → switch_6
mixer                → switch_usb1
fertilizer_motor     → switch_usb2
```

**12채널 기본 ([channel-mapping.constants.ts:14-27](../backend/src/modules/devices/channel-mapping.constants.ts#L14-L27))**: zone_5~zone_8까지 확장. `fertilizer_b_contact → switch_10`, `mixer → switch_11`, `fertilizer_motor → switch_12`

자동 감지: 장치의 switchCodes에 `switch_7~12`가 있으면 12CH, 아니면 8CH ([channel-mapping.constants.ts:61-63](../backend/src/modules/devices/channel-mapping.constants.ts#L61-L63))

장치별로 `devices.channel_mapping` JSONB로 오버라이드 가능 ([devices.service.ts:196-216](../backend/src/modules/devices/devices.service.ts#L196-L216), `farm_admin` 이상).

### 5.2 원격제어 (`remote_control`) 연동
- **ON 시**: `fertilizer_b_contact` 자동 동시 ON (액비 라인 활성화)
- **OFF 시**:
  - 매핑된 모든 스위치 강제 OFF
  - 해당 장비를 참조하는 모든 활성 관수 룰 자동 비활성화
- 코드: [devices.service.ts:251-292](../backend/src/modules/devices/devices.service.ts#L251-L292)

### 5.3 룰 활성화 시 원격제어 자동 ON
`PATCH /automation/rules/{id}/toggle?autoEnableRemote=true` 호출하면:
1. 룰의 대상 장치 추출
2. 각 장치에 `controlDevice(remote_switch, true)` → B접점도 자동 동반 ON
- 코드: [automation.service.ts:82-98, 395-416](../backend/src/modules/automation/automation.service.ts#L82-L98)

### 5.4 다중 스케줄 / 시간 평가
관수 룰은 **분 단위 cron** (`0 * * * * *`, 매분 0초)으로 평가 — [irrigation-scheduler.service.ts:60](../backend/src/modules/automation/irrigation-scheduler.service.ts#L60).

`shouldStartNow()`는 다중 스케줄을 지원:
```typescript
const scheduleList = conditions.schedules?.length > 0
  ? conditions.schedules
  : [{ startTime: conditions.startTime, days: conditions.schedule?.days ?? [], repeat: ... }];

return scheduleList.some(sched =>
  sched.days?.includes(now.getDay()) &&
  now.getHours() === H && now.getMinutes() === M
);
```
근거: [irrigation-scheduler.service.ts:77-87](../backend/src/modules/automation/irrigation-scheduler.service.ts#L77-L87)

### 5.5 관수 타임라인 빌드 (`buildTimeline`)
한 번 시작되면 각 구역을 순차로 가동. 한 구역의 시퀀스:

```
t=0           1구역 ON  + (mixer ON*)
t=Δ_a         액비모터 ON     (Δ_a = zoneDur - fertDur - preStop)
t=Δ_b         액비모터 OFF    (Δ_b = zoneDur - preStop)
t=zoneDur     1구역 OFF + (mixer OFF*)
t=zoneDur+wait  2구역 ON      ...

* mixer는 액비모터가 활성화(fertEnabled) + mixer 매핑 존재일 때만 발행 — 액상비료를 물에 녹이는 것이 목적
```

수식: [irrigation-scheduler.service.ts:267-368](../backend/src/modules/automation/irrigation-scheduler.service.ts#L267-L368)

각 액션은 `setTimeout()` 등록 → 시각이 되면 `devicesService.publishDeviceSwitch(device, gateway, switchCode, value)` 호출 ([irrigation-scheduler.service.ts:199](../backend/src/modules/automation/irrigation-scheduler.service.ts#L199)) — onboard는 gpio-agent, zigbee는 z2m로 source별 자동 라우팅 (§1.1 참고).

`remote_control`과 `fertilizer_b_contact`은 **타임라인에 포함되지 않습니다** — 룰 활성화 시 자동 ON되어 룰 종료 후에도 ON 유지 (백업장치 전환용으로 OFF 시 모든 관수 스위치도 동시 OFF). §5.2 / §5.3 참조.

### 5.6 액비 시간 검증 (3중 방어)
- 백엔드(룰 생성/수정 시): `automation.service.ts:199-222` — 위반 시 400 BadRequest
- 프론트: Automation.vue 위저드에서 사전 차단 (확인 필요 ⚠️)
- 스케줄러(실행 시): `buildTimeline`에서 `fertStartMs >= 0` 검사 후에만 추가 ([irrigation-scheduler.service.ts:323](../backend/src/modules/automation/irrigation-scheduler.service.ts#L323))

조건: 각 zone의 **관주시간 ≥ 액비투여시간 + 종료전대기**

### 5.7 비반복 룰 자동 비활성화
`conditions.schedule.repeat === false`이고 이번 주 남은 요일이 없으면 룰 자동 비활성화. 주간 순서는 월(1)→…→일(0) 기준 ([irrigation-scheduler.service.ts:212-228](../backend/src/modules/automation/irrigation-scheduler.service.ts#L212-L228)).

### 5.8 폴백 모드 — 안전 타임아웃
- 폴백 중에는 **신규 관수 ON 금지** (서버 명령은 command-gate에서 drop)
- 이미 ON된 채널은 `irrigation_max_runtime_minutes` (기본 30분, 최대 240분) 초과 시 강제 OFF
- 코드: [fallback-engine/lib/rule-evaluator/irrigation.js](../raspberry-pi/fallback-engine/lib/rule-evaluator/irrigation.js)

### 5.9 강제 중단
`stopByDevice(friendlyName)`:
1. 예약된 모든 `setTimeout` 취소
2. `activeIrrigations` 맵에서 제거
3. 매핑된 zone/mixer/fertilizer_motor 스위치 전부 OFF — `publishDeviceSwitch()`로 source별 라우팅
4. 취소 로그 기록 (`type: 'irrigation_cancelled'`)

근거: [irrigation-scheduler.service.ts:381-430](../backend/src/modules/automation/irrigation-scheduler.service.ts#L381-L430)

### 5.10 예시 시나리오

#### 예 A — 1+2 구역, 액비 활성 (사용자 표준 검증 시나리오)
**입력**: 08:00 시작, valve 1 활성화 10분, valve 2 활성화 10분, 쉬는시간 5분, 액비 ON (투여 5분, 종료전대기 2분), 액비모터 매핑됨 → 교반기 활성, valve 3·4 비활성

**계산**:
- Δ_a (액비 ON) = 10 − 5 − 2 = **3분**
- Δ_b (액비 OFF) = 10 − 2 = **8분**
- 2구역 시작 offset = 10 + 5 = **15분** (8:15)

**타임라인**:

| 시각 | offset | 액션 | switchCode (onboard 예) | MQTT 토픽 |
|------|--------|------|-------------------------|-----------|
| 07:59 | — | 룰 활성화 트리거 (FR-03) → `remote_control` + `fertilizer_b_contact` 자동 ON | relay_remote_control, relay_fertilizer_contact | gpio/relay |
| 08:00 | 0 | 1구역 ON + 교반기 ON | relay_zone_1, relay_mixer | gpio/relay |
| 08:03 | 3분 | 액비모터 ON | relay_fertilizer_motor | gpio/relay |
| 08:08 | 8분 | 액비모터 OFF | relay_fertilizer_motor | gpio/relay |
| 08:10 | 10분 | 1구역 OFF + 교반기 OFF | relay_zone_1, relay_mixer | gpio/relay |
| 08:10~15 | — | **대기 5분** (모두 OFF) | | |
| 08:15 | 15분 | 2구역 ON + 교반기 ON | relay_zone_2, relay_mixer | gpio/relay |
| 08:18 | 18분 | 액비모터 ON | relay_fertilizer_motor | gpio/relay |
| 08:23 | 23분 | 액비모터 OFF | relay_fertilizer_motor | gpio/relay |
| 08:25 | 25분 | 2구역 OFF + 교반기 OFF | relay_zone_2, relay_mixer | gpio/relay |
| 08:25 | — | `activeIrrigations.delete(ruleId)`, 룰 완료 로그 기록 | | |
| ↗ 룰 종료 후에도 `remote_control` + `fertilizer_b_contact` 계속 ON (사용자가 수동 OFF 안 했으면) | | | | |

#### 예 B — 코드 주석 표준 예 (30분 관수, 액비 10분)
**입력**: 10:00 시작, 관수 30분, 대기 5분, 액비 10분, 종료전대기 5분

**계산**:
- Δ_a = 30 − 10 − 5 = **15분**, Δ_b = 30 − 5 = **25분**

| 시각 | 액션 |
|------|------|
| 10:00 | 1구역 ON + 교반기 ON |
| 10:15 | 액비모터 ON (15분 후) |
| 10:25 | 액비모터 OFF (25분 후) |
| 10:30 | 1구역 OFF + 교반기 OFF |
| 10:35 | 2구역 ON ... (반복) |

#### 예 C — 액비 시간 초과 (검증 차단)
**입력**: 관수 5분, 액비 5분, 종료전대기 2분

**계산**: 액비총합(5+2=7분) > 관수시간(5분) → Δ_a = 5 − 5 − 2 = **−2분** < 0

**처리**:
1. Frontend `StepIrrigationValve.vue:150-159` — 사전 경고 표시
2. Backend `automation.service.ts:199-222` — 룰 저장 시 400 BadRequest
3. Scheduler `buildTimeline:329` — `fertStartMs >= 0` 검사 실패 → **액비 액션 자체 미생성** (zone만 ON/OFF, 액비/교반기 skip)

→ 운영 안전성: 3중 방어로 잘못된 룰이 실행 단계까지 가더라도 zone 동작은 보장.

### 5.11 onboard 중복 device 방지
**문제 사례 (2026-05-27)**: lgw-pilot02에 동일 `friendly_name='onboard_irrigation'` device가 6개 발생 (race condition).

**원인**: `ensureOnboardDevices()`가 동시 6회 호출되며 모두 `findOne()=null` 보고 INSERT.

**보호장치 (3중)**:
1. DB partial unique index ([migration 021](../backend/database/migrations/021_unique_onboard_irrigation.sql)):
   ```sql
   CREATE UNIQUE INDEX uniq_onboard_irrigation_per_gateway
     ON devices (gateway_id) WHERE source='onboard' AND equipment_type='irrigation';
   ```
2. Service-level guard ([gateway-env.service.ts:423-435](../backend/src/modules/gateway-env/gateway-env.service.ts#L423-L435)) — `find()`로 모두 가져와 1개 keep + 나머지 자동 정리
3. `findOne()` → `find()` 변경으로 race 발생 시에도 idempotent

---

## 6. 자동화 엔진 — 평가 및 실행

### 6.1 크론 스케줄 (3개)
| Cron | 메서드 | 대상 |
|------|--------|------|
| `EVERY_MINUTE` | `runEnabledRules()` | 일반 룰 (분단위) — sub-minute 룰은 제외 |
| `*/10 * * * * *` (10초) | `runSubMinuteRelayRules()` | 초 단위 ON/OFF 사이클이 있는 릴레이 룰 |
| `0 * * * * *` (매분 0초) | `checkIrrigationRules()` | 관수 스케줄러 |

근거: [automation-runner.service.ts:34, 49](../backend/src/modules/automation/automation-runner.service.ts#L34-L49), [irrigation-scheduler.service.ts:60](../backend/src/modules/automation/irrigation-scheduler.service.ts#L60)

### 6.2 평가 흐름 (`executeRule`)
```
1. 우적 우회 검사 (개폐기 룰만) → 활성 시 skip
2. evaluateRuleConditions() — 조건 매칭 여부
       ↓ matched
3. 릴레이 사이클 룰이면 → checkRelayCycle() → executeRelayAction()
       ↓ 아니면
4. lastState 체크 (이미 active면 중복 실행 방지)
5. executeAction() — 대상 장치 찾기 + buildCommands + devicesService.controlDevice(... 'automation')
6. broadcastAutomationExecuted (Socket.io)
7. INSERT automation_logs (conditions_met + actions_executed + ruleName)
```
근거: [automation-runner.service.ts:117-220](../backend/src/modules/automation/automation-runner.service.ts#L117-L220)

### 6.3 조건 평가 (`evaluateSingleCondition`)
각 단일 조건의 평가 분기:

| condition.field | 처리 |
|-----------------|------|
| `hour` (시단위) / `time` (분단위) | 요일 필터 → `between` 또는 `eq` 평가. `scheduleType='once'`면 `executedDates` 체크로 1회성 |
| `once_at` (특정 시각) | `value` 시각 이후 + `executedAt` 미실행이면 매칭 |
| `rain` | sensor 값을 boolean으로 변환 후 equal 비교 |
| 그 외 (sensor 값) | `deviation > 0` → 히스테리시스 (on/off/hold), `timeSlots` → 슬롯 진입/이탈 발화, 평범한 경우 → operator 비교 (gt/lt/gte/lte/eq/between) |

근거: [automation-runner.service.ts:299-421](../backend/src/modules/automation/automation-runner.service.ts#L299-L421)

### 6.4 히스테리시스 (Hysteresis)
- 조건에 `deviation` 필드가 있으면 자동 히스테리시스:
  - ON 임계 = `value + deviation`
  - OFF 임계 = `value - deviation`
  - 사이 값 = `hold` (matched: false → 무동작)
- 채터링 방지를 위해 임계값 사이에는 현 상태 유지
- 근거: [automation-runner.service.ts:374-388](../backend/src/modules/automation/automation-runner.service.ts#L374-L388)

### 6.5 릴레이 사이클 (개폐기 ON/OFF 펄스)
조건에 `relay: true`가 있으면 일정 주기로 ON/OFF 펄스:

| 필드 조합 | 동작 |
|-----------|------|
| `relayOnSeconds`, `relayOffSeconds` | 초 단위 사이클. **epoch 기준** cycle position 계산 — 룰별 anchor 없이 일관됨 |
| `relayOnMinutes`, `relayOffMinutes` | 분 단위 사이클. 시간 범위 시작점(`value[0]`) 기준 |

근거: [automation-runner.service.ts:754-793](../backend/src/modules/automation/automation-runner.service.ts#L754-L793)

`isOnPhase`가 이전 사이클과 동일하면 중복 실행 방지 (`prev?.relayOnPhase !== relayResult.isOnPhase`).

### 6.6 ENV Role 기반 센서값 조회
조건의 `field`가 `internal_temp`, `external_humidity` 등이면 `env_mappings`을 통해 매핑된 실제 sensor 또는 weather 데이터 사용:
- `source_type='sensor'`: 매핑된 `device_id` + `sensor_type`의 최신 `sensor_data.value`
- `source_type='weather'`: 최신 `weather_data.{weather_field}`

코드: [automation-runner.service.ts:555-606](../backend/src/modules/automation/automation-runner.service.ts#L555-L606)

### 6.7 액션 실행 (`executeAction`)
1. 대상 장치 결정:
   - `targetDeviceId` / `targetDeviceIds` 명시되면 그것 사용 (admin이 다른 사용자 그룹 룰 만든 경우 위해 owner 검사 우회)
   - 아니면 `findTargetDevices()` — rule.userId + groupId + houseId 필터 + actuator만 + `deviceType` 카테고리 매칭
2. `buildCommands(action)` — 항상 `[{ code: 'state', value: 'ON'|'OFF' }]` (단순화)
3. 각 device에 대해 `devicesService.controlDevice(deviceId, userId, commands, undefined, 'automation')`
4. 일부 실패 시 → 전체 실패 처리 (예외 throw)

근거: [automation-runner.service.ts:608-651](../backend/src/modules/automation/automation-runner.service.ts#L608-L651)

⚠️ `buildCommands`는 현재 `state` 하나만 보냄 — 멀티 코드 명령은 자동화 경로에서 안 됨. 필요 시 확장 필요.

### 6.8 강제 실행 (음성/즉시실행)
`runRuleNow(id)` → `forceExecuteRule(rule)`: **조건 평가 건너뛰고 actions만** 실행. 로그 type=`force_execute` ([automation-runner.service.ts:74-115](../backend/src/modules/automation/automation-runner.service.ts#L74-L115))

---

## 7. Fallback Engine (RPi 단독 동작)

### 7.1 모드 상태 머신
- `online`: 정상. 서버 GPIO 명령 통과. 룰 평가 안 함
- `fallback`: 서버 단절. 서버 명령 drop. 로컬 룰 평가 활성
- `unknown`: 초기

전환 트리거:
- `online → fallback`: 서버 hb 마지막 수신 후 `heartbeat_timeout_seconds` (기본 300s) 경과
- `fallback → online`: hb 재수신 후 `recovery_grace_seconds` (기본 30s) 안정화

근거: [fallback-engine/index.js:221-243](../raspberry-pi/fallback-engine/index.js#L221-L243), [migration 020](../backend/database/migrations/020_fallback_rules.sql) 제약

### 7.2 평가 주기
`FALLBACK_EVAL_INTERVAL_MS` (기본 **30초**) 마다:
1. 모드 전환 체크
2. 우적 우회 적용 (모드 무관, 최우선)
3. 폴백 모드면 4종 룰 평가: opener / irrigation(timeout) / fertilizer / fan

근거: [fallback-engine/index.js:35, 221-258](../raspberry-pi/fallback-engine/index.js#L221-L258)

### 7.3 룰 동기화
서버가 변경될 때마다 `farm/{gw}/fallback/rules/sync` (retained QoS 1) publish:
```json
{
  "version": 5,
  "config": { "heartbeatTimeoutSeconds": 300, "fanOnTemp": 35.0, ... },
  "schedule": [/* 월별 12개 */],
  "channelMapping": {
    "irrigation": [{ "channel": "switch_2", "pin": 17, "name": "1구역" }, ...],
    "fertilizer": [...],
    "fan":        [...],
    "opener": { "open": [...], "close": [...] }
  }
}
```
RPi가 적용 후 `farm/{gw}/fallback/ack` 로 응답.

근거: [mqtt.service.ts:284-320](../backend/src/modules/mqtt/mqtt.service.ts#L284-L320)

### 7.4 채널-핀 매핑 안전망
폴백 진입 시 `channelMapping`이 없으면 (예: 한 번도 동기화 안 됨) → 즉시 `emergencyStopAll()` (전 채널 OFF safe-off). 코드: [fallback-engine/index.js:239-242](../raspberry-pi/fallback-engine/index.js#L239-L242)

### 7.5 비상정지 (`emergency-stop`)
서버가 `farm/{gw}/gpio/emergency-stop` publish 시 — **폴백 모드에서도 통과** (command-gate 우회). 전 채널 OFF.
- 백엔드: [mqtt.service.ts:323-341](../backend/src/modules/mqtt/mqtt.service.ts#L323-L341)
- RPi: [fallback-engine/index.js:152-156](../raspberry-pi/fallback-engine/index.js#L152-L156)

### 7.6 이벤트 큐
폴백 중 발생한 이벤트(mode_change, rule_fired 등)는 SQLite에 저장 → online 복귀 시 일괄 publish (`farm/{gw}/fallback/events`).

근거: [fallback-engine/lib/event-queue.js](../raspberry-pi/fallback-engine/lib/event-queue.js), [fallback-engine/index.js:200-218](../raspberry-pi/fallback-engine/index.js#L200-L218)

---

## 8. 사용자/자동화 호출 컨텍스트 구분

`devicesService.controlDevice()`의 마지막 인자 `callerSource`:
- `'automation'`: 자동화 룰이 호출
- `'rain-override'`: 우적 우회 모듈이 호출
- `undefined`: **사용자 직접 조작**

사용자 직접 호출일 때만:
- 비 도중에 개폐기를 사용자가 ON 했다면 → `markUserOverrideIfRaining()` 로 자동 닫힘 suppress (사용자 의도 존중)

근거: [devices.service.ts:228, 236-242](../backend/src/modules/devices/devices.service.ts#L228-L242)

---

## 9. 안전 / 비상 동작 요약

| 시나리오 | 동작 | 근거 |
|----------|------|------|
| Pi 부팅 직후 의도치 않은 핀 ON | `GPIO_INIT_PINS` 핀들 강제 OFF | gpio-agent:192-198 |
| gpio-agent 재시작 시 좀비 gpioset | `pkill -9 -f gpioset.{CHIP}` | gpio-agent:34-38 |
| 개폐기 동시 ON 위험 | 반대편 OFF + **1초 대기** + 목표 ON | devices.service.ts:294-322 |
| 비 오는데 개폐기 열림 시도 | 자동화 skip + 폴백에서도 force close | rain-override 전역 적용 |
| 관수가 멈추지 않음 | 폴백에서 `irrigationMaxRuntimeMinutes` 후 강제 OFF | rule-evaluator/irrigation.js |
| 액비 투여 시간 초과 | 룰 생성/수정/실행 3중 검증 | automation.service.ts:199-222 |
| 서버 단절 | RPi가 자동으로 fallback 모드 → 로컬 룰 | fallback-engine FSM |
| 채널 매핑 미동기화로 폴백 진입 | safe-off (전 채널 강제 OFF) | fallback-engine/index.js:239 |
| 비상정지 필요 | `POST /gateways/{gw}/emergency-stop` (admin) → 폴백 무시 전달 | mqtt.service.ts:323-341 |
| 원격제어 OFF | 매핑된 모든 스위치 OFF + 관련 룰 전부 비활성화 | devices.service.ts:262-289 |
