# Plan: role-based-access

> 3-Tier 역할 기반 접근 제어 (RBAC) 구현

## 1. 개요

현재 시스템은 `admin`/`user` 2-tier 역할만 존재. 이를 **플랫폼 관리자 / 농장 관리자 / 농장 사용자** 3-tier로 확장하여 메뉴 접근 제어, 사용자 등록 플로우, 데이터 격리를 구현한다.

### 현재 상태 (AS-IS)
| 역할 | DB값 | 메뉴 접근 |
|------|------|----------|
| 관리자 | `admin` | 전체 메뉴 + 사용자 관리 |
| 사용자 | `user` | 사용자 관리 제외 전체 |

### 목표 상태 (TO-BE)
| 역할 | DB값 | 메뉴 접근 | 설명 |
|------|------|----------|------|
| 플랫폼 관리자 | `admin` | 전체 메뉴 | 기존 admin 유지 |
| 농장 관리자 | `farm_admin` | 사용자 관리 제외 전체 | Tuya 연동 포함, 장비/그룹/자동화 관리 |
| 농장 사용자 | `farm_user` | 대시보드, 그룹관리, 센서 모니터링, 리포트 | 읽기 위주, 팜 관리자가 설정한 정보 참조 |

## 2. 요구사항 (Functional Requirements)

### FR-01: 역할 체계 확장 (DB + Backend)
- users 테이블 role 컬럼 CHECK 제약 조건: `('admin', 'user')` → `('admin', 'farm_admin', 'farm_user')`
- User entity, DTO, JwtPayload 타입 업데이트
- RolesGuard 3-tier 지원 확인

### FR-02: 메뉴 접근 제어 (Frontend)
- **플랫폼 관리자 (admin)**: 기존 유지 — 전체 메뉴 접근
- **농장 관리자 (farm_admin)**: 사용자 관리 메뉴 숨김
- **농장 사용자 (farm_user)**: 장비 관리, 자동화 룰, 사용자 관리 메뉴 숨김
- auth.store.ts: `isAdmin`, `isFarmAdmin`, `isFarmUser` computed 추가
- App.vue 사이드바/모바일 메뉴 조건부 렌더링
- router guard: farm_user 접근 불가 라우트 리다이렉트

### FR-03: 사용자 등록 폼 수정 (UserFormModal)
- 역할 선택: `관리자(admin)` / `팜 관리자(farm_admin)` / `팜 사용자(farm_user)` 3개 옵션
- **팜 사용자 선택 시**: 기존 농장 관리자 목록을 가져와 소속 팜(farm_admin의 user_id) 선택 UI 표시
- **팜 사용자 선택 시**: Tuya Cloud 연동 섹션 숨김 (팜 관리자의 Tuya 프로젝트를 공유)
- **팜 관리자 선택 시**: 기존과 동일하게 Tuya 연동 포함

### FR-04: 농장 사용자의 데이터 연동
- 농장 사용자는 소속 팜 관리자의 데이터(그룹, 장비, 센서, 자동화룰)를 공유 참조
- users 테이블에 `parent_user_id` 컬럼 추가 (farm_user → farm_admin 연결)
- 백엔드: farm_user의 API 요청 시 `parent_user_id`의 데이터를 조회하도록 로직 추가
- farm_user가 볼 수 있는 화면: 대시보드(읽기), 센서 모니터링(읽기), 리포트(읽기)

### FR-05: 기존 계정 마이그레이션
- `admin@farm.com`: `admin` 유지 (플랫폼 관리자)
- `test@farm.com`, `user@farm.com`: `user` → `farm_admin` 변경
- SQL 마이그레이션 스크립트 작성

## 3. 영향 범위 분석

### Backend 변경 파일
| 파일 | 변경 내용 |
|------|----------|
| `database/schema.sql` | role CHECK 제약 조건 + `parent_user_id` 컬럼 |
| `database/seed-local.sql` | role CHECK + 계정 role 업데이트 |
| `src/modules/users/entities/user.entity.ts` | role 타입 + parentUserId 필드 |
| `src/modules/users/dto/user.dto.ts` | CreateUserDto/UpdateUserDto role 타입 확장 |
| `src/modules/auth/strategies/jwt.strategy.ts` | JwtPayload role 타입 |
| `src/common/guards/roles.guard.ts` | 3-tier 역할 검증 (변경 없을 수 있음) |
| `src/modules/users/users.service.ts` | farm_user 생성 시 parent_user_id 설정 + 팜 관리자 목록 API |
| `src/modules/users/users.controller.ts` | 팜 관리자 목록 엔드포인트 추가 |
| `src/modules/dashboard/dashboard.service.ts` | farm_user → parent_user_id 데이터 조회 |
| `src/modules/sensors/sensors.service.ts` | farm_user → parent_user_id 데이터 조회 |
| `src/modules/groups/groups.service.ts` | farm_user → parent_user_id 데이터 조회 |
| `src/modules/reports/reports.service.ts` | farm_user → parent_user_id 데이터 조회 |

### Frontend 변경 파일
| 파일 | 변경 내용 |
|------|----------|
| `src/types/auth.types.ts` | User 인터페이스 role 타입 + parentUserId |
| `src/stores/auth.store.ts` | isFarmAdmin, isFarmUser computed 추가 |
| `src/router/index.ts` | farm_user 접근 불가 라우트 가드 |
| `src/App.vue` | 사이드바 메뉴 조건부 렌더링 |
| `src/components/common/MoreMenu.vue` | 모바일 메뉴 조건부 렌더링 |
| `src/components/admin/UserFormModal.vue` | 역할 3개 선택 + 팜 선택 UI |
| `src/views/UserManagement.vue` | 역할 뱃지 3종 표시 |
| `src/api/user.api.ts` | 팜 관리자 목록 API 추가 |

## 4. 구현 순서

### Phase 1: DB + Entity 변경 (FR-01, FR-04)
- schema.sql: role CHECK 확장 + parent_user_id 컬럼
- seed-local.sql: role 값 업데이트 + CHECK 확장
- user.entity.ts: role 타입 + parentUserId 필드
- user.dto.ts: 역할 + parentUserId 지원
- jwt.strategy.ts: JwtPayload 타입 업데이트

### Phase 2: Backend API 확장 (FR-04)
- users.service.ts: 팜 관리자 목록 조회 + farm_user 생성 로직
- users.controller.ts: `GET /users/farm-admins` 엔드포인트
- 각 서비스: farm_user의 parent_user_id 기반 데이터 조회 로직

### Phase 3: Frontend 권한 시스템 (FR-02)
- auth.types.ts: role 타입 확장
- auth.store.ts: isFarmAdmin, isFarmUser computed
- router/index.ts: farm_user 접근 제한 라우트
- App.vue: 사이드바 메뉴 조건부 렌더링
- MoreMenu.vue: 모바일 메뉴 조건부 렌더링

### Phase 4: 사용자 등록 폼 (FR-03)
- UserFormModal.vue: 역할 3개 선택 + 팜 관리자 선택 UI
- user.api.ts: 팜 관리자 목록 API 연동
- UserManagement.vue: 역할 뱃지 3종 표시 + parent_user 표시

### Phase 5: 계정 마이그레이션 + 빌드 검증 (FR-05)
- SQL 마이그레이션 스크립트 작성
- 프론트엔드 / 백엔드 빌드 검증

## 5. 비기능 요구사항

- **하위 호환성**: 기존 `admin`/`user` 역할의 JWT 토큰이 만료 전까지 정상 동작해야 함
- **보안**: farm_user가 권한 밖 API에 접근 시 403 반환
- **데이터 격리**: farm_user는 자신의 parent_user_id 데이터만 접근 가능

## 6. 제외 사항

- farm_user의 개별 설정 (알림, 대시보드 레이아웃) — 향후 확장
- 다중 팜 관리자 소속 — 현재는 1:1 관계만 지원
- farm_user의 데이터 수정 권한 세분화 — 현재는 읽기 전용
