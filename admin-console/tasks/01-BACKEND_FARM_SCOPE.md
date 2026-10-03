# 작업 1 — 백엔드 "관리자 농장 컨텍스트(farm scope)" 추가

> 이 파일은 `admin-console/RUN_ALL.md` 에서 순서대로 호출됩니다. 단독 실행도 가능합니다.

## 목적
플랫폼 관리자(admin)가 특정 농장을 선택하면 모든 API 가 **그 농장 데이터만** 정확히 돌려주게 한다.
이후 만들 PC 관리자 콘솔(`admin-console/`, 작업 2)의 전제 작업이다.

## 현재 상황 (2026-10-03 분석)
- 각 컨트롤러가 `getEffectiveUserId(user)` (farm_user → parentUserId, 그 외 → user.id) 로 범위를 정한다. 컨트롤러마다 중복돼 있다.
- admin 은 서비스의 `role === 'admin'` 분기로 **전체 농장 데이터가 합쳐져** 반환된다. (예: gateway-manager.controller getAll, groups.service, devices.service.findAllByUser)
- 인증: `JwtStrategy.validate` → `req.user = { id, username, role, parentUserId }`, `@CurrentUser()` 가 `req.user` 를 읽음. 컨트롤러는 대부분 `@UseGuards(JwtAuthGuard, RolesGuard)`.

## 설계 원칙 (더 나은 방법이 있으면 계획 단계에서 근거와 함께 제안하되, 아래 원칙은 유지)
1. **옵트인**: 요청 헤더 `X-Farm-Context: <농장관리자 userId>` 가 있을 때만 동작. **헤더가 없으면 지금과 100% 동일.** 기존 frontend·모바일 앱·라즈베리파이 agent 는 이 헤더를 보내지 않는다.
2. **단일 지점**: 전역 인터셉터(또는 동등한 단일 지점)에서 처리. 컨트롤러별 산발 수정 최소화.
   - `req.user.role === 'admin'` + 헤더 → 대상이 존재·`role=farm_admin`·`status=active` 인지 검증 → `req.user` 를
     `{ id: 대상id, role: 'farm_admin', parentUserId: null, actingAdminId, actingAdminName, farmContext: true }` 로 교체
   - 대상이 없거나 farm_admin 이 아니면 400/404
   - **admin 이 아닌 사용자가 헤더를 보내면 403** (무시하고 통과 금지 — 권한 상승 방지)
   - guard → interceptor 실행 순서를 실제로 확인. 플랫폼 전용 엔드포인트(`/users`, `/config-deploy`, `/fallback-config`, `/gateways` 관리 등)는 헤더가 있어도 원래 admin 으로 동작하도록 `@PlatformScope()` 같은 데코레이터로 예외 처리. 어떤 엔드포인트를 플랫폼 전용으로 볼지는 조사 표로 근거를 남길 것.
3. **감사 추적**: farm context 로 실행된 모든 쓰기 동작은 activity-log 에 실제 수행자(`actingAdminId`)가 남아야 한다. 컬럼 추가가 필요하면 **nullable 컬럼 추가만** 허용.
4. **Socket.io**: `backend/src/modules/gateway/events.gateway.ts` 의 room 구조 분석 → admin 소켓이 특정 농장 이벤트만 받는 **옵트인** 방식 추가(예: handshake `auth.farmContext` 또는 `farm:join`/`farm:leave`). 기존 클라이언트 동작 불변. farm_admin/farm_user 가 다른 농장 room 에 join 하려 하면 거부.
5. HTTP 외 진입점(ssh-proxy, voice, 스케줄러, MQTT 핸들러, automation runner)은 `req.user` 를 쓰지 않으므로 영향 없음을 **확인만**.

## 절대 규칙
- **git worktree 로 격리해서 작업**: `git worktree add ../smart-farm-mqtt-farmscope -b feat/farm-context-scope` 후 그 폴더에서만 작업. 메인 작업 폴더(`~/Projects/smart-farm-mqtt`)의 `backend/` 파일은 건드리지 않는다. (메인 폴더에서 watch 모드 백엔드가 돌고 있을 수 있음)
- **헤더 없는 모든 요청의 동작은 바뀌면 안 된다.** 기존 앱·모바일 앱·RPi agent 영향 0.
- 기존 frontend(:5174) 의 화면·동작 변경 금지. 특히 플랫폼 관리자로 로그인했을 때 아래 화면은 지금처럼 **모든 농장 데이터가 합쳐진 상태**여야 한다:
  구역 관리(`/groups` — 모든 농장 구역 한 번에 표시), 우리 농장(`/dashboard`), 자동 제어(`/automation`), 방재 일정, 일꾼 관리, 게이트웨이(`/gateways`), 농장 관리(`/admin/farms`).
  농장 관리자·농장 사용자 계정의 응답도 변경 전과 동일해야 한다. → 회귀 테스트로 증명.
- `frontend/` 수정 금지 (이번 작업은 백엔드 전용).
- DB: nullable 컬럼 추가만. 기존 컬럼 변경·삭제 금지. 마이그레이션 SQL 은 `backend/database/migrations/` (또는 기존 관례 위치)에 **파일로만 작성, 실행 금지**.
- **worktree 의 백엔드를 실제 DB·MQTT 에 연결해 기동하지 않는다.** (개발 모드는 TypeORM `synchronize: true` 라 실제 DB 스키마가 바뀌고, automation runner/스케줄러가 실제 장치를 중복 제어할 수 있음) → 테스트는 mock/테스트 DB·트랜잭션 롤백 기반 e2e 로만.
- 운영 서버(맥미니) 배포, `docker compose build/up/restart` 금지.
- 실데이터 변경 테스트(장치 제어, 설정 배포, 비상 정지 등) 금지.
- push 금지. 커밋은 worktree 의 `feat/farm-context-scope` 브랜치에만.

## 진행 순서
1. **조사 & 계획** (코드 변경 없음)
   - `backend/src/modules/**` 에서 `getEffectiveUserId`, `role === 'admin'`, `@CurrentUser`, `@Roles('admin')` 사용처 전수 조사
   - 표: 모듈 / 엔드포인트 / 현재 admin 동작 / farm context 기대 동작 / 플랫폼 전용 여부
   - 위험 요소(권한 상승, 관리자 전용 기능 오동작, 쓰기 귀속 createdBy, 캐시, 소켓)와 대응안
   - 결과를 `admin-console/docs/FARM_SCOPE_DESIGN.md` 로 저장 (메인 폴더의 admin-console 에 저장해도 됨 — admin-console 은 신규 폴더라 서비스 영향 없음)
2. **테스트 먼저** — 기존 테스트 구조(`tests/`, `backend/test` 등) 확인 후
   - a) 헤더 없는 admin 요청: 변경 전과 응답 동일 (주요 GET 엔드포인트 스냅샷)
   - b) admin + 유효 헤더: groups, devices, gateways, automation, dashboard, sensors, sensor-alerts, reports, activity-log, spray-schedule, worker-payroll, work-log, crop-management 가 해당 농장 데이터만 반환
   - c) farm_admin / farm_user 가 헤더 전송 → 403
   - d) 존재하지 않는 id / farm_user id / admin id 를 헤더로 → 400/404
   - e) farm context 쓰기 → activity-log 에 actingAdminId 기록
   - f) farm_admin / farm_user 계정 응답이 변경 전과 동일
   - g) 소켓: admin 이 farm room join 시 해당 농장 이벤트만 수신, 비관리자 join 거부
3. **구현** (인터셉터 / 데코레이터 / 소켓 / 감사 로그 / 마이그레이션 파일)
4. **검증**: `npm run build`, lint, 전체 테스트 통과
5. **문서화**
   - worktree 의 `CLAUDE.md` "Auth & Roles" 아래에 사용법·헤더 규칙·플랫폼 전용 엔드포인트 목록·롤백 방법 추가
   - `admin-console/docs/FARM_SCOPE_DESIGN.md` 에 최종 API 계약(헤더 이름, 에러 코드, 소켓 이벤트 이름·페이로드) 확정본 기록 → **작업 2(콘솔)가 이 문서를 계약서로 사용**

## 완료 보고 (`admin-console/docs/FARM_SCOPE_REPORT.md` 로도 저장)
변경 파일 목록, 조사 표, 테스트 결과, 남은 위험, 운영 배포 절차(마이그레이션 포함, 사용자가 직접 실행할 명령), 롤백 방법(git revert + 추가 컬럼은 남겨도 무해한지).
