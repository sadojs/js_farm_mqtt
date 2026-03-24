# MQTT Integration 계획서

> Tuya Cloud API를 Zigbee2MQTT + MQTT 프로토콜로 전면 교체

## 1. 개요

### 1.1 배경
현재 smart-farm-platform은 Tuya Cloud API를 통해 센서 데이터 수집(5분 polling)과 장비 제어를 수행한다. 이를 로컬 Zigbee/MQTT 방식으로 전환하여 클라우드 의존성을 제거하고 실시간성을 확보한다.

### 1.2 목표
- Tuya Cloud API 의존성 **완전 제거**
- MQTT subscribe 기반 **실시간** 센서 데이터 수집 (5분 polling → 즉시)
- MQTT publish 기반 장비 제어
- 라즈베리파이 SD카드 이미지로 **원클릭 배포** 가능한 Zigbee 게이트웨이 구축

### 1.3 시스템 아키텍처

```
┌──────────────────────────────────────────────────────┐
│                    라즈베리파이 (Zigbee Gateway)         │
│                                                        │
│  ┌─────────────┐    ┌──────────────┐    ┌───────────┐ │
│  │ Tuya         │    │              │    │           │ │
│  │ ZNDongle-E  │───→│ Zigbee2MQTT  │───→│ Mosquitto │ │
│  │ (USB)       │    │              │    │ (Broker)  │ │
│  └─────────────┘    └──────────────┘    └─────┬─────┘ │
│                                               │       │
└───────────────────────────────────────────────┼───────┘
                                                │ MQTT (1883)
                                                │ (로컬 네트워크)
┌───────────────────────────────────────────────┼───────┐
│                    맥미니 (웹서버)               │       │
│                                               │       │
│  ┌──────────────┐    ┌──────────────┐         │       │
│  │   Frontend   │    │   Backend    │←────────┘       │
│  │  (Vue 3)     │←──→│  (NestJS)    │                 │
│  │  :5174       │    │  :3100       │                 │
│  └──────────────┘    └──────┬───────┘                 │
│                             │                         │
│                      ┌──────┴───────┐                 │
│                      │  PostgreSQL   │                 │
│                      │  TimescaleDB  │                 │
│                      └──────────────┘                 │
└───────────────────────────────────────────────────────┘
```

## 2. 교체 대상 분석

### 2.1 Tuya 의존 파일 (백엔드)

| 파일 | 현재 역할 | 교체 방식 |
|------|----------|----------|
| `integrations/tuya/tuya.service.ts` | Tuya Cloud API 호출 (인증, 요청 서명) | **삭제** → MqttService로 대체 |
| `integrations/tuya/tuya.controller.ts` | `POST /tuya/test-connection`, `GET /tuya/devices` | **삭제** → Zigbee2MQTT API로 대체 |
| `integrations/tuya/tuya.module.ts` | TuyaService DI 등록 | **삭제** → MqttModule로 대체 |
| `sensors/sensor-collector.service.ts` | 5분 polling으로 Tuya에서 센서 데이터 수집 | **전면 수정** → MQTT subscribe 기반 |
| `devices/devices.service.ts` | 장비 등록(tuyaDeviceId), 제어(Tuya API), 상태 동기화 | **수정** → MQTT 기반 제어/상태 |
| `devices/devices.controller.ts` | 제어/상태 엔드포인트에서 TuyaService 호출 | **수정** → MqttService 호출 |
| `users/entities/tuya-project.entity.ts` | Tuya API 키 저장 엔티티 | **삭제** → 불필요 (MQTT는 인증 별도) |
| `app.module.ts` | TuyaModule import | **수정** → MqttModule import |

### 2.2 Tuya 의존 파일 (프론트엔드)

| 파일 | 현재 역할 | 교체 방식 |
|------|----------|----------|
| `DeviceRegistration.vue` | Tuya Cloud에서 장비 목록 로드 | **수정** → Zigbee2MQTT에서 장비 목록 로드 |
| `device.api.ts` | `GET /tuya/devices` 호출 | **수정** → 새 엔드포인트 호출 |
| `tuya-errors.ts` | Tuya 에러 코드 매핑 | **삭제** |
| `ProjectAssignModal.vue` | Tuya 프로젝트 설정 UI | **삭제** 또는 MQTT 설정 UI로 변경 |
| `UserFormModal.vue` | Tuya 프로젝트 연동 | **수정** → Tuya 관련 필드 제거 |
| `device.types.ts` | tuyaDeviceId 타입 | **수정** → zigbeeId/ieeeAddress로 변경 |

### 2.3 센서 타입 매핑 변경

```
현재 (Tuya property code):              변경 (Zigbee2MQTT payload key):
va_temperature → temperature            temperature → temperature
va_humidity → humidity                   humidity → humidity
co2_value → co2                         co2 → co2
temp_current → temperature              illuminance_lux → illuminance
humidity_value → humidity               soil_moisture → soil_moisture
```

## 3. 구현 계획

### Phase A: 라즈베리파이 Zigbee Gateway 구축

#### A-1. SD카드 이미지 프로젝트 구성
```
smart-farm-mqtt/
└── raspberry-pi/
    ├── setup.sh                 # 원클릭 설치 스크립트
    ├── mosquitto/
    │   └── mosquitto.conf       # MQTT Broker 설정
    ├── zigbee2mqtt/
    │   └── configuration.yaml   # Zigbee2MQTT 설정
    └── systemd/
        ├── mosquitto.service    # 부팅 시 자동 시작
        └── zigbee2mqtt.service  # 부팅 시 자동 시작
```

#### A-2. setup.sh 스크립트 기능
1. Mosquitto 설치 및 설정 복사
2. Zigbee2MQTT 설치 (Node.js 포함)
3. ZNDongle-E USB 디바이스 권한 설정 (udev rules)
4. systemd 서비스 등록 (부팅 시 자동 시작)
5. 방화벽 설정 (1883, 8080 포트)
6. `.env`에서 MQTT 비밀번호 설정 (선택)

#### A-3. 배포 프로세스
```
1. Raspberry Pi OS Lite를 SD카드에 굽기
2. SSH 활성화 + WiFi 설정
3. SD카드에 raspberry-pi/ 폴더 복사
4. 부팅 후 SSH 접속 → bash setup.sh 실행
5. ZNDongle-E USB 연결
6. Zigbee2MQTT 웹UI(8080)에서 장비 페어링
```

### Phase B: 백엔드 MQTT 모듈 구현

#### B-1. MqttModule 신규 생성
```
modules/mqtt/
├── mqtt.module.ts           # 모듈 정의
├── mqtt.service.ts          # MQTT 클라이언트 (connect, subscribe, publish)
├── mqtt-sensor.handler.ts   # 센서 데이터 수신 핸들러
├── mqtt-device.handler.ts   # 장비 상태/가용성 핸들러
└── mqtt.types.ts            # MQTT 관련 타입 정의
```

#### B-2. MqttService 핵심 기능
```typescript
// 연결 관리
connect(brokerUrl: string): Promise<void>
disconnect(): Promise<void>
isConnected(): boolean

// 구독 (센서 데이터 수신)
subscribe(topic: string): void
// zigbee2mqtt/+  → 모든 장비의 센서 데이터
// zigbee2mqtt/+/availability → 온라인/오프라인

// 발행 (장비 제어)
publish(topic: string, payload: object): Promise<void>
// zigbee2mqtt/{name}/set → { "state": "ON" }

// Zigbee2MQTT Bridge API
getDevices(): Promise<ZigbeeDevice[]>  // zigbee2mqtt/bridge/devices
permitJoin(enable: boolean): void       // 페어링 모드
```

#### B-3. 센서 수집 방식 변경
```
Before (Tuya):
  @Cron(EVERY_5_MINUTES) → loop devices → TuyaService.getDeviceStatus()
  → parse Tuya property codes → save to sensor_data

After (MQTT):
  @OnMqttMessage('zigbee2mqtt/+')
  → parse JSON payload (temperature, humidity, co2...)
  → save to sensor_data → broadcast via WebSocket
```

#### B-4. 장비 제어 방식 변경
```
Before (Tuya):
  POST /devices/:id/control → TuyaService.sendDeviceCommand({code, value})

After (MQTT):
  POST /devices/:id/control → MqttService.publish('zigbee2mqtt/{name}/set', {state: 'ON'})
```

#### B-5. 장비 탐색 방식 변경
```
Before (Tuya):
  GET /tuya/devices → Tuya Cloud에서 장비 목록

After (MQTT):
  GET /zigbee/devices → Zigbee2MQTT bridge/devices 토픽 또는 HTTP API
```

### Phase C: 프론트엔드 수정

#### C-1. 장비 등록 위저드 수정
- Step 1: Tuya 장비 로드 → **Zigbee2MQTT 장비 로드**
- Tuya category 기반 분류 → **Zigbee device definition 기반 분류**
- tuyaDeviceId → **ieeeAddress** (Zigbee 고유 주소)

#### C-2. 삭제/수정 대상
- `tuya-errors.ts` 삭제
- `ProjectAssignModal.vue` → MQTT Broker 설정 UI로 변경 (또는 삭제)
- 사용자 설정에서 Tuya API 키 입력 → 제거

### Phase D: DB 스키마 변경

#### D-1. devices 테이블
```sql
-- 변경
ALTER TABLE devices RENAME COLUMN tuya_device_id TO zigbee_id;  -- IEEE 주소
-- 추가
ALTER TABLE devices ADD COLUMN friendly_name VARCHAR;            -- Zigbee2MQTT 표시명
ALTER TABLE devices ADD COLUMN zigbee_model VARCHAR;             -- 장비 모델명
```

#### D-2. tuya_projects 테이블
```sql
-- 삭제 (더 이상 불필요)
DROP TABLE tuya_projects;
```

#### D-3. mqtt_config 테이블 (신규, 선택사항)
```sql
CREATE TABLE mqtt_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  broker_url VARCHAR NOT NULL DEFAULT 'mqtt://localhost:1883',
  username VARCHAR,
  password_encrypted VARCHAR,
  zigbee2mqtt_url VARCHAR DEFAULT 'http://localhost:8080',
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

## 4. 구현 순서

```
Phase A: 라즈베리파이 (1일)
  A-1. raspberry-pi/ 폴더 및 setup.sh 작성
  A-2. Mosquitto/Zigbee2MQTT 설정 파일
  A-3. systemd 서비스 파일
  A-4. 실제 라즈베리파이에서 테스트

Phase B: 백엔드 MQTT 모듈 (2-3일)
  B-1. mqtt 패키지 설치 (mqtt.js)
  B-2. MqttModule/MqttService 구현
  B-3. 센서 핸들러 구현 (MQTT subscribe → sensor_data)
  B-4. 장비 제어 핸들러 구현 (MQTT publish)
  B-5. Zigbee2MQTT bridge API 연동 (장비 탐색)
  B-6. TuyaModule 삭제, app.module 수정
  B-7. DB 마이그레이션 (devices 테이블, tuya_projects 삭제)

Phase C: 프론트엔드 수정 (1-2일)
  C-1. DeviceRegistration.vue 수정 (Zigbee 장비 탐색)
  C-2. device.api.ts 엔드포인트 변경
  C-3. Tuya 관련 UI/유틸 삭제
  C-4. 사용자 설정 UI 수정

Phase D: 통합 테스트 (1일)
  D-1. 라즈베리파이 ↔ 맥미니 MQTT 통신 테스트
  D-2. 실제 Zigbee 센서 페어링 → 데이터 수신 확인
  D-3. 스마트 스위치 제어 테스트
  D-4. 기존 기능 (대시보드, 자동화, 리포트) 정상 동작 확인
```

## 5. 위험 요소 및 대응

| 위험 | 영향 | 대응 |
|------|------|------|
| ZNDongle-E가 Zigbee2MQTT에서 인식 안됨 | 전체 차단 | Zigbee2MQTT 호환 목록 사전 확인 (ZNDongle-E는 공식 지원) |
| MQTT 메시지 유실 | 센서 데이터 누락 | QoS 1 설정, Mosquitto persistence 활성화 |
| Zigbee 장비의 property 이름이 Tuya와 다름 | 센서 매핑 오류 | Zigbee2MQTT expose 기반으로 동적 매핑 |
| 라즈베리파이 재부팅 시 서비스 미시작 | 데이터 수집 중단 | systemd enable + watchdog 설정 |
| 기존 자동화 룰이 Tuya 기반 | 자동화 동작 안함 | 자동화 엔진의 제어 경로만 MQTT로 변경 (룰 구조는 동일) |

## 6. 성공 기준

- [ ] 라즈베리파이 setup.sh 실행만으로 Zigbee Gateway 구동
- [ ] Zigbee 센서 데이터가 MQTT를 통해 실시간으로 sensor_data에 저장
- [ ] 스마트 스위치가 MQTT publish로 ON/OFF 제어 가능
- [ ] 기존 대시보드, 자동화, 그룹, 리포트 기능 모두 정상 동작
- [ ] Tuya 관련 코드 0개 (완전 제거)
- [ ] 5분 polling 없이 실시간 데이터 수신
