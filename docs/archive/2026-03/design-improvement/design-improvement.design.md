# Design: design-improvement

> 디자인 리뷰(72/100점) 기반 UI/UX 개선 — 상세 설계

## 1. 변경 범위 요약

- **DB 변경**: 없음
- **백엔드 변경**: 없음
- **프론트엔드 수정**: 8개 뷰 + 2개 컴포넌트 (CSS + 일부 템플릿)
- **신규 파일**: 없음

---

## 2. FR-01: 모바일 모달 Full-Screen Bottom Sheet (Critical)

### 2-1. 대상 모달 목록

| # | 파일 | 모달 | 현재 CSS | 비고 |
|---|------|------|----------|------|
| 1 | `Groups.vue` | 환경설정 모달 | `.modal-overlay + .modal-content` (L1211-1249) | max-width:560px, 85vh |
| 2 | `Groups.vue` | 그룹 추가 모달 | 동일 `.modal-overlay` 공유 | 위와 동일 CSS |
| 3 | `Groups.vue` | 장비 추가 모달 | `.modal-overlay + .add-device-modal` | max-width:560px, 85vh |
| 4 | `Harvest.vue` | 배치 추가 모달 | `.modal-overlay + .modal-content` (L910-934) | max-width:480px, 85vh |
| 5 | `Devices.vue` (DeviceRegistration) | 장비 등록 모달 | `.modal-overlay + .modal-container` (L583-610) | max-width:700px, 90vh, **이미 모바일 full-screen 대응** |
| 6 | `Automation.vue` (RuleWizardModal) | 룰 추가 위저드 | `.modal-overlay + .modal-container` (L208-218) | **width:560px 고정, 모바일 미대응** |
| 7 | `Automation.vue` (AutomationEditModal) | 룰 수정 모달 | `.modal-overlay + .modal-container` (L164-174) | max-width:600px, 90vh |

### 2-2. DeviceRegistration.vue — 이미 모바일 대응 완료 (참조 패턴)

```css
/* 이미 구현된 모범 패턴 (DeviceRegistration.vue L1111-1162) */
@media (max-width: 768px) {
  .modal-overlay { padding: 0; }
  .modal-container {
    border-radius: 0;
    max-width: 100%;
    max-height: 100%;
    height: 100vh;
    height: 100dvh;
  }
  .modal-header {
    padding: 16px 20px;
    padding-top: calc(16px + env(safe-area-inset-top, 0px));
  }
  .modal-body {
    padding: 16px 20px;
    padding-bottom: calc(16px + env(safe-area-inset-bottom, 0px));
  }
}
```

> DeviceRegistration.vue는 이미 모범적으로 구현되어 있으므로 **수정 불필요**. 나머지 6개 모달에 동일 패턴 적용.

### 2-3. 모바일 Full-Screen CSS 규격 (6개 모달 공통 적용)

```css
@media (max-width: 768px) {
  /* 모달 오버레이 */
  .modal-overlay {
    padding: 0;
    background: rgba(0, 0, 0, 0.7);  /* opacity 0.5→0.7 증가 */
  }

  /* 모달 컨테이너 (full-screen) */
  .modal-content,
  .modal-container,
  .add-device-modal {
    border-radius: 0;
    max-width: 100%;
    max-height: 100%;
    width: 100%;
    height: 100vh;
    height: 100dvh;
  }

  /* 모달 헤더 (safe-area) */
  .modal-header {
    padding: 16px 20px;
    padding-top: calc(16px + env(safe-area-inset-top, 0px));
  }

  /* 모달 바디 (스크롤 영역) */
  .modal-body {
    overflow-y: auto;
    flex: 1;
    padding: 16px 20px;
    padding-bottom: calc(16px + env(safe-area-inset-bottom, 0px));
  }
}
```

### 2-4. 배경 스크롤 차단 (body lock)

```typescript
// 모달 open/close 시 body 스크롤 차단
function lockBodyScroll() {
  document.body.style.overflow = 'hidden';
  document.body.style.position = 'fixed';
  document.body.style.width = '100%';
  document.body.style.top = `-${window.scrollY}px`;
}

function unlockBodyScroll() {
  const scrollY = document.body.style.top;
  document.body.style.overflow = '';
  document.body.style.position = '';
  document.body.style.width = '';
  document.body.style.top = '';
  window.scrollTo(0, parseInt(scrollY || '0') * -1);
}
```

> **적용 방식**: 각 모달의 open/close 로직에 `lockBodyScroll()`/`unlockBodyScroll()` 호출 추가. 또는 `watch`로 모달 visible 상태 변경 시 자동 처리.

### 2-5. 파일별 적용 상세

#### Groups.vue

**현재 모달 CSS** (L1211-1249):
```css
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 300; }
.modal-content { width: 100%; max-width: 560px; max-height: 85vh; border-radius: 14px; }
```

**추가할 CSS** (기존 `@media (max-width: 768px)` 블록 내부에 추가):
```css
@media (max-width: 768px) {
  .modal-overlay { padding: 0; background: rgba(0, 0, 0, 0.7); }
  .modal-content, .add-device-modal {
    border-radius: 0; max-width: 100%; max-height: 100%;
    width: 100%; height: 100vh; height: 100dvh;
  }
  .modal-header, .add-modal-header {
    padding-top: calc(16px + env(safe-area-inset-top, 0px));
  }
  .modal-body, .add-modal-body {
    overflow-y: auto; flex: 1;
    padding-bottom: calc(16px + env(safe-area-inset-bottom, 0px));
  }
}
```

**body lock**: `showEnvConfigModal`, `showAddGroupModal`, `showAddDeviceModal` 각 watch에 lock/unlock 추가.

#### Harvest.vue

**현재 모달 CSS** (L910-934):
```css
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 300; }
.modal-content { max-width: 480px; max-height: 85vh; border-radius: 14px; }
```

**추가할 CSS** (기존 `@media (max-width: 768px)` 블록 내부에 추가):
```css
@media (max-width: 768px) {
  .modal-overlay { padding: 0; background: rgba(0, 0, 0, 0.7); }
  .modal-content {
    border-radius: 0; max-width: 100%; max-height: 100%;
    width: 100%; height: 100vh; height: 100dvh;
  }
  .modal-header { padding-top: calc(16px + env(safe-area-inset-top, 0px)); }
  .modal-body {
    overflow-y: auto; flex: 1;
    padding-bottom: calc(16px + env(safe-area-inset-bottom, 0px));
  }
}
```

**body lock**: `showBatchModal` watch에 lock/unlock 추가.

#### RuleWizardModal.vue (`components/automation/RuleWizardModal.vue`)

**현재 모달 CSS** (L208-218):
```css
.modal-overlay { position: fixed; inset: 0; z-index: 1000; }
.modal-container { width: 560px; max-height: 90vh; border-radius: 16px; }
```
> **주의**: `width: 560px` 고정 — 모바일에서 완전히 넘침

**추가할 CSS** (파일 끝에 media query 블록 신규 추가):
```css
@media (max-width: 768px) {
  .modal-overlay { padding: 0; }
  .modal-container {
    width: 100%; border-radius: 0;
    max-height: 100%; height: 100vh; height: 100dvh;
  }
  .modal-header {
    padding-top: calc(12px + env(safe-area-inset-top, 0px));
  }
  .modal-body {
    overflow-y: auto; flex: 1;
    padding-bottom: calc(16px + env(safe-area-inset-bottom, 0px));
  }
  .modal-footer {
    padding-bottom: calc(16px + env(safe-area-inset-bottom, 0px));
  }
}
```

**body lock**: `visible` prop watch에 lock/unlock 추가.

#### AutomationEditModal.vue (`components/automation/AutomationEditModal.vue`)

**현재 모달 CSS** (L164-174):
```css
.modal-overlay { position: fixed; inset: 0; z-index: 1000; padding: 20px; }
.modal-container { width: 100%; max-width: 600px; max-height: 90vh; border-radius: 20px; }
```

**추가할 CSS** (파일 끝에 media query 블록 신규 추가):
```css
@media (max-width: 768px) {
  .modal-overlay { padding: 0; }
  .modal-container {
    border-radius: 0; max-width: 100%; max-height: 100%;
    height: 100vh; height: 100dvh;
  }
  .modal-header {
    padding-top: calc(16px + env(safe-area-inset-top, 0px));
  }
  .modal-body {
    overflow-y: auto; flex: 1;
    padding-bottom: calc(16px + env(safe-area-inset-bottom, 0px));
  }
}
```

**body lock**: `visible` prop watch에 lock/unlock 추가.

---

## 3. FR-02: "0개 추가" 버튼 Disabled 처리 (Critical)

### 3-1. 현재 코드 (Groups.vue L192-205)

```vue
<div class="add-modal-footer">
  <button class="btn-secondary" @click="showAddDeviceModal = false">취소</button>
  <button
    class="btn-primary"
    :disabled="addDeviceSelected.length === 0 || addingDevices"
    @click="confirmAddDevices"
  >
    <span v-if="addingDevices">추가 중...</span>
    <span v-else>{{ addDeviceSelected.length }}개 추가</span>
  </button>
</div>
```

### 3-2. 분석 결과

> **이미 `:disabled="addDeviceSelected.length === 0"` 처리 완료!**
> 코드 분석 결과 버튼은 이미 0개일 때 disabled됨.
> 다만 **텍스트가 "0개 추가"로 표시**되는 문제는 있음.

### 3-3. 수정 사항 (텍스트 개선만)

```vue
<!-- 변경 전 -->
<span v-else>{{ addDeviceSelected.length }}개 추가</span>

<!-- 변경 후 -->
<span v-else-if="addDeviceSelected.length === 0">장비를 선택하세요</span>
<span v-else>{{ addDeviceSelected.length }}개 추가</span>
```

### 3-4. disabled 스타일 보강

```css
.add-modal-footer .btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
```

---

## 4. FR-03: 날짜 포맷 yyyy-MM-dd 통일 (High)

### 4-1. 대상 분석

| 파일 | 현재 구현 | 포맷 |
|------|----------|------|
| `Harvest.vue` L277, L282 | `<input type="date">` 네이티브 | 브라우저 기본 (mm/dd/yyyy 가능) |
| `Reports.vue` L48-86 | VueDatePicker | `model-type="yyyy-MM-dd"` (이미 통일) |

### 4-2. 수정 대상: Harvest.vue만

```vue
<!-- 현재 (네이티브 date input) -->
<input type="date" v-model="batchForm.sowDate" />
<input type="date" v-model="batchForm.transplantDate" />

<!-- 변경: VueDatePicker로 교체 -->
<VueDatePicker
  v-model="batchForm.sowDate"
  model-type="yyyy-MM-dd"
  :format="'yyyy-MM-dd'"
  locale="ko"
  :enable-time-picker="false"
  auto-apply
  :dark="isDark"
  placeholder="날짜 선택"
>
  <template #dp-input="{ value }">
    <input class="date-input" :value="value" readonly placeholder="날짜 선택" />
  </template>
</VueDatePicker>
```

### 4-3. isDark computed 추가

```typescript
// Harvest.vue <script setup> 에 추가
import { useLocalStorage } from '@vueuse/core'
const theme = useLocalStorage('sf-theme', 'light')
const isDark = computed(() => theme.value === 'dark')
```

> Reports.vue는 이미 VueDatePicker + `model-type="yyyy-MM-dd"` 사용 중이므로 **수정 불필요**.

### 4-4. VueDatePicker 커스텀 CSS (다크모드 대응)

```css
/* Harvest.vue에 추가 — Reports.vue 기존 패턴 참조 */
.date-input {
  width: 100%;
  padding: 10px 14px;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: calc(15px * var(--content-scale, 1));
  cursor: pointer;
}
```

---

## 5. FR-04: 빈 상태(Empty State) CTA 개선 (Medium)

### 5-1. Sensors.vue (환경 모니터링)

**현재 코드** (L19-22):
```vue
<div class="empty-state">
  <h3>센서가 등록된 그룹이 없습니다</h3>
  <p>장비를 그룹에 추가한 후 이 페이지에서 환경 데이터를 확인할 수 있습니다.</p>
</div>
```

**변경 후**:
```vue
<div class="empty-state">
  <h3>센서가 등록된 그룹이 없습니다</h3>
  <p>장비를 그룹에 추가한 후 이 페이지에서 환경 데이터를 확인할 수 있습니다.</p>
  <div class="empty-guide">
    <p class="guide-steps">
      ① 장비 관리에서 센서 장비를 등록하세요<br/>
      ② 그룹 관리에서 그룹을 만들고 장비를 추가하세요<br/>
      ③ 이 페이지에서 실시간 환경 데이터를 확인하세요
    </p>
    <router-link to="/devices" class="btn-cta">장비 관리로 이동</router-link>
  </div>
</div>
```

**추가 CSS**:
```css
.empty-guide {
  margin-top: 16px;
}
.guide-steps {
  font-size: calc(14px * var(--content-scale, 1));
  color: var(--text-secondary);
  line-height: 1.8;
  text-align: left;
  margin-bottom: 16px;
}
.btn-cta {
  display: inline-block;
  padding: 12px 24px;
  background: var(--accent);
  color: white;
  border-radius: 10px;
  text-decoration: none;
  font-size: calc(15px * var(--content-scale, 1));
  font-weight: 600;
  transition: opacity 0.2s;
}
.btn-cta:hover { opacity: 0.85; }
```

### 5-2. Alerts.vue (센서 알림)

**현재 코드** (L28-32 활성 센서 빈 상태):
```vue
<div class="empty-state">
  <p>활성 센서가 없습니다</p>
  <p class="sub">장비를 등록하면 센서 모니터링이 시작됩니다.</p>
</div>
```

**변경 후**:
```vue
<div class="empty-state">
  <p>활성 센서가 없습니다</p>
  <p class="sub">장비를 등록하고 센서를 활성화하세요.</p>
  <router-link to="/devices" class="btn-cta-sm">장비 관리</router-link>
</div>
```

**추가 CSS**:
```css
.btn-cta-sm {
  display: inline-block;
  margin-top: 12px;
  padding: 8px 20px;
  background: var(--accent);
  color: white;
  border-radius: 8px;
  text-decoration: none;
  font-size: calc(14px * var(--content-scale, 1));
  font-weight: 500;
}
.btn-cta-sm:hover { opacity: 0.85; }
```

### 5-3. Dashboard.vue (빈 상태 인라인 링크)

**현재 분석**: Dashboard.vue의 가동 장비/센서 현황 카드에는 명시적 empty state가 없고, 0/0 수치만 표시됨.

**SummaryCards.vue 수정** (대시보드 상단 카드 컴포넌트):

```vue
<!-- 가동 장비 카드 내부 — 값이 0일 때 링크 추가 -->
<template v-if="activeDevices === 0 && totalDevices === 0">
  <span class="empty-inline">
    장비 미등록 · <router-link to="/devices" class="link-inline">설정하기</router-link>
  </span>
</template>
```

**추가 CSS**:
```css
.empty-inline {
  font-size: calc(13px * var(--content-scale, 1));
  color: var(--text-muted);
}
.link-inline {
  color: var(--accent);
  text-decoration: underline;
  font-weight: 500;
}
```

> **주의**: SummaryCards.vue 컴포넌트 구조에 따라 props 전달 방식 조정 필요. `router-link` 사용을 위해 `vue-router` import 확인.

---

## 6. FR-05: 리포트 모바일 레이아웃 개선 (Medium)

### 6-1. 수정 대상: Reports.vue

#### A. 기간 선택 버튼 가로 스크롤

**현재 문제**: 모바일에서 기간 버튼이 `flex-wrap: wrap`으로 세로 쌓임

```css
/* Reports.vue 기존 @media (max-width: 768px) 블록 내 추가/수정 */
@media (max-width: 768px) {
  .period-buttons {
    display: flex;
    flex-wrap: nowrap;
    overflow-x: auto;
    gap: 8px;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;  /* Firefox */
    padding-bottom: 4px;
  }
  .period-buttons::-webkit-scrollbar {
    display: none;  /* Chrome/Safari */
  }
  .period-buttons .btn-period {
    flex-shrink: 0;
    white-space: nowrap;
  }
}
```

#### B. 다운로드 버튼 줄바꿈 방지

```css
@media (max-width: 768px) {
  .download-section {
    white-space: nowrap;
  }
  .download-section .btn-download {
    white-space: nowrap;
    padding: 8px 12px;
    font-size: calc(13px * var(--content-scale, 1));
  }
}
```

#### C. 데이터 테이블 가로 스크롤

```css
@media (max-width: 768px) {
  .table-container {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }
  .table-container table {
    min-width: 600px;  /* 최소 너비 확보로 가로 스크롤 유도 */
  }
}
```

---

## 7. FR-06: 모바일 터치 타겟 44px 확보 (Medium)

### 7-1. 수정 대상: Groups.vue 아이콘 버튼

**현재 CSS** (`.btn-icon` L1106-1112):
```css
.btn-icon {
  /* 크기 미지정 — 기본 아이콘 크기에 의존 */
}
```

**수정할 CSS** (기존 `.btn-icon` 수정 + 모바일 미디어쿼리):
```css
/* 데스크톱 기본 */
.btn-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 36px;
  min-height: 36px;
}

/* 모바일: 44px 터치 타겟 확보 */
@media (max-width: 768px) {
  .btn-icon {
    min-width: 44px;
    min-height: 44px;
  }
}
```

---

## 8. FR-07: 자동화 동작 한국어화 (Low)

### 8-1. 분석 결과

`Automation.vue`의 `formatAction()` 함수 (`automation-helpers.ts`)는 이미 한국어로 "장비 제어 (조건에 따라 ON/OFF)" 등으로 표시.

**실제 영문 노출 위치 확인**: 룰 카드의 동작 섹션에서 `rule.actions[].command` 값이 직접 표시되는 경우.

### 8-2. 동작 매핑 객체 추가

**파일**: `frontend/src/utils/automation-helpers.ts`

```typescript
// 동작 코드 → 한글 매핑
export const ACTION_LABELS: Record<string, string> = {
  open: '열기',
  close: '닫기',
  on: '켜기',
  off: '끄기',
  stop: '정지',
  toggle: '전환',
};

export function localizeAction(action: string): string {
  return ACTION_LABELS[action.toLowerCase()] ?? action;
}
```

### 8-3. Automation.vue 적용

```vue
<!-- 동작 표시 시 localizeAction 사용 -->
<span class="section-content">{{ localizeAction(action.command) }}</span>
```

> `formatAction()` 이 이미 한국어를 반환하는 경우, 추가로 `action.command`가 직접 표시되는 템플릿만 찾아서 `localizeAction()` 래핑.

---

## 9. FR-08: 그룹 아이콘 Tooltip 추가 (Low)

### 9-1. 수정 대상: Groups.vue 그룹 헤더 아이콘 버튼

**현재 코드** (L33-36):
```vue
<button class="btn-icon" @click="openEnvConfig(group)">⚙</button>
<button class="btn-icon" @click="openAddDeviceModal(group)" aria-label="장비 추가">+</button>
<button class="btn-icon" @click="confirmDeleteGroup(group)">🗑</button>
<button class="btn-icon" @click="toggleGroupCollapse(group)">▼</button>
```

**변경 후**:
```vue
<button class="btn-icon" @click="openEnvConfig(group)" title="환경설정" aria-label="환경설정">⚙</button>
<button class="btn-icon" @click="openAddDeviceModal(group)" title="장비 추가" aria-label="장비 추가">+</button>
<button class="btn-icon" @click="confirmDeleteGroup(group)" title="그룹 삭제" aria-label="그룹 삭제">🗑</button>
<button class="btn-icon" @click="toggleGroupCollapse(group)" title="접기/펼치기" aria-label="접기/펼치기">
  {{ group.collapsed ? '▶' : '▼' }}
</button>
```

> native `title` attribute로 tooltip 구현 (추가 JS/CSS 불필요).

---

## 10. 구현 순서

| Phase | FR | 작업 내용 | 수정 파일 | 난이도 |
|-------|-----|----------|----------|--------|
| 1 | FR-01 | 모바일 모달 Full-Screen (6개 모달) | Groups.vue, Harvest.vue, RuleWizardModal.vue, AutomationEditModal.vue | High |
| 2 | FR-02 | "0개 추가" 텍스트 개선 + disabled 스타일 | Groups.vue | Low |
| 3 | FR-03 | Harvest.vue 날짜 VueDatePicker 교체 | Harvest.vue | Low |
| 4 | FR-04 | 빈 상태 CTA (3개 페이지) | Sensors.vue, Alerts.vue, Dashboard.vue (SummaryCards.vue) | Medium |
| 5 | FR-05 | 리포트 모바일 레이아웃 | Reports.vue | Medium |
| 6 | FR-06 | 터치 타겟 44px | Groups.vue | Low |
| 7 | FR-07 | 동작 한국어화 | automation-helpers.ts, Automation.vue | Low |
| 8 | FR-08 | 아이콘 Tooltip | Groups.vue | Low |

> **Phase 1 세부**: Groups.vue(3개 모달) → Harvest.vue(1개) → RuleWizardModal(1개) → AutomationEditModal(1개) 순서로 진행. DeviceRegistration.vue는 이미 완료이므로 제외.

---

## 11. 검증 체크리스트 (18항목)

| # | 검증 항목 | FR | 검증 방법 |
|---|----------|-----|----------|
| 1 | 모바일에서 6개 모달 full-screen 열림 | FR-01 | 768px 이하에서 각 모달 오픈 확인 |
| 2 | 모달 오픈 시 배경 스크롤 차단 | FR-01 | body overflow:hidden 확인 |
| 3 | 모달 닫기 시 배경 스크롤 복원 | FR-01 | 모달 닫은 후 스크롤 위치 유지 확인 |
| 4 | 데스크톱에서 모달 기존 동작 유지 | FR-01 | 1024px 이상에서 모달 정상 렌더링 |
| 5 | safe-area-inset 적용 확인 | FR-01 | iOS Safari에서 노치 영역 겹침 없음 |
| 6 | 장비 0개 시 "장비를 선택하세요" 표시 | FR-02 | 장비추가 모달에서 미선택 상태 확인 |
| 7 | 장비 N개 선택 시 "N개 추가" 표시 | FR-02 | 1개 이상 선택 후 버튼 텍스트 확인 |
| 8 | 배치 추가 날짜가 yyyy-MM-dd 형식 | FR-03 | VueDatePicker 렌더링 확인 |
| 9 | 환경 모니터링 빈 상태에 가이드+CTA | FR-04 | 그룹 없는 상태에서 페이지 접근 |
| 10 | 센서 알림 빈 상태에 CTA | FR-04 | 활성 센서 없을 때 확인 |
| 11 | 대시보드 빈 카드에 "설정하기" 링크 | FR-04 | 장비 0대일 때 확인 |
| 12 | 리포트 기간 버튼 가로 스크롤 | FR-05 | 모바일에서 기간 버튼 스와이프 |
| 13 | 리포트 "다운로드" 줄바꿈 안됨 | FR-05 | 모바일에서 다운로드 버튼 확인 |
| 14 | 리포트 데이터 테이블 가로 스크롤 | FR-05 | 모바일에서 테이블 좌우 스크롤 |
| 15 | 그룹 아이콘 터치 타겟 44px | FR-06 | 모바일에서 아이콘 크기 확인 |
| 16 | 자동화 동작 한국어 표시 | FR-07 | 룰 카드에서 "열기/닫기" 등 확인 |
| 17 | 그룹 아이콘 tooltip 표시 | FR-08 | 데스크톱에서 아이콘 hover 시 tooltip |
| 18 | 프론트엔드 빌드 통과 | 전체 | `vue-tsc && vite build` |

---

## 12. 수정 파일 요약

### 수정 파일 (10개)

| # | 파일 | FR | 변경 내용 |
|---|------|-----|----------|
| M1 | `frontend/src/views/Groups.vue` | FR-01,02,06,08 | 모바일 모달 full-screen CSS + 장비추가 텍스트 + 터치 타겟 + tooltip |
| M2 | `frontend/src/views/Harvest.vue` | FR-01,03 | 모바일 모달 full-screen CSS + VueDatePicker 교체 |
| M3 | `frontend/src/views/Automation.vue` | FR-07 | localizeAction 적용 (있는 경우) |
| M4 | `frontend/src/views/Reports.vue` | FR-05 | 기간 버튼 nowrap + 다운로드 nowrap + 테이블 스크롤 |
| M5 | `frontend/src/views/Sensors.vue` | FR-04 | 빈 상태 가이드 + CTA 버튼 |
| M6 | `frontend/src/views/Alerts.vue` | FR-04 | 빈 상태 CTA 링크 |
| M7 | `frontend/src/views/Dashboard.vue` | FR-04 | SummaryCards 빈 상태 인라인 링크 (또는 Dashboard.vue 직접) |
| M8 | `frontend/src/components/automation/RuleWizardModal.vue` | FR-01 | 모바일 full-screen media query 추가 |
| M9 | `frontend/src/components/automation/AutomationEditModal.vue` | FR-01 | 모바일 full-screen media query 추가 |
| M10 | `frontend/src/utils/automation-helpers.ts` | FR-07 | ACTION_LABELS 매핑 + localizeAction 함수 |

### 신규 파일: 없음
