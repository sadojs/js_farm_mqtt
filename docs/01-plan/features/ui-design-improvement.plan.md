# Plan: UI 디자인 개선 - 토글 간격, 시간/날짜 피커, 센서 레이아웃

## Feature ID
`ui-design-improvement`

## Date
2026-02-22

---

## 1. 배경

스크린샷 검토 결과 다음과 같은 UI 가시성/디자인 문제가 발견됨:

1. 그룹관리의 개폐기/관수 토글 버튼이 위아래로 붙어 있어 가시성이 떨어짐
2. 자동화룰 관수 조건의 시간 피커에서 분이 잘려 보이고, 네이티브 시간 피커가 다크 테마와 어울리지 않음
3. 자동화룰 상세설정 폰트가 작아 가독성 부족
4. 리포트 날짜 선택 시 달력 아이콘이 배경색과 비슷해 잘 보이지 않고, 네이티브 달력이 다크 테마와 어울리지 않음
5. 그룹관리 센서 정보가 그리드(2행)로 표시되어 가독성 개선 필요

---

## 2. 요구사항

### FR-01: 그룹관리 토글 버튼 간격 개선
- **대상**: Groups.vue의 개폐기(열림/닫힘)와 관수(타이머전원/교반기) 토글 행
- **문제**: `.sub-card-control` 행 사이 간격 없음, 두 토글이 붙어 있어 구분 어려움
- **개선**: 토글 행 사이에 구분선(divider) 또는 적절한 간격(gap) 추가, 라벨 영역 확대

### FR-02: 자동화룰 시간 피커 교체 (커스텀 타임 피커)
- **대상**: StepIrrigationCondition.vue의 `<input type="time">`
- **문제**: 네이티브 시간 피커에서 분이 잘려 보이고("09:2"), 다크 모드에서 흰색 배경의 브라우저 기본 드롭다운이 표시됨
- **개선**: `@vuepic/vue-datepicker`의 time-picker 모드 도입, dark 프롭으로 다크 테마 연동
- **외부 라이브러리**: `@vuepic/vue-datepicker` (Vue 3, 다크모드 내장, 시간/날짜 모두 지원)

### FR-03: 자동화룰 상세설정 폰트 확대
- **대상**: StepIrrigationCondition.vue의 `.field-label`, `.unit`, `.setting-name`, `.num-input`, `.toggle-btn`
- **문제**: field-label 12px, unit 12px, toggle-btn 13px 등 전반적으로 작음
- **개선**: field-label 14px, unit 14px, setting-name 16px, toggle-btn 15px, num-input 15px 으로 확대
- **content-scale 적용**: `calc(Xpx * var(--content-scale, 1))` 패턴 일관 적용

### FR-04: 리포트 날짜 피커 교체 (커스텀 데이트 피커)
- **대상**: Reports.vue의 `<input type="date">`
- **문제**: 달력 아이콘이 다크 배경에서 보이지 않고, 네이티브 달력 팝업이 앱 디자인과 불일치
- **개선**: `@vuepic/vue-datepicker` 도입, dark 프롭으로 다크 테마 연동, 앱 CSS 변수와 통합

### FR-05: 그룹관리 센서 정보 가로 레이아웃
- **대상**: Groups.vue의 `.sub-card-sensor-grid`
- **문제**: 현재 `grid-template-columns: repeat(auto-fit, minmax(70px, 1fr))`로 2행 그리드
- **개선**: 가로 한 줄 flex 레이아웃으로 변경, 모든 센서 값을 한 행에 표시 (스크롤 허용)

---

## 3. 기술 결정

### 외부 라이브러리: `@vuepic/vue-datepicker`
- **선택 이유**: Vue 3 전용, 다크/라이트 테마 내장, 시간 피커 + 날짜 피커 모두 지원, CSS 변수 기반 커스터마이징
- **설치**: `npm install @vuepic/vue-datepicker`
- **사용 방식**:
  - 시간 피커: `<VueDatePicker time-picker :dark="isDark" />`
  - 날짜 피커: `<VueDatePicker :dark="isDark" />`
- **다크모드 연동**: 앱의 다크모드 상태를 `dark` prop에 바인딩

---

## 4. 수정 대상 파일

| File | FR | 변경 내용 |
|------|-----|----------|
| `package.json` | FR-02,04 | `@vuepic/vue-datepicker` 의존성 추가 |
| `StepIrrigationCondition.vue` | FR-02 | `<input type="time">` → `<VueDatePicker time-picker>` |
| `StepIrrigationCondition.vue` | FR-03 | 상세설정 폰트 크기 확대 (12px→14px, 13px→15px 등) |
| `Reports.vue` | FR-04 | `<input type="date">` 2개 → `<VueDatePicker>` |
| `Groups.vue` template | FR-01 | 토글 행 간격/구분선 추가 |
| `Groups.vue` style | FR-01 | `.sub-card-control` gap/divider CSS |
| `Groups.vue` template/style | FR-05 | 센서 그리드 → 가로 flex 레이아웃 |

**신규 파일**: 없음
**백엔드 변경**: 없음

---

## 5. 구현 순서 (5 Phase)

### Phase 1: 외부 라이브러리 설치
| Step | 작업 |
|------|------|
| 1-1 | `npm install @vuepic/vue-datepicker` |

### Phase 2: 자동화룰 시간 피커 + 폰트 (FR-02, FR-03)
| Step | 파일 | 작업 |
|------|------|------|
| 2-1 | StepIrrigationCondition.vue | VueDatePicker import + time-picker 교체 |
| 2-2 | StepIrrigationCondition.vue | 다크모드 연동 (dark prop) |
| 2-3 | StepIrrigationCondition.vue | 상세설정 폰트 확대 CSS 수정 |

### Phase 3: 리포트 날짜 피커 (FR-04)
| Step | 파일 | 작업 |
|------|------|------|
| 3-1 | Reports.vue | VueDatePicker import + 날짜 input 2개 교체 |
| 3-2 | Reports.vue | 다크모드 연동 + CSS 변수 커스터마이징 |

### Phase 4: 그룹관리 토글 간격 + 센서 레이아웃 (FR-01, FR-05)
| Step | 파일 | 작업 |
|------|------|------|
| 4-1 | Groups.vue | 개폐기/관수 토글 행 간격 + 구분선 CSS |
| 4-2 | Groups.vue | 센서 그리드 → 가로 flex 레이아웃 |

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
| Backend | 없음 |
| DB | 없음 |
| 타입 변경 | 시간/날짜 바인딩 형식 변경 가능 (string → object) |

---

## 7. 참고 자료
- [@vuepic/vue-datepicker 공식 문서](https://vue3datepicker.com/)
- [vue-datepicker 다크모드 테마 설정](https://vue3datepicker.com/customization/theming/)
- [vue-datepicker 시간 피커 모드](https://vue3datepicker.com/props/time-picker-configuration/)
