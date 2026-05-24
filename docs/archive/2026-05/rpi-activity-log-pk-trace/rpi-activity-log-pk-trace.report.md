---
template: report
version: 1.0
feature: rpi-activity-log-pk-trace
date: 2026-05-24
author: ohgane
project: smart-farm-mqtt
status: Completed
---

# rpi-activity-log-pk-trace 완료 보고서

> **Summary**: BUG-04 root cause 확정 — `sensor_data` PK가 `time` 하나라 ms 단위 동시 INSERT 충돌. 3단계 fix(try/catch + 2개 process-level handler). 사이클명 정정(activity_logs → sensor_data). Match Rate **88%**.
>
> **Owner**: 오정석
> **Started**: 2026-05-24
> **Completed**: 2026-05-24
> **Duration**: 약 30분

---

## 1. PDCA 개요

### Plan
양산 검증에서 발견된 BUG-04 (backend abort 직전 PK 충돌) root cause 추적 + 재발 방지.

### Design (in-line)
2-step 진단:
1. PSQL로 `pg_constraint` 조회 → 테이블 식별
2. 식별된 테이블의 INSERT 코드 위치 → fix 적용

### Do
- `pg_constraint` 조회 → `sensor_data` (PK on time)
- INSERT 위치: [sensors.service.ts:82-100](smart-farm-mqtt/backend/src/modules/sensors/sensors.service.ts#L82-L100)
- try/catch 추가 (code 23505 catch)
- main.ts에 `unhandledRejection` + `uncaughtException` 안전망

### Check
`docs/03-analysis/rpi-activity-log-pk-trace.analysis.md` — Match Rate 88%.

### Act
반복 불필요. PK 확장 마이그레이션은 별도 사이클로 분리.

---

## 2. 구현 결과

### Backend 변경 (2 파일)
- **sensors.service.ts**: `Logger` import + `storeSensorData()`에 try/catch (PostgreSQL code 23505 = unique violation 명시적 catch + warn 로그 + null return)
- **main.ts**: `process.on('unhandledRejection')` + `process.on('uncaughtException')` 안전망

### 검증
- PSQL로 PK 충돌 재현 → backend port 3100 LISTEN 유지 + HTTP 응답 정상

### 정정 사항
- BUG-04 원래 명칭: "activity_logs PK 충돌"
- 실제 충돌 테이블: **sensor_data** (TimescaleDB hypertable, PK on time)
- 사이클 명칭은 그대로 유지(`rpi-activity-log-pk-trace`)하되 evidence/analysis에 정정 사항 명시

---

## 3. 미완료 / 후속

| 항목 | 우선순위 | 후속 |
|---|---|---|
| **sensor_data PK 확장 (composite key)** | HIGH | 별도 사이클 — 충돌 자체 제거 |
| 24시간 backend stability 검증 | MEDIUM | 운영 모니터링 (systemd Restart=on-failure) |
| 다른 hypertable PK 검토 | MEDIUM | sensor_data_hourly/daily 등 |
| MQTT QoS + retry 정책 | LOW | drop된 sensor 메시지 재발행 시 데이터 손실 minimize |

---

## 4. PDCA 메타데이터

```yaml
feature: rpi-activity-log-pk-trace
phase: archived
matchRate: 88
iterationCount: 1
nameCorrection: "activity_logs → sensor_data (실제 충돌 테이블)"
startedAt: 2026-05-24
archivedAt: 2026-05-24
archivedTo: docs/archive/2026-05/rpi-activity-log-pk-trace/
deliverables:
  - sensors.service.ts: storeSensorData try/catch + Logger
  - main.ts: unhandledRejection + uncaughtException 안전망
  - BUG-04 root cause 정정 (sensor_data PK on time)
nextCycles:
  - db-sensor-data-pk-expand (composite PK 마이그레이션)
  - rpi-backend-stability-monitoring (systemd Restart + 24h 검증)
```
