---
template: design
version: 2.0
description: 환경 자동 운전 상세 설계 — 구역 단위 제어(센서·개폐기·완전개방 시간 모두 구역 공통), 판단 엔진, API, 화면(쉬운 UI), RS485 수집, 테스트, 개발서버 전용 차단
---

# climate-auto-mode Design Document

> **Plan**: `docs/01-plan/features/climate-auto-mode.plan.md`
> **Project**: smart-farm-mqtt
> **Author**: ohjeongseok
> **Date**: 2026-10-13 (v2 — 구역 단위 제어로 재설계, 화면 단순화)
> **Status**: Draft
> **대상 독자**: Claude Code CLI(구현 담당) — §13 "구현 지시"부터 읽고, 각 Phase에서 해당 절을 참조할 것.
> **화면 시안**: Claude 디자인 캔버스 '환경 자동 모드 UI 디자인'(비공개 링크). 열 수 없으면 §10의 글·표만으로 구현한다.

---

## 0. 핵심 결정 요약

| # | 결정 | 이유 |
|---|---|---|
| D1 | **환경변수 `CLIMATE_AUTO_ENABLED=true`일 때만 동작**(런타임 확인). 모듈은 항상 import하되 모든 진입점 첫 줄에서 확인 | 운영 DB엔 신규 테이블이 없으므로 플래그 OFF면 쿼리 0회. 테스트에서 파일별로 켜고 끌 수 있음 |
| D2 | **제어 단위 = 구역(house_group)**. 센서·개폐기·유동팬·설정·상태 모두 구역 하나에 한 벌 | 하우스 동마다 센서가 따로 있지 않음. 구역 = 게이트웨이 1대(053) |
| D3 | **구역 안의 개폐기는 모두 함께 움직인다** — 같은 목표 %, 같은 펄스 시간 | 구역 센서 하나로 판단하므로 개폐기별로 다르게 열 근거가 없음 |
| D4 | **완전개방(·닫힘) 시간은 구역 설정 1개** (`climate_auto_configs`), 위치(%)도 구역 1개 | 기존 '장치 설정 · 게이트웨이 1대 공통'(개폐기 동작/대기)과 같은 단위 |
| D5 | 모드 `off / shadow / auto`. 화면 이름은 **끄기 / 시험 운전 / 자동 운전** | 시험 운전 = 판단만 기록, 장치는 기존 룰이 운전 |
| D6 | **필수 장치 8항목 전부 충족 시에만** 켤 수 있고 운전 | 사용자 요구사항. 운전 중 미충족 → 대기 |
| D7 | 위치(%)는 모터 동작시간으로 추정, 모르면 **가까운 끝으로 원점 복귀** | 위치 센서 없이 단계 제어 |
| D8 | 판단 로직은 **순수 함수** `decideClimate()` | DB·MQTT 없이 표 기반 단위 테스트 |
| D9 | 자동 운전 진입 시 구역의 개폐기·유동팬 룰을 `disabled_reason='climate_auto'`로 정지, 해제 시 복귀 | 045 선례 재사용, 룰 엔진 수정 없음 |
| D10 | 수동·일괄 조작 시 자동 운전 **무기한 정지**, 사용자가 '자동 운전 다시 켜기' 또는 '자동 제어 룰로 돌아가기'를 골라 복귀 | 기존 일괄제어 원복 UX와 일관. 사람이 손댄 뒤 몰래 다시 움직이지 않게 |
| D11 | 신선도 판단은 **climate-auto 모듈 내부에서만**(센서 20분·기상 180분) | 기존 `automation-runner` 동작 변경 없음 |
| D12 | RS485 센서는 우적센서 선례처럼 **z2m 형식 메시지**로 발행 | 기존 센서 파이프라인 재사용 |
| D13 | **쉬운 화면**: 사용자 화면에 보이는 설정은 3개(낮 목표·밤 목표·완전개방 시간), 나머지는 '전문가 설정'에 접어 둠. 글자·버튼 크게, 쉬운 말 | 40대 이상 농업인 사용. 기존 화면 패턴(구역 카드 띠·모달) 재사용 |
| D14 | 기존 코드 수정은 **허용 목록(§9)만** | 운영 회귀 위험 최소화 |

---

## 1. 전체 구조

```
[RS485 온습도계]─┐                                    ┌─ farm/{gw}/z2m/rs485_climate {temperature,humidity}
[RS485 일사량계]─┴─ USB-RS485 ─ Pi fallback-engine(rs485-poller) ┤
                                                             └─ farm/{gw}/z2m/rs485_solar {solar_radiation}
[Zigbee 우적/온습도] ─ Z2M ───────────────────────────────── farm/{gw}/z2m/...
                              │ (기존) mqtt-sensor.handler → sensor_data
                              ▼
┌───────────────────── backend: modules/climate-auto (구역 단위) ─────────────────────┐
│ ClimateAutoRunnerService (@Cron 매분)                                               │
│   for 구역 in configs where mode in (shadow, auto) and status != STOPPED_MANUAL:     │
│     inputs   = ClimateInputsService.read(구역)       ← env_mappings + 신선도         │
│     prereq   = ClimatePrereqService.check(구역, inputs)                              │
│     decision = decideClimate({inputs, config, opener(구역 위치), fan, sun, now})    │
│     log(decision)                                                                    │
│     if mode=='auto': OpenerMotionService.moveZone(구역의 모든 개폐기 쌍)            │
│                      FanControlService.apply(구역의 모든 유동팬)                     │
│                        └→ DevicesService.controlDevice(.., 'climate-auto')          │
└──────────────────────────────────────────────────────────────────────────────────────┘
        │ socket 'climate:status'                         │ push(sendToFarm)
        ▼                                                  ▼
  구역 관리(Groups.vue) 구역 카드 '환경 자동 운전' 띠 + 설정 창      농장 사용자 휴대폰
```

---

## 2. 데이터 모델

### 2.1 마이그레이션 `backend/database/migrations/054_climate_auto_mode.sql`

forward-only, idempotent. **개발 DB에만 적용**(운영 적용 금지 — §8).

```sql
-- 054: 환경 자동 운전 (개발서버 전용 기능 — 운영 DB에는 아직 적용하지 않는다)

-- 1) 일사량 환경 역할
INSERT INTO env_roles (role_key, label, category, unit, sort_order) VALUES
  ('solar_radiation', '일사량', 'internal', 'W/m²', 9)
ON CONFLICT (role_key) DO NOTHING;

-- 2) 구역별 자동 운전 설정 + 상태 (구역당 1행)
CREATE TABLE IF NOT EXISTS climate_auto_configs (
  group_id                   uuid PRIMARY KEY REFERENCES house_groups(id) ON DELETE CASCADE,
  mode                       varchar(10) NOT NULL DEFAULT 'off' CHECK (mode IN ('off','shadow','auto')),

  -- 사용자 화면에 보이는 설정 (3개)
  day_target_temp            numeric(4,1) NOT NULL DEFAULT 26.0,
  night_target_temp          numeric(4,1) NOT NULL DEFAULT 16.0,
  opener_full_open_seconds   int CHECK (opener_full_open_seconds BETWEEN 10 AND 540),   -- NULL = 미입력(준비 안 됨)

  -- 전문가 설정 (접힘)
  opener_full_close_seconds  int CHECK (opener_full_close_seconds BETWEEN 10 AND 540), -- NULL = 열림과 같음
  vent_offset                numeric(3,1) NOT NULL DEFAULT 1.0,
  morning_ramp_minutes       int          NOT NULL DEFAULT 120,
  evening_ramp_minutes       int          NOT NULL DEFAULT 120,
  sunny_bonus_temp           numeric(3,1) NOT NULL DEFAULT 1.0,
  sunny_radiation_wm2        int          NOT NULL DEFAULT 600,
  high_temp                  numeric(4,1) NOT NULL DEFAULT 32.0,
  low_temp                   numeric(4,1) NOT NULL DEFAULT 12.0,
  humidity_high              int          NOT NULL DEFAULT 85,
  dehumid_open_pct           int          NOT NULL DEFAULT 10,
  kp_pct_per_deg             numeric(4,1) NOT NULL DEFAULT 20.0,
  max_open_pct               int          NOT NULL DEFAULT 100,
  step_max_pct               int          NOT NULL DEFAULT 25,
  min_move_pct               int          NOT NULL DEFAULT 5,
  settle_minutes             int          NOT NULL DEFAULT 4,
  outside_limits             jsonb        NOT NULL DEFAULT '[{"maxOutsideTemp":5,"maxOpenPct":10},{"maxOutsideTemp":10,"maxOpenPct":30},{"maxOutsideTemp":15,"maxOpenPct":60}]',
  fan_humidity_on            int          NOT NULL DEFAULT 85,
  fan_humidity_off           int          NOT NULL DEFAULT 80,
  fan_dew_margin_on          numeric(3,1) NOT NULL DEFAULT 2.0,
  fan_dew_margin_off         numeric(3,1) NOT NULL DEFAULT 3.0,
  fan_stagnant_open_pct      int          NOT NULL DEFAULT 20,
  fan_stagnant_radiation     int          NOT NULL DEFAULT 200,
  fan_min_on_minutes         int          NOT NULL DEFAULT 10,
  fan_min_off_minutes        int          NOT NULL DEFAULT 5,
  latitude                   numeric(8,5) NOT NULL DEFAULT 37.49100,
  longitude                  numeric(8,5) NOT NULL DEFAULT 127.98500,

  -- 런타임 상태 (구역 1벌)
  status                     varchar(24)  NOT NULL DEFAULT 'IDLE',
  stopped_at                 timestamptz,                -- STOPPED_MANUAL 진입 시각 (시간 제한 없음)
  stopped_by                 uuid,                       -- 수동 조작한 사용자 (NULL = 서버 감지)
  opener_position_pct        numeric(5,2),               -- 구역 개폐기 추정 위치, NULL = 모름
  opener_moving_dir          varchar(5),                 -- 'open' | 'close' | NULL
  opener_motor_stop_at       timestamptz,                -- 이동 중이면 정지 예정 시각
  opener_last_move_end_at    timestamptz,
  opener_homed_at            timestamptz,
  fan_on                     boolean      NOT NULL DEFAULT false,
  fan_changed_at             timestamptz,
  last_evaluated_at          timestamptz,
  updated_by                 uuid,
  created_at                 timestamptz  NOT NULL DEFAULT now(),
  updated_at                 timestamptz  NOT NULL DEFAULT now()
);

-- 3) 판단 기록 (14일 보관, 모듈 크론이 삭제)
CREATE TABLE IF NOT EXISTS climate_auto_logs (
  id            bigserial PRIMARY KEY,
  group_id      uuid NOT NULL REFERENCES house_groups(id) ON DELETE CASCADE,
  evaluated_at  timestamptz NOT NULL DEFAULT now(),
  mode          varchar(10) NOT NULL,
  status        varchar(24) NOT NULL,
  inputs        jsonb NOT NULL,
  decision      jsonb NOT NULL,
  executed      boolean NOT NULL DEFAULT false,
  reason        varchar(64)
);
CREATE INDEX IF NOT EXISTS idx_climate_auto_logs_group_time ON climate_auto_logs(group_id, evaluated_at DESC);
```

> v1과의 차이: 개폐기 쌍별 테이블(`climate_opener_configs`, `climate_opener_states`)은 **없다**. 완전개방 시간과 위치는 구역 행에 한 벌.

### 2.2 TypeORM 엔티티 (`backend/src/modules/climate-auto/entities/`)

- `climate-auto-config.entity.ts` (`climate_auto_configs`, PK `groupId`)
- `climate-auto-log.entity.ts` (`climate_auto_logs`)

컬럼명은 SQL과 1:1(snake_case `name:` 지정). numeric은 문자열로 오므로 `Number()` 변환.

### 2.3 상수 `climate-auto.constants.ts`

```ts
export const isClimateAutoEnabled = () => process.env.CLIMATE_AUTO_ENABLED === 'true';
export const SENSOR_MAX_AGE_MIN  = num('CLIMATE_SENSOR_MAX_AGE_MIN', 20);
export const WEATHER_MAX_AGE_MIN = num('CLIMATE_WEATHER_MAX_AGE_MIN', 180);
export const OPENER_INTERLOCK_MS = 1000;   // 반대 방향 OFF 후 대기
export const HOMING_FACTOR       = 1.1;    // 원점 복귀 = 완전시간 × 1.1
export const MIN_PULSE_SEC       = 2;      // 이보다 짧은 이동은 생략
export const LOG_RETENTION_DAYS  = 14;
export type ClimateMode   = 'off' | 'shadow' | 'auto';      // 화면: 끄기 / 시험 운전 / 자동 운전
export type ClimateStatus =
  | 'IDLE' | 'RUNNING' | 'SUSPENDED_MISSING' | 'PAUSED_RAIN'
  | 'STOPPED_MANUAL' | 'PAUSED_EMERGENCY' | 'PAUSED_GATEWAY_OFFLINE';
// STOPPED_MANUAL 은 자동으로 풀리지 않는다 — 사용자가 복귀 방식을 골라야 해제
```

---

## 3. 입력 수집 (`climate-inputs.service.ts`)

구역의 환경 매핑(`env_mappings`, 이미 구역 단위)에서 역할별 최신값을 읽는다. **반드시 시간 범위를 건다.**

| 키 | 역할 | 소스 | 신선도 |
|---|---|---|---|
| `tIn` | internal_temp | sensor | 20분 |
| `rhIn` | internal_humidity | sensor | 20분 |
| `rad` | solar_radiation | sensor | 20분 |
| `tOut` | external_temp | weather(`weather_data.temperature`, 구역 소유 농장) | 180분 |
| `rainActive` | rain_detection | `rainOverride.isOpenerRainOverridden(groupId)` | — |

```sql
-- 센서 역할 1개
SELECT sd.value::float8 AS value, sd.time
FROM env_mappings em
JOIN LATERAL (
  SELECT value, time FROM sensor_data
  WHERE device_id = em.device_id AND sensor_type = em.sensor_type
    AND time > now() - make_interval(mins => $3::int)
  ORDER BY time DESC LIMIT 1
) sd ON true
WHERE em.group_id = $1::uuid AND em.role_key = $2 AND em.source_type = 'sensor';
```

```ts
interface ClimateInputs {
  tIn: Reading | null; rhIn: Reading | null; rad: Reading | null; tOut: Reading | null;
  rainActive: boolean;
  dewPoint: number | null;       // tIn·rhIn로 계산 (Magnus: a=17.62, b=243.12)
}
interface Reading { value: number; at: Date; }
```

---

## 4. 준비 상태 검사 (`climate-prereq.service.ts`)

```ts
type PrereqKey = 'internal_temp' | 'internal_humidity' | 'solar_radiation' | 'external_temp'
               | 'rain_sensor' | 'opener' | 'fan' | 'gateway';
interface PrereqItem { key: PrereqKey; label: string; ok: boolean; detail: string; fix?: 'env_config' | 'opener_time' | 'rs485' | 'none'; }
interface PrereqResult { ready: boolean; items: PrereqItem[]; openerPairs: Array<{ openId: string; closeId: string; name: string }>; fans: Array<{ id: string; name: string }>; }
```

| key | 화면 이름 | ok 조건 | 실패 시 detail (쉬운 말) / fix |
|---|---|---|---|
| internal_temp | 안쪽 온도 | 매핑=sensor, 20분 이내 값 | "온도 센서가 지정되지 않았어요" / "온도 값이 25분째 안 들어와요" → env_config |
| internal_humidity | 안쪽 습도 | 동일 | 동일 문구(습도) → env_config |
| solar_radiation | 햇빛(일사량) | 동일 | "일사량계가 없어요" → rs485 / "값이 안 들어와요" → env_config |
| external_temp | 바깥 온도 | 매핑=weather, 180분 이내 | "바깥 온도를 기상청 날씨로 지정해 주세요" → env_config |
| rain_sensor | 우적센서 | rain_detection 매핑 + 장치 online | "우적센서가 연결되지 않았어요" → env_config |
| opener | 개폐기 | 구역 장치 중 opener_open(+paired opener_close) **1쌍 이상 모두 online** + **구역 `opener_full_open_seconds` 입력됨** | "개폐기가 끝까지 열리는 시간을 입력해 주세요" → opener_time / "개폐기 1쌍이 꺼져 있어요" |
| fan | 유동팬 | equipment_type='fan' 1대 이상 online | "유동팬이 없거나 꺼져 있어요" |
| gateway | 게이트웨이 | 구역 게이트웨이 online, 비상 정지 아님 | "게이트웨이 연결이 끊겼어요" / "비상 정지 중이에요" |

구역 장치 판정(기존 러너와 같은 규칙):
```sql
d.id IN (SELECT device_id FROM group_devices WHERE group_id = $1)
OR d.gateway_id IN (SELECT id::text FROM gateways WHERE group_id = $1)
```
`enabled=false` 장치 제외. 구역의 **모든** 개폐기 쌍이 제어 대상이며, 하나라도 offline이면 opener 항목 실패(일부만 움직이는 상황 방지).

---

## 5. 판단 엔진 (`climate-decision.ts`, 순수 함수)

### 5.1 시그니처

```ts
export interface DecisionContext {
  now: Date;
  inputs: ClimateInputs;
  config: ClimateConfigValues;
  sun: { sunrise: Date; sunset: Date };     // suncalc(이미 dependency)
  opener: { positionPct: number | null; lastMoveEndAt: Date | null; moving: boolean };   // 구역 1벌
  fan: { on: boolean; changedAt: Date | null };
  pause: { manualStopped: boolean; emergency: boolean; gatewayOnline: boolean };
}
export interface ClimateDecision {
  status: ClimateStatus;
  targetTemp: number | null;
  ventTemp: number | null;
  opener: { action: 'none' | 'home_open' | 'home_close' | 'move'; fromPct: number | null; toPct: number | null; reason: ReasonCode };
  fan: { action: 'none' | 'on' | 'off'; reason: ReasonCode };
  summary: string;                           // 화면용 한 줄 (§5.5)
}
export function decideClimate(ctx: DecisionContext): ClimateDecision;
```

### 5.2 목표온도

```
night = night_target_temp,  day = day_target_temp
mStart = sunrise,                     mEnd = sunrise + morning_ramp_minutes
eStart = sunset - evening_ramp_minutes, eEnd = sunset
target =
  now < mStart || now >= eEnd     → night
  mStart ≤ now < mEnd             → lerp(night, day, 진행률)
  mEnd ≤ now < eStart             → day + (rad ≥ sunny_radiation_wm2 ? sunny_bonus_temp : 0)
  eStart ≤ now < eEnd             → lerp(day, night, 진행률)
ventTemp = target + vent_offset
```

### 5.3 개폐기 (구역 1벌, 위에서부터 먼저 걸리면 종료)

```
1. !gatewayOnline      → PAUSED_GATEWAY_OFFLINE, opener 'none', fan 'none'
2. emergency           → PAUSED_EMERGENCY, 'none', 'none'
3. manualStopped       → STOPPED_MANUAL, 'none', 'none' (러너가 평가 자체를 건너뛰지만 방어적으로)
4. rainActive          → PAUSED_RAIN, opener 'none' (팬 판단은 계속)
5. opener.moving       → opener 'none'
6. desired =
     tIn ≤ low_temp    → 0                     [SAFETY_LOW, 대기시간 무시]
     tIn ≥ high_temp   → max_open_pct          [SAFETY_HIGH, 대기·바깥온도 제한 무시]
     else:
       p = clamp(kp_pct_per_deg × (tIn − ventTemp), 0, 100)                     [TEMP_CONTROL]
       if rhIn ≥ humidity_high && tIn ≥ target − 1: p = max(p, dehumid_open_pct) [DEHUMID]
       p = min(p, outsideLimit(tOut), max_open_pct)                               [OUTSIDE_LIMIT]
7. positionPct == null → desired ≥ 50 ? 'home_open' : 'home_close'               [HOMING]
8. safety 아님 && lastMoveEndAt + settle_minutes > now → 'none'                  [SETTLING]
9. diff = desired − positionPct
     safety 아님 && |diff| < min_move_pct → 'none'                                [DEADBAND]
     safety 아님 → diff = clamp(diff, −step_max_pct, +step_max_pct)               [STEP_LIMIT]
     'move' to positionPct + diff
outsideLimit(t) = outside_limits 를 maxOutsideTemp 오름차순으로 보고 t ≤ maxOutsideTemp 인 첫 maxOpenPct, 없으면 100
```

### 5.4 유동팬 (구역의 모든 팬 함께)

```
dewMargin = tIn − dewPoint
stagnant  = (positionPct ?? 0) ≤ fan_stagnant_open_pct && rad ≥ fan_stagnant_radiation
wantOn  = rhIn ≥ fan_humidity_on || dewMargin ≤ fan_dew_margin_on || tIn ≥ high_temp || stagnant
wantOff = rhIn ≤ fan_humidity_off && dewMargin ≥ fan_dew_margin_off && tIn < high_temp − 1 && !stagnant
fan.on  && wantOff && 켜진 지 ≥ fan_min_on_minutes  → 'off'
!fan.on && wantOn  && 꺼진 지 ≥ fan_min_off_minutes → 'on'
else 'none'
```
켜짐 동안의 동작/대기 듀티는 구역 게이트웨이 `fallback_configs.fan_operation_minutes / fan_standby_minutes`(기존 '장치 설정' 값) 적용.

### 5.5 사유 코드 → 화면 문구 (`climate-reasons.ts`)

쉬운 말로, 한 줄에 하나:

| 코드 | 문구 |
|---|---|
| TEMP_CONTROL | 온도에 맞춰 창을 조절했어요 |
| SAFETY_HIGH | 너무 더워서 창을 최대로 열었어요 |
| SAFETY_LOW | 너무 추워서 창을 모두 닫았어요 |
| DEHUMID | 습해서 창을 조금 열었어요 |
| OUTSIDE_LIMIT | 바깥이 추워서 조금만 열었어요 |
| HOMING | 창 위치를 확인하려고 끝까지 움직였어요 |
| SETTLING / DEADBAND | 지금 상태를 유지해요 |
| PAUSED_RAIN | 비가 와서 창은 그대로 두었어요 |
| FAN_HUMID / FAN_DEW / FAN_HOT / FAN_STAGNANT | 습해서 / 이슬 맺힐 수 있어서 / 더워서 / 공기가 고여서 유동팬을 켰어요 |
| FAN_CLEAR | 괜찮아져서 유동팬을 껐어요 |

`summary` 예: "창 40% 열림 · 유동팬 켜짐 · 목표 26℃"

---

## 6. 실행

### 6.1 러너 (`climate-auto-runner.service.ts`)

```ts
@Cron(CronExpression.EVERY_MINUTE)
async tick() {
  if (!isClimateAutoEnabled()) return;           // ← 첫 줄, DB 접근 전
  if (this.running) return; this.running = true;
  try {
    await this.stopOverdueMotors();              // 재시작 안전
    const zones = await repo.find({ where: { mode: In(['shadow','auto']), status: Not('STOPPED_MANUAL') } });
    for (const z of zones) await this.evaluateZone(z).catch(e => logger.warn(...));
  } finally { this.running = false; }
}
```
`evaluateZone`: inputs → prereq(실패 시 `SUSPENDED_MISSING`, 상태 바뀔 때만 알림·소켓) → decide → status·로그 저장 → `mode==='auto'`일 때만 실행 → 소켓.
추가 크론(첫 줄 플래그 확인): 로그 14일 초과 삭제(매일 03:30), 일출 1시간 전 위치가 0%로 추정되는 구역은 하루 1회 `home_close`로 누적오차 보정.

### 6.2 개폐기 이동 (`opener-motion.service.ts`) — 구역 단위

```
moveZone(zone, fromPct, toPct):
  dir  = toPct > fromPct ? 'open' : 'close'
  full = dir==='open' ? opener_full_open_seconds : (opener_full_close_seconds ?? opener_full_open_seconds)
  sec  = |toPct − fromPct| / 100 × full ; sec < MIN_PULSE_SEC 이면 생략
homeZone(zone, dir): sec = full × HOMING_FACTOR, 끝나면 position = dir==='open' ? 100 : 0

pulseZone(zone, dir, sec):  ← 구역의 모든 개폐기 쌍에 동시에
  1. 모든 쌍의 반대 장치 OFF  (devices.controlDevice(id, owner, [{code:'state',value:false}], 'admin', 'climate-auto'))
  2. sleep(OPENER_INTERLOCK_MS)
  3. 구역 상태 저장: opener_moving_dir=dir, opener_motor_stop_at=now+sec
  4. 모든 쌍의 대상 장치 ON (controlDevice(..., 'climate-auto', sec*1000))
       - 온보드(GPIO): durationMs로 gpio-agent가 자동 OFF
       - Zigbee: 서버가 5에서 OFF
  5. setTimeout(sec) → 모든 대상 OFF → position ±Δ(0~100 클램프), moving 해제, last_move_end_at=now
stopOverdueMotors(): opener_motor_stop_at < now 인 구역 → 모든 개폐기 OFF, position=NULL
```
- 구역 단위 락(`Map<groupId, Promise>`) + 기존 `devices.service`의 쌍 락(`withOpenerLock`)을 그대로 탄다.
- 한 쌍이라도 명령 실패 → 모든 쌍 OFF, position=NULL, 로그 `MOTOR_ERROR`, 알림.

### 6.3 유동팬 (`fan-control.service.ts`)

'on' → 구역 팬 전부 ON, 'off' → 전부 OFF. 켜짐 동안 동작/대기 듀티(§5.4). 명령은 `controlDevice(..., 'admin', 'climate-auto')`.

### 6.4 모드 전환과 룰 정지/복귀 (`climate-auto.service.ts#setMode`)

```
setMode(groupId, mode, user):
  if mode in (shadow, auto): prereq 실패 → 409 { code:'CLIMATE_PREREQ_MISSING', missing:[...] }
  prev = config.mode
  트랜잭션:
    if prev!='auto' && mode=='auto':
       targetIds = 구역 개폐기(쌍 포함)·유동팬 device id
       UPDATE automation_rules SET enabled=false, disabled_reason='climate_auto', disabled_at=now()
        WHERE group_id=$1 AND enabled=true
          AND (actions->>'targetDeviceId' = ANY($2) OR actions->'targetDeviceIds' ?| $2)
    if prev=='auto' && mode!='auto':
       UPDATE automation_rules SET enabled=true, disabled_reason=NULL, disabled_at=NULL
        WHERE group_id=$1 AND disabled_reason='climate_auto'
       opener_position_pct = NULL
    mode=mode, status = mode=='off' ? 'IDLE' : 'RUNNING', stopped_at=NULL, stopped_by=NULL
  activityLog.log({ action:'climate_auto.mode_changed', targetType:'group', details:{from:prev,to:mode} })
```
- **시험 운전(shadow)은 룰을 멈추지 않는다** — 기록만, 장치는 기존 룰이 운전.
- 룰 활성화 경로(`automation.service.ts`의 `toggle()`/`update()`)에서 `disabled_reason='climate_auto'`면 409 `RULE_LOCKED_BY_CLIMATE_AUTO`(허용 ④).

### 6.5 수동 조작 → 정지

- 프론트 확인 팝업(§10.5) 확인 시 `POST /groups/stop-manual`.
- 안전망: `devices.service.ts#controlDeviceInner`에서 `callerSource`가 없을 때 `device.user.controlled` 이벤트 emit 1줄(허용 ②). 리스너(첫 줄 플래그 확인)는 그 장치가 `mode='auto'`이고 STOPPED_MANUAL 아닌 구역의 개폐기·팬이면 `stopManual(groupId, null)`.
- `stopManual`: status=STOPPED_MANUAL, stopped_at=now, stopped_by, 이동 중 모터 즉시 OFF, position=NULL, 활동 로그 `climate_auto.stopped_manual`, 소켓. **mode는 'auto' 유지, 룰도 정지 유지 → 완전 수동.** 시간이 지나도 풀리지 않는다.

### 6.6 복귀 선택 (`restore(groupId, target)`)

| target | 화면 버튼 | 동작 |
|---|---|---|
| `climate` | 자동 운전 다시 켜기 | 준비 상태 재검사 → 실패 409. 성공 시 RUNNING, position NULL(원점 복귀부터). 룰은 계속 정지 |
| `rules` | 자동 제어 룰로 돌아가기 | `setMode(groupId,'off')` — climate_auto 룰 재활성화 |

활동 로그 `climate_auto.restored {target}`.

### 6.7 알림 (`notifications.service.sendToFarm`)

| 이벤트 | 제목 | 내용 |
|---|---|---|
| RUNNING → SUSPENDED_MISSING | 자동 운전 잠시 멈춤 | "{구역}: {항목} 값이 안 들어와서 자동 운전을 멈췄어요. 창과 유동팬은 지금 상태 그대로예요." |
| SUSPENDED_MISSING → RUNNING | 자동 운전 다시 시작 | "{구역}: 센서가 돌아와서 자동 운전을 다시 시작해요." |
| MOTOR_ERROR | 개폐기 명령 실패 | "{구역}: 개폐기 명령이 실패했어요. 창 위치를 다시 확인할게요." |

같은 구역·같은 이벤트는 30분 내 중복 금지.

---

## 7. API (`climate-auto.controller.ts`, prefix `/api/climate-auto`)

모든 핸들러 앞 `ClimateAutoEnabledGuard`(플래그 OFF → 404). `capability`만 가드 없이 항상 200.

| Method | Path | Roles | 설명 |
|---|---|---|---|
| GET | `/capability` | 로그인 | `{ enabled }` |
| GET | `/groups` | admin, farm_admin, farm_user | 내 구역들 `[{groupId, mode, status, summary, ready}]` (구역 카드 띠·배지용) |
| GET | `/groups/:groupId` | 동일 | `{ config, status, stoppedAt, stoppedByName, prerequisites, opener:{positionPct, moving, pairCount}, fan:{on, count}, summary, targetTemp, inputs, suspendedRuleCount }` |
| PUT | `/groups/:groupId/config` | admin, farm_admin | 설정 저장(모드 제외). 검증: day>night, 10≤fullOpen≤540, high>low+5, fan_humidity_on>off, dew_margin_off>on, 0≤pct≤100, outside_limits 오름차순. **완전개방/닫힘 시간이 바뀌면 position NULL** |
| POST | `/groups/:groupId/mode` | admin, farm_admin | `{ mode }` → 200 / 409 `CLIMATE_PREREQ_MISSING` |
| POST | `/groups/:groupId/home` | admin, farm_admin | `{ direction:'open'\|'close' }` 수동 원점 복귀(비상 정지·비 중이면 409) |
| GET | `/groups/:groupId/logs?limit=50&before=` | admin, farm_admin, farm_user | 판단 기록 |
| GET | `/stopped` | admin, farm_admin | STOPPED_MANUAL 구역 `[{groupId, groupName, stoppedAt, stoppedByName, suspendedRuleCount, ready}]` |
| POST | `/devices/check-manual` | admin, farm_admin | `{ deviceIds }` → 그 장치가 속한 **자동 운전 중** 구역 `[{groupId, groupName}]` (상태 변경 없음) |
| POST | `/groups/stop-manual` | admin, farm_admin | `{ groupIds }` → 각 구역 stopManual |
| POST | `/groups/:groupId/restore` | admin, farm_admin | `{ target:'climate'\|'rules' }` |
| POST | `/groups/:groupId/rs485-sensors` | admin, farm_admin | 구역 게이트웨이에 RS485 센서 device 생성(멱등, §7.1) |

- 소유권: `house_groups.user_id` = 요청자(또는 farm_user의 parent), admin 전체 — groups.service의 구역 접근 판정과 같은 규칙.
- `X-Farm-Context`: 일반 농장 라우트(`@PlatformScope()` 붙이지 않음).
- 소켓 `climate:status` `{ groupId, mode, status, summary, positionPct, moving, fanOn, targetTemp, evaluatedAt }` → `user:<ownerId>` + `admins`. `events.gateway.ts`에 `broadcastClimateStatus()`(허용 ③).

### 7.1 RS485 device 생성 규칙

```ts
{ userId: gw.userId, gatewayId: gw.id, name: '환경센서(RS485)' | '일사량계(RS485)',
  category:'sensor', deviceType:'sensor', equipmentType:'rs485_climate' | 'rs485_solar',
  source:'onboard', onboardDeviceId: null, friendlyName:'rs485_climate' | 'rs485_solar' }
```
`onboardDeviceId=null`이라 gateway-env 고아 정리 대상 아님. 스키마 변경 없음. 환경 매핑은 사용자가 '구역 환경 설정'에서 지정.

---

## 8. 개발서버 전용 차단 체크리스트

- [ ] 모든 크론·리스너·컨트롤러(가드) 첫 줄에서 `isClimateAutoEnabled()`. OFF면 climate 테이블 쿼리 0회.
- [ ] 개발서버 `.env`에만 `CLIMATE_AUTO_ENABLED=true`. `.env.example`엔 `CLIMATE_AUTO_ENABLED=false`와 주석.
- [ ] **`docker-compose.yml`(운영) 수정 금지.**
- [ ] 마이그레이션 054는 파일만 추가, 개발 DB에만 적용. 운영 배포 절차에 포함 금지.
- [ ] 프론트: `GET /climate-auto/capability` 1회 → false면 관련 UI를 아예 렌더하지 않음.
- [ ] Pi RS485 폴러는 `/etc/smartfarm/rs485.json`이 있고 `enabled:true`일 때만(기본 OFF).
- [ ] 기능 브랜치 `feature/climate-auto-mode`.

---

## 9. 기존 코드 수정 허용 목록 (이 외 수정 금지)

| # | 파일 | 변경 | 운영 영향 |
|---|---|---|---|
| ① | `backend/src/modules/mqtt/mqtt-sensor.handler.ts` | `SENSOR_MAP`에 `solar_radiation: { field:'solar_radiation', unit:'W/m²' }` | 해당 키 없으면 무영향 |
| ② | `backend/src/modules/devices/devices.service.ts` | `callerSource` 유니온에 `'climate-auto'`(2곳), `!callerSource`일 때 `device.user.controlled` emit 1줄 | 리스너 없으면 무영향 |
| ③ | `backend/src/modules/gateway/events.gateway.ts` | `broadcastClimateStatus()` 추가 | 호출 없으면 무영향 |
| ④ | `backend/src/modules/automation/automation.service.ts` | `toggle()`/`update()`에서 climate_auto 사유 룰 활성화 시 409 | 해당 사유 없으면 무영향 |
| ⑤ | `backend/src/app.module.ts` | `ClimateAutoModule` import | 플래그 OFF면 동작 없음 |
| ⑥ | `frontend/src/views/Groups.vue` | (a) 구역 이름 옆 상태 배지, (b) 구역 카드 안 '환경 자동 운전' 띠(§10.3), (c) '자동제어 원복' 배너 아래 정지 배너, (d) `guardActiveRulesBeforeManual()` 앞에 `guardClimateBeforeManual()` 1줄 — 모두 capability true일 때만 | 숨김·즉시 통과 |
| ⑦ | 구역 카드의 '자동 제어 (n)' 룰 목록 렌더 부분(Groups.vue 내) + 자동 제어 설정 화면 룰 카드 | `disabledReason==='climate_auto'` 룰은 토글 비활성 + "자동 운전 중이라 멈춤" 회색 표시. 프론트 타입에 `disabledReason` 필드 추가 | 해당 사유 없으면 무영향 |
| ⑧ | `frontend/src/components/groups/BulkControlModal.vue` | 룰 정지 안내 단계(`getActiveRulesForDevices` 호출부)에 '멈출 자동 운전 구역' 목록 추가, 실행 시 stop-manual | capability false면 기존과 동일 |
| ⑨ | `frontend/src/components/groups/EnvConfigModal.vue` | 없음 — 일사량 역할은 054로 추가되어 기존 '내부 환경' 목록에 자동 노출 | — |
| ⑩ | `raspberry-pi/fallback-engine/index.js` | RS485 폴러 연결(RainGpio와 같은 패턴) | 설정 파일 없으면 비활성 |
| ⑪ | `.env.example` | 플래그 문서화 | 없음 |

**수정 금지**: `automation-runner.service.ts`, `rain-override.service.ts`, `high-temp-override.service.ts`, `fallback-config/*`, Pi `rule-evaluator/*`, `docker-compose.yml`, `App.vue`(사이드바 메뉴 추가 없음 — 기능은 '구역 관리' 화면 안에만 둔다).

---

## 10. 화면 (쉬운 UI)

### 10.1 원칙 (40대 이상 사용자)

1. **새 메뉴를 만들지 않는다.** 왼쪽 사이드바는 그대로, 모든 기능은 **구역 관리 → 각 구역 카드** 안에 둔다(이미 익숙한 자리).
2. **한 화면에 결정 하나.** 구역 카드에서는 '켜기/끄기'와 지금 상태만, 세부는 설정 창에서.
3. **보이는 설정은 3개**: 낮 목표 온도, 밤 목표 온도, 개폐기 완전개방 시간. 나머지는 '전문가 설정 ▾'에 접어 둔다(처음엔 닫힘).
4. **쉬운 말**: '모드/shadow/프리리퀴지트' 대신 '시험 운전', '필요한 장치', '창 40% 열림'. 숫자에는 단위와 뜻을 함께("26℃ 넘으면 창을 엶").
5. **크게**: 본문 16px 이상(기존 `--content-scale` 따름), 버튼 높이 48px 이상, 주 버튼은 한 줄에 하나만 진하게.
6. **색은 의미 하나씩**: 초록=자동 운전 중, 파랑=시험 운전, 주황=확인 필요(장치 문제), 붉은 장밋빛=수동으로 멈춤, 회색=꺼짐/비·연결 끊김. 색만으로 구분하지 않고 항상 글자를 함께.
7. 기존 화면 요소 재사용: 페이지 헤더, 구역 카드(`.group-card`), 섹션 띠(`.section-label` 계열), 모달(구역 환경 설정과 같은 모양: 흰 카드·제목·✕·하단 [취소][저장]), 확인 팝업(`useConfirm`).

### 10.2 파일

```
frontend/src/api/climate-auto.api.ts
frontend/src/types/climate-auto.types.ts
frontend/src/composables/useClimateAuto.ts        # capability 캐시, 구역 상태 목록, 소켓 구독, guardClimateBeforeManual
frontend/src/components/climate-auto/ClimateZoneStrip.vue     # 구역 카드 안 '환경 자동 운전' 띠
frontend/src/components/climate-auto/ClimateStatusBadge.vue   # 구역 이름 옆 배지
frontend/src/components/climate-auto/ClimateSettingsModal.vue # 설정 창
frontend/src/components/climate-auto/ClimateStoppedBanner.vue # 페이지 상단 정지 배너
```

### 10.3 구역 카드 안 '환경 자동 운전' 띠 (`ClimateZoneStrip`)

위치: 구역 카드 본문에서 **'장치 (n)' 섹션 다음, '자동 제어 (n)' 섹션 앞**. 띠 머리글은 다른 섹션과 같은 `.section-label` 모양, 색은 청록(`#e0f2f1` 배경 / `#00695c` 글자). 본문은 `.sub-card` 하나.

| 상태 | 띠 안 내용 | 버튼 |
|---|---|---|
| 꺼짐 + 준비됨 | "센서를 보고 창과 유동팬을 알아서 조절해요." | [자동 운전 켜기](초록) [설정] |
| 꺼짐 + 준비 안 됨 | "필요한 장치 **2개**가 없어 아직 켤 수 없어요." | [무엇이 필요한지 보기](주황 테두리) |
| 자동 운전 중 | 큰 글자 한 줄 `summary`: "창 40% 열림 · 유동팬 켜짐 · 목표 26℃" + 작은 글자 마지막 판단 문구("온도에 맞춰 창을 조절했어요 · 1분 전") + 창 위치 막대 1개 | [설정] [끄기] |
| 시험 운전 중 | "시험 운전 중 — 기록만 하고 창은 기존 자동 제어가 움직여요." + "지금이라면: 창 30%로 열었을 거예요" | [자동 운전으로 바꾸기] [설정] |
| 잠시 멈춤(장치 문제) | 주황 "**일사량** 값이 25분째 안 들어와서 멈췄어요. 창과 유동팬은 지금 상태 그대로예요." | [설정] |
| 비 | 회색 "비가 와서 창은 닫힌 채 두었어요. 그치면 다시 조절해요." | — |
| 수동으로 멈춤 | 장밋빛 "14:32 직접 조작해서 자동 운전을 멈췄어요." | [자동 운전 다시 켜기](초록) [자동 제어 룰로 돌아가기](흰색) |

- 구역 이름 옆 배지(`ClimateStatusBadge`): 꺼짐이면 표시 안 함. 그 외 '자동 운전'(초록) / '시험 운전'(파랑) / '확인 필요'(주황) / '수동 멈춤'(장밋빛) / '비 · 대기'(회색).
- 자동 운전 중이면 '자동 제어 (n)' 섹션의 개폐기·유동팬 룰은 회색 + "자동 운전 중이라 멈춤"(⑦).
- farm_user: 띠는 보이되 버튼 없음(읽기 전용).
- [끄기]는 확인 팝업: "자동 운전을 끌까요? 멈춰 두었던 자동 제어 룰 N개가 다시 켜집니다." [취소][끄기].

### 10.4 설정 창 (`ClimateSettingsModal`) — 구역 환경 설정 창과 같은 모양

제목 "환경 자동 운전 — {구역 이름}". 위에서 아래로 4칸, 각 칸 제목은 굵게 한 줄 + 설명 한 줄.

1. **필요한 장치** — 8줄 체크리스트(✓ 초록 / ! 주황). 모두 준비되면 한 줄 요약 "✓ 필요한 장치가 모두 준비됐어요 (8/8)" + [자세히 ▾]로 접힘. 준비 안 된 줄에는 오른쪽에 바로 가는 버튼 하나: [환경 설정 열기](구역 환경 설정 모달) / [시간 입력하기](아래 3번 칸으로 스크롤) / [RS485 센서 등록].
2. **목표 온도** — 두 줄, 큰 숫자 입력 + [−][+] 버튼(0.5℃ 단위):
   - "낮 목표 [ 26 ]℃ — 이 온도보다 높으면 창을 열어요"
   - "밤 목표 [ 16 ]℃ — 해 지면 이 온도에 맞춰요"
3. **개폐기 완전개방 시간** — "이 구역 개폐기가 끝까지 열리는 데 걸리는 시간 [ 180 ]초", 설명 "구역 안 개폐기 {n}쌍이 모두 같이 움직여요. 초시계로 재서 입력하세요." 그 아래 작은 글씨 링크 "닫히는 시간이 다르면" → 전문가 설정의 닫힘 시간으로.
4. **운전 방식** — 세로 3개의 큰 선택 카드(라디오):
   - 끄기 — "기존 자동 제어 룰로 운전해요"
   - 시험 운전 — "기록만 해요. 창과 유동팬은 움직이지 않아요"
   - 자동 운전 — "센서를 보고 창과 유동팬을 알아서 조절해요"
   준비 안 됐으면 시험·자동 카드는 흐리게 + "필요한 장치를 먼저 준비하세요".
- **전문가 설정 ▾** (처음엔 닫힘): 완전 닫힘 시간, 환기 여유, 고온·저온 기준, 습도 기준, 바깥온도별 최대 개방, 단계·대기, 유동팬 기준, 농장 좌표, 원점 복귀 버튼, [판단 기록 보기].
- 하단: [취소] [저장](초록). 저장 시 모드 변경이 있으면 §10.3의 확인 문구를 한 번 더 보여준다.

### 10.5 수동 조작 확인 팝업 & 정지 배너

**(1) 개별 수동 조작** — 장치 토글·개폐기 버튼을 누를 때 기존 `guardActiveRulesBeforeManual()`보다 먼저:
```ts
async function guardClimateBeforeManual(deviceIds: string[], label: string): Promise<boolean> {
  if (!capability.value || isFarmUser) return true
  const zones = (await climateApi.checkManual(deviceIds)).data
  if (!zones.length) return true
  const ok = await confirm({
    title: '자동 운전 중인 구역이에요',
    message: `${zones.map(z => z.groupName).join(', ')}은(는) 지금 자동 운전 중이에요.\n` +
             `${label}을(를) 직접 움직이면 자동 운전이 멈춰요.\n` +
             `나중에 화면 위쪽에서 다시 켤 수 있어요.`,
    confirmText: '멈추고 직접 조작', cancelText: '취소', variant: 'warning',
  })
  if (!ok) return false
  await climateApi.stopManual(zones.map(z => z.groupId))
  await refreshStopped()
  return true
}
```
**(2) 일괄제어** — BulkControlModal의 '정지될 자동 제어 룰' 목록 위에 같은 모양으로 '멈출 자동 운전 구역' 목록.
**(3) 정지 배너** — 기존 '자동제어 원복'(앰버) 배너 바로 아래, 같은 크기·모양, 장밋빛:
```
┌──────────────────────────────────────────────────────────────────┐
│ ✋ 직접 조작해서 자동 운전이 멈춘 구역이 있어요                      │
│ ┌ 하교하우스 · 14:32 오정석 ─────────────────────────────────────┐ │
│ │ [자동 운전 다시 켜기]  [자동 제어 룰로 돌아가기]                  │ │
│ └────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```
- 구역이 여러 곳이면 구역마다 한 줄씩. '전체' 메뉴는 두지 않는다(실수 방지 + 단순).
- '자동 운전 다시 켜기'인데 준비 안 됨(409) → 팝업 "지금은 다시 켤 수 없어요" + 빠진 장치 목록 + [자동 제어 룰로 돌아가기] [닫기].
- farm_user에게는 숨김(기존 원복 배너와 동일).

### 10.6 스타일 값 (기존 토큰 재사용)

기존: `--accent #2e7d32`, `--accent-bg #e8f5e9`, `--bg-primary #f5f7fa`, 카드 흰색·반경 14px, `--sensor-bg #ede7f6/--sensor-accent #7b1fa2`, `--automation-bg #fff3e0/--automation-text #e65100`, 일괄 제어 버튼 `#ef6c00`. 다크 모드는 기존 `#app.theme-dark` 변수 체계에 같은 의미의 색을 추가.

| 용도 | 배경 | 테두리 | 글자 |
|---|---|---|---|
| '환경 자동 운전' 띠 머리글 | `#e0f2f1` | – | `#00695c` |
| 배지 자동 운전 | `#e8f5e9` | – | `#1b5e20` |
| 배지 시험 운전 | `#e3f2fd` | – | `#0d47a1` |
| 배지 확인 필요 | `#fff3e0` | – | `#b45309` |
| 배지 수동 멈춤 / 정지 배너 | `#fff1f2` | `#fda4af` | `#9f1239` |
| 배지 비·대기·꺼짐 | `#eceff1` | – | `#455a64` |
| 주 버튼 | `#2e7d32` | – | `#fff` |
| 보조 버튼 | `#fff` | `#cfd8dc` | `#37474f` |
| 창 위치 막대 | 트랙 `#ffe0b2` | – | 채움 `#ef6c00`, 위치 모름 = 사선 |

버튼 최소 높이 48px(모바일 52px), 입력칸 48px·글자 18px, 띠 본문 글자 17px.

---

## 11. Pi — RS485 폴러 (`raspberry-pi/fallback-engine/lib/rs485-poller.js`)

- 의존성 `modbus-serial`.
- 설정 파일 `/etc/smartfarm/rs485.json`(없거나 `enabled:false`면 비활성):
```json
{
  "enabled": true,
  "port": "/dev/serial/by-id/<RS485 변환기>",
  "baudRate": 4800,
  "intervalSec": 60,
  "devices": [
    { "kind": "solar",   "address": 2, "register": 0, "count": 1, "scale": 1,
      "friendlyName": "rs485_solar",   "fields": { "solar_radiation": 0 } },
    { "kind": "climate", "address": 1, "register": 0, "count": 2, "scale": 0.1, "signed": true,
      "friendlyName": "rs485_climate", "fields": { "temperature": 0, "humidity": 1 } }
  ]
}
```
  - SEN0640(제조사 문서): 주소 1, 4800bps 8N1, 기능코드 0x03, 레지스터 0x0000 = W/m²(1:1), 주소 변경 0x07D0, 보율 0x07D1(0=2400,1=4800,2=9600). 두 센서는 주소를 다르게, 보율은 같게.
  - 온습도계 레지스터·스케일은 **실제 구매 제품 매뉴얼로 확정**(위 climate 값은 자리표시자).
- `intervalSec`마다 순서대로 읽기(장치 간 200ms, 타임아웃 1s, 1회 재시도) → 성공한 장치만 `farm/{gw}/z2m/{friendlyName}` 발행. 범위 밖(temperature −40~85, humidity 0~100, solar 0~2000) 미발행.
- `index.js`에 RainGpio와 같은 방식으로 연결(⑩).
- 테스트 `test/rs485-poller.test.js`(`node --test`): 설정 없음→비활성, 정상→payload, 범위 밖→미발행, 타임아웃→재시도 후 미발행.

---

## 12. 테스트

### 12.1 엔진 단위 테스트 `backend/test/climate-decision.spec.ts`

| # | 상황 | 기대 |
|---|---|---|
| 1 | 야간, tIn 15, 위치 0 | 'none' |
| 2 | 오전 램프 중간 | target=(16+26)/2 |
| 3 | 주간, rad 700 | target 27 |
| 4 | tIn ≤ 12 | 0%, 대기 무시 |
| 5 | tIn ≥ 32, tOut 3 | max_open_pct |
| 6 | tIn 28, ventTemp 27, kp 20 | desired 20% |
| 7 | tOut 4 | ≤10% |
| 8 | rh 90, tIn ≥ target−1, 온도상 0 | 10% DEHUMID |
| 9 | 위치 0 → desired 60 | 25% (단계) |
| 10 | |diff| 3 | 'none' |
| 11 | 이동 2분 전, settle 4 | 'none' |
| 12 | 위치 null, desired 70/20 | home_open / home_close |
| 13 | rainActive | opener 'none', PAUSED_RAIN, 팬 판단 계속 |
| 14 | manualStopped | STOPPED_MANUAL, 모두 'none' |
| 15~19 | 팬: 습도·최소 꺼짐·이슬점·끄기·정체 | §5.4대로 |
| 20 | 입력 null | SUSPENDED_MISSING |
| 21 | summary 문구 | "창 40% 열림 · 유동팬 켜짐 · 목표 26℃" 형식 |

### 12.2 통합 테스트 `backend/test/climate-auto.spec.ts` (기존 하네스)

- `beforeAll`에서 `process.env.CLIMATE_AUTO_ENABLED='true'`, `afterAll`에서 삭제. 시드의 농장1 구역 `id(1,10)`, 게이트웨이 `id(1,30)`, 개폐기 쌍 `id(1,42)/id(1,43)`, 유동팬 `id(1,41)`, 온습도 `id(1,40)`, 룰 `id(1,50)` 사용(장치 `gateway_id`를 게이트웨이 PK로 맞춤). 두 번째 개폐기 쌍을 테스트 안에서 추가해 **구역 내 모든 쌍이 함께 움직이는지** 확인.
- 케이스:
  1. 플래그 OFF: capability false, 다른 API 404, tick 후 로그 0.
  2. 준비 미충족(일사 매핑 없음 / 완전개방 시간 없음) → mode auto 409 + missing.
  3. 준비 후 auto → 200, 룰 `id(1,50)` disabled_reason='climate_auto'.
  4. auto→off → 그 룰만 복귀, 'bulk' 룰은 그대로.
  5. shadow: 룰 유지, tick → 로그 executed=false, 명령 0.
  6. auto + 고온 + 위치 NULL → **두 쌍 모두** 열림 ON(`callerSource='climate-auto'`).
  7. 완전개방 180초, 0%→25% → 펄스 45초(두 쌍 동일).
  8. 센서 25분 전 → SUSPENDED_MISSING, 명령 0.
  9. 비 → 개폐기 명령 0. 10. 비상 정지 → 명령 0.
  11. 개폐기 쌍 하나 offline → 준비 실패.
  12. `device.user.controlled` → STOPPED_MANUAL, 시계 2시간 앞으로 + tick 여러 번 → 유지·명령 0.
  13. restore climate → RUNNING(룰 정지 유지) / 준비 미충족 409. restore rules → off + 룰 복귀.
  14. check-manual → auto 구역만, 상태 불변. stop-manual → `/stopped`에 노출.
  15. 권한: farm_user 쓰기 403, 타 농장 구역 403/404, X-Farm-Context로 admin 조회.
  16. config PUT: fullOpen 5·600 → 400, 값 변경 시 position NULL.
  17. climate_auto 사유 룰 활성화 → 409.
- 마지막에 **전체 `npm test` 통과**.

---

## 13. 구현 지시 (Claude Code CLI용)

> 프로젝트 `CLAUDE.md` 규칙을 따른다. 각 Phase 끝에 `cd backend && npm test`, 실패 시 다음 Phase로 넘어가지 말 것. Phase별 커밋. 브랜치 `feature/climate-auto-mode`.

**Phase 0 — 기반 & 차단**: 상수(§2.3), 엔티티 2개, `ClimateAutoModule`, 가드, `GET /capability`, 마이그레이션 054, 허용 ⑤⑪. DoD: 플래그 OFF 전체 테스트 통과, ON으로 `start:dev` 시 테이블 생성.

**Phase 1 — RS485 수집**: Pi 폴러 + 테스트(§11), ⑩, `raspberry-pi/README.md` 설정·배선 절. 백엔드 ①, `POST /groups/:id/rs485-sensors`. DoD: `node --test` 통과, `farm/{gw}/z2m/rs485_solar {"solar_radiation":420}` 발행 시 sensor_data 저장.

**Phase 2 — 입력·준비 상태·설정 API**: §3, §4, 설정 CRUD, GET/PUT(§7). DoD: 통합 1, 2, 11, 15, 16.

**Phase 3 — 판단 엔진**: `climate-decision.ts`, `climate-reasons.ts`(§5.5 문구 그대로), suncalc. DoD: 21케이스.

**Phase 4 — 실행**: 러너, opener-motion(구역 단위), fan-control, setMode, stopManual/restore, 감지 리스너(②④), 알림, 소켓(③), 로그 정리. DoD: 통합 3~10, 12~14, 17 + 전체 통과.

**Phase 5 — 화면**: §10 파일, Groups.vue(⑥⑦), BulkControlModal(⑧). **새 메뉴·사이드바 변경 없음.** capability false면 아무것도 렌더하지 않음. 문구는 §5.5·§10을 그대로 사용. DoD: `npm run build`, 플래그 OFF 화면 변화 없음, ON에서 띠·설정 창·확인 팝업·정지 배너 동작.

**Phase 6 — 검증 문서**: `docs/03-analysis/climate-auto-mode.analysis.md`(설계 차이, 미확정 항목, 시험 운전 체크리스트).

**금지**: §9 금지 목록 수정, 운영 compose 변경, 운영 DB 마이그레이션, main 직접 커밋.

---

## 14. 미확정·후속 결정

- 온습도계 실제 모델의 Modbus 레지스터·스케일.
- 기본 제어값(낮 26℃·밤 16℃ 등)은 방울토마토 일반값 출발점 — 시험 운전 기록으로 조정.
- 운영 반영 시: 054 운영 적용, compose 플래그, Pi 폴백엔진 이식 여부 — 별도 계획.
- 풍속계 추가 시 §5.3 4번 뒤에 "강풍 닫힘" 삽입 예정.
