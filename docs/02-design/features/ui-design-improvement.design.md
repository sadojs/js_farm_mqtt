# Design: UI 디자인 개선 - 토글 간격, 시간/날짜 피커, 센서 레이아웃

## Feature ID
`ui-design-improvement`

## Date
2026-02-22

## Reference
- Plan: `docs/01-plan/features/ui-design-improvement.plan.md`

---

## 1. 데이터 구조 변경

### 1-1. StepIrrigationCondition.vue - startTime 타입 변환

VueDatePicker의 time-picker 모드는 `{ hours: number, minutes: number }` 객체를 사용하므로, 기존 `form.startTime`(string "HH:mm")과의 변환 로직이 필요.

```typescript
// 변환 헬퍼 (컴포넌트 내부)
import { computed } from 'vue'

// string "HH:mm" → { hours, minutes } 변환
const timePickerValue = computed({
  get: () => {
    const [h, m] = (form.startTime || '00:00').split(':').map(Number)
    return { hours: h || 0, minutes: m || 0 }
  },
  set: (val: { hours: number; minutes: number }) => {
    form.startTime = `${String(val.hours).padStart(2, '0')}:${String(val.minutes).padStart(2, '0')}`
  }
})
```

- **기존 인터페이스 변경 없음**: `IrrigationFormData.startTime`은 여전히 `string` ("HH:mm")
- 변환은 컴포넌트 내부 computed에서 처리

### 1-2. Reports.vue - 날짜 값 형식 유지

VueDatePicker에 `model-type="yyyy-MM-dd"` prop을 사용하면 기존과 동일한 string 형식("2026-02-22") 유지 가능.

- **기존 인터페이스 변경 없음**: `customStartDate`, `customEndDate`는 여전히 `ref<string>('')`
- `updateDateRange()`의 기존 로직 수정 불필요

---

## 2. 다크모드 감지 방식

### 현재 구현 분석
- `App.vue` L2: `:class="{ 'theme-dark': theme === 'dark' }"`
- `App.vue` L220: `localStorage.getItem('sf-theme')` → `'light' | 'dark'`
- theme 상태는 App.vue 로컬 ref, Pinia store 없음

### VueDatePicker 다크모드 연동
`@vueuse/core`가 이미 설치되어 있으므로 `useLocalStorage`로 반응형 감지:

```typescript
import { useLocalStorage } from '@vueuse/core'
import { computed } from 'vue'

const sfTheme = useLocalStorage('sf-theme', 'light')
const isDark = computed(() => sfTheme.value === 'dark')
```

- **StepIrrigationCondition.vue**: `<VueDatePicker :dark="isDark" />`
- **Reports.vue**: `<VueDatePicker :dark="isDark" />`

---

## 3. 컴포넌트별 상세 설계

### 3-1. StepIrrigationCondition.vue (FR-02, FR-03)

#### Template 변경

**Before (L9)**:
```html
<input type="time" v-model="form.startTime" class="time-input" />
```

**After**:
```html
<VueDatePicker
  v-model="timePickerValue"
  time-picker
  :dark="isDark"
  :is-24="true"
  class="custom-time-picker"
/>
```

#### Script 변경

```typescript
// 추가 import
import VueDatePicker from '@vuepic/vue-datepicker'
import '@vuepic/vue-datepicker/dist/main.css'
import { useLocalStorage } from '@vueuse/core'
import { reactive, watch, computed } from 'vue'

// 다크모드 감지
const sfTheme = useLocalStorage('sf-theme', 'light')
const isDark = computed(() => sfTheme.value === 'dark')

// 시간 변환 computed
const timePickerValue = computed({
  get: () => {
    const [h, m] = (form.startTime || '00:00').split(':').map(Number)
    return { hours: h || 0, minutes: m || 0 }
  },
  set: (val: { hours: number; minutes: number }) => {
    form.startTime = `${String(val.hours).padStart(2, '0')}:${String(val.minutes).padStart(2, '0')}`
  }
})
```

#### CSS 변경 - 폰트 확대 (FR-03)

| 셀렉터 | Before | After |
|---------|--------|-------|
| `.field-label` | `font-size: 12px` | `font-size: calc(14px * var(--content-scale, 1))` |
| `.unit` | `font-size: 12px` | `font-size: calc(14px * var(--content-scale, 1))` |
| `.setting-name.fixed` | `font-size: 14px` | `font-size: calc(16px * var(--content-scale, 1))` |
| `.toggle-btn` | `font-size: 13px` | `font-size: calc(15px * var(--content-scale, 1))` |
| `.num-input` | `font-size: 14px` | `font-size: calc(15px * var(--content-scale, 1))` |

#### CSS 추가 - VueDatePicker 타임피커 스타일

```css
.custom-time-picker {
  max-width: 160px;
}

/* VueDatePicker 다크모드 내장이지만, 앱 CSS 변수와 통합 */
:deep(.dp__theme_dark) {
  --dp-background-color: var(--bg-card);
  --dp-text-color: var(--text-primary);
  --dp-border-color: var(--border-input);
  --dp-menu-border-color: var(--border-card);
  --dp-primary-color: var(--accent);
}

:deep(.dp__theme_light) {
  --dp-background-color: var(--bg-card);
  --dp-text-color: var(--text-primary);
  --dp-border-color: var(--border-input);
  --dp-primary-color: var(--accent);
}

:deep(.dp__input) {
  font-size: calc(16px * var(--content-scale, 1));
  font-weight: 600;
  padding: 10px 14px;
  border-radius: 8px;
}
```

### 3-2. Reports.vue (FR-04)

#### Template 변경

**Before (L47-51)**:
```html
<div v-if="dateRange === 'custom'" class="custom-dates">
  <input v-model="customStartDate" type="date" class="filter-input" />
  <span class="date-separator">~</span>
  <input v-model="customEndDate" type="date" class="filter-input" />
  <button class="btn-primary btn-sm" @click="loadAllData" :disabled="loadingData">조회</button>
</div>
```

**After**:
```html
<div v-if="dateRange === 'custom'" class="custom-dates">
  <VueDatePicker
    v-model="customStartDate"
    model-type="yyyy-MM-dd"
    :dark="isDark"
    :enable-time-picker="false"
    :format="'yyyy-MM-dd'"
    placeholder="시작 날짜"
    class="custom-date-picker"
    auto-apply
  />
  <span class="date-separator">~</span>
  <VueDatePicker
    v-model="customEndDate"
    model-type="yyyy-MM-dd"
    :dark="isDark"
    :enable-time-picker="false"
    :format="'yyyy-MM-dd'"
    placeholder="종료 날짜"
    class="custom-date-picker"
    auto-apply
  />
  <button class="btn-primary btn-sm" @click="loadAllData" :disabled="loadingData">조회</button>
</div>
```

#### Script 변경

```typescript
// 추가 import
import VueDatePicker from '@vuepic/vue-datepicker'
import '@vuepic/vue-datepicker/dist/main.css'
import { useLocalStorage } from '@vueuse/core'

// 다크모드 감지
const sfTheme = useLocalStorage('sf-theme', 'light')
const isDark = computed(() => sfTheme.value === 'dark')
```

- `customStartDate`, `customEndDate`의 ref 타입 및 사용 방식 변경 없음 (`model-type="yyyy-MM-dd"` 사용)

#### CSS 추가

```css
.custom-date-picker {
  min-width: 150px;
  max-width: 180px;
}

:deep(.dp__theme_dark) {
  --dp-background-color: var(--bg-card);
  --dp-text-color: var(--text-primary);
  --dp-border-color: var(--border-input);
  --dp-menu-border-color: var(--border-card);
  --dp-primary-color: var(--accent);
  --dp-primary-text-color: white;
  --dp-secondary-color: var(--text-muted);
  --dp-hover-color: var(--bg-secondary);
}

:deep(.dp__theme_light) {
  --dp-background-color: var(--bg-card);
  --dp-text-color: var(--text-primary);
  --dp-border-color: var(--border-input);
  --dp-primary-color: var(--accent);
  --dp-primary-text-color: white;
  --dp-hover-color: var(--bg-secondary);
}

:deep(.dp__input) {
  font-size: calc(15px * var(--content-scale, 1));
  font-weight: 500;
  padding: 12px 14px;
  border-radius: 8px;
  background: var(--bg-input);
  color: var(--text-primary);
}
```

### 3-3. Groups.vue (FR-01, FR-05)

#### FR-01: 토글 행 간격 개선

**CSS 변경 - `.sub-card-control` 간격 추가**

**Before (L788-792)**:
```css
.sub-card-control {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
```

**After**:
```css
.sub-card-control {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 0;
}

.sub-card-control + .sub-card-control {
  border-top: 1px solid var(--border-light);
}
```

- 각 토글 행에 `padding: 8px 0` 추가 → 행 간 세로 공간 확보
- 인접 형제 선택자(`+`)로 두 번째 행부터 상단 구분선 추가
- 개폐기(열림/닫힘)와 관수(타이머전원/교반기) 모두 동일하게 적용

#### FR-05: 센서 정보 가로 레이아웃

**CSS 변경 - `.sub-card-sensor-grid`**

**Before (L748-752)**:
```css
.sub-card-sensor-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(70px, 1fr));
  gap: 6px;
}
```

**After**:
```css
.sub-card-sensor-grid {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
  padding: 2px 0;
}

.sub-card-sensor-grid::-webkit-scrollbar {
  display: none;
}
```

**`.sensor-grid-item` 변경**:

**Before (L754-757)**:
```css
.sensor-grid-item {
  text-align: center;
  padding: 4px 0;
}
```

**After**:
```css
.sensor-grid-item {
  text-align: center;
  padding: 4px 6px;
  flex-shrink: 0;
  min-width: 60px;
}
```

- `flex-shrink: 0`으로 항목 축소 방지, 한 줄로 가로 나열
- 센서 개수가 많을 경우 가로 스크롤 허용 (스크롤바 숨김)

---

## 4. 수정 파일 요약

| # | File | FR | 변경 내용 |
|---|------|-----|----------|
| 1 | `package.json` | FR-02,04 | `@vuepic/vue-datepicker` 의존성 추가 |
| 2 | `StepIrrigationCondition.vue` | FR-02 | VueDatePicker import, time-picker 교체, `timePickerValue` computed, 다크모드 연동 |
| 3 | `StepIrrigationCondition.vue` | FR-03 | 5개 CSS 셀렉터 폰트 확대 + `calc(var(--content-scale))` 패턴 적용 |
| 4 | `Reports.vue` | FR-04 | VueDatePicker import, `<input type="date">` 2개 교체, 다크모드 연동, CSS 커스터마이징 |
| 5 | `Groups.vue` | FR-01 | `.sub-card-control` padding + 인접 형제 구분선 CSS |
| 6 | `Groups.vue` | FR-05 | `.sub-card-sensor-grid` grid→flex, `.sensor-grid-item` flex-shrink:0 |

**신규 파일**: 없음
**백엔드 변경**: 없음
**인터페이스 변경**: 없음 (내부 computed로 변환 처리)

---

## 5. 구현 순서 (5 Phase, 7 Step)

### Phase 1: 외부 라이브러리 설치

| Step | 작업 |
|------|------|
| 1-1 | `npm install @vuepic/vue-datepicker` |

### Phase 2: 자동화룰 시간 피커 + 폰트 (FR-02, FR-03)

| Step | 파일 | 작업 |
|------|------|------|
| 2-1 | StepIrrigationCondition.vue `<script>` | VueDatePicker, useLocalStorage import + `isDark` computed + `timePickerValue` computed 추가 |
| 2-2 | StepIrrigationCondition.vue `<template>` | `<input type="time">` → `<VueDatePicker time-picker>` 교체 |
| 2-3 | StepIrrigationCondition.vue `<style>` | 폰트 5개 셀렉터 확대 + VueDatePicker 커스텀 CSS 추가 |

### Phase 3: 리포트 날짜 피커 (FR-04)

| Step | 파일 | 작업 |
|------|------|------|
| 3-1 | Reports.vue `<script>` | VueDatePicker, useLocalStorage import + `isDark` computed 추가 |
| 3-2 | Reports.vue `<template>` | `<input type="date">` 2개 → `<VueDatePicker model-type="yyyy-MM-dd">` 교체 |
| 3-3 | Reports.vue `<style>` | VueDatePicker 커스텀 CSS 추가 (다크/라이트 테마) |

### Phase 4: 그룹관리 토글 간격 + 센서 레이아웃 (FR-01, FR-05)

| Step | 파일 | 작업 |
|------|------|------|
| 4-1 | Groups.vue `<style>` | `.sub-card-control` padding + 구분선 CSS 추가 |
| 4-2 | Groups.vue `<style>` | `.sub-card-sensor-grid` grid→flex 변경 + `.sensor-grid-item` flex-shrink 추가 |

### Phase 5: 빌드 검증

| Step | 작업 |
|------|------|
| 5-1 | `npm run build` (Vite + TypeScript) 통과 확인 |

---

## 6. 영향도 분석

| 항목 | 영향 |
|------|------|
| 신규 의존성 | `@vuepic/vue-datepicker` 1개 추가 |
| 기능 변경 | UI만 변경, 동작 로직 동일 |
| 타입 변경 | 없음 (내부 computed로 변환) |
| Backend | 없음 |
| DB | 없음 |
| 기존 CSS 변수 | 재사용 (--bg-card, --text-primary, --border-input, --accent 등) |
