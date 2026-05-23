# Design: rpi-local-broker-failover

**Feature ID**: `rpi-local-broker-failover`
**작성일**: 2026-05-23
**기반 문서**: [01-plan/features/rpi-local-broker-failover.plan.md](../../01-plan/features/rpi-local-broker-failover.plan.md)
**상태**: Design
**우선순위**: **HIGH** — 페일오버 설계 결함 해소

---

## 1. 아키텍처 결정 (ADR)

### Option Analysis

| 옵션 | 설명 | 장점 | 단점 |
|---|---|---|---|
| **A. 항상 localhost + bridge (선택)** | PI agents → mqtt://localhost:1883, mosquitto가 bridge로 외부와 양방향 sync | 단순, 단절 시 PI agents 영향 0, 표준 mosquitto 패턴 | 양방향 토픽 매핑 정확성 필요 |
| B. 단절 감지 시만 fallback | 정상 시 외부 broker, 단절 시 localhost로 전환 | 메모리 절약 | agent 로직 복잡, 전환 시점 race condition |
| C. 양쪽 모두 publish/subscribe | 모든 메시지 2회 발행/구독 | 가장 안전 | 메시지 중복, 무한 루프 위험, 대역폭 낭비 |

### 결정: **옵션 A**

근거:
- mosquitto bridge는 운영 검증된 패턴 (산업 표준)
- agent 코드 변경 최소 (env 한 줄: MQTT_SERVER=mqtt://localhost:1883)
- 외부 broker 단절 시 PI 내부 동작은 영향 0 (localhost는 항상 active)
- bridge가 외부 재연결 시 자동 sync (mosquitto 기본 기능)

---

## 2. 시스템 토폴로지

```
┌──────────────────── PI (lgw-pilot01) ────────────────────────┐
│                                                                │
│   ┌─────────────────────────────────┐                         │
│   │  mosquitto (NEW)                 │                         │
│   │   • listener 1883 on 127.0.0.1   │                         │
│   │   • bridge → 172.30.1.42:1883    │                         │
│   │   • topics: farm/+/# both 1      │                         │
│   └────────┬──────────────────────┬──┘                         │
│            │                      │                            │
│   ┌────────▼────────┐  ┌──────────▼─────────┐                 │
│   │ fallback-engine │  │ gpio-agent          │                 │
│   │   (localhost)   │  │   (localhost)       │                 │
│   └─────────────────┘  └────────────────────┘                  │
│   ┌─────────────────┐  ┌────────────────────┐                 │
│   │ config-agent    │  │ zigbee2mqtt         │                 │
│   │   (localhost)   │  │   (localhost)       │                 │
│   └─────────────────┘  └────────────────────┘                  │
│                                                                │
│  단절 시: bridge만 끊김. agents는 localhost에 정상 publish/subscribe → │
│           fallback-engine emergency-stop이 gpio-agent에 즉시 도달    │
└────────────────────────────────────────────────────────────────┘
                              │
                              │ bridge (mosquitto 양방향)
                              │
┌─────────────────── Server (172.30.1.42) ─────────────────────┐
│   ┌─────────────────────────┐                                 │
│   │ Cloud mosquitto :1883   │                                 │
│   └─────────────────────────┘                                 │
└────────────────────────────────────────────────────────────────┘
```

### Bridge 정책
- `topic farm/+/# both 1` — 모든 농장 토픽 양방향 sync
- `try_private false` — bridge metadata 토픽 사용 안 함 (안전)
- `start_type automatic` — 부팅 시 자동 시작
- `bridge_protocol_version mqttv311`
- `cleansession true` — 단절 후 재연결 시 stale 메시지 제거

---

## 3. 구현 항목

### 3.1 mosquitto 설치 + 설정

#### 3.1.1 패키지 설치 (setup.sh + 골든 이미지)
```bash
apt-get install -y mosquitto mosquitto-clients
systemctl enable mosquitto
```

#### 3.1.2 `/etc/mosquitto/conf.d/local-listener.conf` (신규)
```
# 로컬 listener (PI agents 전용)
listener 1883 127.0.0.1
allow_anonymous true   # localhost only이므로 인증 생략
persistence true
persistence_location /var/lib/mosquitto/
persistence_file mosquitto.db
log_dest file /var/log/mosquitto/mosquitto.log
log_type error
log_type warning
log_type notice
max_inflight_messages 100
max_queued_messages 5000
```

#### 3.1.3 `/etc/mosquitto/conf.d/bridge-cloud.conf` (신규)
```
# 클라우드 broker bridge (자동 재연결)
connection cloud-bridge
address ${SERVER_IP}:1883
topic farm/+/# both 1
bridge_protocol_version mqttv311
try_private false
start_type automatic
notifications false
cleansession true
bridge_attempt_unsubscribe false
restart_timeout 10
```

bridge config는 `${SERVER_IP}` 환경변수가 아니라 실제 IP를 sed로 치환 (mosquitto는 env interpolation 지원 안 함).

### 3.2 apply-server-ip.sh 갱신

server-ip 변경 시 mosquitto bridge config의 address도 변경:

```bash
# 기존 (tunnel.env, config-agent.env 등 갱신) +
sed -i -E "s|^address [0-9.]+:1883$|address ${NEW_IP}:1883|" \
  /etc/mosquitto/conf.d/bridge-cloud.conf
systemctl restart mosquitto
```

### 3.3 agent env 변경

| 파일 | Before | After |
|---|---|---|
| `/etc/smartfarm/config-agent.env` | `MQTT_SERVER=mqtt://172.30.1.42:1883` | `MQTT_SERVER=mqtt://127.0.0.1:1883` |
| `/etc/smartfarm/gpio-agent.env` | 동일 | 동일 |
| `/etc/smartfarm/fallback-engine.env` | 동일 | 동일 |
| `/opt/zigbee2mqtt/data/configuration.yaml mqtt.server` | `mqtt://172.30.1.42:1883` | `mqtt://127.0.0.1:1883` |

### 3.4 setup.sh / golden image 통합

setup.sh의 mosquitto 섹션 추가:
```bash
# Step X: mosquitto 설치 + bridge config 생성
apt-get install -y mosquitto mosquitto-clients
install -m 644 /tmp/local-listener.conf /etc/mosquitto/conf.d/
sed "s|\${SERVER_IP}|${SERVER_IP}|g" /tmp/bridge-cloud.conf.tmpl \
  > /etc/mosquitto/conf.d/bridge-cloud.conf
systemctl enable --now mosquitto
```

골든 이미지 v20260524 신규 빌드 필요 (시간 많이 걸림).

---

## 4. 단계별 구현 순서 (Do Phase)

### Phase 1: lgw-pilot01에서 직접 검증 (코드 변경 안 함)
1. mosquitto 설치 + conf 배치
2. bridge config 생성 (SERVER_IP=172.30.1.42)
3. agent env 변경 + 재시작
4. 정상 동작 확인 (서버 → PI 명령, PI → 서버 이벤트 양방향)
5. mosquitto stop (서버측) → fallback 진입 검증
6. **이때 fallback-engine의 safety_off가 localhost broker에 publish → gpio-agent가 받아 GPIO 제어** ← 본 사이클의 핵심 검증
7. mosquitto start (서버측) → bridge 재연결 → 정상 모드 복귀

### Phase 2: setup.sh + 골든 이미지 통합 (선택, 시간 많이)
1. setup.sh에 mosquitto 섹션 추가
2. lgw-pilot01에 setup.sh 재실행 (idempotent 확인)
3. 골든 이미지 신규 빌드 (v20260524)
4. 신규 SD에 dd 복제 → 새 PI 부팅 → 양산 검증

본 사이클은 **Phase 1만 완료**해도 가치 있음. Phase 2(골든 이미지 재빌드)는 별도 사이클(`rpi-golden-image-v20260524-rebuild`)로 분리 가능.

---

## 5. 검증 시나리오 (AT)

### AT-01: 로컬 broker 정상 동작
```bash
ssh PI "systemctl is-active mosquitto"  # active
ssh PI "mosquitto_sub -h localhost -t 'farm/+/+/+' -v" &  # subscribe 가능
```

### AT-02: bridge 양방향 sync
```bash
# 서버에서 publish → PI localhost에서 받기
mosquitto_pub -h 172.30.1.42 -t 'farm/lgw-pilot01/test' -m 'hello'
# PI에서: 위 subscribe로 받음
```

### AT-03: 정상 모드 agent 동작
```bash
# config-agent가 localhost에서 명령 수신
curl POST /api/config-deploy/lgw-pilot01/identity -d '{"name":"lgw-test02"}'
# 12초 후 PI hostname 변경 (config-agent가 localhost broker로부터 명령 받았음을 입증)
```

### AT-04: 단절 시 GPIO 직접 제어 (★ 본 사이클 핵심)
```bash
# 1) 서버 mosquitto stop
brew services stop mosquitto

# 2) PI에서 모든 agent 정상 동작 유지 (localhost broker는 active)
ssh PI "systemctl is-active config-agent gpio-agent fallback-engine zigbee2mqtt"

# 3) heartbeat 60s 이후 fallback 진입
# 4) fallback-engine.publish(emergency-stop) → mosquitto localhost
#    → gpio-agent.subscribe → BCM 핀 OFF
# 5) GPIO 핀 측정 (gpio readall 또는 /sys/class/gpio) — 실제 OFF 확인

# 6) 서버 mosquitto 재시작
brew services start mosquitto

# 7) bridge 자동 재연결 (10s restart_timeout) → server 모드 복귀
```

### AT-05: lgw-dev 영향 0
```bash
# lgw-dev는 mosquitto + bridge 안 깔린 상태로 외부 broker 직접 사용
# 본 사이클 변경 후에도 lgw-dev 정상 동작 확인
```

---

## 6. 핵심 위험 + 완화

| 위험 | 완화 |
|---|---|
| Bridge 토픽 무한 루프 | `try_private false` + 단방향 검증 |
| Persistence file 손상 → mosquitto 재시작 실패 | `/var/lib/mosquitto/`를 매 부팅 시 검증 (corruption 발견 시 자동 정리) |
| 메모리 증가 (Pi 3B 1GB RAM) | mosquitto ~20MB, max_queued_messages 5000으로 제한 |
| 외부 broker authentication 추가 시 bridge 인증 누락 | bridge에 username/password 옵션 추가 가능 (별도 사이클) |
| Z2M이 retained 메시지 손실 (cleansession true) | retained 토픽은 별도 retention 정책 → Z2M 메시지는 stateful이라 영향 분석 필요 |

---

## 7. 데이터 모델 변경

**변경 없음**. 모든 변경은 PI 측 설정 파일 + agent env.

---

## 8. 회귀 영향

- lgw-dev: 변경 없음 (mosquitto 미설치 상태 유지)
- lgw-pilot01: agent env 변경으로 localhost broker 사용. 기존 자동화 룰/장치 영향 0
- 백엔드: 변경 없음 (서버 mosquitto 그대로 사용)
- 다른 PI: 골든 이미지 재빌드 전에는 영향 없음

---

## 9. Open Question (Design 결정 필요)

- **Phase 2(골든 이미지 재빌드)를 본 사이클에 포함?** — 본 design에서는 분리 권장 (Phase 1만 완수)
- **bridge address를 IP로 고정 vs FQDN으로?** — 본 design은 IP 사용 (server-ip 배포로 변경 가능)
- **Z2M retained 메시지 영향** — Phase 1 검증에서 측정. 영향 크면 별도 정책
