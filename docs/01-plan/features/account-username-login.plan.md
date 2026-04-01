# Plan: 계정 형식 변경 (Email → Username)

## 개요

현재 이메일 형식(`test@farm.com`)으로 로그인하는 계정 체계를
일반 사용자명 형식(`test`)으로 변경한다.

## 목표

1. 기존 이메일 계정을 username 형식으로 마이그레이션 (예: `admin@farm.com` → `admin`)
2. 신규 계정 생성 시 username 형식으로 입력
3. 로그인 시 username + password 방식

## 현재 상태 분석

### 영향 범위

**Backend (수정 대상 파일)**
| 파일 | 변경 내용 |
|------|----------|
| `database/schema.sql` | users 테이블 `email` → `username` 컬럼명 변경 |
| `database/seed-local.sql` | 시드 데이터 이메일 → 사용자명 |
| `modules/users/entities/user.entity.ts` | email 프로퍼티 → username |
| `modules/users/dto/user.dto.ts` | CreateUserDto email → username, @IsEmail 제거 |
| `modules/auth/dto/login.dto.ts` | email → username, @IsEmail → @IsString |
| `modules/auth/auth.service.ts` | login에서 email → username 조회, JWT payload email → username, getMe 응답 |
| `modules/auth/strategies/jwt.strategy.ts` | JwtPayload 인터페이스 email → username |
| `modules/users/users.service.ts` | email 중복체크 → username 중복체크 |
| `modules/users/users.controller.ts` | 응답 필드명 email → username |

**Frontend (수정 대상 파일)**
| 파일 | 변경 내용 |
|------|----------|
| `types/auth.types.ts` | User 인터페이스 email → username |
| `api/auth.api.ts` | login 파라미터 email → username |
| `api/user.api.ts` | create/update 파라미터 email → username |
| `stores/auth.store.ts` | user 상태 email → username |
| `views/Login.vue` | 이메일 입력 → 사용자명 입력, 레이블/placeholder 변경 |
| `views/UserManagement.vue` | 테이블 컬럼, 생성/수정 폼 email → username |
| `components/admin/UserFormModal.vue` | 이메일 입력 → 사용자명 입력, 유효성 검증 변경 |

**DB 마이그레이션**
| 작업 | 내용 |
|------|------|
| 컬럼 변경 | `email` → `username`, @부분 제거 |
| 인덱스 변경 | `idx_users_email` → `idx_users_username` |
| 기존 데이터 | `admin@farm.com` → `admin`, `user@farm.com` → `user` |

## 유효성 검증 규칙 (username)

- 최소 2자, 최대 50자
- 영문, 숫자, 언더스코어(`_`), 하이픈(`-`) 허용
- 공백 불허
- 대소문자 구분 없음 (DB 저장 시 소문자 변환)
- UNIQUE 제약조건 유지

## 제약 사항

- JWT 토큰 내 `email` 필드가 `username`으로 변경되므로, 배포 시 기존 JWT 토큰이 무효화됨 → 전체 사용자 재로그인 필요
- refresh_tokens 테이블의 기존 토큰은 그대로 유지 (userId 기반이므로 영향 없음)

## 구현 순서

1. DB 마이그레이션 SQL 작성
2. Backend entity/dto/service 수정
3. Frontend types/api/store/views 수정
4. seed 데이터 업데이트
5. 테스트 및 검증
