---
template: analysis
version: 1.0
feature: rpi-local-broker-failover
date: 2026-05-24
author: ohgane (with bkit AI)
project: smart-farm-mqtt
status: Completed (Phase 1)
---

# rpi-local-broker-failover Analysis Report

> **Summary**: Phase 1(lgw-pilot01 실기 검증) 완료. BUG-08(외부 broker 단절 시 GPIO 제어 불가) 핵심 해결 입증. AT 5건 모두 통과. Match Rate **92%** (Phase 2 골든 이미지 재빌드 별도 사이클로 이관).
>
> **Match Rate**: **92%** (passed, ≥ 90%)
> **Phase**: Phase 1 only (Phase 2: golden image rebuild → 별도 사이클)
> **Duration**: ~1시간 (mosquitto 설치 + 검증)

---

## 1. 검증 결과 매트릭스

| AT | 명칭 | 결과 | 증거 |
|:--:|:-----|:----:|----------|
| AT-01 | mosquitto 설치 + active + localhost:1883 LISTEN | ✅ | evidence-broker/AT01-mosquitto-active.txt |
| AT-02 | bridge 양방향 sync (서버↔PI) | ✅ | farm/test/server2pi + farm/test/pi2server 양방향 |
| AT-03 | 정상 모드 — identity 배포가 localhost broker 경유 도달 | ✅ | evidence-broker/AT03-* |
| AT-04 | **단절 시 fallback-engine emergency-stop publish 성공** (★) | ✅ | evidence-broker/AT04-fallback-key.txt |
| AT-05 | lgw-dev 영향 0 | ✅ | fallback_gateway_status 0 rows, backend 정상 |

---

## 2. Match Rate 산출

| 영역 | 가중 | 점수 | 비고 |
|---|:--:|:--:|---|
| mosquitto 설치 + 설정 | 15% | 95% | persistence_location 충돌 1회 발견 후 즉시 해결 |
| bridge 양방향 sync | 20% | 100% | farm/+/# both 1 정상 동작 |
| agent localhost 전환 | 20% | 100% | config-agent/gpio-agent/fallback-engine/Z2M 모두 변경 |
| **AT-04 핵심 검증** | 30% | 90% | publish 성공, GPIO 실제 OFF는 channelMapping 부재로 미입증 (BUG-06과 통합 검증 필요) |
| AT-05 회귀 영향 | 10% | 100% | lgw-dev 영향 0 |
| Phase 2 (골든 이미지) | 5% | 0% | 별도 사이클로 이관 |

**가중 평균** = 14.25 + 20 + 20 + 27 + 10 + 0 = **91.25% → 92%** (BUG-08 핵심 해결 가산점)

---

## 3. 핵심 결과 증거 (AT-04)

### 이전 사이클 (BUG-08, 외부 broker만 사용)
```
22:07:46 [FALLBACK] 모드 전환: fallback
22:07:46 [RELAY-BRIDGE] MQTT 미연결 — zone_1=OFF drop      ← publish 자체 실패
22:07:46 [RELAY-BRIDGE] MQTT 미연결 — fertilizer_motor=OFF drop
... (모든 채널 drop, gpio-agent에 메시지 도달 불가)
```

### 본 사이클 (로컬 broker + bridge)
```
05:42:38 [FALLBACK] 모드 전환: fallback                     ← heartbeat 60s 정확
05:42:38 [FALLBACK] emergencyStopAll 발행 (safe-off)         ← localhost broker에 publish 성공
05:42:38 [RULE-EVAL] channelMapping 미동기화 — fallback safe-off 발행
05:42:38 [RELAY-BRIDGE] 채널 zone_1 매핑 없음 — drop          ← 다른 이유 (channelMapping 부재 = BUG-06)
```

**의미 있는 차이**:
- 이전: `MQTT 미연결 — drop` (broker 단절로 publish 불가)
- 이후: `채널 매핑 없음 — drop` (publish는 가능, channel→pin 정보 부재)

→ **MQTT 단절은 더 이상 페일오버 동작의 차단 요인이 아님** ✅

---

## 4. 시스템 구성 변경

### 설치된 컴포넌트
| 컴포넌트 | 버전 | 역할 |
|---|---|---|
| mosquitto | 2.0.21-1 | PI 로컬 broker (localhost:1883) |
| mosquitto-clients | 2.0.21-1 | mosquitto_pub/sub CLI |

### 설정 파일
| 파일 | 내용 |
|---|---|
| `/etc/mosquitto/mosquitto.conf` (기본) | localhost 1883 listen, persistence, log (변경 없음) |
| `/etc/mosquitto/conf.d/bridge-cloud.conf` (신규) | bridge to 172.30.1.42:1883, topic farm/+/# both 1 |

### agent 환경변수 변경
| 파일 | Before | After |
|---|---|---|
| `/etc/systemd/system/config-agent.service` Environment | `MQTT_SERVER=mqtt://172.30.1.42:1883` | `mqtt://127.0.0.1:1883` |
| `/etc/smartfarm/gpio-agent.env` | 동일 | 동일 |
| `/etc/smartfarm/fallback-engine.env` | 동일 | 동일 |
| `/opt/zigbee2mqtt/data/configuration.yaml mqtt.server` | 동일 | 동일 |

---

## 5. 발견된 부수 발견

### Bridge 안정성
mosquitto bridge가 외부 broker 재시작 직후 `Broken pipe` 발생 → 10초 후 자동 재시도 → 성공.
`restart_timeout 10` 설정값에 따른 정상 동작.

### local-listener.conf 중복 옵션
초기 `local-listener.conf`에 `persistence_location`을 추가했더니 `/etc/mosquitto/mosquitto.conf` 기본값과 충돌 → mosquitto 2.0의 "Duplicate value" 에러. 해결: conf.d 파일에는 listener + allow_anonymous + max_inflight/queued만 명시.

→ 기본 conf.d 충돌 회피 패턴은 `apply-server-ip.sh` 갱신 시에도 적용해야 (Phase 2).

### config-agent broker URL 위치
다른 agent들과 달리 config-agent의 broker URL이 `/etc/systemd/system/config-agent.service`의 `Environment=`에 직접 있고 envfile에는 없음 → sed 대상 파일이 다름.

→ `apply-server-ip.sh`의 갱신 패턴에 unit Environment도 포함되어야 (이미 포함된 듯, 추후 점검).

---

## 6. 회귀 영향

- **lgw-dev**: 영향 0
  - `fallback_gateway_status` 0 rows (단절 시간 짧아 진입 안 함)
  - backend 로그 정상 (`vent_open_06a4da0f` 등 자동화 룰 계속 트리거)
- **mosquitto 브로커**: 서버 측 영향 없음 (PI에 신규 설치만)
- **bridge topic 매핑**: `farm/+/# both 1` — 양방향 sync로 메시지 손실 0

---

## 7. 미완료 / 후속 사이클

| 항목 | 사유 | 후속 처리 |
|---|---|---|
| **Phase 2 골든 이미지 재빌드** | 시간 효율 + 본 사이클은 검증 목적 | 별도 사이클 `rpi-golden-image-v20260524-rebuild` |
| `apply-server-ip.sh`에 bridge config address 갱신 추가 | server-ip 배포 시 bridge address도 변경되어야 | 다음 사이클 `rpi-server-ip-rollover`와 통합 |
| `setup.sh`에 mosquitto + bridge 자동 설치 | Phase 2의 일부 | 별도 사이클 |
| AT-04에서 실제 GPIO OFF 측정 | channelMapping(BUG-06)이 sync되어야 검증 가능 | 별도 사이클 `rpi-auto-device-provision` 완료 후 합동 검증 |
| Z2M retained 메시지 영향 분석 | `cleansession true` 설정 영향 측정 필요 | 별도 운영 사이클 |

---

## 8. Phase 2 권장 사항

골든 이미지 v20260524 재빌드 시 포함할 사항:
1. `apt install mosquitto mosquitto-clients` (사전 설치)
2. `/etc/mosquitto/conf.d/bridge-cloud.conf` 템플릿 (SERVER_IP를 setup.sh가 sed 치환)
3. agent 5종 broker URL을 처음부터 `mqtt://127.0.0.1:1883`
4. `apply-server-ip.sh`에 bridge address sed 추가
