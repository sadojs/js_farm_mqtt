# rpi-fallback-channel-sync 완료 보고서

> **Summary**: 선행 사이클(rpi-emergency-failover)의 Known Limitation 3건을 해결하는 후속 PDCA 사이클. 폴백 엔진이 gpio-agent 호환 포맷으로 실제 릴레이를 제어하고, rule-evaluator 하드코딩을 제거하며, 장치 변경 시 RPi 자동 동기화를 구현. 최종 Match Rate 96%.
>
> **Owner**: 오정석 (sadojs@gmail.com)
> **선행 사이클**: [rpi-emergency-failover](./rpi-emergency-failover.report.md) (Match Rate 98%)
> **Started**: 2026-05-21
> **Completed**: 2026-05-21
> **Duration**: 1일 (단일 PDCA 사이클, 반복 1회)

---

## 1. PDCA 개요

### Plan (계획)
**문서**: `docs/01-plan/features/rpi-fallback-channel-sync.plan.md`

선행 사이클 완료 후 사용자 검토에서 식별된 운영 불가 요인 3건을 해결하기 위해 분리 사이클을 편성하였습니다. Plan 단계에서 문제를 명확히 4건으로 정의하고, 8ch/12ch 처리 방향(등록된 device만 동기화)과 EventEmitter 기반 자동 트리거 방식을 결정하여 1일이라는 짧은 기간 안에 실행 가능한 계획을 수립하였습니다.

- **목표**: 폴백 모드에서 실제 GPIO 릴레이 정확 제어, 농장별 채널 구성 동적 동기화, 장치 변경 자동 반영
- **추정 기간**: 5일

### Design (설계)
**문서**: `docs/02-design/features/rpi-fallback-channel-sync.design.md`

설계 중 핵심 결정 정정이 발생하였습니다. 초기 설계는 `devices.gpio_pin` + `channel-mapping.constants.ts` 조합을 가정했으나, 코드베이스 확인 결과 `gateway_onboard_devices` 테이블이 이미 `slot_key`, `slot_type`, `gpio_pin`을 모두 보유하는 매핑 테이블임을 확인하고 설계를 즉시 수정하였습니다. DB 스키마 변경 없이 구현 가능함을 확정하였습니다.

핵심 설계 결정:
- `fallback/rules/sync` payload v2: 기존 필드에 `channelMapping` 추가 (하위 호환)
- EventEmitter2 기반 `device.changed` 이벤트로 모듈 간 직접 의존 없이 자동 sync 트리거
- gpio-agent 호환 payload: `{slot, pin, state, requestId, bypass}` 계약 명시

### Do (구현)
**기간**: 2026-05-21 (단일 일)

| 영역 | 구현 파일 수 | 주요 내용 |
|------|:-----------:|-----------|
| 백엔드 (Phase A) | 5개 | buildChannelMapping, publishSync v2, OnEvent 핸들러, entity 등록, mqtt 타입 갱신 |
| 라즈베리파이 (Phase B) | 8개 | rule-store 캐시+getter, evaluator 4종 동적화, relay-bridge 변환, 안전망 |
| 합계 | **13개** | 빌드 검증 포함 완료 |

추정 5일 대비 **1일 완료** — Plan/Design 단계에서 솔직한 한계 명시와 명확한 설계 덕분에 구현이 직선적으로 진행되었습니다.

### Check (분석)
**문서**: `docs/03-analysis/rpi-fallback-channel-sync.analysis.md`

| 분석 회차 | Match Rate | 주요 Gap |
|:---------:|:----------:|----------|
| 1회차 (5-21) | **96%** | L-1 E2E 실기 검증 미실시, L-2 device.changed 누락 보장 없음 |

Critical/High/Medium Gap 0건. 빌드 검증: backend `tsc --noEmit` Exit 0, RPi `node --check` 14파일 전부 OK.

### Act (개선)
갭 96%로 1회차 분석에서 Pass 달성. 추가 iteration 없이 보고서 단계로 직행하였습니다.

---

## 2. 선행 사이클 Known Limitation 해결 현황

선행 사이클(`rpi-emergency-failover`) 보고서에 명시된 미완료 항목 3건 모두 해결하였습니다.

| # | Known Limitation | 해결 여부 | 구현 내용 |
|---|-----------------|:---------:|-----------|
| 1 | RelayBridge가 `{channel, state}` 포맷 — gpio-agent 미호환 | ✅ 해결 | relay-bridge.js: channel → `{slot, pin}` 변환 + `{slot, pin, state, requestId, bypass}` payload |
| 2 | rule-evaluator 4종 채널명 하드코딩 (8ch 가정) | ✅ 해결 | irrigation/fertilizer/fan/opener.js에서 상수 제거 → `store.getChannels(category)` 동적 조회 |
| 3 | 장치 추가/삭제 시 RPi 자동 동기화 메커니즘 없음 | ✅ 해결 | GatewayEnvService에 EventEmitter2 주입, create/update/delete 3곳에서 `device.changed` 발행 |

---

## 3. 구현 결과

### 3.1 완료 항목

**백엔드**
- `buildChannelMapping()`: `gateway_onboard_devices` 조회 → slot_type 분류 → 8가지 타입 처리 → channelMapping 객체 빌드
- `publishSync()`: payload v2로 확장 (`channelMapping` 필드 포함)
- `@OnEvent('device.changed')` 핸들러: `bumpVersionAndSync()` 재호출
- `GatewayEnvService.emitDeviceChanged()`: UUID → VARCHAR 변환 후 emit
- `FallbackConfigModule`: GatewayOnboardDevice entity 등록

**라즈베리파이**
- `rule-store.js`: `channelMapping` 캐시, `channelMapping()` / `getChannels(category)` / `findMapping(channel)` 3개 메서드 신규
- rule-evaluator 4종: 하드코딩 `*_CHANNELS` 상수 제거 → store 동적 조회
- `fan.js`: 다중 슬롯(fan_1~fan_4) 동시 제어 지원
- `relay-bridge.js`: store 주입 + channel → `{slot, pin, name}` 변환 + gpio-agent 호환 payload
- `rule-evaluator/index.js`: emergencyStopAll에 매핑 미동기화 시 광범위 OFF 안전망 추가
- `index.js`: RelayBridge 생성 시 store 전달 + 폴백 진입 시 매핑 없으면 emergencyStopAll 자동 발행

### 3.2 Plan 사양 일치율

| slot_type 카테고리 | 폴백 분류 | Plan 일치 |
|--------------------|-----------|:---------:|
| irrigation_zone / irrigation_group | irrigation | ✅ |
| fan (fan_1~fan_4) | fan (다중 슬롯) | ✅ |
| opener_open / opener_close | opener.open / opener.close | ✅ |
| fertilizer_contact / mixer / fertilizer_motor | fertilizer | ✅ |
| remote_control / vent_group | 제외 | ✅ |
| gpio_pin=NULL 슬롯 | sync 제외 + warn log | ✅ |
| enabled=false 슬롯 | sync 제외 | ✅ |

### 3.3 잔존 Gap (Low)

| # | 항목 | 처리 방향 |
|---|------|-----------|
| L-1 | E2E 실기 검증 미실시 | 통합 테스트 단계에서 수행 (시나리오 10종) |
| L-2 | device.changed 누락 보장 없음 | 사용자 수동 resync 버튼으로 보완 (이미 구현됨) |

---

## 4. 품질 지표

| 지표 | 값 |
|------|----|
| 최종 Match Rate | **96%** |
| Critical/High/Medium Gap | **0건** |
| PDCA 반복 횟수 | **1회** |
| 백엔드 빌드 오류 (최종) | **0** (tsc --noEmit) |
| RPi 구문 오류 (최종) | **0** (node --check, 14파일) |
| DB 마이그레이션 | **없음** |
| 신규 MQTT 토픽 | **없음** (기존 payload v2 확장) |
| 선행 사이클 Known Limitation 해결률 | **100% (3/3)** |

---

## 5. 학습된 교훈

**1. 선행 사이클에서 미해결 영역을 분리하는 패턴의 효과**

5일 추정 작업이 1일에 완료된 핵심 이유는 Plan/Design 단계에서 선행 사이클의 한계를 솔직하게 명시하고, 후속 사이클 목표를 명확히 좁혀 설계했기 때문입니다. 미해결 항목을 Known Limitation으로 문서화하고 즉시 후속 PDCA로 분리하는 패턴을 앞으로도 권장합니다.

**2. 테이블 도메인 이해의 중요성**

초기 설계는 `devices.gpio_pin`을 가정했으나 실제 매핑 테이블은 `gateway_onboard_devices`였습니다. Design 단계에서 관련 entity 파일을 모두 read하는 체크리스트를 도입하면 이러한 재작업을 예방할 수 있습니다.

**3. EventEmitter 기반 디커플링의 가치**

DevicesModule이 FallbackConfigModule을 직접 import하지 않고 `device.changed` 이벤트로 통신하여 모듈 간 순환 의존을 방지하였습니다. 향후 신규 모듈도 동일 이벤트를 구독하면 확장이 용이합니다.

**4. gpio-agent와 fallback-engine 인터페이스 계약 확립**

`{slot, pin, state, requestId, bypass}` payload가 두 시스템의 계약으로 확립되었습니다. 향후 신규 RPi 모듈 추가 시 동일 계약을 준수해야 합니다.

---

## 6. 다음 단계

### 즉시 (사용자 작업)

| 순서 | 작업 | 비고 |
|:----:|------|------|
| 1 | PostgreSQL 마이그레이션 020 재실행 + backend 재기동 | fallback_* 테이블 스키마 확인 |
| 2 | RPi `setup.sh` 재실행 | fallback-engine 코드 갱신 배포 |
| 3 | 환경설정 페이지에서 onboard device의 gpio_pin 정확 입력 | NULL 슬롯은 sync 제외됨 |
| 4 | MQTT 모니터링: `mosquitto_sub -t "farm/+/fallback/rules/sync" -v` | channelMapping 포함 v2 payload 확인 |
| 5 | 폴백 시뮬레이션: 서버 다운 후 5분 대기 → fallback-engine 로그에서 BCM pin 명령 확인 | E2E 검증 핵심 |

### 후속

- 두 사이클(`rpi-emergency-failover`, `rpi-fallback-channel-sync`) 통합 실기 검증 완료 후 함께 archive 예정
- 라즈베리파이 골든 이미지 재생성 + 농장 출하 테스트

---

## 7. 관련 문서

| 단계 | 문서 |
|------|------|
| Plan | [docs/01-plan/features/rpi-fallback-channel-sync.plan.md](../../01-plan/features/rpi-fallback-channel-sync.plan.md) |
| Design | [docs/02-design/features/rpi-fallback-channel-sync.design.md](../../02-design/features/rpi-fallback-channel-sync.design.md) |
| Analysis | [docs/03-analysis/rpi-fallback-channel-sync.analysis.md](../../03-analysis/rpi-fallback-channel-sync.analysis.md) |
| 선행 사이클 Report | [docs/04-report/features/rpi-emergency-failover.report.md](./rpi-emergency-failover.report.md) |
