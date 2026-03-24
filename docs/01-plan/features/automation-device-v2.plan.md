# Plan: automation-device-v2

> Date: 2026-02-21 | Level: Dynamic | Feature: 자동화룰 로직 변경 + 장비 등록 개선

## A. 자동화 룰 위저드 로직 변경

### FR-01: 장비 선택 단계 수정 (StepActuatorSelect.vue)
- 멀티 선택 -> **단일 선택** (radio)
- 동작 설정(ON/OFF command) 선택창 **제거**
- **개폐기(opener) 장비 목록에서 숨김** - equipmentType이 opener/opener_open/opener_close인 장비 필터링

### FR-02: 센서 기반 조건 - 히스테리시스 (StepConditionBuilder.vue)
- 장비가 **환풍기(fan)** + 조건이 **온도/습도**인 경우:
  - **기준값** + **편차값**(기본 0) 입력 UI
  - 저장 형태: `{ field: 'temperature', value: 30, deviation: 3 }` -> ON: 33이상, OFF: 27이하
  - 저장 형태: `{ field: 'humidity', value: 50, deviation: 10 }` -> ON: 60이상, OFF: 40이하
- **강우량, UV, 이슬점**: "미구현" 표시 + 선택 시 다음 버튼 비활성화
- 백엔드 automation-runner: 히스테리시스 로직 추가 (ON 임계치 / OFF 임계치 분리 평가)

### FR-03: 시간 기반 조건 - 시간대 스케줄러 (StepConditionBuilder.vue)
- 센서 미선택(시간 기반) + 장비가 환풍기인 경우:
  - **시작시간/종료시간** 선택 (시간 picker)
  - **+ 버튼**으로 시간대 추가 (복수 시간대)
  - **요일 선택** (월~일 토글)
  - **반복 토글**: ON=매주 반복, OFF=해당 주만 실행 후 자동 비활성화
- 저장 형태:
```json
{
  "type": "time_schedule",
  "timeSlots": [
    { "start": 10, "end": 11 },
    { "start": 17, "end": 18 }
  ],
  "daysOfWeek": [1,2,3,4,5,6,7],
  "repeat": true
}
```
- 백엔드: 시작시간에 ON 명령, 종료시간에 OFF 명령, 비반복은 주 완료 후 enabled=false

### FR-04: 릴레이 동작대기 옵션
- 장비가 환풍기인 경우 모든 조건에 **동작대기** 토글 추가
- 동작방식: **50분 동작 + 10분 정지** 반복 (동작 시간 내)
- 저장 형태: `{ relay: true, relayOnMinutes: 50, relayOffMinutes: 10 }`
- 백엔드: 릴레이 스케줄러 로직 추가

## B. 장비 등록 창 개선

### FR-05: 장비 타입 변경 (DeviceRegistration.vue, device.types.ts)
- EquipmentType: `'other' | 'irrigation' | 'fan' | 'opener_open' | 'opener_close'`
- 선택 옵션: 기타, 관수, 환풍기(휀), 개폐기(열림), 개폐기(닫힘)

### FR-06: 개폐기 페어링 강제 (DeviceRegistration.vue)
- 개폐기(열림) + 개폐기(닫힘) 정확히 1개씩 선택해야 다음 버튼 활성화
- 미충족 시 하단 경고: "개폐기는 열림, 닫힘 각각 한 개씩 선택해야 합니다"
- 이름 설정 단계: 두 장비를 하나로 묶는 **대표 이름** 입력
- 백엔드: 개폐기 페어 저장 (pairedDeviceId 또는 device_pairs 테이블)

### FR-07: 개폐기 인터록 제어 (Devices.vue, 백엔드 devices.controller)
- 표시 형태:
  ```
  석문리 하우스 개폐기
  개폐기(열림) ON/OFF
  개폐기(닫힘) ON/OFF
  ```
- **인터록 안전 로직**: 열림/닫힘 동시 ON 절대 불가
  - 열림 ON 상태에서 닫힘 ON 요청시: 열림 OFF -> **1.5초 딜레이** -> 닫힘 ON
  - 닫힘 ON 상태에서 열림 ON 요청시: 닫힘 OFF -> **1.5초 딜레이** -> 열림 ON
- 프론트엔드: controlDevice 호출 시 인터록 시퀀스 처리
- 백엔드: interlock API 또는 기존 control API에 인터록 로직 추가

## 구현 순서

| Phase | 작업 | 파일 |
|-------|------|------|
| 1 | FR-05: EquipmentType 타입 변경 | device.types.ts, DeviceRegistration.vue |
| 2 | FR-06: 개폐기 페어링 등록 UI + 백엔드 | DeviceRegistration.vue, devices.service.ts |
| 3 | FR-07: 개폐기 인터록 제어 | Devices.vue, devices.controller.ts |
| 4 | FR-01: 장비 선택 단일화 + 개폐기 숨김 | StepActuatorSelect.vue |
| 5 | FR-02: 히스테리시스 조건 UI + 백엔드 | StepConditionBuilder.vue, automation-runner.service.ts |
| 6 | FR-03: 시간대 스케줄러 UI + 백엔드 | StepConditionBuilder.vue, automation-runner.service.ts |
| 7 | FR-04: 릴레이 동작대기 옵션 | StepConditionBuilder.vue, automation-runner.service.ts |

## 주요 수정 파일

**Frontend:**
- `types/device.types.ts` - EquipmentType 확장
- `components/devices/DeviceRegistration.vue` - 타입/페어링
- `views/Devices.vue` - 개폐기 인터록 UI
- `components/automation/StepActuatorSelect.vue` - 단일선택/개폐기숨김
- `components/automation/StepConditionBuilder.vue` - 히스테리시스/시간대/릴레이
- `components/automation/RuleWizardModal.vue` - 위저드 흐름 조정

**Backend:**
- `devices/entities/device.entity.ts` - equipmentType enum
- `devices/devices.service.ts` - 개폐기 페어 저장
- `devices/devices.controller.ts` - 인터록 API
- `automation/automation-runner.service.ts` - 히스테리시스/시간대/릴레이 실행
- `automation/dto/create-rule.dto.ts` - 새 조건 형식 DTO
