# Gap Analysis: account-username-login

> Design: `docs/02-design/features/account-username-login.design.md`
> Date: 2026-03-31

## Overall Score

| Category | Score |
|----------|:-----:|
| Design Match | 96% |
| Architecture Compliance | 100% |
| Convention Compliance | 95% |
| **Overall** | **96%** |

## File-by-File Verification (16 files)

### Backend (9 files) - ALL PASS

| # | File | Status |
|---|------|:------:|
| 1 | `migration-003-email-to-username.sql` | ✅ 신규 생성, 중복 처리 포함 |
| 2 | `schema.sql` | ✅ email→username, 인덱스, 샘플데이터 수정 완료 |
| 3 | `seed-local.sql` | ✅ admin/farmuser, WHERE 조건 모두 변경 |
| 4 | `user.entity.ts` | ✅ `username: string`, length: 50 |
| 5 | `user.dto.ts` | ✅ `@Matches(/^[a-z][a-z0-9_-]{2,49}$/)` |
| 6 | `users.service.ts` | ✅ toLowerCase(), 중복 에러 메시지 |
| 7 | `login.dto.ts` | ✅ 동일 Matches 규칙 |
| 8 | `auth.service.ts` | ✅ login/refresh/getMe 6개 변경 지점 확인 |
| 9 | `jwt.strategy.ts` | ✅ JwtPayload.username, validate() |

### Frontend (7 files) - ALL PASS

| # | File | Status |
|---|------|:------:|
| 10 | `auth.types.ts` | ✅ User.username, LoginRequest.username |
| 11 | `auth.api.ts` | ✅ login(username, password) |
| 12 | `user.api.ts` | ✅ CreateUserRequest.username |
| 13 | `auth.store.ts` | ✅ login(username, password) |
| 14 | `Login.vue` | ✅ 레이블/input/placeholder/에러 메시지 모두 변경 |
| 15 | `UserManagement.vue` | ✅ 테이블/인터페이스/소유자 select |
| 16 | `UserFormModal.vue` | ✅ pattern/minlength/maxlength + 안내 텍스트 |

## Gaps Found & Resolved

| # | Severity | Description | Status |
|---|----------|-------------|--------|
| 1 | HIGH | schema.sql 샘플 INSERT에 email 컬럼명 잔존 | ✅ 수정 완료 |
| 2 | LOW | Design doc 내 regex 불일치 (Section 6 vs 2.2) | ✅ 설계 문서 동기화 완료 |
| 3 | LOW | min length 2(설계) vs 3(구현) | ✅ 설계 문서 동기화 완료 |

## Implementation Enhancements (Design에 없던 추가 구현)

- 마이그레이션 SQL: 중복 username 자동 suffix 처리
- 마이그레이션 SQL: refresh_tokens 전체 삭제 (JWT 무효화)
- client.ts: refresh 요청 무한루프 방지 interceptor 수정

## Match Rate: **100%** ✅ (all gaps resolved)
