# Plan: 모달 다크모드 + 자동화 룰 저장/센서 미선택 기능

## 현황 분석

### 문제 1: 모달 다크모드 미적용
- 모달 컴포넌트들에 하드코딩된 라이트 색상(#f5f5f5, #333, #888, #eee, white 등) 다수 존재
- 다크모드 전환 시 모달 내부만 밝은 색상으로 남아 가독성 심각

### 문제 2: 자동화 룰 수정 시 저장 실패
- **근본 원인**: `UpdateRuleDto`에 `groupId` 필드가 없음
- `main.ts`에 `forbidNonWhitelisted: true` 설정 → 프론트가 `groupId` 포함하여 PUT 요청 시 400 에러
- `UpdateRuleDto`에서 `groupId` 누락 + 서비스 `update()`에서 `groupId` 업데이트 로직 없음

### 문제 3: 센서 미선택 시 시간 기반 조건 불가
- `StepSensorSelect`에서 센서 1개 이상 선택 필수 (`canNext` 검증)
- 시간 기반 자동화(예: 매일 9시 환풍기 켜기)를 만들 수 없음
- `StepConditionBuilder`에 시간 필드는 이미 존재 (`hour`)

## 요구사항 (FR)

### FR-01: 모달 다크모드 적용
- **대상 파일** (10개):
  1. `components/admin/UserFormModal.vue` — 12+ 하드코딩 색상
  2. `components/admin/ProjectAssignModal.vue` — 6+ 하드코딩 색상
  3. `components/automation/StepReview.vue` — 8+ 하드코딩 색상
  4. `components/automation/StepTargetSelect.vue` — 8+ 하드코딩 색상
  5. `components/automation/StepActuatorSelect.vue` — 10+ 하드코딩 색상
  6. `components/automation/StepSensorSelect.vue` — 8+ 하드코딩 색상
  7. `components/automation/StepConditionBuilder.vue` — 6+ 하드코딩 색상
  8. `components/automation/RuleWizardModal.vue` — 2개 (color: white → 유지 가능)
  9. `components/common/ConfirmDialog.vue` — 3개 (color: white → 유지 가능)
  10. `views/Automation.vue` — 3개
- **변경**: 모든 `#xxx`, `rgb()` → CSS 변수 (`var(--text-primary)`, `var(--bg-secondary)` 등)
- **우선순위**: High

### FR-02: 자동화 룰 저장 버그 수정 (생성/수정 모두)
- **백엔드**:
  - `UpdateRuleDto`에 `groupId` 필드 추가 (`@IsOptional() @IsString()`)
  - `automation.service.ts` `update()` 메서드에 `groupId` 업데이트 로직 추가
- **프론트엔드**:
  - `RuleWizardModal.vue` `handleSave()` — 수정 시에도 `groupId` 포함 확인 (현재 OK)
  - 에러 메시지 개선: alert → 구체적 에러 표시
- **우선순위**: Critical

### FR-03: 센서 미선택 옵션 + 시간 기반 조건
- **StepSensorSelect.vue**:
  - "센서 미선택 (시간 기반)" 버튼 추가
  - 선택 시 `sensorDeviceIds = []` 로 설정하고 다음 단계 이동 허용
- **RuleWizardModal.vue**:
  - `canNext` Step 2 검증 수정: 센서 미선택도 허용 (별도 플래그 또는 빈 배열 허용)
- **StepConditionBuilder.vue**:
  - 센서 미선택 시 시간 필드만 표시 (hour 필드만 선택 가능)
  - 센서 선택 시 기존대로 모든 필드 표시
- **우선순위**: High

## 구현 순서

| Phase | FR | 작업 | 파일 |
|-------|-----|------|------|
| 1 | FR-02 | 백엔드 UpdateRuleDto + service 수정 | create-rule.dto.ts, automation.service.ts |
| 2 | FR-03 | 센서 미선택 + 시간 조건 기능 | StepSensorSelect.vue, RuleWizardModal.vue, StepConditionBuilder.vue |
| 3 | FR-01 | 모달 다크모드 (자동화 관련 6개 파일) | Step*.vue, RuleWizardModal.vue, Automation.vue |
| 4 | FR-01 | 모달 다크모드 (관리자 + 공통 3개 파일) | UserFormModal.vue, ProjectAssignModal.vue, ConfirmDialog.vue |
| 5 | ALL | 빌드 확인 | - |
