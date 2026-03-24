# Design: 장비 등록 → 그룹 설정 위저드 (device-group-wizard)

## 메타

| 항목 | 내용 |
|------|------|
| Feature | device-group-wizard |
| Phase | Design |
| 작성일 | 2026-03-01 |
| Plan 참조 | `docs/01-plan/features/device-group-wizard.plan.md` |

---

## 1. 권한 매트릭스

현재 auth.store.ts 기준 3가지 역할이 존재한다.

| 권한 | role 값 | 장비 추가 | 그룹 생성 | 기존 그룹에 장비 할당 | 위저드 Step 4 노출 |
|------|---------|:---------:|:---------:|:--------------------:|:-----------------:|
| 플랫폼 관리자 | `admin` | ✅ | ✅ | ✅ | ✅ (전체) |
| 농장 관리자 | `farm_admin` | ✅ | ✅ | ✅ | ✅ (전체) |
| 농장 유저 | `farm_user` | ❌ | ❌ | ❌ | ❌ (접근 불가) |

### 농장 유저 보호 원칙

- `farm_user`는 장비 관리 페이지에서 "+ 장비 추가" 버튼 자체가 보이지 않아야 함
- DeviceRegistration 모달 진입 자체가 차단됨 (현재 Devices.vue에 `v-if` 가드 미적용 → 이번 작업에서 추가)
- Groups.vue는 이미 `v-if="!isFarmUser"` 적용 완료 → 변경 없음

---

## 2. 위저드 Step 설계

### 전체 Step 흐름

```
[기존 Step 1] Tuya 기기 불러오기
      ↓
[기존 Step 2] 기기 선택 및 타입 설정
      ↓
[기존 Step 3] 이름 확인 및 등록 완료 (registerDevices API 호출)
      ↓
[신규 Step 4] 그룹 설정 (admin / farm_admin 전용)
   ├── "나중에" → 모달 닫기 (기존 동작 유지)
   ├── "기존 그룹에 추가" → Step 4a: 그룹 목록 선택
   └── "새 그룹 생성" → Step 4b: 그룹 생성 폼
```

### Step 4: 그룹 설정 안내 (신규)

```
┌──────────────────────────────────────────────┐
│  장비 등록이 완료되었습니다!                   │
│  등록한 장비를 그룹에 추가하시겠습니까?        │
│                                              │
│  [기존 그룹에 추가]   [새 그룹 생성]          │
│                                              │
│              [나중에]                         │
└──────────────────────────────────────────────┘
```

- 기존 그룹이 0개인 경우: "기존 그룹에 추가" 버튼 disabled + "그룹이 없습니다" 안내 텍스트
- "나중에" 클릭 시: 기존과 동일하게 모달 닫힘

### Step 4a: 기존 그룹 선택 (신규)

```
┌──────────────────────────────────────────────┐
│  ← 이전    그룹 선택                          │
│  ─────────────────────────────────────────── │
│  ○ 1동 (장비 5개)                            │
│  ○ 2동 (장비 3개)                            │
│  ○ 관수 구역 A (장비 2개)                    │
│  ─────────────────────────────────────────── │
│              [선택 완료]                      │
└──────────────────────────────────────────────┘
```

- 라디오 버튼 형태로 단일 선택
- 그룹명 + 현재 장비 수 표시
- 선택 후 "선택 완료" 클릭 → `groupStore.assignDevices(groupId, registeredDeviceIds)` 호출
- 완료 후 성공 토스트 표시 + 모달 닫기

### Step 4b: 새 그룹 생성 (신규)

```
┌──────────────────────────────────────────────┐
│  ← 이전    새 그룹 생성                       │
│  ─────────────────────────────────────────── │
│  그룹 이름 *                                 │
│  ┌──────────────────────────────────────┐   │
│  │ 예: 1동, 관수 구역 A                  │   │
│  └──────────────────────────────────────┘   │
│                                              │
│  설명 (선택)                                 │
│  ┌──────────────────────────────────────┐   │
│  │                                       │   │
│  └──────────────────────────────────────┘   │
│  ─────────────────────────────────────────── │
│              [그룹 생성 및 장비 추가]          │
└──────────────────────────────────────────────┘
```

- 그룹명 필수, 설명 선택
- "그룹 생성 및 장비 추가" 클릭 →
  1. `groupStore.createGroup({ name, description })` 호출
  2. 반환된 groupId로 `groupStore.assignDevices(groupId, registeredDeviceIds)` 호출
- 완료 후 성공 토스트 표시 + 모달 닫기

---

## 3. 컴포넌트 변경 설계

### 3-1. DeviceRegistration.vue (주요 변경)

**Step 번호 체계 변경:**

| Step | 내용 | 변경 여부 |
|------|------|-----------|
| 1 | Tuya 기기 불러오기 | 변경 없음 |
| 2 | 기기 선택 | 변경 없음 |
| 3 | 이름 확인 + 등록 | 버튼 텍스트만 변경: "등록 완료" → "등록 후 그룹 설정" (admin/farm_admin) / "등록 완료" (그 외 - 해당 없음) |
| 4 | 그룹 설정 안내 | **신규** |
| 4a | 기존 그룹 선택 | **신규** (substep) |
| 4b | 새 그룹 생성 | **신규** (substep) |

**추가 state:**

```typescript
// 그룹 위저드 관련
const wizardSubStep = ref<'ask' | 'existing' | 'create'>('ask')
const registeredDeviceIds = ref<string[]>([])  // 등록 완료된 장비 ID 목록
const selectedGroupId = ref<string | null>(null)
const newGroupName = ref('')
const newGroupDesc = ref('')
const groupAssigning = ref(false)

// import 추가
const groupStore = useGroupStore()
const authStore = useAuthStore()  // 이미 있음

// 권한 computed
const canManageGroups = computed(() => authStore.isAdmin || authStore.isFarmAdmin)
```

**registerDevices 함수 변경:**

```typescript
// 기존: 등록 후 emit('registered') + closeModal()
// 변경: 등록 후 admin/farm_admin이면 step 4로 이동, 아니면 기존 동작

const registerDevices = async () => {
  // ... (기존 등록 로직 동일)
  const result = await deviceStore.registerDevices(deviceList)

  // 등록된 장비 ID 저장 (그룹 할당에 사용)
  registeredDeviceIds.value = result.map((d: any) => d.id)

  emit('registered', selectedDevices.value)

  if (canManageGroups.value) {
    // 위저드 Step 4로 이동
    await groupStore.fetchGroups()
    step.value = 4
    wizardSubStep.value = 'ask'
  } else {
    closeModal()  // farm_user는 해당 없음 (접근 자체 차단)
  }
}
```

**Step 4 렌더링 조건:**
- `v-if="step === 4 && canManageGroups"`

**closeModal 변경:**

```typescript
const closeModal = () => {
  emit('close')
  step.value = 1
  // ... (기존 초기화)
  wizardSubStep.value = 'ask'
  registeredDeviceIds.value = []
  selectedGroupId.value = null
  newGroupName.value = ''
  newGroupDesc.value = ''
}
```

### 3-2. Devices.vue (소폭 변경)

**"+ 장비 추가" 버튼에 권한 가드 추가:**

```html
<!-- 변경 전 -->
<button class="btn-primary" @click="showRegistrationModal = true">+ 장비 추가</button>

<!-- 변경 후 -->
<button v-if="!authStore.isFarmUser" class="btn-primary" @click="showRegistrationModal = true">+ 장비 추가</button>
```

**Empty state의 "장비 추가" 버튼도 동일하게 가드 추가:**

```html
<!-- 변경 전 -->
<button v-if="!searchQuery" class="btn-primary" @click="showRegistrationModal = true">+ 장비 추가</button>

<!-- 변경 후 -->
<button v-if="!searchQuery && !authStore.isFarmUser" class="btn-primary" @click="showRegistrationModal = true">+ 장비 추가</button>
```

**authStore import 추가:**

```typescript
import { useAuthStore } from '@/stores/auth.store'
const authStore = useAuthStore()
```

---

## 4. 데이터 흐름

### 그룹 할당 흐름 (기존 그룹)

```
Step 4 "기존 그룹에 추가" 클릭
  → Step 4a 렌더링
  → groupStore.groups 목록 표시 (fetchGroups는 Step 4 진입 시 이미 호출)
  → 사용자 그룹 선택
  → "선택 완료" 클릭
  → groupStore.assignDevices(selectedGroupId, registeredDeviceIds)
  → 성공: 토스트 "장비가 그룹에 추가되었습니다" + closeModal()
  → 실패: 에러 메시지 표시
```

### 그룹 생성 + 할당 흐름 (새 그룹)

```
Step 4 "새 그룹 생성" 클릭
  → Step 4b 렌더링
  → 그룹명/설명 입력
  → "그룹 생성 및 장비 추가" 클릭
  → groupStore.createGroup({ name: newGroupName, description: newGroupDesc })
  → 반환된 group.id로 groupStore.assignDevices(group.id, registeredDeviceIds)
  → 성공: 토스트 "그룹이 생성되고 장비가 추가되었습니다" + closeModal()
  → 실패: 에러 메시지 표시
```

---

## 5. 스텝 인디케이터 UI

모달 헤더 아래에 단계 표시:

```
Step 1~3 (기존):
● Tuya 로드  →  ● 기기 선택  →  ● 이름 확인

Step 4 (신규):
○ Tuya 로드  →  ○ 기기 선택  →  ✓ 등록 완료  →  ● 그룹 설정
```

- 완료된 단계: ✓ (회색)
- 현재 단계: ● (녹색 강조)
- 미완료 단계: ○ (회색)

구현: 모달 헤더 내 `.wizard-steps` 컴포넌트 (inline CSS, 별도 컴포넌트 불필요)

---

## 6. 에러 처리

| 상황 | 처리 방법 |
|------|-----------|
| 그룹 목록 로딩 실패 | Step 4에서 에러 메시지 + "나중에" 버튼만 표시 |
| 그룹 할당 API 실패 | 에러 메시지 표시, 재시도 가능 |
| 그룹 생성 API 실패 | 에러 메시지 표시, 입력 유지 |
| 그룹명 빈칸 | "그룹 생성 및 장비 추가" 버튼 disabled |

---

## 7. 변경 파일 목록

| 파일 | 변경 유형 | 변경 내용 |
|------|-----------|-----------|
| [DeviceRegistration.vue](frontend/src/components/devices/DeviceRegistration.vue) | 수정 | Step 4(a/b) 추가, 그룹 관련 state/로직 추가 |
| [Devices.vue](frontend/src/views/Devices.vue) | 수정 | "+ 장비 추가" 버튼에 `v-if="!authStore.isFarmUser"` 추가, authStore import |

> Group 관련 API(`groupStore.fetchGroups`, `groupStore.createGroup`, `groupStore.assignDevices`)는 이미 구현되어 있어 신규 API 개발 불필요.

---

## 8. 변경하지 않는 파일

| 파일 | 이유 |
|------|------|
| Groups.vue | `v-if="!isFarmUser"` 이미 적용. 변경 없음 |
| auth.store.ts | `isAdmin`, `isFarmAdmin`, `isFarmUser` 이미 존재. 변경 없음 |
| group.store.ts | `fetchGroups`, `createGroup`, `assignDevices` 이미 존재. 변경 없음 |
| auth.types.ts | role 타입 이미 정의. 변경 없음 |

---

## 9. 구현 순서

1. [Devices.vue] `authStore` import + "장비 추가" 버튼 2곳에 `v-if` 가드 추가
2. [DeviceRegistration.vue] `groupStore`, `canManageGroups` 추가
3. [DeviceRegistration.vue] `registerDevices` 함수 수정 (step 4 분기)
4. [DeviceRegistration.vue] Step 4 템플릿 추가 (ask / existing / create substep)
5. [DeviceRegistration.vue] `closeModal` 초기화 항목 추가
6. 스텝 인디케이터 UI (선택 사항)
