---
template: plan
version: 1.2
feature: rpi-agent-version-update
date: 2026-05-25
author: ohgane
project: smart-farm-mqtt
status: Draft
---

# rpi-agent-version-update Planning Document

> **Summary**: ConfigDeploy 페이지 "워크플로우 A (N대 일괄 배포)"에 **agent 코드 자체 업데이트** 기능 추가. 현재는 Z2M `configuration.yaml`만 일괄 배포 가능. config-agent / gpio-agent / fallback-engine 코드를 git pull + npm install + service restart로 N대 일괄 갱신.
>
> **Project**: smart-farm-mqtt
> **Date**: 2026-05-25
> **Status**: Draft
> **Related**: [ConfigDeploy UX 정리](../../archive/2026-05/...) — 워크플로우 A의 update 기능 확장

---

## 1. Overview

### 1.1 Purpose
운영 중인 N대의 라즈베리파이에 agent(`config-agent`, `gpio-agent`, `fallback-engine`) 코드 변경을 일괄 적용. 현재는 Z2M YAML만 ConfigDeploy로 update 가능. agent 자체 코드는 수동 SSH로 1대씩 처리해야 함 → 운영 부담 큼.

### 1.2 Background
- 사용자가 처음 ConfigDeploy 페이지를 만든 의도: "향후 변경 사항도 업데이트할 수 있는 기능"
- 본 사이클에서 워크플로우 A 그룹화로 UX 명확화됨 → agent 버전 update도 같은 그룹의 추가 항목으로 자연스러움
- 현재 agent 코드는 운영자가 1대씩 `cd /opt/smart-farm/config-agent && git pull && systemctl restart config-agent` 수동 실행

### 1.3 Related
- ConfigDeploy.vue 워크플로우 A (Z2M YAML 일괄 배포)
- raspberry-pi/config-agent, gpio-agent, fallback-engine

---

## 2. Scope

### 2.1 In Scope
- [ ] **FR-01**: 새 MQTT action `agent_update` — body `{agent: 'config-agent'|'gpio-agent'|'fallback-engine', version?: string|'latest'}`
- [ ] **FR-02**: PI 측 `apply-agent-update.sh` — 해당 agent 디렉토리에서 git fetch + checkout(version) + npm install --production + systemctl restart
- [ ] **FR-03**: backend POST `/api/config-deploy/deploy-agent` — N대 일괄 배포 (체크박스로 대상 선택)
- [ ] **FR-04**: ConfigDeploy.vue 워크플로우 A에 "Agent 업데이트" 카드 추가
  - agent 선택 (3종 dropdown)
  - version (latest 또는 git tag 입력)
  - 대상 게이트웨이 (워크플로우 A의 2번 "배포 대상 선택" 재사용)
- [ ] **FR-05**: 결과 응답 — 각 게이트웨이별 (success/fail + git log -1 + service status)
- [ ] **FR-06**: 롤백 — 실패 시 이전 commit hash로 자동 복귀 (`apply-agent-update.sh` 안에서 try/catch)

### 2.2 Out of Scope
- Z2M 자체 버전 업그레이드 (별도 사이클)
- OS / kernel update (apt)
- 한 번에 여러 agent 동시 update (1개 action = 1개 agent)
- A/B 배포 (canary)

---

## 3. Requirements

### 3.1 FR

| ID | Requirement | Priority | Status |
|----|---|---|---|
| FR-01 | MQTT action `agent_update` 정의 | High | Pending |
| FR-02 | apply-agent-update.sh (git pull + npm + restart + rollback) | High | Pending |
| FR-03 | POST `/api/config-deploy/deploy-agent` N대 일괄 | High | Pending |
| FR-04 | ConfigDeploy.vue 워크플로우 A에 새 카드 | High | Pending |
| FR-05 | 결과 응답 (commit hash + status) | High | Pending |
| FR-06 | 실패 시 rollback (이전 commit) | High | Pending |
| FR-07 | 운영자 권한 (admin/farm_admin만) | Medium | Pending |
| FR-08 | dry-run 모드 (미리 git log diff만 조회) | Medium | Pending |

### 3.2 NFR

| 항목 | 기준 |
|---|---|
| 응답 시간 | 1대당 30초 이내 (git fetch + npm install + restart) |
| 동시성 | N대 일괄 시 PI별 병렬 실행 |
| 안정성 | 실패 시 자동 rollback. 성공율 100% 아니어도 부분 성공 보고 |

---

## 4. Success Criteria

### 4.1 DoD
- [ ] N대 PI에 config-agent 코드 업데이트 1번 클릭으로 적용
- [ ] 실패 시 자동 rollback 동작 입증
- [ ] dry-run으로 영향 범위 미리 확인 가능
- [ ] 운영 절차서에 agent update 표준 절차 추가
- [ ] Match Rate ≥ 90%

### 4.2 AT
- AT-01: 단일 PI에 config-agent update (lgw-pilot01) → git log -1 변경 + service active
- AT-02: 2대 일괄 (lgw-pilot01 + lgw-dev) → 둘 다 성공
- AT-03: 잘못된 version (없는 tag) → rollback + 이전 commit 유지 + 실패 응답
- AT-04: dry-run → 실제 변경 없이 git log diff만 응답
- AT-05: gpio-agent / fallback-engine도 동일 패턴 동작

---

## 5. Implementation Sketch

### PI 측
- `raspberry-pi/scripts/apply-agent-update.sh` 신규
  - 인자: `<agent_name> [version]`
  - `cd /opt/smart-farm/$agent_name && OLD=$(git rev-parse HEAD) && git fetch && git checkout $version && npm install --omit=dev && systemctl restart $agent_name`
  - 실패 시 `git reset --hard $OLD && systemctl restart $agent_name`
- `raspberry-pi/config-agent/handlers/agent-update.js` 신규
- `raspberry-pi/config-agent/index.js` action dispatcher에 `agent_update` 추가

### Backend
- `backend/.../config-deploy.types.ts` ConfigAction에 `agent_update` 추가
- `backend/.../config-deploy.service.ts` `requestAgentUpdate(gatewayId, agent, version, user)` + N대 일괄 wrapper
- `backend/.../config-deploy.controller.ts` `POST /:gatewayId/agent-update` + `POST /deploy-agent` (다대상)
- DTO: `UpdateAgentDto { agent: string, version?: string }`

### Frontend
- `frontend/src/api/config-deploy.api.ts` `deployAgent(gatewayIds, agent, version)`
- `frontend/src/views/ConfigDeploy.vue` 워크플로우 A에 새 카드: "🔄 Agent 코드 업데이트"
  - agent 선택 (config-agent / gpio-agent / fallback-engine)
  - version input (기본 'latest')
  - 워크플로우 A의 2번 게이트웨이 선택 재사용

---

## 6. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| git pull 실패 (network) | retry 3회 + 실패 시 rollback |
| npm install 메모리 부족 (Pi 3B 1GB) | `--omit=dev` + npm cache 활용 |
| 새 코드의 bug → 서비스 안 뜸 | service restart 후 30s status check, fail 시 rollback |
| 운영 중 일괄 update로 전체 다운 | canary 모드(별도 사이클) 권장. 본 사이클은 N대 동시지만 dry-run으로 영향 검증 |
| git repository는 어디? | PI는 /opt/smart-farm/{agent}에 git clone 되어 있어야. setup.sh 검토 필요 |

---

## 7. Estimated Effort

- 사전: PI git clone 구조 검토 + 표준화 (필요 시): 1시간
- PI 스크립트 + handler: 2시간
- Backend (DTO + service + controller): 2시간
- Frontend (워크플로우 A 카드 추가): 2시간
- 검증 (AT-01~05): 2시간
- 총: **9시간 (1.5일)**

---

## 8. Open Questions

- [ ] PI git clone 구조가 표준화되어 있는지 (현재 setup.sh가 어떻게 agent를 설치하는지)?
- [ ] version은 git tag만? branch도 허용? (예: `main`, `v1.2.0`, commit hash)
- [ ] 일괄 업데이트 시 1대 실패해도 나머지 진행? 아니면 first-fail abort?
- [ ] dry-run 응답에 어떤 정보? (git log 1줄 + package.json version diff?)
