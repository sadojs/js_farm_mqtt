---
template: report
version: 1.0
feature: rpi-hostname-gateway-id-unify
date: 2026-05-23
author: ohgane
project: smart-farm-mqtt
status: Completed
---

# rpi-hostname-gateway-id-unify 완료 보고서

> **Summary**: hostname/gateway-id 분리 배포 → 통합 endpoint(`/identity`) + UI 1 카드로 통합. 양산 시 클릭 1회로 5종 환경 동시 갱신. Match Rate **96%**.
>
> **Owner**: 오정석 (sadojs@gmail.com)
> **Started**: 2026-05-23
> **Completed**: 2026-05-23
> **Duration**: 약 1시간 (반복 없이 한 번에 통과)

---

## 1. PDCA 개요

### Plan
**문서**: `docs/01-plan/features/rpi-hostname-gateway-id-unify.plan.md`

양산 검증(`rpi-golden-image-mass-production`)에서 hostname=`lgw-pilot01`, gateway-id=`lgw-pilot01`로 따로 배포한 경험에서 도출. 두 값이 항상 같다는 invariant + 양산 시 클릭 절감 + mismatch 실수 방지.

### Design
**문서**: `docs/02-design/features/rpi-hostname-gateway-id-unify.design.md`

옵션 A(신규 endpoint) + 옵션 C(자동 cascade) 결합. PI 측에 `apply-identity.sh` 신규 + config-agent `identity_update` action 추가.

### Do (구현 7단계)
| Do | 영역 | 산출물 |
|:--:|---|---|
| 1 | DTO | `update-identity.dto.ts` (RFC 1123 validation) |
| 2 | Service | `requestIdentity()` + `applyDbChanges`에 `identity_update` 분기 |
| 3 | Controller | `POST /api/config-deploy/:gw/identity` |
| 4 | PI script | `raspberry-pi/scripts/apply-identity.sh` (apply-hostname + apply-gateway-id 순차) |
| 5 | config-agent | `handlers/identity.js` + `index.js` action dispatcher |
| 6 | hostname endpoint cascade 옵션 | ⏭️ 생략 (의도된 결정) |
| 7 | Frontend | `IdentityCard` 통합 + API client + composable |

### Check
**문서**: `docs/03-analysis/rpi-hostname-gateway-id-unify.analysis.md`

| 회차 | Match Rate | 핵심 |
|:--:|:--:|---|
| 1차 | **96%** | AT 4건 통과, 반복 없음 |

### Act
반복(iterate) 불필요 — 첫 검증에서 96% 달성. 부수 BUG 발견 0건.

---

## 2. 구현 결과

### 완료 항목

#### Backend (4 파일)
- `update-identity.dto.ts` (신규) — RFC 1123 hostname validation
- `config-deploy.types.ts` — `identity_update` ConfigAction + `name` field 추가, `TIMEOUTS_MS` 90초
- `config-deploy.service.ts` — `requestIdentity()` + cascade transaction 통합 (`identity_update`도 gateway_id cascade + hostname 동시 갱신)
- `config-deploy.controller.ts` — `POST /:gw/identity` endpoint (admin role)

#### PI 측 (3 파일)
- `raspberry-pi/scripts/apply-identity.sh` (신규) — hostname + gateway-id atomic 실행 + 단일 응답
- `raspberry-pi/config-agent/handlers/identity.js` (신규)
- `raspberry-pi/config-agent/index.js` — `identity_update` action dispatcher

#### Frontend (3 파일)
- `frontend/src/api/config-deploy.api.ts` — `updateIdentity()` + `identity_update` ConfigAction
- `frontend/src/composables/useRemoteConfig.ts` — `applyIdentity()` + states.identity_update
- `frontend/src/components/config-deploy/GatewaySystemConfigCard.vue` — Hostname 카드 → "게이트웨이 이름" 통합 카드, Gateway ID는 admin legacy 토글로 숨김

### 검증 결과 (실기 AT 4건 모두 통과)

| Test | 결과 | 핵심 증거 |
|---|---|---|
| AT-01 identity 배포 (lgw-pilot01→lgw-test01) | ✅ | 10초, PI 5종 + DB 2종 모두 동기화 |
| AT-04 원복 (lgw-test01→lgw-pilot01) | ✅ | 정상 cascade |
| AT 멱등성 (동일 값) | ✅ | HTTP 400 "동일합니다" |
| AT validation (잘못된 형식) | ✅ | HTTP 400 RFC 1123 메시지 |
| DB cascade | ✅ | gateways.hostname + gateway_id + fallback_gateway_status 정확 |
| PI 동시 갱신 | ✅ | hostname + gateway-id + Z2M + 3 env 모두 |
| TypeScript 검증 | ✅ | `npx vue-tsc --noEmit` 통과 |

### 산출 evidence
- `docs/evidence-unify/AT01-request.json` — 신규 endpoint 응답
- `docs/evidence-unify/AT01-pi-state.txt` — PI 5종 동기화 확인
- `docs/evidence-unify/AT01-db.txt` — DB cascade 확인
- `docs/evidence-unify/AT01-backend.log` — `identity_update cascade 완료` 로그
- `docs/evidence-unify/AT04-rollback.json` — 원복 응답
- `docs/evidence-unify/AT-idempotency.json` — 동일 값 거부
- `docs/evidence-unify/AT-validation.json` — 형식 위반 거부

### 미완료 / 후속
| 항목 | 사유 | 후속 처리 |
|---|---|---|
| Do-6 hostname endpoint cascade 옵션 | 신규 endpoint로 충분 | 의도된 생략 |
| DB constraint로 hostname=gateway_id 강제 | 향후 옵션 | 별도 사이클 (선택) |
| 운영 절차서 업데이트 (4종→3종) | 본 사이클 outcome | 다음 양산 검증 사이클과 함께 |

---

## 3. 사용자 경험 개선 정량

| 항목 | Before | After | 변화 |
|---|:--:|:--:|:--:|
| 양산 시 ConfigDeploy 클릭 횟수 | 2 | **1** | -50% |
| 같은 값 입력 횟수 | 2 | **1** | -50% |
| 응답 대기 시간 | ~22s | **~10s** | -55% |
| hostname≠gateway-id 실수 가능성 | 있음 | **없음** | 제거 |
| API 호출 | 2 | **1** | -50% |

---

## 4. 핵심 학습

### 잘된 점
- **이전 사이클의 BUG fix(BUG-01 fallback-engine.env, BUG-09 fallback_* cascade)가 본 사이클에서 자연스럽게 활용됨** — apply-identity.sh가 apply-gateway-id를 호출하면 모든 env가 정확히 갱신됨
- **DTO + 신규 endpoint + cascade transaction 한 번에 구현 가능한 작은 사이클**이라 반복 없이 96% 도달
- **Frontend 카드 통합 시 legacy 옵션을 admin 토글로 남겨둠** — 점진적 deprecation 패턴

### 개선점 / 다음 사이클로
- 운영 절차서(`docs/05-operation/`) 업데이트가 누적되어 있음 — 통합 사이클 필요
- ConfigDeploy 페이지의 다른 카드들(Wi-Fi, Server-IP)도 동일 패턴 적용 가능성 검토

---

## 5. 산출 파일

### 신규
- `backend/src/modules/config-deploy/dto/update-identity.dto.ts`
- `raspberry-pi/scripts/apply-identity.sh`
- `raspberry-pi/config-agent/handlers/identity.js`
- `docs/evidence-unify/AT01-*.{json,txt,log}` × 4
- `docs/evidence-unify/AT04-rollback.json`
- `docs/evidence-unify/AT-idempotency.json`
- `docs/evidence-unify/AT-validation.json`

### 수정
- `backend/src/modules/config-deploy/config-deploy.types.ts`
- `backend/src/modules/config-deploy/config-deploy.service.ts`
- `backend/src/modules/config-deploy/config-deploy.controller.ts`
- `raspberry-pi/config-agent/index.js`
- `frontend/src/api/config-deploy.api.ts`
- `frontend/src/composables/useRemoteConfig.ts`
- `frontend/src/components/config-deploy/GatewaySystemConfigCard.vue`

---

## 6. PDCA 사이클 메타데이터

```yaml
feature: rpi-hostname-gateway-id-unify
phase: archived
matchRate: 96
iterationCount: 1
startedAt: 2026-05-23
archivedAt: 2026-05-23
archivedTo: docs/archive/2026-05/rpi-hostname-gateway-id-unify/
relatedCycles:
  - rpi-golden-image-mass-production (출처: hostname/gateway-id 분리 배포 경험)
nextCycles:
  - rpi-server-ip-rollover (E-4 검증, Plan 작성됨)
  - rpi-auto-device-provision (BUG-06, Plan 작성됨)
  - rpi-activity-log-pk-trace (BUG-04, Plan 작성됨)
  - rpi-local-broker-failover (BUG-08, Plan 작성됨, Priority HIGH)
deliverables:
  - 통합 endpoint POST /api/config-deploy/:gw/identity
  - apply-identity.sh + config-agent identity handler
  - GatewaySystemConfigCard UI 통합 (legacy 옵션 보존)
  - 양산 검증 단계 E 클릭 50% 감소
```
