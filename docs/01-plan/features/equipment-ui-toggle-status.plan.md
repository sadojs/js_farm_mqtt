# Plan: 장비 관리 UI 개선 - 토글 변환 및 관수 상태 모달

## Feature ID
`equipment-ui-toggle-status`

## Date
2026-02-22

## Summary
장비 관리 페이지(Devices.vue)와 그룹 관리 페이지(Groups.vue)의 개폐기/관수 장비 UI를 개선한다.
ON/OFF 버튼을 토글 스위치로 통일하고, 개폐기에 "장비" 뱃지를 추가하며,
관수 장비에 전체 스위치 상태를 확인할 수 있는 상태 모달을 제공한다.

---

## Requirements (FR)

### FR-01: 개폐기 ON/OFF 버튼 → 토글 스위치 변경
- **현재 상태**: Devices.vue의 개폐기 그룹에서 `opener-btn` 클래스의 텍스트 버튼(ON/OFF)을 사용
- **변경 요구**: 일반 장비(filteredDevices)와 동일한 `toggle-switch` 컴포넌트로 변경
- **대상 파일**: `frontend/src/views/Devices.vue` (Lines 60-84)
- **동작**: 토글 클릭 시 기존 `interlockControl()` 함수 그대로 호출 (인터록 로직 유지)
- **참고**: Groups.vue의 개폐기는 이미 토글 스위치 사용 중 (Lines 81-94) → 변경 불필요

### FR-02: 개폐기에 "장비" 뱃지(badge) 추가
- **현재 상태**: Devices.vue의 개폐기 그룹 헤더에 타입 뱃지가 없음 (opener-header에 title과 삭제 버튼만 존재)
- **변경 요구**: 관수 장비와 동일하게 `<span class="type-badge actuator">장비</span>` 추가
- **대상 파일**: `frontend/src/views/Devices.vue` (Lines 56-59)
- **위치**: 개폐기 제목(opener-title) 오른쪽, 삭제 버튼 왼쪽

### FR-03: 관수 ON/OFF 버튼 → 토글 스위치 변경
- **현재 상태**: Devices.vue의 관수 장비에서 `opener-btn` 클래스의 텍스트 버튼(ON/OFF)을 사용
- **변경 요구**: 일반 장비와 동일한 `toggle-switch` 컴포넌트로 변경
- **대상 파일**: `frontend/src/views/Devices.vue` (Lines 97-121)
- **동작**: 토글 클릭 시 기존 `handleIrrigationControl()` 함수 그대로 호출

### FR-04: 관수 장비 상태 모달 (장비 관리 페이지)
- **변경 요구**: 관수 장비의 irrigation-header에 "장비" 뱃지 왼쪽에 "상태" 버튼 추가
- **대상 파일**: `frontend/src/views/Devices.vue`
- **버튼 디자인**: 기존 프로젝트 버튼 스타일(btn-outline 계열) 사용, "상태" 텍스트
- **모달 내용**: 아래 8개 스위치의 현재 ON/OFF 상태를 읽기 전용으로 표시
  - `switch_1`: 타이머 전원/B접점
  - `switch_2`: 1구역 관수
  - `switch_3`: 2구역 관수
  - `switch_4`: 3구역 관수
  - `switch_5`: 4구역 관수
  - `switch_6`: 5구역 관수
  - `switch_usb1`: 교반기 모터/B접점
  - `switch_usb2`: 액비모터
- **UI 구성**: 리스트 형태로 스위치 이름 + ON/OFF 상태 표시 (설정 불가, 읽기 전용)
- **데이터 소스**: `device.switchStates` (Record<string, boolean>)에서 읽어옴

### FR-05: 관수 장비 상태 모달 (그룹 관리 페이지)
- **변경 요구**: Groups.vue의 관수 카드 상단(sub-card-top)에 "상태" 버튼 추가
- **대상 파일**: `frontend/src/views/Groups.vue` (Lines 97-117)
- **위치**: sub-card-top 내 상단에 상태 버튼 배치
- **모달**: FR-04와 동일한 8개 스위치 상태 표시 모달
- **데이터 소스**: device store에서 최신 switchStates 참조

---

## Data Structure

### 관수 스위치 매핑 (공통 상수)
```typescript
const IRRIGATION_SWITCH_LABELS: Record<string, string> = {
  switch_1: '타이머 전원/B접점',
  switch_2: '1구역 관수',
  switch_3: '2구역 관수',
  switch_4: '3구역 관수',
  switch_5: '4구역 관수',
  switch_6: '5구역 관수',
  switch_usb1: '교반기 모터/B접점',
  switch_usb2: '액비모터',
}
```

### 기존 데이터 활용
- `Device.switchStates`: `Record<string, boolean>` - 이미 관수 장비의 개별 스위치 상태 저장
- `device.store.ts` `fetchDeviceStatus()`: Lines 65-73에서 이미 `switch_*`, `switch_usb*` 코드를 파싱하여 switchStates에 저장
- 추가 API 호출 불필요 - 기존 store 데이터 사용

---

## Impact Analysis

### 수정 대상 파일
| File | Changes |
|------|---------|
| `frontend/src/views/Devices.vue` | FR-01, FR-02, FR-03, FR-04: 개폐기 토글 변환, 뱃지 추가, 관수 토글 변환, 상태 모달 |
| `frontend/src/views/Groups.vue` | FR-05: 관수 카드에 상태 버튼 및 모달 추가 |

### 신규 생성 파일
- 없음 (모달은 각 뷰 파일 내 인라인으로 구현, Groups.vue에 이미 인라인 모달 패턴 존재)

### 영향 없는 파일
- `device.store.ts`: 변경 없음 (기존 switchStates 데이터 활용)
- `device.types.ts`: 변경 없음 (switchStates?: Record<string, boolean> 이미 존재)
- Backend: 변경 없음 (프론트엔드 UI 변경만)

---

## Implementation Order

### Phase 1: 개폐기 UI 개선 (FR-01, FR-02)
1. Devices.vue 개폐기 헤더에 "장비" 뱃지 추가
2. 개폐기 ON/OFF 버튼(opener-btn)을 toggle-switch로 교체
3. 인터록 제어 함수 연결 확인

### Phase 2: 관수 토글 변환 (FR-03)
1. Devices.vue 관수 ON/OFF 버튼(opener-btn)을 toggle-switch로 교체
2. handleIrrigationControl 함수 연결 확인

### Phase 3: 관수 상태 모달 (FR-04, FR-05)
1. IRRIGATION_SWITCH_LABELS 상수 정의 (Devices.vue)
2. Devices.vue에 상태 모달 UI 및 관련 상태(ref) 추가
3. irrigation-header에 "상태" 버튼 추가
4. Groups.vue에 동일한 상수 및 상태 모달 추가
5. Groups.vue 관수 카드 상단에 "상태" 버튼 추가

### Phase 4: 빌드 검증
1. Vite 빌드 통과 확인
2. 개폐기/관수 토글 동작 확인
3. 모달 열기/닫기 동작 확인

---

## Acceptance Criteria
- [ ] 개폐기 ON/OFF 버튼이 토글 스위치로 변경됨
- [ ] 개폐기 카드에 "장비" 뱃지가 표시됨
- [ ] 관수 ON/OFF 버튼이 토글 스위치로 변경됨
- [ ] 관수 "상태" 버튼 클릭 시 모달이 열림
- [ ] 모달에 8개 스위치 상태가 읽기 전용으로 표시됨
- [ ] 그룹 관리의 관수 카드에도 "상태" 버튼이 존재하며 동일한 모달이 열림
- [ ] Vite 빌드 통과
