# Design: 계정 형식 변경 (Email → Username)

> Plan 참조: `docs/01-plan/features/account-username-login.plan.md`

## 1. DB 마이그레이션

### 1.1 마이그레이션 SQL (`backend/database/migration-003-email-to-username.sql`)

```sql
-- 1) 컬럼 이름 변경
ALTER TABLE users RENAME COLUMN email TO username;

-- 2) 기존 이메일 데이터에서 @ 앞부분만 추출하여 소문자 변환
UPDATE users SET username = LOWER(SPLIT_PART(username, '@', 1));

-- 3) 인덱스 재생성
DROP INDEX IF EXISTS idx_users_email;
CREATE INDEX idx_users_username ON users(username);

-- 4) VARCHAR 길이 조정 (255 → 50)
ALTER TABLE users ALTER COLUMN username TYPE VARCHAR(50);
```

### 1.2 schema.sql 변경

```sql
-- Before
email VARCHAR(255) UNIQUE NOT NULL,
CREATE INDEX idx_users_email ON users(email);

-- After
username VARCHAR(50) UNIQUE NOT NULL,
CREATE INDEX idx_users_username ON users(username);
```

### 1.3 seed-local.sql 변경

```sql
-- Before
INSERT INTO users (email, ...) VALUES ('admin@farm.com', ...);
INSERT INTO users (email, ...) VALUES ('user@farm.com', ...);
-- ... WHERE u.email = 'user@farm.com'

-- After
INSERT INTO users (username, ...) VALUES ('admin', ...);
INSERT INTO users (username, ...) VALUES ('farmuser', ...);
-- ... WHERE u.username = 'farmuser'
```

---

## 2. Backend 변경 상세

### 2.1 User Entity (`modules/users/entities/user.entity.ts`)

```typescript
// Before
@Column({ unique: true })
email: string;

// After
@Column({ unique: true, length: 50 })
username: string;
```

### 2.2 Login DTO (`modules/auth/dto/login.dto.ts`)

```typescript
// Before
import { IsEmail, IsString, MinLength } from 'class-validator';
export class LoginDto {
  @IsEmail()
  email: string;

// After
import { IsString, MinLength, MaxLength, Matches } from 'class-validator';
export class LoginDto {
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  @Matches(/^[a-zA-Z0-9_-]+$/, { message: '영문, 숫자, _, -만 사용 가능합니다.' })
  username: string;
```

### 2.3 CreateUserDto (`modules/users/dto/user.dto.ts`)

```typescript
// Before
@IsEmail()
email: string;

// After
@IsString()
@MinLength(2)
@MaxLength(50)
@Matches(/^[a-zA-Z0-9_-]+$/, { message: '영문, 숫자, _, -만 사용 가능합니다.' })
username: string;
```

### 2.4 JWT Payload (`modules/auth/strategies/jwt.strategy.ts`)

```typescript
// Before
export interface JwtPayload {
  sub: string;
  email: string;
  role: ...;
  parentUserId?: string | null;
}
// validate() → return { id: payload.sub, email: payload.email, ... }

// After
export interface JwtPayload {
  sub: string;
  username: string;
  role: ...;
  parentUserId?: string | null;
}
// validate() → return { id: payload.sub, username: payload.username, ... }
```

### 2.5 Auth Service (`modules/auth/auth.service.ts`)

변경 지점:
1. `login()`: `findOne({ where: { email } })` → `findOne({ where: { username } })`, 소문자 변환 적용
2. `login()`: JWT payload `email: user.email` → `username: user.username`
3. `login()`: 응답 `user.email` → `user.username`
4. `login()`: 에러 메시지 `'이메일 또는 비밀번호가 올바르지 않습니다.'` → `'사용자명 또는 비밀번호가 올바르지 않습니다.'`
5. `refresh()`: `newPayload.email` → `newPayload.username`
6. `getMe()`: 응답 `email` → `username`

### 2.6 Users Service (`modules/users/users.service.ts`)

변경 지점:
1. `create()`: `findOne({ where: { email: dto.email } })` → `findOne({ where: { username: dto.username.toLowerCase() } })`
2. `create()`: 에러 메시지 `'이미 등록된 이메일입니다.'` → `'이미 등록된 사용자명입니다.'`
3. `create()`: `usersRepo.create({ email: dto.email, ... })` → `usersRepo.create({ username: dto.username.toLowerCase(), ... })`
4. `sanitize()`: `passwordHash` 제거 로직은 그대로 (email→username 프로퍼티명만 변경됨)

### 2.7 Users Controller (`modules/users/users.controller.ts`)

변경 없음 — sanitize()가 email→username 자동 반영.

---

## 3. Frontend 변경 상세

### 3.1 Auth Types (`types/auth.types.ts`)

```typescript
// Before
export interface User {
  id: string
  email: string
  ...
}
export interface LoginRequest {
  email: string
  password: string
}

// After
export interface User {
  id: string
  username: string
  ...
}
export interface LoginRequest {
  username: string
  password: string
}
```

### 3.2 Auth API (`api/auth.api.ts`)

```typescript
// Before
login: (email: string, password: string) =>
  apiClient.post<LoginResponse>('/auth/login', { email, password }),

// After
login: (username: string, password: string) =>
  apiClient.post<LoginResponse>('/auth/login', { username, password }),
```

### 3.3 User API (`api/user.api.ts`)

```typescript
// Before
export interface CreateUserRequest {
  email: string
  ...
}

// After
export interface CreateUserRequest {
  username: string
  ...
}
```

### 3.4 Auth Store (`stores/auth.store.ts`)

```typescript
// Before
async function login(email: string, password: string) {
  const { data } = await authApi.login(email, password)

// After
async function login(username: string, password: string) {
  const { data } = await authApi.login(username, password)
```

### 3.5 Login View (`views/Login.vue`)

| 요소 | Before | After |
|------|--------|-------|
| label | `이메일` | `사용자명` |
| input type | `email` | `text` |
| input name | `email` | `username` |
| autocomplete | `email` | `username` |
| placeholder | `your@email.com` | `사용자명을 입력하세요` |
| v-model | `loginData.email` | `loginData.username` |
| LoginData interface | `email: string` | `username: string` |
| handleLogin | `authStore.login(loginData.value.email, ...)` | `authStore.login(loginData.value.username, ...)` |
| 에러 메시지 | `이메일 또는 비밀번호가...` | `사용자명 또는 비밀번호가...` |

### 3.6 UserManagement View (`views/UserManagement.vue`)

| 요소 | Before | After |
|------|--------|-------|
| 테이블 헤더 | `<th>이메일</th>` | `<th>사용자명</th>` |
| 테이블 데이터 | `{{ user.email }}` | `{{ user.username }}` |
| User interface | `email: string` | `username: string` |
| 게이트웨이 소유자 select | `{{ user.name }} ({{ user.email }})` | `{{ user.name }} ({{ user.username }})` |
| saveUser 호출 | `email: userData.email` | `username: userData.username` |

### 3.7 UserFormModal (`components/admin/UserFormModal.vue`)

| 요소 | Before | After |
|------|--------|-------|
| label | `이메일 *` | `사용자명 *` |
| input type | `email` | `text` |
| placeholder | `user@example.com` | `영문 소문자로 시작 (예: farmer01)` |
| v-model | `formData.email` | `formData.username` |
| UserFormData interface | `email: string` | `username: string` |
| farmAdmins interface | `email: string` | `username: string` |
| farmAdmins select | `{{ admin.name }} ({{ admin.email }})` | `{{ admin.name }} ({{ admin.username }})` |
| 초기값 | `email: ''` | `username: ''` |
| 유효성 검증 추가 | 없음 | `pattern="^[a-z][a-z0-9_-]{2,49}$"`, minlength="3", maxlength="50" |

---

## 4. 구현 순서 (의존성 기반)

```
1. migration SQL 작성 (DB 스키마 변경)
   ↓
2. Backend entity/dto 수정 (email → username 프로퍼티)
   ↓
3. Backend service 수정 (조회/생성 로직, JWT payload)
   ↓
4. Frontend types 수정 (User, LoginRequest)
   ↓
5. Frontend api/store 수정 (auth.api, user.api, auth.store)
   ↓
6. Frontend views/components 수정 (Login, UserManagement, UserFormModal)
   ↓
7. schema.sql, seed-local.sql 업데이트
```

## 5. 수정 파일 체크리스트

### Backend (9개 파일)
- [ ] `backend/database/migration-003-email-to-username.sql` (신규)
- [ ] `backend/database/schema.sql`
- [ ] `backend/database/seed-local.sql`
- [ ] `backend/src/modules/users/entities/user.entity.ts`
- [ ] `backend/src/modules/users/dto/user.dto.ts`
- [ ] `backend/src/modules/users/users.service.ts`
- [ ] `backend/src/modules/auth/dto/login.dto.ts`
- [ ] `backend/src/modules/auth/auth.service.ts`
- [ ] `backend/src/modules/auth/strategies/jwt.strategy.ts`

### Frontend (7개 파일)
- [ ] `frontend/src/types/auth.types.ts`
- [ ] `frontend/src/api/auth.api.ts`
- [ ] `frontend/src/api/user.api.ts`
- [ ] `frontend/src/stores/auth.store.ts`
- [ ] `frontend/src/views/Login.vue`
- [ ] `frontend/src/views/UserManagement.vue`
- [ ] `frontend/src/components/admin/UserFormModal.vue`

## 6. Username 유효성 규칙 (공통)

| 규칙 | 값 |
|------|---|
| 최소 길이 | 3자 |
| 최대 길이 | 50자 |
| 허용 문자 | 영문 소문자로 시작, `[a-z0-9_-]` |
| 대소문자 | DB 저장 시 소문자 변환 |
| 중복 | UNIQUE 제약조건 |
| 정규식 | `/^[a-z][a-z0-9_-]{2,49}$/` |
