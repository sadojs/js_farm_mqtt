---
template: plan
version: 1.2
feature: rain-sensor-opener-override
date: 2026-05-15
author: ohgane
project: smart-farm-mqtt
status: Draft
---

# rain-sensor-opener-override Planning Document

> **Summary**: Tuya TS0207 비 감지(우적) 센서가 비를 감지하면, 모든 개폐기 자동제어 룰을 일시 무시하고 강제로 닫는다. 비가 그치면 자동제어 룰을 재평가하여 정상 복귀. 비 도중 사용자가 직접 개폐기를 조작하면 그 비 이벤트 동안에는 사용자 조작이 우선되고, 다음 비 이벤트부터 다시 자동 닫힘이 동작한다.
>
> **Project**: smart-farm-mqtt
> **Date**: 2026-05-15
> **Status**: Draft

---

## 1. Overview

### 1.1 Purpose

비닐하우스 천창 개폐기는 환기 목적으로 온도/시간 자동제어 룰을 따른다. 그러나 비가 오는 동안 천창이 열려 있으면 작물·시설 피해가 발생한다. Tuya TS0207 우적 센서가 페어링되어 있어 이 신호를 자동제어 의사결정의 최우선 우선순위로 활용해 비 감지 시 강제 닫음을 수행한다.

### 1.2 Background

- 우적센서는 **이진(binary) 신호**만 제공한다. 강우량(mm) 측정은 불가 → 부슬비/약한 비도 "비 감지"로 통합 신호화됨
- 부슬비 시에는 천창을 살짝 열어 환기 + 환기팬 조합이 필요할 수 있음 → **사용자가 직접 개폐기를 조작할 수 있어야 한다**
- 다음 비 이벤트(비 그쳤다가 다시 옴)부터는 다시 자동 닫힘 동작

### 1.3 Related Documents

- 직전 작업: [sensor-reading-selection.report.md](../../04-report/features/sensor-reading-selection.report.md), 개폐기 30/60s 사이클
- TS0207 우적센서는 [zigbee-device-pairing flow](../../../frontend/src/views/GatewayEnvSettings.vue)를 통해 이미 추가 완료 (장치 ID: `108c2346-…`)

---

## 2. Scope

### 2.1 In Scope

- [ ] **env_roles 신규**: `rain_detection` (외부, 단위 없음, 이진)
- [ ] **MQTT 수신**: Z2M `water_leak` 페이로드를 `rain_detection` 또는 `rain` sensor_type으로 정규화하여 `sensor_data` 적재
- [ ] **rain-override 서비스 (백엔드)**: 구역별 rain 상태 모니터링 → 개폐기 강제 close 명령 발행, 룰 우회
- [ ] **사용자 직접 제어 우선순위**: 비 도중 사용자가 개폐기를 직접 컨트롤하면 해당 비 이벤트가 끝날 때까지 자동 닫힘 일시 정지(suppress)
- [ ] **비 종료 동작**: rain=false 전이 시 사용자 suppress 플래그 해제 + 자동제어 룬 재평가(자연 복귀)
- [ ] **env-config 모달**: 우적센서 추가 옵션 (내부/외부 온습도 매핑과 동일 UX)
- [ ] **장치 카드 상태 표시**: 우적센서 카드의 "로딩 중" 상태를 "비 감지 / 정상" 같은 의미 있는 라벨로 표시
- [ ] **자동제어 룰 표시**: 비 우회 작동 중일 때 룰 카드에 "🌧 비 감지로 일시 우회" 배지

### 2.2 Out of Scope

- 강우량(mm) 기반 단계적 개폐 (현 센서는 이진 신호 한계)
- 다른 구역(House) 간 rain 상태 공유 — 본 사이클은 같은 구역에 매핑된 우적센서로만 동작
- 우적센서 다중 매핑(여러 개) — v1은 구역당 1개
- 푸시 알림/SMS — 별도 사이클로 분리

---

## 3. Requirements

### 3.1 Functional Requirements

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-01 | env_roles에 `rain_detection` row 추가 (DB migration) | High | Pending |
| FR-02 | MQTT 핸들러: Z2M payload의 `water_leak: true/false` → `sensor_data.sensor_type='rain_detection'`, value 1/0 적재 | High | Pending |
| FR-03 | rain-override 서비스: 10초 주기 (또는 sensor_data INSERT trigger 기반) 구역별 rain 상태 평가 | High | Pending |
| FR-04 | rain=true 전이 시 해당 구역의 모든 `opener_open`/`opener_close` 장치에 즉시 닫힘 명령 (인터록 포함) | High | Pending |
| FR-05 | rain=true 유지 동안 automation-runner의 opener 룰 실행을 skip (자동제어 conditions_met이라도 무시) | High | Pending |
| FR-06 | rain=true 중 사용자가 `controlDevice()`로 open/close 호출 시 → `user_override_during_rain` 플래그 설정 | High | Pending |
| FR-07 | rain=true → false 전이 시 (즉, 비 그침) `user_override_during_rain` 클리어 + 다음 cron에서 룰 재평가 (자연 복귀) | High | Pending |
| FR-08 | 사용자 override 플래그가 있는 동안에는 rain=true여도 강제 close 명령 발행 안 함 | High | Pending |
| FR-09 | 다음 rain 이벤트(false→true 재전이) 시 override 플래그 클리어된 상태에서 강제 close 재개 | High | Pending |
| FR-10 | env-config 모달: 외부 카테고리에 우적센서 매핑 가능, 매핑 후 해당 구역의 rain 상태가 자동 활성화 | High | Pending |
| FR-11 | 우적센서 장치 카드: 마지막 sensor_data의 water_leak 값으로 "🌧 비 감지 / ☀ 정상" 표시. 24h 데이터 없으면 "신호 대기" | Medium | Pending |
| FR-12 | 자동제어 룰 카드에 비 우회 활성 상태 시 작은 배지 표시 (선택) | Low | Pending |
| FR-13 | 활동 로그(activity_logs)에 rain_override 동작 기록 (`device.rain_override.close`, `device.rain_override.user_skipped`, `device.rain_override.cleared`) | Medium | Pending |

### 3.2 Non-Functional Requirements

| Category | Criteria | Measurement Method |
|----------|----------|-------------------|
| Latency | 비 감지 → 개폐기 close 명령 발행 ≤ 10초 | E2E 로그 타임스탬프 |
| Robustness | 우적센서 일시 오프라인 시 마지막 상태 유지(false 페일오버 금지) | 타임아웃 정책 60초 |
| Security | rain-override는 시스템 권한으로 동작, 사용자 권한 영향 없음 | 코드 리뷰 |
| Backward Compat | 우적센서 미매핑 구역은 기존 동작 그대로 | 회귀 테스트 |

### 3.3 Choice Decision — 비 종료 시 동작

**Option A (선택 안 됨)**: 비 종료 → 자동 OFF (강제로 open 송신)
- 단점: 자동제어 룰이 닫기를 원하는 시간대(밤 등)에 강제로 열어버리는 충돌 발생

**Option B (✅ 채택)**: 비 종료 → 우회 플래그 해제 + 자동제어 룰 자연 재평가
- 장점:
  - 자동제어 룰의 의도(밤=닫기, 낮+고온=열기)를 그대로 존중
  - 명시적 "강제 open" 액션 없이 자연 복귀 → 부작용 최소
  - 직접 컨트롤한 사용자 의도(현재 상태)도 자연스럽게 유지됨

→ FR-07이 이 결정을 반영함.

---

## 4. Success Criteria

### 4.1 Definition of Done

- [ ] DB migration 적용, env_roles에 `rain_detection` row 존재
- [ ] water_leak ON/OFF 토글 시 sensor_data에 rain_detection 적재 확인
- [ ] 시뮬레이션 토글로 rain=true 발생 → 10초 이내 개폐기 close 명령 백엔드 로그 확인
- [ ] rain=true 중 사용자가 직접 open 호출 → 추가 close 명령 발행 안 함 (로그로 확인)
- [ ] rain=false 전이 → user_override 플래그 클리어, 자동제어 룰 재개 정상
- [ ] 두 번째 rain=true 발생 → 다시 강제 close 동작
- [ ] env-config 모달에서 우적센서 추가/제거 정상
- [ ] 장치 카드의 "로딩 중" 사라지고 "🌧 비 감지" 또는 "☀ 정상" 표시
- [ ] 활동 로그에 rain_override 이벤트 기록

### 4.2 Quality Criteria

- [ ] TypeScript 검증 통과 (backend tsc, frontend vue-tsc)
- [ ] E2E 시나리오 1~6 모두 Playwright + MQTT publish 시뮬레이션으로 자동화
- [ ] 회귀: 우적센서 매핑 안 된 구역은 기존 동작 그대로

---

## 5. Risks and Mitigation

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| 우적센서 일시 오프라인 → false로 오인 | 비 도중 갑자기 자동제어 룰 복귀 → 천창 다시 열림 | Medium | "최근 60초 데이터 없으면 마지막 상태 유지" 페일오버 |
| 사용자 직접 제어 감지 정확도 | 자동 제어 명령과 직접 명령 구분 실패 | Low | `controlDevice` 호출 시 호출자 컨텍스트로 식별: rule.userId 자동제어 vs CurrentUser 직접 |
| 인터록 충돌 | rain close 명령이 기존 cycle ON 단계와 겹침 | Medium | rain-override 동작 시 해당 개폐기의 `lastState` 캐시도 invalidate |
| 다중 우적센서 매핑 향후 요구 | v1 1개 가정 위반 | Low | 데이터 모델은 다중 가능하게 두되 UI는 v1 단일 |

---

## 6. Architecture Considerations

### 6.1 Project Level Selection

| Level | Selected |
|-------|:--------:|
| Enterprise | ☑ |

기존 Enterprise 모듈 구조에 신규 서비스(`rain-override.service.ts`)와 env_roles seed 1줄 + 매핑 UI 추가.

### 6.2 Key Architectural Decisions

| Decision | Options | Selected | Rationale |
|----------|---------|----------|-----------|
| 비 감지 신호 식별 | mqtt-payload `water_leak` / `rain` / `contact` | `water_leak` | TS0207 Z2M 기본 노출 필드 |
| sensor_data sensor_type | `rain` / `water_leak` / `rain_detection` | `rain_detection` | 기존 자동제어 코드의 `field === 'rain'`과 별도 (혼동 방지) |
| 우회 평가 주기 | 즉시 이벤트 기반 / cron | cron 10초 + MQTT 즉시 transition 이벤트 hybrid | 신뢰성 + 반응속도 양립 |
| 사용자 vs 자동 구분 | 호출 컨텍스트 / 명령 source 필드 | 호출 컨텍스트 (`controlDevice`의 userId가 룰 소유자면 자동, 다른 인증된 사용자면 직접) | 추가 스키마 없이 즉시 가능 |
| 우적센서 카드 상태 라벨 | "감지" / "정상" / boolean | 한국어 라벨 + 아이콘 | UX 명확성 |

### 6.3 데이터/시퀀스 흐름

```
┌─────────────┐  water_leak    ┌───────────────┐  sensor_data    ┌───────────────────┐
│ TS0207 센서 │ ───────────→  │ MqttBridge    │ ──────────→    │ rain-override     │
│ (Z2M)       │                │ Handler       │  (rain_detect.) │ Service (10s/event)│
└─────────────┘                └───────────────┘                 └─────────┬─────────┘
                                                                            │
                                                            ┌───────────────┼───────────────────┐
                                                            ▼               ▼                   ▼
                                                  rain=true 전이       유지 중               rain=false 전이
                                                  → close 명령        사용자 controlDevice  → suppress 해제
                                                  → suppress= false   감지 → suppress=true  → 자동제어 cron 재개
```

### 6.4 사용자 vs 자동 호출 구분 알고리즘

```ts
// devices.service.ts.controlDevice 진입 시:
const isAutomationCaller = (callerUserId === ruleOwnerUserId) && (callContextTag === 'automation')
// rain-override 서비스가 호출할 때 callContextTag = 'rain-override' 로 마킹
// 자동제어 러너 호출 시 callContextTag = 'automation'
// HTTP/WebSocket 호출 시 callContextTag = 'user'

if (rainOverrideActiveForDevice(deviceId) && callContextTag === 'user') {
  rainOverride.markUserOverride(deviceId)  // 다음 rain=false 전이까지 suppress
}
```

---

## 7. Convention Prerequisites

### 7.1 Existing Conventions

- [x] env_roles 시드 패턴 존재 (schema.sql)
- [x] migrations 디렉토리 사용 중 (`backend/database/migrations/`)
- [x] activity_logs 활용 패턴 정착됨

### 7.2 신규 컨벤션

| Category | To Define | Priority |
|----------|-----------|:--------:|
| sensor_type 값 | `rain_detection` (boolean 1/0) — 기존 `rain`(legacy)와 분리 | High |
| 활동 로그 액션 | `device.rain_override.{close,user_skipped,cleared}` | Medium |

### 7.3 Environment Variables

신규 없음. 우적센서 신호는 MQTT topic으로 수신.

---

## 8. Next Steps

1. [ ] DB migration `015_rain_detection_env_role.sql`
2. [ ] mqtt-sensor.handler.ts에 water_leak → rain_detection 변환 로직
3. [ ] rain-override.service.ts 신규 (RainOverrideService)
4. [ ] automation-runner.service.ts에 `isOpenerRainOverridden(deviceId)` 체크 가드
5. [ ] devices.service.ts.controlDevice 호출 시 caller context 마킹
6. [ ] env-config 프론트 모달에 우적센서 매핑 UI
7. [ ] 장치 카드 상태 표시 컴포넌트 분기 (`rain_detection` field 인식)
8. [ ] activity_logs 기록 추가
9. [ ] E2E 자동 검증 (water_leak MQTT publish 시뮬레이션)

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-05-15 | Initial draft — 비 종료 시 Option B (자연 재평가) 채택 | ohgane |
