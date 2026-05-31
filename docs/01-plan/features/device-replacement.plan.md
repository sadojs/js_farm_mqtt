---
template: plan
version: 1.2
description: 동일 기종 장치 교체 (Hot Swap) — 기존 룰/설정 보존
---

# device-replacement Planning Document

> **Summary**: 고장난 장치를 동일 기종의 새 장치로 교체할 때 기존 자동제어룰·채널 매핑·구역 할당·페어링 정보를 그대로 보존하는 Hot Swap 기능
>
> **Project**: smart-farm-mqtt
> **Version**: 0.x
> **Author**: ohjeongseok
> **Date**: 2026-05-29
> **Status**: Draft

---

## 1. Overview

### 1.1 Purpose

농장 운영 중 zigbee/onboard 장치가 고장났을 때 운영자가 새 동일 기종 장치로 빠르게 교체할 수 있어야 한다. 현재는 **삭제 → 신규 등록 → 자동제어룰 재설정 → 채널 매핑 재설정**의 절차가 필요해 운영 중단이 발생하고 실수 가능성이 크다.

**해결**: 기존 `devices.id`를 유지한 채 zigbee 식별자(`zigbee_ieee`, `friendly_name`)만 새 장치로 교체. 모든 외래 키 참조(automation_rules, paired_device, channel_mapping, house_id)는 그대로 보존.

### 1.2 Background

운영 현장에서 발생하는 실제 사고들:
- 온습도 센서 배터리 만료 → 같은 모델로 교체 시 모든 자동제어룰의 `sensor_device_id`를 일일이 재지정해야 함
- 관수 컨트롤러 릴레이 보드 고장 → 8채널 매핑 + remote_control 연동 + 진행 중인 룰 모두 재설정
- 페어 개폐기 한쪽 고장 → 페어 관계 + 인터록 설정 재구성

**핵심 제약**:
- z2m 페어링 단계에서 device는 새 IEEE 주소를 받음 (이전 IEEE와 다름)
- backend는 `friendly_name` 또는 `ieee`로 device를 식별 — 둘 다 바뀜
- 모든 자동제어룰 / 채널 매핑 / 페어링 / device_settings.disabledChannels 등은 `devices.id` (UUID) 기준 — 이를 유지하면 자동 보존됨

### 1.3 Related Documents

- 기존 device 등록 흐름: [docs/DEVICE_CONTROL_LOGIC.md](../../DEVICE_CONTROL_LOGIC.md)
- z2m 페어링: backend/src/modules/mqtt/mqtt-bridge.handler.ts (handleBridgeDevices)
- channel_mapping 보존 패턴: 기존 device-replacement 디자인의 선례

---

## 2. Scope

### 2.1 In Scope

- [ ] **Zigbee 장치 교체** — 온습도 센서, 우적 센서, 관수 컨트롤러(릴레이 보드), 단일 환풍기, 개폐기 페어
- [ ] **Onboard 장치 교체** — 게이트웨이(Pi) SD/하드웨어 교체 시나리오에서 onboard slot 재바인딩
- [ ] **호환성 검증** — `zigbee_model` 일치 검사 + 채널 수(8CH/12CH) 일치 + `equipment_type` 일치
- [ ] **스캔 UX** — z2m permit_join 모드 활성화 후 새로 등장한 device 목록에서 선택
- [ ] **이관 미리보기** — 교체 전 영향 받는 룰/매핑/페어 개수 표시 ("자동제어룰 N개, 채널 매핑 M개, 페어링 1쌍이 보존됩니다")
- [ ] **트랜잭션 처리** — 교체 중 실패 시 원자적 rollback (devices.id 유지하므로 zigbee_ieee/friendly_name만 swap)
- [ ] **활동 로그** — `device.replace` action으로 누가/언제/어떤 device를 무엇으로 교체했는지 기록
- [ ] **페어 개폐기 일괄 교체** — open + close 두 device를 한 번의 액션으로 (또는 순차 안내)

### 2.2 Out of Scope

- 다른 기종으로의 교체 (예: 8CH → 12CH 컨트롤러, 다른 vendor 센서) — 별도 마이그레이션 기능으로 추후
- z2m이 인식하지 못하는 zigbee 장치 (수동 등록 영역)
- 게이트웨이 자체 교체 (이미 `lgw-pilot01 → hk-house` 기능으로 별도 처리됨)
- 룰 데이터 자체의 변경 — 룰 내용은 그대로, 참조 device.id만 유지

---

## 3. Requirements

### 3.1 Functional Requirements

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-01 | 운영자가 구역관리/환경설정 페이지의 device 카드에서 "🔄 교체" 액션을 호출할 수 있다 | High | Pending |
| FR-02 | 시스템이 해당 device의 `zigbee_model` + `equipment_type` + 채널 수 정보를 기반으로 호환 device 검색 기준을 자동 설정한다 | High | Pending |
| FR-03 | z2m `permit_join` 모드를 자동 활성화하고 새로 페어링된 device 중 호환 조건을 만족하는 항목만 후보로 보여준다 | High | Pending |
| FR-04 | 교체 전 영향 분석 패널에 보존될 자원 개수를 표시한다 (자동제어룰 N, 채널 매핑 K키, 페어링 0/1, 진행 중 관수 timeline 0/1) | High | Pending |
| FR-05 | 교체 실행 시 `devices.id`를 유지하며 `zigbee_ieee`, `friendly_name`, `zigbee_model` (필요 시), `last_seen`, `online` 필드만 swap한다 | High | Pending |
| FR-06 | 페어 개폐기는 **한쪽만 교체 가능** — 양쪽 동시 강제 없음. `paired_device_id` 양방향 관계는 그대로 보존 | High | Pending |
| FR-07 | Onboard 장치(예: 게이트웨이 자체 교체)는 `gateway_id` 동일성 가정 하에 `gateway_onboard_devices`의 `slot_key`/`gpio_pin`만 보존하고 새 SD 카드의 device 객체와 재바인딩한다 | Medium | Pending |
| FR-08 | 교체 후 옛 device(이전 IEEE)는 z2m에서 자동 unpair + activity_logs에 기록 (옛 device를 따로 남기지 않음) | Medium | Pending |
| FR-09 | 교체 시점에 작동 중인 모든 자원(관수 timeline, 펄스 사이클, 릴레이 ON 상태)은 **사용자 confirm 없이 자동으로 강제 중지** 후 진행한다 — 모든 채널 OFF 상태로 강제. 정책 변경 (이전: 명시 confirm 요구) | High | Pending |
| FR-13 | 진입 위치는 **환경설정 Zigbee 탭의 device row 액션 영역만** — 구역관리 진입 경로 제거 (오작동 방지) | High | Pending |
| FR-10 | 실패 시 (페어링 timeout, 호환성 미달, DB 트랜잭션 실패) 원자적 rollback + 상세 에러 메시지 표시 | High | Pending |
| FR-11 | admin은 farm_admin 소유 device도 교체 가능 (역할별 권한 동일하게 적용) | Medium | Pending |
| FR-12 | 활동 로그 `device.replace`에 oldIeee, newIeee, deviceId, preservedRules[], preservedMappings 기록 | Medium | Pending |

### 3.2 Non-Functional Requirements

| Category | Criteria | Measurement Method |
|----------|----------|-------------------|
| Performance | 교체 전체 처리 시간 < 60초 (z2m 페어링 최대 30s 포함) | 서버 로그 측정 |
| Reliability | 트랜잭션 원자성 — 부분 실패 시 DB 상태 변화 0건 | TypeORM transaction + 실패 시나리오 테스트 |
| Auditability | 모든 교체 액션 activity_logs 100% 기록 + admin이 조회 가능 | 활동 로그 페이지 검증 |
| UX | 영향 분석 패널 표시까지 < 1초 | frontend 측정 |
| Safety | 진행 중 관수/펄스 룰이 있으면 명시 confirm 없이는 교체 불가 | 시나리오 테스트 |

---

## 4. Success Criteria

### 4.1 Definition of Done

- [ ] FR-01 ~ FR-12 모든 기능 요구사항 구현 + E2E 검증
- [ ] Backend `POST /devices/:id/replace` endpoint (body: `{ newIeee, newFriendlyName }`) — 트랜잭션 + 활동 로그
- [ ] Frontend 교체 모달 — 스캔 → 후보 선택 → 영향 미리보기 → confirm → 결과
- [ ] 호환성 검증 함수 단위 테스트 (zigbee_model, 채널 수, equipment_type)
- [ ] 페어 개폐기 트랜잭션 교체 시나리오 PASS
- [ ] 진행 중 관수 timeline 있을 때 confirm 미동의 시 차단 PASS
- [ ] DEVICE_CONTROL_LOGIC.md에 §교체 정책 섹션 추가
- [ ] smart-farm-test SKILL.md에 §14 교체 회귀 테스트 시나리오 추가

### 4.2 Quality Criteria

- [ ] 빌드 (vue-tsc + nest build) PASS
- [ ] DB 마이그레이션 불필요 (스키마 변경 없음 — 기존 devices 컬럼 활용)
- [ ] 새 z2m bridge 메시지 처리에 회귀 없음 (handleBridgeDevices 호환)
- [ ] 활동 로그에 PII / 민감정보 미포함

---

## 5. Risks and Mitigation

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| 옛 device와 새 device IEEE가 momentarily 둘 다 z2m에 페어링되어 race | Medium | High | 교체 트랜잭션 마지막 단계에서 옛 IEEE unpair + 새 IEEE의 friendly_name을 옛 friendly_name으로 rename |
| 페어링 중 운영자가 다른 zigbee 장치를 동시에 추가 | Medium | Medium | 교체 모달은 호환 조건 매칭 후보만 보여줌, 운영자 선택 의무 |
| 채널 매핑이 새 device 모델에서 일부 채널 사용 불가 (예: switch_usb 없음) | High | Low | 호환성 검증에서 `AVAILABLE_SWITCH_CODES` 일치 검사, 불일치 시 교체 차단 |
| 진행 중인 관수 룰이 옛 device로 명령 발행 중 교체 | High | Medium | FR-09 — confirm 다이얼로그 + 옵션 "안전 중단 후 교체" |
| 페어 개폐기 한쪽만 교체 → 인터록 깨짐 | High | Medium | 페어인 경우 open + close 동시 교체 강제 (단일 교체 차단) |
| Activity log에 옛 device.id로 기록된 과거 이벤트는 그대로 — 추적 어려움 | Low | High | 활동 로그 UI에 device.id 일관성 보장 안내 + 교체 이벤트로 history 가능 |
| Onboard 게이트웨이 교체 시 gpio_pin이 옛 SD에 남아있어 새 SD와 충돌 | Medium | Low | gateway_onboard_devices는 gateway_id FK이므로 옛 게이트웨이 row 그대로 보존, 새 게이트웨이는 새 row → onboard 측은 교체 대상 아님 (별도 마이그레이션 기능) |

---

## 6. Architecture Considerations

### 6.1 Project Level Selection

| Level | Characteristics | Recommended For | Selected |
|-------|-----------------|-----------------|:--------:|
| Starter | 단순 구조 | 정적 사이트 | ☐ |
| Dynamic | feature 모듈, BaaS | SaaS, 풀스택 | ☐ |
| **Enterprise** | 엄격한 layer, NestJS DI | 본 프로젝트 | ☑ |

### 6.2 Key Architectural Decisions

| Decision | Options | Selected | Rationale |
|----------|---------|----------|-----------|
| 교체 전략 | (a) 새 row 생성 + 참조 마이그레이션 / (b) 기존 row의 식별자만 swap | **(b) swap** | devices.id 유지 시 모든 FK 자동 보존, 트랜잭션 단순화 |
| 호환성 정책 | (a) 엄격 매칭 / (b) 운영자가 강제 허용 / (c) 단계적 (모델 → 호환 family) | **(a) 엄격** | 1차 단순화 우선, 추후 확장 |
| 페어 개폐기 처리 | (a) 순차 안내 / (b) 동시 트랜잭션 | **(b) 동시** | 인터록 일관성, 사용자 실수 방지 |
| z2m 페어링 트리거 | 자동 permit_join / 운영자 수동 | **자동** | UX 단순화, 30초 timeout + cancel |
| 활동 로그 기록 | 별도 테이블 / 기존 activity_logs | **기존 activity_logs** | 일관성, 별도 마이그레이션 불필요 |

### 6.3 데이터 흐름 다이어그램

```
[운영자] 구역관리/환경설정 카드에서 🔄 교체 클릭
   ↓
[Frontend] GET /devices/:id/replace-preview
   → 영향 받을 자원 카운트 응답 (rules, mappings, paired, runningTimeline)
   ↓
[운영자] 호환성 조건 확인 (모달)
   ↓
[Frontend] POST /gateways/:id/permit-join { enable: true }
   ↓
[z2m] 새 device 페어링 (최대 30초)
   ↓
[Frontend] z2m bridge/devices 토픽 listen → 새로 등장한 IEEE 중 zigbee_model 매칭 후보 표시
   ↓
[운영자] 후보 선택 + confirm
   ↓
[Backend] POST /devices/:id/replace { newIeee, newFriendlyName }
   트랜잭션:
     1. 호환성 재검증 (race condition 방지)
     2. 진행 중 timeline 검사 (FR-09)
     3. 기존 device row UPDATE: zigbee_ieee=new, friendly_name=new, last_seen=now, online=true
     4. z2m bridge/request/device/remove (옛 IEEE) — 옛 device 정리
     5. 페어인 경우 같은 트랜잭션 안에서 페어 device도 처리
     6. activity_logs INSERT
   ↓
[Frontend] 성공 응답 → 카드 새로고침 + 운영자에게 "X개 룰/매핑 보존됨" 확인 노출
```

### 6.4 Clean Architecture Approach

```
Selected Level: Enterprise

backend/src/modules/devices/
├── devices.service.ts (replaceDevice 메서드 + 호환성 검증 helper)
├── devices.controller.ts (POST /:id/replace, GET /:id/replace-preview)
└── device-replacement.ts (호환성 정책 + 트랜잭션 helper — 신규 파일)

frontend/src/components/devices/
└── DeviceReplaceModal.vue (스캔 → 후보 → 미리보기 → confirm)

frontend/src/views/
└── Groups.vue, GatewayEnvSettings.vue (🔄 교체 버튼 추가)
```

---

## 7. Convention Prerequisites

### 7.1 Existing Project Conventions

- [x] `CLAUDE.md` 코딩 컨벤션 (NestJS 모듈/서비스/컨트롤러 패턴)
- [x] TypeORM 트랜잭션 사용 패턴 (gateway-manager.service.ts:138 assignZone 참조)
- [x] activity_logs 일관 사용 (devices.controller.ts:97 device.rename 참조)
- [x] z2m bridge MQTT 토픽 (mqtt.service.ts:202 permit_join 참조)

### 7.2 Conventions to Define/Verify

| Category | Current State | To Define | Priority |
|----------|---------------|-----------|:--------:|
| **새 endpoint URL 패턴** | RESTful (e.g., `:id/control`, `:id/name`) | `POST /:id/replace`, `GET /:id/replace-preview` | High |
| **트랜잭션 helper** | gateway-manager.assignZone 패턴 | `replaceDeviceTx(device, newIeee, newFriendlyName)` | High |
| **호환성 검증 helper** | 없음 (신규) | `assertCompatibleDevice(oldDevice, candidateMeta)` | High |
| **활동 로그 action 이름** | `device.rename`, `device.control` 등 | `device.replace`, `device.replace.failed` | Medium |

### 7.3 Environment Variables Needed

| Variable | Purpose | Scope | To Be Created |
|----------|---------|-------|:-------------:|
| (없음) | 신규 환경변수 불필요 — 기존 z2m / DB 인프라 활용 | - | ☐ |

### 7.4 Pipeline Integration

본 기능은 9-phase Development Pipeline 외 별도 PDCA 사이클로 진행. Phase 1-2 산출물(스키마/컨벤션) 영향 없음.

---

## 8. Next Steps

1. [ ] Design 문서 작성 (`/pdca design device-replacement`) — 호환성 매트릭스, 트랜잭션 흐름, 페어 처리, UI 모달 구조
2. [ ] 백엔드 endpoint 구현 + 단위 테스트 (호환성 검증, 트랜잭션 rollback)
3. [ ] 프론트엔드 모달 구현 + E2E (스캔 → 후보 → confirm → 결과)
4. [ ] DEVICE_CONTROL_LOGIC.md에 교체 정책 섹션 추가
5. [ ] smart-farm-test SKILL.md §14 회귀 테스트 시나리오 추가
6. [ ] Gap analysis + report

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-05-29 | 초안 작성 | ohjeongseok |
