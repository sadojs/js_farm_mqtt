# Plan: Platform Fix v3 - 센서표시/대시보드/다크모드/카드 수정

## 요구사항 (FR)

### FR-01: 센서 표시 항목 필터링
- **현황**: SENSOR_FIELD_META(Sensors.vue:108-116)에 7개 필드 전체 표시 (temperature, humidity, co2, light, soil_moisture, ph, ec)
- **변경**: 화면 표시를 5개로 제한: 온도, 습도, 강우량(rain), UV, 이슬점(dew_point)
  - DB 기록은 전체 유지, UI 표시만 필터링
  - SENSOR_FIELD_META에 rain, uv, dew_point 추가 + displayOnly 플래그 또는 별도 DISPLAY_FIELDS 배열
- **영향 파일**:
  - `views/Sensors.vue` (SENSOR_FIELD_META + 표시 로직)
  - `utils/automation-helpers.ts` (SENSOR_CONDITION_FIELDS:149-231 → 5개만 노출)
  - `components/automation/StepConditionBuilder.vue` (필드 드롭다운)
  - `components/dashboard/SummaryCards.vue` (센서 요약)
- **우선순위**: High

### FR-02: 대시보드 정리 + 날씨 크기 확대
- **현황**:
  - 격자(NX/NY) 표시됨 (Dashboard.vue:49-53)
  - 하단 "조회 정보" API 카드 (Dashboard.vue:61-81)
  - 날씨 상세 아이콘 20px, 라벨 14px (Dashboard.vue:284,287)
- **변경**:
  - 격자 `.weather-detail-item` 제거 (NX/NY 행)
  - 조회 정보 카드 전체 제거 (`.info-card` 섹션)
  - 날씨 상세 아이콘: 20px → 28px, 라벨/값 크기 확대
- **영향 파일**: `views/Dashboard.vue`
- **우선순위**: Medium

### FR-03: 다크모드 본문 배경색 수정
- **현황**: 여러 컴포넌트에 `background: white` 하드코딩 잔존
  - Dashboard.vue:300 `.info-card { background: white }`
  - UserManagement.vue:298
  - StepConditionBuilder.vue:246,265
  - RuleWizardModal.vue:173
- **변경**: 모든 `background: white` → `var(--bg-card)` 또는 `var(--bg-secondary)`
- **영향 파일**: Dashboard.vue, UserManagement.vue, StepConditionBuilder.vue, RuleWizardModal.vue, 기타 발견시
- **우선순위**: High

### FR-04: 자동화 룰 카드 녹색 제거
- **현황**: Automation.vue:296 `border-left: 4px solid var(--accent)` (녹색 좌측 보더)
- **변경**: border-left 제거하여 다른 카드와 동일한 디자인으로 통일
- **영향 파일**: `views/Automation.vue`
- **우선순위**: Low

## 구현 순서

| Phase | FR | 작업 | 파일 |
|-------|-----|------|------|
| 1 | FR-01 | 센서 표시 필드 정의 + Sensors.vue 필터링 | Sensors.vue, automation-helpers.ts |
| 2 | FR-01 | 자동화 조건 필드 필터링 | StepConditionBuilder.vue |
| 3 | FR-02 | 대시보드 격자/API 제거 + 날씨 크기 확대 | Dashboard.vue |
| 4 | FR-03 | 다크모드 background: white 전체 교체 | 4+ 파일 |
| 5 | FR-04 | 자동화 카드 border-left 제거 | Automation.vue |
