---
template: plan
version: 1.2
feature: gateway-management-redesign
date: 2026-05-15
author: ohgane
project: smart-farm-mqtt
status: Draft
---

# gateway-management-redesign Planning Document

> **Summary**: 게이트웨이 관리 페이지(`frontend/src/views/GatewayManagement.vue`)를 농장별 그룹 카드 디자인으로 리디자인. 첨부 목업(`/Users/ohjeongseok/Downloads/handoff/gateway-v2-farm-groups.png`)을 목표로, **기존 로직·API·상태·WebSocket·라이프사이클을 100% 보존**하고 `<template>` 마크업과 `<style scoped>`만 교체.
>
> **Project**: smart-farm-mqtt
> **Date**: 2026-05-15
> **Status**: Draft
> **References**:
> - Mockup: `/Users/ohjeongseok/Downloads/handoff/gateway-v2-farm-groups.png`
> - Handoff Prompt: `/Users/ohjeongseok/Downloads/handoff/PROMPT.md`
> - Current file: [frontend/src/views/GatewayManagement.vue](../../../frontend/src/views/GatewayManagement.vue) (21KB)

---

## 1. Overview

### 1.1 Purpose

게이트웨이 관리 페이지의 정보 밀도와 가독성을 향상. 다수 농장·다수 게이트웨이 운영 시 빠른 식별 + 핵심 액션(터미널·환경설정)을 한눈에 처리. 현재 디자인은 카드 안 SSH 명령창·Pi 설치 명령창이 항상 펼쳐져 있어 시각적 노이즈 ↑.

### 1.2 Background

- 플랫폼 관리자(admin) 및 다농장 농장 관리자가 늘면서 다수 게이트웨이 동시 관리 사례 증가
- 기존 카드는 가로 폭을 많이 차지 + 검은 코드창이 시선을 분산
- 농장별 그룹화 + 카드 그리드 + 케밥 메뉴로 정보 위계 재구성 필요

### 1.3 Related Documents

- 직전 사이클: [sensor-reading-selection.report.md](../../04-report/features/sensor-reading-selection.report.md), [opener-actuator-label-i18n](../../archive/2026-05/opener-actuator-label-i18n/)
- 디자인 토큰: `frontend/src/style.css`, `App.vue` `#app` 블록 (이미 정의됨)
- 후속 영향 가능 영역: `frontend/src/components/gateway/WebTerminal.vue` (유지)

---

## 2. Scope

### 2.1 In Scope

- [ ] `<template>` 마크업 전면 교체 (페이지 헤더 / 툴바 / 농장 그룹 헤더 / 카드 그리드)
- [ ] `<style scoped>` 전면 재작성 (디자인 토큰 사용, 다크모드 자동 대응)
- [ ] 클라이언트 사이드 검색·필터·그룹화 `computed` 신규 추가 (`searchQuery`, `statusFilter`, `groupMode`, `filteredGateways`, `groupedGateways`)
- [ ] 카드 우상단 케밥 메뉴 드롭다운 (구역 변경 / Pi 설치 명령 / SSH 명령 / 편집 / 삭제)
- [ ] SSH 명령 + Pi 설치 명령을 인라인 → 모달/팝오버 이동
- [ ] 농장 아바타 + 농장 그룹 헤더 (이름/카운트 뱃지)
- [ ] Connection Strip (AGENT / ZIGBEE / SSH 3분할)
- [ ] 액션 버튼 행 (터미널 + 환경 설정)
- [ ] 등록/편집 모달 디자인 정돈 (기능 그대로, 너비/border/spacing 정리)
- [ ] (선택) `frontend/src/components/gateway/` 하위로 컴포넌트 분리:
  `GatewayCard.vue`, `FarmGroupHeader.vue`, `ConnectionStrip.vue`, `GatewayKebabMenu.vue`, `SshCommandModal.vue`, `PiInstallCommandModal.vue`

### 2.2 Out of Scope (절대 변경 금지)

- 기존 `<script setup>` 함수 시그니처/로직 (gateways, loading, terminalGateway, copied, copiedSetup, showSetup, showAddModal, editTarget, saving, zoneAssigning, users, houses, groups, form)
- 기존 함수: `effectiveAgentOnline()`, `effectiveTunnelConnected()`, `farmNameOf()`, `groupsForGateway()`, `buildSetupCommand()`, `copyCommand()`, `copySetupCommand()`, `toggleSetup()`, `editGateway()`, `closeModal()`, `saveGateway()`, `onZoneChange()`, `openTerminal()`, `removeGateway()`, `handleGatewayStatus()`
- API 호출 시그니처: `gatewayApi`, `userApi`, `groupApi`
- WebSocket 통신 + `useWebSocket` composable
- 라우터, 글로벌 스타일 (`src/style.css`, `App.vue`)
- `WebTerminal.vue` 컴포넌트 내부 + 호출 방식
- 신규 NPM 패키지 설치 — 금지
- 아이콘은 인라인 SVG 24×24 stroke 2 currentColor 패턴 유지 (외부 아이콘 라이브러리 금지)

---

## 3. Requirements

### 3.1 Functional Requirements

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-01 | 페이지 헤더: 제목(24/700) + 부제(14 secondary) + 우측 `[새로고침] [+ 게이트웨이 등록]` 버튼 2개 | High | Pending |
| FR-02 | 툴바: 좌측 검색 입력(최대 360px) + 필터 칩(전체/정상/점검필요 + 카운트) + 우측 그룹화 segmented `[농장 \| 상태 \| 없음]` | High | Pending |
| FR-03 | 검색은 클라이언트 사이드 — name, gatewayId, location, farm 표시명에 부분 매칭 | High | Pending |
| FR-04 | 필터 칩 — `정상`: agent online + zigbee online + tunnel connected, `점검필요`: 그 외 | High | Pending |
| FR-05 | 농장 그룹 헤더 — 아바타(34×34, 농장 ID 해시 → 6색 팔레트) + 표시명(16/700) + 보조(`@username · 게이트웨이 N대 · 정상 M대`) + 우측 정상/미운영 뱃지 | High | Pending |
| FR-06 | 게이트웨이 카드 그리드 — `repeat(auto-fill, minmax(310px, 1fr))`, gap 14, 카드 radius 12, border 1px, padding 16 | High | Pending |
| FR-07 | 카드 헤더 행 — 상태 dot(8px, 온라인 시 글로우) + 이름(16/700) + gatewayId 코드 칩(모노 11) + 우상단 케밥 ⋯ 버튼 | High | Pending |
| FR-08 | 카드 위치 행 — pin 아이콘 + `gw.location` (없으면 행 숨김) | Medium | Pending |
| FR-09 | 카드 이슈 배너 — Zigbee 미연결 / 오프라인 시 노란 배너(error는 빨강) | Medium | Pending |
| FR-10 | Connection Strip — AGENT / ZIGBEE / SSH 3분할, 작은 dot + 값 표시, 세로 구분선, 배경 `#fafbfc` | High | Pending |
| FR-11 | 구역+통계 행 — 구역 뱃지(할당시 brand톤 / 미할당시 warning톤) + `장치 N · 측정기 M` + 우측 마지막통신 | Medium | Pending |
| FR-12 | 액션 버튼 행 — `[터미널]` primary + `[환경 설정]` secondary (터미널 미연결 시 `[재연결 시도]` 대체) | High | Pending |
| FR-13 | 케밥 드롭다운 — 구역 변경 / Pi 설치 명령 보기 / SSH 명령 복사 / 편집 / 삭제(빨강) — 기존 핸들러 호출 | High | Pending |
| FR-14 | SSH/Pi 설치 명령 모달화 — 검정 배경 + 초록 모노 + 복사 버튼 | Medium | Pending |
| FR-15 | 등록/편집 모달 디자인 정돈 — 460px, radius 14, label 13/600, 인풋 38h radius 8 | Low | Pending |
| FR-16 | WebSocket `gateway:status` 업데이트가 새 카드에 즉시 반영 (기존 `handleGatewayStatus` 그대로 활용) | High | Pending |
| FR-17 | 다크모드 자동 대응 (디자인 토큰 사용으로 자연 처리) | High | Pending |

### 3.2 Non-Functional Requirements

| Category | Criteria | Measurement |
|----------|----------|-------------|
| Backward Compat | 기존 API/이벤트/라이프사이클 100% 보존 | 회귀 테스트 시나리오 7종 |
| Performance | 게이트웨이 50개 기준 1차 페인트 1s 이내 | Playwright performance.timing |
| Accessibility | 키보드 포커스 가능 + ARIA(role/aria-label) | tab 순회 검증 |
| Visual Consistency | 디자인 토큰만 사용, 하드코딩 색상 0 | grep `#[0-9a-fA-F]{3,6}` < 10 (icon 등 예외) |
| TypeScript | 0 errors | `npx vue-tsc --noEmit` |

---

## 4. Success Criteria

### 4.1 Definition of Done

- [ ] 마크업 + 스타일 전면 교체 완료
- [ ] 검색/필터/그룹화 동작
- [ ] 농장 아바타 + 그룹 헤더 노출
- [ ] 카드 헤더/위치/Connection Strip/구역/액션 버튼 모두 동작
- [ ] 케밥 메뉴 5개 액션 동작 (기존 핸들러 호출 확인)
- [ ] SSH/Pi 설치 명령 모달 동작
- [ ] WebSocket 상태 업데이트 반영
- [ ] 다크모드 정상
- [ ] 백업 파일(`GatewayManagement.vue.backup`) 삭제 가능 상태
- [ ] 회귀 시나리오 7종 통과

### 4.2 Quality Criteria

- [ ] TypeScript `vue-tsc --noEmit` 통과
- [ ] 한국어 폰트 시스템 스택 유지 (외부 폰트 금지)
- [ ] 핸들러 함수 시그니처 변경 0
- [ ] 새 NPM 패키지 0
- [ ] 글로벌 스타일 수정 0

---

## 5. Risks and Mitigation

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| 마크업 교체 중 기존 핸들러 미연결로 기능 회귀 | High | Medium | 백업 파일 보관 + 회귀 시나리오 7종 명시 + 단계별 진행 (template → style → 분리) |
| 케밥 메뉴 + 모달 z-index 충돌 (WebTerminal 모달과) | Medium | Low | z-index 토큰 정리, WebTerminal 모달 > 케밥 드롭다운 > 카드 |
| 농장 ID 해시 컬러 — 농장 1개일 때 단조로움 | Low | Medium | 6색 팔레트로 시각 다양성 확보, 농장 ID 해시로 일관성 보장 |
| 카드 분리 시 props/emit 정의 복잡 | Medium | Medium | 1차 PR은 단일 파일에서 마크업만 교체, 2차에서 컴포넌트 분리 (Optional) |
| 다크모드에서 일부 변수 미정의 | Low | Low | 토큰 사용 일관성 유지, 새 변수 도입 금지 |
| Connection Strip 폭이 좁은 화면에서 압축됨 | Medium | Medium | flex-shrink 0 + 최소 80px 보장 + 모바일 break point 정의 |

---

## 6. Architecture Considerations

### 6.1 Project Level

| Level | Selected |
|-------|:--------:|
| Enterprise | ☑ |

기존 Enterprise 구조에 컴포넌트 분리만 추가. 모듈 단위 추가 없음.

### 6.2 Key Architectural Decisions

| Decision | Options | Selected | Rationale |
|----------|---------|----------|-----------|
| 컴포넌트 분리 시점 | 단일 파일 / 즉시 분리 / 추후 분리 | **단일 파일에서 시작, 안정화 후 분리(Optional)** | 회귀 위험 최소화 |
| 검색/필터 위치 | URL query / 컴포넌트 state | **컴포넌트 state (ref)** | 가벼움, 새로고침 시 초기 상태 OK |
| 그룹화 옵션 저장 | localStorage / state | **state (세션 단위)** | 단순. 추후 localStorage 확장 가능 |
| 케밥 메뉴 라이브러리 | headlessui / 자작 | **자작 인라인 div + v-if + click-outside** | 의존성 추가 없음, 작은 메뉴 1개 |
| 아이콘 | lucide-vue-next / 자작 SVG | **인라인 SVG 24×24 stroke 2** | 외부 라이브러리 금지 (Plan §2.2) |

### 6.3 컴포넌트 분리 (선택, 2차 PR 권장)

```
frontend/src/components/gateway/
├── GatewayCard.vue          # 단일 카드 (props: gw)
├── FarmGroupHeader.vue      # 농장 그룹 헤더 (props: farmId, gateways)
├── ConnectionStrip.vue      # AGENT/ZIGBEE/SSH 3분할 (props: gw)
├── GatewayKebabMenu.vue     # 드롭다운 메뉴 (emit: 5개 액션)
├── SshCommandModal.vue      # 검정 배경 모달 (props: gw, visible)
└── PiInstallCommandModal.vue
```

1차 PR은 GatewayManagement.vue 단일 파일에서 마크업 교체만. 2차 PR에서 분리.

---

## 7. Convention Prerequisites

### 7.1 Existing Conventions

- [x] 디자인 토큰 정의됨 (`src/style.css`, `App.vue` `#app`)
- [x] 다크모드 자동 대응 (CSS 변수 기반)
- [x] 인라인 SVG 아이콘 패턴 (다른 페이지에서 사용)
- [x] `<script setup>` + `<template>` + `<style scoped>` Vue 3 단일 파일 패턴

### 7.2 신규 컨벤션 (없음)

본 작업은 기존 컨벤션을 따르며, 새 컨벤션을 정의하지 않는다.

### 7.3 디자인 토큰 사용 매트릭스

| Element | Variable |
|---------|----------|
| Primary 버튼 배경 | `--primary` (#2e7d32) |
| Primary 버튼 hover | `--primary-hover` (#1b5e20) |
| 정상 dot/뱃지 | `--primary-light` (#4caf50) |
| 정상 뱃지 배경 | `--primary-bg` (#e8f5e9) |
| 카드 배경 | `--bg-card` (light: #fff, dark: #252525) |
| 페이지 배경 | `--bg-primary` (#f5f7fa) |
| 텍스트 메인 | `--text-primary` |
| 텍스트 보조 | `--text-secondary` |
| 텍스트 muted | `--text-muted` |
| 카드 border | `--border-color` |
| 그룹 헤더 라인 | `--border-light` |
| 경고 배너 | `--warning-bg` / `--warning-text` |
| 위험 액션 (삭제) | `--danger-bg` / `--danger-text` |
| 성공 뱃지 | `--success-bg` / `--success-text` |

---

## 8. Implementation Approach

### 8.1 작업 순서 (권장 PDCA Do 단계)

1. **[5 min] 백업**: `cp frontend/src/views/GatewayManagement.vue frontend/src/views/GatewayManagement.vue.backup`
2. **[15 min] 새 computed 추가** (`<script setup>` 끝부분):
   - `searchQuery = ref('')`
   - `statusFilter = ref<'all' | 'ok' | 'warn'>('all')`
   - `groupMode = ref<'farm' | 'status' | 'none'>('farm')`
   - `filteredGateways` computed → 검색 + 필터
   - `groupedGateways` computed → farm 그룹화
   - `farmAvatarColor(userId)` 헬퍼 (6색 해시)
   - `kebabOpen = ref<string | null>(null)` (열린 카드 id)
   - `sshModalGw / piModalGw` ref
3. **[40 min] `<template>` 교체**:
   - 페이지 헤더 / 툴바 / 농장 그룹 헤더 / 카드 그리드 마크업
   - 기존 핸들러를 새 버튼/메뉴에 재바인딩
   - SSH/Pi 설치 명령 모달 마크업 (showAddModal과 별개)
4. **[40 min] `<style scoped>` 재작성**:
   - 디자인 토큰만 사용
   - 카드 grid + Connection Strip 3분할
   - 케밥 드롭다운 위치/그림자
   - 다크모드는 토큰으로 자동 대응
5. **[15 min] TypeScript 검증**: `npx vue-tsc --noEmit`
6. **[20 min] 회귀 시나리오 7종 (Playwright + 수동)**:
   - 검색/필터/그룹화
   - 카드 헤더/위치/Connection Strip
   - 케밥 메뉴 5개 액션
   - 터미널 열기 (WebTerminal 정상 동작)
   - 구역 할당 변경
   - 편집/삭제 모달
   - WebSocket 상태 업데이트 반영
7. **[10 min] 다크모드 시각 검증** (Playwright color scheme: dark)
8. **[5 min]** 백업 파일 삭제 (정상 시)

**총 예상**: 약 2.5시간

### 8.2 컴포넌트 분리 (2차 PR, 선택)

1차 안정화 후 위 §6.3의 6개 컴포넌트로 분리. props/emit 명세 정의 후 진행.

---

## 9. Test Cases

### 9.1 회귀 시나리오 (Playwright + 수동 결합)

| ID | 시나리오 | 검증 방법 |
|----|----------|-----------|
| TC-01 | 페이지 진입 시 카드 N개 렌더 (gateways.length 일치) | locator count |
| TC-02 | 검색어 "lgw" 입력 → 매칭 카드만 표시 | 카드 count 변화 |
| TC-03 | 필터 칩 "정상" 클릭 → online + zigbee online + tunnel connected 카드만 | count |
| TC-04 | 그룹화 "없음" 토글 → 농장 헤더 제거, 카드 평면 그리드 | `.farm-group-header` count = 0 |
| TC-05 | 케밥 → 편집 클릭 → 기존 `editGateway()` 모달 노출 | 모달 가시성 + form 값 |
| TC-06 | 케밥 → SSH 명령 복사 → clipboard text == buildSetupCommand 미포함 SSH cmd | clipboard 검사 |
| TC-07 | 터미널 버튼 → WebTerminal 모달 노출 (기존 컴포넌트) | `<WebTerminal>` 가시성 |
| TC-08 | WebSocket `gateway:status` 이벤트 mock → 해당 카드 상태 dot 변화 | 색상 attr 확인 |
| TC-09 | 다크모드 활성화 → 카드 배경 var(--bg-card) 적용 | computed style |

### 9.2 단위 행위

| Input | Output |
|-------|--------|
| `farmAvatarColor('user-abc')` | 6색 중 하나 (해시 일관성) |
| `filteredGateways` with searchQuery='' filter='all' | 전체 gateways |
| `filteredGateways` with statusFilter='warn' | 비정상 게이트웨이만 |
| `groupedGateways` with groupMode='none' | `[{farmId: null, items: [...all]}]` |

---

## 10. Out of Scope (재확인)

- 새 NPM 패키지
- API 시그니처 변경
- 라우터 변경
- `useWebSocket` composable 변경
- 글로벌 스타일 (`src/style.css`, `App.vue` `<style>`) 수정
- `WebTerminal.vue` 컴포넌트 내부 수정

---

## 11. Next Steps

1. [ ] Design 문서 작성 (`gateway-management-redesign.design.md`) — 마크업 트리 + props/emit 명세 + 디자인 토큰 매트릭스 확정
2. [ ] Do 단계: 위 §8.1 작업 순서대로 진행
3. [ ] 회귀 시나리오 7~9종 통과
4. [ ] (선택) 2차 PR: 컴포넌트 분리

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-05-15 | Initial draft — handoff prompt 기반 정리, In/Out of Scope 확정, FR 17개, 회귀 시나리오 9종 | ohgane |
