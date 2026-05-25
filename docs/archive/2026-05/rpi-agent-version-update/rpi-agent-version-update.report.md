---
template: report
version: 1.0
feature: rpi-agent-version-update
date: 2026-05-25
author: ohgane
project: smart-farm-mqtt
status: Completed (Phase 1)
---

# rpi-agent-version-update 완료 보고서 (Phase 1)

> **Summary**: agent 코드(config-agent/gpio-agent/fallback-engine) N대 일괄 update 기능 — Phase 1(단일 게이트웨이) 구현 완료. HTTP archive 다운로드 방식 (setup.sh가 cp -r 사용으로 git pull 불가). Match Rate **85%**. ConfigDeploy 워크플로우 A의 "향후 변경 사항 update" 의도 확장.
>
> **Owner**: 오정석
> **Started**: 2026-05-25
> **Completed**: 2026-05-25
> **Duration**: 약 2시간

---

## 1. PDCA 개요

### Plan
사용자가 ConfigDeploy 페이지 UX 정리 작업 중 도출 — "향후 변경 사항도 업데이트할 수 있는 기능"의 확장으로 agent 코드 N대 일괄 update 필요.

### Design (재설계)
Plan 가정 정정: agent가 git clone이 아닌 `cp -r` 파일 복사로 설치. **옵션 A (HTTP archive 다운로드)** 채택 — backend가 raspberry-pi/{agent}/ 폴더를 tar.gz로 stream, PI가 curl로 받아 적용.

Phase 분리:
- Phase 1: backend + PI 측 + 단일 게이트웨이 검증 (본 사이클)
- Phase 2: Frontend N대 일괄 UI + canary + dry-run + self-update 안전 패턴 (별도 사이클)

### Do (Phase 1)
| Do | 영역 | 산출물 |
|:--:|---|---|
| 1 | DTO | `update-agent.dto.ts` — IsIn 3종 |
| 2 | Types | ConfigAction `agent_update` 추가, TIMEOUTS_MS 180s |
| 3 | Service | `requestAgentUpdate()` |
| 4 | Controller | `POST /:gw/agent-update` (admin) + `GET /agent-archive/:agent` (Bootstrap-Token) |
| 5 | PI script | `apply-agent-update.sh` — curl + extract + npm + restart + rollback |
| 6 | config-agent | `handlers/agent-update.js` + index.js dispatcher |

### Check
**Match Rate 85%** (Phase 1 한정). AT-01 + AT-03 통과, AT-04(rollback) 미실행.

### Act
반복 불필요. Phase 2와 발견된 사이드 이슈(DB drift, broker drift)는 별도 사이클.

---

## 2. 검증 결과

### AT-01 archive endpoint (4가지 validation 통과)
```
GET /agent-archive/config-agent      → 200 (10 KB tar)
GET /agent-archive/fallback-engine   → 200 (20 KB tar)
GET /agent-archive/malicious         → 400 invalid
GET /agent-archive/... (wrong token) → 401 unauthorized
```

### AT-03 fallback-engine update (실기, 12초)
```
12:41:53 [CONFIG-AGENT] 요청 수신: agent_update
12:42:05 [CONFIG-AGENT] 응답 전송: agent_update 성공 (12초)

apply-agent-update.log: "up to date in 4s" (npm install)
fallback-engine status: active 유지
```

### 발견 + 즉시 fix
- bash syntax error (`2>>&1` → `2>&1`): 1회 발견 + 즉시 수정
- DB state drift (gateway_id=lgw-test02 → lgw-pilot01): SQL UPDATE 정렬

---

## 3. 구현 결과

### Backend (4 파일)
- `dto/update-agent.dto.ts` (신규) — IsIn validation
- `config-deploy.types.ts` — `agent_update` action + TIMEOUTS_MS 180s
- `config-deploy.service.ts` — `requestAgentUpdate()` 메서드
- `config-deploy.controller.ts` — endpoint 2개:
  - `POST /:gatewayId/agent-update` (admin role)
  - `GET /agent-archive/:agent` (Bootstrap-Token 인증, tar.gz stream)

### PI 측 (3 파일)
- `raspberry-pi/scripts/apply-agent-update.sh` (신규) — curl + tar extract + rsync 교체 + npm install + restart + rollback
- `raspberry-pi/config-agent/handlers/agent-update.js` (신규)
- `raspberry-pi/config-agent/index.js` — `agent_update` action dispatcher

### Frontend
- Phase 1 out of scope (Phase 2 별도 사이클)

---

## 4. 핵심 가치

### "향후 변경 사항 업데이트" 의도 확장
사용자가 ConfigDeploy 페이지를 만든 의도 = 양산 후 운영 중에 PI 설정/코드를 변경하는 기능. 워크플로우 A에 이미 Z2M YAML 일괄 배포 있고, 본 사이클로 **agent 코드 일괄 update도 가능** (Phase 1 단일, Phase 2 N대).

### 양산 운영 개선
- 이전: 1대당 수동 SSH 2-3분
- 이후: API 호출 + 자동 12초

### Robust 동작
- archive 다운로드 / tar 무결성 / npm install / service start 모든 단계에 fail-safe
- 실패 시 .bak 자동 rollback + restart

---

## 5. 미완료 / 후속

| 항목 | 우선순위 | 후속 |
|---|---|---|
| Frontend N대 일괄 UI | HIGH | Phase 2 사이클 — ConfigDeploy 워크플로우 A 카드 추가 |
| config-agent self-update 안전 패턴 | MEDIUM | systemd Type=forking 또는 launcher 도입 |
| dry-run 모드 | MEDIUM | API `?dryRun=true` |
| AT-04 rollback 실기 검증 | MEDIUM | 의도적 잘못된 archive로 rollback 동작 입증 |
| canary 배포 (N대 중 1대 먼저) | LOW | 점진적 배포 로직 |

### 발견된 별도 이슈 (사이클 무관, 별도 처리 권장)
- DB ↔ PI gateway_id state drift
- PI broker URL drift (localhost ↔ 외부) — 골든 이미지 v20260524 재빌드로 일괄 해소

---

## 6. PDCA 메타데이터

```yaml
feature: rpi-agent-version-update
phase: archived
matchRate: 85
iterationCount: 1
phaseScope: phase-1-only
startedAt: 2026-05-25
archivedAt: 2026-05-25
archivedTo: docs/archive/2026-05/rpi-agent-version-update/
deliverables:
  - Backend: archive endpoint + agent-update endpoint + DTO + service + types
  - PI: apply-agent-update.sh + handler + dispatcher
  - AT-01 + AT-03 검증 통과
  - fallback-engine update 12초 성공 입증
nextCycles:
  - rpi-agent-version-update-phase-2 (Frontend N대 UI + canary + self-update 안전 패턴)
  - rpi-gateway-state-drift-fix (DB ↔ PI state 정합성)
  - rpi-golden-image-v20260524-rebuild (broker drift 일괄 해소)
relatedCycles:
  - configdeploy-ux-workflow-groups (출처)
  - rpi-golden-image-mass-production (양산 의도 확장)
```
