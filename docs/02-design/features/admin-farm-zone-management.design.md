# Design: 플랫폼 관리자 농장·구역 통합 관리 (v2)

## 개념 모델 정립

```
플랫폼 관리자 온보딩 워크플로
  1단계: 사용자 관리 → farm_admin 계정 생성 (name = 농장명)  ← 이미 구현됨
  2단계: 게이트웨이 관리 → 게이트웨이 등록 + farm_admin에 소유 할당  ← 이미 구현됨
  3단계: 농장 관리 → 해당 농장의 구역 그룹 / 구역 추가 + 게이트웨이 할당  ← 이번 구현
```

### 데이터 계층 구조

```
farm_admin User (users.name = 농장명)      ← 농장 = 계정, 사용자 관리에서 생성
└── HouseGroup (house_groups.name = 구역 그룹명)   ← 예: "온실", "노지"
    └── House (houses.name = 구역명)               ← 예: "1동", "2동"
        └── Gateway (gateways.house_id → house)   ← 구역에 할당된 게이트웨이
```

**농장 관리 페이지의 역할**: 구역 그룹 / 구역 생성 + 게이트웨이 할당만 담당.  
농장(farm_admin 계정) 생성은 기존 `사용자 관리` 페이지에서 담당. 중복 없음.

---

## 현황 분석

### 이미 admin 지원되는 것 (수정 불필요)

| 기능 | 근거 |
|------|------|
| `GET /groups` 전체 조회 | `isAdmin ? {} : { userId }` 분기 존재 |
| `DELETE /groups/:id` | admin role 허용 |
| `GET /groups/:id/dependencies` | admin role 허용 |
| `PATCH /gateways/:id/zone` | `role === 'admin'` 분기로 전체 gateway 접근 가능 |
| `GET /users/farm-admins` | admin 전용 엔드포인트 존재 |
| `GET /gateways` | admin이면 전체 조회 |

### 미지원 → 수정 필요

| 기능 | 현재 문제 | 수정 방향 |
|------|----------|----------|
| `POST /groups` | `userId` = 호출자(admin)로 고정 | body에 `targetUserId` 수용 |
| `POST /groups/houses` | `userId` = 호출자(admin)로 고정 | body에 `targetUserId` 수용 |
| `DELETE /groups/houses/:id` | `{ id, userId }` → admin 삭제 불가 | admin role 분기 추가 |
| `PUT /groups/houses/:id` | `{ id, userId }` → admin 수정 불가 | admin role 분기 추가 |
| `GET /groups` 응답 | 소유자 name 미포함 | ownerName JOIN 필요 |

---

## API 설계

### `POST /api/groups` — 구역 그룹 생성

admin이 `targetUserId`를 포함하면 해당 farm_admin 소유로 생성.

```typescript
// groups.controller.ts
@Post()
async createGroup(@CurrentUser() user: any, @Body() body: any) {
  const effectiveUserId = (user.role === 'admin' && body.targetUserId)
    ? body.targetUserId
    : this.getEffectiveUserId(user);
  const result = await this.groupsService.createGroup(effectiveUserId, body);
  // activityLog ...
  return result;
}
```

Request body:
```json
{ "name": "온실", "targetUserId": "farm-admin-uuid" }
```

### `POST /api/groups/houses` — 구역 생성

```typescript
@Post('houses')
createHouse(@CurrentUser() user: any, @Body() body: any) {
  const effectiveUserId = (user.role === 'admin' && body.targetUserId)
    ? body.targetUserId
    : this.getEffectiveUserId(user);
  return this.groupsService.createHouse(effectiveUserId, body);
}
```

Request body:
```json
{ "name": "1동", "groupId": "group-uuid", "targetUserId": "farm-admin-uuid" }
```

### `DELETE /api/groups/houses/:id` — 구역 삭제 (admin 지원)

```typescript
// groups.service.ts
async removeHouse(id: string, userId: string, role?: string) {
  const isAdmin = role === 'admin';
  const house = await this.housesRepo.findOne({ where: isAdmin ? { id } : { id, userId } });
  if (!house) throw new NotFoundException();
  await this.housesRepo.remove(house);
  return { message: '삭제되었습니다.' };
}
```

controller에서 `user.role` 전달 추가:
```typescript
@Delete('houses/:id')
removeHouse(@Param('id') id: string, @CurrentUser() user: any) {
  return this.groupsService.removeHouse(id, this.getEffectiveUserId(user), user.role);
}
```

### `PUT /api/groups/houses/:id` — 구역 수정 (admin 지원)

```typescript
// groups.service.ts
async updateHouse(id: string, userId: string, data: {...}, role?: string) {
  const isAdmin = role === 'admin';
  const house = await this.housesRepo.findOne({ where: isAdmin ? { id } : { id, userId } });
  if (!house) throw new NotFoundException();
  // ...
}
```

### `GET /api/groups` — 소유자 정보 포함

admin 조회 시 각 group에 `ownerName`, `ownerUsername` 추가.

```typescript
// groups.service.ts — findAllGroups
if (isAdmin && groups.length > 0) {
  const userIds = [...new Set(groups.map(g => g.userId))];
  const users = await this.usersRepo.find({ where: { id: In(userIds) } });
  const userMap = new Map(users.map(u => [u.id, u]));
  return groups.map(g => ({
    ...g,
    ownerName: userMap.get(g.userId)?.name ?? '',
    ownerUsername: userMap.get(g.userId)?.username ?? '',
  }));
}
```

`GroupsModule`에 `User` 엔티티 import 추가 필요.

---

## 백엔드 변경 파일

| 파일 | 변경 내용 |
|------|----------|
| `groups.controller.ts` | `createGroup` / `createHouse`: targetUserId 처리 추가 |
| `groups.controller.ts` | `removeHouse` / `updateHouse`: `user.role` 전달 추가 |
| `groups.service.ts` | `removeHouse` / `updateHouse`: admin role 분기 |
| `groups.service.ts` | `findAllGroups`: ownerName 포함 반환 (User repo 추가) |
| `groups.module.ts` | `User` 엔티티 import 추가 |

---

## 프론트엔드 설계

### 신규 파일

| 파일 | 역할 |
|------|------|
| `frontend/src/views/AdminFarmManagement.vue` | admin 전용 구역 관리 페이지 |

### 기존 파일 수정

| 파일 | 변경 내용 |
|------|----------|
| `router/index.ts` | `/admin/farms` 경로 추가 |
| `App.vue` | 사이드바에 "농장 관리" 메뉴 추가 (admin 전용, 데스크톱 + 모바일) |
| `group.api.ts` | admin 전용 API 함수 추가 |
| `group.types.ts` | `HouseGroupWithOwner`, `FarmAdmin` 타입 추가 |

### 라우터 (`router/index.ts`)

```typescript
{
  path: '/admin/farms',
  name: 'admin-farms',
  component: () => import('../views/AdminFarmManagement.vue'),
  meta: { requiresAuth: true, requiresAdmin: true },
},
```

### 사이드바 (`App.vue`)

기존 admin 전용 메뉴 블록에 삽입 (gateways와 users 사이):
```html
<!-- 데스크톱 -->
<router-link v-if="isAdmin" to="/admin/farms" class="sidebar-link">
  <span class="sidebar-icon">🏘</span>농장 관리
</router-link>

<!-- 모바일 드로어 동일하게 추가 -->
```

기존 `/groups` 링크 (구역관리)는 **그대로 유지**.

### `group.api.ts` 추가 함수

```typescript
// admin 전용
adminCreateGroup: (data: { name: string; targetUserId: string; description?: string }) =>
  apiClient.post<HouseGroup>('/groups', data),

adminCreateHouse: (data: { name: string; groupId: string; targetUserId: string; location?: string }) =>
  apiClient.post<House>('/groups/houses', data),

adminRemoveHouse: (id: string) =>
  apiClient.delete(`/groups/houses/${id}`),

adminUpdateHouse: (id: string, data: Partial<CreateHouseRequest>) =>
  apiClient.put<House>(`/groups/houses/${id}`, data),
```

### `group.types.ts` 추가 타입

```typescript
export interface HouseGroupWithOwner extends HouseGroup {
  ownerName?: string
  ownerUsername?: string
}

export interface FarmAdmin {
  id: string
  username: string
  name: string        // = 농장명
  status: string
}
```

---

## `AdminFarmManagement.vue` UI 설계

### 2-패널 레이아웃

```
┌─────────────────────────────────────────────────────────────────────┐
│  농장 관리 (플랫폼 관리자 전용)                                      │
│  농장은 사용자 관리에서 생성됩니다.           [→ 사용자 관리 이동]   │
├─────────────────────┬───────────────────────────────────────────────┤
│  농장 목록          │  선택된 농장: ohgane농장 (mtest)               │
│                     │                        [+ 구역 그룹 추가]      │
│  ┌──────────────┐   │  ┌─────────────────────────────────────────┐  │
│  │ ohgane농장   │◀─ │  │  온실              [+ 구역 추가] [삭제]  │  │
│  │ mtest        │   │  │  ├─ 1동   게이트웨이: lgw-dev  [변경]   │  │
│  │ 구역그룹 2개 │   │  │  └─ 2동   게이트웨이: 미할당   [할당]   │  │
│  └──────────────┘   │  ├─────────────────────────────────────────┤  │
│                     │  │  노지              [+ 구역 추가] [삭제]  │  │
│  ┌──────────────┐   │  │  └─ A구역  게이트웨이: 미할당   [할당]   │  │
│  │ test2농장    │   │  └─────────────────────────────────────────┘  │
│  │ mtest2       │   │                                               │
│  │ 구역그룹 없음│   │                                               │
│  └──────────────┘   │                                               │
└─────────────────────┴───────────────────────────────────────────────┘
```

### 상태 데이터

```typescript
const farmAdmins = ref<FarmAdmin[]>([])         // GET /users/farm-admins
const allGroups = ref<HouseGroupWithOwner[]>([]) // GET /groups (admin → 전체)
const allGateways = ref<Gateway[]>([])           // GET /gateways (admin → 전체)
const selectedFarmAdminId = ref<string | null>(null)

// 선택된 농장의 구역 그룹만
const selectedFarmGroups = computed(() =>
  allGroups.value.filter(g => g.userId === selectedFarmAdminId.value)
)

// 선택된 농장 소유 게이트웨이 (할당 드롭다운용)
const selectedFarmGateways = computed(() =>
  allGateways.value.filter(gw => gw.userId === selectedFarmAdminId.value)
)

// 선택된 농장 정보
const selectedFarm = computed(() =>
  farmAdmins.value.find(u => u.id === selectedFarmAdminId.value) ?? null
)
```

### 모달 / 인라인 폼

| 인터랙션 | 방식 | 호출 API |
|---------|------|---------|
| 구역 그룹 추가 | 인라인 입력 또는 소형 모달 | `adminCreateGroup` |
| 구역 추가 | 인라인 입력 또는 소형 모달 | `adminCreateHouse` |
| 구역 그룹 삭제 | confirm 다이얼로그 | `DELETE /groups/:id` |
| 구역 삭제 | confirm 다이얼로그 | `adminRemoveHouse` |
| 게이트웨이 할당 | 드롭다운 (인라인) | `PATCH /gateways/:id/zone` |

### 게이트웨이 할당 드롭다운 항목

```
선택하세요
────────────────
lgw-dev (온라인)
lgw-prod (오프라인)
────────────────
할당 해제
```

---

## 구현 순서

### Step 1: Backend (약 30분)

1. `groups.module.ts` — User 엔티티 import
2. `groups.service.ts` — `findAllGroups` ownerName 반환
3. `groups.service.ts` — `removeHouse` / `updateHouse` admin 분기
4. `groups.controller.ts` — `createGroup` / `createHouse` targetUserId 처리
5. `groups.controller.ts` — `removeHouse` / `updateHouse` role 전달

### Step 2: Frontend (약 3~4시간)

1. `group.types.ts` — HouseGroupWithOwner, FarmAdmin 타입 추가
2. `group.api.ts` — admin 전용 함수 추가
3. `router/index.ts` — `/admin/farms` 경로 추가
4. `App.vue` — 사이드바 메뉴 추가 (데스크톱 + 모바일)
5. `AdminFarmManagement.vue` — 신규 페이지 구현

---

## 엣지 케이스

| 케이스 | 처리 |
|--------|------|
| farm_admin 계정 없음 | "농장이 없습니다. 사용자 관리에서 농장 관리자를 먼저 추가하세요" + 링크 |
| farm_admin에 게이트웨이 없음 | 할당 드롭다운에 "이 농장에 등록된 게이트웨이가 없습니다" |
| 게이트웨이가 이미 다른 구역에 할당됨 | 409 응답 → 알림 "다른 구역에 이미 할당됨. 먼저 해제 필요" |
| 구역에 게이트웨이 연결 상태에서 삭제 시도 | 경고: "게이트웨이가 연결된 구역입니다" + 확인 후 삭제 허용 |
| 구역 그룹에 자동화 규칙 존재 | DELETE 409 응답 → 기존 로직 그대로 에러 표시 |

---

## 수정하지 않는 파일

- `Groups.vue` — farm_admin / farm_user 전용 구역관리 페이지, 수정 없음
- `UserFormModal.vue` — 사용자 생성 폼, 수정 없음
- `gateway-manager.service.ts` — `assignZone` 이미 admin 지원
