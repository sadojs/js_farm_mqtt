# 기능 동등성 체크리스트 (Feature Parity)

> 기존 프론트엔드(`frontend/`, :5174)에서 **플랫폼 관리자(role=admin)** 가 쓸 수 있는 기능 전체 목록입니다.
> 새 콘솔(`admin-console/`, :5175)은 이 표의 **모든 항목이 동작해야 완료**입니다.
> 각 항목의 "기존 소스"는 동작 기준(정답)이며 **수정 금지 · 읽기/import 만 허용**합니다.
> 2026-10-03 기준 소스 분석으로 작성했습니다. 구현 전에 실제 소스와 한 번 더 대조하고, 빠진 항목이 있으면 이 표에 추가하세요.

표기: 구현 방식 — **N** = 콘솔 디자인으로 새로 구현 / **L** = 기존 컴포넌트 재사용(콘솔 셸 안에 임베드) / **N+L** = 목록·레이아웃은 새로, 편집 모달·카드 등은 기존 재사용

## A. 인증 · 공통

| # | 기능 | 기존 소스 | 방식 | 확인 |
|---|------|-----------|------|------|
| A1 | 로그인 (username/password) | `views/Login.vue`, `stores/auth.store.ts`, `api/auth.api.ts` | N (스토어·API 재사용) | ☐ |
| A2 | 새로고침 시 세션 복원 (refresh 쿠키 → `initAuth`) | `stores/auth.store.ts` | L | ☐ |
| A3 | 10분 주기 silent refresh, 401 시 1회 재시도 후 로그아웃 | `stores/auth.store.ts`, `api/client.ts` | L | ☐ |
| A4 | 임시 비밀번호 계정 → 비밀번호 변경 강제 | `views/ChangePassword.vue`, router guard | N+L | ☐ |
| A5 | **admin 이 아닌 계정 로그인 시 콘솔 진입 차단** (안내 + 기존 앱 링크 + 로그아웃) | (신규) | N | ☐ |
| A6 | 로그아웃 | `App.vue handleLogout` | N | ☐ |
| A7 | 실시간 소켓 연결/재연결 · 연결 상태 표시 | `composables/useWebSocket.ts` | L | ☐ |
| A8 | 알림 센터 (목록·읽음) | `components/common/NotificationCenter.vue`, `stores/notification.store.ts` | N+L | ☐ |
| A9 | 토스트 · 확인 다이얼로그 | `ToastContainer.vue`, `ConfirmDialog.vue`, `composables/useConfirm.ts` | L | ☐ |
| A10 | 내 정보 수정 (이름/주소/비밀번호) | `userApi.updateMe`, `UserSettingsModal.vue` | N+L | ☐ |
| A11 | 부가기능 플래그(생육관리·농작업·방재·일꾼) 개인 토글 | `useFeatureFlags.ts`, `useCropFeature.ts`, `UserSettingsModal.vue` | N+L | ☐ |

## B. 사용자 관리 (`/users`, 기존 `views/UserManagement.vue`)

| # | 기능 | 기존 소스 / API | 방식 | 확인 |
|---|------|-----------------|------|------|
| B1 | 전체 사용자 목록 (역할별, 농장 관리자 아래 농장 사용자 트리) | `userApi.getAll` | N | ☐ |
| B2 | 검색/필터 | UserManagement.vue | N | ☐ |
| B3 | 사용자 생성 (역할, farm_user 는 소속 농장 관리자 지정) | `userApi.create`, `components/admin/UserFormModal.vue` | N+L | ☐ |
| B4 | 사용자 편집 · 비밀번호 재설정 | `userApi.update`, UserFormModal | N+L | ☐ |
| B5 | 사용자 삭제 (확인 다이얼로그) | `userApi.remove` | N | ☐ |
| B6 | 사용자별 기능 권한 토글 (생육관리) | `PATCH /crop-management/feature/users/:id` | N | ☐ |
| B7 | 사용자별 기능 권한 토글 (농작업 일정 · 방재 일정 · 일꾼 관리 등) | `PATCH /features/:feature/users/:id` | N | ☐ |
| B8 | 사용자 상세 내 게이트웨이 생성/수정/삭제 | `gatewayApi.create/update/remove` (UserManagement.vue 내부) | N+L | ☐ |

## C. 농장 관리 (`/admin/farms`, 기존 `views/AdminFarmManagement.vue`)

| # | 기능 | 기존 소스 / API | 방식 | 확인 |
|---|------|-----------------|------|------|
| C1 | 농장(=농장 관리자 계정) 목록 + 구역 수 | `groupApi.getFarmAdmins`, `groupApi.adminGetAllGroups` | N | ☐ |
| C2 | 농장 선택 → 구역 목록 | `groupApi.adminGetAllGroups` | N | ☐ |
| C3 | 농장에 구역 생성 | `groupApi.adminCreateGroup` | N | ☐ |
| C4 | 구역 삭제 (의존성 확인) | `groupApi.removeGroup`, `groupApi.getDependencies` | N | ☐ |
| C5 | 구역에 게이트웨이 할당/해제 | `gatewayApi.assignZone` | N | ☐ |

## D. 게이트웨이 (`/gateways`, 기존 `views/GatewayManagement.vue`)

| # | 기능 | 기존 소스 / API | 방식 | 확인 |
|---|------|-----------------|------|------|
| D1 | 전체 게이트웨이 목록, 농장/상태별 그룹, 검색, 정상/점검필요 필터 | `gatewayApi.getAll`, `userApi.getAll`, `groupApi.adminGetAllGroups` | N | ☐ |
| D2 | Agent / Zigbee / SSH 상태 실시간 반영 | `useWebSocket` 이벤트 | N+L | ☐ |
| D3 | 게이트웨이 등록 / 수정(이름·위치·IP·소유자·하우스) / 삭제 | `gatewayApi.create/update/remove` | N | ☐ |
| D4 | 구역 할당 | `gatewayApi.assignZone` | N | ☐ |
| D5 | 웹 터미널 (SSH 프록시) | `components/gateway/WebTerminal.vue` | L | ☐ |
| D6 | 게이트웨이 환경 설정 진입 | → E 섹션 | — | ☐ |

## E. 게이트웨이 환경 설정 (`/gateways/:id/env`, 기존 `views/GatewayEnvSettings.vue` ≈100KB)

| # | 기능 | API | 방식 | 확인 |
|---|------|-----|------|------|
| E1 | 장치 전체 조회 (온보드 + Zigbee) | `gatewayEnvApi.getAllDevices` | L | ☐ |
| E2 | 온보드 장치 수정 (이름/사용/동작시간 등) | `gatewayEnvApi.updateOnboard` | L | ☐ |
| E3 | Zigbee 스캔 · 페어링 모드(permit join) | `gatewayEnvApi.scanZigbee`, `gatewayApi.permitJoin` | L | ☐ |
| E4 | Zigbee 장치/컨트롤러 추가 · 수정 · 삭제 | `addZigbee`, `addZigbeeController`, `updateZigbee`, `removeZigbee` | L | ☐ |
| E5 | 채널 매핑 · 채널 코드 · 채널 사용 여부 | `deviceApi.updateChannelMapping/updateChannelCode/updateChannelEnabled` | L | ☐ |
| E6 | 채널 테스트 · GPIO 핀 테스트 | `testZigbeeChannel`, `testGpioPin`, `components/gateway/PinTestModal.vue`, `GpioRelayManager.vue` | L | ☐ |
| E7 | 장치 이름 변경 · 수동 제어 | `deviceApi.rename`, `deviceApi.control` | L | ☐ |
| E8 | 페일오버 설정 요약 표시 | `emergencyFailoverApi.getFull` | L | ☐ |

## F. 설정 배포 (`/config-deploy`, 기존 `views/ConfigDeploy.vue`)

| # | 기능 | API | 방식 | 확인 |
|---|------|-----|------|------|
| F1 | 게이트웨이별 시스템 설정: Wi-Fi / Hostname / Gateway ID / Server IP / Identity | `configDeployApi.updateWifi/updateHostname/updateGatewayId/updateServerIp/updateIdentity`, `components/config-deploy/GatewaySystemConfigCard.vue`, `useRemoteConfig.ts` | L | ☐ |
| F2 | 원격 결과 실시간 상태 배지 | `RemoteConfigStatusBadge.vue` (WebSocket) | L | ☐ |
| F3 | Z2M 공통 템플릿 조회 · 미리보기 · 배포 | `configDeployApi.getTemplate/preview/deploy` | L | ☐ |
| F4 | 라즈베리파이 컴포넌트/배포 워크플로우 안내 | ConfigDeploy.vue 접이식 섹션 | N | ☐ |

## G. 이머전시 페일오버 (`/emergency-failover`, 기존 `views/EmergencyFailover.vue`)

| # | 기능 | API | 방식 | 확인 |
|---|------|-----|------|------|
| G1 | 게이트웨이 선택 · 현재 모드/버전/동기화/마지막 하트비트 | `getFull`, `getMode`, `FailoverStatusCard.vue` | L | ☐ |
| G2 | 하트비트 설정 (단절 판정·복구 grace) | `updateConfig`, `HeartbeatSettingsCard.vue` | L | ☐ |
| G3 | 개폐기 온습도 조건 | `OpenerEnvCard.vue` | L | ☐ |
| G4 | 개폐기 월별 백업 스케줄 (설정/해제) | `upsertSchedule`, `disableSchedule`, `OpenerMonthlyScheduleCard.vue`, `OpenerMonthDialog.vue` | L | ☐ |
| G5 | 환기팬 · 관수 · 액비 페일오버 | `FanFailoverCard`, `IrrigationFailoverCard`, `FertilizerFailoverCard` | L | ☐ |
| G6 | 이벤트 이력 | `getEvents` | L | ☐ |
| G7 | 재동기화 | `resync` | L | ☐ |
| G8 | **비상 정지** (2단계 확인 필수) | `emergencyStop` | L | ☐ |

## H. 농장 보기 (관리자 메뉴 "농장 모니터링/운영")

기존 앱에서 관리자가 접근하던 농장 화면들. 콘솔에서는 **"농장 보기" 섹션**(사이드바에서 농장 선택 후 진입)으로 묶습니다.

| # | 화면 | 기존 소스 | 방식 | 확인 |
|---|------|-----------|------|------|
| H1 | 우리 농장(대시보드) | `views/Dashboard.vue` + `components/dashboard/*` | L | ☐ |
| H2 | 구역 관리 | `views/Groups.vue` (≈130KB) + `components/groups/*` | L | ☐ |
| H3 | 자동 제어 설정 | `views/Automation.vue` + `components/automation/**` | L | ☐ |
| H4 | 방재 일정 (기능 플래그) | `modules/spray-schedule/SprayScheduleView.vue` | L | ☐ |
| H5 | 일꾼 관리 (기능 플래그) | `modules/worker-payroll/WorkerPayrollView.vue` | L | ☐ |
| H6 | (URL 직접 접근 가능했던 화면) 농장 환경 · 환경 비교 · 이상 알림 · 동작 이력 · 농작업 일정 · 생육관리 | `Sensors.vue`, `Reports.vue`, `Alerts.vue`, `ActivityLog.vue`, `work-log`, `crop-management` | L | ☐ |

> ✅ **농장별 데이터 분리**: 작업 1(`tasks/01-BACKEND_FARM_SCOPE.md`)에서 백엔드에 옵트인 헤더 `X-Farm-Context` 를 추가한다.
> 콘솔은 "농장 보기" 경로의 모든 요청에 이 헤더를 붙여 **선택한 농장 데이터만** 받는다. 헤더 계약은 `docs/FARM_SCOPE_DESIGN.md` 를 따른다.
> 기존 앱(:5174)은 헤더를 보내지 않으므로 관리자 화면이 지금처럼 전체 농장 합산으로 보인다(변경 없음).

| # | 기능 | 확인 |
|---|------|------|
| H7 | 농장 선택 시 H1~H6 의 모든 API 요청에 `X-Farm-Context` 헤더 부착 | ☐ |
| H8 | 플랫폼 운영 화면·농장 보기 종료 후에는 헤더 미부착 | ☐ |
| H9 | 농장 변경 시 스토어 캐시 초기화 + 소켓 farm room 전환 | ☐ |
| H10 | (백엔드 배포 후) 선택 농장 데이터만 표시됨을 실제 확인 | ☐ |

## I. 기타

| # | 기능 | 비고 | 확인 |
|---|------|------|------|
| I1 | 음성 어시스턴트 | 콘솔에서는 **제외 가능** (사용자 확인 후). 기본값: 제외 | ☐ |
| I2 | 글자 크기 / 다크 테마 | 콘솔은 라이트 고정 1차, 다크는 2차 | ☐ |
| I3 | PWA / 네이티브 푸시 / Capacitor | **콘솔에서는 사용 안 함** (PC·태블릿 웹 전용) | ☐ |
