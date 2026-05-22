---
template: plan
version: 1.2
feature: rpi-golden-image-mass-production
date: 2026-05-22
author: ohgane
project: smart-farm-mqtt
status: Draft
---

# rpi-golden-image-mass-production Planning Document

> **Summary**: `golden-lgw-v20260521.img.xz` 골든 이미지를 신규 SD 카드에 복제 → 신규 PI 부팅 → 자동 등록(reverse tunnel + gateway-id) → ConfigDeploy 페이지에서 4종 원격 설정 배포(Wi-Fi/hostname/gateway-id/server-ip) → 장치(Device) 및 자동화 룰(Automation Rule) 등록 → 서버↔PI 단절 시 RPi 자체 이머전시 페일오버(rpi-emergency-failover) 실제 동작까지 검증하는 **End-to-End 양산 검증 사이클**.
>
> **Project**: smart-farm-mqtt
> **Date**: 2026-05-22
> **Status**: Draft
> **Related**:
> - 이전 사이클 산출: [rpi-golden-image-system](../../archive/2026-05/rpi-golden-image-system/rpi-golden-image-system.report.md) (Match Rate 99%)
> - 이머전시 로직: [rpi-emergency-failover](../../archive/2026-05/rpi-emergency-failover/rpi-emergency-failover.report.md) (Match Rate 98%)
> - 골든 이미지 아카이브: `~/Projects/golden-images/golden-lgw-v20260521.img.xz` (806MB)

---

## 1. Overview

### 1.1 Purpose

지금까지 PDCA 사이클로 (1) 골든 이미지 시스템, (2) 이머전시 페일오버 로직, (3) 원격 설정 배포 시스템을 각각 완성하였다. 그러나 **세 시스템이 결합된 end-to-end 양산 시나리오는 아직 한 번도 통합 검증되지 않았다**. 본 사이클은 단일 PI를 "출하 직전 골든 SD" 단계부터 "현장에서 자율 동작하는 이머전시 페일오버 노드"까지 한 번에 검증하여, 신규 농장에 PI를 보낼 때 무방문 운영이 실제로 성립함을 확인한다.

### 1.2 Background

- 골든 이미지 v20260521에는 first-boot-init 데드락 수정 패치가 들어 있어 이론적으로는 dd 복제 + 부팅만으로 자동 등록까지 도달해야 한다. **그러나 마스터 PI에서만 검증했고, 새 SD 카드 + 새 PI 조합으로는 미검증.**
- ConfigDeploy 페이지의 4종 설정 배포는 단위 테스트는 통과했지만 **부팅 직후 신규 PI에 대해 실제로 hostname/Wi-Fi/server-ip를 바꿔 보는 실기 테스트 누락.**
- 장치/룰 등록 후 fallback-engine이 서버 단절 상황에서 실제로 동작하는 것을 본 적이 없음 (rpi-emergency-failover 사이클은 코드 검증만, MQTT 토픽 단절 시뮬레이션 위주).
- 한 사이클로 묶어야 "농장 출하 → 현장 부팅 → 본부 원격 셋업 → 자율 운영" 시나리오가 처음부터 끝까지 작동함을 입증할 수 있다.

### 1.3 Related Documents

- 골든 이미지 산출: `~/Projects/golden-images/golden-lgw-v20260521.{img.xz,json,sha256}`
- 이머전시 페일오버 구현: `raspberry-pi/fallback-engine/` (9 모듈), `backend/src/modules/fallback-config/`
- 원격 배포 구현: `backend/src/modules/config-deploy/`, `frontend/src/views/ConfigDeploy.vue`
- 컨벤션: [CLAUDE.md](../../../CLAUDE.md)

---

## 2. Scope

### 2.1 In Scope

- [ ] **단계 A — 골든 이미지 복제**: 새 SD 카드(32GB 이상)에 `golden-lgw-v20260521.img.xz` dd 복제 + SHA-256 검증
- [ ] **단계 B — 신규 PI 첫 부팅**: 본부 Wi-Fi 자동 연결 → first-boot-init 자동 실행 → 서버 자동 등록 (HTTP 200 + tunnel.env 작성)
- [ ] **단계 C — 자동 활성화 검증**: reverse-ssh-tunnel / config-agent / gpio-agent / zigbee2mqtt / fallback-engine 모두 active
- [ ] **단계 D — 웹UI 인지 검증**: GatewayManagement 페이지에서 신규 게이트웨이가 online으로 표시 + tunnel_port/machine_id/rpi_ip 정상 표시
- [ ] **단계 E — 4종 원격 설정 배포**:
  - [ ] hostname 배포 (`lgw-test-farm01` 등 의미 있는 이름)
  - [ ] gateway-id 배포 (hostname과 동기화)
  - [ ] Wi-Fi 배포 (대체 SSID 등록 + 재부팅 없이 nmcli 활성화 결과 확인)
  - [ ] server-ip 배포 (dev 서버 → 다른 dev 서버 IP로 일시 전환 후 복원, tunnel 자동 재연결)
- [ ] **단계 F — 장치 등록**: GPIO 릴레이 채널 매핑(8CH 또는 12CH), Zigbee 센서 페어링(센서 1-2종 임의 장치), 그룹 생성
- [ ] **단계 G — 자동화 룰 등록**: 관수 시간 기반 룰 1건 + 환기 센서 기반 룰 1건 + 개폐기 빗물 override 룰 1건
- [ ] **단계 H — 이머전시 페일오버 실기 검증**:
  - [ ] 정상 모드: 서버 자동화 룰이 PI로 명령 정상 도달
  - [ ] MQTT 단절 시뮬레이션: 서버측 MQTT 브로커 stop 또는 PI eth0 down → 5분 후 PI가 fallback 모드 진입
  - [ ] fallback 모드 동작: 관수 30분 timeout, 액비 즉시 OFF, 환기팬 35/28°C 히스테리시스, 개폐기 월별 스케줄, 빗물 ACTIVE → 즉시 CLOSE
  - [ ] 복귀 모드: MQTT 재연결 → 30초 recovery grace → 서버 모드 복귀 + 이벤트 큐 flush
- [ ] **단계 I — 회귀 영향 검증**: 기존 운영 중인 `lgw-dev` PI는 영향 없음(룰 충돌/포트 충돌/topic 충돌 없음) 확인
- [ ] **단계 J — 상시 운영 전환**: `lgw-pilot01`을 `lgw-dev`와 함께 운영 게이트웨이 #2로 유지(DB 레코드 보존, 활동 로그 모니터링 등록). 차기 양산 검증은 새 SD 카드를 추가 사용

### 2.2 Out of Scope

- 신규 골든 이미지 빌드 (v20260521 그대로 사용. 패치 발생 시 별도 사이클)
- 프로덕션 서버(175.206.245.234) 전환 (개발 서버 기준 검증, 프로덕션 배포는 별도)
- 실제 농장 현장 방문 검증 (사무실 환경에서 본부 Wi-Fi + 더미 센서/릴레이로 시뮬레이션)
- 다중 PI 동시 양산 (N대 동시 검증은 1대 성공 후 별도 사이클 — `rpi-multi-gateway-pilot`)
- Wi-Fi 본부→농장 SSID 전환 자동화 (현행 정책상 단순 적용 + 결과 보고만)

---

## 3. Requirements

### 3.1 Functional Requirements

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-01 | 새 SD 카드(32GB)에 골든 이미지 복제 후 첫 부팅이 30분 안에 reverse-ssh-tunnel active까지 도달 | High | Pending |
| FR-02 | 서버 DB에 신규 게이트웨이 자동 등록 (machine_id, tunnel_port 자동 부여, rpi_ip 기록) | High | Pending |
| FR-03 | ConfigDeploy 페이지에서 4종 설정 모두 배포 성공 + 적용 결과 응답 수신 | High | Pending |
| FR-04 | Wi-Fi 배포: 본부 SSID 그대로 + 가짜 백업 SSID 추가, nmcli connection 추가 결과 확인 (재부팅 없이) | High | Pending |
| FR-05 | server-ip 배포: 임시 다른 dev IP 배포 → tunnel 끊김/재연결 → 원복 → tunnel 복원 (서비스별 영향 0) | High | Pending |
| FR-06 | 장치 등록: GPIO 릴레이 + Zigbee 센서 페어링 + 그룹 생성 + 채널 매핑 (정상 ON/OFF 제어) | High | Pending |
| FR-07 | 자동화 룰 3건 등록 + 정상 모드에서 룰 실행 확인 (관수/환기/개폐기) | High | Pending |
| FR-08 | MQTT 단절 시뮬레이션 후 PI가 정확히 5분 후 fallback 모드 진입 | High | Pending |
| FR-09 | fallback 모드에서 12개 안전 정책 (관수 30분 timeout, 액비 즉시 OFF 등) 실제 동작 | High | Pending |
| FR-10 | MQTT 재연결 후 30초 recovery grace 통과 → server 모드 복귀 + 이벤트 큐 flush | High | Pending |
| FR-11 | 기존 `lgw-dev` 게이트웨이 동작에 영향 없음 (포트/룰/토픽 충돌 zero) | High | Pending |
| FR-12 | 검증 시나리오 전체를 활동 로그(activity_logs)로 추적 가능 | Medium | Pending |

### 3.2 Non-Functional Requirements

| Category | Criteria | Measurement Method |
|----------|----------|-------------------|
| 자동화 시간 | 새 SD 카드 부팅 → reverse tunnel active < 5분 | `systemctl status` timestamp 비교 |
| 신뢰성 | 4종 설정 배포 성공률 100% (재시도 포함) | ConfigDeploy 응답 토스트 + 활동 로그 |
| 페일오버 정확성 | 단절 후 진입 5±0.5분, 복귀 후 30±5초 | `journalctl -u fallback-engine` + 이벤트 DB |
| 회귀 영향 | 기존 lgw-dev MQTT 메시지 수신 영향 0건 | broker subscription count + lgw-dev 활동 로그 |

---

## 4. Success Criteria

### 4.1 Definition of Done

- [ ] FR-01 ~ FR-12 모두 PASS
- [ ] 검증 결과를 `docs/03-analysis/rpi-golden-image-mass-production.analysis.md` 에 단계별로 기록
- [ ] 이머전시 페일오버 진입/이탈 시점의 활동 로그 + fallback-engine 로그 캡처 첨부
- [ ] 4종 설정 배포 각각의 ConfigDeploy 응답 페이로드(JSON) 캡처
- [ ] Match Rate ≥ 95% 도달
- [ ] 검증 결과를 토대로 양산 운영 절차서 초안(`docs/05-operation/rpi-mass-production-runbook.md` — 별도 작성) 항목 도출

### 4.2 Acceptance Test

| AT-ID | Scenario | Expected |
|---|---|---|
| AT-01 | 새 SD에 dd 복제 + PI 부팅 | 5분 내 reverse-tunnel active + DB 신규 레코드 |
| AT-02 | ConfigDeploy에서 hostname 변경 | PI hostname 변경 + Z2M base_topic 동기화 |
| AT-03 | 장치 등록 + 자동화 룰 1건 트리거 | 서버 → MQTT → GPIO 릴레이 ON 확인 |
| AT-04 | MQTT broker stop (서버측) → 5분 대기 | PI fallback mode 진입 + 이벤트 기록 |
| AT-05 | fallback 모드에서 빗물 ACTIVE 신호 | 개폐기 즉시 CLOSE (서버 룰 무관) |
| AT-06 | MQTT broker 재시작 → 30초 대기 | server mode 복귀 + 큐 이벤트 flush |
| AT-07 | 기존 lgw-dev 동작 확인 | 위 시나리오 진행 중 lgw-dev에 명령/오류 0건 |

---

## 5. 검증 시나리오 절차 (개략)

```
[준비]
  맥에서 새 SD 카드 연결 (32GB+)
  ↓
[단계 A] xz -dc golden-lgw-v20260521.img.xz | sudo dd of=/dev/rdiskN bs=4m
  ↓
[단계 B] 새 PI에 SD 삽입 + 전원 ON
  ↓
  (자동) Wi-Fi 연결 → first-boot-init 18~30초 실행
  ↓
[단계 C] systemctl is-active reverse-ssh-tunnel / config-agent / gpio-agent / zigbee2mqtt / fallback-engine
  ↓
[단계 D] 웹UI GatewayManagement 페이지에서 신규 게이트웨이 카드 확인
  ↓
[단계 E] ConfigDeploy 페이지 → hostname / gateway-id / Wi-Fi / server-ip 4종 배포
  ↓
[단계 F] Devices 페이지에서 GPIO 채널 매핑 + Zigbee 페어링 + 그룹 생성
  ↓
[단계 G] Automation 페이지에서 룰 3건 등록 + 트리거 확인
  ↓
[단계 H1] 서버에서 mosquitto stop
  ↓
  ~5분 대기 → PI fallback 모드 진입 확인 (fallback_events 테이블 + PI journalctl)
  ↓
[단계 H2] fallback 모드에서 각 시나리오 트리거 (관수 timeout, 빗물, 환기 등)
  ↓
[단계 H3] mosquitto start → 30초 대기 → server 모드 복귀 확인
  ↓
[단계 I] lgw-dev 활동 로그 + DB 이벤트 영향 0 확인
  ↓
[단계 J] lgw-pilot01을 운영 게이트웨이 #2로 유지 (DB/keys/모니터링 유지)
```

---

## 6. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|:------:|-----------|
| 새 SD 카드 품질 문제로 dd 실패 | High | SHA-256 검증 후 진행, 대체 SD 1개 사전 준비 |
| 본부 Wi-Fi DHCP 임대 풀 부족으로 IP 미할당 | Medium | eth0 static 192.168.0.100 경로로 fallback, 라우터 임대 풀 확장 |
| 서버 register-tunnel-key API가 다중 신규 PI에 대해 race condition | Low | 1대씩 순차 검증, 동시 양산은 별도 사이클 |
| ConfigDeploy로 server-ip 변경 시 tunnel 끊김 후 재연결 실패 | Medium | 변경 전 현재 IP를 PI 측에 백업, 복구 시 eth0 직결 진단 절차 준비 |
| Zigbee dongle 페어링 모드 진입 실패 | Medium | zigbee2mqtt MQTT bridge 명령으로 permit-join 토글 |
| mosquitto stop 시 lgw-dev도 같이 단절되어 검증 오염 | High | lgw-dev 영향 측정 항목을 H 단계 사전/사후 비교로 차분 측정 |
| fallback 모드 진입이 5분이 아닌 다른 시간 (코드와 다름) | Low | 코드 상수와 실제 측정값 비교, 차이 시 코드 수정 별도 사이클 |

---

## 7. 산출물

- 검증 결과 분석서 (`docs/03-analysis/rpi-golden-image-mass-production.analysis.md`)
- 운영 절차서 초안 (`docs/05-operation/rpi-mass-production-runbook.md`)
- 페일오버 진입/이탈 시점 로그 캡처 (`docs/evidence/`)
- 4종 설정 배포 응답 페이로드 캡처
- 신규 게이트웨이 활동 로그 export

---

## 8. 일정 추정

| 단계 | 소요 |
|---|---|
| 준비 + 단계 A (SD 복제) | 30분 |
| 단계 B~D (부팅 + 자동 등록 검증) | 30분 |
| 단계 E (4종 설정 배포) | 1시간 |
| 단계 F~G (장치/룰 등록) | 1시간 |
| 단계 H (페일오버 검증, 진입/이탈 + 시나리오 4종) | 1.5시간 |
| 단계 I~J (회귀 + 정리) | 30분 |
| 분석서 작성 + 보고 | 1시간 |
| **합계** | **약 6시간 (1일 작업)** |

---

## 9. 결정 사항 (2026-05-22)

| 항목 | 결정 | 근거 |
|---|---|---|
| **Wi-Fi 배포 검증** | 본부 SSID(`KT_GiGA_5G_5E04`)와 **동일** 객체로 재등록 | apply-wifi.sh의 멱등성(idempotency) 검증이 우선 — 동일 SSID 재배포 시 nmcli connection 중복/덮어쓰기 거동 확인 |
| **server-ip 배포 검증** | ping 가능한 임의 LAN 호스트 IP(예: `172.30.1.254` 라우터)로 일시 변경 → 5분 후 원복(`172.30.1.42`) | tunnel은 끊기되 PI는 살아있음 → 자동 재연결 시점/실패 시 eth0 fallback 경로 검증 가능 |
| **운영 hostname** | `lgw-pilot01` | 파일럿 단계 명시, 검증 통과 시 그대로 운영 전환 가능 (재배포 불필요) |
| **검증 종료 후** | `lgw-dev`와 함께 **상시 운영 전환** | 양산 파이프라인 검증 재테스트 시에는 새 SD 카드를 추가로 사용 — 이 PI는 운영 게이트웨이 #2로 유지 |
