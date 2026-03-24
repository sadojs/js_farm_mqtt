# Design: role-based-access

> 3-Tier 역할 기반 접근 제어 (RBAC) 상세 설계

## 1. 데이터 구조 변경

### 1-1. DB 스키마 변경 (users 테이블)

**AS-IS:**
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(100) NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'user')),
  address TEXT,
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

**TO-BE:**
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(100) NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'farm_admin', 'farm_user')),
  parent_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  address TEXT,
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_users_parent ON users(parent_user_id);
```

**변경 사항:**
- `role` CHECK 제약 조건: `('admin', 'user')` → `('admin', 'farm_admin', 'farm_user')`
- `parent_user_id` 컬럼 추가: farm_user가 소속된 farm_admin의 user_id (FK, nullable)
- `parent_user_id` 인덱스 추가

### 1-2. 마이그레이션 SQL (ALTER TABLE)

```sql
-- 1. 기존 CHECK 제약 조건 삭제 후 재생성
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'farm_admin', 'farm_user'));

-- 2. parent_user_id 컬럼 추가
ALTER TABLE users ADD COLUMN parent_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX idx_users_parent ON users(parent_user_id);

-- 3. 기존 'user' 역할 → 'farm_admin'으로 마이그레이션
UPDATE users SET role = 'farm_admin' WHERE role = 'user';
```

### 1-3. seed-local.sql 변경

**AS-IS:**
```sql
role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'user')),
...
INSERT INTO users (..., role, ...) VALUES (..., 'user', ...);
```

**TO-BE:**
```sql
role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'farm_admin', 'farm_user')),
parent_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
...
INSERT INTO users (..., role, ...) VALUES (..., 'farm_admin', ...);
```

## 2. Backend 변경 상세

### 2-1. User Entity (`user.entity.ts`)

**AS-IS:**
```typescript
@Column({ type: 'varchar', length: 20 })
role: 'admin' | 'user';
```

**TO-BE:**
```typescript
@Column({ type: 'varchar', length: 20 })
role: 'admin' | 'farm_admin' | 'farm_user';

@Column({ name: 'parent_user_id', nullable: true })
parentUserId: string | null;
```

### 2-2. User DTO (`user.dto.ts`)

**AS-IS (CreateUserDto):**
```typescript
@IsOptional()
@IsIn(['admin', 'user'])
role?: 'admin' | 'user';
```

**TO-BE (CreateUserDto):**
```typescript
@IsOptional()
@IsIn(['admin', 'farm_admin', 'farm_user'])
role?: 'admin' | 'farm_admin' | 'farm_user';

@IsOptional()
@IsString()
parentUserId?: string;
```

**AS-IS (UpdateUserDto):**
```typescript
@IsOptional()
@IsIn(['admin', 'user'])
role?: 'admin' | 'user';
```

**TO-BE (UpdateUserDto):**
```typescript
@IsOptional()
@IsIn(['admin', 'farm_admin', 'farm_user'])
role?: 'admin' | 'farm_admin' | 'farm_user';

@IsOptional()
@IsString()
parentUserId?: string;
```

### 2-3. JWT Strategy (`jwt.strategy.ts`)

**AS-IS:**
```typescript
export interface JwtPayload {
  sub: string;
  email: string;
  role: 'admin' | 'user';
}
```

**TO-BE:**
```typescript
export interface JwtPayload {
  sub: string;
  email: string;
  role: 'admin' | 'farm_admin' | 'farm_user';
  parentUserId?: string | null;
}
```

`validate` 메서드도 `parentUserId`를 반환하도록 수정:
```typescript
async validate(payload: JwtPayload) {
  return {
    id: payload.sub,
    email: payload.email,
    role: payload.role,
    parentUserId: payload.parentUserId || null,
  };
}
```

> **참고**: AuthService에서 JWT 토큰 생성 시 `parentUserId`를 payload에 포함해야 함

### 2-4. RolesGuard (`roles.guard.ts`)

**변경 없음** — 현재 구현이 `requiredRoles.includes(user.role)`로 이미 배열 기반이므로 3-tier 역할도 자동 지원됨.

### 2-5. Users Service (`users.service.ts`)

**추가 메서드 1: 팜 관리자 목록 조회**
```typescript
async findFarmAdmins() {
  const admins = await this.usersRepo.find({
    where: { role: 'farm_admin', status: 'active' },
    order: { name: 'ASC' },
  });
  return admins.map(u => this.sanitize(u));
}
```

**추가 메서드 2: getEffectiveUserId (데이터 공유 핵심)**
```typescript
getEffectiveUserId(user: { id: string; role: string; parentUserId?: string | null }): string {
  if (user.role === 'farm_user' && user.parentUserId) {
    return user.parentUserId;
  }
  return user.id;
}
```

**create 메서드 수정:**
```typescript
async create(dto: CreateUserDto) {
  const exists = await this.usersRepo.findOne({ where: { email: dto.email } });
  if (exists) throw new ConflictException('이미 등록된 이메일입니다.');

  const user = this.usersRepo.create({
    email: dto.email,
    passwordHash: await bcrypt.hash(dto.password, 10),
    name: dto.name,
    role: dto.role || 'farm_admin',
    address: dto.address,
    parentUserId: dto.parentUserId || null,
  });
  const saved = await this.usersRepo.save(user);
  return this.sanitize(saved);
}
```

**findAll 메서드 수정** — parentUserId 정보 포함:
```typescript
async findAll() {
  const users = await this.usersRepo.find({ order: { createdAt: 'DESC' } });
  const result: any[] = [];
  for (const user of users) {
    const tuya = await this.tuyaRepo.findOne({ where: { userId: user.id } });
    // farm_user는 parent의 tuya 정보를 사용
    let tuyaProject = null;
    if (tuya) {
      tuyaProject = { name: tuya.name, accessId: tuya.accessId, endpoint: tuya.endpoint, projectId: tuya.projectId, enabled: tuya.enabled };
    } else if (user.parentUserId) {
      const parentTuya = await this.tuyaRepo.findOne({ where: { userId: user.parentUserId } });
      if (parentTuya) {
        tuyaProject = { name: parentTuya.name, accessId: parentTuya.accessId, endpoint: parentTuya.endpoint, projectId: parentTuya.projectId, enabled: parentTuya.enabled };
      }
    }
    // parentUser 이름 조회
    let parentUserName = null;
    if (user.parentUserId) {
      const parent = await this.usersRepo.findOne({ where: { id: user.parentUserId } });
      parentUserName = parent?.name || null;
    }
    result.push({
      ...this.sanitize(user),
      parentUserId: user.parentUserId,
      parentUserName,
      tuyaProject,
    });
  }
  return result;
}
```

### 2-6. Users Controller (`users.controller.ts`)

**추가 엔드포인트:**
```typescript
// 팜 관리자 목록 조회 (사용자 등록 시 farm_user의 소속 선택용)
@Get('farm-admins')
@UseGuards(RolesGuard)
@Roles('admin')
findFarmAdmins() {
  return this.usersService.findFarmAdmins();
}
```

> **주의**: `farm-admins`는 `@Get(':id')` 보다 위에 배치해야 라우트 매칭 충돌 방지

### 2-7. 각 서비스의 데이터 공유 로직

farm_user가 API 요청 시 `parent_user_id` 기반으로 데이터를 조회하도록 변경. 핵심 패턴:

```typescript
// Controller에서 (공통 패턴)
const effectiveUserId = this.usersService.getEffectiveUserId(req.user);
```

**대상 서비스 및 변경 방식:**

| 서비스 | 현재 `userId` 사용 위치 | 변경 |
|--------|------------------------|------|
| `dashboard.service.ts` | `getWeatherForUser(userId)` | farm_user → parentUserId의 주소로 날씨 조회 |
| `sensors.service.ts` | `queryData(userId, ...)`, `getLatest(userId)` | farm_user → parentUserId로 데이터 조회 |
| `groups.service.ts` | `findAllGroups(userId)`, `findAllHouses(userId)` | farm_user → parentUserId로 조회 (읽기 전용) |
| `reports.service.ts` | `getStatistics(userId, ...)`, `getHourlyData(userId, ...)` | farm_user → parentUserId로 데이터 조회 |

**구현 방식**: 각 Controller에서 `getEffectiveUserId()`를 호출하여 userId를 변환 후 서비스에 전달. 서비스 코드 자체는 변경 불필요.

### 2-8. Auth Service (JWT 토큰 생성)

`auth.service.ts`의 `login`/`refresh` 메서드에서 JWT payload에 `parentUserId` 추가:

```typescript
const payload: JwtPayload = {
  sub: user.id,
  email: user.email,
  role: user.role,
  parentUserId: user.parentUserId || null,
};
```

## 3. Frontend 변경 상세

### 3-1. Auth Types (`auth.types.ts`)

**AS-IS:**
```typescript
export interface User {
  id: string
  email: string
  name: string
  role: 'admin' | 'user'
  address?: string
  status: 'active' | 'inactive'
  tuyaProject?: TuyaProject
  createdAt: string
  updatedAt: string
}
```

**TO-BE:**
```typescript
export interface User {
  id: string
  email: string
  name: string
  role: 'admin' | 'farm_admin' | 'farm_user'
  parentUserId?: string | null
  parentUserName?: string | null
  address?: string
  status: 'active' | 'inactive'
  tuyaProject?: TuyaProject
  createdAt: string
  updatedAt: string
}
```

### 3-2. Auth Store (`auth.store.ts`)

**AS-IS:**
```typescript
const isAdmin = computed(() => user.value?.role === 'admin')
```

**TO-BE:**
```typescript
const isAdmin = computed(() => user.value?.role === 'admin')
const isFarmAdmin = computed(() => user.value?.role === 'farm_admin')
const isFarmUser = computed(() => user.value?.role === 'farm_user')
```

`return`에 `isFarmAdmin`, `isFarmUser` 추가.

### 3-3. Router Guard (`router/index.ts`)

**AS-IS:**
```typescript
routes: [
  { path: '/devices', ..., meta: { title: '장비 관리', requiresAuth: true } },
  { path: '/automation', ..., meta: { title: '자동화', requiresAuth: true } },
  { path: '/users', ..., meta: { title: '사용자 관리', requiresAuth: true, requiresAdmin: true } },
]
```

**TO-BE:**
```typescript
routes: [
  { path: '/devices', ..., meta: { title: '장비 관리', requiresAuth: true, denyFarmUser: true } },
  { path: '/automation', ..., meta: { title: '자동화', requiresAuth: true, denyFarmUser: true } },
  { path: '/users', ..., meta: { title: '사용자 관리', requiresAuth: true, requiresAdmin: true } },
]
```

**라우터 가드 추가:**
```typescript
// farm_user 접근 불가 페이지
if (to.meta.denyFarmUser && authStore.isFarmUser) {
  const notificationStore = useNotificationStore()
  notificationStore.error('접근 거부', '해당 메뉴에 접근할 수 없습니다.')
  next('/dashboard')
  return
}
```

### 3-4. App.vue 사이드바 메뉴 조건부 렌더링

**AS-IS (데스크탑 사이드바 + 모바일 드로어):**
```html
<router-link to="/devices" class="sidebar-link">장비 관리</router-link>
<router-link to="/groups" class="sidebar-link">그룹 관리</router-link>
<router-link to="/automation" class="sidebar-link">자동화 룰</router-link>
<router-link to="/sensors" class="sidebar-link">실시간 모니터링</router-link>
<router-link to="/reports" class="sidebar-link">리포트</router-link>
<router-link v-if="isAdmin" to="/users" class="sidebar-link">사용자 관리</router-link>
```

**TO-BE:**
```html
<router-link to="/dashboard" class="sidebar-link">대시보드</router-link>
<router-link v-if="!isFarmUser" to="/devices" class="sidebar-link">장비 관리</router-link>
<router-link to="/groups" class="sidebar-link">그룹 관리</router-link>
<router-link v-if="!isFarmUser" to="/automation" class="sidebar-link">자동화 룰</router-link>
<router-link to="/sensors" class="sidebar-link">실시간 모니터링</router-link>
<router-link to="/reports" class="sidebar-link">리포트</router-link>
<router-link v-if="isAdmin" to="/users" class="sidebar-link">사용자 관리</router-link>
```

**메뉴 접근 매트릭스:**

| 메뉴 | admin | farm_admin | farm_user | 조건 |
|------|:-----:|:----------:|:---------:|------|
| 대시보드 | O | O | O | 항상 표시 |
| 장비 관리 | O | O | X | `v-if="!isFarmUser"` |
| 그룹 관리 | O | O | O | 항상 표시 |
| 자동화 룰 | O | O | X | `v-if="!isFarmUser"` |
| 실시간 모니터링 | O | O | O | 항상 표시 |
| 리포트 | O | O | O | 항상 표시 |
| 사용자 관리 | O | X | X | `v-if="isAdmin"` |

**App.vue script 추가:**
```typescript
const isFarmUser = computed(() => authStore.isFarmUser)
```

**userRole computed 수정:**
```typescript
const userRole = computed(() => {
  if (isAdmin.value) return '플랫폼 관리자'
  if (authStore.isFarmAdmin) return '농장 관리자'
  return '농장 사용자'
})
```

### 3-5. MoreMenu.vue 모바일 메뉴 변경

**변경 없음** — 현재 MoreMenu에는 리포트, 사용자 관리, 로그아웃만 존재. 사용자 관리는 이미 `v-if="isAdmin"`으로 제어됨. farm_user에게 숨겨야 할 메뉴가 MoreMenu에 없으므로 변경 불필요.

### 3-6. UserFormModal.vue 역할 선택 + 팜 선택 UI

**AS-IS 역할 선택:**
```html
<select v-model="formData.role" class="form-select" required>
  <option value="user">사용자</option>
  <option value="admin">관리자</option>
</select>
```

**TO-BE 역할 선택:**
```html
<select v-model="formData.role" class="form-select" required>
  <option value="farm_admin">농장 관리자</option>
  <option value="farm_user">농장 사용자</option>
  <option value="admin">플랫폼 관리자</option>
</select>
```

**추가: 팜 관리자 선택 UI (farm_user 선택 시)**
```html
<div v-if="formData.role === 'farm_user'" class="form-group">
  <label>소속 농장 (농장 관리자) *</label>
  <select v-model="formData.parentUserId" class="form-select" required>
    <option value="">선택하세요</option>
    <option v-for="admin in farmAdmins" :key="admin.id" :value="admin.id">
      {{ admin.name }} ({{ admin.email }})
    </option>
  </select>
  <p class="help-text">
    농장 사용자는 선택한 농장 관리자의 장비/센서/그룹 데이터를 공유합니다
  </p>
</div>
```

**추가: Tuya 섹션 조건부 표시 (farm_user 선택 시 숨김)**
```html
<div v-if="formData.role !== 'farm_user'" class="form-section">
  <h3 class="section-title">Tuya Cloud 프로젝트 설정</h3>
  ...
</div>
```

**Script 추가:**
```typescript
import { userApi } from '../../api/user.api'

const farmAdmins = ref<{ id: string; name: string; email: string }[]>([])

// 모달 열릴 때 팜 관리자 목록 조회
watch(() => props.show, async (show) => {
  if (show) {
    try {
      const { data } = await userApi.getFarmAdmins()
      farmAdmins.value = data as any
    } catch { /* ignore */ }
  }
})

// role이 farm_user가 아닌 경우 parentUserId 초기화
watch(() => formData.value.role, (role) => {
  if (role !== 'farm_user') {
    formData.value.parentUserId = undefined
  }
})
```

**UserFormData 인터페이스 수정:**
```typescript
interface UserFormData {
  id?: string
  name: string
  email: string
  role: 'admin' | 'farm_admin' | 'farm_user'
  parentUserId?: string
  address?: string
  tuyaProject?: any
  password?: string
  [key: string]: any
}
```

### 3-7. user.api.ts API 추가

**추가:**
```typescript
// 팜 관리자 목록 조회 (farm_user 등록 시 사용)
getFarmAdmins: () =>
  apiClient.get('/users/farm-admins'),
```

**CreateUserRequest 타입 수정:**
```typescript
export interface CreateUserRequest {
  email: string
  password: string
  name: string
  role: 'admin' | 'farm_admin' | 'farm_user'
  address?: string
  parentUserId?: string
}
```

### 3-8. UserManagement.vue 역할 뱃지 3종

**AS-IS:**
```html
<span class="role-badge" :class="user.role">
  {{ user.role === 'admin' ? '관리자' : '사용자' }}
</span>
```

**TO-BE:**
```html
<span class="role-badge" :class="user.role">
  {{ roleLabel(user.role) }}
</span>
<span v-if="user.parentUserName" class="parent-badge">
  {{ user.parentUserName }}
</span>
```

**Script 추가:**
```typescript
function roleLabel(role: string): string {
  switch (role) {
    case 'admin': return '플랫폼 관리자'
    case 'farm_admin': return '농장 관리자'
    case 'farm_user': return '농장 사용자'
    default: return role
  }
}
```

**User 인터페이스 수정:**
```typescript
interface User {
  id: string
  name: string
  email: string
  role: 'admin' | 'farm_admin' | 'farm_user'
  parentUserId?: string
  parentUserName?: string
  address?: string
  tuyaProject?: any
  createdAt: string
  status: 'active' | 'inactive'
}
```

**CSS 추가:**
```css
.role-badge.farm_admin {
  background: #fff3e0;
  color: #e65100;
}

.role-badge.farm_user {
  background: #e8f5e9;
  color: #2e7d32;
}

.parent-badge {
  display: inline-block;
  margin-left: 6px;
  padding: 2px 8px;
  border-radius: 8px;
  font-size: 11px;
  background: var(--bg-badge);
  color: var(--text-muted);
}
```

### 3-9. UserManagement.vue saveUser 수정

**추가: farm_user 생성 시 parentUserId 포함**
```typescript
// 신규 추가
await userApi.create({
  email: userData.email,
  password: userData.password,
  name: userData.name,
  role: userData.role || 'farm_admin',
  address: userData.address,
  parentUserId: userData.parentUserId,  // 추가
})
```

**Tuya 업데이트 조건 추가:**
```typescript
// farm_user는 Tuya 프로젝트 설정 불필요 (parent의 것을 사용)
if (userData.role !== 'farm_user' && userData.tuyaProject?.name && ...) {
  // Tuya 업데이트 로직
}
```

## 4. 구현 순서

### Phase 1: DB + Entity 변경
1. `database/schema.sql` — role CHECK 확장 + `parent_user_id` 컬럼 + 인덱스
2. `database/seed-local.sql` — role CHECK 확장 + 시드 데이터 role 값 변경 (`user` → `farm_admin`)
3. `src/modules/users/entities/user.entity.ts` — role 타입 확장 + parentUserId 필드
4. `src/modules/users/dto/user.dto.ts` — CreateUserDto/UpdateUserDto role 확장 + parentUserId

### Phase 2: Backend Auth + API 확장
5. `src/modules/auth/strategies/jwt.strategy.ts` — JwtPayload role 타입 + parentUserId
6. `src/modules/auth/auth.service.ts` — JWT 토큰 payload에 parentUserId 추가
7. `src/modules/users/users.service.ts` — findFarmAdmins + getEffectiveUserId + create 수정 + findAll 수정
8. `src/modules/users/users.controller.ts` — `GET /users/farm-admins` 엔드포인트 (`:id` 위에 배치)

### Phase 3: Backend 데이터 공유 로직
9. 각 Controller에서 `getEffectiveUserId()` 호출:
   - `dashboard.controller.ts`
   - `sensors.controller.ts`
   - `groups.controller.ts`
   - `reports.controller.ts`

### Phase 4: Frontend 권한 시스템
10. `src/types/auth.types.ts` — User role 타입 확장 + parentUserId
11. `src/stores/auth.store.ts` — isFarmAdmin, isFarmUser computed
12. `src/router/index.ts` — denyFarmUser meta + 라우터 가드
13. `src/App.vue` — 사이드바 메뉴 조건부 렌더링 (데스크탑 + 모바일 드로어) + userRole 수정

### Phase 5: 사용자 등록 폼 수정
14. `src/api/user.api.ts` — getFarmAdmins API + CreateUserRequest 타입 수정
15. `src/components/admin/UserFormModal.vue` — 역할 3개 선택 + 팜 관리자 선택 UI + Tuya 섹션 조건부
16. `src/views/UserManagement.vue` — 역할 뱃지 3종 + parentUserName 표시 + saveUser 수정

### Phase 6: 빌드 검증
17. Backend (`npm run build`)
18. Frontend (`npx vue-tsc --noEmit && npx vite build`)

## 5. 보안 고려사항

- **API 레벨 보호**: farm_user가 장비/자동화 CRUD API에 직접 접근 시 403 반환 (기존 `@Roles('admin')` 가드 + 새 제한 필요)
- **데이터 격리**: farm_user는 반드시 `parentUserId` 기반으로만 데이터 조회 — 다른 사용자 데이터 접근 불가
- **토큰 호환성**: 기존 `admin`/`user` 토큰은 만료 시까지 유효 — `user` 역할은 `farm_admin`과 동일 취급하거나 재로그인 유도
- **parentUserId 무결성**: farm_user 생성 시 parentUserId가 실제 farm_admin인지 검증 필요

## 6. 파일 변경 목록 요약

| # | 파일 | 변경 유형 | 설명 |
|---|------|----------|------|
| 1 | `database/schema.sql` | 수정 | role CHECK + parent_user_id |
| 2 | `database/seed-local.sql` | 수정 | role CHECK + seed role 변경 |
| 3 | `backend/.../user.entity.ts` | 수정 | role 타입 + parentUserId |
| 4 | `backend/.../user.dto.ts` | 수정 | role 타입 + parentUserId |
| 5 | `backend/.../jwt.strategy.ts` | 수정 | JwtPayload role + parentUserId |
| 6 | `backend/.../auth.service.ts` | 수정 | JWT payload에 parentUserId |
| 7 | `backend/.../users.service.ts` | 수정 | findFarmAdmins + getEffectiveUserId + create/findAll 수정 |
| 8 | `backend/.../users.controller.ts` | 수정 | farm-admins 엔드포인트 |
| 9 | `backend/.../dashboard.controller.ts` | 수정 | effectiveUserId |
| 10 | `backend/.../sensors.controller.ts` | 수정 | effectiveUserId |
| 11 | `backend/.../groups.controller.ts` | 수정 | effectiveUserId |
| 12 | `backend/.../reports.controller.ts` | 수정 | effectiveUserId |
| 13 | `frontend/.../auth.types.ts` | 수정 | role 타입 + parentUserId |
| 14 | `frontend/.../auth.store.ts` | 수정 | isFarmAdmin, isFarmUser |
| 15 | `frontend/.../router/index.ts` | 수정 | denyFarmUser + 가드 |
| 16 | `frontend/.../App.vue` | 수정 | 사이드바 조건부 렌더링 |
| 17 | `frontend/.../user.api.ts` | 수정 | getFarmAdmins + 타입 수정 |
| 18 | `frontend/.../UserFormModal.vue` | 수정 | 역할 3개 + 팜 선택 UI |
| 19 | `frontend/.../UserManagement.vue` | 수정 | 역할 뱃지 3종 + parentUser |
