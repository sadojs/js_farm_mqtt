# Smart Farm MQTT Platform

Zigbee2MQTT 기반 스마트팜 모니터링/제어 플랫폼.
Raspberry Pi(Zigbee 게이트웨이) → MQTT Broker → NestJS Backend → Vue 3 Frontend.

> **배포 절차**: 같은 맥미니에 `smartfarm` 서비스와 함께 호스팅. 통합 배포 가이드는
> `/Users/jeongseok/Projects/smart-farm-platform/CLAUDE.md` "프로덕션 서버" 섹션 참조.
> 사용자 요청: `smartfarm_mqtt pull 배포 빌드` → 한 번에 완료.

## Tech Stack

- **Backend:** NestJS 10 + TypeORM 0.3 + TypeScript 5.3
- **Frontend:** Vue 3 + Pinia + Vue Router + Vite 7 + TypeScript
- **DB:** PostgreSQL 15 + TimescaleDB (sensor_data는 hypertable)
- **Cache/Queue:** Redis 7 + Bull
- **Broker:** Eclipse Mosquitto 2
- **Zigbee:** Zigbee2MQTT (koenkk/zigbee2mqtt)
- **Auth:** JWT (passport-jwt) + bcrypt, refresh token DB 저장, username 로그인 (email 아님)
- **Realtime:** Socket.io (backend gateway → frontend composable)
- **Charts:** Chart.js + vue-chartjs

## Docker Services

| Service | Port | Image |
|---------|------|-------|
| postgres | 5433:5432 | timescale/timescaledb:latest-pg15 |
| redis | 6380:6379 | redis:7-alpine |
| mosquitto | 1883, 9001 | eclipse-mosquitto:2 |
| zigbee2mqtt | 8080 | koenkk/zigbee2mqtt |
| backend | 3100 | custom NestJS |
| frontend | 81:80 | custom Vue + nginx |

## MQTT Topics

```
farm/{gatewayId}/z2m/{friendlyName}          # 센서 데이터 수신
farm/{gatewayId}/z2m/{friendlyName}/set      # 디바이스 제어 발행
farm/{gatewayId}/z2m/{friendlyName}/availability  # 온라인/오프라인
farm/{gatewayId}/z2m/bridge/state            # 브릿지 상태
farm/{gatewayId}/z2m/bridge/devices          # 페어링된 디바이스 목록
farm/{gatewayId}/config/request              # 원격 설정 배포 요청
farm/{gatewayId}/config/response             # 설정 배포 응답
```

## Backend Structure

```
backend/src/
├── common/          # guards, filters, decorators
├── modules/
│   ├── auth/        # JWT 인증, login/signup, refresh
│   ├── users/       # 사용자 관리 (admin/farm_admin/farm_user)
│   ├── devices/     # Zigbee 디바이스 CRUD, 채널매핑
│   ├── sensors/     # 센서 데이터 조회 (TimescaleDB)
│   ├── mqtt/        # MQTT 클라이언트, 메시지 라우팅
│   ├── gateway/     # Socket.io WebSocket 게이트웨이
│   ├── gateway-manager/  # Raspberry Pi 게이트웨이 관리
│   ├── groups/      # 하우스/하우스그룹 관리
│   ├── automation/  # 자동화 규칙 엔진 (weather/time/hybrid)
│   ├── weather/     # OpenWeather + 기상청 API
│   ├── env-config/  # 환경 센서 매핑/역할 설정
│   ├── sensor-alerts/ # 센서 임계값 알림
│   ├── dashboard/   # 대시보드 집계
│   ├── reports/     # 통계 리포트
│   ├── config-deploy/ # 원격 Zigbee2MQTT 설정 배포
│   ├── health/      # 헬스체크
│   ├── integrations/ # 외부 API 연동
│   └── notifications/ # 알림 프레임워크
└── main.ts          # Bootstrap (port 3100)
```

### Backend Conventions

- 모듈 구조: `{name}.module.ts`, `{name}.service.ts`, `{name}.controller.ts`
- 엔티티: `entities/{name}.entity.ts` (TypeORM, UUID PK)
- DTO: `dto/create-{name}.dto.ts`, `dto/update-{name}.dto.ts`
- CRUD 메서드: `findAll()`, `findOne()`, `create()`, `update()`, `remove()`
- Role guard: `@Roles('admin')`, `@UseGuards(JwtAuthGuard, RolesGuard)`
- 현재 사용자: `@CurrentUser() user`

### Channel Mapping (8-switch controller)

```
remote_control → switch_1    zone_1 → switch_2    zone_2 → switch_3
zone_3 → switch_4    zone_4 → switch_5    fertilizer_b_contact → switch_6
mixer → switch_usb1    fertilizer_motor → switch_usb2
```

## Frontend Structure

```
frontend/src/
├── api/             # Axios 클라이언트 (client.ts + 기능별 .api.ts)
├── views/           # Dashboard, Sensors, Devices, Groups, Automation,
│                    # Alerts, Reports, UserManagement, ConfigDeploy, Login
├── components/      # 기능별 폴더 (dashboard/, devices/, groups/, automation/, common/)
├── stores/          # Pinia (auth, device, sensor, group, automation, notification)
├── composables/     # useAuth, useConfirm, useWebSocket, useDashboardLayout, useNotification
├── types/           # {feature}.types.ts
├── utils/           # 유틸리티 함수
├── router/          # Vue Router (requiresAuth, requiresAdmin, denyFarmUser)
└── main.ts          # Entry point
```

### Frontend Conventions

- View: `{Name}.vue` (PascalCase)
- Component: `{ComponentName}.vue` (PascalCase)
- Store: `{feature}.store.ts`
- API: `{feature}.api.ts`
- Composable: `use{Feature}.ts`
- Type: `{feature}.types.ts`

## API Response Patterns

```typescript
// List: { data: T[], pagination: { page, limit, total, totalPages } }
// Single: { id, ...fields }
// Error: { statusCode, message, error }
```

## Auth & Roles

- 3 roles: `admin`, `farm_admin`, `farm_user`
- JWT in localStorage, Authorization header
- Refresh token in DB with expiration
- Guards: JwtAuthGuard, RolesGuard

### 관리자 농장 컨텍스트 (`X-Farm-Context`, 옵트인)

- 플랫폼 관리자(`admin`)가 요청 헤더 `X-Farm-Context: <farm_admin userId>` 를 보내면 그 요청은 **그 농장 관리자로 로그인한 것과 동일**하게 처리된다(전역 인터셉터 `backend/src/common/farm-context/`). 관리자 콘솔(`admin-console/`)의 "농장 보기"가 사용한다.
- **헤더가 없으면 기존과 100% 동일** — 기존 frontend·모바일 앱·RPi agent 는 헤더를 보내지 않는다.
- 규칙: 비관리자+헤더 → 403 `FARM_CONTEXT_FORBIDDEN` / 잘못된 대상 → 400 `FARM_CONTEXT_INVALID`·`FARM_CONTEXT_NOT_FARM_ADMIN`·`FARM_CONTEXT_INACTIVE`, 404 `FARM_CONTEXT_NOT_FOUND` / 공개 라우트는 헤더 무시 / 적용 시 응답 헤더 `X-Farm-Context-Applied: <farmId>`(플랫폼 라우트는 `none`).
- **플랫폼 전용 라우트**(헤더가 있어도 원래 admin 으로 실행): `@Roles` 에 `farm_admin` 이 없는 라우트(자동) + `@PlatformScope()` 표시 — auth·users·notifications·config-deploy·fallback-config 전체, `PATCH /features/:feature`, `GET /features/users/:id`, `PATCH /features/:feature/users/:id`, crop-management 의 `feature`·`feature/users/:id`·`feature/all`·`climate-normals/refresh`, `GET /worker-payroll/me`, `POST·PUT·DELETE /gateways`, `PATCH /gateways/:id/zone`.
  - 새 라우트가 **본인 정보·플랫폼 운영 기능**이면 `@PlatformScope()` 를 붙일 것. 핸들러 안에서 `role !== 'admin'` 으로 직접 막는 라우트는 특히 필수(교체 후 403 이 됨).
- 감사: 농장 컨텍스트 쓰기는 activity-log `details.actingAdminId`/`actingAdminUsername`/`farmContext:true` 에 실제 수행자가 남는다(스키마 변경 없음).
- 소켓(옵트인): admin 이 `subscribe:farm {farmId}` → `admins` room 퇴장 + `user:<farmId>` 입장(`farm:joined`), `unsubscribe {channel:'farm'}` → 복귀(`farm:left`), 실패 `farm:error {code}`.
- 계약서: `admin-console/docs/FARM_SCOPE_DESIGN.md`. 테스트: `cd backend && npm test` (일회용 `*_test` DB 자동 생성·삭제, MQTT mock — 실제 DB·브로커 미접속).
- 롤백: 이 기능 커밋들을 `git revert` 하면 끝(DB 스키마 변경 없음, 헤더를 안 보내는 기존 클라이언트는 영향 없음).

## Sensor Types

temperature, humidity, co2, illuminance_lux, soil_moisture, soil_temperature,
wind_speed, rainfall, battery, linkquality, ph, ec

## Device Types

- type: `sensor` | `actuator`
- equipment_type: `fan`, `irrigation`, `opener_open`, `opener_close`, `other`

## Automation Rules

- type: `weather` | `time` | `hybrid`
- conditions/actions: JSONB 컬럼
- priority: 0-n 순서

## Dev Commands

```bash
# 전체 서비스 실행
docker compose up -d

# 백엔드 개발 (로컬)
cd backend && npm run start:dev

# 프론트엔드 개발 (로컬)
cd frontend && npm run dev

# 도커 빌드
docker compose build backend frontend
```

## Key Files

- DB 스키마: `backend/database/schema.sql`
- MQTT 핸들러: `backend/src/modules/mqtt/mqtt-sensor.handler.ts`, `mqtt-device.handler.ts`
- 채널매핑 상수: `backend/src/modules/devices/channel-mapping.constants.ts`
- WebSocket: `backend/src/modules/gateway/events.gateway.ts`
- 라우터: `frontend/src/router/index.ts`
- API 클라이언트: `frontend/src/api/client.ts`
- 공유 타입: `shared/types/`, `shared/utils/`
