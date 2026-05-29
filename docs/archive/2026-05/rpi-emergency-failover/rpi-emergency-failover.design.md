# Design: 라즈베리파이 이머전시 페일오버 (Hybrid Fallback)

**Feature ID**: `rpi-emergency-failover`
**작성일**: 2026-05-20
**기반 문서**: [01-plan/features/rpi-emergency-failover.plan.md](../../01-plan/features/rpi-emergency-failover.plan.md)
**상태**: Design

---

## 1. 아키텍처 개요

### 시스템 토폴로지

```
┌─────────────────────────────────────────────────────────────────┐
│                       NestJS Backend (Server)                    │
│                                                                  │
│  ┌────────────────┐  ┌───────────────────┐  ┌────────────────┐ │
│  │ automation-    │  │ fallback-config   │  │ heartbeat-     │ │
│  │ runner.service │  │ .service (NEW)    │  │ publisher (NEW)│ │
│  └────────────────┘  └───────────────────┘  └────────────────┘ │
│           │                    │                    │           │
│           └────────────────────┴────────────────────┘           │
│                              MQTT Pub/Sub                        │
└────────────────────────────┬────────────────────────────────────┘
                             │
                  ┌──────────┴──────────┐
                  │  Mosquitto Broker   │
                  └──────────┬──────────┘
                             │
┌────────────────────────────┴────────────────────────────────────┐
│                  Raspberry Pi (Edge Gateway)                     │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │           fallback-engine (NEW Node.js service)             ││
│  │                                                              ││
│  │  ┌──────────────┐  ┌──────────────┐  ┌───────────────────┐ ││
│  │  │ heartbeat-   │  │ mode-state-  │  │ rule-evaluator    │ ││
│  │  │ watchdog     │→ │ machine      │→ │ (opener/irrig/    │ ││
│  │  │              │  │ online/fb    │  │  fert/fan)        │ ││
│  │  └──────────────┘  └──────────────┘  └───────────────────┘ ││
│  │  ┌──────────────┐  ┌──────────────┐  ┌───────────────────┐ ││
│  │  │ rule-store   │  │ command-     │  │ rain-override     │ ││
│  │  │ (JSON+SQLite)│  │ gate         │  │ integration       │ ││
│  │  └──────────────┘  └──────────────┘  └───────────────────┘ ││
│  └─────────────────────────────────────────────────────────────┘│
│           │                    │                    │           │
│  ┌────────▼────────┐  ┌────────▼────────┐  ┌──────▼──────────┐ │
│  │  gpio-agent     │  │  zigbee2mqtt    │  │  config-agent   │ │
│  │  (기존)          │  │  (기존)          │  │  (기존)          │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

### 핵심 설계 원칙
1. **기존 자동화 엔진 유지**: 서버의 `automation-runner.service.ts` (950라인)는 변경 없음
2. **명령 게이트(Command Gate)**: 폴백 모드 진입 시 RPi가 서버 GPIO 명령을 필터링
3. **단일 정보 원천(Single Source of Truth)**: 폴백 룰은 서버 DB가 권위. RPi는 미러 캐시
4. **빗물 센서 우선**: 모든 모드(online/fallback)에서 빗물 override가 최우선
5. **로컬 큐**: 폴백 중 발생한 로그는 SQLite에 큐잉, 복구 시 서버로 일괄 전송

---

## 2. DB 스키마 (서버)

### 신규 테이블

```sql
-- backend/database/migrations/020_fallback_rules.sql

-- 1. 게이트웨이별 폴백 설정 (1:1)
CREATE TABLE fallback_configs (
  gateway_id UUID PRIMARY KEY REFERENCES gateways(id) ON DELETE CASCADE,
  heartbeat_timeout_seconds INTEGER NOT NULL DEFAULT 300,    -- 5분
  recovery_grace_seconds INTEGER NOT NULL DEFAULT 30,
  opener_enabled BOOLEAN NOT NULL DEFAULT true,
  opener_rain_override BOOLEAN NOT NULL DEFAULT true,
  irrigation_enabled BOOLEAN NOT NULL DEFAULT true,
  irrigation_max_runtime_minutes INTEGER NOT NULL DEFAULT 30,
  fertilizer_enabled BOOLEAN NOT NULL DEFAULT true,
  fan_enabled BOOLEAN NOT NULL DEFAULT false,                -- default 비활성
  fan_on_temp NUMERIC(5,2) NOT NULL DEFAULT 35.0,
  fan_off_temp NUMERIC(5,2) NOT NULL DEFAULT 28.0,
  version INTEGER NOT NULL DEFAULT 1,                        -- 동기화 충돌 방지
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (fan_on_temp > fan_off_temp),
  CHECK (irrigation_max_runtime_minutes > 0),
  CHECK (heartbeat_timeout_seconds >= 60)
);

-- 2. 개폐기 월별 스케줄 (1:N, 1~12개월)
CREATE TABLE fallback_opener_schedule (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gateway_id UUID NOT NULL REFERENCES gateways(id) ON DELETE CASCADE,
  month SMALLINT NOT NULL,                                   -- 1~12
  enabled BOOLEAN NOT NULL DEFAULT true,
  mode VARCHAR(20) NOT NULL,                                 -- 'time' | 'always-open'
  open_time TIME,                                            -- mode='time'일 때만
  close_time TIME,                                           -- mode='time'일 때만
  UNIQUE (gateway_id, month),
  CHECK (month BETWEEN 1 AND 12),
  CHECK (mode IN ('time', 'always-open')),
  CHECK (
    (mode = 'always-open') OR
    (mode = 'time' AND open_time IS NOT NULL AND close_time IS NOT NULL)
  )
);

-- 3. 게이트웨이 현재 모드 캐시 (서버 측, RPi mode publish 미러)
-- RPi의 `farm/{gw}/fallback/mode` 메시지를 수신해 서버에 저장.
-- UI가 빠르게 모드 조회 가능 + WebSocket emit 트리거.
CREATE TABLE fallback_gateway_status (
  gateway_id UUID PRIMARY KEY REFERENCES gateways(id) ON DELETE CASCADE,
  mode VARCHAR(20) NOT NULL DEFAULT 'unknown',
  mode_changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_heartbeat_seen_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (mode IN ('online', 'fallback', 'unknown'))
);

-- 4. 폴백 이벤트 로그 (서버에서 통합 조회용)
CREATE TABLE fallback_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gateway_id UUID NOT NULL REFERENCES gateways(id) ON DELETE CASCADE,
  event_type VARCHAR(40) NOT NULL,                           -- 'mode_change' | 'rule_fired' | 'safety_off'
  payload JSONB NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  reported_at TIMESTAMPTZ NOT NULL DEFAULT now()             -- RPi에서 큐잉되어 보고된 시각
);
CREATE INDEX idx_fallback_events_gateway ON fallback_events(gateway_id, occurred_at DESC);
CREATE INDEX idx_fallback_events_type ON fallback_events(event_type);

-- 4. 기본 시드 INSERT (마이그레이션에 포함)
-- gateways 테이블의 모든 row에 대해 fallback_configs + 12개월 schedule 자동 생성
-- (별도 함수로 분리)
```

### 시드 데이터 정책
- 신규 게이트웨이 등록 시 `fallback_configs` + 12개월 `fallback_opener_schedule` 자동 INSERT
- 기본 월별 활성 상태:
  - 4·5·6·7·8·9·10월: `enabled=true`
  - 11월: `enabled=false` (값은 09:00/17:00로 저장)
  - 1·2·3·12월: `enabled=false` (값은 NULL — UI에서 + 버튼으로 활성화 시 입력)

---

## 3. MQTT 토픽 명세

### 신규 토픽

| 방향 | 토픽 | QoS | Retained | 페이로드 |
|------|------|-----|:--------:|----------|
| Server → RPi | `farm/{gw}/server/heartbeat` | 0 | ✅ | `{ "ts": "ISO8601", "version": 1 }` (10초 주기) |
| Server → RPi | `farm/{gw}/fallback/rules/sync` | 1 | ✅ | `{ "version": N, "config": {...}, "schedule": [...] }` |
| RPi → Server | `farm/{gw}/fallback/mode` | 1 | ✅ | `{ "mode": "online\|fallback", "since": "ISO8601" }` |
| RPi → Server | `farm/{gw}/fallback/events` | 1 | ❌ | `{ "events": [...] }` (배치, 폴백 종료 시 또는 30초 주기) |
| RPi → Server | `farm/{gw}/fallback/ack` | 1 | ❌ | `{ "version": N, "appliedAt": "ISO8601" }` (룰 동기화 ACK) |
| Server → RPi | `farm/{gw}/gpio/emergency-stop` | 1 | ❌ | `{ "reason": "string", "by": "userId" }` (항상 허용) |

### 기존 토픽 동작 변경

- `farm/{gw}/gpio/relay` (Server → RPi):
  - **online 모드**: 기존대로 처리
  - **fallback 모드**: RPi의 `command-gate`가 **drop** + 로그 기록
  - 단, 별도 `bypass` 플래그가 있는 경우(`{ "bypass": true }`)는 예외 처리 (관리자 강제 명령)

### 하트비트 누락 판정
- RPi가 `server/heartbeat` 메시지 수신 시각을 `lastHeartbeatAt` 기록
- `now() - lastHeartbeatAt > heartbeat_timeout_seconds` 시 **fallback 진입**
- 하트비트 재수신 후 `recovery_grace_seconds` 안정화 → **fallback 이탈**

### Retained 메시지 설계
- `server/heartbeat`, `fallback/rules/sync`, `fallback/mode`는 **retained** → RPi/Server 재시작 시 최신 상태 즉시 복원
- `server/heartbeat` retained는 보조 안전망. 주 판정은 실시간 메시지 도착으로 함 (retained는 last-known이라 단절 판정 불가)
- **권장**: heartbeat는 retained=false + 10초 주기 / `mode`와 `rules/sync`는 retained=true

(설계 정정: heartbeat는 retained=false로 함. 위 표 갱신)

---

## 4. RPi `fallback-engine` 모듈 설계

### 디렉터리 구조
```
raspberry-pi/fallback-engine/
├── index.js                    # 엔트리포인트 (MQTT 연결, 부트스트랩)
├── package.json
├── lib/
│   ├── mqtt-client.js          # MQTT 연결 + 토픽 구독
│   ├── heartbeat-watchdog.js   # 하트비트 수신 + 타임아웃 판정
│   ├── mode-state-machine.js   # online ↔ fallback 전환
│   ├── rule-store.js           # JSON 파일 + SQLite 캐시
│   ├── rule-evaluator/
│   │   ├── opener.js           # 월별 시간 스케줄 + 빗물 override
│   │   ├── irrigation.js       # 채널별 onSince 추적 + 30분 타임아웃
│   │   ├── fertilizer.js       # 즉시 OFF
│   │   ├── fan.js              # 온도 임계값 (35°C ON / 28°C OFF)
│   │   └── index.js            # 통합 인터페이스
│   ├── command-gate.js         # gpio/relay 명령 필터링
│   ├── rain-override.js        # 빗물 센서 우선 처리
│   ├── event-queue.js          # 폴백 이벤트 SQLite 큐
│   └── relay-bridge.js         # gpio-agent에게 명령 전달 (내부 MQTT)
├── data/
│   └── fallback.db             # SQLite (이벤트 큐 + 룰 캐시)
└── config/
    └── fallback-rules.json     # 권위는 서버 DB. 로컬 사본
```

### 상태 머신

```
                ┌─────────────────────────────────────────┐
                │           STARTUP (cold boot)           │
                │  - rules.json 로드 (없으면 default)      │
                │  - SQLite 큐 복원                        │
                │  - MQTT 연결 시도                        │
                └───────────────────┬─────────────────────┘
                                    │
                          ┌─────────▼─────────┐
                          │  WAITING_FIRST_HB  │
                          │  (60초 grace)      │
                          └────┬──────────┬───┘
            HB 수신             │          │  60초 경과 (no HB)
                    ┌───────────┘          └──────────────┐
                    ▼                                      ▼
            ┌───────────────┐                      ┌──────────────┐
            │     ONLINE    │  HB > 300s missing → │   FALLBACK   │
            │               │ ◄─── grace 30s ◄───  │              │
            └───────┬───────┘                      └──────┬───────┘
                    │                                     │
            gpio/relay 통과                         gpio/relay 차단
            폴백 룰 평가 OFF                        폴백 룰 평가 ON
            mode publish "online"                  mode publish "fallback"
```

### 평가 주기
- **`rule-evaluator` 루프**: 30초마다 1회 (관수 30분 타임아웃 정밀도 충분)
- **빗물 센서 이벤트**: MQTT 메시지 수신 즉시 (이벤트 드리븐)
- **하트비트 watchdog**: 5초마다 `lastHeartbeatAt` 체크

### 시간/타임존
- RPi 시스템 시간은 `Asia/Seoul` (KST) 고정
- NTP 동기화 필수 (`systemd-timesyncd` 또는 `chrony`)
- 월별 스케줄 평가는 KST 기준 (`new Date().getMonth() + 1`)

---

## 5. 백엔드 모듈 변경

### 신규: `backend/src/modules/fallback-config/`

```
fallback-config/
├── fallback-config.module.ts
├── fallback-config.controller.ts    # REST API
├── fallback-config.service.ts       # CRUD + MQTT publish
├── entities/
│   ├── fallback-config.entity.ts
│   ├── fallback-opener-schedule.entity.ts
│   └── fallback-event.entity.ts
├── dto/
│   ├── update-config.dto.ts
│   ├── upsert-opener-schedule.dto.ts
│   └── batch-event.dto.ts
└── heartbeat.service.ts             # 10초 주기 publish
```

### REST API 명세

| Method | Path | 권한 | 설명 |
|--------|------|------|------|
| GET | `/fallback-config/:gatewayId` | farm_admin+ | 폴백 설정 + 12개월 스케줄 조회 |
| PATCH | `/fallback-config/:gatewayId` | farm_admin+ | 설정 일부 변경 (PATCH) |
| PUT | `/fallback-config/:gatewayId/opener/:month` | farm_admin+ | 특정 월 스케줄 upsert |
| DELETE | `/fallback-config/:gatewayId/opener/:month` | farm_admin+ | 특정 월 비활성화(소프트) |
| GET | `/fallback-config/:gatewayId/events` | farm_admin+ | 이벤트 로그 조회 (페이지네이션) |
| GET | `/fallback-config/:gatewayId/mode` | farm_user+ | 현재 모드 조회 (online/fallback) |
| POST | `/fallback-config/:gatewayId/resync` | farm_admin+ | 룰 강제 재동기화 trigger (운영 편의) |
| POST | `/fallback-config/:gatewayId/emergency-stop` | farm_admin+ | UI에서 비상 정지 발행 (모든 모드에서 즉시 OFF) |

### 동기화 흐름
1. UI에서 설정 변경 → REST API 호출
2. Service: DB 업데이트 + `version++`
3. Service: `farm/{gw}/fallback/rules/sync` publish (retained)
4. RPi `fallback-engine`: 수신 → `rules.json` 갱신 → ACK publish
5. Service: ACK 수신 시 `applied_at` 기록 → UI에 "적용됨" 표시

### 동기화 충돌 정책
- 서버 DB가 항상 권위
- RPi가 오프라인 상태에서 받지 못한 변경은 재연결 시 retained 메시지로 자동 복원
- `version` 필드로 idempotent 보장 (이미 적용한 version은 재처리 안 함)

---

## 6. 프론트엔드 UI 설계

### 페이지: `frontend/src/views/EmergencyFailover.vue`

라우터 추가: `/emergency-failover` (메뉴 그룹: "시스템 설정" — admin/farm_admin만)

### 화면 구조

```
┌─────────────────────────────────────────────────────────────┐
│  이머전시 페일오버 설정                  [게이트웨이: lgw-01 ▾] │
│                                                              │
│  ┌─────────── 현재 상태 ────────────────────────────────────┐ │
│  │  모드: 🟢 ONLINE          마지막 하트비트: 5초 전          │ │
│  │  버전: v3 (적용됨 2026-05-20 10:42)                       │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌─────────── 1. 하트비트 설정 ─────────────────────────────┐  │
│  │  단절 판정 시간:  [ 300 ] 초  (60~3600)                     │  │
│  │  복구 grace:      [  30 ] 초  (10~120)                     │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌─────────── 2. 개폐기 (월별) ──────────────────────────────┐  │
│  │  ☑ 폴백 활성    ☑ 빗물 센서 override                       │  │
│  │                                                              │  │
│  │  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐         │  │
│  │  │ 1월 │ │ 2월 │ │ 3월 │ │ 4월 │ │ 5월 │ │ 6월 │ ...     │  │
│  │  │ ＋  │ │ ＋  │ │ ＋  │ │ ☑   │ │ ☑   │ │ ☑   │         │  │
│  │  │ 비활│ │ 비활│ │ 비활│ │09-17│ │08-18│ │24h  │         │  │
│  │  └─────┘ └─────┘ └─────┘ └─────┘ └─────┘ └─────┘         │  │
│  │  카드 클릭 → 모달:                                          │  │
│  │    ○ 시간 기반 [open: 09:00] [close: 17:00]                │  │
│  │    ○ 24시간 OPEN                                            │  │
│  │    ☐ 이 월 활성화                                            │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌─────────── 3. 관수 ────────────────────────────────────────┐  │
│  │  ☑ 폴백 활성                                                │  │
│  │  관수 시작 후 최대 작동 시간:  [ 30 ] 분 (5~120)              │  │
│  │  ⓘ 단절 발생 시 관수 ON 시각부터 N분이 지나면 자동 OFF        │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌─────────── 4. 액비 ────────────────────────────────────────┐  │
│  │  ☑ 폴백 활성                                                │  │
│  │  ⓘ 통신 단절 즉시 OFF (지연 없음)                            │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌─────────── 5. 환기팬 / 유동팬 ─────────────────────────────┐  │
│  │  ☐ 폴백 활성  ← 기본 비활성                                 │  │
│  │  ON 임계값: [ 35.0 ] °C                                     │  │
│  │  OFF 임계값: [ 28.0 ] °C                                    │  │
│  │  ⚠ ON이 OFF보다 커야 함                                      │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│              [취소]      [저장 (게이트웨이에 동기화)]              │
└──────────────────────────────────────────────────────────────────┘
```

### 컴포넌트 분리

```
components/emergency-failover/
├── FailoverStatusCard.vue         # 현재 모드 표시
├── HeartbeatSettingsCard.vue
├── OpenerMonthlyScheduleCard.vue  # 12개월 카드 그리드
├── OpenerMonthDialog.vue          # 월별 편집 모달
├── IrrigationFailoverCard.vue
├── FertilizerFailoverCard.vue
└── FanFailoverCard.vue
```

### 상태 관리
- Composable: `composables/useEmergencyFailover.ts`
- API: `api/emergency-failover.api.ts`
- Type: `types/emergency-failover.types.ts`
- WebSocket: 모드 변화 실시간 반영 (`fallback:mode-changed` 이벤트)

---

## 7. 안전 정책 상세

### 7.1 명령 게이트 (Command Gate)

```javascript
// raspberry-pi/fallback-engine/lib/command-gate.js (의사 코드)
function shouldExecute(topic, payload, currentMode) {
  if (topic === `farm/${GW}/gpio/emergency-stop`) return true;  // 항상 허용
  if (currentMode === 'online') return true;                     // 정상 통과
  if (payload.bypass === true) {                                 // 관리자 우회
    log({ type: 'safety_off', reason: 'admin-bypass', payload });
    return true;
  }
  // fallback 모드: 서버 명령 차단
  log({ type: 'safety_off', reason: 'fallback-mode-drop', payload });
  return false;
}
```

### 7.2 빗물 센서 통합

- 기존 `rain-override` 모듈(있음)과 통합
- 빗물 센서 ACTIVE → `opener.forceCloseAll()` 호출 (모드 무관)
- 빗물 종료 → 폴백 모드면 월별 스케줄 재평가 후 OPEN/CLOSE 결정
- online 모드면 서버 룰에 위임

### 7.3 폴백 진입 시 즉시 액션

1. **액비**: 즉시 OFF (`fertilizer.forceOff()`)
2. **관수**: 각 채널의 `onSince` 확인 → `now - onSince > 30min`이면 즉시 OFF, 아니면 `onSince + 30min`에 타이머 등록
3. **개폐기**: 현재 월 스케줄 평가 → 필요 시 상태 변경 (단, 인터록 1초 OFF→ON 규칙 준수)
4. **환기팬**: `enabled=true`면 온도 평가 시작

### 7.4 폴백 이탈 시 액션

1. **mode** publish "online"
2. SQLite 이벤트 큐 → 서버 일괄 전송
3. 폴백 룰 평가 루프 중지
4. 서버 명령 통과 재개 (단, 마지막 명령에 대한 idempotent 처리는 서버 책임)

### 7.5 인터록 (개폐기 열림/닫힘 동시 ON 금지)

- 기존 `feedback_opener_interlock.md` 메모리 룰 준수
- 닫힘 OFF → 1초 대기 → 열림 ON (반대 동일)
- `opener.js` 평가기 내부에 `await sleep(1000)` 보장

### 7.6 SD 카드 보호

- SQLite WAL 모드 + checkpoint 주기 조정
- 이벤트는 메모리 버퍼링(최대 10개 or 30초) 후 1회 flush
- 정상 종료 시 `db.close()` 보장 (systemd `ExecStop`)

---

## 8. systemd 서비스

`raspberry-pi/systemd/fallback-engine.service` (신규)

```ini
[Unit]
Description=Smart Farm Fallback Engine
After=network-online.target mosquitto.service
Requires=network-online.target

[Service]
Type=simple
User=pi
WorkingDirectory=/opt/smart-farm/fallback-engine
ExecStart=/usr/bin/node /opt/smart-farm/fallback-engine/index.js
Restart=always
RestartSec=10
EnvironmentFile=/etc/smartfarm/env
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

설치 스크립트(`setup.sh`) 갱신: `fallback-engine.service` 등록 추가.

---

## 9. E2E 테스트 시나리오

| # | 시나리오 | 기대 결과 |
|---|----------|-----------|
| 1 | 서버 docker compose down → 5분 대기 | RPi mode = "fallback", 폴백 룰 동작 시작 |
| 2 | 폴백 중 관수 채널 ON 후 30분 경과 | 해당 채널 자동 OFF, 이벤트 큐에 기록 |
| 3 | 폴백 중 빗물 센서 ACTIVE 트리거 | 모든 개폐기 즉시 CLOSE |
| 4 | 폴백 중 빗물 OFF + 13시 (4월) | 17시까지 OPEN 상태로 복귀 |
| 5 | 5월에서 6월로 월 경계 자정 전환 | 24h-OPEN 모드로 전환, 닫혀있던 개폐기 OPEN |
| 6 | 서버 복구 후 30초 grace | RPi mode = "online", 큐잉된 이벤트 서버 전송 |
| 7 | UI에서 환기팬 활성화 + 임계값 변경 | RPi에 동기화, 평가 즉시 적용 |
| 8 | 폴백 중 서버에서 gpio/relay 명령 발행 | RPi drop + safety_off 이벤트 기록 |
| 9 | `gpio/emergency-stop` 발행 (폴백 중) | 무조건 실행 (모든 릴레이 OFF) |
| 10 | RPi 재부팅 후 retained 메시지 수신 | rules.json 최신 버전 복원 |

테스트 도구: `docker compose stop backend` + Playwright로 UI 검증 + `mqtt-cli`로 토픽 모니터링.

---

## 10. 구현 순서 (Do 단계)

### Phase A: DB + 서버 골격 (2.5일)
1. 마이그레이션 `020_fallback_rules.sql` 작성 + 시드
2. NestJS `fallback-config` 모듈 골격 (entity/service/controller)
3. `heartbeat.service.ts` (10초 주기 publish)
4. REST API 5종 구현 + unit smoke

### Phase B: RPi `fallback-engine` (4~6일)
5. 디렉터리 + package.json + index.js 부트스트랩
6. `heartbeat-watchdog` + `mode-state-machine`
7. `rule-store` (JSON + SQLite 캐시)
8. `rule-evaluator` 4종 (opener/irrigation/fertilizer/fan)
9. `command-gate` + `rain-override` 통합
10. `event-queue` (SQLite WAL) + 복구 시 일괄 전송
11. systemd 서비스 + setup.sh 통합

### Phase C: 양방향 동기화 (2.5일)
12. 서버 → RPi rules sync publish (version 관리)
13. RPi → 서버 ACK + events 배치 전송
14. WebSocket 모드 변경 이벤트 (백엔드 → 프론트엔드)

### Phase D: UI (3.5일)
15. `EmergencyFailover.vue` + 라우터
16. `OpenerMonthlyScheduleCard` + `OpenerMonthDialog`
17. 관수/액비/환기팬 카드
18. `useEmergencyFailover` composable + API 연동
19. 상태 카드 (현재 모드 실시간 표시)

### Phase E: E2E + 통합 (1.5일)
20. E2E 시나리오 10종 실행
21. 문서 정리 + 운영 매뉴얼

**총 14~17일** (Plan 추정과 일치)

---

## 11. 위험 및 완화

| 위험 | 영향 | 완화책 |
|------|------|--------|
| RPi 시간 동기화 실패 → 월 경계 오작동 | 高 | `chrony` 설치 + `setup.sh`에 강제 sync |
| 폴백/online 모드 전환 중 race condition | 中 | 명령 큐 + 30초 grace + idempotent 처리 |
| SD 카드 쓰기 마모 | 中 | 이벤트 버퍼링 + WAL + 정상 종료 보장 |
| 룰 동기화 충돌 | 中 | `version` 단조증가 + 서버 권위 |
| 환기팬 임계값 진동 (35↔28 사이 sensor noise) | 低 | 7°C 히스테리시스로 충분 |
| 농장주가 모든 룰 비활성화 | 高 | UI에서 "최소 안전 룰" 경고 표시 |
| 폴백 진입 후 즉시 액비 OFF가 작물에 부작용 | 中 | 운영 매뉴얼에 명시, UI에 안내문 |

---

## 12. 운영 매뉴얼 (요약)

설계 단계에서 명시. Do 단계에서 별도 문서 작성:
- 폴백 모드 인지 방법 (UI 배지 + 게이트웨이 페이지 알림)
- 폴백 발생 시 농장주 조치 가이드
- 룰 변경 영향도 (재시작 불필요 — MQTT 동기화로 즉시 반영)
- 비상 정지 사용법

---

## 13. 결정 요청

설계 검토 완료 후 다음을 결정합니다:

1. **이 설계로 Do 단계 진행할까요?**
2. **시간 부족 시 우선순위 — 어느 Phase를 먼저 출시할까요?**
   - 옵션 A: 전체 14~17일 한 번에
   - 옵션 B: Phase A+B+C만 먼저 (백엔드 + RPi 엔진, UI 없이 설정 파일 직접 편집) → 약 9~11일
   - 옵션 C: Phase A+B (RPi 엔진만, default 설정 고정) → 약 6~8일, 이후 UI 추가
3. **운영 환경 추가 고려사항 있나요?** (예: 다중 게이트웨이 동기화, 알림 채널, etc.)
