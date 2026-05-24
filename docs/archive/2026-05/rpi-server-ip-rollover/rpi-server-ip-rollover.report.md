---
template: report
version: 1.0
feature: rpi-server-ip-rollover
date: 2026-05-24
author: ohgane
project: smart-farm-mqtt
status: Completed
---

# rpi-server-ip-rollover 완료 보고서

> **Summary**: 양산 검증에서 SKIP된 E-4(server-ip 원격 변경) 완료. apply-server-ip.sh의 4가지 누락 fix + 실기 AT-01~07 통과. Match Rate **94%**. Robust 동작(tunnel.env 갱신 실패 시 옛 값 유지) 입증.
>
> **Owner**: 오정석 (sadojs@gmail.com)
> **Started**: 2026-05-24
> **Completed**: 2026-05-24
> **Duration**: 약 1시간

---

## 1. PDCA 개요

### Plan
`docs/01-plan/features/rpi-server-ip-rollover.plan.md` — 양산 검증 E-4 SKIP 항목 완료 목표.

### Design
`docs/02-design/features/rpi-server-ip-rollover.design.md` — apply-server-ip.sh 갱신 대상 현재(7개) + 누락(4개) 분석 → Do 단계 fix.

### Do
- apply-server-ip.sh 4가지 누락 fix
- PI에 배포
- AT-01~07 검증

### Check
`docs/03-analysis/rpi-server-ip-rollover.analysis.md` — Match Rate 94%.

### Act
반복 불필요.

---

## 2. 구현 결과

### apply-server-ip.sh 변경

| 추가/수정 | 라인 | 내용 |
|---|---|---|
| 추가 | env 갱신 루프 | `fallback-engine.env`도 갱신 대상에 추가 (BUG-01 유사 패턴 회피) |
| 신규 | 3-b 섹션 | `mosquitto bridge-cloud.conf address` sed 갱신 (rpi-local-broker-failover 사이클 산출물 통합) |
| 추가 | restart 목록 | `fallback-engine`, `mosquitto` 재시작 추가 |
| 수정 | 헤더 주석 | 갱신 대상 7→11개, 재시작 4→6개로 문서화 |

### 검증 (AT 7건, 1건 wifi 대체)

| AT | 결과 |
|---|---|
| AT-01 4가지 fix 적용 | ✅ |
| AT-02 server-ip 변경 | ✅ HTTP success |
| AT-03 5개 위치 갱신 | ✅ |
| AT-04 tunnel robust (옛 값 유지) | ✅ |
| AT-05 eth0 직결 검증 | ⏭️ wifi LAN 대체 |
| AT-06 원복 | ✅ |
| AT-07 lgw-dev 영향 0 | ✅ |

### 핵심 입증
- **잘못된 IP 배포 시에도 tunnel은 살아있음** (tunnel.env 갱신 실패 시 옛 값 유지). 양산 운영 시 안전 마진 확보.
- **bridge-cloud.conf address 갱신**으로 #5 사이클 산출물과 정합성 확보. 다음 양산 PI는 server-ip 변경 시 bridge target도 자동 갱신.

---

## 3. 미완료 / 후속

| 항목 | 후속 |
|---|---|
| eth0 static 192.168.0.100 직결 SSH (케이블 검증) | 운영 절차서에 명시 (별도 사이클 불필요) |
| 프로덕션 서버(175.206.245.234) 실제 전환 | 별도 사이클 `rpi-prod-server-switch` |

---

## 4. PDCA 사이클 메타데이터

```yaml
feature: rpi-server-ip-rollover
phase: archived
matchRate: 94
iterationCount: 1
startedAt: 2026-05-24
archivedAt: 2026-05-24
archivedTo: docs/archive/2026-05/rpi-server-ip-rollover/
deliverables:
  - apply-server-ip.sh 4가지 fix (fallback-engine.env + bridge-cloud.conf + restart 2개)
  - AT-01~07 검증 통과
  - Robust 동작 입증
nextCycles:
  - rpi-prod-server-switch (실제 프로덕션 전환)
relatedCycles:
  - rpi-golden-image-mass-production (E-4 SKIP의 출처)
  - rpi-local-broker-failover (bridge-cloud.conf 도입)
```
