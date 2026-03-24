# dashboard-summary-navigation Planning Document

> **Summary**: 대시보드 하단 요약 카드 클릭 시 해당 관리 페이지로 이동 + 농장사용자 권한 제한
>
> **Project**: smart-farm-platform
> **Date**: 2026-03-04
> **Status**: Draft

---

## 1. Overview

### 1.1 Purpose

대시보드 하단의 4개 요약 카드(전체 장비, 활성 그룹, 자동화 룰, 온라인 기기)를 클릭하면 해당 관리 페이지로 이동하여 사용자가 빠르게 세부 정보에 접근할 수 있도록 한다.

### 1.2 Background

현재 요약 카드는 숫자만 표시하며 클릭 인터랙션이 없다. 사용자가 세부 정보를 보려면 별도로 메뉴를 찾아 이동해야 한다. 또한 농장 사용자(farm_user)는 장비 관리/자동화 룰 페이지에 접근할 수 없으므로 해당 카드는 클릭 불가 처리가 필요하다.

---

## 2. Scope

### 2.1 In Scope

- [x] 요약 카드 4개에 페이지 이동 기능 추가
- [x] 농장 사용자(farm_user) 권한에 따른 클릭 가능/불가 분기
- [x] 클릭 가능한 카드에 시각적 인터랙션(hover/cursor) 추가

### 2.2 Out of Scope

- 카드 디자인 변경 (기존 디자인 유지)
- 새로운 페이지 생성

---

## 3. Requirements

### 3.1 Functional Requirements

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-01 | 전체 장비 카드 클릭 → `/devices` (장비 관리) 이동 | High | Pending |
| FR-02 | 활성 그룹 카드 클릭 → `/groups` (그룹 관리) 이동 | High | Pending |
| FR-03 | 자동화 룰 카드 클릭 → `/automation` (자동화) 이동 | High | Pending |
| FR-04 | 온라인 기기 카드 클릭 → `/devices` (장비 관리) 이동 | High | Pending |
| FR-05 | 농장 사용자(farm_user)는 활성 그룹 카드만 클릭 가능 | High | Pending |
| FR-06 | 농장 사용자에게 비활성 카드는 클릭 불가 시각 처리 (cursor 변경 없음, hover 효과 없음) | Medium | Pending |
| FR-07 | 클릭 가능한 카드에 hover 효과 + pointer cursor 추가 | Medium | Pending |

### 3.2 Navigation Mapping

| 카드 | 이동 경로 | admin/farm_admin | farm_user |
|------|-----------|:----------------:|:---------:|
| 전체 장비 | `/devices` | O | X (denyFarmUser) |
| 활성 그룹 | `/groups` | O | O |
| 자동화 룰 | `/automation` | O | X (denyFarmUser) |
| 온라인 기기 | `/devices` | O | X (denyFarmUser) |

---

## 4. Success Criteria

### 4.1 Definition of Done

- [x] 4개 요약 카드 클릭 시 올바른 페이지로 이동
- [x] 농장 사용자는 그룹 관리만 이동 가능, 나머지 카드 비활성
- [x] 빌드(vue-tsc + vite) 통과

---

## 5. Risks and Mitigation

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| 농장 사용자가 비활성 카드 이유를 모름 | Low | Medium | 비활성 카드에 opacity 감소로 시각적 구분 |

---

## 6. Implementation

### 6.1 수정 파일

| 파일 | 변경 내용 |
|------|-----------|
| `frontend/src/components/dashboard/SummaryCards.vue` | router-link 또는 click 핸들러 추가, auth store import, 권한 분기, hover CSS |

### 6.2 구현 방식

1. `useAuthStore` import → `isFarmUser` computed 사용
2. `useRouter` import → `router.push()` 사용
3. 각 카드에 `@click` + `:class` 바인딩
4. `isFarmUser`일 때 `/devices`, `/automation` 카드는 클릭 불가 + disabled 스타일
5. 클릭 가능 카드에 `.summary-item-link` CSS 추가 (hover 배경 변경, cursor: pointer)

### 6.3 구현 순서

1. auth store / router import
2. 카드별 네비게이션 함수 정의 (권한 체크 포함)
3. 템플릿에 @click + class 바인딩
4. CSS 추가 (hover, disabled 스타일)
5. 빌드 검증

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-03-04 | Initial draft | AI |
