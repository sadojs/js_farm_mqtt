---
template: plan
version: 1.2
feature: rpi-activity-log-pk-trace
date: 2026-05-23
author: ohgane
project: smart-farm-mqtt
status: Draft
---

# rpi-activity-log-pk-trace Planning Document

> **Summary**: 양산 검증 중 backend가 9:38 PM에 abort된 BUG-04 추적. 로그상 `duplicate key value violates unique constraint "PK_d153bd1f972e9997ea908097a1d"` + `Node.js v22.22.1` (process abort)로 종료. 자동화 룰이 30초 주기로 트리거되는 환경에서 재발 가능 → root cause 식별 + 재발 방지 fix.
>
> **Project**: smart-farm-mqtt
> **Date**: 2026-05-23
> **Status**: Draft

---

## 1. Overview

### 1.1 Purpose
운영 중 backend가 unhandled exception으로 abort되면 모든 게이트웨이 영향 + PI register-tunnel-key 실패. **재발 방지를 위해 PK 충돌의 정확한 발생 시나리오 + 코드 위치 식별 + 트랜잭션/upsert로 변경**.

### 1.2 Background
- BUG-04 발견: 2026-05-21 21:38 PM에 backend abort
- 직전 로그: `error: duplicate key value violates unique constraint "PK_d153bd1f972e9997ea908097a1d"`
- 9:16 PM에 429 Throttler 다수 (login 시도 폭주) + 자동화 룰 30초 주기 트리거 중
- 어느 테이블의 PK인지 unknown (constraint name은 random hash)

### 1.3 Related
- [BUG-04](../../evidence/BUGS-found.md#bug-04)
- backend logs: `backend/logs/backend-restart.log` 9:38 PM 부근

---

## 2. Scope

### 2.1 In Scope
- [ ] **FR-01**: PK 충돌 constraint name → 테이블/컬럼 식별
- [ ] **FR-02**: 충돌 발생 INSERT 코드 위치 식별 (stack trace + grep)
- [ ] **FR-03**: 재발 시나리오 재현 (자동화 룰 빠른 연속 트리거 등)
- [ ] **FR-04**: Fix — UUID 충돌이라면 application code UUID 생성 검증, race condition이라면 트랜잭션 또는 INSERT ... ON CONFLICT
- [ ] **FR-05**: Global exception filter에서 PK 충돌은 warn으로 처리 (process abort 방지)
- [ ] **FR-06**: 24시간 모니터링: backend 재시작 없이 자동화 룰 30초 주기 트리거 지속 → 충돌 재현 여부

### 2.2 Out of Scope
- 일반적인 backend resilience (retry, circuit breaker)
- DB schema 전반 재설계

---

## 3. Requirements

### 3.1 FR

| ID | Requirement | Priority | Status |
|----|---|---|---|
| FR-01 | constraint name → 테이블 식별 | High | Pending |
| FR-02 | INSERT 코드 위치 식별 | High | Pending |
| FR-03 | 재현 시나리오 정의 | High | Pending |
| FR-04 | application code or DB fix | High | Pending |
| FR-05 | unhandled exception 핸들러로 process abort 차단 | High | Pending |
| FR-06 | 24시간 stability 검증 | Medium | Pending |

---

## 4. Success Criteria

### 4.1 DoD
- [ ] 충돌 constraint name → 테이블/컬럼/INSERT 위치 명확히 식별
- [ ] Fix 후 24시간 backend 무중단 운영 검증
- [ ] backend abort 시 unhandled exception handler 캐치 + 로그 + 자동 재시작 (PM2 또는 systemd Restart=always)
- [ ] Match Rate ≥ 95% (재발 시 즉시 알람)

### 4.2 AT
- AT-01: PSQL `SELECT conname, conrelid::regclass FROM pg_constraint WHERE conname = 'PK_d153bd1f972e9997ea908097a1d';` → 테이블 식별
- AT-02: 의심 INSERT 코드에 race condition 시뮬레이션 (병렬 100회 INSERT 같은 PK) → 충돌 발생 확인
- AT-03: Fix 적용 후 동일 시뮬레이션 → 충돌 없이 처리 완료
- AT-04: 24시간 backend 운영 + 자동화 룰 30초 주기 → abort 0회

---

## 5. Implementation Sketch

### 진단
- `pg_constraint` 조회로 테이블 식별 (분석 첫 단계)
- backend logs full stack trace 검색 (`error:` line 직전)

### Fix 패턴
- TypeORM repository에서 직접 INSERT → upsert/onConflict 패턴 변경
- 또는 트랜잭션 격리 + advisory lock
- Global exception filter (`nest`)에서 `QueryFailedError` 캐치 → log + continue

### 안전망
- `systemctl restart smart-farm-backend.service` → 또는 process manager (systemd Restart=on-failure)
- log monitoring: `journalctl -u smart-farm-backend -f` 또는 별도 alert

---

## 6. Risks

| Risk | Mitigation |
|---|---|
| Root cause 식별 어려움 (스택 트레이스 부족) | strace + DB query log 활성화로 보조 |
| Fix가 다른 동작 변경 유발 | 회귀 테스트 (lgw-dev 자동화 룰 + 활동 로그 정상) |
| 24시간 운영 중 다른 이슈로 abort | unhandled exception filter 항상 켜둠 |

---

## 7. Estimated Effort

- 진단 (constraint → code path): 2시간
- Fix + 단위 테스트: 2시간
- 24시간 stability 검증: (시계 시간) 1일
- 총: **개발 4시간 + stability 1일**
