# Smart Farm MQTT Platform

Zigbee2MQTT 기반 스마트팜 모니터링/제어 플랫폼.
Raspberry Pi(Zigbee 게이트웨이) → MQTT Broker → NestJS Backend → Vue 3 Frontend.

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
