# Design: rpi-golden-image-mass-production

**Feature ID**: `rpi-golden-image-mass-production`
**작성일**: 2026-05-22
**기반 문서**: [01-plan/features/rpi-golden-image-mass-production.plan.md](../../01-plan/features/rpi-golden-image-mass-production.plan.md)
**상태**: Design

---

## 1. 검증 아키텍처

본 사이클은 **신규 기능 구현이 아닌 통합 검증**이므로 설계서는 "검증 토폴로지 + 측정 지점 + 절차의 순서"를 다룬다.

### 1.1 검증 토폴로지

```
┌────────── 본부 사무실 (LAN 172.30.1.0/24) ──────────────────┐
│                                                              │
│  ┌──────────────────────────────────────────────┐           │
│  │ Mac (172.30.1.42) — Dev Server               │           │
│  │   - smart-farm-mqtt backend (3100)           │           │
│  │   - mosquitto (1883)                         │           │
│  │   - postgres + redis                         │           │
│  │   - frontend (5173)                          │           │
│  │   - autossh sshd (22) ← reverse tunnel sink  │           │
│  └──────────────────────────────────────────────┘           │
│                                                              │
│  ┌────────────────────┐    ┌────────────────────┐           │
│  │ lgw-dev (기존)      │    │ lgw-pilot01 (신규)  │           │
│  │  reverse_port 22201│    │  reverse_port=auto │           │
│  │  Match Rate 검증   │    │  ← 본 사이클 대상  │           │
│  │  영향 0 확인       │    │                    │           │
│  └────────────────────┘    └────────────────────┘           │
│                                                              │
│  Router 172.30.1.254 ← server-ip 일시 변경 대상              │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 1.2 측정 지점 (Telemetry)

| 측정 지점 | 도구 | 캡처 위치 |
|---|---|---|
| PI 부팅 → first-boot-init 완료 | `systemctl show -p ActiveEnterTimestamp first-boot-init` | `docs/evidence/B-boot-timeline.txt` |
| PI 서비스 active 상태 | `systemctl is-active reverse-ssh-tunnel config-agent gpio-agent zigbee2mqtt fallback-engine` | `docs/evidence/C-services.txt` |
| 신규 게이트웨이 DB 등록 | `psql -c "SELECT * FROM gateways WHERE gateway_id='lgw-pilot01' OR machine_id='<new>'"` | `docs/evidence/D-gateway-db.txt` |
| ConfigDeploy API 응답 | `curl ... | jq` (또는 브라우저 네트워크 탭 + 활동 로그) | `docs/evidence/E-{wifi,hostname,gw,server-ip}.json` |
| 자동화 룰 실행 | `journalctl -u config-agent -f` + 백엔드 로그 | `docs/evidence/G-rule-fire.log` |
| fallback 모드 진입 시각 | PI `journalctl -u fallback-engine -f` + `fallback_events` 테이블 | `docs/evidence/H1-fb-enter.log` |
| fallback 모드 동작 | `fallback_events` 테이블 + GPIO 상태 측정 | `docs/evidence/H2-fb-actions.json` |
| 정상 모드 복귀 | journalctl + `fallback_events` mode_changed | `docs/evidence/H3-fb-exit.log` |
| 회귀 영향 (lgw-dev) | activity_logs WHERE gateway_id='lgw-dev' AND created_at BETWEEN A AND B | `docs/evidence/I-lgw-dev-noise.json` |

`docs/evidence/` 디렉토리는 본 사이클 시작 시 생성.

---

## 2. 단계별 상세 절차

### 2.1 단계 A — 새 SD 카드에 골든 이미지 복제

**Pre-condition**:
- 새 32GB+ SD 카드 (SanDisk/Samsung class 10 권장)
- 맥에 USB SD 리더 연결
- `~/Projects/golden-images/golden-lgw-v20260521.img.xz` 존재 + SHA-256 검증 OK

**절차**:
```bash
# 1) 디스크 식별
diskutil list
# (예: /dev/disk5, 31.9 GB external)

# 2) 언마운트 (모든 파티션)
diskutil unmountDisk /dev/disk5

# 3) 이미지 검증 후 복제 (raw 디스크는 rdiskN)
shasum -a 256 -c ~/Projects/golden-images/golden-lgw-v20260521.img.xz.sha256
xz -dc ~/Projects/golden-images/golden-lgw-v20260521.img.xz \
  | sudo dd of=/dev/rdisk5 bs=4m status=progress
# (status=progress는 macOS dd가 미지원 → Ctrl+T로 SIGINFO 대체)

# 4) 동기화 후 추출
sync
diskutil eject /dev/disk5
```

**Post-condition**: SD 카드 두 파티션(`bootfs` + Linux) 인식 가능

**Acceptance**: 복제 종료까지 `dd` 에러 0, `sync` 완료, eject 정상

---

### 2.2 단계 B — 신규 PI 첫 부팅 + 자동 등록

**Pre-condition**:
- 새 Raspberry Pi 3B/4 + 전원 어댑터
- 본부 Wi-Fi(`KT_GiGA_5G_5E04`) 접근 가능 위치
- (옵션) HDMI 모니터 (콘솔 확인용, 없어도 됨)
- dev 서버 백엔드(`172.30.1.42:3100`) + mosquitto(`1883`) 동작 중

**절차**:
1. SD를 PI에 삽입 후 전원 ON
2. (자동) NetworkManager가 본부 Wi-Fi 연결 — 약 30~60초
3. (자동) systemd가 `first-boot-init.service` 실행 — 약 18초
   - SSH host key 재생성
   - `/root/.ssh/tunnel_key` ed25519 keypair 생성
   - POST `http://172.30.1.42:3100/api/config-deploy/register-tunnel-key`
   - `/etc/smartfarm/tunnel.env` 작성
   - `/var/lib/smartfarm/.first-boot-done` 마커 생성
4. (자동) `reverse-ssh-tunnel.service` autossh 시작 → 맥의 `localhost:22202` 등에 LISTEN
5. (자동) `config-agent`, `gpio-agent`, `zigbee2mqtt`, `fallback-engine` 시작

**측정**:
```bash
# 맥에서 — DB에 신규 등록 확인 (10초 단위 polling)
PSQL=/opt/homebrew/Cellar/postgresql@15/15.15_1/bin/psql
PGPASSWORD=smartfarm123 $PSQL -h localhost -U smartfarm -d smartfarm_mqtt -c \
  "SELECT gateway_id, machine_id, tunnel_port, rpi_ip, created_at FROM gateways ORDER BY created_at DESC LIMIT 3;"

# 맥에서 — 새 tunnel 포트 LISTEN 확인
lsof -nP -iTCP -sTCP:LISTEN | grep -E ':222[0-9][0-9]'
```

**Acceptance**:
- 부팅 후 5분 이내 DB에 신규 행 1건 추가 (gateway_id = `lgw-default-<machineid-prefix>`, tunnel_port ≥ 22200)
- 맥에서 해당 tunnel_port가 LISTEN 상태
- 신규 tunnel_port로 키 인증 SSH 성공:
  ```bash
  ssh -i ~/.ssh/id_rpi_lgw -p <tunnel_port> lgwadmin@localhost "hostname; whoami; uptime"
  ```

---

### 2.3 단계 C — 서비스 자동 active 검증

**절차** (reverse tunnel 통해 실행):
```bash
ssh -i ~/.ssh/id_rpi_lgw -p <tunnel_port> lgwadmin@localhost \
  "systemctl is-active \
     reverse-ssh-tunnel config-agent gpio-agent zigbee2mqtt fallback-engine" \
  > ~/Projects/smart-farm-mqtt/docs/evidence/C-services.txt
```

**Acceptance**: 5개 모두 `active` (zigbee2mqtt는 dongle 미연결 시 `activating(auto-restart)` 허용)

---

### 2.4 단계 D — 웹UI 인지 검증

**절차**:
1. 브라우저에서 `http://localhost:5173/gateway-management` 접속
2. 신규 게이트웨이 카드 존재 확인
3. 카드 정보:
   - `gateway_id`: `lgw-default-<prefix>` (이후 단계 E에서 `lgw-pilot01`로 변경)
   - `online` 배지
   - `machine_id`, `tunnel_port`, `rpi_ip` 표시
4. 웹콘솔 버튼 클릭 → 셸 접속 가능 (xterm 표시 + 명령 입력 가능)

**Acceptance**: 모든 정보 정상 표시 + 웹콘솔 셸 1초 내 응답

---

### 2.5 단계 E — 4종 원격 설정 배포

각 배포는 ConfigDeploy 페이지(`http://localhost:5173/config-deploy`)에서 신규 게이트웨이 선택 후 실행. 모든 응답을 `docs/evidence/E-*.json`로 저장.

#### E-1. hostname 배포 (`lgw-default-<prefix>` → `lgw-pilot01`)

**Request**: `POST /api/config-deploy/{gatewayId}/hostname` body: `{"hostname": "lgw-pilot01"}`

**Expected**:
- PI에서 `hostnamectl --static` → `lgw-pilot01`
- `/etc/hostname` → `lgw-pilot01`
- 활동 로그에 `system_config_deployed` 이벤트

#### E-2. gateway-id 배포 (`lgw-default-<prefix>` → `lgw-pilot01`)

**Request**: `POST /api/config-deploy/{gatewayId}/gateway-id` body: `{"gatewayId": "lgw-pilot01"}`

**Expected**:
- PI `/etc/smartfarm/gateway-id` → `lgw-pilot01`
- Z2M `configuration.yaml` base_topic → `farm/lgw-pilot01/z2m`
- `config-agent.service`, `gpio-agent.service`, `fallback-engine.env` 모두 `GATEWAY_ID=lgw-pilot01`
- 서비스 재시작 후 MQTT 구독 토픽 `farm/lgw-pilot01/*` 로 전환
- 서버 DB `gateways.gateway_id` `lgw-pilot01`로 UPDATE
- **이 단계에서 reverse tunnel 영향 없음** (autossh는 IP/포트 기반)

**Note**: hostname 배포 직후 gateway-id 배포가 권장 순서 (Z2M base_topic 분리 방지)

#### E-3. Wi-Fi 배포 (멱등성 검증 — 동일 SSID 재등록)

**Request**: `POST /api/config-deploy/{gatewayId}/wifi` body:
```json
{
  "ssid": "KT_GiGA_5G_5E04",
  "password": "<현재 비번>",
  "priority": 100
}
```

**Expected**:
- PI에서 `nmcli con show` 결과: 기존 `wifi-hq` connection이 그대로 유지 또는 동일 SSID 새 connection 추가(이름 충돌 시 시스템이 처리)
- 인터넷 끊김 ≤ 5초
- 활동 로그 기록 + 응답 페이로드 `serviceRestarted: true/false` 정확

**Acceptance**: 동일 SSID 재배포가 멱등 — connection 중복 없음 또는 깨끗한 덮어쓰기

#### E-4. server-ip 배포 (다른 LAN 호스트로 임시 변경 → 5분 후 원복)

**Step E-4-a (변경)**: `POST /api/config-deploy/{gatewayId}/server-ip` body: `{"serverIp": "172.30.1.254"}`

**Expected**:
- PI에서:
  - `/etc/smartfarm/server-ip` → `172.30.1.254`
  - `reverse-ssh-tunnel.service`의 `Environment=SERVER_HOST=172.30.1.254` 치환
  - `config-agent.env`, `gpio-agent.env`, Z2M config의 MQTT broker URL 동기화
  - 서비스 재시작
  - autossh가 `172.30.1.254:22`로 재연결 시도 → 라우터에는 sshd 없으므로 **연결 실패**
- 맥(`172.30.1.42`)에서:
  - 해당 tunnel_port LISTEN 해제 (5분 이내)
  - DB에서 게이트웨이가 offline 표시
- 그러나 PI는 살아있고 정상 동작(eth0 LAN 또는 본부 Wi-Fi는 그대로) → eth0 직결로 검증 가능

**Step E-4-b (원복, 5분 후)**: `POST /api/config-deploy/{gatewayId}/server-ip` body: `{"serverIp": "172.30.1.42"}`
- **주의**: PI가 서버와 끊긴 상태이므로 이 API 호출은 *맥에서 직접* PI에 SSH 직결로 명령 실행(`apply-server-ip.sh 172.30.1.42`)으로 대체
- 또는 eth0 192.168.0.100 케이블 연결 후 server-ip 복원

**Acceptance**:
- E-4-a 후 5분 내 tunnel 끊김
- E-4-b 후 3분 내 tunnel 재연결 + 게이트웨이 online 복귀

---

### 2.6 단계 F — 장치 등록

#### F-1. GPIO 릴레이 매핑 (8CH 또는 12CH)

1. Devices 페이지에서 `lgw-pilot01` 선택
2. 채널별 장치명 등록 (예: 1=관수1, 2=관수2, 3=환기팬, 4=개폐기열기, 5=개폐기닫기, 11=mixer, 12=fertilizer)
3. 개폐기 인터록 매핑(pairedDevice) 설정: 4↔5

#### F-2. Zigbee 페어링 (1-2개)

1. `lgw-pilot01` 웹콘솔에서 permit-join:
   ```bash
   mosquitto_pub -t farm/lgw-pilot01/z2m/bridge/request/permit_join -m '{"value": true, "time": 120}'
   ```
2. Zigbee 센서(예: 온습도 센서 1개) 페어링 모드 진입
3. 페어링 성공 후 Devices 페이지에서 자동 표시 확인

#### F-3. 그룹 생성

- Groups 페이지에서 "파일럿 그룹" 생성, 위 장치들 할당

**Acceptance**: 페어링/매핑 후 Devices 페이지에서 ON/OFF 토글이 실제 GPIO/Zigbee로 반영

---

### 2.7 단계 G — 자동화 룰 등록

#### G-1. 관수 룰 (시간 기반)

```yaml
name: "파일럿 관수 #1"
gateway: lgw-pilot01
device: 관수1
condition: time_between
  - start: "10:00"
  - end: "10:01"  # 검증 편의를 위해 1분 창
action:
  - device: 관수1, state: ON, duration: 30s
```

#### G-2. 환기 룰 (센서 기반)

```yaml
name: "파일럿 환기 #1"
gateway: lgw-pilot01
condition: sensor_temperature
  - operator: ">="
  - value: 30  # 검증 편의(실내 온도 + 가열 시뮬레이션)
action:
  - device: 환기팬, state: ON
hysteresis: 5  # 25°C에서 OFF
```

#### G-3. 개폐기 빗물 override 룰

```yaml
name: "파일럿 빗물 보호"
gateway: lgw-pilot01
condition: sensor_rain
  - state: ACTIVE
action:
  - device: 개폐기닫기, state: ON (인터록 자동 처리)
priority: highest  # 모든 모드에서 최우선
```

**Acceptance**:
- G-1: 10:00에 관수1 ON → 30초 후 OFF (백엔드 자동화 엔진 + MQTT + GPIO 트레이스)
- G-2: 센서값 30°C 도달 → 환기팬 ON, 25°C 도달 → OFF
- G-3: 빗물 ACTIVE 시뮬레이션 → 개폐기닫기 ON (개폐기열기 자동 OFF 인터록)

---

### 2.8 단계 H — 이머전시 페일오버 실기 검증

#### H-1. 정상 → fallback 진입

**Trigger**: 맥에서 `brew services stop mosquitto`

**예상 동작**:
- t=0s: mosquitto stop
- t=5±0.5분: `heartbeat-watchdog`가 서버 heartbeat 미수신 5분 도달 → fallback 진입
- `fallback_events` 테이블에 `mode_changed online→fallback` row 1건
- PI WebSocket `fallback:mode-changed` emit (UI 배지 표시)

**측정**:
```bash
# 맥에서 SQLite 직접 조회 (PI 로컬 DB는 reverse SSH 통해)
ssh -i ~/.ssh/id_rpi_lgw -p <port> lgwadmin@localhost \
  "sudo sqlite3 /var/lib/smartfarm/fallback/fallback.db \
   'SELECT * FROM fallback_events ORDER BY created_at DESC LIMIT 10;'"
```

**Acceptance**: 진입 시각 5분 ±30초 범위

#### H-2. fallback 모드 동작 검증 (4가지 시나리오)

| 시나리오 | Trigger | 예상 결과 |
|---|---|---|
| 관수 timeout | 관수1을 fallback 진입 전 ON 상태로 유지 | fallback 진입 후 onSince+30분에 자동 OFF |
| 액비 즉시 OFF | fertilizer 채널 ON 상태로 fallback 진입 | 진입 즉시 OFF |
| 환기팬 히스테리시스 | PI 시뮬레이션: temperature 36°C → 27°C → 36°C | 35°C에서 ON, 28°C에서 OFF (G-2 룰 값과 별개의 fallback 정책) |
| 빗물 override | rain sensor ACTIVE 신호 (mosquitto 안 켜진 채로) | 개폐기닫기 즉시 ON (서버 룰 무관) |

**측정**: 각 시나리오의 `fallback_events` row + GPIO 핀 상태 + `fallback_engine.log` 캡처

**Acceptance**: 4개 시나리오 모두 코드 정책과 일치

#### H-3. fallback → 정상 복귀

**Trigger**: `brew services start mosquitto` + 30초 대기

**예상 동작**:
- t=0s: mosquitto 시작
- t=heartbeat 첫 도달 시점: `recovery-grace` 30초 시작
- t=heartbeat+30s: server 모드 복귀
- `fallback_events`에 `mode_changed fallback→online` row + 이벤트 큐 flush 로그

**Acceptance**: 복귀 시간 30±5초

---

### 2.9 단계 I — 회귀 영향 검증 (lgw-dev)

**검증**:
- H 단계 전후로 `lgw-dev` 게이트웨이의 활동 로그 차분 비교
- mosquitto stop 시간 동안 lgw-dev도 fallback 진입했는지 확인 (✅ 정상 동작 — 진입했어야 함)
- mosquitto 복귀 후 lgw-dev도 server 모드 복귀했는지 확인
- lgw-dev 운영 룰에 영향 0 (예: 룰 변경 / 토픽 누락 / 명령 오발사 0건)

**측정**:
```sql
SELECT COUNT(*), MIN(created_at), MAX(created_at)
FROM activity_logs
WHERE gateway_id = 'lgw-dev'
  AND created_at >= '<H-1 시작 timestamp>'
  AND created_at <= '<H-3 종료 timestamp>'
  AND action_type IN ('error', 'warn', 'command_failed');
```

**Acceptance**: 위 쿼리 결과 0건

---

### 2.10 단계 J — 상시 운영 전환

**절차**:
- DB의 `lgw-pilot01` 레코드 보존 (그대로 운영 게이트웨이 #2)
- 활동 로그 모니터링 활성화 (관리자 알림)
- `~/.ssh/known_hosts`에 새 tunnel host key 등록 (`localhost:<tunnel_port>`)
- SD 카드 정리하지 않음 (운영 중)
- 다음 양산 검증은 새 SD 카드 + 새 PI 조합으로 시작

**산출물**:
- 운영 절차서 초안 작성: `docs/05-operation/rpi-mass-production-runbook.md`

---

## 3. 데이터 모델 변경

**변경 없음** (기존 스키마 그대로 사용):
- `gateways` 테이블: 신규 행 1건 추가
- `devices`, `groups`, `automation_rules`: 신규 행 추가
- `activity_logs`: 검증 중 자연스럽게 채워짐
- `fallback_events`, `fallback_configs`: 검증 중 자연스럽게 채워짐

---

## 4. 비기능 설계

### 4.1 안전 가드

| 가드 | 메커니즘 |
|---|---|
| 검증 중 lgw-dev 운영 보호 | mosquitto stop 시간 최소화 (≤10분), lgw-dev 자동화 룰은 단순 시간 기반(검증 시간대와 겹치지 않도록 사전 조정) |
| 신규 PI 잘못된 server-ip 적용 시 복구 | eth0 static 192.168.0.100 케이블 직결 경로로 SSH 직접 접속 가능 |
| Wi-Fi 배포 실패 시 인터넷 끊김 | 동일 SSID 재배포이므로 인터넷 끊김 자체가 검증 항목, ≤5초 허용 |
| 자동화 룰 미작동 발견 | 백엔드 로그 + activity_logs로 5분 내 검출 → 룰 비활성화 |

### 4.2 측정 자동화

- `docs/evidence/` 디렉토리에 단계별 산출물 누적
- 모든 SQL/journalctl/curl 명령은 `docs/02-design/features/scripts/validate-mass-production.sh` 한 스크립트로 묶어 reproducible하게 만든다 (별도 작성)

---

## 5. 위험 재평가 (Plan §6 대비)

| Plan Risk | Design Mitigation |
|---|---|
| SD 카드 품질 문제 | A 단계에서 SHA-256 검증 강제 + 대체 SD 1개 사전 준비 |
| DHCP 임대 풀 부족 | eth0 static 192.168.0.100 fallback 경로 명시 |
| register-tunnel-key race | 1대씩 순차 검증 (본 사이클은 1대) |
| server-ip 변경 후 tunnel 끊김 | 명시적 검증 시나리오 (E-4-a/E-4-b)로 흡수 |
| Zigbee 페어링 실패 | mosquitto_pub으로 permit-join 명령 명시 |
| mosquitto stop 시 lgw-dev 오염 | 단계 I로 영향 측정 + 운영 룰 사전 조정 |
| fallback 진입 시간이 5분이 아님 | 측정 결과로 코드 상수 검증, 차이 발생 시 별도 사이클 |

---

## 6. 산출물 정리

| 산출물 | 위치 | 작성 단계 |
|---|---|---|
| 검증 결과 분석서 | `docs/03-analysis/rpi-golden-image-mass-production.analysis.md` | Check |
| 운영 절차서 초안 | `docs/05-operation/rpi-mass-production-runbook.md` | Check 또는 Report |
| evidence 파일들 | `docs/evidence/{A..J}-*.{txt,json,log}` | Do 단계 누적 |
| 검증 스크립트 | `docs/02-design/features/scripts/validate-mass-production.sh` | Design 다음 단계 |
| 완료 보고서 | `docs/04-report/features/rpi-golden-image-mass-production.report.md` | Report |

---

## 7. 다음 단계 (Do Phase)

1. `docs/evidence/` 디렉토리 생성
2. `validate-mass-production.sh` 스크립트 작성 (선택)
3. 새 SD 카드 준비
4. Plan의 단계 A부터 순차 실행
5. 각 단계 완료 시 evidence 파일 채워가며 진행

본 설계는 가이드라인이며, 실기 검증 중 발견되는 차이는 분석서(`*.analysis.md`)에 기록한다.
