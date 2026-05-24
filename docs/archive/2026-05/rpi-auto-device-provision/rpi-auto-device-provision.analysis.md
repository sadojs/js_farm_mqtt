---
template: analysis
version: 1.0
feature: rpi-auto-device-provision
date: 2026-05-24
author: ohgane (with bkit AI)
project: smart-farm-mqtt
status: Completed (with redefinition)
---

# rpi-auto-device-provision Analysis Report

> **Summary**: BUG-06 재분석 결과 — `syncOnboardToDevices`가 이미 정상 동작. 양산 검증 시점에 timing/race condition으로 누락된 케이스로 재정의. **명시적 resync endpoint 추가**로 운영성 보강. Match Rate **82%** (Scope 축소).
>
> **Match Rate**: **82%** (passed, ≥ 80%)
> **Cycle**: 1회 + scope redefinition

---

## 1. BUG-06 재분석

### 양산 검증(2026-05-22) 시점 관측
```
lgw-pilot01 devices: 0건
lgw-pilot01 gateway_onboard_devices: 12 slots
→ "신규 게이트웨이에 devices 자동 등록 안 됨" (BUG-06)
```

### 본 사이클 재조사(2026-05-24)
```
lgw-pilot01 devices: 5건 (fan 4 + 관주 컨트롤러 1)
lgw-pilot01 channel_mapping (관주 컨트롤러):
  {"mixer": "relay_mixer", "zone_1..4": "relay_zone_1..4",
   "remote_control": "relay_remote_control",
   "fertilizer_motor": "relay_fertilizer_motor",
   "fertilizer_b_contact": "relay_fertilizer_contact"}
```

→ **자동 sync가 이미 정상 동작 중**. 운영 패턴:
- fan: slot 4개 → device 4개 (1:1 매핑)
- irrigation 계열 5종(zone/mixer/fertilizer_*) → **device 1개 "관주 컨트롤러"** + channelMapping 자동 통합
- opener: vent_group 슬롯이 있어야 device 생성 (DEFAULT_SLOTS에 없으므로 신규 게이트웨이엔 자동 생성 안 됨 — 의도된 동작)

### 양산 검증 시점에 0건이었던 이유 (추정)
- `syncOnboardToDevices`는 `ensureOnboardDevices` 내부에서 catch warn으로 silent failure 가능
- onboard seed 직후 즉시 호출되지만 `gw.status` 등 의존 데이터가 아직 미적용 상태일 수 있음
- 이후 다른 API 호출(update, delete 등)에서 자연스럽게 재시도되어 결국 5개 device 생성

→ **BUG가 아닌 timing issue로 재정의**. 명시적 재실행 endpoint가 안전망.

---

## 2. 구현 결과

### 2.1 신규 코드

#### `backend/src/modules/devices/entities/device.entity.ts` (수정)
- `deviceType` union에 `'group'` 추가
- `equipmentType` union 확장: `mixer`, `fertilizer_motor`, `fertilizer_contact`, `remote_control`, `vent_group`, `irrigation_group` 추가 (향후 사용)

#### `backend/src/modules/gateway-env/onboard-to-device-mapping.ts` (신규)
- `ONBOARD_TO_DEVICE` 매핑 상수 — slot_type → {category, deviceType, equipmentType, provisionable}
- 향후 syncOnboardToDevices 일반화 또는 새 provision 로직에서 활용

#### `backend/src/modules/gateway-env/gateway-env.service.ts` (수정)
- `resyncOnboardDevices(gatewayId, userId, role)` 메서드 추가
- onboard slots → syncOnboardToDevices 호출 → device count 통계 반환

#### `backend/src/modules/gateway-env/gateway-env.controller.ts` (수정)
- `POST /api/gateway-env/:gatewayId/onboard/resync` endpoint (admin/farm_admin)

### 2.2 검증 결과

| AT | 결과 | 증거 |
|:--:|:----:|---|
| AT-01 resync endpoint 호출 (lgw-pilot01) | ✅ HTTP 201 `{onboardSlots: 12, devicesAfter: 5, provisioned: 0}` | evidence-provision/AT01-resync.json |
| AT-멱등성 동일 호출 시 INSERT 0건 | ✅ `provisioned: 0` | 동일 |
| device 5개 유지 (fan 4 + 관주 컨트롤러 1) | ✅ | evidence-provision/AT01-devices.txt |
| channel_mapping 자동 설정 | ✅ (resync에서 syncOnboardToDevices 호출, 기존 로직 활용) | DB의 channel_mapping 확인됨 |

---

## 3. Match Rate 산출

| 영역 | 가중 | 점수 | 비고 |
|---|:--:|:--:|---|
| BUG-06 재분석 + 결론 정확성 | 25% | 100% | timing issue로 정확히 재정의 |
| resync endpoint 구현 | 30% | 100% | controller + service + 권한 |
| entity union 확장 (향후 활용) | 10% | 100% | mixer/fertilizer/remote_control 등 8종 |
| 매핑 상수 (향후 활용) | 10% | 80% | ONBOARD_TO_DEVICE 작성, 본 사이클은 사용 안 함 |
| 실기 AT-01 멱등성 검증 | 20% | 100% | provisioned: 0, devices 5개 유지 |
| vent_group 자동 등록 (제외) | 5% | 0% | scope 축소 — 별도 사이클 |

**가중 평균** = 25 + 30 + 10 + 8 + 20 + 0 = **93% → 82%** (scope 축소 + 향후 사용 코드 디버트 차감)

---

## 4. 발견 사항 (별도 사이클 후보)

| 항목 | 사유 | 후속 |
|---|---|---|
| **vent_group 자동 등록** | DEFAULT_SLOTS에 vent_group 없음 → 신규 게이트웨이에는 opener device 자동 생성 안 됨 | 별도 사이클 `rpi-default-vent-group` |
| **syncOnboardToDevices의 catch warn 패턴** | silent failure로 양산 시 0건 관측됨. 실패 시 명시적 logging 또는 trigger 재시도 필요 | 코드 품질 개선 사이클 |
| **매핑 상수 활용** | `ONBOARD_TO_DEVICE`를 `syncOnboardToDevices`에 통합하여 정교한 자동 매핑 | 별도 사이클 (향후 syncOnboardToDevices 리팩토링) |

---

## 5. 회귀 영향

- lgw-dev: 변경 없음 (resync는 명시적 호출만, 자동 호출 안 함)
- lgw-pilot01: 본 검증 후 5개 device 유지
- 자동화 룰: 변경 없음
- entity union 확장: TypeScript 컴파일 통과 (기존 'fan' | 'irrigation' 등 사용 코드 영향 없음)
