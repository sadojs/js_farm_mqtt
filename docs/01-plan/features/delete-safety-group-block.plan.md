# Plan: 그룹 포함 장비 삭제 차단 (delete-safety-group-block)

## 메타

| 항목 | 내용 |
|------|------|
| Feature | delete-safety-group-block |
| Phase | Plan |
| 작성일 | 2026-03-02 |
| 우선순위 | High (UX 안전 — 의존성 미안내) |
| 관련 Feature | delete-dependency-safety (기존 구현 위에 추가) |

---

## 발견된 버그 (스크린샷 확인)

### Bug 1 — 그룹 포함 장비 삭제 시 "장비 삭제에 실패했습니다." 팝업 표시

#### 현상
- "석문리 연동 센서"는 "연동 하우스" 그룹에 할당됨
- "삭제" 버튼 클릭 → "장비 삭제에 실패했습니다." 팝업
- 기대값: "연동 하우스 그룹에 포함되어 있어 삭제할 수 없습니다. 먼저 제거해 주세요." 차단 모달

#### 원인 (코드 직접 확인)

```
Backend getDependencies() — devices.service.ts:190:
  const canDelete = automationRules.length === 0
                    && pairedDeviceAutomationRules.length === 0
                    ← groups.length는 체크 안 함!

결과: 그룹에 포함된 장비도 canDelete = true 반환

Frontend handleRemoveDevice() — Devices.vue:447:
  if (!deps.canDelete) → 차단모달  ← groups만 있으면 통과
  else if (deps.groups.length > 0) → confirm dialog (노트만)
  else → 기본 confirm
  → 사용자가 confirm 누르면 deviceStore.removeDevice(id) 호출
  → 근데 production 서버에 SQL 버그 있을 수 있음 → 500 에러 → catch → alert
```

### Bug 2 — DeleteBlockingModal 그룹 전용 케이스 미지원

```
현재 DeleteBlockingModal:
  - "다음 자동화 룰에서 사용 중입니다:" 하드코딩 텍스트
  - rules.length === 0 인데 groups.length > 0 이면:
    → 빈 리스트 + 엉뚱한 안내 문구 표시
  - 버튼: "자동화 관리로 이동" (그룹 케이스에서는 무의미)
```

---

## 기대 동작

```
삭제 버튼 클릭
    ↓
getDependencies() 호출
    ↓
┌──────────────────────────────────────────────────┐
│ 자동화 룰 있음          그룹 포함 (룰 없음)       │
│      ↓                         ↓                 │
│ 차단 모달 표시          차단 모달 표시             │
│ "자동화 룰에서 사용 중"  "그룹에 포함되어 있음"   │
│ [자동화 관리로 이동]     [그룹 관리로 이동]       │
│                                                   │
│ 자동화 룰 + 그룹 모두 있음:                       │
│ 차단 모달 — 두 섹션 모두 표시                    │
│ [자동화 관리로 이동] 우선                        │
│                                                   │
│ 의존성 없음:                                     │
│ confirm → 삭제                                   │
└──────────────────────────────────────────────────┘
```

---

## 기능 요구사항

### FR-01: Backend — getDependencies() canDelete 로직 수정

파일: `backend/src/modules/devices/devices.service.ts`

```typescript
// AS-IS (line 190)
const canDelete = automationRules.length === 0
                  && pairedDeviceAutomationRules.length === 0

// TO-BE
const canDelete = automationRules.length === 0
                  && pairedDeviceAutomationRules.length === 0
                  && groups.length === 0
```

**효과:** 그룹에 포함된 장비 → `canDelete = false` → 프론트에서 차단 모달 표시

### FR-02: Frontend — DeleteBlockingModal.vue 케이스별 동적 메시지

파일: `frontend/src/components/common/DeleteBlockingModal.vue`

**3가지 케이스 지원:**

| 케이스 | 설명 | 주요 안내 | 주 버튼 |
|--------|------|----------|---------|
| 자동화 룰만 | rules > 0, groups = 0 | "자동화 룰에서 사용 중" | 자동화 관리로 이동 |
| 그룹만 | rules = 0, groups > 0 | "그룹에 포함되어 있음" | 그룹 관리로 이동 |
| 둘 다 | rules > 0, groups > 0 | 두 섹션 모두 | 자동화 관리로 이동 |

**UI (그룹만 있는 경우):**
```
┌────────────────────────────────────────────┐
│ ⚠️  삭제할 수 없습니다                      │
│                                            │
│ "석문리 연동 센서"은(는) 다음 그룹에        │
│ 포함되어 있습니다:                         │
│                                            │
│   • 연동 하우스                            │
│                                            │
│ 먼저 그룹에서 장비를 제거한 후             │
│ 다시 시도해 주세요.                        │
│                                            │
│          [그룹 관리로 이동]   [닫기]       │
└────────────────────────────────────────────┘
```

### FR-03: Frontend — Devices.vue handleRemoveDevice 단순화

현재 `canDelete = true + groups 있음 → confirm dialog + note` 로직은
FR-01 적용 후 `canDelete = false + 차단모달`로 자동 처리되므로,
그룹 관련 confirm note 코드는 제거 가능 (선택적 — 단순화 목적)

---

## 수정 대상 파일

| 파일 | 변경 유형 | 내용 |
|------|-----------|------|
| `backend/.../devices.service.ts` | 수정 | `canDelete`에 `groups.length === 0` 조건 추가 |
| `frontend/.../DeleteBlockingModal.vue` | 수정 | 그룹 전용 케이스 동적 메시지/버튼 지원 |
| `frontend/.../Devices.vue` | 수정 (minor) | 그룹 note 포함 confirm 로직 제거 (단순화) |

---

## 성공 기준

1. 그룹에 포함된 장비 삭제 클릭 → 차단 모달 표시 ("그룹에 포함" 안내 + "그룹 관리로 이동" 버튼)
2. 자동화 룰에서 사용 중인 장비 → 기존과 동일 (자동화 차단 모달)
3. 의존성 없는 장비 → 기존과 동일 (confirm → 삭제)
4. 차단 모달에서 "그룹 관리로 이동" 클릭 시 `/groups` 페이지로 이동
5. vue-tsc + vite build 에러 없음
