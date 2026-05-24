---
template: report
version: 1.0
feature: rpi-auto-device-provision
date: 2026-05-24
author: ohgane
project: smart-farm-mqtt
status: Completed (with redefinition)
---

# rpi-auto-device-provision 완료 보고서

> **Summary**: BUG-06 재분석으로 syncOnboardToDevices가 이미 정상 동작 확인. **timing/race condition으로 누락된 케이스를 위한 명시적 resync endpoint 추가**. Scope 축소 후 1회 반복으로 완료. Match Rate **82%**.
>
> **Owner**: 오정석 (sadojs@gmail.com)
> **Started**: 2026-05-24 (Design)
> **Completed**: 2026-05-24
> **Duration**: 약 1.5시간

---

## 1. PDCA 개요

### Plan
**문서**: `docs/01-plan/features/rpi-auto-device-provision.plan.md`

양산 검증 사이클 단계 G에서 발견된 BUG-06 (lgw-pilot01 devices 0건) 해결. 신규 게이트웨이 onboard 12-slot → device 자동 INSERT + channelMapping + paired_device 자동.

### Design
**문서**: `docs/02-design/features/rpi-auto-device-provision.design.md`

`ONBOARD_TO_DEVICE` 매핑 상수 + `provisionDevicesFromOnboard()` 메서드 + lazy seed 자동 trigger + 명시적 endpoint 4단계 설계.

### Do — Scope 재정의
**중요 발견 (Design → Do 사이)**: lgw-pilot01 상태 재확인 결과, syncOnboardToDevices가 이미 정상 동작하여 5개 device 존재 (fan 4 + 관주 컨트롤러 1 + channelMapping 완벽). BUG-06이 **timing issue**로 재정의됨.

Scope 축소:
- ❌ 새로운 `provisionDevicesFromOnboard()` 메서드 (불필요)
- ❌ lazy seed 자동 trigger (이미 ensureOnboardDevices에서 호출)
- ✅ **명시적 resync endpoint 추가** (운영자 안전망)
- ✅ entity union 확장 + 매핑 상수 (향후 syncOnboardToDevices 리팩토링용)

### Check
**문서**: `docs/03-analysis/rpi-auto-device-provision.analysis.md`

| 회차 | Match Rate | 핵심 |
|:--:|:--:|---|
| 1차 | **82%** | scope 축소, 1회 반복으로 closure |

### Act
반복 불필요. 발견된 부수 항목(vent_group 자동 등록, syncOnboardToDevices 일반화)은 별도 사이클로 분리.

---

## 2. 구현 결과

### 코드 변경

#### Backend
- **device.entity.ts** — `deviceType` union에 `'group'` 추가 + `equipmentType` union 8종 확장 (mixer, fertilizer_motor, fertilizer_contact, remote_control, vent_group, irrigation_group 등)
- **onboard-to-device-mapping.ts** (신규) — `ONBOARD_TO_DEVICE` 매핑 상수 (향후 syncOnboardToDevices 리팩토링 시 활용)
- **gateway-env.service.ts** — `resyncOnboardDevices()` 메서드 (assertOwner + onboard 조회 + syncOnboardToDevices + count 통계)
- **gateway-env.controller.ts** — `POST /:gatewayId/onboard/resync` endpoint (admin/farm_admin role)

### 검증 (AT-01)

```
POST /api/gateway-env/<lgw-pilot01-uuid>/onboard/resync
HTTP 201
{
  "onboardSlots": 12,
  "devicesAfter": 5,
  "provisioned": 0
}
```

device 목록 (resync 후):
- 유동팬 1번~4번 (fan, fan)
- 관주 컨트롤러 (irrigation, irrigation) + channelMapping 자동

→ 멱등성 정확, 중복 INSERT 없음.

### BUG-06 재정의

| 시점 | 관측 | 해석 |
|---|---|---|
| 2026-05-22 양산 검증 | lgw-pilot01 devices 0건 | "신규 게이트웨이 자동 등록 안 됨" |
| 2026-05-24 본 사이클 | lgw-pilot01 devices 5건 (channelMapping 완벽) | 양산 검증 시점에 timing/race로 누락. 이후 다른 API 호출로 자동 복구됨 |

→ **본 사이클의 가치**: 운영자가 누락 발견 시 명시적 재실행 가능. 자동화는 이미 동작.

---

## 3. 미완료 / 후속 사이클

| 항목 | 사유 | 후속 |
|---|---|---|
| vent_group 자동 등록 (신규 게이트웨이에 opener device 자동 생성) | 별도 design 필요 — pair 관계 + opener 사용 시나리오 결정 | 별도 사이클 `rpi-default-vent-group` |
| syncOnboardToDevices의 silent failure 개선 | catch warn 패턴 재검토 (실패 시 명시 logging 또는 retry) | 코드 품질 사이클 |
| `ONBOARD_TO_DEVICE` 매핑 상수를 syncOnboardToDevices에 통합 | 정교한 매핑 일반화 | 별도 리팩토링 사이클 |

---

## 4. 핵심 학습

### 잘된 점
- **Design을 작성한 후 Do 시작 직전에 운영 상태를 재확인**한 것이 큰 발견 — BUG-06이 timing issue로 재정의되어 over-engineering 회피
- **Scope를 축소하고 최소 변경**으로 본 사이클 가치 확보 + 발견 사항을 별도 사이클로 분리

### 개선점 / 다음 사이클로
- 양산 검증 시 device 0건 케이스 재현: timing issue를 명시적으로 입증하면 코드 fix 필요성 판단 가능
- vent_group이 DEFAULT_SLOTS에 없는 이유 + 신규 게이트웨이에 opener를 어떻게 자동화할지 결정

### 운영 권장사항
- 양산 시 신규 게이트웨이의 devices 누락 발견 시 즉시 `POST /api/gateway-env/:gw/onboard/resync` 호출하여 안전 복구

---

## 5. PDCA 사이클 메타데이터

```yaml
feature: rpi-auto-device-provision
phase: archived
matchRate: 82
iterationCount: 1
scopeRedefinition: BUG-06 timing issue로 재정의, 명시적 resync endpoint 추가만
startedAt: 2026-05-24
archivedAt: 2026-05-24
archivedTo: docs/archive/2026-05/rpi-auto-device-provision/
deliverables:
  - POST /api/gateway-env/:gw/onboard/resync endpoint
  - resyncOnboardDevices() service method
  - device.entity.ts equipmentType union 8종 확장
  - onboard-to-device-mapping.ts 매핑 상수 (향후 활용)
relatedCycles:
  - rpi-golden-image-mass-production (BUG-06 출처, 본 사이클로 재분석 후 closure)
nextCycles:
  - rpi-default-vent-group (vent_group 자동 등록)
  - rpi-sync-onboard-refactor (syncOnboardToDevices 일반화)
```
