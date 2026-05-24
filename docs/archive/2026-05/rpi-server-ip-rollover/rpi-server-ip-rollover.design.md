# Design: rpi-server-ip-rollover

**Feature ID**: `rpi-server-ip-rollover`
**작성일**: 2026-05-24
**기반 문서**: [01-plan/features/rpi-server-ip-rollover.plan.md](../../01-plan/features/rpi-server-ip-rollover.plan.md)
**상태**: Design

---

## 1. 사전 분석: apply-server-ip.sh 갱신 대상

### 현재 (기존)
| # | 대상 | 비고 |
|:--:|---|---|
| 1 | `/etc/smartfarm/server-ip` | 마커 파일 |
| 2 | Z2M `configuration.yaml mqtt.server` | sed |
| 3 | `/etc/smartfarm/config-agent.env` MQTT_SERVER | sed |
| 4 | `/etc/smartfarm/gpio-agent.env` MQTT_SERVER | sed |
| 5 | `config-agent.service`, `gpio-agent.service` Environment | sed |
| 6 | `reverse-ssh-tunnel.service` SERVER_HOST | sed |
| 7 | `/etc/smartfarm/tunnel.env` 재작성 (POST register-tunnel-key) | curl |

### 누락 발견 (본 사이클 fix 대상)
| # | 누락 | 영향 | 사유 |
|:--:|---|---|---|
| **A** | `/etc/smartfarm/fallback-engine.env` MQTT_SERVER | fallback-engine이 옛 broker 사용 → 단절 시 동작 안 함 | BUG-01 유사 — fallback-engine.env가 갱신 루프에 누락 |
| **B** | `/etc/mosquitto/conf.d/bridge-cloud.conf` address | bridge가 옛 broker로 연결 시도 → 양방향 sync 실패 | #5 사이클에서 추가된 신규 파일, apply-server-ip.sh가 모름 |
| **C** | `fallback-engine.service` 재시작 | env 갱신해도 process가 이전 값 유지 | 재시작 목록에서 누락 |
| **D** | `mosquitto` 재시작 (bridge config reload) | bridge config 변경 후 reload 필요 | 누락 |

이 4개를 본 사이클 Do에서 추가 fix.

---

## 2. 검증 시나리오

### 검증 토폴로지
```
Mac (172.30.1.42) ─── 본부 Wi-Fi ─── lgw-pilot01 (172.30.1.89)
                          │                   │
                       Router               eth0 static
                    (172.30.1.254)         192.168.0.100
                                         (fallback path)
```

### AT 단계

#### AT-01: apply-server-ip.sh 갱신 대상 fix 검증
```bash
# 코드 변경 후 (Do-1):
grep "fallback-engine" raspberry-pi/scripts/apply-server-ip.sh
grep "bridge-cloud" raspberry-pi/scripts/apply-server-ip.sh
# Expected: 둘 다 grep hit
```

#### AT-02: server-ip 임시 변경 (lgw-pilot01: 172.30.1.42 → 172.30.1.254)
```bash
curl -X POST /api/config-deploy/lgw-pilot01/server-ip \
  -d '{"newServerIp": "172.30.1.254"}'
# Expected: HTTP 202
```

#### AT-03: 5종 env/config 모두 정확히 변경 (PI 직접 SSH로 확인)
- `/etc/smartfarm/server-ip` → `172.30.1.254`
- `config-agent.env`, `gpio-agent.env`, `fallback-engine.env` MQTT_SERVER → `mqtt://127.0.0.1:1883` (이번 PI는 localhost broker — 변경 안 됨)
- 정확히는 **broker URL은 localhost 유지**, **server-ip 자체만 변경** (PI는 mosquitto bridge로 외부 broker 접근)
- `/etc/mosquitto/conf.d/bridge-cloud.conf address` → `172.30.1.254:1883`
- `reverse-ssh-tunnel.service SERVER_HOST` → `172.30.1.254`

→ **재정의**: lgw-pilot01은 #5 사이클로 localhost broker 사용 중. server-ip 변경은 **bridge target + reverse tunnel target** 두 가지 변경만 의미.

#### AT-04: tunnel 끊김 확인 (5분 이내)
```bash
# Mac에서 22200 포트 LISTEN 끊김 확인
lsof -nP -iTCP:22200 -sTCP:LISTEN
# Expected: 5분 내 결과 사라짐 (autossh 재연결 실패)
```

#### AT-05: eth0/wifi 직접 SSH 회복 (tunnel 우회)
```bash
# Wifi LAN IP 직접 ssh — tunnel 우회
ssh -i ~/.ssh/id_rpi_lgw lgwadmin@172.30.1.89 "hostname; cat /etc/smartfarm/server-ip"
# Expected: 정상 접속, server-ip = 172.30.1.254
```

#### AT-06: 원복 (직접 SSH로 apply-server-ip.sh 호출 — tunnel 끊겼으므로)
```bash
ssh lgwadmin@172.30.1.89 "sudo /opt/smart-farm/scripts/apply-server-ip.sh 172.30.1.42"
# Expected: 정상 복원, 3분 내 tunnel 22200 LISTEN 복귀
```

#### AT-07: lgw-dev 영향 0
- 본 검증 동안 lgw-dev tunnel 22201 정상 유지

---

## 3. 위험 + 완화

| 위험 | 완화 |
|---|---|
| 잘못된 IP 변경 → tunnel 영구 끊김 | wifi LAN(172.30.1.89) 직접 SSH 경로 유지 (Wi-Fi 끊김 없음) |
| autossh 재연결 폭주 (잘못된 IP에 무한 시도) | `restart_timeout 10` + ServerAliveInterval=30 명시 |
| mosquitto bridge가 새 broker에 연결 실패 | bridge restart_timeout 10 → 운영 정상 |
| 5분 timeout 동안 자동화 룰 작동 안 함 | lgw-pilot01에 활성 룰 없음 (검증용 PI), 영향 없음 |
| fallback-engine.env 누락 fix 후 기존 PI(lgw-dev) 영향 | lgw-dev에 apply-server-ip.sh 직접 호출 안 됨 (선택적 도입) |

---

## 4. 구현 단계 (Do)

1. **apply-server-ip.sh 4가지 누락 fix** (코드 변경)
   - env 갱신 루프에 fallback-engine.env 추가
   - mosquitto bridge-cloud.conf address sed 추가
   - 재시작 목록에 fallback-engine, mosquitto 추가
2. **lgw-pilot01에 새 스크립트 배포**
3. **AT-01~07 순차 실행 + evidence 캡처**
4. **원복 + 정리**

---

## 5. 회귀 영향

- lgw-dev: 영향 0 (apply-server-ip.sh를 운영자가 명시적 호출 안 하는 한)
- lgw-pilot01: 5분 단절 → 원복 → 정상
- Mac mosquitto: 영향 0
- 백엔드: 영향 0
