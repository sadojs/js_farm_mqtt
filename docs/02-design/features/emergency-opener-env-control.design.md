# Design: 이머전시 개폐기 온습도 제어 + 시간 스케줄 백업

> Plan: [emergency-opener-env-control.plan.md](../../01-plan/features/emergency-opener-env-control.plan.md)
> Date: 2026-07-05 · Author: ohjeongseok · Status: Draft

---

## 0. 설계 결정 (사용자 확정)

| # | 항목 | 결정 |
|---|---|---|
| 1 | 개방 방향 | **유동팬과 동일** — 측정값이 **높으면 개방**, 낮으면 닫힘 (환기) |
| 2 | 온습도계 이상 timeout | **600초(10분)** 기본, 관리자 조정 가능(120~3600) |
| 3 | 트리거 종류 | **온도/습도 택1** (fan과 동일, 동시조건 아님) |

**판정 규칙(히스테리시스, fan과 동일 의미)**: `on`=개방 임계, `off`=닫힘 임계, `on > off`.
- 현재 닫힘 → `reading > openerOnValue` 이면 **개방**
- 현재 개방 → `reading < openerOffValue` 이면 **닫힘**
- 그 외 상태 유지(채터링 방지)

**우선순위**: 우적(비) 닫힘(최우선) → (센서 fresh? **온습도 primary** : **시간 스케줄 backup**). 개방/닫힘 인터록 1초 유지.

---

## 1. 설정 스키마 (신규 필드)

`FallbackConfig`(단일 행, 게이트웨이당 1개)에 fan과 대칭으로 추가:

| 필드 | 타입 | 기본값 | 범위/제약 | 설명 |
|---|---|---|---|---|
| `openerTriggerType` | `'temperature'\|'humidity'` | `'temperature'` | IN | 개폐기 트리거 측정값 종류 |
| `openerOnValue` | number | `30` | -10~100 | 개방 임계(°C 또는 %) |
| `openerOffValue` | number | `25` | -10~100 | 닫힘 임계(°C 또는 %) |
| `sensorTimeoutSeconds` | int | `600` | 120~3600 | 온습도 최근값 유효시간(초). 초과 시 센서 이상 → 백업 |

**검증**(fan과 동일 규칙): `openerOnValue > openerOffValue`, 각 값 -10~100. `sensorTimeoutSeconds` 120~3600.
**하위호환**: 미설정 시 기본값으로 안전 동작. `openerTriggerType` 기본 temperature + `sensorTimeoutSeconds=600`이면, 온습도 수신이 정상인 게이트웨이는 온습도 제어, 온습도계 없는 게이트웨이는 즉시(첫 수신 없음) 백업 스케줄로 동작 → 기존 스케줄-only 동작과 동등.

---

## 2. DB 마이그레이션

`backend/database/migrations/040_fallback_opener_env.sql` (forward-only, idempotent):

```sql
-- Migration 040: 이머전시 개폐기 온습도 조건 제어 + 센서 타임아웃
ALTER TABLE fallback_configs
  ADD COLUMN IF NOT EXISTS opener_trigger_type   VARCHAR(20)   NOT NULL DEFAULT 'temperature',
  ADD COLUMN IF NOT EXISTS opener_on_value       NUMERIC(5,2)  NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS opener_off_value      NUMERIC(5,2)  NOT NULL DEFAULT 25,
  ADD COLUMN IF NOT EXISTS sensor_timeout_seconds INT          NOT NULL DEFAULT 600;

-- 트리거 종류 제약 (선택)
ALTER TABLE fallback_configs
  DROP CONSTRAINT IF EXISTS fallback_configs_opener_trigger_type_check;
ALTER TABLE fallback_configs
  ADD CONSTRAINT fallback_configs_opener_trigger_type_check
  CHECK (opener_trigger_type IN ('temperature','humidity'));
```
> `023_fallback_fan_trigger.sql` 선례를 그대로 따름. `fallback_opener_schedule`(12행) 테이블은 **변경 없음**(백업 역할로 유지).

---

## 3. Pi fallback-engine 변경

### 3.1 공용 히스테리시스 헬퍼 (신규) — `lib/rule-evaluator/hysteresis.js`

fan.js의 판정을 그대로 추출(동작 동일). fan·opener 재사용.

```js
'use strict';
/**
 * 히스테리시스 판정. on=활성(가동/개방) 임계, off=비활성(정지/닫힘) 임계, on > off.
 * @returns {boolean} 목표 활성 여부
 */
function evaluateHysteresis(currentlyOn, reading, onValue, offValue) {
  if (currentlyOn) return reading < offValue ? false : true;
  return reading > onValue ? true : false;
}
module.exports = { evaluateHysteresis };
```

`fan.js` 리팩터(동작 불변): `let target; if (state.fanState) {...} else {...}` 블록을
`const target = evaluateHysteresis(state.fanState, reading, onValue, offValue);` 로 치환.

### 3.2 센서 타임스탬프 기록 — `lib/rule-evaluator/index.js#ingestSensor()`

수신 시각을 함께 기록(신규 필드). `state`에 `lastTemperatureAt`/`lastHumidityAt` 추가(초기 `null`).

```js
ingestSensor(deviceName, data) {
  if (!data || typeof data !== 'object') return;
  const now = Date.now();
  for (const key of ['temperature','temp','air_temperature']) {
    if (typeof data[key] === 'number') { this.state.lastTemperature = data[key]; this.state.lastTemperatureAt = now; break; }
  }
  for (const key of ['humidity','relative_humidity','rh']) {
    if (typeof data[key] === 'number') { this.state.lastHumidity = data[key]; this.state.lastHumidityAt = now; break; }
  }
}
```
`this.state` 초기화에 `lastTemperatureAt: null, lastHumidityAt: null` 추가.

### 3.3 센서 워치독 (신규) — `lib/sensor-watchdog.js`

`heartbeat-watchdog.js` 패턴 복제. 트리거별 최근값 신선도 판정 + 부팅 grace.

```js
'use strict';
const SENSOR_COLD_BOOT_GRACE_MS = 60_000; // 부팅 직후 60초는 판정 유예

class SensorWatchdog {
  constructor(bootAt = Date.now()) { this.bootAt = bootAt; }

  /** 해당 트리거의 최근값이 유효(fresh)한가 */
  isFresh(triggerType, state, timeoutMs, now = Date.now()) {
    const at = triggerType === 'humidity' ? state.lastHumidityAt : state.lastTemperatureAt;
    const reading = triggerType === 'humidity' ? state.lastHumidity : state.lastTemperature;
    if (typeof reading !== 'number' || !at) return false;
    return (now - at) <= timeoutMs;
  }

  /** 아직 첫 수신 전 + 부팅 grace 이내인가 (백업 전환 유예) */
  neverReceivedInGrace(triggerType, state, now = Date.now()) {
    const at = triggerType === 'humidity' ? state.lastHumidityAt : state.lastTemperatureAt;
    return !at && (now - this.bootAt < SENSOR_COLD_BOOT_GRACE_MS);
  }
}
module.exports = { SensorWatchdog, SENSOR_COLD_BOOT_GRACE_MS };
```

`RuleEvaluator` 생성자에서 `this.sensorWatchdog = new SensorWatchdog()`.

### 3.4 개폐기 평가 분기 — `lib/rule-evaluator/opener.js`

우적 → (fresh? 온습도 : 스케줄) 분기 추가. 기존 시간 스케줄 로직은 **백업 경로로 그대로 이동**. `setOpenerIntent(intent, reason)`의 reason으로 동작 근거 전달.

```js
function evaluate({ now, cfg, store, state, relay, queue }, sensorWatchdog) {
  if (!cfg.openerEnabled) return;

  // 1) 우적(비) 최우선 — 기존 로직 유지
  if (state.rainActive) { setOpenerIntent('closed', 'rain-active', ...); return; }

  // 2) primary: 온습도 (센서 fresh)
  const triggerType = cfg.openerTriggerType === 'humidity' ? 'humidity' : 'temperature';
  const timeoutMs = (cfg.sensorTimeoutSeconds ?? 600) * 1000;
  const reading = triggerType === 'humidity' ? state.lastHumidity : state.lastTemperature;

  if (sensorWatchdog.isFresh(triggerType, state, timeoutMs, now.getTime())) {
    const currentlyOpen = state.openerIntent === 'open';
    const open = evaluateHysteresis(currentlyOpen, reading, cfg.openerOnValue, cfg.openerOffValue);
    setOpenerIntent(open ? 'open' : 'closed', `env-${triggerType}-${reading}`, ...);
    return;
  }

  // 부팅 직후 아직 첫 수신 전 → 상태 유지(백업 성급 전환 방지)
  if (sensorWatchdog.neverReceivedInGrace(triggerType, state, now.getTime())) return;

  // 3) backup: 월별 시간 스케줄 — 기존 opener.js 시간 로직 그대로
  const month = now.getMonth() + 1;
  const sched = store.scheduleFor(month);
  if (!sched || !sched.enabled) return;           // 상태 유지
  if (sched.mode === 'always-open') { setOpenerIntent('open', 'backup-always-open', ...); return; }
  // mode === 'time' : 기존 inOpenWindow 계산(overnight wrap 포함)
  const intent = inOpenWindow ? 'open' : 'closed';
  setOpenerIntent(intent, 'backup-schedule', ...);
}
```
- `setOpenerIntent` 인터록(반대 채널 OFF → 1초 → 목표 ON)·idempotent 불변.
- 채널 매핑 없음 등 안전망(`forceClose`) 경로 유지.

### 3.5 평가 디스패치 — `lib/rule-evaluator/index.js#evaluate(now)`

`opener.evaluate(args)`에 `sensorWatchdog` 전달(최초의 fan/opener 공유 의존성은 없음 — watchdog는 opener만 사용). tick당 그대로 30s.

### 3.6 룰 스토어 기본값 — `lib/rule-store.js` `DEFAULT_RULES.config`

`applySync` 병합 시 신규 필드 누락 대비 기본값 추가:
```js
config: { ...,
  fanEnabled, fanTriggerType, fanOnTemp, fanOffTemp,
  openerEnabled, openerRainOverride,
  openerTriggerType: 'temperature', openerOnValue: 30, openerOffValue: 25,
  sensorTimeoutSeconds: 600,
}
```

---

## 4. Backend 변경

### 4.1 엔티티 — `modules/fallback-config/entities/fallback-config.entity.ts`
fan 필드 아래에 대칭 추가:
```ts
@Column({ name: 'opener_trigger_type', type: 'varchar', length: 20, default: 'temperature' })
openerTriggerType: 'temperature' | 'humidity';
@Column({ name: 'opener_on_value', type: 'decimal', precision: 5, scale: 2, default: 30 })
openerOnValue: number;
@Column({ name: 'opener_off_value', type: 'decimal', precision: 5, scale: 2, default: 25 })
openerOffValue: number;
@Column({ name: 'sensor_timeout_seconds', type: 'int', default: 600 })
sensorTimeoutSeconds: number;
```

### 4.2 DTO — `dto/update-config.dto.ts`
```ts
@IsOptional() @IsIn(['temperature','humidity']) openerTriggerType?: 'temperature'|'humidity';
@IsOptional() @IsNumber() @Min(-10) @Max(100) openerOnValue?: number;
@IsOptional() @IsNumber() @Min(-10) @Max(100) openerOffValue?: number;
@IsOptional() @IsInt() @Min(120) @Max(3600) sensorTimeoutSeconds?: number;
```

### 4.3 검증 — `fallback-config.service.ts#updateConfig()`
fan의 on>off 검증(현 141~153) 옆에 opener 동일 검증 추가:
```ts
if (dto.openerOnValue != null && dto.openerOffValue != null && dto.openerOnValue <= dto.openerOffValue)
  throw new BadRequestException('개폐기 개방 임계는 닫힘 임계보다 커야 합니다.');
```

### 4.4 배포 payload — `fallback-config.service.ts#publishSync()`
`config` literal에 4개 필드 추가:
```ts
config: { ...,
  fanEnabled, fanTriggerType, fanOnTemp, fanOffTemp,
  openerEnabled, openerRainOverride,
  openerTriggerType: config.openerTriggerType,
  openerOnValue: Number(config.openerOnValue),
  openerOffValue: Number(config.openerOffValue),
  sensorTimeoutSeconds: config.sensorTimeoutSeconds,
},
```

---

## 5. Frontend 변경

### 5.1 타입 — `types/emergency-failover.types.ts`
```ts
export type OpenerTriggerType = 'temperature' | 'humidity'
export interface FallbackConfig {
  ...
  openerTriggerType: OpenerTriggerType
  openerOnValue: number
  openerOffValue: number
  sensorTimeoutSeconds: number
}
```

### 5.2 공용 온습도 조건 카드 (신규) — `components/emergency-failover/EnvConditionCard.vue`
`FanFailoverCard.vue`를 일반화(라벨 파라미터화). Props: `enabled, triggerType, onValue, offValue` + `title, onLabel('개방'/'ON'), offLabel('닫힘'/'OFF'), hint`. 단위/step/min·max 계산, 트리거 전환 시 기본값 리셋 UX(온도 35/28, 습도 85/70 → 개폐기는 30/25/85/70)는 그대로 이식. 인라인 유효성(on>off, 범위).
- **개폐기 사용**: `<EnvConditionCard title="개폐기 온습도 조건" onLabel="개방" offLabel="닫힘" v-model:enabled/triggerType/onValue/offValue />`
- fan 리팩터(선택): FanFailoverCard를 EnvConditionCard 래퍼로. **본 과제에서는 fan 무변경**(리스크 회피), opener만 신규 카드 사용.

### 5.3 월별 스케줄 카드 재라벨 — `OpenerMonthlyScheduleCard.vue` / `OpenerMonthDialog.vue`
- 카드 제목/설명: "백업 스케줄 (온습도계 이상 시 동작)"으로 변경.
- `OpenerMonthDialog` 힌트(현 88행 "통신 단절 시에만 이 스케줄이 동작합니다") → "통신 단절 + **온습도계 이상** 시 백업으로 동작합니다"로 수정.

### 5.4 페이지 오케스트레이션 — `views/EmergencyFailover.vue`
- `editable`에 `openerTriggerType/openerOnValue/openerOffValue/sensorTimeoutSeconds` 추가(초기 load 반영).
- `openerValid` computed(on>off·범위) 추가 → 저장 버튼 `:disabled`에 결합(fanValid와 AND).
- 컴포넌트 배치: 개폐기 섹션에 **EnvConditionCard(primary)를 월별 스케줄 카드 위**에 배치.
- `sensorTimeoutSeconds` 입력: 개폐기 조건 카드 하단 또는 HeartbeatSettingsCard 옆에 "온습도계 이상 판정 시간(분)" 필드(초↔분 환산 표시).
- "폴백 모드 측정값 소스" 안내 카드(211~225): 개폐기도 온습도 최근값을 사용함을 문구에 추가.
- `allCriticalDisabled`(개폐기 비활성 판정) 재검토: openerEnabled=false 의미 유지(전체 개폐기 페일오버 off). 온습도/백업은 하위 경로이므로 critical 기준 불변.

### 5.5 동작 근거 표시 (이벤트 한글화)
Pi가 `setOpenerIntent(intent, reason)`로 넣는 reason을 이벤트 라벨 맵에 한글 추가:
`env-temperature-* → "온도 조건 개방/닫힘"`, `env-humidity-* → "습도 조건 개방/닫힘"`, `backup-schedule → "백업 스케줄"`, `backup-always-open → "백업 24시간 개방"`, `rain-active → "우적 감지 닫힘"`. FailoverStatusCard/이벤트 목록에 반영.

---

## 6. 4곳 동기 체크리스트 (필드 누락 방지 — NFR-06)

| 신규 필드 | ① DTO | ② Entity | ③ publishSync | ④ Pi DEFAULT_RULES.config |
|---|:--:|:--:|:--:|:--:|
| openerTriggerType | ☐ | ☐ | ☐ | ☐ |
| openerOnValue | ☐ | ☐ | ☐ | ☐ |
| openerOffValue | ☐ | ☐ | ☐ | ☐ |
| sensorTimeoutSeconds | ☐ | ☐ | ☐ | ☐ |

---

## 7. 구현 순서 (의존성 기반)

1. **DB**: 040 마이그레이션 작성·적용.
2. **Pi**: `hysteresis.js` 추출 → `fan.js` 치환(동작 검증) → `ingestSensor` 타임스탬프 → `sensor-watchdog.js` → `opener.js` 분기 → `rule-store.js` 기본값 → `index.js` 배선.
3. **Backend**: 엔티티 → DTO → updateConfig 검증 → publishSync payload.
4. **Frontend**: 타입 → `EnvConditionCard.vue` → EmergencyFailover.vue(editable/openerValid/배치/문구) → 스케줄 카드 재라벨 → 이벤트 라벨.
5. **배포**: backend/frontend 빌드 + Pi 룰 auto-resync(version) + Pi 엔진 코드 `apply-agent-update.sh`.

---

## 8. 수정 파일 체크리스트

**DB (1)**: `backend/database/migrations/040_fallback_opener_env.sql`
**Pi (6)**: `lib/rule-evaluator/hysteresis.js`(신규) · `fan.js` · `rule-evaluator/index.js` · `lib/sensor-watchdog.js`(신규) · `lib/rule-evaluator/opener.js` · `lib/rule-store.js`
**Backend (3)**: `entities/fallback-config.entity.ts` · `dto/update-config.dto.ts` · `fallback-config.service.ts`
**Frontend (5)**: `types/emergency-failover.types.ts` · `components/emergency-failover/EnvConditionCard.vue`(신규) · `views/EmergencyFailover.vue` · `OpenerMonthlyScheduleCard.vue` · `OpenerMonthDialog.vue` (+ 이벤트 라벨 위치)

---

## 9. 테스트 시나리오

1. **온습도 개방**: 서버 단절 + 온도 > on → 개방 / 온도 < off → 닫힘 (히스테리시스 경계 확인).
2. **습도 트리거**: openerTriggerType=humidity로 동일 확인.
3. **센서 이상 → 백업**: 온습도 수신 중단 후 10분 경과 → 월별 시간 스케줄 동작. 수신 복구 → 온습도 복귀.
4. **부팅 grace**: Pi 재부팅 직후 60초 내 첫 수신 전 → 상태 유지(백업 성급 전환 없음).
5. **우적 최우선**: 어떤 상태에서도 우적 감지 시 즉시 닫힘.
6. **인터록**: 개방↔닫힘 전환 시 동시 ON 없음(1초 간격).
7. **설정 반영**: UI 임계 변경 저장 → version bump → waitForSync 성공 → Pi rules.json 반영.
8. **회귀**: 유동팬·관수·시비 페일오버 정상, 온습도계 없는 게이트웨이는 즉시 백업 스케줄(기존과 동등).

---

## 10. 리스크 대응 (Plan 5장 연계)

- timeout 오탐: 기본 10분 + grace 60초 + 관리자 설정.
- 값 튐(last-writer-wins): 단일 온습도계 운영 안내 유지, 센서 선택은 별도 과제.
- 양측 동기 누락: 6장 체크리스트 강제.
- 개방 방향 혼동: onLabel="개방"/offLabel="닫힘" + 안내 문구로 명시.
