# Smart Farm MQTT — Operator Guide (운영자용)

> **운영자(농장 관리자 / 시스템 관리자) 관점**에서 자주 수행하는 작업의 절차를 정리. 모든 단계는 실제 코드(controller/service/RPi 스크립트)를 직접 확인한 결과이며, 변경 가능성이 있는 부분은 ⚠️로 표시했다.

---

## 1. 사용자 추가

### 1.1 권한 모델
- `admin`: 모든 사용자/농장/게이트웨이 관리
- `farm_admin`: 자기 농장(소유한 게이트웨이/구역/장비) 관리
- `farm_user`: `parent_user_id`가 가리키는 `farm_admin`의 데이터를 함께 사용. **자동화 룰 생성/수정/삭제 불가** (`denyFarmUser`)

근거: [schema.sql:17](../backend/database/schema.sql#L17), [router/index.ts:35](../frontend/src/router/index.ts#L35), [users.service.ts:48-53](../backend/src/modules/users/users.service.ts#L48-L53)

### 1.2 절차 (admin 계정으로)

1. **사이드바 → 더보기(⋯) → 사용자 관리** 또는 직접 `/users` 접속
2. **사용자 추가** 버튼 → 입력 폼
3. 필드 ([CreateUserDto](../backend/src/modules/users/dto/user.dto.ts)):
   | 필드 | 규칙 |
   |------|------|
   | `username` | **영문 소문자 시작**, 3~50자, `[a-z0-9_-]`만 — 정규식 `^[a-z][a-z0-9_-]{2,49}$` |
   | `password` | 최소 6자 (bcrypt 라운드 10) |
   | `name` | 표시명 (필수) |
   | `role` | `admin` / `farm_admin` / `farm_user` — 기본값 `farm_admin` |
   | `parentUserId` | `farm_user` 생성 시 부모 `farm_admin` ID (필수) |
   | `address` | 선택 |
4. **저장** → `POST /users` ([users.controller.ts:42](../backend/src/modules/users/users.controller.ts#L42), `@Roles('admin')`)

### 1.3 자식(`farm_user`) 추가 시
- 부모 후보 목록은 `GET /users/farm-admins` 로 자동 로딩
- 자식 사용자가 로그인하면 백엔드가 `getEffectiveUserId()`로 부모의 데이터(devices, automation_rules 등)에 접근하게 함

### 1.4 비활성화 / 삭제
- 일시 차단: `PUT /users/:id` 에 `{ status: 'inactive' }`
- 영구 삭제: `DELETE /users/:id` — CASCADE로 해당 사용자의 gateway/group/device/sensor_data 모두 삭제 ([schema.sql](../backend/database/schema.sql) ON DELETE CASCADE)

⚠️ 삭제 전 종속 데이터가 많은 사용자는 통계 손실에 주의. 일반적으로 비활성화 권장.

---

## 2. 게이트웨이(라즈베리파이) 추가 및 설정

### 2.1 전체 흐름
```
[1] 골든이미지 SD카드 굽기
        ↓
[2] Pi 부팅 → first-boot-init.service 실행 (gateway_id 적용 등)
        ↓
[3] 서버에서 사용자가 게이트웨이 등록 (bootstrap_token 사용)
        ↓
[4] 웹 UI에서 농장(구역)에 할당
        ↓
[5] (선택) Reverse SSH 터널 설정
        ↓
[6] Zigbee 장치 페어링
```

### 2.2 골든이미지 / 수동 설치
운영 환경에서는 사전 제작한 **골든이미지**를 SD카드에 굽고 부팅만 하면 자동 등록되는 흐름이 표준이다. 골든이미지 빌드 스크립트: [raspberry-pi/build-golden-image.sh](../raspberry-pi/build-golden-image.sh).

수동으로 처음부터 설치하려면 라즈베리파이에서:
```bash
sudo bash setup.sh                          # 인터랙티브 모드
# 또는
sudo GATEWAY_ID=lgw-farm01 \
     SERVER_IP=175.206.245.234 \
     MQTT_USER=smartfarm MQTT_PASSWORD=… \
     bash setup.sh --noninteractive --with-tunnel
```
주요 옵션:
- `--with-tunnel`: Reverse SSH 터널 함께 설치 (서버에서 Pi에 원격 접속 가능)
- `--skip-update`: apt update/upgrade 생략 (빠른 재실행)

설치되는 systemd 서비스: `zigbee2mqtt`, `gpio-agent`, `fallback-engine`, (선택) `reverse-ssh-tunnel`, `first-boot-init`. 근거: [raspberry-pi/setup.sh](../raspberry-pi/setup.sh), [raspberry-pi/systemd/](../raspberry-pi/systemd/)

### 2.3 웹에서 게이트웨이 등록 (`/gateways`)
1. **사이드바 → 게이트웨이** (`/gateways`, `farm_admin` 이상)
2. **게이트웨이 추가** 버튼
3. 필드:
   | 필드 | 설명 |
   |------|------|
   | `gatewayId` | Pi에서 사용한 ID (예: `lgw-farm01`) — MQTT 토픽 prefix `farm/{이값}/...` |
   | `name` | 표시명 (예: "석문리 1동") |
   | `location` | 선택 |
   | `userId` | (admin만) 다른 사용자에게 양도 시 사용 |
4. **저장** → `POST /gateways` ([gateway-manager.controller.ts:31](../backend/src/modules/gateway-manager/gateway-manager.controller.ts#L31))

#### 자동 등록 (Bootstrap Token)
첫 부팅 시 Pi가 `BOOTSTRAP_TOKEN`을 사용해 자기 자신을 자동 등록한다. 정책:
- 게이트웨이당 1회 등록 후 `bootstrap_token_used_at` 기록
- 동일 `machine_id`의 재등록(재이미지)은 항상 허용
- 다른 `machine_id`가 같은 `gatewayId`/`hostname`을 차지하려 시도하면 거부

근거: [migration 019](../backend/database/migrations/019_bootstrap_token_tracking.sql)

### 2.4 상태 확인
게이트웨이 카드에 표시되는 상태:
- `agent_status`: config-agent의 하트비트 (60초 주기) — 5분 미수신 시 자동 `offline`
- `tunnel_status`: reverse SSH 터널 상태 — 3분 미수신 시 자동 `disconnected`
- `last_seen`: 마지막 메시지 수신 시각

자동 stale 처리: 매 분 cron — [gateway-manager.service.ts:54-82](../backend/src/modules/gateway-manager/gateway-manager.service.ts#L54-L82)

### 2.5 구역 할당
1. 게이트웨이 카드 → **구역 할당**
2. 드롭다운에서 `house_group` 선택 → `PATCH /gateways/{id}/zone` body `{ groupId }`
3. 해당 그룹의 첫 번째 `house`에 자동 연결 (없으면 그룹명으로 자동 생성) — [gateway-manager.service.ts:120-132](../backend/src/modules/gateway-manager/gateway-manager.service.ts#L120-L132)

⚠️ **다른 사용자의 구역에 이미 할당된 게이트웨이는 재할당 거부** — 먼저 기존 농장에서 제거 필요.

### 2.6 Reverse SSH 터널 (서버에서 Pi 접근)
운영 중인 Pi에 SSH로 들어가야 할 때 사용. 절차:
1. Pi에서 키페어 생성 → public key 추출
2. 서버 API 호출:
   - `GET /gateways/{gatewayId}/tunnel-port` — 미할당이면 22201~22299 중 자동 채번
   - `POST /gateways/{gatewayId}/tunnel-key` body `{ publicKey }`
3. 서버는 자기 `~/.ssh/authorized_keys`에 `restrict,port-forwarding {pubkey} # tunnel:{gatewayId}` 등록
4. Pi → 서버 reverse SSH로 자기 22번 포트를 서버의 채번 포트(예: 22201)에 노출
5. 서버에서 `ssh -p 22201 pi@localhost`로 Pi 접속

근거: [gateway-manager.service.ts:233-296](../backend/src/modules/gateway-manager/gateway-manager.service.ts#L233-L296), [raspberry-pi/tunnel-setup.sh](../raspberry-pi/tunnel-setup.sh)

⚠️ 서버 측 sshd 설정이 `AllowTcpForwarding yes` / `GatewayPorts no`(local-only)인지 확인 필요.

---

## 3. 온보딩 & Zigbee 장치 추가

### 3.1 두 종류의 장치
| 종류 | 연결 | 등록 위치 |
|------|------|-----------|
| **온보드(Onboard)** | RPi BCM GPIO 핀에 직결된 릴레이/팬 | `gateway_onboard_devices` 테이블, BCM 핀 번호 지정 |
| **Zigbee** | Zigbee 라디오로 페어링 | `devices` 테이블, `zigbee_ieee`로 식별 |

근거: [migration 015](../backend/database/migrations/015_gpio_pin.sql), [schema.sql:91](../backend/database/schema.sql#L91)

### 3.2 화면 진입
1. `/gateways` 화면에서 카드의 **환경 설정** 클릭 → `/gateways/:id/env` 이동
2. 화면 구성: 온보드 탭 + Zigbee 탭

### 3.3 온보드 장치 등록
[GatewayEnvSettings.vue](../frontend/src/views/GatewayEnvSettings.vue) + [gateway-env.controller.ts](../backend/src/modules/gateway-env/gateway-env.controller.ts)

1. **온보드 → 장치 추가**
2. 필드:
   - `slot_key`: 슬롯 식별자 (예: `fan_1`, `opener_open_1`)
   - `name`: 표시명
   - `equipment_type`: `fan` / `opener_open` / `opener_close` / `other`
   - `gpio_pin`: **BCM 핀 번호 (2~27)** — 시스템 핀(I2C/SPI/UART)을 쓸 경우 raspi-config 또는 dtoverlay로 일반 GPIO로 전환
3. **저장** → `POST /gateway-env/{gatewayId}/onboard`

⚠️ Active LOW / Open-Drain / GPIO_CHIP은 **Pi 측 환경변수**(`GPIO_ACTIVE_LOW`, `GPIO_OPEN_DRAIN`, `GPIO_CHIP`)로 설정 — 웹 UI에서 직접 설정 불가. RPi5는 `gpiochip4`, RPi3·4는 `gpiochip0`. ([gpio-agent/index.js:11-16](../raspberry-pi/gpio-agent/index.js#L11-L16))

### 3.4 Zigbee 장치 페어링 → 등록
1. **Zigbee → 새 장치 스캔** 버튼
2. 백엔드가 `permit_join` ON 명령을 게이트웨이에 publish (기본 120초)
   - 토픽: `farm/{gw}/z2m/bridge/request/permit_join`
   - 코드: [mqtt.service.ts:201-205](../backend/src/modules/mqtt/mqtt.service.ts#L201-L205)
3. Pi의 Zigbee2MQTT가 새 장치를 페어링하면 `bridge/devices` retained 토픽 갱신
4. 웹 화면이 `GET /gateway-env/{gatewayId}/zigbee/scan`으로 캐시된 목록을 받아 표시
5. 등록할 장치 선택 → 메타데이터(category, equipment_type, icon) 입력
6. `POST /gateway-env/{gatewayId}/zigbee` 또는 `POST /devices/register`로 DB에 저장

#### 페어링 시 자동 처리
- **개폐기 쌍 자동 페어링**: `equipment_type='opener_open'` + `opener_close` 두 개를 함께 등록하면 양쪽 `paired_device_id`가 자동 연결됨. `openerGroupName`도 양쪽에 동일하게 저장. ([devices.service.ts:171-185](../backend/src/modules/devices/devices.service.ts#L171-L185))
- **관수 채널 매핑**: `equipment_type='irrigation'` 장비는 자동으로 8CH/12CH 감지. 사용자가 `PATCH /devices/:id/channel-mapping`으로 수정 가능 (역할 `farm_admin` 이상).

### 3.5 장비 삭제 시 종속성 검사
- `DELETE /devices/:id`는 다음 종속성이 있으면 거부:
  - 자동화 룰에서 `targetDeviceId`/`targetDeviceIds`로 사용 중
  - `group_devices`에 매핑 중
- 개폐기는 `DELETE /devices/:id/opener-pair` 로만 쌍 단위 삭제 가능
- 근거: [devices.service.ts:419-516](../backend/src/modules/devices/devices.service.ts#L419-L516)

---

## 4. 자동제어룰 설정

### 4.1 진입
1. `/automation` (admin / farm_admin) — `farm_user`는 `denyFarmUser`로 차단
2. **룰 추가** → 위저드 (시간 / 센서 / 하이브리드)

### 4.2 룰 데이터 모델
[create-rule.dto.ts](../backend/src/modules/automation/dto/create-rule.dto.ts):
```typescript
{
  name: string,
  description?: string,
  groupId?: string,         // 농장 그룹 (스코프 한정)
  houseId?: string,         // 특정 하우스만 (선택)
  conditions: {
    type?: 'irrigation',    // 관수 전용 룰일 때만
    logic?: 'AND' | 'OR',
    groups: [
      {
        logic: 'AND' | 'OR',
        conditions: [
          // 시간:
          { field: 'time'|'hour', operator: 'between', value: [start, end],
            daysOfWeek?: [1..7], scheduleType?: 'once' },
          // 센서:
          { field: 'temperature'|'humidity'|...|'internal_temp', operator: 'gt'|'lt'|'gte'|'lte'|'eq'|'between',
            value: number|[min,max], sensor_device_id?: string, deviation?: number /* 히스테리시스 */ },
          // 우적:
          { field: 'rain', operator: 'eq', value: true|false },
          // 릴레이 사이클 (개폐기 등):
          { ..., relay: true, relayOnSeconds: 30, relayOffSeconds: 60 }
        ]
      }
    ],
    target: { houseId },
    // (관수 전용)
    schedules: [{ startTime: 'HH:mm', days: [0..6], repeat: true }],
    zones: [{ zone: 1, enabled: true, duration: 10, name: '1구역' }],
    fertilizer: { enabled: true, duration: 5, preStopWait: 1 }
  },
  actions: {
    targetDeviceId?: string,
    targetDeviceIds?: string[],
    equipmentType?: 'fan'|'irrigation'|'opener_open'|'opener_close',
    command?: 'on'|'off',
    deviceType?: 'roof_actuator'|'ventilation_fan'|'irrigation'
  },
  priority?: 0..10
}
```

`rule_type`은 백엔드가 자동 계산:
- 조건에 시간만 → `time`
- 센서/날씨만 → `weather`
- 둘 다 → `hybrid`
- 코드: [automation.service.ts:224-236](../backend/src/modules/automation/automation.service.ts#L224-L236)

### 4.3 위저드 단계
1. **이름** + **그룹/하우스 선택** + **우선순위(0~10)** — 높은 priority가 먼저 평가됨
2. **조건 그룹** — AND/OR 논리, 그룹 내 조건들도 AND/OR
3. **조건 추가**:
   - **시간 조건**: "사이(between)" 범위만 — `field: 'time'` (분단위 0~1439) 또는 `'hour'` (시단위 0~23). 요일 필터 `daysOfWeek` 1=월~7=일. `scheduleType: 'once'`로 1회성 가능.
   - **센서 조건**: 환경 역할(`internal_temp` 등) 또는 직접 센서 타입. `deviation > 0`이면 자동 히스테리시스(ON 임계=value+dev, OFF 임계=value-dev).
4. **액션**: 대상 장비 선택 + ON/OFF — 개폐기 룰은 자동으로 페어 라우팅됨 (열기/닫기 장치 자동 선택)
5. **저장** → `POST /automation/rules`

### 4.4 관수(irrigation) 룰 특수성
- `conditions.type = 'irrigation'`
- **시간 기반 모드에서만 사용** (센서 모드 불가) — UI에서 자동 숨김
- **다중 스케줄(`schedules[]`)** 지원 — 동일 룰에서 여러 시간대 실행 ([irrigation-scheduler.service.ts:78-86](../backend/src/modules/automation/irrigation-scheduler.service.ts#L78-L86))
- **액비 검증** (백엔드 + 프론트 3중):
  - `fertilizer.enabled = true`이면 각 zone의 `duration ≥ fertilizer.duration + fertilizer.preStopWait` 보장
  - 위반 시 `POST /automation/rules` → 400 BadRequest
  - 코드: [automation.service.ts:199-222](../backend/src/modules/automation/automation.service.ts#L199-L222)
- 활성화 시 `PATCH /automation/rules/{id}/toggle?autoEnableRemote=true` 호출하면 대상 장비의 원격제어가 자동 ON됨 ([automation.service.ts:82-98](../backend/src/modules/automation/automation.service.ts#L82-L98))

### 4.5 룰 즉시 실행 (조건 무시)
- 화면에서 **즉시 실행** 버튼 → `POST /automation/rules/{id}/run`
- 백엔드: `runRuleNow → forceExecuteRule` — 조건 평가를 건너뛰고 actions만 실행 (음성 어시스턴트에서도 사용)
- 코드: [automation-runner.service.ts:74-115](../backend/src/modules/automation/automation-runner.service.ts#L74-L115)

### 4.6 룰 ON/OFF 토글, 일괄 비활성화
- 단일 토글: `PATCH /automation/rules/{id}/toggle`
- 장비 단위 일괄 비활성화: `POST /automation/rules/bulk-disable` body `{ deviceId }` — 해당 장비를 쓰는 모든 관수 룰을 비활성화 + 진행 중인 관수도 중단

### 4.7 실행 로그 확인
- `/activity-log` 화면의 실행 탭
- API: `GET /automation/logs?ruleId=…&page=1&limit=20&type=irrigation`
- 로그에는 `conditions_met`(평가 결과 상세), `actions_executed`(deviceNames, commandSummary)가 포함됨 ([automation-runner.service.ts:200-217](../backend/src/modules/automation/automation-runner.service.ts#L200-L217))

### 4.8 우적 우회 (Rain Override)
- 비 감지 센서(우적, `field: 'rain_detection'` 또는 legacy `'rain'`)가 ACTIVE인 동안 개폐기(`opener_*`) 룰의 액션은 **자동 skip**
- 사용자가 비 도중 직접 개폐기 ON 했다면 그 그룹은 자동 닫힘 suppress
- 폴백 모드에서도 동일하게 작동 (RPi `rain-override` 모듈)
- 근거: [automation-runner.service.ts:121-124](../backend/src/modules/automation/automation-runner.service.ts#L121-L124), [devices.service.ts:236-242](../backend/src/modules/devices/devices.service.ts#L236-L242), [fallback-engine/index.js:245-248](../raspberry-pi/fallback-engine/index.js#L245-L248)

---

## 5. 신규 환경 부트스트랩 & 운영 시나리오

### 5.0 신규 환경 DB 부트스트랩

- **로컬 개발**: `psql -f backend/database/seed-local.sql` 한 번 — 전체 스키마 + 샘플 데이터 일괄 적용 (개발용 Tuya 호환 테이블 포함)
- **프로덕션**: `schema.sql` → `migration-001~005-mqtt.sql` → `migrations/00X_*.sql` 번호순. 자세한 순서는 [ARCHITECTURE.md §9.1](./ARCHITECTURE.md#91-db-마이그레이션-적용-순서-필수) 참조
- ⚠️ `schema.sql` 단독 실행 시 `update_tuya_projects_updated_at` 트리거 정의에서 오류 — `migration-001-mqtt.sql`을 반드시 함께 적용

### 5.1 운영 시나리오

| 상황 | 대응 |
|------|------|
| 게이트웨이가 `offline`으로 표시됨 | (1) Pi가 켜져 있는지 (2) `systemctl status zigbee2mqtt config-agent gpio-agent` (3) MQTT 연결 — `mosquitto_sub -h server -t 'farm/{gw}/agent/status'` |
| Zigbee 장치가 스캔에 안 나옴 | permit_join이 종료됐을 가능성 — **새 장치 스캔** 다시 클릭 (120초 ON) |
| 자동화가 실행 안 됨 | `/activity-log` 실행 탭 → 해당 룰의 `conditions_met.matched` 확인. `false`면 조건 미충족 |
| 비 오는 데 개폐기가 안 닫힘 | env-config에서 `rain_detection` 역할이 우적센서에 매핑됐는지 확인. `Sensors.vue`에서 매핑 가능 |
| 관수가 멈춰야 하는데 안 멈춤 | `POST /automation/rules/bulk-disable` body `{ deviceId }` 또는 장비 원격제어 OFF — 자동으로 관련 룰 모두 비활성화 ([devices.service.ts:270-289](../backend/src/modules/devices/devices.service.ts#L270-L289)) |
| RPi가 서버 끊긴 동안 동작 | fallback-engine이 `mode=fallback` 진입. `/emergency-failover` 화면에서 폴백 설정(개폐기 월별 스케줄, 팬 임계온도 등) 사전 동기화 필요 |
