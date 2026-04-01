# Plan: 관수 장비 릴레이 채널 동적 매핑 (MQTT 버전)

> **Feature**: irrigation-relay-mapping (MQTT)
> **Project**: smart-farm-mqtt
> **Date**: 2026-03-30
> **Reference**: smart-farm-platform의 동일 기능 구현 완료 (Match Rate 96%)

---

## 개요

smart-farm-platform에서 완료된 관수 릴레이 채널 동적 매핑 기능을 smart-farm-mqtt 프로젝트에 동일하게 적용한다.

현재 switch 코드 매핑이 하드코딩되어 있어 농장마다 다른 배선 순서를 반영할 수 없음.
장비별 DB 저장 + admin/farm_admin UI 수정 + 원격제어 동작 방식을 개선한다.

**MQTT 버전 특이사항**: Tuya API 대신 `mqttService.controlDevice(gatewayId, friendlyName, payload)` 사용.

---

## 현황 — 하드코딩 위치

| 파일 | 내용 |
|------|------|
| `irrigation-scheduler.service.ts:29-35` | `ZONE_SWITCH_MAP` 상수 (switch_2~switch_6) |
| `irrigation-scheduler.service.ts:205` | mixer 항상 ON/OFF (`switch_usb1`) — `mixer.enabled` 체크 없음 |
| `irrigation-scheduler.service.ts:217,230` | fertilizer `switch_usb2` 하드코딩 |
| `irrigation-scheduler.service.ts:224-233` | fertilizer OFF가 ON 가드 바깥 — ON 없이 OFF 발송 버그 존재 |
| `automation-runner.service.ts` | switch_1 등 하드코딩 여부 확인 필요 |
| `Devices.vue` | switch 토글 UI 하드코딩 여부 확인 필요 |
| `Groups.vue` | switch 토글 UI 하드코딩 여부 확인 필요 |

---

## 요구사항

### FR-01: 신규 기본 매핑

| function_key | 기본 switch | 표시 이름 |
|-------------|------------|---------|
| remote_control | switch_1 | 원격제어 ON/OFF |
| fertilizer_b_contact | switch_6 | 액비/교반기 B접점 |
| zone_1 | switch_2 | 1구역 관수 |
| zone_2 | switch_3 | 2구역 관수 |
| zone_3 | switch_4 | 3구역 관수 |
| zone_4 | switch_5 | 4구역 관수 |
| mixer | switch_usb1 | 교반기 |
| fertilizer_motor | switch_usb2 | 액비모터 |

### FR-02: DB 저장

`devices` 테이블에 `channel_mapping JSONB DEFAULT NULL` 컬럼 추가.
NULL이면 기본값 사용. migration SQL 추가 (migration-002-channel-mapping.sql).

### FR-03: 채널 매핑 설정 UI

admin / farm_admin만 표시. 드롭다운으로 switch 코드 선택.
`PATCH /devices/:id/channel-mapping` API.

### FR-04: 원격제어 동작 (MQTT 적용)

- ON → `fertilizer_b_contact`(switch_6) 자동 ON (MQTT 전송)
- OFF → `fertilizer_b_contact` OFF + 나머지 관수 관련 스위치 전부 강제 OFF (MQTT 전송)
- OFF 동안 관수 스케줄러 명령 스킵

### FR-05: 장비 관리 UI 표시 변경

| 변경 전 | 변경 후 |
|--------|--------|
| switch_1 토글 "타이머 전원/B접점" (조작 가능) | remote_control 토글 "원격제어 ON/OFF" (조작 가능) |
| switch_usb1 토글 "교반기/B접점" (조작 가능) | fertilizer_b_contact 토글 "액비/교반기 B접점" (표시만) |

### FR-06: 백엔드 동적 매핑 적용

- `ZONE_SWITCH_MAP` 제거 → DB 매핑 런타임 적용
- `buildTimeline(conditions)` → `buildTimeline(conditions, mapping)`
- mixer는 `mixer.enabled && mapping['mixer']` 조건 시에만 ON/OFF
- fertilizer ON/OFF 페어링 보장 (ON 없이 OFF 발송 버그 수정)
- 원격제어 OFF 상태 확인 후 스케줄 스킵

### FR-07: 관수 위저드 4단계 UI 업데이트

- zone 5 제거 (zone 1~4만 지원)
- "타이머 전원/B접점" 행 제거
- `channelMapping` prop 연동 (switch-hint 표시, admin 편집 드롭다운)
- `IrrigationConditions` 타입에서 `timerSwitch` 제거

---

## 수정 파일 목록 (총 14개)

### Backend (6개)

| 파일 | 작업 |
|------|------|
| `backend/database/migration-002-channel-mapping.sql` | 신규: channel_mapping 컬럼 추가 |
| `backend/src/modules/devices/channel-mapping.constants.ts` | 신규: 기본 매핑 상수 |
| `backend/src/modules/devices/entities/device.entity.ts` | channelMapping 필드 추가 |
| `backend/src/modules/devices/devices.service.ts` | getEffectiveMapping, updateChannelMapping, controlDevice 원격제어 연동 |
| `backend/src/modules/devices/devices.controller.ts` | PATCH :id/channel-mapping 엔드포인트 추가 |
| `backend/src/modules/automation/irrigation-scheduler.service.ts` | ZONE_SWITCH_MAP 제거, 동적 매핑, mixer.enabled 체크, 버그 수정 |

### Frontend (8개)

| 파일 | 작업 |
|------|------|
| `frontend/src/types/device.types.ts` | ChannelMapping 인터페이스, 상수 추가 |
| `frontend/src/types/automation.types.ts` | timerSwitch 제거 |
| `frontend/src/utils/automation-helpers.ts` | zone 4개로 변경, timerSwitch 제거 |
| `frontend/src/stores/device.store.ts` | getEffectiveMapping, updateChannelMapping 추가 |
| `frontend/src/api/device.api.ts` | PATCH channel-mapping API 호출 추가 |
| `frontend/src/views/Devices.vue` | 원격제어 토글, 채널 매핑 패널 |
| `frontend/src/views/Groups.vue` | 원격제어 토글, 채널 매핑 패널 |
| `frontend/src/components/automation/StepIrrigationCondition.vue` | channelMapping prop, zone 4개, switch-hint |
| `frontend/src/components/automation/RuleWizardModal.vue` | localChannelMapping, handleMappingUpdate |

---

## smart-farm-platform 대비 차이점

| 항목 | smart-farm-platform | smart-farm-mqtt |
|------|--------------------|-----------------|
| 디바이스 제어 API | `TuyaService.sendDeviceCommand()` | `MqttService.controlDevice(gatewayId, friendlyName, payload)` |
| 원격제어 상태 확인 | `TuyaService.getDeviceStatus()` | DB/MQTT 상태 없음 → 스케줄 스킵은 conditions 기반으로 처리 |
| 스위치 코드 형식 | Tuya 형식 (switch_1 등) | Zigbee2MQTT 형식 (state ON/OFF 등) — `buildMqttCommand()` 변환 필요 |
| Tuya 프로젝트 | `TuyaProject` 엔티티 | 불필요 |
| 원격제어 OFF → 전체 OFF | Tuya API 호출 | MQTT 다중 커맨드 전송 |

---

## 우선순위 및 구현 순서

1. **Backend 신규 파일** — migration SQL, channel-mapping.constants.ts
2. **Backend 엔티티/서비스** — device.entity, devices.service, devices.controller
3. **Backend 스케줄러** — irrigation-scheduler.service (핵심 버그 수정 포함)
4. **Frontend 타입/스토어** — device.types, automation.types, device.store, device.api
5. **Frontend 뷰** — Devices.vue, Groups.vue
6. **Frontend 위저드** — automation-helpers, StepIrrigationCondition, RuleWizardModal

---

## 완료 기준

- [ ] 관수 장비 채널 매핑이 DB에 저장되고 런타임에 적용됨
- [ ] 채널 매핑 설정 UI (admin/farm_admin 전용) 동작
- [ ] 원격제어 ON/OFF 연동 동작 (MQTT)
- [ ] mixer.enabled 체크 정상 동작
- [ ] fertilizer ON/OFF 페어링 버그 수정
- [ ] 관수 위저드 4단계 zone 4개, switch-hint 표시
- [ ] Match Rate >= 90%
