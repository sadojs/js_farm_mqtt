# Plan: platform-v2-upgrade

> 스마트팜 플랫폼 대규모 구조 개편 v2
> 작성일: 2026-05-08 (수정: 2026-05-08)

---

## 1. 배경 및 목적

### 현재 구조의 한계
- 장치(device)가 오직 Zigbee 장치만 지원 (`zigbee_ieee` 필수)
- Raspberry Pi GPIO/릴레이 출력은 별도 모델 없이 채널 매핑으로만 처리
- 장치 관리(등록·수정·삭제)가 Devices 페이지와 Groups 페이지에 분산
- 개폐기 인터록 등 장치 타입별 안전 로직이 특정 진입점에만 존재 (voice.service.ts)
- 온습도 센서가 여러 개일 때 자동화 규칙에서 어느 센서를 기준으로 할지 선택 불가
- 구역(House)과 게이트웨이(Gateway) 간 명시적 연결 없음

### 목표
라즈베리파이 중심의 통합 환경 설정 페이지("게이트웨이 환경 설정")를 도입하여
모든 장치 관리(GPIO 온보드 + Zigbee 추가 장치)를 한 곳에서 처리하고,
자동화 규칙에서 다중 센서 선택을 지원한다.

---

## 2. 핵심 결정 사항 (요구사항 정리)

### 2-A. Onboard GPIO 관수 장치
- GPIO 채널은 **하드웨어 순서 고정** → 채널 매핑 설정 불필요
- 환경 설정에서 **활성화/비활성화 토글만** 제공
- 관수 시간 스케줄은 **자동화(Automation) 설정**에서 관리 (기존 IrrigationSchedulerService 유지)
- 장치 10~17번은 모두 관주 관련 장치로 하나의 서브 섹션으로 묶음

### 2-B. Zigbee 관수 장치 (추가 시)
- 채널 매핑 설정 제공 (기존 `channel-mapping.constants.ts` 로직 유지)
- 스케줄은 마찬가지로 Automation에서 관리

### 2-C. 자동화 설정에서 관수 장치 선택
- 관수 자동화 룰 생성 시, **활성화(enabled=true)된 장치만** 목록에 표시
- 선택된 장치에 대해 시간/스케줄 설정 (기존 IrrigationSequenceBuilder 재사용)

### 2-D. 다중 온습도 센서
- 자동화 온도/습도 조건 생성 시 **특정 센서 장치 선택** 가능
- `null`이면 기존 로직(구역 대표 센서) 동작 유지

---

## 3. 핵심 변경 범위

### 3-A. 데이터 모델 변경

#### 신규 테이블: `gateway_onboard_devices`
GPIO/릴레이 온보드 장치를 표현하는 새 모델.
Zigbee 장치(devices 테이블)와 별개로 관리.

```
gateway_onboard_devices
  id               UUID PK
  gateway_id       UUID FK → gateways.id
  slot_key         VARCHAR  -- 고정 식별자: opener_1_open, fan_1, zone_1, mixer 등
  slot_type        VARCHAR  -- opener_open | opener_close | fan | irrigation_zone
                            -- remote_control | fertilizer_contact | mixer | fertilizer_motor
  pair_key         VARCHAR  -- 개폐기 쌍 식별자 (opener_1, opener_2, opener_3)
  name             VARCHAR  -- 사용자 지정 표시명
  enabled          BOOLEAN  -- 활성화 여부 (비활성화 시 장치 페이지에 노출 안 됨)
  sort_order       INT      -- 정렬 순서
  created_at       TIMESTAMPTZ
  updated_at       TIMESTAMPTZ
```

> 관수 장치는 기존 `automation_rules`의 `conditions.type = 'irrigation'`으로 스케줄 관리.
> 채널 매핑은 Zigbee 장치(`devices.channelMapping`)에만 해당, onboard는 불필요.

**17개 기본 slot_key:**
| slot_key | slot_type | pair_key | 기본 이름 |
|----------|-----------|----------|---------|
| opener_1_open | opener_open | opener_1 | 개폐기 1번 열림 |
| opener_1_close | opener_close | opener_1 | 개폐기 1번 닫힘 |
| opener_2_open | opener_open | opener_2 | 개폐기 2번 열림 |
| opener_2_close | opener_close | opener_2 | 개폐기 2번 닫힘 |
| opener_3_open | opener_open | opener_3 | 개폐기 3번 열림 |
| opener_3_close | opener_close | opener_3 | 개폐기 3번 닫힘 |
| fan_1 | fan | - | 유동휀 1번 |
| fan_2 | fan | - | 유동휀 2번 |
| fan_3 | fan | - | 유동휀 3번 |
| remote_control | remote_control | - | 원격제어 |
| fertilizer_contact | fertilizer_contact | - | 액비/교반기 B접점 |
| zone_1 | irrigation_zone | - | 1구역 관주 |
| zone_2 | irrigation_zone | - | 2구역 관주 |
| zone_3 | irrigation_zone | - | 3구역 관주 |
| zone_4 | irrigation_zone | - | 4구역 관주 |
| mixer | mixer | - | 교반기 |
| fertilizer_motor | fertilizer_motor | - | 액비 |

#### 기존 테이블 변경: `gateways`
```diff
+ house_id   UUID FK → houses.id   -- 구역(하우스)에 게이트웨이 할당
```

#### 기존 테이블 변경: `devices`
```diff
- zigbee_ieee VARCHAR NOT NULL  →  + zigbee_ieee VARCHAR NULLABLE
+ source      VARCHAR DEFAULT 'zigbee'  -- 'zigbee' | 'onboard'
+ onboard_device_id UUID FK → gateway_onboard_devices.id
```

#### 기존 테이블 변경: `automation_rules` (조건 JSON 스키마 확장)
```diff
-- conditions.items[] 내부에 sensor_device_id 필드 추가
{
  "type": "temperature",
+ "sensor_device_id": "uuid-of-specific-sensor",  -- null이면 구역 대표 센서
  "operator": ">",
  "value": 28
}
```

### 3-B. 새 백엔드 모듈

#### `gateway-env` 모듈 (신규)
게이트웨이 환경 설정 전담 모듈.

```
backend/src/modules/gateway-env/
  gateway-env.module.ts
  gateway-env.controller.ts   -- /api/gateway-env/:gatewayId/*
  gateway-env.service.ts
  entities/
    gateway-onboard-device.entity.ts
  dto/
    update-onboard-device.dto.ts
    add-zigbee-device.dto.ts
```

**API 엔드포인트:**
```
GET    /api/gateway-env/:gatewayId/onboard        -- 온보드 장치 목록 (17개, 없으면 자동 초기화)
PATCH  /api/gateway-env/:gatewayId/onboard/:id    -- 이름 변경 / 활성화 토글
GET    /api/gateway-env/:gatewayId/zigbee         -- 추가된 Zigbee 장치 목록
POST   /api/gateway-env/:gatewayId/zigbee         -- Zigbee 장치 추가
PATCH  /api/gateway-env/:gatewayId/zigbee/:id     -- Zigbee 장치 이름/채널매핑 수정
DELETE /api/gateway-env/:gatewayId/zigbee/:id     -- Zigbee 장치 삭제
GET    /api/gateway-env/:gatewayId/zigbee/scan    -- 페어링 대기 장치 목록
```

#### `gateway-manager` 모듈 변경
```
PATCH /api/gateways/:id        -- house_id 할당 추가
```

#### `devices` 모듈 변경
- `GET /api/devices` — enabled onboard + zigbee 통합 반환 (비활성화 onboard 제외)
- `DELETE /api/devices/:id` — 제거 (gateway-env에서만 가능)
- `PATCH /api/devices/:id/name` — 제거 (gateway-env에서만 가능)
- `DevicesService.controlDevice()` — 개폐기 인터록 로직 통합

#### `automation` 모듈 변경
- 관수 자동화 장치 목록 조회 시 `enabled=true` 필터 적용
- `AutomationRunnerService`: 온도/습도 조건에 `sensor_device_id` 평가 추가

### 3-C. 프론트엔드 변경

#### 신규 페이지: `GatewayEnvSettings.vue`
경로: `/gateway-env/:gatewayId`
접근: admin, farm_admin

**UI 구성 — 온보드 섹션:**
```
▶ 온보드 장치 (GPIO/릴레이)

[개폐기]
  개폐기 1   [이름 수정]  [활성화 토글]   ← 열림/닫힘 쌍으로 한 행
  개폐기 2   [이름 수정]  [활성화 토글]
  개폐기 3   [이름 수정]  [활성화 토글]

[유동휀]
  유동휀 1   [이름 수정]  [활성화 토글]
  유동휀 2   [이름 수정]  [활성화 토글]
  유동휀 3   [이름 수정]  [활성화 토글]

[관주 장치]  ← 10~17번 슬롯 모두 이 섹션
  원격제어         [이름 수정]  [활성화 토글]
  액비/교반기 B접점 [이름 수정]  [활성화 토글]
  1구역 관주       [이름 수정]  [활성화 토글]   ← 스케줄 없음, 채널 매핑 없음
  2구역 관주       [이름 수정]  [활성화 토글]
  3구역 관주       [이름 수정]  [활성화 토글]
  4구역 관주       [이름 수정]  [활성화 토글]
  교반기           [이름 수정]  [활성화 토글]
  액비             [이름 수정]  [활성화 토글]
```

**UI 구성 — Zigbee 섹션:**
```
▶ Zigbee 장치

  [추가된 Zigbee 장치 목록]
  - 센서: [이름 수정] [구역 할당] [삭제]
  - 휀:   [이름 수정] [구역 할당] [삭제]
  - 개폐기 쌍: [이름 수정] [구역 할당] [삭제]
  - 관수(8ch/12ch): [이름 수정] [채널 매핑▼] [구역 할당] [삭제]

                              [+ Zigbee 장치 추가]
```

> **Zigbee 관수만** 채널 매핑 패널 표시. Onboard 관수는 채널 매핑 없음.

#### 변경 페이지: `GatewayManagement.vue`
- 게이트웨이 카드에 "환경 설정" 버튼 → GatewayEnvSettings로 이동
- 게이트웨이 수정 시 구역(House) 할당 드롭다운 추가

#### 변경 페이지: `Groups.vue` (구역 관리)
- 구역 생성/수정 시 게이트웨이 선택 드롭다운 추가

#### 변경 페이지: `Devices.vue`
- 활성화된 장치만 표시
- 삭제 버튼 제거 (환경 설정에서만)
- 이름 수정 버튼 제거 (환경 설정에서만)

#### 변경: 자동화 관수 룰 위저드
- 관수 장치 선택 시 **활성화(enabled=true)된 장치만** 표시
- `StepIrrigationDevice.vue`: enabled 필터 추가

#### 변경 컴포넌트: 자동화 온습도 조건
- 온도/습도 조건 추가 시 "기준 센서 선택" 드롭다운 추가
- `sensor_device_id: null | uuid` 포함하여 저장

---

## 4. 구현 우선순위 및 단계

### Phase 1: DB 마이그레이션 (0.5일)
- [ ] `gateway_onboard_devices` 테이블 생성
- [ ] `gateways.house_id` 컬럼 추가
- [ ] `devices.source`, `devices.onboard_device_id` 컬럼 추가
- [ ] 기존 devices 레코드 source='zigbee' 마이그레이션

### Phase 2: 온보드 장치 API (0.5일)
- [ ] `gateway-env` 모듈 생성
- [ ] 온보드 장치 17개 자동 초기화 (`ensureOnboardDevices`)
- [ ] 온보드 장치 조회/이름수정/활성화토글 API

### Phase 3: Zigbee 장치 환경 API (0.5일)
- [ ] Zigbee 장치 추가/수정/삭제 API (기존 로직 이전)
- [ ] Zigbee 관수 채널 매핑 수정 API
- [ ] devices 모듈에서 삭제/이름수정 제거

### Phase 4: 개폐기 인터록 통합 (0.5일)
- [ ] `DevicesService.controlDevice()`에 인터록 로직 통합 (OFF→1s→ON)
- [ ] `AutomationRunnerService`에 인터록 로직 통합
- [ ] `voice.service.ts` 중복 제거

### Phase 5: 프론트엔드 환경 설정 페이지 (2일)
- [ ] `GatewayEnvSettings.vue` 신규 생성
- [ ] 온보드 섹션 (개폐기 쌍, 휀, 관주 장치 — 이름+토글만)
- [ ] Zigbee 섹션 (추가/수정/삭제, 관수만 채널매핑 패널)
- [ ] 라우터 추가

### Phase 6: 구역-게이트웨이 연결 (0.5일)
- [ ] Groups.vue에 게이트웨이 선택 UI 추가
- [ ] GatewayManagement.vue 환경 설정 버튼 추가

### Phase 7: 자동화 연동 수정 (1일)
- [ ] 관수 자동화 장치 선택 시 enabled 필터 적용
- [ ] automation_rules conditions에 sensor_device_id 추가
- [ ] AutomationRunnerService 특정 센서 조건 평가
- [ ] 자동화 온습도 조건 위저드 센서 선택 드롭다운 추가
- [ ] Devices.vue 변경 (활성 장치만, 삭제/이름수정 제거)

---

## 5. 영향 받는 기존 기능

| 기능 | 영향도 | 처리 방향 |
|------|:----:|---------|
| 장치 등록 위저드 (Devices.vue) | 높음 | GatewayEnvSettings Zigbee 섹션으로 이전 |
| 장치 삭제/이름수정 (Devices.vue) | 높음 | 버튼 제거 |
| 채널 매핑 (DevicesService) | 중간 | Zigbee 장치에만 유지, onboard는 불필요 |
| 관수 스케줄 (IrrigationSchedulerService) | 없음 | 변경 없음 (자동화 룰 기반 그대로) |
| 관수 자동화 위저드 | 낮음 | 장치 선택 시 enabled 필터만 추가 |
| 개폐기 인터록 (voice.service) | 높음 | DevicesService로 통합 |
| 센서 환경 설정 (env-config) | 없음 | 기능 유지, 기존 UI 재활용 |
| 자동화 규칙 (AutomationRunnerService) | 중간 | sensor_device_id 조건 평가 추가 |
| ConfigDeploy (Zigbee2MQTT 설정 배포) | 없음 | 변경 없음 |

---

## 6. 마이그레이션 전략

- 기존 `devices` 레코드: `source='zigbee'` 자동 설정
- 기존 `gateways`: `house_id=NULL` (관리자가 구역 연결 후 지정)
- 온보드 장치: 게이트웨이 환경 설정 최초 진입 시 17개 자동 생성 (`ensureOnboardDevices`)
- 기존 채널 매핑(`devices.channelMapping`): 그대로 유지 (Zigbee 장치)

---

## 7. Out of Scope

- Raspberry Pi GPIO 직접 제어 (추후 검토)
- 온보드 장치 슬롯 추가/삭제 (17개 고정)
- 멀티 농장 간 장치 공유
