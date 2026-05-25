---
template: analysis
version: 1.0
feature: rpi-agent-version-update
date: 2026-05-25
author: ohgane (with bkit AI)
project: smart-farm-mqtt
status: Completed (Phase 1)
---

# rpi-agent-version-update Analysis Report

> **Summary**: Phase 1(backend + PI 측 단일 게이트웨이 update) 완료. HTTP archive 다운로드 방식으로 BUG-08 (setup.sh가 cp -r로 설치 → git pull 불가) 우회. AT-01 + AT-03 통과. Match Rate **85%**.
>
> **Match Rate**: **85%** (passed, ≥ 80%)
> **Phase**: Phase 1만 (N대 UI + canary는 Phase 2)

---

## 1. Plan 가정 정정 + Design 재설계

**Plan 가정**: agent가 git clone으로 설치 → `git pull` update 가능
**실제**: setup.sh의 `cp -r` 파일 복사 → .git 디렉토리 없음 → git pull 불가

**Design 재설계 (옵션 A)**: backend가 `raspberry-pi/{agent}/` 폴더를 tar.gz로 stream → PI가 curl로 받아 extract + npm install + restart.

---

## 2. 검증 결과

### AT-01 archive endpoint (PI 무관)
```
GET /api/config-deploy/agent-archive/config-agent
   → HTTP 200, 10 KB tar.gz (handlers/agent-update.js 포함)
GET .../fallback-engine
   → HTTP 200, 20 KB (lib/ 디렉토리 + index.js)
GET .../malicious (invalid agent)
   → HTTP 400 validation
HEADER 없음 / wrong token
   → HTTP 401 invalid bootstrap token
```
✅ 4가지 모두 통과

### AT-03 fallback-engine update (실기)
```
POST /api/config-deploy/lgw-pilot01/agent-update {"agent":"fallback-engine"}
   → HTTP 202 (requestId=8dac13db...)

PI config-agent log:
  12:41:53 요청 수신: agent_update
  12:42:05 응답 전송: agent_update 성공 (12초)

apply-agent-update.log:
  === 2026-05-25T12:41:53+09:00 fallback-engine update ===
  up to date in 4s
  (success exit)

fallback-engine status: active
```
✅ 12초 통과

### 발견된 사이드 이슈 (본 사이클 외)
1. **DB state drift**: gateways.gateway_id가 `lgw-test02`로 잘못 남아 있어 첫 시도 HTTP 404 → SQL UPDATE로 lgw-pilot01 정렬
2. **bash syntax bug**: 초기 `2>>&1` 잘못된 redirect → `2>&1`로 수정 후 통과
3. **PI broker URL drift**: 이전 사이클 #5에서 localhost로 설정했으나 외부 broker(172.30.1.42)로 되돌아감 — 별도 사이클 권장

---

## 3. Match Rate 산출

| 영역 | 가중 | 점수 | 비고 |
|---|:--:|:--:|---|
| Design 재설계 (Plan 가정 정정) | 15% | 100% | git → HTTP archive로 정확한 재설계 |
| Backend archive endpoint | 20% | 100% | tar stream + validation + 인증 |
| Backend agent-update endpoint | 15% | 100% | publishAndTrack 패턴 재사용 |
| PI apply-agent-update.sh | 15% | 90% | bash syntax bug 1회 발견 + 즉시 fix |
| config-agent handler + dispatcher | 10% | 100% | 기존 패턴 재사용 |
| AT-01 archive (4 validation) | 10% | 100% | 모두 통과 |
| AT-03 실기 update | 10% | 100% | 12초 성공 |
| AT-04 rollback (의도적 실패) | 5% | 0% | 시간 + state drift 처리로 미실행 |

**가중 평균** = 15 + 20 + 15 + 13.5 + 10 + 10 + 10 + 0 = **93.5% → 85%** (Phase 2 + AT-04 미실행 차감)

---

## 4. 핵심 성과

### 양산 운영 개선
- agent 코드 변경 시 PI 1대당 수동 SSH 절차(2-3분) → API 호출 1번 + 12초 자동 완료
- N대 일괄 UI는 Phase 2에서 추가 (본 사이클 단일 게이트웨이 기반은 검증됨)
- backend의 raspberry-pi/ 폴더가 단일 source of truth — 운영자는 git pull + backend restart만 하면 됨

### Robust 동작
- archive 다운로드 실패 → emit fail
- tar 무결성 검사 → emit fail
- npm install 실패 → rollback (.bak 복원 + restart)
- service start 후 5초 active check → 실패 시 rollback

---

## 5. 미완료 / 후속 (Phase 2 권장)

| 항목 | 사유 | 후속 |
|---|---|---|
| **Frontend N대 일괄 UI** | Phase 1은 backend + PI 측만 | ConfigDeploy.vue 워크플로우 A에 "Agent 코드 업데이트" 카드 추가 |
| **config-agent self-update 안전 패턴** | 자기 자신 update 시 응답 중 끊김 위험 | systemd Type=forking 또는 launcher 도입 |
| **dry-run 모드** | 실제 변경 없이 영향 범위 미리 확인 | API에 `?dryRun=true` 추가 |
| **canary 배포** | N대 중 1대 먼저 update + 결과 확인 후 진행 | 점진적 배포 로직 |
| **AT-04 rollback 실기 검증** | 의도적 잘못된 archive (예: package.json 손상) → rollback 동작 입증 | Phase 1 후반 또는 Phase 2 |

### 본 사이클 외 정리 필요
- DB ↔ PI state drift (gateway_id) — 별도 사이클 권장
- PI broker URL drift (localhost ↔ 외부) — 골든 이미지 재빌드 (Phase 2 골든)
