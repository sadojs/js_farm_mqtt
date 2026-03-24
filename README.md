# 🌱 스마트 농업 자동화 플랫폼

Tuya IoT 기반의 농업 자동화 플랫폼입니다. 다양한 센서를 모니터링하고 날씨/시간/하이브리드 자동화를 통해 농업 환경을 최적화합니다.

## ✨ 주요 기능

### 📊 센서 모니터링
- **온도** - 실시간 온도 모니터링 및 임계값 알림
- **습도** - 상대 습도 측정
- **CO2** - 이산화탄소 농도 모니터링
- **조도** - 광량 측정
- **토양 수분** - 토양 습도 측정
- **PH** - 토양 산도 측정
- **EC** - 전기 전도도 측정

### 🤖 3가지 자동화 엔진

#### 1. 날씨 기반 자동화
- **비 감지 → 자동 폐쇄** (필수)
- **강풍 감지 → 개폐 제한** (옵션)
- **일출/일몰 → 조명 자동** (옵션)
- **온도 기반 개폐기 제어** (필수)
- **온도 기반 환풍기 제어** (필수)

#### 2. 시간 기반 자동화
- ⏰ **특정 시간 급수**
- 🌿 **비료 투입 스케줄**
- 🌙 **야간 환기**

#### 3. 하이브리드 자동화 (조건 + 시간)
- 복합 조건 설정
- AND/OR 논리 연산자 지원
- 예: "평일 오전 8시 AND 온도 > 25도 → 환기"

### 👥 그룹 관리
- 하우스/기기를 그룹으로 묶기
- 그룹 ON/OFF 일괄 제어
- 그룹별 자동화 룰 적용
- 그룹별 스케줄 설정

### 📱 반응형 대시보드
- **실시간 센서 데이터** 한눈에 파악
- **날씨 위젯** 통합
- **자동화 상태** 모니터링
- **알림 패널** 중요 이벤트 표시
- **모바일/태블릿/데스크탑** 완벽 지원

## 🛠 기술 스택

### Backend
- **NestJS** - TypeScript 기반 프레임워크
- **TypeORM** - ORM
- **PostgreSQL** - 메인 데이터베이스
- **TimescaleDB** - 시계열 데이터
- **Redis** - 캐시 및 Queue
- **Socket.io** - 실시간 통신
- **Bull** - Job Queue

### Frontend
- **Vue 3** - Progressive JavaScript Framework
- **TypeScript** - 타입 안정성
- **Vite** - 빌드 도구
- **Pinia** - 상태 관리
- **Vue Router** - 라우팅
- **Chart.js** - 데이터 시각화
- **Socket.io Client** - 실시간 데이터

### Mobile
- **Ionic Vue** - 하이브리드 모바일 앱
- **Capacitor** - 네이티브 기능 접근

### APIs
- **Tuya Cloud API** - IoT 디바이스 제어
- **OpenWeather API** - 날씨 데이터
- **기상청 API** - 한국 지역 날씨

## 🚀 빠른 시작

### 필요 조건
- Node.js 18+
- Docker & Docker Compose
- Tuya Cloud 계정
- OpenWeather API 키
- 기상청 API 키

### 1. 프로젝트 클론
```bash
git clone <repository-url>
cd smart-farm-platform
```

### 2. 환경 변수 설정
```bash
cp .env.example .env
# .env 파일을 열어서 API 키 설정
```

### 3. Docker로 실행 (권장)
```bash
docker-compose up -d
```

서비스가 시작되면:
- Frontend: http://localhost
- Backend API: http://localhost:3000
- PostgreSQL: localhost:5432
- Redis: localhost:6379

### 4. 로컬 개발 환경

#### Backend 실행
```bash
cd backend
npm install
npm run start:dev
```

#### Frontend 실행
```bash
cd frontend
npm install
npm run dev
```

## 📁 프로젝트 구조

```
smart-farm-platform/
├── backend/                    # NestJS Backend
│   ├── src/
│   │   ├── modules/
│   │   │   ├── sensors/       # 센서 모듈 시스템
│   │   │   ├── integrations/  # API 연동 (Tuya, 날씨)
│   │   │   ├── automation/    # 자동화 엔진
│   │   │   ├── devices/       # IoT 장비 제어
│   │   │   ├── groups/        # 그룹 관리
│   │   │   ├── dashboard/     # 대시보드 데이터
│   │   │   └── notifications/ # 알림 시스템
│   │   └── main.ts
│   └── package.json
│
├── frontend/                   # Vue 3 Frontend
│   ├── src/
│   │   ├── components/
│   │   │   ├── sensors/       # 센서 UI 컴포넌트
│   │   │   ├── dashboard/     # 대시보드 컴포넌트
│   │   │   ├── automation/    # 자동화 UI
│   │   │   └── groups/        # 그룹 관리 UI
│   │   ├── views/             # 페이지 뷰
│   │   ├── stores/            # Pinia 스토어
│   │   └── main.ts
│   └── package.json
│
├── mobile/                     # Ionic Vue Mobile
│   └── src/
│
├── docker-compose.yml          # Docker 설정
├── .env.example               # 환경 변수 예시
└── README.md
```

## 🔧 주요 모듈 설명

### 센서 모듈 시스템
모든 센서는 `BaseSensor` 추상 클래스를 상속받아 구현됩니다:

```typescript
// backend/src/modules/sensors/types/temperature.sensor.ts
export class TemperatureSensor extends BaseSensor {
  async readRawValue(): Promise<number> {
    // Tuya API에서 온도 데이터 읽기
  }

  getUnit(): string {
    return '℃';
  }
}
```

### 자동화 엔진
3가지 엔진이 각각 다른 자동화 시나리오를 처리:

```typescript
// backend/src/modules/automation/engines/weather-engine.ts
export class WeatherAutomationEngine extends BaseAutomationEngine {
  async evaluateConditions(rule: AutomationRule): Promise<boolean> {
    // 날씨 조건 평가
  }

  async executeActions(rule: AutomationRule): Promise<void> {
    // 액션 실행 (디바이스 제어)
  }
}
```

### UI 컴포넌트
모듈형 센서 카드:

```vue
<!-- frontend/src/components/sensors/TemperatureSensor.vue -->
<template>
  <BaseSensorCard
    :value="sensorData.value"
    :status="sensorData.status"
    :thresholds="thresholds"
  />
</template>
```

## 🔌 API 연동

### Tuya Cloud API
1. [Tuya IoT Platform](https://iot.tuya.com/)에서 계정 생성
2. Cloud Project 생성
3. API 키 발급 (Client ID, Secret)
4. `.env` 파일에 설정

### OpenWeather API
1. [OpenWeatherMap](https://openweathermap.org/api)에서 계정 생성
2. API 키 발급
3. `.env` 파일에 설정

### 기상청 API
1. [공공데이터포털](https://www.data.go.kr/)에서 계정 생성
2. 기상청 API 신청
3. API 키 발급
4. `.env` 파일에 설정

## 📱 모바일 앱 빌드

```bash
cd mobile
npm install
npm run build

# iOS
npx cap add ios
npx cap open ios

# Android
npx cap add android
npx cap open android
```

## 🧪 테스트

```bash
# Backend 테스트
cd backend
npm test

# Frontend 테스트
cd frontend
npm test
```

## 🐳 Docker 명령어

```bash
# 전체 시작
docker-compose up -d

# 로그 확인
docker-compose logs -f

# 특정 서비스 로그
docker-compose logs -f backend

# 중지
docker-compose down

# 데이터까지 삭제
docker-compose down -v
```

## 🔐 보안 고려사항

- API 키는 절대 Git에 커밋하지 마세요
- 프로덕션 환경에서는 `.env` 파일을 안전하게 관리하세요
- JWT 시크릿은 강력한 값으로 변경하세요
- HTTPS 사용을 권장합니다

## 🎯 로드맵

### Phase 1: 프론트엔드 ✅ 완료
- [x] 로그인/인증 시스템
- [x] 사용자 관리 (멀티테넌트)
- [x] 센서 모니터링 (계층 구조: 그룹 > 하우스동 > 센서)
- [x] 센서 표시 설정 (타입별 필터링)
- [x] 자동화 UI (날씨, 시간, 하이브리드)
- [x] 그룹 관리 (하우스동 그룹화)
- [x] 장비 관리 및 등록 (Tuya 프로젝트 연동)
- [x] 리포트 및 통계 (시계열 그래프, CSV 다운로드) 📊
- [x] 반응형 UI (모바일/태블릿/데스크탑)
- [x] 실시간 대시보드
- [x] 날씨 위젯 (주소 기반)

### Phase 2: 백엔드 ⏳ 다음 단계
- [ ] NestJS 프로젝트 초기화
- [ ] PostgreSQL + TimescaleDB 설정
- [ ] 사용자 인증 API (JWT)
- [ ] Tuya API 완전 연동
  - [ ] OAuth 인증
  - [ ] Webhook 이벤트 수신
  - [ ] 장비 제어 API
- [ ] 센서 데이터 수집 및 저장
  - [ ] TimescaleDB Hypertable
  - [ ] Continuous Aggregates (hourly, daily)
  - [ ] 데이터 압축 및 보존 정책
- [ ] 날씨 API 실시간 연동
- [ ] 자동화 엔진 구현
- [ ] WebSocket 실시간 통신
- [ ] 리포트 생성 API (PDF, CSV)

### Phase 3: 고급 기능 🔮 향후
- [ ] AI 기반 추천 시스템
  - 시계열 데이터 분석 (Prophet, ARIMA)
  - 온도 패턴 분석
  - 최적 급수/환기 시간 추천
  - 이상 탐지
- [ ] 알림 시스템 (푸시, 이메일, SMS)
- [ ] 모바일 앱 (Ionic Vue)
- [ ] 데이터 백업 및 복구
- [ ] 다국어 지원

## 📖 추가 문서

- [ARCHITECTURE.md](./ARCHITECTURE.md) - 전체 아키텍처 및 구조 📖
- [TUYA_API_GUIDE.md](./TUYA_API_GUIDE.md) - Tuya Cloud API 연동 가이드 📖
- [SENSOR_DATA_API_GUIDE.md](./SENSOR_DATA_API_GUIDE.md) - 센서 데이터 수집 및 리포트 API 가이드 📖
- [backend/database/schema.sql](./backend/database/schema.sql) - PostgreSQL + TimescaleDB 스키마 📖

## 📝 라이선스

MIT License

## 🤝 기여

기여는 언제나 환영합니다! Pull Request를 보내주세요.

## 📧 연락처

문의사항이 있으시면 이슈를 등록해주세요.

---

**Made with ❤️ for Smart Farming**
