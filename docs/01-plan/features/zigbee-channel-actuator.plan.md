---
template: plan
version: 1.2
description: Zigbee 8/12채널 컨트롤러를 다중 유동팬/개폐기 device로 활용
---

# zigbee-channel-actuator Planning Document

> **Summary**: Zigbee 8ch/12ch 다중 릴레이 컨트롤러를 관수 외에도 **다중 유동팬 / 다중 페어 개폐기** 용도로 등록할 수 있도록 확장. 각 채널이 독립 device로 인식되어 자동제어룰의 타겟이 됨
>
> **Project**: smart-farm-mqtt
> **Version**: 0.x
> **Author**: ohjeongseok
> **Date**: 2026-05-30
> **Status**: Draft

---

## 1. Overview

### 1.1 Purpose

현재 zigbee 8/12채널 릴레이 컨트롤러(예: TS0601_switch_8)는 **관수 컨트롤러로만** 활용 가능. 동일한 컨트롤러 하드웨어를 **유동팬 다중** 또는 **개폐기 다중**으로 사용하면 운영 자유도가 크게 향상되고 비용/배선 효율도 좋아진다.

또한 device-replacement(통째 교체) 기능을 의미 있게 적용하려면 컨트롤러를 단위로 다루는 일관 모델이 필요하다.

### 1.2 Background

운영 현장 요구:
- 작은 비닐하우스 1동: 8ch 컨트롤러 1대 → 환풍기 6개 + 환기창 1쌍 운용
- 중형 하우스: 12ch 컨트롤러 1대 → 환풍기 4개 + 환기창 4쌍
- 비용/배선: 단일 zigbee 모듈 1대로 통합 운영 가능 (대당 1.5~3만원 절감)

**핵심 모델 결정**:
- 1 zigbee 컨트롤러 = N개의 logical device row (자동제어룰 타겟용)
- 각 채널(`switch_N` 또는 `state_lN`)이 logical device의 정체성
- 컨트롤러 1대 = 하나의 actuator type (혼합 모드 불허 — 1차 단순화)

### 1.3 Related Documents

- 관수 8/12ch 매핑 패턴: [channel-mapping.constants.ts](../../../backend/src/modules/devices/channel-mapping.constants.ts)
- 채널 활성/비활성: device-replacement 선행 작업의 `disabledChannels` 패턴
- z2m switch 키 변환: TS0601 `switch_N → state_lN` 변환 (`translateSwitchKeyForZ2m`)

---

## 2. Scope

### 2.1 In Scope

- [ ] **Zigbee 컨트롤러 추가 시 actuator type 선택** (관수 / 유동팬 / 개폐기 페어) — 환경설정 Zigbee 탭의 "+ Zigbee 스캔" 흐름 확장
- [ ] **유동팬 모드**: N개 채널 = N개 유동팬 logical device 자동 생성
- [ ] **개폐기 모드**: N개 채널 = N/2개 페어 개폐기 (1+2 = 페어1, 3+4 = 페어2, …)
- [ ] **관수 모드**: 기존 동작 그대로 (변경 없음)
- [ ] **인라인 채널 카드** (관수와 동일 UX): 채널별 dropdown / ON-OFF 테스트 / 활성화 토글
- [ ] **이름 규칙**:
  - 유동팬: 기본 `{gateway}_유동팬1` … 각 채널 개별 수정 가능
  - 개폐기: 페어 대표 기본 `{gateway}_개폐기1`, 페어 대표만 이름 수정 가능, 하위 child는 "열림"/"닫힘" 고정
- [ ] **개폐기 ON/OFF 테스트 인터록**: 각 채널 테스트 버튼 사용 시에도 인터록(반대편 OFF + 1초 대기) 적용
- [ ] **활성화 토글 단위**:
  - 유동팬: **채널 단위** (channel별 독립 enable)
  - 개폐기: **페어 대표 단위** (페어는 항상 한 쌍으로 enable/disable)
- [ ] **자동제어룰 타겟**: 위저드 device 후보에 logical device가 정상 노출 (각 유동팬 / 각 페어 개폐기)

### 2.2 Out of Scope

- 한 컨트롤러 안에서 혼합 모드 (예: 채널 1~4 유동팬 + 5~8 개폐기) — 향후 확장
- 8ch ↔ 12ch 모드 전환 — 컨트롤러 등록 시 1회 결정, 변경 시 삭제 후 재등록
- onboard 게이트웨이의 zigbee 컨트롤러 사용 (별도 진로)
- 비-Tuya/표준 zigbee 컨트롤러 호환성 — 현재 TS0601 계열만 (필요 시 확장)

---

## 3. Requirements

### 3.1 Functional Requirements

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-01 | Zigbee 스캔 시 발견된 다중채널 컨트롤러(`zigbee_model` 포함 `_switch_N`)는 actuator type 선택 단계로 진입한다 (관수 / 유동팬 / 개폐기) | High | Pending |
| FR-02 | 유동팬 모드: 8ch 선택 시 8개 logical device(equipment_type='fan') 자동 생성. 각 device는 channel_code(`switch_1` ~ `switch_8`)를 보유 | High | Pending |
| FR-03 | 개폐기 모드: 8ch 선택 시 4쌍 logical device 생성. 각 쌍은 opener_open + opener_close + paired_device_id 양방향 + 페어 대표(openerGroupName) | High | Pending |
| FR-04 | 환경설정 인라인 카드 UX: 관수와 동일한 채널 grid (CH dropdown, ON/OFF, 활성화 토글) | High | Pending |
| FR-05 | 유동팬 이름 기본값 `{gateway.gatewayId or name}_유동팬{N}` — 각 row의 ✏ 버튼으로 개별 수정 가능 | Medium | Pending |
| FR-06 | 개폐기 페어 대표 이름 기본값 `{gateway}_개폐기{N}` — 페어 대표만 ✏ 수정. 하위 device 이름은 "열림"/"닫힘" 고정 + 페어 대표 이름 변경 시 자동 추종 (`{새이름} 열림`, `{새이름} 닫힘`) | Medium | Pending |
| FR-07 | 활성화 토글: 유동팬은 channel별 독립 (관수 패턴과 동일 disabledChannels), 개폐기는 페어 대표 단위 (한쪽만 토글 불가) | High | Pending |
| FR-08 | ON/OFF 테스트 버튼: device의 z2m payload 자동 변환(TS0601 → state_lN). 개폐기는 인터록 자동 적용 — 반대편이 ON이면 먼저 OFF + 1초 대기 후 목표 ON | High | Pending |
| FR-09 | 자동제어룰 위저드 device 후보 노출: 활성 채널만 (disabledChannels 제외). 개폐기는 페어 대표 1개로 노출 (위저드는 `opener_open`을 대표로 선택) | High | Pending |
| FR-10 | 채널 매핑(dropdown) 변경 시 자동제어룰 영향 — 룰은 device.id를 가리키므로 채널 코드만 swap. 자동제어 publish는 자동으로 새 코드 사용 | High | Pending |
| FR-11 | 컨트롤러 삭제 시 모든 logical child device 동시 삭제 + 룰 의존성 검사 (룰 사용 중이면 사전 차단) | High | Pending |
| FR-12 | 활동 로그: `device.zigbee_controller.add`, `device.zigbee_controller.remove`, `device.channel_actuator.rename` 등 | Medium | Pending |

### 3.2 Non-Functional Requirements

| Category | Criteria | Measurement |
|----------|----------|-------------|
| Performance | 8ch 컨트롤러 등록 시 < 3초 (8 device row INSERT + 인덱스) | DB profile |
| Consistency | logical child device의 `gateway_id`, `house_id`, `user_id`는 parent와 항상 일치 | 트랜잭션 + 마이그레이션 검증 |
| Compatibility | 기존 관수 모드 동작 회귀 없음 — 기존 device row 호환 | smart-farm-test §12 PASS |
| Idempotency | 같은 컨트롤러 두 번 등록 시도 → 두 번째는 ConflictException | 단위 테스트 |

---

## 4. Success Criteria

### 4.1 Definition of Done

- [ ] FR-01 ~ FR-12 구현 완료
- [ ] Backend: ZigbeeControllerService.createController() — actuator type 분기 + child device 일괄 생성
- [ ] Backend: device 컬럼 `parent_device_id`, `channel_code` 추가 (마이그레이션)
- [ ] Backend: `publishDeviceSwitch()` 확장 — child device일 때 parent의 friendlyName + 자기 channel_code로 publish
- [ ] Frontend: 환경설정 Zigbee 탭 컨트롤러 추가 모달에 actuator type 선택 단계 추가
- [ ] Frontend: 인라인 카드를 관수/유동팬/개폐기 3가지 변종으로 추상화 (`ZigbeeControllerCard.vue`)
- [ ] Frontend: 위저드 device 후보 추출 로직 — logical device 인식
- [ ] DEVICE_CONTROL_LOGIC.md §다중채널 actuator 섹션 추가
- [ ] smart-farm-test §15 회귀 시나리오 추가

### 4.2 Quality Criteria

- [ ] vue-tsc + nest build PASS
- [ ] 기존 관수 룰 + 단일 zigbee fan/opener 룰 회귀 없음
- [ ] 마이그레이션 down/up 멱등 (rollback 가능)

---

## 5. Risks and Mitigation

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| 1 컨트롤러 N row 패턴이 기존 1:1 가정을 깨뜨림 (예: zigbee_ieee unique) | High | High | `devices.zigbee_ieee`의 unique 제약을 partial (where parent_device_id IS NULL)로 변경하거나 child는 zigbee_ieee=NULL + parent_device_id 사용 |
| 자동제어룰의 sensor_device_id가 controller를 가리키는 경우 (드물지만) | Low | Low | controller 자체는 deviceType='actuator'라 sensor 룰의 타겟이 아님 |
| 개폐기 페어 인터록을 child device 간에 적용 시 publish path 추적 복잡 | Medium | Medium | publishDeviceSwitch가 child + opener면 paired child를 함께 처리 (현재 인터록 로직 재사용) |
| 채널 충돌 (같은 채널에 두 logical device 매핑) | High | Low | 컨트롤러 카드의 dropdown에서 다른 채널이 사용 중이면 옵션에서 제외 (관수 패턴 그대로) |
| 컨트롤러 모드 변경 (유동팬 → 개폐기) | Medium | Medium | 1차: 변경 불가, 삭제 후 재등록 안내. 향후: 변경 마법사 |
| z2m 다른 vendor의 다중채널 zigbee (비-TS0601) | Low | Low | translateSwitchKeyForZ2m 확장 — vendor별 매핑 함수 분기 |
| 페어 대표 이름 변경 시 sub device 동기화 누락 | Medium | Medium | updateByUser의 opener 패턴 재사용 (이미 fix됨) |

---

## 6. Architecture Considerations

### 6.1 Project Level Selection

| Level | Selected |
|-------|:--------:|
| Starter | ☐ |
| Dynamic | ☐ |
| **Enterprise** | ☑ |

### 6.2 Key Architectural Decisions

| Decision | Options | Selected | Rationale |
|----------|---------|----------|-----------|
| Logical device 표현 | (a) 가상 sub-device 객체 / **(b) 실제 device row + parent_device_id 컬럼** / (c) 별도 entity | (b) | 자동제어룰의 targetDeviceId 호환, 외부 모듈 변경 최소 |
| Parent device 처리 | 자동제어 타겟 가능 / **자동제어 타겟 제외** | 타겟 제외 | parent는 관리 용도, 룰은 child만 가리킴. equipment_type='controller' 또는 source flag로 구분 |
| channel_code 저장 | device_settings JSONB / **신규 컬럼** | 신규 컬럼 | 인덱스 가능, 쿼리 명확성 |
| 페어 매핑 정책 | 인접 채널(1+2, 3+4) / 사용자 정의 | 인접 채널 (1차) | UX 단순화 |
| zigbee_ieee unique 제약 | partial unique / 제거 | partial unique (parent_device_id IS NULL) | 기존 single device 모델 유지 |

### 6.3 데이터 모델 변경

```
devices 테이블 신규 컬럼:
  parent_device_id  uuid  nullable  (controller → child 참조)
  channel_code      text  nullable  (child의 z2m payload 키, 예: 'switch_3')

인덱스:
  CREATE INDEX idx_devices_parent ON devices(parent_device_id);

제약:
  CREATE UNIQUE INDEX idx_devices_zigbee_ieee_root
    ON devices(zigbee_ieee)
    WHERE parent_device_id IS NULL AND zigbee_ieee IS NOT NULL;
  -- child는 zigbee_ieee = parent의 IEEE 그대로 두되 unique는 root에만 적용
```

### 6.4 Logical Device 생성 예시

**유동팬 모드 (8ch)**:
```
[1] parent (controller)
    name: 'HK_유동팬컨트롤러' (또는 friendlyName)
    equipment_type: 'controller'
    source: 'zigbee'
    zigbee_ieee: 0xa4c1...
    friendly_name: 0xa4c1...
    zigbee_model: TS0601_switch_8
    parent_device_id: NULL
    channel_code: NULL

[2-9] child (fan)
    name: 'hk-house_유동팬1' .. 'hk-house_유동팬8'
    equipment_type: 'fan'
    source: 'zigbee'
    zigbee_ieee: 0xa4c1... (parent와 동일)
    friendly_name: 0xa4c1... (parent와 동일)
    parent_device_id: <parent.id>
    channel_code: 'switch_1' .. 'switch_8'
```

**개폐기 모드 (8ch)**:
```
[1] parent (controller)

[2,3] 페어 1
    [2] opener_open  name: 'hk-house_개폐기1 열림'
        channel_code: 'switch_1'
        paired_device_id: → [3]
        opener_group_name: 'hk-house_개폐기1'
    [3] opener_close name: 'hk-house_개폐기1 닫힘'
        channel_code: 'switch_2'
        paired_device_id: → [2]
        opener_group_name: 'hk-house_개폐기1'

[4,5] 페어 2 (switch_3 + switch_4)
[6,7] 페어 3 (switch_5 + switch_6)
[8,9] 페어 4 (switch_7 + switch_8)
```

---

## 7. Convention Prerequisites

### 7.1 Existing Conventions

- 채널 매핑 보존 패턴 (`disabledChannels`, channel_mapping) — 관수에서 검증됨
- 페어 개폐기 인터록 (`publishDeviceSwitch` + paired_device_id) — 기존 코드 재사용
- 인라인 카드 UX (GatewayEnvSettings.vue Zigbee 탭) — 기존 zigbee 관수 카드 재사용

### 7.2 신규 컨벤션

| Category | 정의 |
|----------|------|
| **child device 식별** | `parent_device_id IS NOT NULL`이면 child. publishDeviceSwitch가 자동 분기 |
| **이름 자동 생성** | `{gateway.name or gateway.gatewayId}_{타입}{N}` 형식 |
| **활동 로그 action** | `device.controller.add`, `device.controller.remove`, `device.channel.rename`, `device.channel.toggle` |
| **마이그레이션 명** | `022_device_parent_channel.sql` |

### 7.3 환경변수

신규 환경변수 없음 — 기존 z2m / DB 인프라 활용.

---

## 8. Next Steps

1. [ ] Design 문서 작성 — 데이터 모델 정확 정의 + 인라인 카드 UX 와이어프레임 + publish path
2. [ ] DB 마이그레이션 022 작성 + 실행
3. [ ] Backend: ZigbeeControllerService + 컨트롤러 추가 endpoint
4. [ ] Backend: publishDeviceSwitch 확장 (child → parent.friendlyName + channel_code)
5. [ ] Frontend: 컨트롤러 추가 모달 (type 선택) + 인라인 카드 통합
6. [ ] 기존 단일 zigbee fan/opener 호환성 회귀 검증
7. [ ] DEVICE_CONTROL_LOGIC.md + SKILL.md §15 추가
8. [ ] device-replacement 진행 가능 (선행 작업 완료 후)

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-05-30 | 초안 — 8/12ch controller로 다중 유동팬/페어 개폐기 구현 | ohjeongseok |
