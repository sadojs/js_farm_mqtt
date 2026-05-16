---
template: report
version: 1.1
feature: sensor-reading-selection
date: 2026-05-14
author: ohgane
project: smart-farm-mqtt
status: Complete
---

# sensor-reading-selection Completion Report

> **Status**: Complete
>
> **Project**: smart-farm-mqtt
> **Author**: ohgane
> **Completion Date**: 2026-05-14
> **PDCA Cycle**: #1

---

## 1. Summary

### 1.1 Project Overview

| Item | Content |
|------|---------|
| Feature | sensor-reading-selection |
| Start Date | 2026-05-13 |
| End Date | 2026-05-14 |
| Duration | 2 days (계획 → 구현 → 검증 → 디자인 리뷰) |
| Companion Feature | opener-monitoring-cycle (Part 2: 30s ON / 60s OFF) — 동일 사이클 내 병행 완료 |

### 1.2 Results Summary

```
┌─────────────────────────────────────────────┐
│  Completion Rate: 100%                       │
├─────────────────────────────────────────────┤
│  ✅ Complete:     10 / 10 items              │
│  ⏳ In Progress:   0 / 10 items              │
│  ❌ Cancelled:     0 / 10 items              │
├─────────────────────────────────────────────┤
│  Critical bug fix during verification:       │
│  ✅ Round-trip semantic (base vs base+hyst)  │
└─────────────────────────────────────────────┘
```

---

## 2. Related Documents

| Phase | Document | Status |
|-------|----------|--------|
| Plan | [sensor-reading-selection.plan.md](../../01-plan/features/sensor-reading-selection.plan.md) | ✅ Finalized |
| Design | (Plan에 충분히 포함되어 별도 design 문서 생략) | ➖ N/A |
| Check | 브라우저 자동화 + 백엔드 로그 직접 검증 (`gap-detector` 미사용) | ✅ Complete |
| Act | Current document | ✅ |

---

## 3. Completed Items

### 3.1 Functional Requirements

| ID | Requirement | Status | Notes |
|----|-------------|--------|-------|
| FR-01 | 트리거 단위를 (device_id, sensor_field, current_value) 튜플로 | ✅ | `SensorReadingField` 타입 추가 |
| FR-02 | "온도" 트리거를 "온습도"로 통합 + 온도/습도 분기 | ✅ | StepTimingByIntent 탭명 변경, 단위 동적 |
| FR-03 | 표시 포맷 `{디바이스명} — {필드} ({현재값}{단위})` | ✅ | 실측: `온습도센서1 — 온도 (24.7°C)` |
| FR-04 | 백엔드 `GET /devices/:id/sensor-channels` 엔드포인트 | ✅ | TimescaleDB 24h DISTINCT 쿼리 |
| FR-05 | CREATE 위저드 v2 — 인라인 채널 셀렉터 | ✅ | StepTimingByIntent 온습도 탭 |
| FR-06 | EDIT 위저드 — sensor_device_id 별 필드 옵션 제한 | ✅ | `fieldsForCondition()` per-condition |
| FR-07 | 호환성: 기존 룰의 `field='temperature'` 그대로 동작 | ✅ | 폴백 로직 + 한국어 라벨 매핑 |
| FR-08 | useRuleWizardV2 `canProceed`에 `sensorField` 필수 검증 | ✅ | 온습도 트리거 시 둘 다 있어야 진행 |
| FR-09 | transformV2ToLegacy: `field`/`unit` 전파 | ✅ | 온도 → °C, 습도 → % |
| FR-10 | (검증 중 발견) value 시맨틱 정정 — value=base로 저장 | ✅ | 런타임/UI/EDIT 라운드트립 일치 |

### 3.2 Non-Functional Requirements

| Item | Target | Achieved | Status |
|------|--------|----------|--------|
| TypeScript 검증 | 0 errors | 0 (backend + frontend tsc) | ✅ |
| 라운드트립 무결성 | CREATE 입력 = EDIT 표시 | 일치 (실측) | ✅ |
| 브라우저 E2E | CREATE/EDIT 자동 검증 | 통과 | ✅ |
| 디자인 통일 | 한국어 라벨 폴백 | 적용 (FIELD_KR_LABEL) | ✅ |

### 3.3 Deliverables

| Deliverable | Location | Status |
|-------------|----------|--------|
| 백엔드 엔드포인트 | `backend/src/modules/devices/devices.controller.ts` `GET :id/sensor-channels` | ✅ |
| 백엔드 서비스 | `backend/src/modules/devices/devices.service.ts` `getSensorChannels()` | ✅ |
| 프론트 API | `frontend/src/api/device.api.ts` `getSensorChannels(id)` | ✅ |
| 타입 | `frontend/src/components/automation/v2/types.ts` `SensorReadingField`, `sensorField` | ✅ |
| CREATE UI | `frontend/src/components/automation/v2/StepTimingByIntent.vue` | ✅ |
| 위저드 배선 | `frontend/src/components/automation/v2/IntentWizardModal.vue` | ✅ |
| 룰 검증 | `frontend/src/composables/useRuleWizardV2.ts` | ✅ |
| 변환 | `frontend/src/components/automation/v2/transformV2ToLegacy.ts` | ✅ |
| EDIT UI | `frontend/src/components/automation/StepConditionBuilder.vue` | ✅ |
| E2E 테스트 | `tests/e2e/verify-create-wizard.ts`, `tests/e2e/verify-edit-wizard.ts` | ✅ |
| 계획서 | `docs/01-plan/features/sensor-reading-selection.plan.md` | ✅ |

---

## 4. Incomplete Items

### 4.1 Carried Over to Next Cycle

| Item | Reason | Priority | 다음 사이클 |
|------|--------|----------|------------|
| Step 3 actuator 카드 영문 라벨 한국어화 | 본 작업 범위 외 (디자인 리뷰 잔여 권고 1) | Medium | **opener-actuator-label-i18n** |
| Z2M `bridge/devices` exposes 메타데이터로 채널 등록(옵션 B) | 본 작업은 옵션 A로 신속 구현 | Low | sensor-channels-metadata-sync (제안) |
| 토양수분/CO2/조도/EC 등 추가 채널의 v2 위저드 지원 | 현재는 temperature/humidity만 SensorReadingField | Medium | sensor-channels-expand (제안) |

### 4.2 Cancelled/On Hold Items

| Item | Reason | Alternative |
|------|--------|-------------|
| - | - | - |

---

## 5. Quality Metrics

### 5.1 Final Analysis Results

| Metric | Target | Final | 비고 |
|--------|--------|-------|------|
| 기능 충족률 (FR 1~10) | 100% | 100% | 검증 중 추가 FR-10 발견 후 즉시 해결 |
| TypeScript 오류 | 0 | 0 (backend+frontend) | npx tsc, vue-tsc |
| E2E 회귀 | 통과 | 통과 (CREATE + EDIT) | playwright 헤드리스 |
| 라운드트립 정합성 | 입력값 = 재표시값 | 일치 | mtest로 실측 |

### 5.2 Resolved Issues

| Issue | Resolution | Result |
|-------|------------|--------|
| **[BUG-FIX]** 시맨틱 불일치: value=base+hyst로 저장되어 런타임 임계값이 +deviation만큼 어긋남 | transformV2ToLegacy의 mainCond.value = base 로 변경 (러너 공식과 일치) | ✅ 라운드트립 무결 |
| EDIT 필드 셀렉터에 영문 raw field가 노출 | `FIELD_KR_LABEL` 폴백 매핑 (`temperature`→`온도`, `pressure`→`기압` 등) | ✅ 적용 |
| 측정값 채널이 디바이스마다 다를 때 모든 채널 노출되어 사용자 혼란 | `fieldsForCondition(cond)` per-condition으로 sensor_device_id의 실제 채널만 제한 | ✅ |
| 동일 cycle 내 Part 2(개폐기 30/60s) — `value` 시맨틱 영향 받음 | 동일 수정으로 자동 해결 | ✅ |

---

## 6. Lessons Learned & Retrospective

### 6.1 What Went Well (Keep)

- **검증을 자동화 스크립트로 진행**: Playwright 기반 verify-create-wizard.ts / verify-edit-wizard.ts 작성 → 라운드트립 무결성 버그(FR-10)를 실제 사용자가 부딪히기 전에 잡음
- **백엔드 API 엔드포인트를 먼저 구현하고 curl로 검증 후 프론트 진행** — 채널 평탄화 로직 통합 전에 데이터 모양 확정
- **2부(개폐기 사이클)과 1부(채널 선택)을 같은 사이클에 묶음** — 공통 데이터 모델(`condition.sensor_device_id`, `condition.value/deviation`) 변경 비용 1회로 분산
- **계획 단계에서 옵션 A(빠른 sensor_data 쿼리) vs 옵션 B(메타데이터) 명시** — 의사 결정 가시화, 본 사이클은 A 채택

### 6.2 What Needs Improvement (Problem)

- **시맨틱 불일치를 사전 단위 테스트로 잡지 못함** — 변환 함수에 대한 라운드트립 단위 테스트가 부재
- **EDIT 위저드 디자인 리뷰가 구현 끝나고 나서야 진행** — UI 결정을 더 일찍 스크린샷으로 점검했어야
- **`equipmentType` 영문 라벨 잔존** — 본 사이클 범위는 조건/측정값으로 한정했으나 함께 처리하는 게 자연스러웠음

### 6.3 What to Try Next (Try)

- transformV2ToLegacy 라운드트립 단위 테스트 — `legacy → v2 형태로 역변환` 보조 함수 도입 검토
- 위저드별 design golden screenshot CI 통합 (Playwright snapshot)
- 한국어 라벨 매핑을 `frontend/src/utils/device-labels.ts` 단일 모듈로 통합 → 후속 사이클 `opener-actuator-label-i18n` 에서 적용

---

## 7. Process Improvement Suggestions

### 7.1 PDCA Process

| Phase | Current | Improvement Suggestion |
|-------|---------|------------------------|
| Plan | Plan에 충분한 영향 파일/단계 명시 → Design 문서 별도 생성 안함 | 본 케이스처럼 작업이 5h 미만이면 plan 통합 OK, 단 단위테스트 항목 명시 |
| Do | 핫리로드 백엔드 + Vite 프론트로 빠른 반복 | 동시 실행 PID 충돌(EADDRINUSE) 사전 점검 스크립트화 |
| Check | playwright + curl 수동 조합 | smart-farm-test 스킬에 wizard E2E 시나리오 추가 권장 |
| Act | 본 리포트 | 라운드트립 단위테스트 누락에 대한 retrospective 정착 |

### 7.2 Tools/Environment

| Area | Improvement Suggestion | Expected Benefit |
|------|------------------------|------------------|
| 백엔드 dev | `node dist/main.js` 잔존 프로세스 자동 정리 hook | 핫리로드 EADDRINUSE 방지 |
| 로그 분석 | `/Users/.../logs/backend.stdout.log` 통합 | tail/grep 일관화 |
| 시간 동기화 | 클라이언트/서버 시계 동기화 점검 | 30/60s 사이클 검증 시간 추정 정확성 |

---

## 8. Next Steps

### 8.1 Immediate

- [x] mtest 계정으로 룰 원복 (base=28, onAt=30, offAt=26)
- [ ] Part 2 사이클 검증 후 lgw-dev 게이트웨이의 GPIO 펄스 부하 모니터링
- [ ] `/pdca archive sensor-reading-selection --summary` (선택)

### 8.2 Next PDCA Cycle

| Item | Priority | Expected Start |
|------|----------|----------------|
| opener-actuator-label-i18n | Medium | 2026-05-14 (별도 plan 생성 완료) |
| sensor-channels-metadata-sync (Z2M exposes) | Low | 2026-Q2 |
| sensor-channels-expand (CO2/토양수분/EC) | Medium | 후속 사용자 요청 시 |

---

## 9. Changelog

### v1.0.0 (2026-05-14)

**Added:**
- `GET /devices/:id/sensor-channels` 백엔드 엔드포인트
- `SensorReadingField` 타입 (`'temperature' | 'humidity'`)
- 자동제어 v2 위저드 "온습도로" 탭 + 측정 채널 인라인 셀렉터
- EDIT 위저드 StepConditionBuilder의 sensor_device_id 별 필드 옵션 제한
- 한국어 채널 라벨 폴백 (`FIELD_KR_LABEL`)
- E2E 회귀 테스트 2종 (`verify-create-wizard.ts`, `verify-edit-wizard.ts`)
- 백엔드 자동제어 러너 30s/60s 초 단위 사이클 + 페어 디바이스 라우팅(동일 사이클 병행)

**Changed:**
- transformV2ToLegacy: `mainCond.value` 의미를 `base+hysteresis`(onAt) 에서 `base`(midpoint)로 수정 — 런타임 공식과 일치
- IntentWizardModal: `sensorField` props/emit 배선, `setTriggerField` 키 유니온 확장
- useRuleWizardV2 `canProceed`: 온습도 트리거 시 `sensorDeviceId`와 `sensorField` 모두 필수

**Fixed:**
- 자동제어 룰 라운드트립 시 임계값이 실제 의도와 다르게 표시/적용되는 버그
- 개폐기 EDIT 시 장치가 목록에 안 보이던 문제 (`includeOpener` prop 도입)
- 개폐기 온도 룰 재수정 시 hysteresis UI가 사라지던 문제 (`isFanHysteresis` 에 `opener_open` 포함)

### v1.1.0 (2026-05-14) — 위저드 단계 통합 & 메타데이터 정리

**Changed:**
- 자동제어 EDIT 위저드를 5→4단계로 축소: 측정기(Step 2) 제거, Step 4(조건)의 per-condition `sensor_device_id` 셀렉터가 동일 기능 제공
- `actions.sensorDeviceIds`를 conditions의 `sensor_device_id`에서 저장 시 자동 파생
- StepConditionBuilder의 시간 필드를 `availableFields`에 항상 포함 (이전엔 `timeOnly`만)
- EDIT field 셀렉터에 한국어 라벨 폴백 매핑 (`FIELD_KR_LABEL`: temperature→온도, humidity→습도, pressure→기압 등)

**Fixed:**
- transformV2ToLegacy: 더 이상 description에 JSON 메타데이터(`originalV2State`, `hysteresisOffAt`) 저장 안 함 (value 시맨틱 정정 이후 불필요)
- 레거시 룰의 JSON description은 EDIT 진입 시 빈 문자열로 정규화 → 저장 시 자동 정리
- StepReview의 측정기 요약을 `conditions[].sensor_device_id`에서 자동 파생 (legacy `actions.sensorDeviceIds` 폴백)

### v1.2.0 (2026-05-15) — Zigbee 페어링 UX 개선

**Added:**
- GatewayEnvSettings.vue Zigbee 스캔 모달에 페어링 모드 시작 버튼 (120초 카운트다운 + 5초 자동 재스캔)
- 빈 상태 CTA — "새로운 Zigbee 장치를 추가하시겠어요?" 안내 + 큰 페어링 시작 버튼
- gatewayApi.permitJoin 사용 (admin role 우회 포함)

**Changed:**
- `MqttService.requestZigbeeDevices`에서 가짜 `bridge/request/devices` publish 제거 → scan API 응답 3000ms → 8ms로 약 300배 향상

**Fixed:**
- 페어링 모드 시작 클릭 시 404 — `gatewayService.findOneByRole(role)` 추가, admin role 우회로 다른 사용자의 게이트웨이도 접근 가능
- GatewayEnvSettings.vue 스캔 카드의 빈 `<template>` 래퍼 제거 — Vue 3는 디렉티브 없는 `<template>` 자식을 렌더링 안 함 → 이름 입력/측정기-장치 선택/추가 버튼이 안 보이던 문제 해결

### v1.3.0 (2026-05-15) — rain-sensor-opener-override 후속 통합

본 changelog 항목은 [rain-sensor-opener-override.report.md](rain-sensor-opener-override.report.md) 사이클의 변경을 sensor-reading-selection 라인업과 연결하기 위해 추가됨.

**관련 통합 변경:**
- env_role `rain_detection` 추가 (이 작업이 도입한 env-config 채널 셀렉터 패턴 재사용)
- 자동제어 러너에 비 감지 우회 가드 추가 — sensor-reading-selection v1에서 정의한 `value=base, onThreshold=value+deviation` 시맨틱이 그대로 동작 (회귀 없음)
- 우적센서(TS0207) 자동 채널 노출은 sensor-reading-selection의 ZIGBEE_MODEL_SENSOR_TYPES 패턴 확장으로 구현
- EDIT 위저드 4단계 흐름이 우적센서 환경 매핑 UX와 일관성 유지

→ rain-sensor-opener-override는 별도 PDCA 사이클로 완료 보고됨.

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 1.0 | 2026-05-14 | Completion report created | ohgane |
| 1.1 | 2026-05-14 | 위저드 단계 통합 + 메타데이터 정리 changelog 추가 | ohgane |
| 1.2 | 2026-05-15 | Zigbee 페어링 UX 개선 changelog 추가 | ohgane |
| 1.3 | 2026-05-15 | rain-sensor-opener-override 사이클 통합 노트 추가 | ohgane |
