# 센서 측정값 단위 선택 + 온습도 분기 (Plan)

## 배경

현재 자동제어 위저드의 온도 트리거는 "측정기(device)"를 선택하는 구조다.
그러나 하나의 센서 장치(예: SHT30, 토양 복합센서)는 **여러 측정 채널**(온도/습도, 토양수분/EC 등)을
동시에 보고하므로, 측정기 단위 선택만으로는 어떤 채널을 트리거에 사용할지 명시할 수 없다.

또한 현재 위저드는 "온도" 단일 모드만 지원하지만, 실사용 측면에서 동일 UI로 온/습도를 모두 다룰 수 있어야 한다.

## 변경 목표

1. 트리거 대상이 **(device_id, sensor_field, current_value)** 튜플 단위가 되도록 한다.
   - 표시 예시: `온습도센서1 — 온도 (24.2°C)` / `온습도센서1 — 습도 (62%)`
2. 트리거 종류를 **"온습도"** 로 통합하고, 내부적으로 `field: 'temperature' | 'humidity'` 라디오/세그먼트로 분기한다.
3. CREATE 위저드(IntentWizard v2)와 EDIT 위저드(RuleWizardModal) 양쪽에서 동일한 데이터 모델을 사용한다.
   - CREATE: 장치-측정 채널을 위저드의 timing 단계 온습도 탭에서 선택
   - EDIT: 장치는 별도 스텝(StepActuatorSelect)에서 이미 선택되어 있음 → 측정 채널만 선택

## 데이터 모델 변경

### 프론트 — `v2/types.ts`

```ts
export interface SensorReadingTarget {
  deviceId: string
  field: 'temperature' | 'humidity'   // 추후 co2, soil_moisture 등 확장
}

export interface OpenerFanState {
  ...
  // 기존 sensorDeviceId 제거, 다음으로 대체
  sensorTarget?: SensorReadingTarget
}
```

### 백엔드 — 조건 스키마 (변경 없음, 사용 패턴만 정착)

조건 객체에는 이미 `sensor_device_id` 와 `field` 가 존재한다.
현재 `field` 는 'temperature' 고정 → 'humidity' 도 허용하도록 검증만 완화.

```jsonc
{
  "type": "sensor",
  "sensor_device_id": "<uuid>",
  "field": "temperature" | "humidity",
  "operator": "gte",
  "value": 28,
  "deviation": 2,
  "unit": "°C" | "%"
}
```

## UI 변경

### CREATE (StepTimingByIntent.vue) — 온습도 탭

```
┌─────────────────────────────────────────┐
│ ⏰ 시간으로   │   🌡️ 온습도로            │
└─────────────────────────────────────────┘

  📡 측정값 선택
  ┌─────────────────────────────────────┐
  │ 온습도센서1 — 온도 (24.2°C)      ▼ │
  └─────────────────────────────────────┘
    옵션 목록 (구역 내 sensor 디바이스의 모든 채널 평탄화):
      • 온습도센서1 — 온도 (24.2°C)
      • 온습도센서1 — 습도 (62%)
      • 토양센서A — 토양수분 (31%)

  🎯 기준값:   [ 28  ] {°C|%}
  ↕️ 편차:    [ 2.0 ] {°C|%}

  미리보기:
    🟢 30.0°C 이상이면 → 열림
    🔴 26.0°C 이하면 → 닫힘
```

- 단위(°C/%)는 선택된 channel 의 field 로 자동 결정한다.
- 라벨/단위 매핑:
  - `temperature` → °C
  - `humidity` → %

### EDIT (RuleWizardModal → StepConditionBuilder) — 측정 채널 셀렉터

- 2단계(StepSensorSelect)에서는 기존 device 단위 선택 유지(다중 가능, 활동 로그 표시 용도).
- 4단계(StepConditionBuilder)에서 온도/습도 조건 추가 시:
  - 기존 `sensor_device_id` select 옆에 `field` select 를 함께 노출.
  - 옵션은 해당 device 가 실제로 발행하는 readings 만 포함 (메타데이터 또는 최근 24h sensor_data 기준).

## 데이터 소스: "장치별 readings" 어떻게 구하나

옵션 A (권장, 빠름) — 최근 N시간 `sensor_data` 에서 DISTINCT `sensor_type` 조회
```sql
SELECT DISTINCT sensor_type, last(value, time) as last_value, last(unit, time) as unit
FROM sensor_data
WHERE device_id = $1 AND time >= now() - interval '24 hours'
GROUP BY sensor_type;
```
→ 새 API `GET /devices/:id/sensor-channels` 추가.

옵션 B (구조적) — `devices.deviceSettings.exposes` 등 메타데이터에 capability 등록
- Zigbee2MQTT `bridge/devices` 가 `definition.exposes` 를 제공하므로 mqtt-bridge handler 에서 동기화.
- 새 장치 등록/페어링 시 채워둠 → API 단순화.

**채택안**: 우선 A 로 신속 구현, 추후 B 마이그레이션.

## 추가 API

`GET /devices/:id/sensor-channels` → `[{ field, lastValue, unit, updatedAt }]`

## 마이그레이션 / 호환

- 기존 룰의 조건 `field: 'temperature'` 는 그대로 동작 (기본값).
- v2 트랜스포머는 `trigger.sensorTarget.field` 를 `mainCond.field` 로 그대로 전파.
- 단위 표기(`unit`)는 신규 룰만 채우고, 구 룰 호환 위해 `unit` 없으면 field 로부터 추론.

## 영향 파일

- `frontend/src/components/automation/v2/types.ts`
- `frontend/src/components/automation/v2/StepTimingByIntent.vue` — UI + 셀렉터
- `frontend/src/components/automation/v2/IntentWizardModal.vue` — 배선
- `frontend/src/components/automation/v2/transformV2ToLegacy.ts` — `field`/`unit` 전파
- `frontend/src/components/automation/StepConditionBuilder.vue` — field 셀렉터 추가
- `frontend/src/composables/useRuleWizardV2.ts` — `canProceed` 에 `sensorTarget.field` 필수 검증
- `frontend/src/api/sensor.api.ts` — `getSensorChannels(deviceId)` 추가
- `backend/src/modules/devices/devices.controller.ts` — `GET /devices/:id/sensor-channels`
- `backend/src/modules/devices/devices.service.ts` — TimescaleDB 쿼리 헬퍼

## 작업 순서

1. 백엔드: `sensor-channels` 엔드포인트 + 서비스 메서드 (1h)
2. 프론트 API/타입 추가 (15m)
3. v2 위저드 온습도 탭 UI 교체 + 셀렉터 (1.5h)
4. 트랜스포머 `field/unit` 전파 (15m)
5. EDIT 위저드 StepConditionBuilder field 셀렉터 (45m)
6. 마이그레이션 검증: 구 룰 열기 → 표시 정상, 새 룰 저장 → 재수정 시 채널 사전 선택 (30m)
7. 브라우저 수동 검증 (mtest/admin123 + admin)

**예상 총 작업량**: ~4시간

## 미해결 의사 결정

- [ ] CREATE 위저드에서 측정 채널 선택은 "온/습도" 탭 1단계인가, 별도 스텝인가?
      → 1단계 내부에 인라인 셀렉터 (현재 PR과 동일 패턴)로 권장.
- [ ] 옵션 B(메타데이터) 적용 시점?
      → 본 작업은 옵션 A 로만, B 는 별도 PDCA.
- [ ] 토양수분/CO2 등 추가 채널 지원은 본 PR 범위? → 다음 단계로 미룸.
