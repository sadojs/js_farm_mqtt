# Design: 삭제 시 의존성 안전 처리 (delete-dependency-safety)

## 메타

| 항목 | 내용 |
|------|------|
| Feature | delete-dependency-safety |
| Phase | Design |
| 작성일 | 2026-03-01 |
| Plan 참조 | `docs/01-plan/features/delete-dependency-safety.plan.md` |

---

## 아키텍처 개요

### 핵심 원칙

1. **삭제 차단 우선**: 의존성 있는 장비/그룹은 API 레벨에서 차단 (409 Conflict)
2. **개폐기 원자적 쌍 삭제**: opener_open/opener_close는 항상 한 쌍으로 삭제 (개별 삭제 불가)
3. **의존성 안내**: 어디서 사용 중인지 목록 제공 → 사용자가 직접 해결 후 재시도

### 삭제 진입점 정리

| 대상 | 진입점 | 특수 처리 |
|------|--------|-----------|
| 일반 장비 | `DELETE /devices/:id` | 의존성 체크 후 차단 |
| 개폐기 페어 | `DELETE /devices/:id/opener-pair` | 쌍 전체 의존성 체크 후 원자적 삭제 |
| 그룹 | `DELETE /groups/:id` | 의존성 체크 후 차단 |

---

## 백엔드 상세 설계

### 1. 장비 의존성 조회 API

```
GET /devices/:id/dependencies
```

**응답 스키마:**
```typescript
interface DeviceDependenciesResponse {
  canDelete: boolean
  isOpenerPair: boolean                    // 개폐기 페어 여부
  pairedDevice?: {                         // 페어 파트너 정보
    id: string
    name: string
    equipmentType: 'opener_open' | 'opener_close'
  }
  automationRules: {
    id: string
    name: string
    enabled: boolean
  }[]
  // 개폐기인 경우 파트너 장비의 automation dependency도 포함
  pairedDeviceAutomationRules?: {
    id: string
    name: string
    enabled: boolean
  }[]
}
```

**응답 예시 - 일반 장비 (의존성 있음):**
```json
{
  "canDelete": false,
  "isOpenerPair": false,
  "pairedDevice": null,
  "automationRules": [
    { "id": "uuid", "name": "온도 기반 환풍 자동화", "enabled": true },
    { "id": "uuid", "name": "야간 환풍 자동화", "enabled": false }
  ]
}
```

**응답 예시 - 개폐기 장비 (파트너 포함, 의존성 없음):**
```json
{
  "canDelete": true,
  "isOpenerPair": true,
  "pairedDevice": {
    "id": "uuid-close",
    "name": "1동 천창 (닫힘)",
    "equipmentType": "opener_close"
  },
  "automationRules": [],
  "pairedDeviceAutomationRules": []
}
```

**응답 예시 - 개폐기 장비 (파트너 중 하나에 의존성 있음):**
```json
{
  "canDelete": false,
  "isOpenerPair": true,
  "pairedDevice": {
    "id": "uuid-close",
    "name": "1동 천창 (닫힘)",
    "equipmentType": "opener_close"
  },
  "automationRules": [],
  "pairedDeviceAutomationRules": [
    { "id": "uuid", "name": "천창 제어 자동화", "enabled": true }
  ]
}
```

**JSONB 검색 쿼리 (automation_rules.actions 내 deviceId 탐색):**
```sql
SELECT id, name, enabled FROM automation_rules
WHERE user_id = $1
AND (
  -- 직접 장비 ID 참조 (targetDeviceId)
  EXISTS (
    SELECT 1 FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(actions) = 'array'
           THEN actions
           ELSE jsonb_build_array(actions)
      END
    ) AS action
    WHERE action->>'targetDeviceId' = $2
       OR action->'targetDeviceIds' ? $2
  )
)
```

**서비스 구현 로직 (`devices.service.ts:getDependencies`):**
```typescript
async getDependencies(id: string, userId: string): Promise<DeviceDependenciesResponse> {
  const device = await this.devicesRepo.findOne({ where: { id, userId } })
  if (!device) throw new NotFoundException()

  const isOpener = device.equipmentType === 'opener_open'
                || device.equipmentType === 'opener_close'
  const isOpenerPair = isOpener && !!device.pairedDeviceId

  // 자동화 룰 의존성 조회 (현재 장비)
  const automationRules = await this.rulesRepo.query(DEVICE_DEPENDENCY_SQL, [userId, id])

  // 개폐기인 경우 파트너 장비의 의존성도 조회
  let pairedDevice = null
  let pairedDeviceAutomationRules = []
  if (isOpenerPair) {
    pairedDevice = await this.devicesRepo.findOne({ where: { id: device.pairedDeviceId } })
    if (pairedDevice) {
      pairedDeviceAutomationRules = await this.rulesRepo.query(
        DEVICE_DEPENDENCY_SQL, [userId, device.pairedDeviceId]
      )
    }
  }

  const allRules = [...automationRules, ...pairedDeviceAutomationRules]
  const canDelete = allRules.length === 0

  return {
    canDelete,
    isOpenerPair,
    pairedDevice: pairedDevice ? {
      id: pairedDevice.id,
      name: pairedDevice.name,
      equipmentType: pairedDevice.equipmentType,
    } : null,
    automationRules,
    pairedDeviceAutomationRules: isOpenerPair ? pairedDeviceAutomationRules : undefined,
  }
}
```

---

### 2. 개폐기 페어 원자적 삭제 API (신규)

```
DELETE /devices/:id/opener-pair
```

**처리 흐름:**
```
1. device 조회 (userId 검증)
2. isOpener 확인 → 아니면 400 BadRequest
3. pairedDeviceId 조회
4. 두 장비 모두 automation 의존성 체크 → 있으면 409 Conflict
5. 트랜잭션:
   a. DELETE FROM group_devices WHERE device_id IN (id, pairedId)
   b. DELETE FROM devices WHERE id IN (id, pairedId)
6. { message: '개폐기 페어가 삭제되었습니다.', deletedIds: [id, pairedId] } 반환
```

**에러 응답 - 의존성 있을 때 (409):**
```json
{
  "statusCode": 409,
  "message": "자동화 룰에서 사용 중인 장비는 삭제할 수 없습니다.",
  "dependencies": {
    "automationRules": [
      { "id": "uuid", "name": "천창 제어 자동화", "enabled": true }
    ]
  }
}
```

**서비스 구현 로직 (`devices.service.ts:removeOpenerPair`):**
```typescript
async removeOpenerPair(id: string, userId: string) {
  const device = await this.devicesRepo.findOne({ where: { id, userId } })
  if (!device) throw new NotFoundException()

  const isOpener = device.equipmentType === 'opener_open'
                || device.equipmentType === 'opener_close'
  if (!isOpener) throw new BadRequestException('개폐기 장비가 아닙니다.')

  const pairedDevice = device.pairedDeviceId
    ? await this.devicesRepo.findOne({ where: { id: device.pairedDeviceId } })
    : null

  // 두 장비 모두 의존성 검사
  const ids = [id, pairedDevice?.id].filter(Boolean)
  const rules = await this.findAutomationRulesForDevices(userId, ids)
  if (rules.length > 0) {
    throw new ConflictException({
      message: '자동화 룰에서 사용 중인 장비는 삭제할 수 없습니다.',
      dependencies: { automationRules: rules },
    })
  }

  // 원자적 삭제
  await this.devicesRepo.query(
    'DELETE FROM group_devices WHERE device_id = ANY($1)',
    [ids]
  )
  await this.devicesRepo.delete({ id: In(ids) })

  return { message: '개폐기 페어가 삭제되었습니다.', deletedIds: ids }
}
```

---

### 3. 일반 장비 삭제 API 수정

```
DELETE /devices/:id
```

**수정 내용 (`devices.service.ts:remove`):**
- 개폐기 장비(`opener_open`/`opener_close`)로 DELETE 요청 시 → 400 BadRequest 반환
- 일반 장비: 자동화 의존성 체크 → 있으면 409 Conflict
- 통과 시 기존 로직 실행

```typescript
async remove(id: string, userId: string) {
  const device = await this.devicesRepo.findOne({ where: { id, userId } })
  if (!device) throw new NotFoundException()

  // 개폐기는 개별 삭제 불가 — opener-pair 엔드포인트 사용 안내
  if (device.equipmentType === 'opener_open' || device.equipmentType === 'opener_close') {
    throw new BadRequestException(
      '개폐기 장비는 DELETE /devices/:id/opener-pair 를 통해 쌍으로 삭제해야 합니다.'
    )
  }

  // 자동화 의존성 체크
  const rules = await this.findAutomationRulesForDevice(userId, id)
  if (rules.length > 0) {
    throw new ConflictException({
      message: '자동화 룰에서 사용 중인 장비는 삭제할 수 없습니다.',
      dependencies: { automationRules: rules },
    })
  }

  await this.devicesRepo.query('DELETE FROM group_devices WHERE device_id = $1', [id])
  await this.devicesRepo.remove(device)
  return { message: '삭제되었습니다.' }
}
```

---

### 4. 그룹 의존성 조회 API

```
GET /groups/:id/dependencies
```

**응답 스키마:**
```typescript
interface GroupDependenciesResponse {
  canDelete: boolean
  automationRules: {
    id: string
    name: string
    enabled: boolean
  }[]
}
```

**쿼리:** `SELECT id, name, enabled FROM automation_rules WHERE group_id = $1 AND user_id = $2`

**서비스 구현 (`groups.service.ts:getDependencies`):**
```typescript
async getDependencies(id: string, userId: string): Promise<GroupDependenciesResponse> {
  const group = await this.groupsRepo.findOne({ where: { id, userId } })
  if (!group) throw new NotFoundException()

  const automationRules = await this.rulesRepo.find({
    where: { groupId: id, userId },
    select: ['id', 'name', 'enabled'],
  })

  return {
    canDelete: automationRules.length === 0,
    automationRules: automationRules.map(r => ({
      id: r.id,
      name: r.name,
      enabled: r.enabled,
    })),
  }
}
```

---

### 5. 그룹 삭제 API 수정

```
DELETE /groups/:id
```

**수정 내용 (`groups.service.ts:removeGroup`):**
```typescript
async removeGroup(id: string, userId: string) {
  const group = await this.groupsRepo.findOne({ where: { id, userId } })
  if (!group) throw new NotFoundException()

  // 자동화 의존성 체크
  const rules = await this.rulesRepo.find({
    where: { groupId: id, userId },
    select: ['id', 'name', 'enabled'],
  })
  if (rules.length > 0) {
    throw new ConflictException({
      message: '자동화 룰에서 사용 중인 그룹은 삭제할 수 없습니다.',
      dependencies: { automationRules: rules },
    })
  }

  await this.groupsRepo.remove(group)
  return { message: '삭제되었습니다.' }
}
```

---

### 6. 순환 의존성 해결 방안

**문제:** `DevicesModule` ↔ `AutomationModule` 상호 참조 위험

**채택 방안: AutomationRule Repository 직접 주입**

- `DevicesModule`에서 `TypeOrmModule.forFeature([AutomationRule])` 추가
- `AutomationModule`을 import하지 않고 Repository만 직접 사용
- `GroupsModule`도 동일 패턴 적용

```typescript
// devices.module.ts
TypeOrmModule.forFeature([Device, TuyaProject, AutomationRule])

// groups.module.ts
TypeOrmModule.forFeature([HouseGroup, House, Device, AutomationRule])
```

---

## 프론트엔드 상세 설계

### 1. API 함수 추가

**`device.api.ts` 추가:**
```typescript
getDependencies: (id: string) =>
  apiClient.get<DeviceDependenciesResponse>(`/devices/${id}/dependencies`),

removeOpenerPair: (id: string) =>
  apiClient.delete(`/devices/${id}/opener-pair`),
```

**`group.api.ts` 추가:**
```typescript
getDependencies: (id: string) =>
  apiClient.get<GroupDependenciesResponse>(`/groups/${id}/dependencies`),
```

---

### 2. 타입 정의 추가

**`device.types.ts` 추가:**
```typescript
export interface DeviceDependencyRule {
  id: string
  name: string
  enabled: boolean
}

export interface DeviceDependenciesResponse {
  canDelete: boolean
  isOpenerPair: boolean
  pairedDevice?: {
    id: string
    name: string
    equipmentType: string
  }
  automationRules: DeviceDependencyRule[]
  pairedDeviceAutomationRules?: DeviceDependencyRule[]
}
```

**`group.types.ts` 추가:**
```typescript
export interface GroupDependenciesResponse {
  canDelete: boolean
  automationRules: { id: string; name: string; enabled: boolean }[]
}
```

---

### 3. `Devices.vue` 수정 - handleRemoveDevice

**현재:**
```typescript
const handleRemoveDevice = async (id: string) => {
  const ok = await confirm({ ... })
  if (!ok) return
  await deviceStore.removeDevice(id)
}
```

**변경 후 흐름:**
```
1. GET /devices/:id/dependencies 호출
2. isOpenerPair === true → handleRemoveOpenerGroup 리다이렉트 (실제로는 호출 자체가 없어야 함)
3. canDelete === false → 차단 모달 표시 (automationRules 목록)
4. canDelete === true → 기존 confirm 다이얼로그 → deleteDevice
```

```typescript
const handleRemoveDevice = async (id: string) => {
  // 의존성 조회
  const { data: deps } = await deviceApi.getDependencies(id)

  // 개폐기 페어는 이 함수로 진입하지 않아야 함 (UI에서 분리)
  // 안전망: 만약 진입했다면 opener-pair 흐름으로 전환
  if (deps.isOpenerPair) {
    // handleRemoveOpenerGroup과 동일한 confirm + removeOpenerPair 호출
    return handleRemoveOpenerPairById(id, deps)
  }

  if (!deps.canDelete) {
    // 차단 모달 표시
    blockingModal.value = {
      show: true,
      type: 'device',
      targetName: /* 장비명 */,
      rules: deps.automationRules,
    }
    return
  }

  // 의존성 없음 → 기존 confirm
  const ok = await confirm({
    title: '장비 삭제',
    message: '이 장비를 삭제하시겠습니까?',
    confirmText: '삭제',
    variant: 'danger',
  })
  if (!ok) return
  await deviceStore.removeDevice(id)
}
```

---

### 4. `Devices.vue` 수정 - handleRemoveOpenerGroup

**현재 (두 번 API 호출, 개별 삭제):**
```typescript
const handleRemoveOpenerGroup = async (group: OpenerGroup) => {
  // ...
  await deviceStore.removeDevice(group.openDevice.id)
  await deviceStore.removeDevice(group.closeDevice.id)
}
```

**변경 후:**
```
1. GET /devices/:openDevice.id/dependencies 호출
2. canDelete === false → 차단 모달 표시
   (automationRules + pairedDeviceAutomationRules 모두 합쳐서 표시)
3. canDelete === true → confirm 다이얼로그 표시
   (파트너 장비도 함께 삭제됨을 안내)
4. DELETE /devices/:id/opener-pair 단일 호출 (원자적)
```

```typescript
const handleRemoveOpenerGroup = async (group: OpenerGroup) => {
  // 의존성 조회 (open 장비 기준 — 응답에 paired 의존성도 포함됨)
  const { data: deps } = await deviceApi.getDependencies(group.openDevice.id)

  if (!deps.canDelete) {
    // 두 장비의 의존성을 합쳐서 모달 표시
    const allRules = [
      ...deps.automationRules,
      ...(deps.pairedDeviceAutomationRules ?? []),
    ]
    blockingModal.value = {
      show: true,
      type: 'opener-pair',
      targetName: group.groupName,
      rules: allRules,
    }
    return
  }

  const ok = await confirm({
    title: '개폐기 삭제',
    message: `"${group.groupName}" 개폐기(열림/닫힘)를 모두 삭제하시겠습니까?`,
    confirmText: '삭제',
    variant: 'danger',
  })
  if (!ok) return

  // 단일 API 호출로 원자적 삭제
  await deviceApi.removeOpenerPair(group.openDevice.id)
  await deviceStore.fetchDevices()  // 스토어 갱신
}
```

---

### 5. `Groups.vue` 수정 - deleteGroup

**변경 후 흐름:**
```
1. GET /groups/:id/dependencies 호출
2. canDelete === false → 차단 모달 표시 (automationRules 목록)
3. canDelete === true → 기존 confirm 다이얼로그 → removeGroup
```

```typescript
const deleteGroup = async (id: string, name: string) => {
  const { data: deps } = await groupApi.getDependencies(id)

  if (!deps.canDelete) {
    blockingModal.value = {
      show: true,
      type: 'group',
      targetName: name,
      rules: deps.automationRules,
    }
    return
  }

  const ok = await confirm({
    title: '그룹 삭제',
    message: `"${name}" 그룹을 삭제하시겠습니까?`,
    confirmText: '삭제',
    variant: 'danger',
  })
  if (!ok) return
  await groupStore.removeGroup(id)
}
```

---

### 6. 차단 모달 컴포넌트 설계

**신규 컴포넌트: `DeleteBlockingModal.vue`**

```typescript
// Props
interface Props {
  show: boolean
  type: 'device' | 'opener-pair' | 'group'
  targetName: string
  rules: { id: string; name: string; enabled: boolean }[]
}

// Emits
defineEmits<{
  close: []
  navigate: []  // 자동화 관리 페이지로 이동
}>()
```

**UI 구조:**
```
┌────────────────────────────────────────────┐
│ ⚠️  삭제할 수 없습니다                      │
│                                            │
│ [targetName]은(는) 다음 자동화 룰에서       │
│ 사용 중입니다:                             │
│                                            │
│   • [ruleName]         [활성 | 비활성]     │
│   • [ruleName]         [활성 | 비활성]     │
│   ...                                      │
│                                            │
│ 위 자동화 룰에서 먼저 제거한 후             │
│ 다시 시도해 주세요.                         │
│                                            │
│     [자동화 관리로 이동]        [닫기]     │
└────────────────────────────────────────────┘
```

**개폐기 페어 전용 안내 문구:**
- `type === 'opener-pair'`인 경우: "열림/닫힘 장비 중 하나 이상이 자동화 룰에서 사용 중입니다"

**라우터 이동:**
```typescript
const navigate = () => {
  emit('close')
  router.push('/automation')
}
```

---

### 7. 차단 모달 상태 관리 (Devices.vue, Groups.vue 공통 패턴)

```typescript
// 차단 모달 상태
const blockingModal = ref<{
  show: boolean
  type: 'device' | 'opener-pair' | 'group'
  targetName: string
  rules: { id: string; name: string; enabled: boolean }[]
}>({
  show: false,
  type: 'device',
  targetName: '',
  rules: [],
})

const closeBlockingModal = () => {
  blockingModal.value.show = false
}
```

---

## 수정 대상 파일 요약

### 백엔드

| 파일 | 변경 유형 | 주요 내용 |
|------|-----------|-----------|
| `devices/devices.service.ts` | 수정 | `getDependencies()`, `removeOpenerPair()` 추가; `remove()` 수정 (개폐기 차단 + 의존성 체크) |
| `devices/devices.controller.ts` | 수정 | `GET /devices/:id/dependencies`, `DELETE /devices/:id/opener-pair` 엔드포인트 추가 |
| `devices/devices.module.ts` | 수정 | `AutomationRule` 엔티티 Repository 추가 |
| `groups/groups.service.ts` | 수정 | `getDependencies()` 추가; `removeGroup()` 수정 (의존성 체크) |
| `groups/groups.controller.ts` | 수정 | `GET /groups/:id/dependencies` 엔드포인트 추가 |
| `groups/groups.module.ts` | 수정 | `AutomationRule` 엔티티 Repository 추가 |

### 프론트엔드

| 파일 | 변경 유형 | 주요 내용 |
|------|-----------|-----------|
| `api/device.api.ts` | 수정 | `getDependencies()`, `removeOpenerPair()` 추가 |
| `api/group.api.ts` | 수정 | `getDependencies()` 추가 |
| `types/device.types.ts` | 수정 | `DeviceDependenciesResponse` 타입 추가 |
| `types/group.types.ts` | 수정 | `GroupDependenciesResponse` 타입 추가 |
| `views/Devices.vue` | 수정 | `handleRemoveDevice()` 의존성 체크 분기; `handleRemoveOpenerGroup()` 원자적 삭제; 차단 모달 상태 |
| `views/Groups.vue` | 수정 | `deleteGroup()` 의존성 체크 분기; 차단 모달 상태 |
| `components/devices/DeleteBlockingModal.vue` | 신규 | 차단 모달 컴포넌트 |

---

## 개폐기 페어 삭제 플로우 (핵심)

```
사용자: 개폐기 그룹 삭제 버튼 클릭
    ↓
GET /devices/{openDeviceId}/dependencies
    ↓
┌────────────────────────────────────────────┐
│  canDelete === false                       │
│  (둘 중 하나라도 자동화 의존성 있음)        │
│         ↓                                 │
│  차단 모달 - 전체 룰 목록 표시             │
│  [자동화 관리로 이동]                      │
└────────────────────────────────────────────┘
    ↓ canDelete === true
confirm 다이얼로그
("1동 천창 개폐기(열림/닫힘)를 모두 삭제하시겠습니까?")
    ↓ 확인
DELETE /devices/{openDeviceId}/opener-pair   ← 단일 원자적 API 호출
    ↓
{ deletedIds: [openId, closeId] }
    ↓
deviceStore.fetchDevices()  ← UI 갱신
```

---

## 성공 기준

- 자동화 룰에서 사용 중인 장비/그룹은 차단되고 의존 룰 목록이 차단 모달에 표시됨
- 개폐기 장비 개별 `DELETE /devices/:id` 요청 시 400 응답으로 차단됨
- 개폐기 페어 삭제는 `DELETE /devices/:id/opener-pair` 단일 호출로 양쪽 모두 원자적으로 삭제됨
- 개폐기 페어 중 하나라도 자동화 의존성 있으면 전체가 차단됨
- 의존성이 없는 일반 장비/그룹은 기존과 동일하게 삭제됨
- 차단 모달의 "자동화 관리로 이동" 클릭 시 `/automation` 페이지로 이동됨
