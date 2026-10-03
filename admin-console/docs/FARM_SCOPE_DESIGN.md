# 농장 컨텍스트(Farm Scope) 설계 · API 계약서

> 작업 1 산출물. 백엔드 브랜치 `feat/farm-context-scope` (worktree `../smart-farm-mqtt-farmscope`).
> **작업 2(관리자 콘솔)는 이 문서를 계약서로 사용한다.** 문서와 구현이 다르면 구현(테스트)이 기준이며 이 문서를 고친다.

## 1. 한 줄 요약
플랫폼 관리자(`role=admin`)가 HTTP 요청에 `X-Farm-Context: <농장관리자 userId>` 를 붙이면, 백엔드는 그 요청을 **그 농장 관리자로 로그인한 것과 똑같이** 처리한다.
헤더가 없으면 지금과 100% 동일하다(기존 앱·모바일 앱·RPi agent 는 헤더를 보내지 않음 → 영향 0).

## 2. HTTP 계약

### 2-1. 요청 헤더
| 항목 | 값 |
|---|---|
| 이름 | `X-Farm-Context` (대소문자 무관) |
| 값 | 대상 **농장 관리자(farm_admin)** 의 user id (UUID) |
| 빈 값/공백 | 헤더가 없는 것과 동일하게 처리 |
| 적용 대상 | 인증된 HTTP 요청(JwtAuthGuard 가 붙은 라우트). WebSocket 에는 적용 안 됨(§4 별도) |
| 공개 라우트 | `/api/auth/login`, `/api/auth/refresh`, `/api/health`, RPi bootstrap 토큰 라우트 등 — 헤더를 **무시** (인증 주체가 없어 권한 상승 불가) |

### 2-2. 동작 결정표
| 요청자 | 라우트 구분 | 결과 |
|---|---|---|
| 헤더 없음 (모든 역할) | 모든 라우트 | **변경 전과 동일** (인터셉터 즉시 통과) |
| admin | 농장 라우트 (§3 FARM) | 대상 검증 후 `req.user` 를 농장 관리자로 교체 → 핸들러 실행. 응답 헤더 `X-Farm-Context-Applied: <farmId>` |
| admin | 플랫폼 라우트 (§3 PLATFORM) | 헤더 **무시**, 원래 admin 으로 실행. 응답 헤더 `X-Farm-Context-Applied: none` |
| farm_admin / farm_user | 인증된 모든 라우트(플랫폼 포함) | **403** `FARM_CONTEXT_FORBIDDEN` (무시하고 통과하지 않음 — 권한 상승 방지) |

### 2-3. 대상 검증 · 에러 코드
에러 본문은 기존 전역 필터 형식 그대로이고 `code` 필드만 추가된다:
`{ statusCode, message, code, timestamp, path }` — 콘솔은 `code` 로 분기한다.

| 상황 | HTTP | `code` |
|---|---|---|
| 비관리자가 헤더 전송 | 403 | `FARM_CONTEXT_FORBIDDEN` |
| UUID 형식 아님 | 400 | `FARM_CONTEXT_INVALID` |
| 해당 id 사용자 없음 | 404 | `FARM_CONTEXT_NOT_FOUND` |
| 대상이 farm_admin 이 아님 (admin·farm_user 등) | 400 | `FARM_CONTEXT_NOT_FARM_ADMIN` |
| 대상 farm_admin 이 비활성(`status=inactive`) | 400 | `FARM_CONTEXT_INACTIVE` |

### 2-4. 교체되는 `req.user`
```ts
{
  id: '<farmAdminId>', username: '<farm username>', name: '<farm name>',
  role: 'farm_admin', parentUserId: null,
  farmContext: true, actingAdminId: '<real admin id>', actingAdminUsername: '<real admin username>'
}
```
- 컨트롤러·서비스의 `getEffectiveUserId(user)` 와 `role === 'admin'` 분기가 **수정 없이** 농장 범위로 동작한다.
- 원래 사용자는 `req.realUser` 로 보존되고, 요청 처리 중 `AsyncLocalStorage`(`farmContextStorage`)로도 조회할 수 있다(감사 로그용).
- 농장 컨텍스트에서 관리자 전용 능력(다른 농장용 `targetUserId`, 소유권 이동 등)은 의도적으로 사라진다 → 선택한 농장 밖을 실수로 건드릴 수 없다.

## 3. 라우트 분류 (조사 결과 요약)
전수 조사(26개 컨트롤러, 전체 라우트)는 §7. 여기서는 결론만 정리한다.

**PLATFORM 판정 규칙 (위에서부터 적용)**
1. 라우트의 `@Roles` 에 `farm_admin` 이 없으면(=admin 전용) **자동으로 PLATFORM**. 예: `/users/*`, config-deploy 의 admin 전용 라우트, fallback heartbeat, gateway-env pin/zigbee test.
2. `@PlatformScope()` 데코레이터가 붙은 컨트롤러/핸들러:

| 대상 | 이유 |
|---|---|
| `AuthController` 전체 (`/auth/me`, `/auth/logout`) | 로그인한 본인 정보·세션 |
| `UsersController` 전체 (`/users/me` 포함) | 본인 프로필·비밀번호 변경이 농장주 계정에 적용되는 것 방지 |
| `NotificationsController` 전체 | 관리자 폰 푸시 토큰이 농장주에게 등록되는 것 방지 |
| `ConfigDeployController` 전체 | 플랫폼 운영 기능(설정 배포) |
| `FallbackConfigController` 전체 | 플랫폼 운영 기능(이머전시 페일오버) |
| `PATCH /features/:feature`, `GET /features/users/:id`, `PATCH /features/:feature/users/:id` | 플랫폼 범위 플래그·사용자별 권한 관리 (핸들러 내부 admin 검사 → 교체 시 403 되는 문제 방지) |
| `PATCH /crop-management/feature`, `PATCH /crop-management/feature/users/:id`, `GET /crop-management/feature/all`, `POST /crop-management/climate-normals/refresh` | 동일 (핸들러 내부 admin 검사) |
| `GET /worker-payroll/me` | 본인 정보 |
| `POST /gateways`, `PUT /gateways/:id`, `DELETE /gateways/:id`, `PATCH /gateways/:id/zone` | 게이트웨이 등록·소유자 변경·구역 할당(농장 간 이동) = 플랫폼 관리 |

3. 그 외 인증 라우트는 **FARM** — groups, devices, gateways 조회·permit-join·restart, automation, dashboard, sensors, sensor-alerts, reports, activity-logs, spray-schedule, worker-payroll(me 제외), work-log, crop-management(위 제외), zone-notes, env-config, gateway-env(테스트 제외), gpio, voice, `GET /features`(농장 기준 메뉴 플래그).

## 4. Socket.io 계약 (옵트인)
기존 클라이언트 동작은 변하지 않는다. admin 소켓이 아래 이벤트를 보낼 때만 동작한다.

| 방향 | 이벤트 | 페이로드 | 설명 |
|---|---|---|---|
| C→S | `subscribe:farm` | `{ farmId: string }` | 기존 `useWebSocket().subscribe('farm', farmId)` 로 그대로 보낼 수 있는 형식 |
| C→S | `unsubscribe` | `{ channel: 'farm' }` | 기존 `useWebSocket().unsubscribe('farm')` 형식. 농장 room 퇴장 + `admins` 재입장 |
| S→C | `farm:joined` | `{ farmId }` | 입장 성공 |
| S→C | `farm:left` | `{ farmId: string \| null }` | 퇴장 완료 |
| S→C | `farm:error` | `{ code, message }` | 실패 (code 는 §2-3 과 동일) |

- ack 콜백을 넘기면 위 S→C 페이로드와 같은 값으로 응답한다(`{ ok: true, farmId }` / `{ ok: false, code, message }`).
- 서버 동작: admin 검증 → 대상 농장 검증(§2-3) → 이전 농장 room 퇴장 → `admins` room 퇴장 → `user:<farmId>` room 입장.
  → 해당 농장 대상 이벤트(sensor:update, device:status, device:switch-update, automation:executed, gateway:status, notification:new, device:replaced, config:response:*)만 받는다.
- **비관리자**가 `subscribe:farm` → `farm:error FARM_CONTEXT_FORBIDDEN`, room 변화 없음.
- `server.emit` 으로 **전체 방송**되는 기존 이벤트(`irrigation:started/stopped`, `gpio:status`, `rain:override`, `high-temp:override`, `fallback:*`)는 원래부터 모든 클라이언트에게 가므로 이번 범위에서 바꾸지 않는다. 페이로드에 groupId/gatewayId 가 있어 클라이언트가 필요하면 걸러 쓸 수 있다.

## 5. 감사 추적
- 농장 컨텍스트에서 실행된 요청이 남기는 activity-log 는 `user_id` = 농장 관리자(농장 이력에 보이도록), `details` 에 아래 키가 자동 병합된다.
  ```json
  { "farmContext": true, "actingAdminId": "<실제 관리자 id>", "actingAdminUsername": "<실제 관리자 username>" }
  ```
- 병합 지점은 `ActivityLogService.log()` 한 곳(AsyncLocalStorage 로 요청 컨텍스트 조회). 호출부 수정 없음.
- **DB 스키마 변경 없음** — 기존 nullable `details jsonb` 컬럼을 사용한다. 마이그레이션이 필요 없고 배포 순서 위험도 없다.
  (컬럼 추가안은 기각: 코드가 마이그레이션보다 먼저 배포되면 INSERT 가 없는 컬럼을 참조해 activity-log 가 조용히 유실됨)

## 6. 위험 요소와 대응
| 위험 | 대응 |
|---|---|
| 권한 상승(비관리자가 헤더로 다른 농장 접근) | 비관리자 + 헤더 = 무조건 403 (플랫폼 라우트 포함). 테스트 (c) |
| 관리자 전용 기능 오동작(교체 후 핸들러 내부 admin 검사 403) | 해당 라우트를 `@PlatformScope()` 로 제외. 테스트로 확인 |
| 본인 정보가 농장주에게 적용(비밀번호·푸시 토큰) | auth/users/notifications/worker-payroll me 는 PLATFORM |
| 쓰기 귀속(createdBy·updatedBy 가 농장주로 기록) | 의도된 동작(데이터는 농장 소유). 실제 수행자는 activity-log `details.actingAdminId` 로 남음. zone-notes 의 작성자명 등은 농장주로 표시됨(§8 남은 위험) |
| 캐시 누수 | 사용자 키 메모리 캐시 없음(조사 확인) |
| 소켓 교차 수신 | admin 이 농장 room 입장 시 `admins` room 퇴장. 종료 시 재입장 |
| 헤더 없는 요청 회귀 | 인터셉터는 헤더 없으면 첫 줄에서 반환. 변경 전 코드로 만든 스냅샷 97건과 일치 검증 |
| HTTP 외 진입점(MQTT·스케줄러·자동화 러너·ssh-proxy) | `req.user` 를 쓰지 않음(DB 소유자 기준) → 영향 없음. 인터셉터는 `http` 컨텍스트에서만 동작 |

## 7. 전수 조사 표 (모듈 / 엔드포인트 / 현재 admin 동작 / farm context 기대 동작 / 플랫폼 여부)
> 모든 경로에 `/api` 접두사. 요약 표기: EUID = getEffectiveUserId. "합산" = admin 이면 전체 농장 데이터.

| 모듈 | 엔드포인트 | 현재 admin 동작 | farm context 기대 동작 | 분류 |
|---|---|---|---|---|
| auth | POST login/refresh/clear-cookie | 공개 | 헤더 무시 | PUBLIC |
| auth | GET me, POST logout | 본인 | 본인 유지 | PLATFORM(@) |
| users | GET/POST/PUT/DELETE /users, /users/:id, /users/farm-admins | admin 전용 | admin 유지 | PLATFORM(자동) |
| users | PUT /users/me | 본인 | 본인 유지 | PLATFORM(@) |
| activity-log | GET /activity-logs | 전체 로그 | 농장주 기록만 | FARM |
| automation | GET/POST/PUT/PATCH/DELETE /automation/** (17개) | EUID=null → 전체 / targetUserId·farmUserId 지원 | 농장 룰·로그만, 생성 시 농장 소유 | FARM |
| config-deploy | /config-deploy/** | admin(일부 farm_admin 허용) | admin 유지 | PLATFORM(@) |
| config-deploy | agent-archive, register-tunnel-key | 토큰 인증 | 무시 | PUBLIC |
| crop-management | batches/**, dashboard, offset-suggestions, climate-normals, milestones/master, GET feature | EUID(admin 본인) | 농장 기준 | FARM |
| crop-management | PATCH feature, PATCH feature/users/:id, GET feature/all, POST climate-normals/refresh | admin 전용(핸들러 검사) | admin 유지 | PLATFORM(@) |
| dashboard | GET weather, widgets | EUID(admin 본인) | 농장 기준 | FARM |
| devices | /devices/** (20개) | 합산 / 소유 무관 접근 | 농장 장치만 | FARM |
| env-config | /env-config/** | EUID=null → 모든 구역 | 농장 구역만 | FARM |
| fallback-config | /fallback-config/** | user 미사용 | admin 유지 | PLATFORM(@) |
| feature-flags | GET /features | 플랫폼+본인 범위 | 농장 범위(메뉴 플래그) | FARM |
| feature-flags | PATCH :feature, GET users/:id, PATCH :feature/users/:id | admin(핸들러 검사) | admin 유지 | PLATFORM(@) |
| gateway-env | /gateway-env/:gw/** (13개) | 소유 검사 우회 | 농장 게이트웨이만 | FARM |
| gateway-env | pin-test, zigbee-test | admin 전용 | admin 유지 | PLATFORM(자동) |
| gateway-manager | GET /gateways, zigbee-devices, permit-join, restart-service | 전체 | 농장 게이트웨이만 | FARM |
| gateway-manager | POST/PUT/DELETE /gateways, PATCH :id/zone | 소유자 지정·이동 | admin 유지 | PLATFORM(@) |
| tunnel-setup | /gateways/setup/**, tunnel-port, tunnel-key | 토큰 인증 | 무시 | PUBLIC |
| gpio | POST /gpio/:gw/relay | 소유 무관 | 농장 게이트웨이만 | FARM |
| groups | /groups/** (20개) | 합산(+ownerName), targetUserId 생성 | 농장 구역만, 생성 시 농장 소유 | FARM |
| health | /health, /health/live | 공개 | 무시 | PUBLIC |
| notifications | /notifications/** | 본인 | 본인 유지 | PLATFORM(@) |
| reports | /reports/** (5개) | EUID(admin 본인) | 농장 기준 | FARM |
| sensor-alerts | /sensor-alerts/** (8개) | EUID(admin 본인) | 농장 기준 | FARM |
| sensors | GET /sensor-data | EUID | 농장 기준 | FARM |
| sensors | GET /sensor-data/latest | 전체 농장 | 농장 기준 | FARM |
| spray-schedule | /spray-schedule/** (8개) | EUID | 농장 기준 | FARM |
| voice | POST /voice/command | EUID | 농장 기준 | FARM |
| work-log | /work-log/** (12개) | EUID | 농장 기준 | FARM |
| worker-payroll | /worker-payroll/** (me 제외 13개) | EUID | 농장 기준 | FARM |
| worker-payroll | GET /worker-payroll/me | 본인 | 본인 유지 | PLATFORM(@) |
| zone-notes | /zone-notes/** (5개) | EUID | 농장 기준 | FARM |

## 8. 남은 위험 · 범위 밖 (기존 동작, 이번에 바꾸지 않음)
- 전체 방송 소켓 이벤트(§4)는 농장 구분 없이 모든 클라이언트에 전달된다(기존 동작).
- `ssh-proxy` 의 `connect_shell` 은 게이트웨이 소유 검사를 하지 않는다(기존 동작, farm_admin 이 남의 게이트웨이 셸에 접근 가능) — 별도 보안 과제로 권장.
- farm_user 소켓은 부모 농장 room 에 들어가지 않아 농장 실시간 이벤트를 받지 못한다(기존 동작).
- `GET /activity-logs` 의 농장 범위는 "농장 관리자 본인이 남긴 기록"이다(소속 farm_user 의 기록은 기존에도 농장 관리자에게 안 보임).
- 농장 컨텍스트에서 만든 zone-notes·feature 설정의 작성자 표시는 농장 관리자다(실제 수행자는 activity-log 에만 남음).
