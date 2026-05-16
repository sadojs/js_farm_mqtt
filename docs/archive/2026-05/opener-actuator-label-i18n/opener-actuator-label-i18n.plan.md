---
template: plan
version: 1.2
feature: opener-actuator-label-i18n
date: 2026-05-14
author: ohgane
project: smart-farm-mqtt
status: Draft
---

# opener-actuator-label-i18n Planning Document

> **Summary**: 자동제어 EDIT 위저드 Step 3(장치 선택)에서 영문으로 노출되는 `equipmentType`("opener", "fan" 등) 라벨을 한국어로 통일한다.
>
> **Project**: smart-farm-mqtt
> **Author**: ohgane
> **Date**: 2026-05-14
> **Status**: Draft

---

## 1. Overview

### 1.1 Purpose

자동제어 룰 수정 화면(RuleWizardModal Step 3)에서 장치 카드 하단에 `equipmentType` 원본값이 영문("opener", "fan", "irrigation", "other")으로 그대로 노출되어 일관된 한국어 UI 흐름을 해친다. 본 작업은 모든 사용자 노출 장비 타입 라벨을 한국어로 표시한다.

### 1.2 Background

- 직전 작업(`sensor-reading-selection`) 디자인 리뷰 중 발견된 잔여 권고
- 카드 상단 device.name은 한국어("개폐기", "유동팬 4번")로 잘 표시되지만, 하단 메타 라벨만 영문 노출
- `StepActuatorSelect.vue` 의 device-meta 영역에서 `{{ device.category }}` 가 아닌 `{{ device.equipmentType }}` 가 그대로 출력되는 케이스로 추정됨 (현행 코드는 category 출력이지만 일부 장치는 category 비어있고 equipmentType만 존재)
- 개폐기 섹션 도입(`sensor-reading-selection` 부산물)으로 노출 빈도 증가

### 1.3 Related Documents

- 직전 작업 리포트: [sensor-reading-selection.report.md](../../04-report/features/sensor-reading-selection.report.md)
- 영향 컴포넌트: [StepActuatorSelect.vue](../../../frontend/src/components/automation/StepActuatorSelect.vue)

---

## 2. Scope

### 2.1 In Scope

- [ ] `equipmentType` ↔ 한국어 라벨 매핑 상수 정의
- [ ] EDIT 위저드 Step 3 (StepActuatorSelect.vue) 장치 카드 메타 라벨 한국어화
- [ ] CREATE 위저드 v2 Step `device-by-intent` (StepDeviceByIntent.vue)도 동일 표기 검토 및 정합
- [ ] Step 3에서 category가 비어있을 때 폴백으로 한국어 equipmentType 라벨 사용
- [ ] EDIT 위저드 1차 디자인 회귀 스크린샷 캡쳐

### 2.2 Out of Scope

- 백엔드 device 엔티티의 equipmentType 컬럼 자체 변경 (영문 enum 유지)
- 활동 로그/관리자 페이지의 영문 표기 (이번 사이클은 자동제어 위저드 한정)
- 시스템 전반의 i18n 도입 (한국어 단일 락인 유지)

---

## 3. Requirements

### 3.1 Functional Requirements

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-01 | `EQUIPMENT_TYPE_LABEL_KR` 상수 모듈 추가 (`device.types.ts` 또는 별도 헬퍼) | High | Pending |
| FR-02 | StepActuatorSelect.vue device-meta 영역에서 category 없을 시 라벨 폴백 | High | Pending |
| FR-03 | StepDeviceByIntent.vue (v2) 카드 메타도 동일 매핑 사용 | High | Pending |
| FR-04 | 매핑: opener_open→"개폐기(열기)", opener_close→"개폐기(닫기)", fan→"환풍기", irrigation→"관수", other→"기타" | Medium | Pending |
| FR-05 | 개폐기 페어 카드(`opener_open` 단독 노출 시)는 "개폐기" 로 단순화 | Medium | Pending |

### 3.2 Non-Functional Requirements

| Category | Criteria | Measurement Method |
|----------|----------|-------------------|
| Visual Consistency | 한 카드 내 모든 텍스트가 한국어 | Playwright 스크린샷 diff |
| Backward Compat | 백엔드 equipmentType 값 변경 없음 | API 응답 검증 |
| Localization | i18n 라이브러리 미도입, 상수 모듈로 한정 | 코드 리뷰 |

---

## 4. Success Criteria

### 4.1 Definition of Done

- [ ] 매핑 상수 1개소 정의, 두 위저드에서 import 사용
- [ ] EDIT/CREATE 위저드 모두 device 메타 라벨 한국어 표기
- [ ] Playwright 회귀 테스트 (`tests/e2e/verify-actuator-labels.ts`) 통과
- [ ] vue-tsc 통과

### 4.2 Quality Criteria

- [ ] `equipmentType` 누락 케이스(기존 데이터 호환) 폴백 처리 (`기타` 라벨)
- [ ] Storybook 또는 스크린샷 before/after 비교

---

## 5. Risks and Mitigation

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| 다른 페이지(활동 로그, 장치 관리)에 동일 매핑이 필요할 수 있음 | Low | Medium | 상수를 `frontend/src/utils/device-labels.ts` 같은 공유 모듈로 분리, 추후 재사용 |
| 페어 개폐기 표기 혼선(열기/닫기 vs 단일 "개폐기") | Medium | Low | 단일 노출(`opener_open` 대표)일 땐 "개폐기", 별도 노출(EDIT Step 3에서 보조 정보) 시 "(열기)"/"(닫기)" 부착 |

---

## 6. Architecture Considerations

### 6.1 Project Level Selection

| Level | Characteristics | Recommended For | Selected |
|-------|-----------------|-----------------|:--------:|
| **Starter** | Simple structure | Static sites | ☐ |
| **Dynamic** | Feature-based | Web apps with backend | ☐ |
| **Enterprise** | Strict layer separation | High-traffic systems | ☑ (기존) |

본 프로젝트는 Enterprise 레벨로 진행 중. 본 변경은 매우 국소적이라 별도 아키텍처 결정 없음.

### 6.2 Key Architectural Decisions

| Decision | Options | Selected | Rationale |
|----------|---------|----------|-----------|
| 라벨 위치 | i18n 라이브러리 / 상수 모듈 / 컴포넌트 내부 | 상수 모듈 | 단일 언어 락인, 의존성 최소화 |
| 모듈 경로 | `device.types.ts` 확장 / 별도 `device-labels.ts` | `device-labels.ts` | 타입과 라벨 분리, 향후 i18n 마이그레이션 용이 |

---

## 7. Convention Prerequisites

### 7.1 Existing Project Conventions

- [x] `CLAUDE.md` 코딩 컨벤션 섹션 존재
- [x] ESLint/Prettier/TS 설정 정상
- 한국어 라벨 컨벤션: 현재 ad-hoc, 본 작업으로 부분 정착

### 7.2 Conventions to Define

| Category | Current State | To Define | Priority |
|----------|---------------|-----------|:--------:|
| **장치 라벨** | 산재, 영문 enum 그대로 노출되는 곳 다수 | `EQUIPMENT_TYPE_LABEL_KR` 상수 1개소 | High |
| **센서 채널 라벨** | StepConditionBuilder에 `FIELD_KR_LABEL` 존재 | 동일 패턴 재사용 가이드 추가 | Low |

---

## 8. Next Steps

1. [ ] Design 문서 작성 (`opener-actuator-label-i18n.design.md`)
2. [ ] `frontend/src/utils/device-labels.ts` 추가
3. [ ] 두 위저드에 적용 + 회귀 테스트
4. [ ] 차후 사이클: 동일 매핑을 활동 로그/장치 관리 페이지로 확산

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-05-14 | Initial draft (sensor-reading-selection 잔여 권고 1번에서 분리) | ohgane |
