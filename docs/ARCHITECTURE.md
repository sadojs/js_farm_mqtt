# Smart Farm MQTT — Architecture

> 이 문서는 **소스 코드에 직접 근거**한 시스템 아키텍처 요약이다. 모든 항목 끝에 근거 파일 경로(`파일:라인`)를 명시했다. 불확실한 부분은 ⚠️로 표시했다.
>
> 분석 기준일: 2026-05-23 / 분석 브랜치: main

---

## 1. 전체 시스템 구성도

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          외부 (인터넷)                                    │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────────────────┐      │
│  │ OpenWeather  │   │ 기상청 KMA   │   │ Anthropic Claude API     │      │
│  │   (날씨 API) │   │ (단/중기예보)│   │ (voice 모듈 — 선택)      │      │
│  └──────┬───────┘   └──────┬───────┘   └─────────────┬────────────┘      │
└─────────┼───────────────────┼─────────────────────────┼──────────────────┘
          ▼                   ▼                         ▼
┌──────────────────────────────────────────────────────────────────────────┐
│              중앙 서버 (Docker Compose, 로컬 또는 프로덕션)               │
│  ┌──────────────────┐  ┌──────────────────┐  ┌────────────────────┐      │
│  │ NestJS Backend   │  │ Mosquitto Broker │  │ Vue 3 + Nginx      │      │
│  │ (:3100, /api)    │◀▶│ (:1883 / :9001)  │  │ (:81)              │      │
│  │ - REST + WS      │  │ - 토픽 라우팅    │  │ - 정적 SPA 서빙    │      │
│  └────┬─────────────┘  └────────┬─────────┘  └────────────────────┘      │
│       │                          │                                       │
│  ┌────▼───────────┐   ┌──────────▼────────────┐                          │
│  │ PostgreSQL 15  │   │ Zigbee2MQTT (:8080)   │                          │
│  │ + TimescaleDB  │   │ — /dev/ttyUSB0 동글   │                          │
│  │ (:5433)        │   │  (선택, 로컬 개발용)  │                          │
│  └────────────────┘   └───────────────────────┘                          │
│  ┌────────────┐                                                          │
│  │ Redis 7    │ (:6380, Bull queue용)                                    │
│  └────────────┘                                                          │
└──────────────────────────────────────────────────────────────────────────┘
                                 ▲ MQTT (1883, QoS 1)
                  ┌──────────────┼───────────────┐
                  ▼              ▼               ▼
┌────────────────────────┐ ┌────────────────────────┐ ┌──────────────────┐
│ Raspberry Pi 게이트웨이 │ │ Raspberry Pi 게이트웨이 │ │ ... (N대)        │
│ "lgw-farm01"           │ │ "lgw-farm02"           │ │                  │
│                        │ │                        │ │                  │
│  systemd 서비스 5종:    │ │  (동일 구성)            │ │                  │
│  ┌──────────────────┐  │ └────────────────────────┘ └──────────────────┘
│  │ zigbee2mqtt      │  │
│  │ (로컬 Z2M)       │  │
│  ├──────────────────┤  │     ▲ Zigbee 802.15.4
│  │ gpio-agent       │──┼─────┼──┐
│  │ (BCM 핀 제어)    │  │     ▼  ▼
│  ├──────────────────┤  │  ┌─────────────────────────────┐
│  │ config-agent     │  │  │ Zigbee 장비                 │
│  │ (원격 설정 배포) │  │  │ - 온습도/CO2/조도/토양/PH/EC│
│  │ (setup.sh 인라인)│  │  │ - 우적 (TS0207)             │
│  ├──────────────────┤  │  │ - 릴레이 모듈 (8/12ch)      │
│  │ fallback-engine  │  │  │ - 환풍기 / 관수 / 개폐기    │
│  │ (단절시 로컬룰)  │  │  └─────────────────────────────┘
│  ├──────────────────┤  │     ▲ GPIO (BCM 2~27)
│  │ first-boot-init  │  │     ▼
│  │ (1회 부팅 시)    │  │  ┌─────────────────────────────┐
│  └──────────────────┘  │  │ 온보드 릴레이 (GPIO 직결)   │
│  ┌──────────────────┐  │  └─────────────────────────────┘
│  │ (선택)           │  │
│  │ reverse-ssh-tunnel│ │
│  └──────────────────┘  │
└────────────────────────┘
```

근거:
- 서비스 구성: [docker-compose.yml](../docker-compose.yml)
- NestJS port 3100: [backend/src/main.ts:32](../backend/src/main.ts#L32)
- RPi systemd 5종: [raspberry-pi/systemd/](../raspberry-pi/systemd/) (`zigbee2mqtt.service`, `gpio-agent.service`, `fallback-engine.service`, `reverse-ssh-tunnel.service`, `first-boot-init.service`) — `config-agent.service`는 별도 파일 없이 `setup.sh`가 인라인 생성
- Pi 설치 스크립트: [raspberry-pi/setup.sh](../raspberry-pi/setup.sh)

---

## 2. 기술 스택

| 계층 | 기술 | 버전/이미지 | 근거 |
|------|------|-------------|------|
| Backend | NestJS + TypeScript | NestJS 10, TS 5.3 | [backend/package.json](../backend/package.json) |
| Frontend | Vue 3 + Vite + Pinia + Vue Router | Vite 7 | [frontend/package.json](../frontend/package.json) |
| DB | PostgreSQL 15 + TimescaleDB | `timescale/timescaledb:latest-pg15` | [docker-compose.yml:10](../docker-compose.yml#L10) |
| Cache/Queue | Redis 7 + Bull | `redis:7-alpine` | [docker-compose.yml:30](../docker-compose.yml#L30) |
| MQTT Broker | Eclipse Mosquitto 2 | `eclipse-mosquitto:2` | [docker-compose.yml:45](../docker-compose.yml#L45) |
| Zigbee Stack | Zigbee2MQTT | `koenkk/zigbee2mqtt` | [docker-compose.yml:65](../docker-compose.yml#L65) |
| 인증 | JWT + bcrypt, **username 로그인 (email 아님)** | passport-jwt | [backend/database/migrations/003_email_to_username.sql](../backend/database/migrations/migration-003-email-to-username.sql) |
| 실시간 | Socket.io | `events.gateway.ts` | [backend/src/modules/gateway/events.gateway.ts](../backend/src/modules/gateway/events.gateway.ts) |
| RPi 에이전트 | Node.js + `mqtt` + `gpioset(libgpiod)` | — | [raspberry-pi/gpio-agent/index.js](../raspberry-pi/gpio-agent/index.js) |

---

## 3. Docker 컴포넌트 구성

| 컨테이너 이름 | 포트 매핑 (host:container) | 역할 |
|---------------|----------------------------|------|
| `sfm-db` | `5433:5432` | PostgreSQL + TimescaleDB |
| `sfm-redis` | `6380:6379` | 캐시/큐 |
| `sfm-mosquitto` | `1883:1883`, `9001:9001` | MQTT Broker (TCP + WebSocket) |
| `sfm-zigbee2mqtt` | `8080:8080` | Z2M 웹콘솔 (선택, 로컬 개발용 — RPi에 직접 띄우는 게 운영 패턴) |
| `sfm-backend` | `3100:3100` | NestJS API + WebSocket |
| `sfm-frontend` | `81:80` | Vue SPA (Nginx 정적 서빙) |

근거: [docker-compose.yml](../docker-compose.yml) 전체

서비스 간 통신:
- backend → postgres, redis, mosquitto: `depends_on.condition: service_healthy` 보장
- backend ↔ Zigbee2MQTT: 직접 통신 없음 — **모두 MQTT 토픽을 통해서만** 통신
- frontend → backend: `CORS_ORIGIN` 환경변수로 허용 ([docker-compose.yml:94](../docker-compose.yml#L94))

---

## 4. MQTT 토픽 구조 (실제 핸들러 코드 기준)

서버가 subscribe하는 모든 토픽: [backend/src/modules/mqtt/mqtt.service.ts:67-80](../backend/src/modules/mqtt/mqtt.service.ts#L67-L80)

| 토픽 패턴 | 방향 | 핸들러 / 발행자 | 용도 |
|-----------|------|-----------------|------|
| `farm/{gw}/z2m/{device}` | RPi → Server | `MqttSensorHandler.handleSensorData()` | 센서 측정값 |
| `farm/{gw}/z2m/{device}/availability` | RPi → Server | `MqttDeviceHandler.handleAvailability()` | 장치 온/오프라인 |
| `farm/{gw}/z2m/{device}/set` | Server → RPi | `MqttService.controlDevice()` | Zigbee 액추에이터 제어 |
| `farm/{gw}/z2m/bridge/state` | RPi → Server | `MqttBridgeHandler.handleBridgeState()` | Zigbee2MQTT 브릿지 상태 |
| `farm/{gw}/z2m/bridge/devices` | RPi → Server (retained) | `MqttBridgeHandler.handleBridgeDevices()` | 페어링된 Zigbee 장치 목록 |
| `farm/{gw}/z2m/bridge/request/permit_join` | Server → RPi | `MqttService.permitJoin()` | Zigbee 페어링 모드 ON/OFF (기본 120초) |
| `farm/{gw}/gpio/relay` | Server → RPi | `MqttService.publishGpioRelay()` | 온보드 GPIO 릴레이 제어 |
| `farm/{gw}/gpio/status` | RPi → Server | `MqttBridgeHandler.handleGpioStatus()` | 릴레이 상태 응답 |
| `farm/{gw}/gpio/emergency-stop` | Server → RPi | `MqttService.publishEmergencyStop()` | 비상정지 (폴백 모드에서도 통과) |
| `farm/{gw}/config/request` | Server → RPi | `MqttService.publishConfigRequest()` | 원격 설정 변경 요청 |
| `farm/{gw}/config/response` | RPi → Server | config-agent | 설정 변경 결과 |
| `farm/{gw}/agent/status` | RPi → Server | config-agent 하트비트 (60초 주기) | 에이전트 온라인 |
| `farm/{gw}/tunnel/status` | RPi → Server | config-agent | 리버스 SSH 터널 상태 |
| `farm/{gw}/server/heartbeat` | Server → RPi (**10초 주기**) | `HeartbeatService.tick()` | RPi가 단절 감지에 사용 |
| `farm/{gw}/fallback/mode` | RPi → Server (retained) | fallback-engine | 현재 모드 (`online`/`fallback`) |
| `farm/{gw}/fallback/events` | RPi → Server | fallback-engine | 폴백 중 발생한 이벤트 배치 |
| `farm/{gw}/fallback/ack` | RPi → Server | fallback-engine | 룰 동기화 ACK |
| `farm/{gw}/fallback/rules/sync` | Server → RPi (retained) | `MqttService.publishFallbackRulesSync()` | 폴백용 룰 + 채널매핑 |

근거: [mqtt.service.ts](../backend/src/modules/mqtt/mqtt.service.ts), [fallback-engine/index.js:42-52](../raspberry-pi/fallback-engine/index.js#L42-L52), [config-agent/index.js:25-28](../raspberry-pi/config-agent/index.js#L25-L28)

서버 하트비트 주기: **10초** — [backend/src/modules/fallback-config/heartbeat.service.ts:8](../backend/src/modules/fallback-config/heartbeat.service.ts#L8)

---

## 5. 데이터 흐름

### 5.1 센서 측정 → 표시
```
Zigbee 장비
   │ (radio)
   ▼
RPi Zigbee2MQTT
   │ publish "farm/{gw}/z2m/{deviceName}"
   ▼
Mosquitto Broker
   │
   ▼
NestJS MqttService.routeMessage()        (mqtt.service.ts:93)
   │
   ▼
MqttSensorHandler.handleSensorData()
   ├─▶ INSERT sensor_data (Hypertable)   (schema.sql:138)
   ├─▶ devices.online=true, lastSeen 갱신
   └─▶ EventsGateway.broadcast → Socket.io
                                  │
                                  ▼
                       Frontend useWebSocket → Pinia store → View
```

### 5.2 사용자 제어 → 장치 동작
```
Frontend (Groups.vue / GatewayEnvSettings.vue)
   │ deviceApi.control(id, commands)
   ▼
DevicesController.control                    (devices.controller.ts)
   │
   ▼
DevicesService.controlDevice()               (devices.service.ts:223)
   ├─ 개폐기 인터록: pairedDeviceId OFF → 1초 대기   (라인 295-322)
   ├─ 관수 원격제어 ON: fertilizer_b_contact 동시 ON (251-262)
   ├─ onboard 장치: publishGpioRelay()              (326-349)
   └─ Zigbee 장치: publish "farm/{gw}/z2m/{name}/set" (352-353)
                                  │
                                  ▼
                              RPi z2m / gpio-agent → 실제 장치
```

### 5.3 자동화 룰 평가
```
@Cron(EVERY_MINUTE)  AutomationRunnerService.runEnabledRules()
@Cron(*/10s)         AutomationRunnerService.runSubMinuteRelayRules()
@Cron(0 * * * * *)   IrrigationSchedulerService.checkIrrigationRules()
   │
   ▼ 조건 평가 (시간 / 센서값 / 우적 / 히스테리시스)
DevicesService.controlDevice(..., callerSource='automation')
   │
   ▼
MQTT publish → RPi → 장치
   │
   ▼
INSERT automation_logs                       (automation-runner.service.ts:200)
```
근거: [automation-runner.service.ts:34-60](../backend/src/modules/automation/automation-runner.service.ts#L34-L60), [irrigation-scheduler.service.ts:60](../backend/src/modules/automation/irrigation-scheduler.service.ts#L60)

### 5.4 단절 시 폴백
```
서버 hb 10초 끊김 ── timeoutSeconds(기본 300s) 경과 ──┐
                                                       ▼
RPi fallback-engine.heartbeat-watchdog → mode='fallback'
   ├─ publish "farm/{gw}/fallback/mode" (retained)
   ├─ 서버 GPIO 명령 전부 drop (command-gate)
   ├─ rules.json 로컬 룰로 EVAL_INTERVAL_MS(기본 30s)마다 평가
   ├─ 우적 ACTIVE → 개폐기 강제 CLOSE (rain-override, 모드 무관)
   └─ 이벤트 SQLite 큐 → 복구 시 일괄 publish
```
근거: [fallback-engine/index.js:117-179](../raspberry-pi/fallback-engine/index.js#L117-L179), [migration 020](../backend/database/migrations/020_fallback_rules.sql)

---

## 6. DB 스키마 — 핵심 테이블 요약

전체 22개 테이블. 베이스 스키마: [backend/database/schema.sql](../backend/database/schema.sql), 누적 마이그레이션: [backend/database/migrations/](../backend/database/migrations/) (005~020)

### 6.1 인증 / 사용자
| 테이블 | 핵심 필드 | 근거 |
|--------|-----------|------|
| `users` | id(UUID), username(UNIQUE), password_hash, name, role(`admin`/`farm_admin`/`farm_user`), parent_user_id | schema.sql:12 |

`farm_user`는 `parent_user_id`로 `farm_admin`에 종속 — 자식 사용자는 부모의 농장 데이터를 공유 ([automation.controller.ts:21-23](../backend/src/modules/automation/automation.controller.ts#L21-L23) `getEffectiveUserId`).

### 6.2 농장 구조
| 테이블 | 핵심 필드 | 비고 |
|--------|-----------|------|
| `gateways` | gateway_id(VARCHAR, MQTT prefix), name, rpi_ip, **hostname**, **wifi_ssid**, **server_ip**, **machine_id**, **tunnel_port**, **tunnel_public_key**, **bootstrap_token_used_at**, status, agent_status, tunnel_status | schema.sql:33 + [migration 018](../backend/database/migrations/018_rpi_remote_config.sql) + [019](../backend/database/migrations/019_bootstrap_token_tracking.sql) |
| `house_groups` | 사용자별 구역(농장 그룹) | schema.sql:53 |
| `houses` | 하우스동(개별 하우스). `group_id` FK | schema.sql:71 |
| `devices` | zigbee_ieee, friendly_name, equipment_type(`fan`/`irrigation`/`opener_open`/`opener_close`/`other`), paired_device_id(개폐기 쌍), channel_mapping(JSONB, 관수 8/12CH) | schema.sql:91 |
| `group_devices` | 그룹↔장비 다대다 | schema.sql:125 |
| `gateway_onboard_devices` | RPi 직결 GPIO 장치(릴레이/팬). `gpio_pin INT` (BCM 2~27) | [migration 014](../backend/database/migrations/014_onboard_device_timers.sql) + [015](../backend/database/migrations/015_gpio_pin.sql) |

### 6.3 시계열 (TimescaleDB Hypertable)
| 테이블 | hypertable 키 | 보존 정책 | 연속 집계 |
|--------|---------------|-----------|-----------|
| `sensor_data` | `time` | **6개월** (`add_retention_policy`) | `sensor_data_hourly`, `sensor_data_daily` materialized view |
| `weather_data` | `time` | — | — |

근거: [schema.sql:138-228](../backend/database/schema.sql#L138-L228), [migration 005](../backend/database/migrations/005_retention_policies.sql)

### 6.4 자동화
| 테이블 | 핵심 필드 |
|--------|-----------|
| `automation_rules` | rule_type(`weather`/`time`/`hybrid`), conditions(JSONB), actions(JSONB), priority, enabled |
| `automation_logs` | rule_id, success, conditions_met(JSONB), actions_executed(JSONB) |

### 6.5 알림 / 작업
| 테이블 | 비고 |
|--------|------|
| `notifications` | type=`alert`/`warning`/`info` |
| `sensor_alerts` | alert_type=`no_data`/`flatline`/`spike`/`out_of_range`, severity, snoozed_until |
| `crop_batches` | 작물 배치 — current_stage, transplant_date 등 (생육관리) |
| `task_templates` / `batch_tasks` / `task_occurrences` | 작업 캘린더 — 생육피드백 + 허용윈도우 |

### 6.6 환경설정 매핑
| 테이블 | 비고 |
|--------|------|
| `env_roles` | 시드값: internal_temp / internal_humidity / external_temp / external_humidity / co2 / uv / rainfall / **rain_detection** ([migration 017](../backend/database/migrations/017_rain_detection_env_role.sql)) |
| `env_mappings` | 그룹별로 role_key → (sensor_device + sensor_type) 또는 (weather_field) 매핑 |

### 6.7 폴백 ([migration 020](../backend/database/migrations/020_fallback_rules.sql))
| 테이블 | 비고 |
|--------|------|
| `fallback_configs` | 게이트웨이당 1:1 — heartbeat_timeout(60~3600s), opener/irrigation/fertilizer/fan enabled, fan_on_temp/fan_off_temp |
| `fallback_opener_schedule` | 월별 12행 — `time` 모드(open_time/close_time) 또는 `always-open` |
| `fallback_gateway_status` | 모드 캐시 (`online`/`fallback`/`unknown`) |
| `fallback_events` | 폴백 중 발생한 이벤트 (모드전환/관수ON·OFF/개폐기 등) |

⚠️ `automation_rules.priority`는 `schema.sql`에선 0~n 자유값(INTEGER DEFAULT 0)이지만 DTO에선 `@Max(10)` 으로 제한 — [create-rule.dto.ts:26](../backend/src/modules/automation/dto/create-rule.dto.ts#L26).

**`tuya_projects` 레거시 처리**: `schema.sql:318`에 트리거 참조가 있지만 같은 파일에 `CREATE TABLE`이 없음. 실제로는 [seed-local.sql:39](../backend/database/seed-local.sql#L39)에 `CREATE TABLE tuya_projects`가 있고, [migration-001-mqtt.sql:66](../backend/database/migration-001-mqtt.sql#L66)에서 `DROP TABLE IF EXISTS tuya_projects`로 제거됨. Tuya 통합 잔재이며 **운영 스키마에는 존재하지 않음**. ⚠️ `schema.sql`을 단독 실행하면 `update_tuya_projects_updated_at` 트리거 정의에서 오류 발생 가능 → 반드시 `migration-001`을 함께 적용해야 함.

---

## 7. RPi 게이트웨이 내부 구조

systemd 유닛: [raspberry-pi/systemd/](../raspberry-pi/systemd/)

| 서비스 | 핵심 책임 | 근거 |
|--------|-----------|------|
| `zigbee2mqtt.service` | Zigbee 코디네이터 ↔ MQTT 브릿지 | zigbee2mqtt.service |
| `gpio-agent.service` | `farm/{gw}/gpio/relay` 수신 → `gpioset` 호출. ACTIVE_LOW / OPEN_DRAIN / GPIO_CHIP 설정 지원 | [gpio-agent/index.js](../raspberry-pi/gpio-agent/index.js) |
| `config-agent.service` | `farm/{gw}/config/request` 수신 → wifi/hostname/gateway-id/server-ip/identity 핸들러 실행. 60초 하트비트 | [config-agent/index.js](../raspberry-pi/config-agent/index.js). systemd 유닛은 별도 파일 없이 [setup.sh:306](../raspberry-pi/setup.sh#L306)에서 인라인 `cat > /etc/systemd/system/config-agent.service` 로 생성 |
| `fallback-engine.service` | 단절 감지 → 로컬 룰 평가 → 명령 게이팅 | [fallback-engine/index.js](../raspberry-pi/fallback-engine/index.js) |
| `reverse-ssh-tunnel.service` | RPi → 서버 reverse SSH (서버에서 Pi 원격 접속) | reverse-ssh-tunnel.service |
| `first-boot-init.service` | 골든이미지 부팅 시 1회 — gateway_id 적용 등 | [first-boot-init.service](../raspberry-pi/systemd/first-boot-init.service) |

핵심 환경변수 (`gpio-agent`): `GATEWAY_ID`, `MQTT_SERVER`, `MQTT_USERNAME`, `MQTT_PASSWORD`, `GPIO_ACTIVE_LOW`, `GPIO_CHIP`(RPi5=`gpiochip4`/RPi3·4=`gpiochip0`), `GPIO_OPEN_DRAIN`, `GPIO_INIT_PINS`.

---

## 8. 환경 설정 / 시크릿

| 변수 | 용도 | 근거 |
|------|------|------|
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | DB | docker-compose.yml:14 |
| `MQTT_USERNAME` / `MQTT_PASSWORD` | Mosquitto 인증 | docker-compose.yml:88 |
| `JWT_SECRET` | JWT 서명 (필수) | docker-compose.yml:91 |
| `BOOTSTRAP_TOKEN` | RPi 1회 등록 토큰 | docker-compose.yml:92 |
| `CORS_ORIGIN` | 프론트엔드 도메인 | docker-compose.yml:94 |
| `OPENWEATHER_API_KEY` / `KMA_API_KEY` | 외부 날씨 API | docker-compose.yml:97 |
| `ANTHROPIC_API_KEY` | voice 모듈 (선택) | docker-compose.yml:98 |

---

## 9. 운영 메모

- **HTTPS**: docker-compose에는 TLS 종단이 없음 — 운영 환경에서는 별도 reverse proxy 필요 (⚠️ 인증서 처리 위치 확인 필요)
- **백엔드 글로벌 prefix**: `/api` ([main.ts:15](../backend/src/main.ts#L15))
- **서버 → RPi 원격 SSH**: `tunnel_port`(22201~22299 자동 채번)로 reverse SSH 터널 ([gateway-manager.service.ts:233-254](../backend/src/modules/gateway-manager/gateway-manager.service.ts#L233-L254))

### 9.1 DB 마이그레이션 적용 순서 (필수)

자동 마이그레이션 도구 없음 — **수동 적용**. 신규 환경 구축 시 반드시 아래 순서:

```bash
# 1) 베이스 스키마 (단, tuya_projects 트리거 오류를 피하려면 곧바로 migration-001을 실행)
psql -f backend/database/schema.sql

# 2) MQTT 전환 마이그레이션 — schema.sql의 Tuya 잔재 정리
psql -f backend/database/migration-001-mqtt.sql
psql -f backend/database/migration-002-channel-mapping.sql
psql -f backend/database/migration-003-email-to-username.sql
psql -f backend/database/migration-004-activity-logs.sql
psql -f backend/database/migration-005-retention-policies.sql

# 3) 누적 마이그레이션 (번호순)
for f in backend/database/migrations/0*.sql; do psql -f "$f"; done
```

대안: **로컬 개발 환경**은 `backend/database/seed-local.sql`(샘플 데이터 + 기존 Tuya 호환 테이블 포함)로 한 번에 부트스트랩 가능.
