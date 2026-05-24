---
template: plan
version: 1.2
feature: rpi-server-ip-rollover
date: 2026-05-23
author: ohgane
project: smart-farm-mqtt
status: Draft
---

# rpi-server-ip-rollover Planning Document

> **Summary**: 양산 검증 사이클(`rpi-golden-image-mass-production`)에서 위험도로 SKIP한 **E-4 단계(server-ip 원격 배포)** 를 완료. dev 서버(172.30.1.42) ↔ 임시 IP(172.30.1.254) 변경 시 reverse-ssh-tunnel 끊김/재연결 + eth0 static 192.168.0.100 비상 복구 경로 모두 검증.
>
> **Project**: smart-farm-mqtt
> **Date**: 2026-05-23
> **Status**: Draft

---

## 1. Overview

### 1.1 Purpose
양산 검증에서 미완료된 E-4(server-ip) 검증을 격리된 환경에서 안전하게 수행. 핵심:
- 현장에서 dev → 프로덕션(175.206.245.234) 서버 전환 시 무방문 절차 검증
- 잘못된 IP 배포 시 eth0 직결 복구 절차 입증
- tunnel.env / config-agent.env / gpio-agent.env / fallback-engine.env / Z2M config 모든 server URL 동시 갱신 검증

### 1.2 Background
양산 검증에서 server-ip 배포는 다음 위험:
- 잘못된 IP 입력 시 PI ↔ 서버 연결 영구 끊김 가능
- reverse tunnel이 끊긴 상태에서는 원격 복구 명령도 불가능 → eth0 직결 필요
- 이전 사이클에서 design은 작성했으나 실기 테스트 SKIP

### 1.3 Related
- [rpi-golden-image-mass-production](../../archive/2026-05/rpi-golden-image-mass-production/) — E-4 미실시 항목
- [apply-server-ip.sh](../../../raspberry-pi/scripts/apply-server-ip.sh) — 변경 대상 스크립트
- [config-deploy.service](../../../backend/src/modules/config-deploy/config-deploy.service.ts) — POST `/api/config-deploy/:gw/server-ip`

---

## 2. Scope

### 2.1 In Scope
- [ ] **E-4-a 변경**: lgw-pilot01에 server-ip 172.30.1.42 → 172.30.1.254 배포
- [ ] **E-4-b 단절 확인**: 5분 내 tunnel.env, autossh 재연결, backend DB의 tunnelStatus = disconnected
- [ ] **eth0 fallback 검증**: PI eth0 192.168.0.100 케이블 직결로 SSH 접속 가능 확인 (또는 wifi IP 172.30.1.89 직접 ssh)
- [ ] **apply-server-ip.sh 사후 검증**: 갱신 대상 5종(tunnel.env, config-agent.env, gpio-agent.env, fallback-engine.env, Z2M MQTT URL) 모두 정확히 치환
- [ ] **E-4-c 복원**: 직접 SSH로 apply-server-ip.sh 172.30.1.42 실행 → 3분 내 tunnel 재연결, online 복귀
- [ ] **변경 추적**: 모든 변경 시점 activity_logs + tunnel reconnect 로그 캡처

### 2.2 Out of Scope
- 프로덕션 서버(175.206.245.234)로의 실제 전환 (별도 검증)
- 다중 게이트웨이 일괄 server-ip 배포

---

## 3. Requirements

### 3.1 FR

| ID | Requirement | Priority | Status |
|----|---|---|---|
| FR-01 | server-ip 배포로 5종 env/config 모두 동시 갱신 | High | Pending |
| FR-02 | 잘못된 IP(unreachable) 배포 후 5분 내 tunnel offline 표시 | High | Pending |
| FR-03 | 직접 SSH(eth0 또는 wifi LAN IP)로 복구 절차 입증 | High | Pending |
| FR-04 | 원복 후 3분 내 tunnel reconnect + DB tunnelStatus = connected | High | Pending |
| FR-05 | apply-server-ip.sh 갱신 대상에 fallback-engine.env 포함 여부 확인 (BUG-01 유사 패턴) | Medium | Pending |

---

## 4. Success Criteria

### 4.1 DoD
- [ ] E-4-a/b/c 모두 PASS
- [ ] apply-server-ip.sh 갱신 대상 누락 없음 (5개 파일)
- [ ] 운영 절차서(runbook)에 "잘못된 IP 배포 시 복구 절차" 명시 항목 추가
- [ ] Match Rate ≥ 90%

### 4.2 AT
- AT-01: ConfigDeploy 페이지에서 server-ip = 172.30.1.254 배포 → 5분 내 tunnel disconnected
- AT-02: 직접 SSH(172.30.1.89)로 apply-server-ip.sh 172.30.1.42 실행 → 3분 내 tunnel connected 복귀
- AT-03: 운영 중 lgw-dev 영향 0 (현재 tunnel 끊기지 않음)

---

## 5. Implementation Sketch

본 사이클은 검증 중심 (코드 변경 최소). 다만 검증 중 발견되는 누락은 즉시 fix:
- apply-server-ip.sh의 env 갱신 루프 (BUG-01 유사 점검)
- backend의 server-ip 배포 응답 핸들러 (DB UPDATE 누락 확인)

---

## 6. Risks

| Risk | Mitigation |
|---|---|
| 잘못된 IP로 tunnel 영구 끊김 | eth0 192.168.0.100 케이블 + 라우터 LAN 직접 접속으로 SSH 가능. 또한 wifi LAN IP(172.30.1.89)로도 접속 가능 (Wi-Fi는 끊기지 않음) |
| 5분 timeout 동안 lgw-pilot01 운영 중단 | 검증용 PI라 영향 0. 향후 실제 운영 게이트웨이 변경 시는 운영 시간대 회피 |
| autossh retry pattern으로 짧은 단절도 30분 영향 | autossh 설정 확인 + ServerAliveInterval=30 명시 |

---

## 7. Estimated Effort

- 사전 준비(eth0 케이블 + 라우터): 30분
- E-4-a/b/c 실기 검증: 1시간
- 발견된 BUG fix (예상 1-2건): 1시간
- runbook 항목 추가: 30분
- 총: **3시간**
