---
template: plan
version: 1.2
feature: rpi-hostname-gateway-id-unify
date: 2026-05-23
author: ohgane
project: smart-farm-mqtt
status: Draft
---

# rpi-hostname-gateway-id-unify Planning Document

> **Summary**: ConfigDeploy 페이지에서 hostname/gateway-id를 **2번 클릭으로 분리 배포**해야 하는 현재 UX를 **1번 배포로 통합**하고, 두 값을 항상 동일하게 강제하는 invariant 도입. hostname 배포 시 gateway-id 자동 동기화 + 양산 검증 단계에서 발견된 양산 시 작업량 절감.
>
> **Project**: smart-farm-mqtt
> **Date**: 2026-05-23
> **Status**: Draft
> **Related**: [rpi-golden-image-mass-production](../../archive/2026-05/rpi-golden-image-mass-production/rpi-golden-image-mass-production.report.md)

---

## 1. Overview

### 1.1 Purpose
- 양산 시 사용자가 ConfigDeploy 페이지에서 hostname 배포 후 gateway-id 배포를 **잊거나 다른 값으로 잘못 배포**할 수 있음 → MQTT topic mismatch + DB ↔ PI 불일치
- 양산 검증(2026-05-22)에서 hostname=`lgw-pilot01`, gateway-id도 `lgw-pilot01`로 따로 배포해 일치시켰지만, 운영에서는 이 단계가 누락되기 쉬움

### 1.2 Background
- 현재 4종 분리 배포 중 hostname/gateway-id는 거의 항상 같은 값이어야 함:
  - hostname: 시스템 호스트명 (네트워크 식별)
  - gateway-id: MQTT topic prefix + DB 식별자 + 사용자 인지 ID
- 통상 둘은 동일 (예: `lgw-pilot01`). 다르게 둘 비즈니스 이유 없음
- 분리되어 있어 검증/운영 양쪽에서 작업량 + 오류 가능성 증가

### 1.3 Related
- [BUG-10 후보](../../evidence/BUGS-found.md) — 본 사이클의 동기
- 검증 산출: 양산 검증 단계 E-1/E-2 (hostname/gateway-id 분리 배포)

---

## 2. Scope

### 2.1 In Scope
- [ ] **FR-01**: `POST /api/config-deploy/:gatewayId/hostname` 응답 후 자동으로 동일 값으로 gateway-id cascade 수행 (옵션 플래그로 활성)
- [ ] **FR-02**: 또는 신규 통합 endpoint `POST /api/config-deploy/:gatewayId/identity` body `{name}` → hostname + gateway-id + Z2M base_topic + 모든 env 동시 갱신
- [ ] **FR-03**: 프론트엔드 ConfigDeploy 페이지에서 "이름 변경" 단일 카드로 통합 (현재 2개 카드 → 1개)
- [ ] **FR-04**: 옵션이지만 하위 호환 — 기존 분리 배포 API는 유지 (deprecation 경고만)
- [ ] **FR-05**: hostname/gateway-id 동기화 전제로 한 invariant 검증: backend 시작 시 DB 모든 게이트웨이에 대해 mismatch 있으면 warn 로그

### 2.2 Out of Scope
- Wi-Fi 통합 배포
- Server-IP 통합 배포
- 다중 게이트웨이 일괄 변경

---

## 3. Requirements

### 3.1 Functional Requirements

| ID | Requirement | Priority | Status |
|----|---|---|---|
| FR-01 | hostname 배포 → 같은 값 gateway-id 자동 cascade (옵션) | High | Pending |
| FR-02 | 통합 endpoint `/api/config-deploy/:gw/identity` 추가 | High | Pending |
| FR-03 | ConfigDeploy.vue 단일 "이름 변경" 카드 | High | Pending |
| FR-04 | 분리 endpoint 유지 (deprecation 경고 로그) | Medium | Pending |
| FR-05 | 부팅 시 hostname/gateway-id mismatch warn | Low | Pending |

### 3.2 Non-Functional

| 항목 | 기준 |
|---|---|
| 응답 시간 | 단일 배포가 분리 2회 배포의 합 이하 (≤ 22초 가이드) |
| 호환성 | 기존 hostname/gateway-id 분리 API 호출은 동일 결과 |
| 검증 | 신규 배포 직후 PI hostname, gateway-id, Z2M base_topic, env 4종 모두 동일 값 |

---

## 4. Success Criteria

### 4.1 DoD
- [ ] 새 endpoint 1회 호출로 hostname + gateway-id + Z2M + env 모두 동기화
- [ ] 프론트엔드 카드 1개로 변경
- [ ] 기존 hostname-only 배포 호출 시 자동 cascade 옵션 활성 — 결과 동일
- [ ] 양산 검증 시 ConfigDeploy 페이지 클릭 횟수 1회 (이전 2회)
- [ ] Match Rate ≥ 90%

### 4.2 Acceptance Test
- AT-01: POST identity `{name: 'lgw-test99'}` → 12초 내 PI hostname/gateway-id/Z2M base_topic 모두 `lgw-test99`
- AT-02: 기존 hostname endpoint 호출 (cascade 옵션 ON) → gateway-id도 자동 갱신
- AT-03: hostname endpoint cascade 옵션 OFF → gateway-id 미변경 (하위 호환)
- AT-04: 동일 PI에 두 번 연속 다른 이름 배포 → 둘 다 정상 (멱등성)

---

## 5. Implementation Sketch

### Backend
- `config-deploy.controller.ts`: `@Post(':gatewayId/identity')` 추가
- `config-deploy.service.ts`: `applyIdentity()` 메서드 — hostname 명령 publish 후 응답 받으면 gateway-id 명령도 publish (또는 PI 측 통합 처리)
- 옵션: `hostname` endpoint에 query `?cascadeGatewayId=true` 추가 (기본 true)

### Pi 측
- 새 명령 `identity_update` 추가 (apply-hostname.sh + apply-gateway-id.sh 통합 실행)
- 또는 config-agent가 hostname_update 처리 시 gateway-id도 자동 처리 (옵션)

### Frontend
- ConfigDeploy.vue: hostname/gateway-id 2개 카드 → "게이트웨이 이름" 1개 카드 통합

---

## 6. Risks

| Risk | Mitigation |
|---|---|
| 통합 배포 중 1단계 실패 시 일부만 적용 | 트랜잭션 형태로 rollback 또는 명확한 부분실패 보고 |
| 사용자가 의도적으로 hostname≠gateway-id 설정한 경우 | 옵션 플래그로 분리 가능 + warn 로그 |
| 기존 lgw-dev/lgw-HK도 정렬 강제? | 자동 정렬 안 함, 사용자 결정 |

---

## 7. Estimated Effort

- Backend: 2시간 (endpoint + service + cascade)
- Frontend: 1시간 (카드 통합)
- PI 측: 1시간 (apply-identity.sh 작성 또는 통합 핸들러)
- 검증: 1시간 (양산 PI 또는 lgw-pilot01에 실기 테스트)
- 총: **5시간 (반나절)**
