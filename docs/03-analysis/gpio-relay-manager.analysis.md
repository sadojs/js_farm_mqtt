# Gap Analysis: gpio-relay-manager

> **분석 일자:** 2026-05-10  
> **Match Rate: 96%** ✅  
> **Phase:** Check

---

## 전체 점수

| 카테고리 | 점수 |
|---------|:----:|
| DB Migration | 90% |
| Backend Entity / DTO / Service | 100% |
| Backend GPIO Module | 97% |
| Backend MQTT | 100% |
| Backend app.module.ts | 100% |
| Frontend API | 100% |
| Frontend GpioRelayManager.vue | 90% |
| Frontend GatewayEnvSettings.vue | 95% |
| Raspberry Pi Agent | 97% |
| **전체 평균** | **96%** |

---

## 발견된 차이점

### 변경된 항목 (Design ≠ Implementation)

| # | 항목 | 설계 | 구현 | 영향도 |
|---|------|------|------|-------|
| 1 | 마이그레이션 파일명 | `013_gpio_pin.sql` | `015_gpio_pin.sql` | 낮음 |
| 2 | GpioRelayManager Prop명 | `onboardDevices` | `devices` | 낮음 |
| 3 | 부모 이벤트 바인딩 | `@device-updated="refreshDevices"` | `@open-timer="openTimerModal"` | 낮음 |
| 4 | GpioService 게이트웨이 조회 | 단순 findOne | 역할 기반 userId 스코프 | 개선 |
| 5 | systemd After= | `After=network.target gpio-agent.service` (자기참조 버그) | `After=network.target` | 수정됨 |
| 6 | 릴레이 ON 명령의 durationMs | 설계 예시에서 사용 | UI에서 미노출, 미전송 | 낮음 |

### 추가된 항목 (구현에서 개선)

- SIGINT 핸들러 추가 (Ctrl-C 우아한 종료)
- `writeSync` try/catch 오류 처리
- GPIO 초기화 실패 시 null 반환 및 caller 체크
- `package.json`에 scripts/engines 추가
- GpioService에 역할 기반 게이트웨이 접근 제어
- systemd에 journal 로깅 지시자 추가

### 누락된 항목 (선택 기능)

| 항목 | 설명 | 우선순위 |
|------|------|---------|
| `durationMs` UI 입력 | 릴레이 ON 시 자동해제 시간 UI 없음 | 낮음 |

---

## 세부 체크 결과

- ✅ DB: `gpio_pin INT NULL` 컬럼 추가 마이그레이션
- ✅ Entity: `gpioPin: number | null` 컬럼 정의
- ✅ DTO: `@IsOptional @IsInt @Min(2) @Max(27) gpioPin` 검증
- ✅ Service: `if ('gpioPin' in dto) device.gpioPin = dto.gpioPin ?? null`
- ✅ DEFAULT_SLOTS: 모든 슬롯에 `gpioPin: null` 초기화
- ✅ GPIO Controller: `POST /gpio/:gatewayId/relay` + JWT + Roles 가드
- ✅ GPIO Service: `mqttService.publishGpioRelay()` 호출
- ✅ MQTT: `farm/+/gpio/status` 구독 + `handleGpioStatus()` 라우팅
- ✅ `publishGpioRelay()`: `farm/{gatewayId}/gpio/relay` 발행 + requestId
- ✅ app.module.ts: GpioModule 등록
- ✅ Frontend API: `gpioPin: number | null` in OnboardDevice
- ✅ Frontend GPIO API: `sendRelayCommand()` → `/gpio/{gw}/relay`
- ✅ GpioRelayManager: BCM_PINS 26개, 팬 카드, 관수 카드, 핀 맵, 충돌 감지
- ✅ GatewayEnvSettings: GpioRelayManager 컴포넌트로 온보드 탭 교체
- ✅ Pi gpio-agent: MQTT 구독 → onoff 제어 → 상태 응답 → 자동해제 → 종료처리

---

## 권장 조치

### 즉시 조치 불필요
96% 매치율로 모든 핵심 기능이 구현되었습니다.

### 낮은 우선순위 개선 사항
1. GpioRelayManager prop명을 `devices` → `onboardDevices`로 변경 (설계 일치)
2. 릴레이 ON 버튼에 선택적 `durationMs` 입력 추가 (운영 편의)
3. 설계 문서의 마이그레이션 번호 오류 수정 (013 → 015)
