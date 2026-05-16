# Plan: gpio-relay-manager

> 게이트웨이 환경 설정의 온보드 릴레이 장치 관리 UI/UX를 교체하고,
> 서버 → MQTT → 라즈베리파이 → GPIO 릴레이 제어 파이프라인을 새로 구축한다.

---

## 1. 배경 및 목적

### 현재 상태
- `GatewayEnvSettings.vue` 온보드 탭: 고정 20개 슬롯을 단순 카드 리스트로 표시
- GPIO 핀 번호 관리 없음 (`gateway_onboard_devices` 테이블에 `gpio_pin` 컬럼 없음)
- 현재 관주/팬/개폐기 제어 명령은 **Zigbee 릴레이** 전용으로 설계됨
- 온보드(라즈베리파이 GPIO) 직접 제어 파이프라인 없음

### 목적
1. **UI/UX 교체**: `docs/gpio-device-manager.jsx` 프로토타입과 동일한 UX로 온보드 탭을 교체
2. **GPIO 제어 파이프라인 신설**: 서버 → MQTT → Pi → GPIO 릴레이 제어

---

## 2. 참고 프로토타입 핵심 기능 (JSX → Vue 변환)

| JSX 기능 | Vue 구현 방향 |
|---------|-------------|
| 장치 카드 펼치기/접기 | `v-if expanded` 토글 |
| 장치 enabled 토글 | 기존 `updateOnboard(enabled)` API 재사용 |
| 채널별 GPIO 핀 드롭다운 | 신규: `gpio_pin` 컬럼 저장, BCM 2~27 |
| 채널별 active 토글 | 기존 slot `enabled` 필드 재사용 |
| GPIO 핀 현황 시각화 | BCM 번호순, 색상 코딩 |
| 핀 충돌 경고 | 클라이언트 사이드 computed |
| 장치 추가 모달 | **고정 슬롯 구조**에 맞게 변형 → "그룹 추가" 불가, 슬롯 표시 방식 변경 |

### 슬롯 → 장치 그룹 매핑
현재 백엔드 고정 슬롯을 JSX의 device card 개념으로 그룹핑:

| 그룹 (카드) | 슬롯 | 채널 수 |
|-----------|------|--------|
| 유동팬 1번 | fan_1 | 1 (ON/OFF) |
| 유동팬 2번 | fan_2 | 1 |
| 유동팬 3번 | fan_3 | 1 |
| 유동팬 4번 | fan_4 | 1 |
| 관수 릴레이 | remote_control, fertilizer_contact, zone_1..N, mixer, fertilizer_motor | 8 or 14 |

> 개폐기(opener)는 현재 온보드에 없고 Zigbee 전용이므로 이번 범위 제외

---

## 3. 작업 범위

### ✅ 변경 대상 (프론트엔드)
- `frontend/src/views/GatewayEnvSettings.vue` — 온보드 탭 내용 교체
- `frontend/src/components/gateway/GpioRelayManager.vue` — 신규 컴포넌트 (JSX → Vue)
- `frontend/src/api/gateway-env.api.ts` — `gpioPin` 필드 추가 (타입만)

### ✅ 변경 대상 (백엔드 — 최소한으로만)
- `backend/database/migrations/013_gpio_pin.sql` — `gpio_pin` 컬럼 추가 마이그레이션
- `backend/src/modules/gateway-env/entities/gateway-onboard-device.entity.ts` — `gpioPin` 컬럼 추가
- `backend/src/modules/gateway-env/dto/update-onboard-device.dto.ts` — `gpioPin` 필드 추가
- `backend/src/modules/gateway-env/gateway-env.service.ts` — `updateOnboardDevice`에 `gpioPin` 저장 처리
- `backend/src/modules/mqtt/mqtt.service.ts` — GPIO 릴레이 명령 MQTT 발행 메서드 추가
- 신규: `backend/src/modules/gpio/` 모듈 — HTTP API → MQTT GPIO 명령 브리지

### ✅ 변경 대상 (라즈베리파이)
- `raspberry-pi/gpio-agent/index.js` — 신규 GPIO 에이전트 (MQTT 구독 → `onoff` 라이브러리로 GPIO 제어)
- `raspberry-pi/gpio-agent/package.json`
- `raspberry-pi/systemd/gpio-agent.service` — systemd 서비스 파일

### ❌ 변경 금지
- 기존 Zigbee 릴레이 API (`/gateway-env/zigbee/*`)
- `syncOnboardToDevices()` 로직
- `ensureOnboardDevices()` 슬롯 초기화 로직
- 기존 MQTT 센서/장치 핸들러

---

## 4. 기술 설계

### 4-1. DB 변경 (Migration 013)
```sql
ALTER TABLE gateway_onboard_devices
  ADD COLUMN IF NOT EXISTS gpio_pin INT;
-- BCM 핀 번호 (2~27), NULL = 미배정
```

### 4-2. GPIO 제어 MQTT 토픽
```
발행: farm/{gatewayId}/gpio/relay
페이로드: { "slot": "zone_1", "pin": 17, "state": true, "durationMs": 5000 }

Pi 응답: farm/{gatewayId}/gpio/status
페이로드: { "slot": "zone_1", "pin": 17, "state": true, "timestamp": "..." }
```

### 4-3. 백엔드 GPIO 모듈
```
POST /gpio/:gatewayId/relay
Body: { slot: string, state: boolean, durationMs?: number }
→ MQTT 발행: farm/{gatewayId}/gpio/relay
```

### 4-4. Pi GPIO 에이전트
- `npm install mqtt onoff` 
- MQTT 구독: `farm/{gatewayId}/gpio/relay`
- 수신 시: `onoff.Gpio(pin, 'out').writeSync(state ? 1 : 0)`
- 상태 응답: `farm/{gatewayId}/gpio/status`
- `durationMs` 있으면 자동 해제 (setTimeout)
- systemd 서비스로 부팅 자동 시작

### 4-5. Vue 컴포넌트 구조
```
GpioRelayManager.vue
├── 상태 요약 (장치 수, 핀 배정, 충돌)
├── FanDeviceCard.vue (또는 인라인)
│   ├── 헤더: 이름, enabled 토글, 펼치기/접기
│   └── 채널: GPIO 핀 선택 (BCM), active 토글
├── IrrigationDeviceCard.vue
│   ├── 헤더: 이름, enabled 토글, 펼치기/접기
│   └── 채널 목록: 각 슬롯 → GPIO 핀 선택
└── GpioPinMap.vue (하단 핀 현황 시각화)
```

---

## 5. 구현 순서 (Do Phase 체크리스트)

### Step 1: DB 마이그레이션
- [ ] `013_gpio_pin.sql` 작성 및 적용
- [ ] Entity, DTO, Service 업데이트

### Step 2: Pi GPIO 에이전트
- [ ] `raspberry-pi/gpio-agent/index.js` 작성
- [ ] `raspberry-pi/gpio-agent/package.json` 작성
- [ ] `raspberry-pi/systemd/gpio-agent.service` 작성
- [ ] MQTT 연결, gpio/relay 구독, onoff 제어 로직

### Step 3: 백엔드 GPIO 모듈
- [ ] `backend/src/modules/gpio/gpio.module.ts`
- [ ] `backend/src/modules/gpio/gpio.controller.ts` — POST /gpio/:gatewayId/relay
- [ ] `backend/src/modules/gpio/gpio.service.ts` — MQTT 발행
- [ ] `app.module.ts`에 등록

### Step 4: 프론트엔드 컴포넌트
- [ ] `GpioRelayManager.vue` 신규 작성 (JSX → Vue 변환)
  - 상태 요약 카드 (장치 수, 채널, 핀 배정, 충돌)
  - 팬 그룹: fan_1..4 각각 카드
  - 관수 그룹: 하나의 접을 수 있는 카드로 묶기
  - GPIO 핀 드롭다운 (BCM 2~27, 사용중 비활성화)
  - 채널 active 토글
  - 핀 충돌 경고 배너
  - GPIO 핀 현황 시각화 (하단)
- [ ] `GatewayEnvSettings.vue` 온보드 탭 → `GpioRelayManager` 컴포넌트로 교체

### Step 5: 저장 & 검증
- [ ] GPIO 핀 변경 → 백엔드 PATCH `/onboard/:id` 저장
- [ ] Pi 에이전트 연결 → GPIO 핀 제어 테스트

---

## 6. 의존성 & 전제 조건

| 항목 | 상태 |
|------|------|
| DB 마이그레이션 013 적용 | 구현 필요 |
| Pi에 Node.js 설치 | 기존 config-agent 사용 중이므로 OK |
| Pi에 `onoff` npm 패키지 | 신규 설치 필요 (`npm i onoff`) |
| MQTT Broker 접근 가능 | 기존 인프라 재사용 |
| 기존 `gateway_onboard_devices` 테이블 | 이미 존재 |

---

## 7. 비기능 요구사항

- **스타일**: 기존 다크 테마 CSS 변수 (`--card-bg`, `--border-color` 등) 재사용
- **반응형**: 모바일에서 채널 그리드 1컬럼, 데스크탑 auto-fill
- **오류 처리**: GPIO 핀 미배정 상태에서도 UI 정상 동작
- **Pi 없는 환경**: GPIO 명령 발행 실패 시 에러 토스트만 표시, 크래시 없음

---

## 8. 용어 정의

| 용어 | 설명 |
|------|------|
| BCM 핀 | Raspberry Pi GPIO 핀 번호 체계 (BCM 2~27, 총 26개) |
| 슬롯 (slot) | `gateway_onboard_devices`의 고정 행 (fan_1, zone_1 등) |
| 채널 | JSX 프로토타입에서의 용어, 슬롯과 1:1 매핑 |
| GPIO 에이전트 | Pi에서 실행되는 신규 Node.js 서비스 |
| Config 에이전트 | 기존 Z2M 설정 배포용 Pi 서비스 (변경 없음) |
