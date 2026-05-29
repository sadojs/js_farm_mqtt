# Smart Farm MQTT — Menu / Route Structure

> 프론트엔드 라우터([frontend/src/router/index.ts](../frontend/src/router/index.ts))를 직접 읽어 정리. 각 화면이 호출하는 API와 store는 View 파일의 `import` 구문 + `frontend/src/api/*.api.ts` 코드를 직접 확인했다.

---

## 1. 권한 시스템

라우트 가드: [frontend/src/router/index.ts:104-138](../frontend/src/router/index.ts#L104-L138)

| meta 키 | 동작 |
|---------|------|
| `public: true` | 인증 없이 접근 (Login만) |
| `requiresAuth: true` | 로그인 필요 — 미인증 시 `/login` |
| `denyFarmUser: true` | `farm_user` 차단 → `/dashboard` |
| `requiresAdmin: true` | `admin`만 → 비관리자는 `/dashboard` |

3개 역할: `admin` / `farm_admin` / `farm_user` ([schema.sql:17](../backend/database/schema.sql#L17))

---

## 2. 라우트 표 (전체 15개)

| Path | name | View | 메뉴명 (`meta.title`) | 권한 |
|------|------|------|----------------------|------|
| `/login` | login | [Login.vue](../frontend/src/views/Login.vue) | 로그인 | public |
| `/` | — | (redirect → `/dashboard`) | — | — |
| `/dashboard` | dashboard | [Dashboard.vue](../frontend/src/views/Dashboard.vue) | 우리 농장 | requiresAuth |
| `/sensors` | sensors | [Sensors.vue](../frontend/src/views/Sensors.vue) | 농장 환경 | requiresAuth |
| `/automation` | automation | [Automation.vue](../frontend/src/views/Automation.vue) | 자동화 | requiresAuth + denyFarmUser |
| `/groups` | groups | [Groups.vue](../frontend/src/views/Groups.vue) | 구역 관리 | requiresAuth |
| `/users` | users | [UserManagement.vue](../frontend/src/views/UserManagement.vue) | 사용자 관리 | requiresAuth + **requiresAdmin** |
| `/reports` | reports | [Reports.vue](../frontend/src/views/Reports.vue) | 기록 보기 | requiresAuth |
| `/alerts` | alerts | [Alerts.vue](../frontend/src/views/Alerts.vue) | 이상 알림 | requiresAuth |
| `/activity-log` | activity-log | [ActivityLog.vue](../frontend/src/views/ActivityLog.vue) | 작업 내역 | requiresAuth |
| `/config-deploy` | config-deploy | [ConfigDeploy.vue](../frontend/src/views/ConfigDeploy.vue) | 설정 배포 | requiresAuth + **requiresAdmin** |
| `/emergency-failover` | emergency-failover | [EmergencyFailover.vue](../frontend/src/views/EmergencyFailover.vue) | 이머전시 페일오버 | requiresAuth + denyFarmUser |
| `/gateways` | gateways | [GatewayManagement.vue](../frontend/src/views/GatewayManagement.vue) | 게이트웨이 관리 | requiresAuth + denyFarmUser |
| `/gateways/:id/env` | gateway-env | [GatewayEnvSettings.vue](../frontend/src/views/GatewayEnvSettings.vue) | 게이트웨이 환경 설정 | requiresAuth + denyFarmUser |
| `/crop-management` | crop-management | [modules/crop-management/CropManagementView.vue](../frontend/src/modules/crop-management/CropManagementView.vue) | 생육관리 | requiresAuth |
| `/admin/farms` | admin-farms | [AdminFarmManagement.vue](../frontend/src/views/AdminFarmManagement.vue) | 농장 관리 | requiresAuth + **requiresAdmin** |

~~**`Devices.vue` 미라우팅**~~ — **해소(2026-05-25)**: 전수 검증(라우터/import/문자열/동적참조 0건) 결과 데드 파일로 확인되어 삭제 완료. 장비 관리 UI는 `Groups.vue` + `GatewayEnvSettings.vue`에서 처리됨.

---

## 3. 메뉴 노출 (UI 컴포넌트)

### 3.1 BottomTabBar (모바일 하단 — 라우팅 탭 5개 + 더보기 버튼 1개)
[frontend/src/components/common/BottomTabBar.vue](../frontend/src/components/common/BottomTabBar.vue) — 인증된 사용자에게 항상 표시. `mainTabs` 배열의 5개는 `<router-link>` 탭, 마지막 ⋯ 는 `<button>`으로 MoreMenu를 토글하는 비-라우팅 버튼:

| 순서 | 아이콘 | 라벨 | 경로 / 동작 | 종류 |
|------|--------|------|-------------|------|
| 1 | 📊 | 홈 | `/dashboard` | 라우터 탭 |
| 2 | 📡 | 환경 | `/sensors` | 라우터 탭 |
| 3 | ⚙ | 자동 제어 | `/automation` | 라우터 탭 |
| 4 | 👥 | 구역 | `/groups` | 라우터 탭 |
| 5 | 🖥 | 게이트웨이 | `/gateways` | 라우터 탭 |
| + | ⋯ | 더보기 | MoreMenu 토글 | 버튼 (라우팅 아님) |

### 3.2 MoreMenu (더보기 팝업)
[frontend/src/components/common/MoreMenu.vue](../frontend/src/components/common/MoreMenu.vue):
- 📈 기록 보기 → `/reports`
- 👤 사용자 관리 → `/users` (admin만)
- 🚪 로그아웃

⚠️ `Alerts` / `ActivityLog` / `ConfigDeploy` / `EmergencyFailover` / `gateway-env` / `crop-management` / `admin/farms`는 BottomTabBar/MoreMenu에 항목 없음 — 다른 화면 내부 링크나 직접 URL로만 접근 (확인 필요).

---

## 4. 화면별 데이터 연결

각 View가 호출하는 API 모듈은 `import` 구문으로, 실제 엔드포인트는 `frontend/src/api/*.api.ts` 안의 `apiClient.<method>('...')` 라인을 직접 확인했다.

### 4.1 `/dashboard` — Dashboard.vue
- store: 없음 (직접 API 호출)
- API:
  - `GET /dashboard/weather` — 현재 날씨
  - `GET /dashboard/widgets` — 위젯 데이터
- 근거: [Dashboard.vue](../frontend/src/views/Dashboard.vue), [dashboard.api.ts](../frontend/src/api/dashboard.api.ts)

### 4.2 `/sensors` — Sensors.vue
- store: `useGroupStore`, `useDeviceStore`
- API: `envConfigApi`
  - `GET /env-config/roles`
  - `GET /env-config/groups/{groupId}/sources`
  - `GET /env-config/groups/{groupId}/mappings`
  - `PUT /env-config/groups/{groupId}/mappings`
  - `GET /env-config/groups/{groupId}/resolved` — 그룹별 환경 역할에 매핑된 최신 값
- 근거: [Sensors.vue](../frontend/src/views/Sensors.vue), [env-config.api.ts](../frontend/src/api/env-config.api.ts)

### 4.3 `/automation` — Automation.vue
- store: `useAutomationStore`, `useGroupStore`, `useDeviceStore`, `useNotificationStore`
- API: (스토어 경유) `automationApi`
  - `GET /automation/rules`
  - `POST /automation/rules`
  - `PUT /automation/rules/{id}`
  - `PATCH /automation/rules/{id}/toggle?autoEnableRemote=true|false`
  - `DELETE /automation/rules/{id}`
  - `GET /automation/logs` / `GET /automation/logs/stats`
  - `GET /automation/irrigation/status`
  - `POST /automation/rules/bulk-disable` (장비 단위 일괄 비활성화)
- 백엔드: [automation.controller.ts](../backend/src/modules/automation/automation.controller.ts)

### 4.4 `/groups` — Groups.vue
- store: `useGroupStore`, `useDeviceStore`, `useAutomationStore`, `useAuthStore`, `useNotificationStore`
- API: `groupApi`
  - `GET /groups`, `POST /groups`, `PUT /groups/{id}`, `DELETE /groups/{id}`
  - `POST /groups/{id}/control` — 그룹 일괄 제어
  - `GET /groups/houses`, `POST /groups/houses`, `PUT /groups/houses/{id}` (하우스 CRUD)
- 근거: [group.api.ts](../frontend/src/api/group.api.ts)

### 4.5 `/users` — UserManagement.vue (admin only)
- API: `userApi`
  - `GET /users`, `POST /users`, `PUT /users/{id}`, `DELETE /users/{id}`
  - `GET /users/farm-admins` — farm_admin 목록 (자식 사용자 생성 시 부모 선택용)
  - `PUT /users/me` (자기 정보 수정)
- 백엔드: [users.controller.ts](../backend/src/modules/users/users.controller.ts)

### 4.6 `/reports` — Reports.vue
- store: `useGroupStore`
- API: `reportApi`, `envConfigApi`
  - `GET /reports/statistics`
  - `GET /reports/hourly`
  - `GET /reports/actuator-stats`
  - `GET /reports/export/csv` — CSV 다운로드
  - `GET /reports/weather-hourly`
- 근거: [report.api.ts](../frontend/src/api/report.api.ts)

### 4.7 `/alerts` — Alerts.vue
- API: `sensorAlertsApi`
  - `GET /sensor-alerts` (페이징)
  - `GET /sensor-alerts/{id}` (상세)
  - `PUT /sensor-alerts/{id}/resolve`, `PUT /sensor-alerts/{id}/snooze` (days)
  - `DELETE /sensor-alerts/{id}`
  - `GET /sensor-alerts/sensors` — 알림 대상 센서 목록
  - `PUT /sensor-alerts/sensors/standby` / `DELETE` — standby 토글
- 근거: [sensor-alerts.api.ts](../frontend/src/api/sensor-alerts.api.ts)

### 4.8 `/activity-log` — ActivityLog.vue
- API: `activityLogApi` + `automationLogApi`
  - `GET /activity-logs` (페이징 + 필터) — 사용자 행동 기록
  - `GET /automation/logs` — 자동화 실행 기록 (위 4.3과 동일)
- 2탭 구조 (실행 로그 / 행동 로그) — CLAUDE.md 메모와 일치

### 4.9 `/config-deploy` — ConfigDeploy.vue (admin only)
- API: `configDeployApi` + `gatewayApi`
  - `GET /config-deploy/template` / `PUT /config-deploy/template`
  - `GET /config-deploy/gateways/{gatewayId}/config`
  - `POST /config-deploy/preview` (gatewayIds[], config) — 변경 미리보기
  - `POST /config-deploy/deploy` (gatewayIds[], config) — Mosquitto `farm/{gw}/config/request` 발행
  - 그 외 `POST` 3건은 wifi/hostname 등 개별 원격 설정 (확인 필요)
- 백엔드: [config-deploy.service.ts](../backend/src/modules/config-deploy/config-deploy.service.ts)

### 4.10 `/emergency-failover` — EmergencyFailover.vue
- **프론트 라우트 경로**: `/emergency-failover` / **백엔드 HTTP prefix**: `/api/fallback-config` (`@Controller('fallback-config')`)
- API: `emergencyFailoverApi` — base URL `/fallback-config/{gatewayId}`
  - `GET …` — 전체 폴백 설정 + 월별 스케줄
  - `PATCH …` — fallback_configs 업데이트
  - `PUT/DELETE …/opener-schedule/{month}`
  - `GET …/status` — `fallback_gateway_status` 조회
  - `GET …/events` — 폴백 이벤트 페이징
  - `POST …/resync` — 룰 재동기화 강제
- 백엔드 DB: [migration 020](../backend/database/migrations/020_fallback_rules.sql)

### 4.11 `/gateways` — GatewayManagement.vue
- API: `gatewayApi` + `userApi` + `groupApi`
  - `GET /gateways`
  - `POST /gateways` — admin은 `userId` 지정 가능
  - `PUT /gateways/{id}` — 소유자 변경 (admin)
  - `DELETE /gateways/{id}`
  - `PATCH /gateways/{id}/zone` — 구역 할당/해제 (houseId 자동 매핑)
  - `GET /gateways/{id}/zigbee-devices` — Z2M `bridge/devices` 캐시
  - `POST /gateways/{id}/permit-join` (페어링 모드, 기본 120초)
  - `GET /gateways/{gatewayId}/tunnel-port`, `POST .../tunnel-key` — reverse SSH 설정
- 백엔드: [gateway-manager.controller.ts](../backend/src/modules/gateway-manager/gateway-manager.controller.ts)

### 4.12 `/gateways/:id/env` — GatewayEnvSettings.vue
- API: `gatewayEnvApi`
  - `GET /gateway-env/{gatewayId}/all-devices`
  - `GET/POST/PATCH/DELETE /gateway-env/{gatewayId}/onboard/...` — 온보드(GPIO 직결) 장치
  - `GET /gateway-env/{gatewayId}/zigbee/scan` — Z2M 페어링 스캔 (permit_join + bridge/devices)
  - `POST /gateway-env/{gatewayId}/zigbee` — 스캔 결과를 DB devices에 등록
- 근거: [gateway-env.api.ts](../frontend/src/api/gateway-env.api.ts)

### 4.13 `/crop-management` — CropManagementView.vue
- 독립 모듈: `frontend/src/modules/crop-management/`
- DB: `crop_batches`, `task_templates`, `batch_tasks`, `task_occurrences` ([schema.sql:349-447](../backend/database/schema.sql#L349-L447))

### 4.14 `/admin/farms` — AdminFarmManagement.vue
- API: `groupApi`, `gatewayApi`
- 농장(= farm_admin 사용자 + 게이트웨이 + 구역) 매핑 관리

### 4.15 `/login` — Login.vue
- store: `useAuthStore`
- API: `authApi` (`/auth/login`, `/auth/refresh` 등 — [auth.api.ts](../frontend/src/api/auth.api.ts) 참조)
- 인증 방식: **username** + password (이메일 아님, [migration 003](../backend/database/migrations/migration-003-email-to-username.sql))

---

## 5. 실시간 (WebSocket / Socket.io)

[backend/src/modules/gateway/events.gateway.ts](../backend/src/modules/gateway/events.gateway.ts) → frontend `composables/useWebSocket.ts`

대표 이벤트(메서드명 기반):
- `broadcastAutomationExecuted(userId, {ruleId, ruleName, success, actions})` — 자동화 룰 실행 알림
- `broadcastGatewayStatus(userId, gatewayId, agentStatus, status)` — 게이트웨이 온/오프라인

근거: [automation-runner.service.ts:87,172](../backend/src/modules/automation/automation-runner.service.ts#L87), [gateway-manager.service.ts:67,229](../backend/src/modules/gateway-manager/gateway-manager.service.ts#L229)

---

## 6. 화면 ↔ 백엔드 모듈 매핑

| Frontend View | Backend 모듈 |
|---------------|--------------|
| Dashboard | `dashboard` |
| Sensors | `env-config` + `sensors` |
| Automation | `automation` (+ `irrigation-scheduler`) |
| Groups | `groups` |
| UserManagement | `users` |
| Reports | `reports` |
| Alerts | `sensor-alerts` |
| ActivityLog | `activity-log` + `automation` |
| ConfigDeploy | `config-deploy` |
| EmergencyFailover | `fallback-config` (백엔드 HTTP prefix), 프론트 라우트만 `/emergency-failover` |
| GatewayManagement | `gateway-manager` (+ `mqtt` for permit_join) |
| GatewayEnvSettings | `gateway-env` |
| CropManagement | `crop-management` |
| AdminFarmManagement | `groups` + `users` |
| Login | `auth` |
