# Plan: 삭제 시 의존성 안전 처리 (delete-dependency-safety)

## 메타

| 항목 | 내용 |
|------|------|
| Feature | delete-dependency-safety |
| Phase | Do (구현 진행 중) |
| 작성일 | 2026-03-01 |
| 업데이트 | 2026-03-01 |
| 우선순위 | High (데이터 무결성) |
| 구현 상태 | 백엔드 getDependencies + 프론트 차단모달 + Groups.vue "-" 버튼 모달 구현 완료. SQL 버그(`groups`→`house_groups`) 수정 완료 |

---

## 배경 및 현재 문제

### 현재 코드의 취약점 (코드 직접 확인 결과)

**장비 삭제 (`devices.service.ts:remove`):**
- `group_devices` 조인 테이블만 정리
- `automation_rules.actions` JSONB 안의 `targetDeviceId`, `targetDeviceIds` 정리 없음
- 개폐기 파트너 장비의 `pairedDeviceId` null 처리 없음

**그룹 삭제 (`groups.service.ts:removeGroup`):**
- 단순 `remove()` 호출
- `automation_rules.groupId`가 삭제된 그룹을 참조하는 고아 룰 발생

**자동화 runner (`automation-runner.service.ts`) 참조 방식:**
```
action.targetDeviceId   → 단일 장비 직접 지정 (string)
action.targetDeviceIds  → 다수 장비 직접 지정 (string[])
rule.groupId            → 그룹 내 모든 장비 대상
```
삭제 후에도 runner는 해당 ID로 Tuya API 호출 → 런타임 실패 (현재 묵음 에러)

---

## 전략: 삭제 차단 + 의존성 안내

### 이전 안 vs 채택 안 비교

| 방식 | 설명 | 채택 |
|------|------|:----:|
| 자동 비활성화 | 룰을 자동으로 disabled 처리 | ❌ |
| **삭제 차단 + 안내** | 의존성 표시 후 직접 해결하도록 안내 | ✅ |

**채택 이유:**
- 자동화 룰은 농장 운영의 핵심 — 사용자 모르게 변경되면 안 됨
- 사용자가 "어디서 쓰이는지" 명확히 인지하고 직접 처리해야 함
- 해결 경로를 명확히 제시하면 UX 불편 최소화 가능

---

## UX 흐름 설계

### 장비 삭제 흐름 (v2 - 그룹 정보 포함)

```
삭제 버튼 클릭
    ↓
GET /devices/:id/dependencies 호출
  → automationRules, groups 반환
    ↓
┌──────────────────────────────────────────────────────┐
│  자동화 룰 의존성 있음         자동화 룰 없음         │
│         ↓                          ↓                 │
│  차단 모달 표시              그룹 소속 있음?          │
│  (룰 + 그룹 목록 표시)        ↓          ↓           │
│  [자동화 관리로 이동]       있음        없음          │
│                               ↓          ↓           │
│                      그룹 정보 포함     기존 confirm │
│                       confirm 표시                   │
│                      ("이 그룹에서도                  │
│                        제거됩니다")                  │
│                               ↓                      │
│                           삭제 완료                  │
└──────────────────────────────────────────────────────┘
```

### 차단 모달 UI (장비 — 자동화 룰 + 그룹 정보)

```
┌────────────────────────────────────────────┐
│ ⚠️  삭제할 수 없습니다                      │
│                                            │
│ "온습도 센서 A"는 다음 자동화 룰에서        │
│ 사용 중입니다:                             │
│                                            │
│   • 온도 기반 환풍 자동화      [활성]      │
│   • 야간 환풍 자동화           [비활성]    │
│                                            │
│ 또한 다음 그룹에도 속해 있습니다:          │
│   • 1동 그룹                               │
│   • 2동 그룹                               │
│                                            │
│ 위 자동화 룰에서 이 장비를 먼저 제거하거나  │
│ 룰을 삭제한 후 장비를 삭제해 주세요.       │
│                                            │
│          [자동화 관리로 이동]   [닫기]     │
└────────────────────────────────────────────┘
```

### 차단 모달 UI (그룹)

```
┌────────────────────────────────────────────┐
│ ⚠️  삭제할 수 없습니다                      │
│                                            │
│ "1동 그룹"은 다음 자동화 룰에서            │
│ 대상 그룹으로 지정되어 있습니다:           │
│                                            │
│   • 1동 온도 제어 자동화       [활성]      │
│   • 1동 야간 관수              [활성]      │
│                                            │
│ 위 자동화 룰을 삭제하거나 다른 그룹으로    │
│ 변경한 후 그룹을 삭제해 주세요.            │
│                                            │
│          [자동화 관리로 이동]   [닫기]     │
└────────────────────────────────────────────┘
```

### 개폐기 쌍 (pairedDevice) 처리 - 별도

개폐기 파트너가 있는 경우는 의존성 차단 대상이 아님.
삭제 confirm 시 추가 안내 문구로 처리:

```
┌────────────────────────────────────────────┐
│ 장비를 삭제하시겠습니까?                    │
│                                            │
│ ℹ️  "1동 천창 (열림)"은 개폐기 쌍으로       │
│ 연결된 장비가 있습니다:                    │
│   → 1동 천창 (닫힘)                        │
│                                            │
│ 삭제 시 파트너 장비의 쌍 연결이 해제됩니다. │
│ (파트너 장비 자체는 삭제되지 않습니다)     │
│                                            │
│              [취소]    [삭제]              │
└────────────────────────────────────────────┘
```

### 그룹 장비 제거 UX (v2 — 헤더 "-" 버튼 + 모달)

개별 카드 X 버튼(너무 쉽게 오클릭) → **그룹 헤더 "-" 버튼** 방식으로 변경

```
그룹 헤더: [그룹명]   [⚙] [+] [-] [🗑] [▼]

"-" 클릭 →
┌──────────────────────────────────────────┐
│ 장비 제거 — 1동 그룹               ✕    │
├──────────────────────────────────────────┤
│ 제거할 장비를 선택하세요. 장비 자체는    │
│ 삭제되지 않으며 그룹에서만 해제됩니다.   │
│                                          │
│ [센서]                                   │
│ ☐ 🌡 온습도 센서 A          [온라인]    │
│ ☑ 🌫 CO2 센서 B             [오프라인]  │
│   ⚠ 자동화 룰 사용 중: 온도환풍, 야간관수│
│                                          │
│ [장비]                                   │
│ ☐ 🚪 천창 열림/닫힘 (개폐기) [온라인]   │
│ ☑ 💡 팬                     [온라인]    │
│                                          │
├──────────────────────────────────────────┤
│            [취소]   [1개 제거]           │
└──────────────────────────────────────────┘
```

**제거 규칙:**
- 자동화 룰 의존성이 있는 장비: 선택은 가능, 경고 표시
- 경고 있는 장비를 선택한 상태 → "제거" 버튼 비활성화
- 장비 선택 시 lazy하게 `GET /devices/:id/dependencies` 호출
- 개폐기 쌍: 대표(opener_open)으로 표시, 선택 시 쌍 모두 제거

---

## 기능 요구사항

### 백엔드

#### FR-01: 장비 의존성 조회 API (수정)
```
GET /devices/:id/dependencies
```
응답 (v2 - groups 필드 추가):
```json
{
  "canDelete": false,
  "isOpenerPair": false,
  "automationRules": [
    { "id": "uuid", "name": "온도 기반 환풍 자동화", "enabled": true }
  ],
  "pairedDevice": { "id": "uuid", "name": "1동 천창 (닫힘)", "equipmentType": "opener_close" },
  "groups": [
    { "id": "uuid", "name": "1동 그룹" },
    { "id": "uuid", "name": "2동 그룹" }
  ]
}
```

**JSONB 검색 쿼리 (PostgreSQL):**
```sql
SELECT id, name, enabled FROM automation_rules
WHERE user_id = $1
AND EXISTS (
  SELECT 1 FROM jsonb_array_elements(
    CASE WHEN jsonb_typeof(actions) = 'array'
         THEN actions
         ELSE jsonb_build_array(actions)
    END
  ) AS action
  WHERE action->>'targetDeviceId' = $2
     OR action->'targetDeviceIds' ? $2
)
```

#### FR-02: 그룹 의존성 조회 API (신규)
```
GET /groups/:id/dependencies
```
응답:
```json
{
  "canDelete": false,
  "automationRules": [
    { "id": "uuid", "name": "1동 온도 제어 자동화", "enabled": true }
  ]
}
```

**쿼리:** `automation_rules WHERE group_id = $1 AND user_id = $2`

#### FR-03: 장비 삭제 시 pairedDevice null 처리 (기존 remove 수정)
```typescript
// devices.service.ts:remove 수정
// 1. 자동화 룰 의존성은 API가 차단하므로 여기서는 pairedDevice만 처리
if (device.pairedDeviceId) {
  await this.devicesRepo.update(
    { id: device.pairedDeviceId },
    { pairedDeviceId: null }
  )
}
// 2. group_devices 정리 (기존)
await this.devicesRepo.query('DELETE FROM group_devices WHERE device_id = $1', [id])
// 3. 삭제
await this.devicesRepo.remove(device)
```

### 프론트엔드

#### FR-04: 장비 삭제 버튼 - 의존성 체크 후 분기 (Devices.vue 수정, v2)
`handleRemoveDevice` 함수:
1. `GET /devices/:id/dependencies` 호출 → `{ canDelete, automationRules, groups }`
2. `canDelete === false` (자동화 룰 의존성) → 차단 모달 표시 (룰 목록 + 그룹 목록)
3. `canDelete === true` + 그룹 소속 있음 → confirm에 그룹 정보 포함 ("X개 그룹에서도 제거됩니다")
4. `canDelete === true` + 그룹 없음 → 기존 confirm

#### FR-05: 그룹 삭제 버튼 - 의존성 체크 후 분기 (Groups.vue 수정, 기존과 동일)

#### FR-06: 차단 모달 컴포넌트 (DeleteBlockingModal.vue 수정, v2)
추가 props:
- `groups?: { id: string; name: string }[]` — 그룹 소속 목록 (informational)

그룹 목록이 있으면 "또한 다음 그룹에도 속해 있습니다:" 섹션 추가로 표시

#### FR-07: 그룹 헤더 "-" 버튼 + 제거 모달 (Groups.vue 신규, v2)
- 기존 개별 카드 X 버튼 제거 (`btn-unassign`)
- 그룹 헤더에 "-" 버튼 추가 (🗑 버튼 왼쪽)
- "-" 클릭 → 제거 모달 오픈
- 모달: 현재 그룹의 장비를 센서/장비 섹션으로 분류하여 체크박스 목록
- 장비 선택(체크) 시 lazy `GET /devices/:id/dependencies` 호출 → 자동화 룰 있으면 경고 표시
- 경고 있는 장비 선택 상태 → "제거" 버튼 비활성화 (먼저 자동화 룰 처리 필요)
- 개폐기(opener_open) 선택 시 쌍(opener_close)도 함께 제거

#### FR-08: 자동화 관리로 이동 시 컨텍스트 전달 (선택)
라우터로 자동화 페이지 이동 시 해당 룰 이름을 query로 전달해 자동 하이라이트 (optional)

---

## 범위 제외 (Out of Scope)

- 자동화 룰 내 JSONB에서 해당 deviceId만 부분 수정 (복잡도 높음)
- 삭제 전 일괄 룰 삭제 기능 (자동화 페이지에서 직접 처리)
- `disabled_reason` 컬럼 추가 (불필요 — 차단 방식이므로 자동화 룰은 변경 없음)

---

## 수정 대상 파일

### 백엔드
| 파일 | 변경 유형 | 내용 |
|------|-----------|------|
| `devices/devices.service.ts` | 수정 | `remove()`에 pairedDevice null 처리 추가, `getDependencies()` 메서드 추가 |
| `devices/devices.controller.ts` | 수정 | `GET /devices/:id/dependencies` 엔드포인트 추가 |
| `groups/groups.service.ts` | 수정 | `getDependencies()` 메서드 추가 |
| `groups/groups.controller.ts` | 수정 | `GET /groups/:id/dependencies` 엔드포인트 추가 |
| `automation/automation.module.ts` | 수정 또는 패턴 선택 | AutomationRule repo를 DevicesService, GroupsService에서 직접 사용하거나 AutomationService에 메서드 추가 후 주입 (순환 의존 주의) |

### 프론트엔드
| 파일 | 변경 유형 | 내용 |
|------|-----------|------|
| `views/Devices.vue` | 수정 | `handleRemoveDevice()` 의존성 체크 분기 추가 |
| `views/Groups.vue` | 수정 | `deleteGroup()` 의존성 체크 분기 추가 |
| `api/device.api.ts` | 추가 | `getDependencies(id)` 함수 |
| `api/group.api.ts` | 추가 | `getDependencies(id)` 함수 |

---

## 성공 기준

- 자동화 룰에서 사용 중인 장비/그룹은 삭제 시 차단되고 의존 룰 목록이 표시됨
- 의존성이 없는 장비/그룹은 기존과 동일하게 삭제 가능
- 개폐기 파트너 장비 삭제 시 파트너의 `pairedDeviceId`가 null로 초기화됨
- 차단 모달에서 "자동화 관리로 이동" 클릭 시 Automation 페이지로 이동
- 자동화 룰이 변경/삭제된 후 재시도하면 정상 삭제 가능
