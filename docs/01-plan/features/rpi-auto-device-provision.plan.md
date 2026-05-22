---
template: plan
version: 1.2
feature: rpi-auto-device-provision
date: 2026-05-23
author: ohgane
project: smart-farm-mqtt
status: Draft
---

# rpi-auto-device-provision Planning Document

> **Summary**: 신규 게이트웨이 등록 후 onboard 12-slot은 lazy seed로 자동 생성되지만 `devices` 테이블은 0건이라 자동화 룰을 만들 수 없는 BUG-06을 해결. **신규 게이트웨이 자동 device provision** — onboard slot 12개를 자동으로 devices INSERT + channelMapping + 표준 device_type/category 자동 부여 + paired_device (개폐기 인터록) 자동 매핑.
>
> **Project**: smart-farm-mqtt
> **Date**: 2026-05-23
> **Status**: Draft

---

## 1. Overview

### 1.1 Purpose
양산 검증에서 발견: 신규 게이트웨이(lgw-pilot01)에 onboard slot 12개는 lazy seed로 자동 생성되지만 `devices` 테이블은 비어있어, **자동화 룰을 만들 수가 없음** — 사용자가 UI에서 12번 클릭으로 등록해야 함.

### 1.2 Background
- lgw-dev는 운영 중에 사용자가 수동 등록한 devices 35개 보유
- lgw-pilot01 등록 직후 devices 0건 — 양산 시 매번 12개 수동 등록 비효율
- onboard slot은 표준 매핑(fan_1=핀17, vent_open=핀12 등)이라 자동화 가능

### 1.3 Related
- [BUG-06](../../evidence/BUGS-found.md#bug-06)
- `gateway-env.service.ts` lazy seed 메커니즘 — 같은 패턴 적용
- `devices` entity + `gateway_onboard_devices` entity의 1:1 매핑

---

## 2. Scope

### 2.1 In Scope
- [ ] **FR-01**: onboard slot → device 자동 매핑 규칙 정의
  - fan_1~4 → device(category=fan, type=actuator, name=유동팬 N번)
  - irrigation_zone_1~4 → device(category=irrigation, type=actuator, name=N구역 관주)
  - mixer → device(category=irrigation, type=actuator, equipment_type=mixer, name=교반기)
  - fertilizer_motor → device(category=irrigation, type=actuator, equipment_type=fertilizer_motor)
  - fertilizer_contact → device(category=irrigation, type=actuator, equipment_type=fertilizer_contact)
  - remote_control → device(category=control, type=actuator, name=원격제어)
  - vent_open + vent_close → 1쌍의 device + paired_device_id 자동 매핑(인터록)
- [ ] **FR-02**: lazy provision: 신규 게이트웨이 `/api/devices?gatewayId=:uuid` GET 시 또는 onboard seed 후 자동 devices INSERT
- [ ] **FR-03**: 옵션 플래그: 사용자가 자동 provision 끄기 가능 (`?autoProvision=false`)
- [ ] **FR-04**: channelMapping 자동 설정 (관수 컨트롤러 등)
- [ ] **FR-05**: 기존 게이트웨이(lgw-dev 등)에는 영향 없음 — provision은 onboard slot ↔ device 1:1 매핑 없는 신규 게이트웨이에만 적용

### 2.2 Out of Scope
- Zigbee 센서 자동 페어링 (사용자 액션 필요)
- 자동화 룰 자동 생성 (이건 농장 운영자 결정 영역)
- 다양한 8CH/12CH 변형 지원 (12CH 기준만)

---

## 3. Requirements

### 3.1 FR

| ID | Requirement | Priority | Status |
|----|---|---|---|
| FR-01 | onboard slot → device 표준 매핑 규칙 | High | Pending |
| FR-02 | 신규 게이트웨이 자동 provision (devices INSERT) | High | Pending |
| FR-03 | autoProvision 옵션 (off 가능) | Medium | Pending |
| FR-04 | channelMapping 자동 설정 (관수 컨트롤러) | Medium | Pending |
| FR-05 | 기존 게이트웨이 영향 0 | High | Pending |

---

## 4. Success Criteria

### 4.1 DoD
- [ ] 새 게이트웨이 등록 + onboard seed 직후 `GET /api/devices?gatewayId=:uuid` 12개 device 반환
- [ ] 자동화 룰 등록 페이지에서 fan_1~4, zone_1~4 선택 가능
- [ ] vent_open ↔ vent_close paired_device_id 정상 매핑 (인터록 자동 적용)
- [ ] 양산 검증 시 단계 G(장치 등록) 클릭 0회 (이전 12회+)
- [ ] Match Rate ≥ 90%

### 4.2 AT
- AT-01: lgw-pilot01에 lazy provision 트리거 → devices 12건 정확히 INSERT
- AT-02: 12개 device 각각의 category/type/equipment_type 정확
- AT-03: vent_open 의 paired_device_id = vent_close 의 id
- AT-04: autoProvision=false 호출 → devices 0건 유지
- AT-05: lgw-dev 재조회 → 기존 devices 35건 유지 (영향 0)

---

## 5. Implementation Sketch

### Backend
- `gateway-env.service.ts`에 `provisionDevicesFromOnboard(gatewayUuid)` 추가
- onboard seed lazy 호출 후 자동 트리거 (또는 `/api/devices?gatewayId=...&provision=auto` 명시 호출)
- 표준 매핑 상수 `DEFAULT_DEVICE_MAPPING` 추가

### Pi 측
- 변경 없음 — backend만으로 처리

### Frontend
- Devices 페이지 표시만 갱신 (자동 등록된 device 보임)

---

## 6. Risks

| Risk | Mitigation |
|---|---|
| 자동 provision으로 잘못된 device 생성 시 사용자 혼란 | autoProvision=false 옵션 + 명시적 trigger endpoint |
| 기존 게이트웨이 재트리거 시 중복 INSERT | 이미 device 있으면 skip (idempotent) |
| 12CH 외 변형 (8CH 등) 지원 누락 | onboard slot이 동적 생성되므로 slot 개수 기반으로 매핑 |

---

## 7. Estimated Effort

- 매핑 규칙 정의 + 코드: 3시간
- 검증 (lgw-pilot01 + 새 PI): 2시간
- 총: **5시간 (반나절)**
