---
template: design
version: 1.2
feature: rpi-golden-image-system
date: 2026-05-19
author: ohgane
project: smart-farm-mqtt
status: Draft
---

# rpi-golden-image-system Design Document

> **Summary**: 라즈베리파이용 **재사용 가능한 골든 이미지** 와 **원격 설정 배포(Wi-Fi / hostname / gateway-id / server-ip)** 시스템의 상세 설계. 마스터 Pi(`lgw-HK`)에서 ddrescue로 추출한 `.img`를 SD에 dd 복제 → 본부 KT_GiGA_5G_5E04 자동 연결 → reverse SSH tunnel → 웹UI "설정 배포" 페이지에서 4종 설정 원격 변경. Wi-Fi 변경 자동 롤백 없음(본부→농장 SSID 전환 시 인터넷 끊김이 정상이므로). 비상 복구는 eth0 static `192.168.0.100` 유선 직결.
>
> **Project**: smart-farm-mqtt
> **Author**: ohgane
> **Date**: 2026-05-19
> **Status**: Draft
> **Planning Doc**: [rpi-golden-image-system.plan.md](../../01-plan/features/rpi-golden-image-system.plan.md)
> **Related Existing Design**: [config-deploy.design.md](./config-deploy.design.md) (확장 대상)

---

## 1. Overview

### 1.1 Design Goals

1. **양산 가능한 Pi 부트스트랩** — 매번 `setup.sh` 돌리지 않고 SD 카드 dd 복제로 2분 안에 1대 완성
2. **현장 무방문 원격 설정** — 본부에서 hostname / Wi-Fi / gateway-id / **server-ip** 4종을 웹UI로 배포
3. **개발→프로덕션 서버 IP 전환** — 같은 골든 이미지로 172.30.1.42(개발) → 175.206.245.234(프로덕션) 무중단 전환
4. **무선 단절 시 복구 경로 보장** — eth0 static `192.168.0.100` 유선 LAN 직결로 항상 SSH 접근
5. **기존 `config-deploy` 모듈 확장** — Z2M YAML 배포 외에 시스템 설정(NM connection / hostnamectl / env file) 배포 영역 추가

### 1.2 Design Principles

- **단일 배포 채널 (MQTT)** — `farm/{gw}/config/request` + `farm/{gw}/config/response` 토픽 1쌍에 action 다중화. tunnel과 독립적이므로 Wi-Fi 변경 후 tunnel이 끊겨도 결과 응답 가능
- **롤백 가드 분리** — Z2M 설정 변경(자동 롤백 유지) ≠ 시스템 설정 변경(롤백 없음, 결과 보고만)
- **Pi 측 변경은 외부 스크립트로 격리** — `apply-wifi.sh`, `apply-server-ip.sh`, `apply-hostname.sh`를 별도 파일로 분리해서 단위 테스트 / 수동 호출 모두 가능
- **첫 부팅 Uniqueness 자동화** — `first-boot-init.service`(oneshot) 가 SSH host key + tunnel SSH key 재생성. 마스터 이미지에는 동일 키 → 첫 부팅에서만 새로 생성
- **CLAUDE.md 컨벤션 준수** — 백엔드 `{name}.module/service/controller`, 프론트 `views/ConfigDeploy.vue` 카드 확장, 활동 로그 기록 패턴 유지

---

## 2. Architecture

### 2.1 Component Diagram

```
┌─────────── 본부 / 사무실 (macOS 운영자 노트북) ───────────┐
│                                                            │
│  ┌─────────────────┐    ddrescue    ┌──────────────────┐  │
│  │ Master Pi       │ ──────────────▶│ golden-lgw.img.xz│  │
│  │ (lgw-HK, Bookworm│                └──────────────────┘  │
│  │  + Z2M + agents)│                          │            │
│  └─────────────────┘                          │ dd         │
│                                               ▼            │
│  ┌──────────────────────────────────────────────────────┐ │
│  │ build-golden-image.sh / clone-sd.sh (스크립트)        │ │
│  └──────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────┘
           │ SD 카드 N장 (전부 hostname=lgw-default)
           ▼
┌─────────── 본부 부팅 (1회) — 본부 Wi-Fi 자동 ───────────┐
│                                                          │
│  Pi (lgw-default)                                        │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ first-boot-init.service (oneshot)                   │ │
│  │   ─ /etc/ssh/ssh_host_*_key 재생성                  │ │
│  │   ─ /root/.ssh/tunnel_key 새 keypair 생성           │ │
│  │   ─ POST /api/gateway-manager/register-tunnel-key   │ │
│  │     (서버 authorized_keys에 자동 등록)              │ │
│  └─────────────────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ NetworkManager profiles (이미지에 사전 등록)         │ │
│  │   wifi-hq      : SSID=KT_GiGA_5G_5E04 / PSK=…       │ │
│  │   eth0-static  : 192.168.0.100/24, gw 192.168.0.1   │ │
│  └─────────────────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ reverse-ssh-tunnel.service (active)                 │ │
│  │   autossh → 175.206.245.234:22                      │ │
│  └─────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
           │ MQTT + reverse SSH 연결 완료
           ▼
┌─────────── 서버 (NestJS Backend + Mosquitto) ───────────┐
│                                                          │
│  ConfigDeploy Module (확장)                              │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ POST /api/config-deploy/:gw/wifi                    │ │
│  │ POST /api/config-deploy/:gw/hostname                │ │
│  │ POST /api/config-deploy/:gw/gateway-id              │ │
│  │ POST /api/config-deploy/:gw/server-ip               │ │
│  │      ▼ publish farm/{gw}/config/request             │ │
│  └─────────────────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ subscribe farm/{gw}/config/response                 │ │
│  │   → WebSocket emit('config:response', …)            │ │
│  │   → activity_logs INSERT                            │ │
│  │   → gateways table UPDATE (hostname/gateway_id/…)   │ │
│  └─────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
           │ MQTT
           ▼
┌─────────── Pi config-agent (index.js, 확장) ────────────┐
│                                                          │
│  handleRequest(action):                                  │
│    ├─ get_config       (기존)                            │
│    ├─ update_config    (기존 — Z2M YAML)                │
│    ├─ wifi_update      (신규 → apply-wifi.sh)           │
│    ├─ hostname_update  (신규 → apply-hostname.sh)       │
│    ├─ gateway_id_update(신규 → apply-gateway-id.sh)     │
│    └─ server_ip_update (신규 → apply-server-ip.sh)      │
│                                                          │
│  각 스크립트: exec → 결과 캡쳐 → MQTT response publish   │
└──────────────────────────────────────────────────────────┘
           │
           ▼
┌─────────── Frontend (Vue 3 — ConfigDeploy.vue 확장) ────┐
│                                                          │
│  게이트웨이 카드 (게이트웨이별 1장):                       │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ [기존] Z2M YAML 편집 + Diff + 배포                  │ │
│  │ [신규] 시스템 설정 섹션 (펼치기)                    │ │
│  │   ─ hostname:   [lgw-default] → [lgw-farm01] [적용] │ │
│  │   ─ Wi-Fi SSID: [____] PW: [____] [적용]            │ │
│  │   ─ gateway-id: [lgw-default] → [lgw-farm01] [적용] │ │
│  │   ─ server-ip:  [172.30.1.42] → [175.206.…] [적용]  │ │
│  │   ─ 상태 배지: 대기 / 적용중 / applied_online /     │ │
│  │     applied_no_internet / failed                    │ │
│  │   ─ 안내 배너: "본사→농장 Wi-Fi 변경 시 인터넷       │ │
│  │     끊김 정상. 비상시 LAN 직결 192.168.0.100"        │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                          │
│  useWebSocket: socket.on('config:response', …)           │
└──────────────────────────────────────────────────────────┘
```

### 2.2 Data Flow

#### 2.2.1 골든 이미지 빌드 (1회)

```
Operator (macOS)
   │  bash raspberry-pi/build-golden-image.sh
   ▼
1. 마스터 Pi (lgw-HK) 안전 종료 안내 (sudo shutdown -h now)
2. SD 카드 USB 어댑터로 macOS에 연결
3. diskutil list → 운영자가 디스크 선택 (확인 3회)
4. diskutil unmountDisk /dev/diskN
5. sudo dd if=/dev/rdiskN of=golden-lgw-raw.img bs=4m status=progress
6. zerofree 처리는 생략 (사전에 마스터 Pi에서 `fstrim -av` + `apt clean`)
7. xz -T0 -9 golden-lgw-raw.img → golden-lgw-vX.img.xz (~ 3GB)
8. SHA256 + 메타데이터 (.json) 산출
```

#### 2.2.2 SD 카드 복제 (N대)

```
Operator
   │  bash raspberry-pi/clone-sd.sh golden-lgw-vX.img.xz /dev/diskN
   ▼
1. 디스크 안전 확인 (external + USB + 32GB 이하만 허용 — 시스템 디스크 보호)
2. diskutil unmountDisk
3. xzcat … | sudo dd of=/dev/rdiskN bs=4m status=progress
4. sync; diskutil eject
```

#### 2.2.3 첫 부팅 Uniqueness (Pi가 자동 실행)

```
systemd boot
   │  first-boot-init.service (After=network-online.target, Before=reverse-ssh-tunnel.service)
   ▼
1. /var/lib/smartfarm/.first-boot-done 존재하면 종료
2. rm /etc/ssh/ssh_host_*_key* → dpkg-reconfigure openssh-server (host key 재생성)
3. ssh-keygen -t ed25519 -f /root/.ssh/tunnel_key -N "" (새 tunnel key)
4. POST http://${SERVER_IP}:3100/api/gateway-manager/register-tunnel-key
     body: { gatewayId: "lgw-default", publicKey: "<pub>", machineId: "<dbus-id>" }
   응답: 200 OK (서버가 authorized_keys에 자동 추가)
5. touch /var/lib/smartfarm/.first-boot-done
6. systemctl restart reverse-ssh-tunnel.service
```

> **Note**: 골든 이미지의 hostname은 `lgw-default`이지만 machineId(`/etc/machine-id`)는 첫 부팅 시 systemd가 자동 재생성하므로 Pi마다 unique. 서버는 이 machineId로 1대씩 구분.

#### 2.2.4 원격 설정 배포 — 4종 action 공통 흐름

```
Frontend (ConfigDeploy.vue)
   │  POST /api/config-deploy/:gw/{wifi|hostname|gateway-id|server-ip}
   ▼
Backend (ConfigDeployService)
   1. 입력 검증 (DTO + class-validator)
   2. requestId = uuid()
   3. mqttService.publish(`farm/${gw}/config/request`, { requestId, action, …payload }, { qos: 1 })
   4. requestId → in-memory pending map (timeout 90s)
   5. activity_logs INSERT (status='requested')
   ▼
MQTT Broker → Pi config-agent
   ▼
config-agent.handleRequest()
   ├─ action='wifi_update'       → bash apply-wifi.sh "$ssid" "$psk"
   ├─ action='hostname_update'   → bash apply-hostname.sh "$new"
   ├─ action='gateway_id_update' → bash apply-gateway-id.sh "$new"
   └─ action='server_ip_update'  → bash apply-server-ip.sh "$new"
   ▼
   스크립트 stdout(JSON) 캡쳐 → MQTT publish farm/${gw}/config/response
   ▼
Backend (mqttService.subscribe)
   1. pending map에서 requestId 매칭
   2. activity_logs UPDATE (status='applied_online' | 'applied_no_internet' | 'failed')
   3. gateways table UPDATE (hostname/server_ip/gateway_id 변경 시 DB 반영)
   4. socket.emit(`config:response:${gw}`, response) (방 기반)
   ▼
Frontend
   useWebSocket → 카드 상태 배지 업데이트 + Toast
```

### 2.3 Dependencies

| Component | Depends On | Purpose |
|-----------|-----------|---------|
| `build-golden-image.sh` | macOS + diskutil + xz | 마스터 Pi SD → .img.xz |
| `clone-sd.sh` | macOS + diskutil + xzcat | .img.xz → SD 카드 |
| `first-boot-init.service` | systemd + curl + openssh-server | host key + tunnel key 재생성 |
| `apply-wifi.sh` | NetworkManager (nmcli) | Wi-Fi connection 추가/활성 |
| `apply-hostname.sh` | hostnamectl + /etc/hosts | hostname 변경 |
| `apply-server-ip.sh` | sed + systemctl | Z2M YAML / config-agent.env / gpio-agent.env / tunnel service 동시 갱신 |
| Backend ConfigDeploy | MqttService (publish/subscribe) + ActivityLog + GatewayManager | 명령 발행 + 결과 수신 |
| Frontend ConfigDeploy.vue | useWebSocket + config-deploy.api.ts | 실시간 결과 반영 |

---

## 3. Data Model

### 3.1 MQTT Request/Response 페이로드 (확장)

기존 `ConfigRequest.action` enum을 확장:

```typescript
// backend/src/modules/config-deploy/config-deploy.types.ts (확장)

export type ConfigAction =
  | 'get_config'         // 기존
  | 'update_config'      // 기존 (Z2M YAML)
  | 'wifi_update'        // 신규
  | 'hostname_update'    // 신규
  | 'gateway_id_update'  // 신규
  | 'server_ip_update';  // 신규

export interface ConfigRequest {
  requestId: string;
  action: ConfigAction;
  timestamp: string;
  // action-specific payload
  config?: CommonConfig;                 // update_config
  wifi?: { ssid: string; password: string };  // wifi_update
  hostname?: string;                     // hostname_update
  gatewayId?: string;                    // gateway_id_update
  serverIp?: string;                     // server_ip_update
}

export type ConfigResponseStatus =
  | 'success'              // get_config / update_config / hostname / gateway-id
  | 'applied_online'       // wifi: 새 SSID + 인터넷 OK
  | 'applied_no_internet'  // wifi: 새 SSID 활성됐으나 ping 실패 (본사→농장 발송 정상 케이스)
  | 'rolled_back'          // update_config: Z2M YAML 자동 롤백 (기존 유지)
  | 'failed';

export interface ConfigResponse {
  requestId: string;
  action: ConfigAction;
  success: boolean;
  status: ConfigResponseStatus;
  timestamp: string;
  agentVersion: string;
  detail?: string;
  // action-specific result
  currentConfig?: Record<string, any>;   // get/update_config
  changedFields?: string[];              // update_config
  serviceRestarted?: boolean;            // update_config / server_ip
  appliedAt?: string;                    // wifi/hostname/server-ip
  pingResult?: { tried: number; ok: number };  // wifi
  rebootScheduled?: boolean;             // hostname (필요시)
}
```

### 3.2 Database Schema 변경

#### 3.2.1 `gateways` 테이블 — 컬럼 추가

```sql
-- backend/database/migrations/013_rpi_remote_config.sql

ALTER TABLE gateways
  ADD COLUMN IF NOT EXISTS hostname VARCHAR(63),
  ADD COLUMN IF NOT EXISTS wifi_ssid VARCHAR(100),
  ADD COLUMN IF NOT EXISTS server_ip VARCHAR(255),
  ADD COLUMN IF NOT EXISTS tunnel_public_key TEXT,
  ADD COLUMN IF NOT EXISTS machine_id VARCHAR(64),
  ADD COLUMN IF NOT EXISTS last_config_applied_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_gateways_machine_id ON gateways(machine_id);
```

#### 3.2.2 활동 로그 액션 코드 (코드 enum만 추가, 테이블 변경 없음)

```typescript
// 새 액션 코드:
// gateway.config.wifi.requested        / .applied_online / .applied_no_internet / .failed
// gateway.config.hostname.requested    / .applied / .failed
// gateway.config.gatewayid.requested   / .applied / .failed
// gateway.config.serverip.requested    / .applied / .failed
// gateway.tunnel-key.registered        (first-boot-init.service 호출 시)
```

### 3.3 Pi 측 파일 시스템 레이아웃

```
/etc/smartfarm/
├── gateway-id              # plain text: "lgw-default" (mutable)
├── server-ip               # plain text: "172.30.1.42" (mutable)
├── config-agent.env        # mode 600: MQTT_SERVER 등
└── gpio-agent.env          # mode 600: MQTT_SERVER 등

/opt/smart-farm/
├── config-agent/
│   ├── index.js
│   ├── config-manager.js
│   ├── protected-fields.js
│   └── handlers/           # NEW
│       ├── wifi.js
│       ├── hostname.js
│       ├── gateway-id.js
│       └── server-ip.js
├── gpio-agent/
└── scripts/                # NEW (Pi 측 bash 스크립트 격리)
    ├── apply-wifi.sh
    ├── apply-hostname.sh
    ├── apply-gateway-id.sh
    └── apply-server-ip.sh

/var/lib/smartfarm/
└── .first-boot-done        # 빈 파일 (uniqueness 마커)

/var/log/
└── smart-farm/
    ├── apply-wifi.log
    ├── apply-hostname.log
    └── apply-server-ip.log
```

---

## 4. API Specification

### 4.1 Endpoint List (확장 4종)

| Method | Path | Description | Auth | Role |
|--------|------|-------------|------|------|
| POST | `/api/config-deploy/:gw/wifi` | Wi-Fi SSID/PW 원격 변경 | JWT | admin / farm_admin |
| POST | `/api/config-deploy/:gw/hostname` | hostname 변경 | JWT | admin / farm_admin |
| POST | `/api/config-deploy/:gw/gateway-id` | gateway-id 변경 (DB + Pi 동시) | JWT | admin |
| POST | `/api/config-deploy/:gw/server-ip` | MQTT/터널 서버 IP 동시 변경 | JWT | admin |
| POST | `/api/gateway-manager/register-tunnel-key` | first-boot-init 호출용 (Pi→서버 자동 키 등록) | API key | (Pi internal) |

### 4.2 상세 명세

#### `POST /api/config-deploy/:gatewayId/wifi`

**Request:**
```json
{ "ssid": "FarmA_5G", "password": "******" }
```

**Response (202 Accepted):**
```json
{
  "requestId": "uuid",
  "action": "wifi_update",
  "status": "pending",
  "publishedAt": "2026-05-19T01:23:45Z"
}
```

**WebSocket follow-up** (`config:response:${gatewayId}`):
```json
{
  "requestId": "uuid",
  "action": "wifi_update",
  "status": "applied_online" | "applied_no_internet" | "failed",
  "detail": "ping 8.8.8.8 OK 3/3",
  "appliedAt": "2026-05-19T01:24:30Z",
  "pingResult": { "tried": 3, "ok": 3 }
}
```

#### `POST /api/config-deploy/:gatewayId/hostname`

**Request:**
```json
{ "hostname": "lgw-farm01" }
```

**검증 규칙** (DTO):
- `/^[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/` (RFC 1123)
- 길이 1~63
- DB `gateways` 테이블에서 unique 검증

**Response:** 202 + WS `status: 'success'`

#### `POST /api/config-deploy/:gatewayId/gateway-id`

**Request:**
```json
{ "newGatewayId": "lgw-farm01" }
```

**Pi 영향**:
- `/etc/smartfarm/gateway-id` 갱신
- `/opt/zigbee2mqtt/data/configuration.yaml`의 `mqtt.base_topic` 치환
- 서비스 재시작: zigbee2mqtt, config-agent, gpio-agent

**Backend 부수효과**:
- 트랜잭션: `gateways.gateway_id` UPDATE + `devices` / `device_zones` 등 FK 컬럼 모두 cascade UPDATE
- MQTT 새 base_topic으로 재구독

#### `POST /api/config-deploy/:gatewayId/server-ip`

**Request:**
```json
{ "newServerIp": "175.206.245.234" }
```

**검증 규칙**: IPv4 or FQDN

**Pi 영향** (`apply-server-ip.sh`):
1. `/etc/smartfarm/server-ip` 치환
2. `/opt/zigbee2mqtt/data/configuration.yaml` `mqtt.server: mqtt://<new>:1883` 치환
3. `/etc/smartfarm/config-agent.env` `MQTT_SERVER` 치환 (없으면 생성, 현재 `setup.sh`는 systemd Environment 인라인이므로 service 파일을 EnvironmentFile 방식으로 마이그레이션)
4. `/etc/smartfarm/gpio-agent.env` `MQTT_SERVER` 치환
5. `/etc/systemd/system/reverse-ssh-tunnel.service` `Environment=SERVER_HOST=<new>` 치환
6. `systemctl daemon-reload`
7. `systemctl restart zigbee2mqtt config-agent gpio-agent reverse-ssh-tunnel`

**중요 응답 정책**: MQTT publish는 변경 **이전** broker로 보내고, 적용 후 새 broker로 재연결 → 새 broker로 response publish. 백엔드는 같은 broker(자기 자신)이므로 정상 수신.

#### `POST /api/gateway-manager/register-tunnel-key` (Pi internal)

**Auth**: `X-Smartfarm-Bootstrap-Token` 헤더 (골든 이미지에 사전 주입)

**Request:**
```json
{
  "gatewayId": "lgw-default",
  "publicKey": "ssh-ed25519 AAAA... tunnel@lgw-...",
  "machineId": "abc123def..."
}
```

**Response (200 OK):** `{ "registered": true }`

**서버 동작**: `/home/pi/.ssh/authorized_keys`에 키 append (`from="restrict,..." command="…" no-pty …` 옵션 포함하여 tunnel 전용으로 제한)

### 4.3 Error Responses

| Code | Scenario | Handling |
|------|----------|----------|
| 400 | DTO 검증 실패 (invalid SSID, hostname 정규식 등) | Frontend re-input |
| 404 | gatewayId 존재하지 않음 | Toast |
| 409 | hostname 중복 / gateway-id 중복 | Toast |
| 503 | MQTT broker 미연결 | Backend 503 + retry guidance |
| 504 | Pi 응답 90초 timeout | WS status='failed' detail='timeout' |

---

## 5. UI/UX Design

### 5.1 ConfigDeploy.vue — 카드 확장

```
┌─ 게이트웨이: lgw-default (hostname: lgw-default) ──────────┐
│  상태: 🟢 online   터널: 🟢 connected   IP: 192.168.0.42  │
├────────────────────────────────────────────────────────────┤
│  [기존] Zigbee2MQTT 설정                                    │
│    ─ YAML diff / 배포 (변경 없음)                           │
├────────────────────────────────────────────────────────────┤
│  ▼ 시스템 설정 (펼쳐보기)                                   │
│    ─────────────────────────────────────────────────────   │
│    Hostname                                                 │
│    [lgw-default      ] → [lgw-farm01    ]  [적용]          │
│                                              상태: ⚪ 대기  │
│    ─────────────────────────────────────────────────────   │
│    Wi-Fi                                                    │
│    SSID:     [FarmA_5G         ]                            │
│    Password: [••••••••         ]                            │
│                                              [적용]         │
│                                              상태: 🔄 적용중│
│    ⚠ 본사에서 농장 SSID로 변경 시 본사 인터넷 끊김 정상     │
│       비상시 LAN 직결 → ssh lgw-default@192.168.0.100      │
│    ─────────────────────────────────────────────────────   │
│    Gateway ID  (⚠ admin 전용, DB도 함께 갱신)               │
│    [lgw-default      ] → [lgw-farm01    ]  [적용]          │
│    ─────────────────────────────────────────────────────   │
│    Server IP  (⚠ admin 전용, 개발↔프로덕션 전환)           │
│    [172.30.1.42      ] → [175.206.245.234]  [적용]         │
│    ─────────────────────────────────────────────────────   │
│    📜 최근 적용 이력 (최근 5건)                             │
│      ✓ 2026-05-19 10:24  wifi → applied_no_internet        │
│      ✓ 2026-05-19 09:10  hostname → lgw-farm01             │
└────────────────────────────────────────────────────────────┘
```

### 5.2 User Flow (Wi-Fi 변경 시나리오)

```
[운영자]
  1. ConfigDeploy 페이지 진입
  2. "lgw-default" 카드 → "시스템 설정" 펼치기
  3. Wi-Fi SSID/PW 입력 → "적용" 클릭
  4. 안내 모달:
     ─────────────────────────────────────────
     "본사에서 농장 Wi-Fi로 변경하면 본사
      Wi-Fi 인터넷이 끊깁니다. 이것은 정상이며
      Pi를 농장에 설치하면 자동 연결됩니다.
      비상시 LAN 케이블 직결 → 192.168.0.100
                                       [확인]"
     ─────────────────────────────────────────
  5. 카드 상태 배지: 🔄 적용중
  6. WebSocket 응답:
     - applied_online → 🟢 (Pi가 본부에 있고 새 SSID도 본부 가시범위)
     - applied_no_internet → 🟡 (정상, Pi를 농장 발송)
     - failed → 🔴 (SSID 오타 등)
  7. 이력 테이블에 1건 추가
```

### 5.3 Component List

| Component | Location | Responsibility |
|-----------|----------|----------------|
| `ConfigDeploy.vue` | `frontend/src/views/` | 기존 페이지 — 카드 컨테이너 |
| `GatewaySystemConfigCard.vue` (신규) | `frontend/src/components/config-deploy/` | 시스템 설정 섹션 (펼침/접힘 + 4종 폼) |
| `RemoteConfigStatusBadge.vue` (신규) | `frontend/src/components/config-deploy/` | 상태 배지 (대기/적용중/applied_online/no_internet/failed) |
| `useRemoteConfig.ts` (신규) | `frontend/src/composables/` | 4종 mutation + WS 구독 통합 훅 |
| `config-deploy.api.ts` | `frontend/src/api/` | 기존 — 4개 메서드 추가 (`postWifi`, `postHostname`, `postGatewayId`, `postServerIp`) |

---

## 6. Error Handling

### 6.1 Error Matrix

| Source | Code/상황 | Backend 처리 | Frontend 표시 |
|--------|----------|-------------|--------------|
| DTO | 400 invalid hostname | 즉시 reject | Toast "hostname은 a-z0-9- 형식만 가능" |
| DTO | 400 invalid SSID (빈 문자열) | 즉시 reject | Toast |
| DB | 409 hostname duplicate | 즉시 reject | Toast "이미 사용 중인 hostname" |
| MQTT | broker 미연결 | 503 + activity_logs 'failed' | Toast + 카드 🔴 |
| Pi | apply-wifi.sh stderr (nmcli 실패) | response success=false | 🔴 + detail 표시 |
| Pi | 90초 내 response 없음 | timeout → 'failed' | 🔴 "응답 시간 초과" |
| Pi | server-ip 변경 후 MQTT 재연결 실패 | 60초 내 새 broker로 response 없으면 'failed' | 🔴 + 복구 가이드 링크 |

### 6.2 Timeout 정책

- Wi-Fi: 90초 (60초 ping 확인 + 30초 여유)
- Hostname: 30초 (즉시 적용, reboot는 옵션)
- Gateway ID: 60초 (Z2M 재시작 포함)
- Server IP: 120초 (모든 서비스 재시작 + 재연결)

### 6.3 동시성 정책

- 같은 게이트웨이에 동시 2개 요청 → 백엔드에서 in-memory mutex (per gatewayId)
- 두 번째 요청은 409 "이전 설정 적용 중" 반환
- Pi 측도 `flock /var/lock/smartfarm-config.lock` 로 직렬화

---

## 7. Security Considerations

| 항목 | 조치 |
|------|------|
| Bootstrap Token | `/etc/smartfarm/bootstrap.token` (mode 600). 첫 부팅 1회만 유효 (서버에서 사용 후 무효화) |
| Tunnel SSH key | 각 Pi마다 unique (first-boot-init에서 ed25519 생성). authorized_keys에 `command=""`, `restrict` 적용으로 port-forward만 허용 |
| Wi-Fi 비밀번호 | 골든 이미지 내 NM connection 파일 mode 600. 향후 사이클에서 LUKS / TPM 검토 |
| MQTT credentials | `/etc/smartfarm/*.env` mode 600 |
| `register-tunnel-key` 엔드포인트 | bootstrap 토큰 헤더 + 같은 토큰 24h TTL |
| Hostname / SSID 입력 | 백엔드 DTO에서 정규식 검증 → 쉘 주입 방지 (Pi 측은 모두 `"$1"` 인용 + `shellcheck` 통과) |
| 시스템 설정 변경 권한 | hostname/wifi: admin + farm_admin / gateway-id + server-ip: admin only |
| 활동 로그 | 모든 4종 요청 + 결과를 activity_logs에 기록 (`[활동 로그 시스템]` 메모리 규칙 준수) |

---

## 8. Test Plan

### 8.1 Test Scope

| Type | Target | Tool |
|------|--------|------|
| Unit | Backend DTO 검증 | Jest |
| Unit | Pi bash 스크립트 syntax | `bash -n`, `shellcheck` |
| Integration | MQTT request → response 왕복 | mosquitto + mock Pi |
| Manual | 실 Pi (`lgw-HK`) 7종 시나리오 | 본부 라즈베리파이 |
| E2E | ConfigDeploy.vue 폼 → WS 응답 표시 | Playwright (smart-farm-test) |

### 8.2 Test Cases (Plan §8.1 시나리오 그대로 + 회귀)

핵심 시나리오:
- [ ] **TS-01** 골든 이미지 dd → 부팅 → 본부 Wi-Fi 자동 연결 + tunnel 활성 + 웹UI 표시
- [ ] **TS-02** hostname 변경: `lgw-default` → `lgw-test01` + DB 반영 + WS 'success'
- [ ] **TS-03** Wi-Fi 변경 (본부 SSID 그대로 새로 입력 — 인터넷 유지) → `applied_online`
- [ ] **TS-04** Wi-Fi 변경 (가짜 SSID `FarmDummy_5G`) → `applied_no_internet` (변경 유지, Pi는 오프라인)
- [ ] **TS-05** Wi-Fi 변경 직후 tunnel 끊김 → 1~2분 내 자동 복구
- [ ] **TS-06** LAN 케이블 직결 → `ssh lgw-default@192.168.0.100` 성공
- [ ] **TS-07** gateway-id 변경 → DB cascade + Z2M base_topic 변경 + 재시작
- [ ] **TS-08** server-ip 변경 (172.30.1.42 → 175.206.245.234) → Z2M / agents / tunnel 모두 새 IP 재연결
- [ ] **TS-09** server-ip 변경 (잘못된 IP) → 60초 내 response 없으면 'failed', 운영자가 LAN 복구

회귀 (기존):
- [ ] Z2M YAML 배포(`update_config`) 기존 흐름 정상 — 자동 롤백 유지
- [ ] 자동제어 룰 동작 (Zigbee + GPIO)
- [ ] 우적 센서 → 개폐기 자동 닫음
- [ ] WebSocket 게이트웨이 상태 업데이트

---

## 9. Clean Architecture

### 9.1 Layer 매핑 (이 기능)

| Layer | Component | Location |
|-------|-----------|----------|
| **Presentation (Frontend)** | `ConfigDeploy.vue`, `GatewaySystemConfigCard.vue`, `RemoteConfigStatusBadge.vue` | `frontend/src/views/`, `frontend/src/components/config-deploy/` |
| **Application (Frontend)** | `useRemoteConfig.ts`, `useWebSocket.ts` | `frontend/src/composables/` |
| **Infrastructure (Frontend)** | `config-deploy.api.ts` | `frontend/src/api/` |
| **Presentation (Backend)** | `ConfigDeployController` 확장 (4 메서드 추가) | `backend/src/modules/config-deploy/` |
| **Application (Backend)** | `ConfigDeployService` 확장 + `remote-config.handlers/` | `backend/src/modules/config-deploy/` |
| **Domain (Backend)** | `config-deploy.types.ts` 확장 (ConfigAction enum) | `backend/src/modules/config-deploy/` |
| **Infrastructure (Backend)** | `MqttService`, `ActivityLogsService`, `EventsGateway` | `backend/src/modules/mqtt/`, `…/activity-logs/`, `…/gateway/` |
| **Device (Pi)** | `config-agent/handlers/*.js`, `scripts/*.sh`, `first-boot-init.service` | `raspberry-pi/` |

### 9.2 Dependency Rules

```
Frontend Presentation ──→ Frontend Composable ──→ Frontend API ──→ Backend Controller ──→ Backend Service ──→ MqttService
                                                                                                              │
                                                                                                              ▼
                                                                                                       Pi config-agent
                                                                                                              │
                                                                                                              ▼
                                                                                                       Pi shell scripts
```

규칙: Pi shell 스크립트는 백엔드와 직접 통신 금지 (반드시 config-agent 경유 → MQTT) — 디버깅/감사 단일 채널 보장.

### 9.3 Import 규칙 (이 기능)

| From | Allowed | Forbidden |
|------|---------|-----------|
| `GatewaySystemConfigCard.vue` | `useRemoteConfig.ts`, types | `axios` 직접 호출 |
| `useRemoteConfig.ts` | `config-deploy.api.ts`, `useWebSocket.ts` | DOM 조작 |
| `ConfigDeployController` | `ConfigDeployService` | `MqttService` 직접 |
| `ConfigDeployService` | `MqttService`, `ActivityLogsService`, `EventsGateway` | DB Repository 외 모듈 직접 |
| `config-agent/handlers/*.js` | `child_process.execFile` (`scripts/*.sh`) | HTTP 직접 호출 (first-boot-init 제외) |

---

## 10. Coding Convention Reference

> CLAUDE.md 프로젝트 컨벤션 준수

### 10.1 Naming

| Target | Convention | Example |
|--------|-----------|---------|
| Backend Module | `{name}.module.ts` / `{name}.service.ts` / `{name}.controller.ts` | 기존 `config-deploy` 유지 |
| Backend DTO | `dto/{verb}-{noun}.dto.ts` | `dto/update-wifi.dto.ts` |
| Frontend View | `PascalCase.vue` | `ConfigDeploy.vue` |
| Frontend Component | `PascalCase.vue` | `GatewaySystemConfigCard.vue` |
| Frontend Composable | `use{Feature}.ts` | `useRemoteConfig.ts` |
| Pi Handler | `{feature}.js` (kebab-case 모듈) | `wifi.js`, `server-ip.js` |
| Pi Script | `apply-{feature}.sh` | `apply-wifi.sh` |
| Activity Log Action | `gateway.config.{feature}.{result}` | `gateway.config.wifi.applied_online` |

### 10.2 Environment Variables (Pi)

| Var | Scope | Example |
|-----|-------|---------|
| `GATEWAY_ID` | config-agent / gpio-agent | `lgw-default` |
| `MQTT_SERVER` | config-agent / gpio-agent | `mqtt://172.30.1.42:1883` |
| `MQTT_USERNAME` / `MQTT_PASSWORD` | config-agent / gpio-agent | (mode 600) |
| `SERVER_HOST` | reverse-ssh-tunnel.service | `172.30.1.42` |
| `BOOTSTRAP_TOKEN` | first-boot-init.service 1회만 | (mode 600, 24h TTL) |

### 10.3 활동 로그 기록 (메모리 규칙 준수)

- 모든 `executeRelayAction()` 패턴 동일하게: 명령 발행 시 `requested`, 응답 수신 시 `applied_*` / `failed`
- gateway-id 변경은 cascade UPDATE도 1건 log (`gateway.config.gatewayid.applied`)

---

## 11. Implementation Guide

### 11.1 File Structure (신규/변경)

```
backend/
└── src/modules/config-deploy/
    ├── config-deploy.controller.ts          # +4 endpoints
    ├── config-deploy.service.ts             # +4 methods + response subscription expansion
    ├── config-deploy.types.ts               # +ConfigAction enum + payload types
    └── dto/                                  # NEW
        ├── update-wifi.dto.ts
        ├── update-hostname.dto.ts
        ├── update-gateway-id.dto.ts
        └── update-server-ip.dto.ts

backend/database/migrations/
└── 013_rpi_remote_config.sql                 # NEW (gateways column add)

frontend/
├── src/api/config-deploy.api.ts              # +4 methods
├── src/composables/useRemoteConfig.ts        # NEW
├── src/views/ConfigDeploy.vue                # 카드 컨테이너에 GatewaySystemConfigCard 추가
└── src/components/config-deploy/             # NEW dir
    ├── GatewaySystemConfigCard.vue
    └── RemoteConfigStatusBadge.vue

raspberry-pi/
├── build-golden-image.sh                     # NEW
├── clone-sd.sh                                # NEW
├── RECOVERY.md                                # NEW (비상 LAN 복구 가이드)
├── config-agent/
│   ├── index.js                               # action switch에 4종 추가
│   └── handlers/                              # NEW dir
│       ├── wifi.js
│       ├── hostname.js
│       ├── gateway-id.js
│       └── server-ip.js
├── scripts/                                   # NEW dir
│   ├── apply-wifi.sh
│   ├── apply-hostname.sh
│   ├── apply-gateway-id.sh
│   └── apply-server-ip.sh
└── systemd/
    ├── first-boot-init.service               # NEW
    └── reverse-ssh-tunnel.service            # NEW (현재는 tunnel-setup.sh가 인라인 생성 → 파일로 분리)

docs/
├── 02-design/features/rpi-golden-image-system.design.md  # 이 문서
└── 01-plan/features/rpi-golden-image-system.plan.md      # 기존
```

### 11.2 Implementation Order

Plan §7 순서를 세분화:

1. **[0.5h] DB migration** `013_rpi_remote_config.sql` 작성 + 로컬 적용
2. **[1h] Backend types/DTOs** — `ConfigAction` enum 확장 + 4개 DTO + class-validator 규칙
3. **[2h] Backend Service** — `requestWifi/requestHostname/requestGatewayId/requestServerIp` 메서드 + response handler 분기 + activity_logs + WS emit
4. **[0.5h] Backend Controller** — 4 endpoint + Role guard
5. **[1h] Backend Tunnel Key Register** — `POST /gateway-manager/register-tunnel-key` (bootstrap 토큰 검증)
6. **[1h] Frontend API + composable** — `useRemoteConfig` (mutation × 4 + WS 구독)
7. **[2h] Frontend UI** — `GatewaySystemConfigCard.vue` + `RemoteConfigStatusBadge.vue` + `ConfigDeploy.vue` 통합
8. **[1h] Pi shell 스크립트 4종** — `apply-wifi/hostname/gateway-id/server-ip.sh` + `bash -n` + `shellcheck`
9. **[1h] Pi config-agent handlers** — `handlers/*.js` + `index.js` switch 확장
10. **[1.5h] Pi `first-boot-init.service`** + `reverse-ssh-tunnel.service` 파일 분리
11. **[3h] `build-golden-image.sh` + `clone-sd.sh`** + 안전 검증
12. **[1h] `RECOVERY.md`** 작성
13. **[2h] 통합 테스트** TS-01~09 + 회귀 4종

**총 예상**: 약 17.5시간 (Plan 추정 18h와 동일 수준)

### 11.3 Migration / 호환성

- 기존 `update_config` (Z2M YAML 배포)는 변경 없음 — 같은 토픽 동일 흐름
- 기존 `setup.sh`는 신규 골든 이미지 워크플로우와 **공존** (현장 직접 셋업도 계속 가능)
- 기존 `config-agent`의 `pendingRollbackRequestId` 로직은 `update_config`에만 적용 — 신규 4종은 별도 핸들러 (롤백 없음)

---

## 12. Open Questions

| # | Question | Resolution Path |
|---|----------|----------------|
| Q1 | hostname 변경 시 즉시 재부팅 vs 다음 부팅까지 대기? | Plan §3 FR-C2는 reboot 예약. 본 설계는 **즉시 hostnamectl + 60초 후 reboot 예약** (운영자가 응답 확인할 시간 확보) |
| Q2 | server-ip 변경 후 백엔드는 어떻게 새 broker로 들어온 response를 매칭? | 백엔드 broker = 같은 broker이므로 IP만 바뀌고 broker는 동일 머신. 단, 향후 multi-broker 시 보강 필요 |
| Q3 | 골든 이미지에 KT_GiGA_5G_5E04 PSK를 평문 저장 — 보안 한계 | Plan §5에서 명시. 본 사이클은 그대로 두고 mode 600 + 후속 사이클에서 LUKS/TPM 검토 |
| Q4 | first-boot-init이 서버 응답을 못 받으면? (네트워크 불안정) | retry 5회 + 24h timer로 매시간 1회 재시도. 그래도 실패 시 운영자 LAN 직결 + 수동 `register-tunnel-key.sh` |
| Q5 | `lgw-default` 동일 hostname 다수 부팅 시 mDNS 충돌 | Plan §5 명시. 운영 절차로 본부에서 1대씩 부팅 + 즉시 hostname 배포 |

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-05-19 | 초안 — Plan v0.3 기반 상세 설계: 컴포넌트 다이어그램, MQTT 페이로드 확장, DB migration, 4종 endpoint, ConfigDeploy.vue 카드 확장, Pi 파일 레이아웃, 구현 순서 13단계 | ohgane |
