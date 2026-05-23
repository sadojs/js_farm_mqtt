---
template: plan
version: 1.2
feature: rpi-local-broker-failover
date: 2026-05-23
author: ohgane
project: smart-farm-mqtt
status: Draft
---

# rpi-local-broker-failover Planning Document

> **Summary**: 양산 검증에서 발견된 가장 큰 결함(BUG-08)을 해결. **외부 MQTT 단절 시 PI가 자율적으로 GPIO 직접 제어**할 수 있도록 PI에 로컬 mosquitto broker 추가. 페일오버의 핵심 가치인 "단절 시 안전 동작 실행"을 실제로 가능하게 만드는 큰 변경.
>
> **Project**: smart-farm-mqtt
> **Date**: 2026-05-23
> **Status**: Draft
> **Priority**: HIGH — 페일오버 설계 미흡 해소

---

## 1. Overview

### 1.1 Purpose
양산 검증 단계 H에서 입증: MQTT broker 단절 시 fallback-engine은 모드 전환 + safety_off 이벤트는 publish 시도하지만 **MQTT 미연결 → drop**. relay-bridge가 gpio-agent에 MQTT publish 방식으로 명령을 보내는 구조라 외부 broker 끊김 시 PI 내부에서도 명령 전달 실패.

```
22:07:46 [FALLBACK] 모드 전환: fallback
22:07:46 [RELAY-BRIDGE] MQTT 미연결 — zone_1=OFF drop
22:07:46 [RELAY-BRIDGE] MQTT 미연결 — fertilizer_motor=OFF drop
... (모든 채널 drop)
```

→ **페일오버 진입은 되지만 실제 GPIO 제어 안 됨**

### 1.2 Background
- 현재 모든 agent가 외부 broker(172.30.1.42:1883)만 사용
- CLAUDE.md에는 PI 측 mosquitto가 "옵션"으로 표기되어 있지만 실제로는 설치 안 되어 있음
- 페일오버의 본질이 "단절 시 자율 동작"인데 단절 시 동작 불가

### 1.3 Related
- [BUG-08](../../evidence/BUGS-found.md#bug-08)
- 양산 검증 evidence: `docs/evidence/H1-fb-enter.log`
- 영향 시스템: fallback-engine, gpio-agent, config-agent, Z2M 모두 broker 변경 영향

---

## 2. Scope

### 2.1 In Scope
- [ ] **FR-01**: 골든 이미지에 mosquitto 패키지 사전 설치 + listener 1883 (localhost only)
- [ ] **FR-02**: 외부 broker 단절 감지 시 PI 측 agent들이 자동으로 로컬 broker로 fallback (또는 항상 로컬 broker를 1차로 사용 + 외부 broker는 bridge)
- [ ] **FR-03**: mosquitto bridge 설정 — 정상 상태: 로컬 broker ↔ 외부 broker 양방향 동기화 (mosquitto.conf bridge 기능)
- [ ] **FR-04**: fallback-engine + gpio-agent + config-agent + zigbee2mqtt가 모두 `mqtt://localhost:1883` 사용
- [ ] **FR-05**: 단절 시뮬레이션 재검증: 외부 broker stop → PI 측 로컬 broker로 fallback-engine의 emergency-stop이 gpio-agent에 전달 → 실제 GPIO OFF
- [ ] **FR-06**: 복귀 시뮬레이션: 외부 broker start → bridge가 자동 재연결 + retained 메시지 동기화

### 2.2 Out of Scope
- 로컬 broker 인증/TLS (운영 시 보안 강화는 별도 사이클)
- 다중 PI 간 mesh broker (단일 PI 자율성만)
- 메시지 큐잉 영구 저장 (재부팅 후 손실 허용)

---

## 3. Requirements

### 3.1 FR

| ID | Requirement | Priority | Status |
|----|---|---|---|
| FR-01 | 골든 이미지에 mosquitto + 자동 시작 | High | Pending |
| FR-02 | agent 5종(fallback/gpio/config/Z2M/MQTT) localhost broker 사용 | High | Pending |
| FR-03 | mosquitto bridge 설정 (외부 broker 양방향) | High | Pending |
| FR-04 | 외부 broker 단절 시 로컬 fallback 자동 동작 | High | Pending |
| FR-05 | 외부 broker 복귀 시 bridge 자동 재연결 | High | Pending |
| FR-06 | 단절 중 PI 측 GPIO emergency-stop 실제 동작 입증 | **Critical** | Pending |

### 3.2 NFR

| 항목 | 기준 |
|---|---|
| 단절 시 GPIO 응답 시간 | < 1초 (로컬 broker 경유) |
| Bridge 복귀 시간 | < 30초 |
| 메모리 오버헤드 | < 20MB (mosquitto + bridge) |
| 양산 호환 | 기존 골든 이미지 v20260521 + 패치 또는 v20260523 빌드 |

---

## 4. Success Criteria

### 4.1 DoD
- [ ] 골든 이미지 신규 빌드 또는 v20260521 + 패치 스크립트
- [ ] 단절 시뮬레이션 H 단계 재실행 → safety_off가 실제 GPIO OFF로 적용 (로그 + GPIO 핀 측정)
- [ ] 복귀 시 retained 메시지 손실 0
- [ ] Match Rate ≥ 90%
- [ ] 양산 검증 사이클의 BUG-08 항목 closed

### 4.2 AT
- AT-01: 골든 이미지 부팅 → mosquitto active + listener 1883 OK
- AT-02: bridge 설정 정상 — `mosquitto_sub -h localhost -t farm/+/+/+ -v` 시 외부 broker 메시지도 보임
- AT-03: 외부 broker stop → PI 측 모든 agent 정상 동작 유지 (`mqtt://localhost:1883`)
- AT-04: fallback 진입 + emergency-stop 명령 → 1초 내 GPIO 핀 OFF 측정 (oscilloscope 또는 echo로 핀 상태 검증)
- AT-05: 외부 broker start → bridge 30초 내 reconnect
- AT-06: lgw-dev 영향 0 (외부 broker만 쓰는 게이트웨이는 그대로)

---

## 5. Implementation Sketch

### Pi 측
1. `apt install mosquitto mosquitto-clients` (골든 이미지에 사전 포함)
2. `/etc/mosquitto/conf.d/local-listener.conf`:
   ```
   listener 1883 127.0.0.1
   allow_anonymous true   # 로컬 only
   persistence true
   persistence_location /var/lib/mosquitto/
   ```
3. `/etc/mosquitto/conf.d/bridge-cloud.conf`:
   ```
   connection cloud-broker
   address 172.30.1.42:1883
   topic farm/+/# both 1
   bridge_protocol_version mqttv311
   try_private false
   start_type automatic
   ```
4. 각 agent의 MQTT_BROKER env 변경: `mqtt://172.30.1.42:1883` → `mqtt://localhost:1883`

### apply-server-ip.sh 갱신
- server-ip 변경 시 bridge config의 address도 갱신
- 또는 bridge는 별도 변수로 분리

### 골든 이미지 빌드
- 본부 PI에 패치 적용 → fstrim → dd 추출 → 신규 v20260523 빌드

---

## 6. Risks

| Risk | Mitigation |
|---|---|
| 로컬 broker 추가로 메모리 사용 증가 | Pi 3B 1GB RAM 환경에서 mosquitto ≤ 20MB → 영향 미미 |
| Bridge 토픽 매핑 오류로 메시지 loop/loss | `try_private false` + topic both 1 명시. 단위 테스트 |
| 외부 broker 복귀 시 retained 메시지 충돌 | 운영 정책: 외부 broker가 진실 (`out` 방향 우선) |
| 기존 게이트웨이 영향 (즉시 마이그레이션 시) | 단계별 rollout: 신규 PI부터 적용, lgw-dev/lgw-pilot01은 별도 결정 |
| 단순 변경처럼 보이지만 architecture 변경 | Design 단계 자세히 + lgw-dev에는 영향 안 미치는 것 명시 |

---

## 7. Estimated Effort

- mosquitto 설치 + bridge 설정: 2시간
- agent 5종 env/code 갱신: 2시간
- 골든 이미지 신규 빌드: 1시간
- 검증 (단절 + GPIO 실측): 2시간
- 회귀 (lgw-dev 영향 0): 1시간
- 총: **8시간 (1일+)**

---

## 8. Open Questions

- [ ] 로컬 broker는 항상 사용(권장)인가, 단절 감지 시만 fallback인가? (전자가 단순)
- [ ] Bridge 인증은? (현재 외부 broker가 anonymous라면 그대로, 향후 TLS 적용 시 별도 사이클)
- [ ] Z2M도 로컬 broker 사용 시 backend의 Z2M 메시지 수신 영향?
- [ ] lgw-dev/lgw-pilot01에는 언제 적용? (별도 결정 사이클 또는 골든 이미지 재복제)
