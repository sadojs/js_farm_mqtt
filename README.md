# 스마트 농업 자동화 플랫폼 (MQTT)

Zigbee/MQTT 기반의 농업 자동화 플랫폼입니다. 라즈베리파이에 Tuya ZNDongle-E를 연결하고 Zigbee2MQTT를 통해 센서와 스마트 스위치를 제어합니다.

## 시스템 구성

```
Zigbee 센서/스위치
    ↓ Zigbee 프로토콜
Tuya ZNDongle-E (USB)
    ↓
라즈베리파이
  ├── Zigbee2MQTT (Zigbee → MQTT 변환)
  └── Mosquitto (MQTT Broker)
        ↓ MQTT 프로토콜
맥미니 (웹서버)
  ├── Backend (NestJS, 포트 3100)
  └── Frontend (Vue 3, 포트 5174)
```

## 주요 기능

### 센서 모니터링
- 온도, 습도, CO2, 조도 등 실시간 모니터링
- MQTT 구독으로 데이터 즉시 수신 (polling 없음)
- TimescaleDB 시계열 저장 및 분석

### 장비 제어
- Zigbee 스마트 스위치 ON/OFF
- 환풍기, 관수, 개폐기 제어
- MQTT publish로 명령 전송

### 자동화 엔진
- 날씨 기반 (비/강풍 감지 → 자동 제어)
- 시간 기반 (스케줄 급수, 야간 환기)
- 하이브리드 (조건 + 시간 복합)

### 그룹 관리
- 하우스/장비를 그룹으로 묶어 일괄 제어
- 그룹별 환경설정 및 자동화 룰

### 대시보드
- 실시간 센서 데이터 시각화
- 날씨 위젯
- 자동화 상태 모니터링
- 모바일 반응형 UI

## 하드웨어 요구사항

| 장비 | 역할 |
|------|------|
| 라즈베리파이 4/5 | Zigbee2MQTT + MQTT Broker 실행 |
| Tuya ZNDongle-E | Zigbee 코디네이터 (USB) |
| Zigbee 센서 | 온습도, CO2 등 환경 측정 |
| Zigbee 스마트 스위치 | 환풍기, 관수 등 장비 제어 |
| 맥미니 | 웹서버 (Backend + Frontend) |

## 기술 스택

### Backend
- **NestJS** + TypeScript
- **TypeORM** + PostgreSQL + TimescaleDB
- **MQTT.js** — MQTT 클라이언트 (센서 구독, 장비 제어)
- **Redis** + Bull — 캐시 및 Job Queue
- **Socket.io** — 프론트엔드 실시간 통신

### Frontend
- **Vue 3** + TypeScript + Vite
- **Pinia** — 상태 관리
- **Chart.js** — 데이터 시각화
- **Socket.io Client** — 실시간 데이터

### 인프라
- **Mosquitto** — MQTT Broker
- **Zigbee2MQTT** — Zigbee-MQTT 브릿지
- **Docker Compose** — 서비스 오케스트레이션

### APIs
- **Zigbee2MQTT Bridge API** — 장비 탐색 및 관리
- **OpenWeather API** — 날씨 데이터
- **기상청 API** — 한국 지역 날씨

## 빠른 시작

### 필요 조건
- Node.js 18+
- PostgreSQL 15+ (TimescaleDB)
- Redis
- 라즈베리파이 (Zigbee2MQTT 실행용)
- Tuya ZNDongle-E

### 1. 라즈베리파이 설정 (Zigbee2MQTT + Mosquitto)
```bash
# Mosquitto 설치
sudo apt install mosquitto mosquitto-clients

# Zigbee2MQTT 설치 (공식 가이드 참고)
# https://www.zigbee2mqtt.io/guide/installation/
# ZNDongle-E를 USB에 연결 후 /dev/ttyUSB0 확인
```

### 2. 웹서버 설정 (맥미니)
```bash
git clone git@github.com:sadojs/js_farm_mqtt.git
cd smart-farm-mqtt
cp .env.example .env
# .env 파일에서 MQTT_URL을 라즈베리파이 IP로 설정
```

### 3. Backend 실행
```bash
cd backend
npm install
npm run start:dev    # 포트 3100
```

### 4. Frontend 실행
```bash
cd frontend
npm install
npm run dev          # 포트 5174
```

### 서비스 접속
- Frontend: http://localhost:5174
- Backend API: http://localhost:3100
- Zigbee2MQTT: http://라즈베리파이IP:8080

## 프로젝트 구조

```
smart-farm-mqtt/
├── backend/
│   └── src/
│       ├── modules/
│       │   ├── mqtt/           # MQTT 클라이언트 (구독/발행)
│       │   ├── sensors/        # 센서 데이터 처리
│       │   ├── devices/        # 장비 관리 및 제어
│       │   ├── automation/     # 자동화 엔진
│       │   ├── groups/         # 그룹 관리
│       │   ├── env-config/     # 환경 설정
│       │   ├── dashboard/      # 대시보드 데이터
│       │   ├── auth/           # 인증 (JWT)
│       │   └── weather/        # 날씨 데이터
│       └── main.ts
├── frontend/
│   └── src/
│       ├── components/         # UI 컴포넌트
│       ├── views/              # 페이지
│       ├── stores/             # Pinia 스토어
│       └── api/                # API 클라이언트
├── mosquitto/                  # Mosquitto 설정
├── zigbee2mqtt/                # Zigbee2MQTT 설정
├── docker-compose.yml
└── .env.example
```

## MQTT 토픽 구조

```
zigbee2mqtt/{device_name}              → 센서값 수신 (JSON)
zigbee2mqtt/{device_name}/set          → 장비 제어 명령
zigbee2mqtt/{device_name}/availability → 온라인/오프라인 상태
zigbee2mqtt/bridge/devices             → 페어링된 장비 목록
zigbee2mqtt/bridge/state               → 브릿지 상태
```

## Docker 실행 (전체 스택)

```bash
docker compose up -d

# 서비스 확인
docker compose ps

# 로그 모니터링
docker compose logs -f backend

# 중지
docker compose down
```

## 기존 프로젝트와의 관계

| | smart-farm-platform | smart-farm-mqtt |
|---|---|---|
| 레포 | sadojs/js_farm | sadojs/js_farm_mqtt |
| 통신 | Tuya Cloud API (HTTP) | Zigbee/MQTT (로컬) |
| Backend 포트 | 3000 | 3100 |
| Frontend 포트 | 5173 | 5174 |
| DB | smartfarm | smartfarm_mqtt |
| 상태 | 라이브 운영 중 | 개발 중 |

## 라이선스

MIT License
