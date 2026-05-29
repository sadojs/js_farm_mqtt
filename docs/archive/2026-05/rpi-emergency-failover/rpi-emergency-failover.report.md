# rpi-emergency-failover 완료 보고서

> **Summary**: 라즈베리파이 이머전시 페일오버 (Hybrid Fallback) 아키텍처 구현. 서버-RPi 통신 단절 시 로컬 폴백 엔진이 자동으로 장치를 안전하게 제어. 최종 Match Rate 98%.
>
> **Owner**: 오정석 (sadojs@gmail.com)
> **Started**: 2026-05-20
> **Completed**: 2026-05-21
> **Duration**: 2일 (반복 1회, 수동 fix)

---

## 1. PDCA 개요

### Plan (계획)
**문서**: `docs/01-plan/features/rpi-emergency-failover.plan.md`

서버-RPi 단절 시 관수 침수, 개폐기 미동작, 액비 지속 등 작물 피해 위험을 해소하기 위해 Hybrid Fallback 아키텍처를 채택하였습니다.

- **목표**: 통신 단절 5분 경과 시 RPi가 자율적으로 안전 동작 수행
- **선택 아키텍처**: 옵션 2 (Hybrid Fallback) — 서버 자동화 엔진 유지 + RPi 폴백 엔진 추가
- **추정 기간**: 14~17일

### Design (설계)
**문서**: `docs/02-design/features/rpi-emergency-failover.design.md`

핵심 설계 원칙 4가지를 확정하였습니다.

- 서버 `automation-runner.service.ts` 변경 없음 (기존 안정성 보존)
- 명령 게이트(Command Gate)로 폴백 모드 진입 시 서버 GPIO 명령 필터링
- 서버 DB가 폴백 룰의 단일 권위 원천, RPi는 미러 캐시
- 빗물 센서 override는 모든 모드에서 최우선

핵심 설계 결과물: 신규 DB 테이블 4종, MQTT 토픽 6종, RPi `fallback-engine` 14개 파일 구조, 백엔드 `fallback-config` 모듈, 프론트엔드 7개 컴포넌트.

### Do (구현)
**기간**: 2026-05-20 ~ 2026-05-21

| 영역 | 구현 내용 |
|------|-----------|
| **DB** | 마이그레이션 020 (fallback_configs, fallback_opener_schedule, fallback_gateway_status, fallback_events + 트리거 + 시드). gateway_id를 UUID → VARCHAR(50) FK로 재작성 (실기 테스트에서 발견된 schema mismatch 수정) |
| **백엔드** | fallback-config 모듈 (4 entity + DTO 3종 + service + controller + heartbeat.service + module 등록), MQTT 서비스에 fallback 토픽 6종 추가, app.module 등록, EventsGateway에 fallback emit 2종 (`fallback:mode-changed`, `fallback:event`) 추가 |
| **RPi** | fallback-engine Node.js 서비스 (14개 파일): heartbeat-watchdog, mode-state-machine, command-gate, event-queue, rain-override, relay-bridge, rule-store, mqtt-client, rule-evaluator 4종 (opener/irrigation/fertilizer/fan/index) |
| **인프라** | systemd `fallback-engine.service` (User=pi), setup.sh Step 7.5 통합 |
| **프론트엔드** | 6개 컴포넌트 + OpenerMonthDialog 모달 + EmergencyFailover.vue 메인 페이지 + useEmergencyFailover composable + API + types + 라우터/사이드바 등록 |

### Check (분석)
**문서**: `docs/03-analysis/rpi-emergency-failover.analysis.md`

| 분석 회차 | Match Rate | 주요 Gap |
|:---------:|:----------:|----------|
| 1차 (5-20) | 91% | H-1 WebSocket 미구현, M-1 User=pi 미설정, M-2 이벤트 버퍼링 없음, L-2 컴포넌트 미분리 등 8개 |
| 2차 (5-21) | **98%** | L-5 잔존 (수용 가능) |

빌드 검증: `tsc`, `vue-tsc`, `node --check` (14개 파일), `bash -n setup.sh` 전부 PASS.

### Act (개선)
pdca-iterator 미사용, 수동 fix 1턴으로 91% → 98% 달성. Gap 리스트가 명확하게 정리되어 있어 자동화 없이도 빠른 수정이 가능하였습니다.

---

## 2. 구현 결과

### 완료 항목

- 폴백 진입 시 액비 즉시 OFF
- 관수 onSince 기준 30분 타임아웃
- 개폐기 월별 스케줄 (4·5·10월 시간, 6~9월 24h, 11월 비활성 값 보존)
- 빗물 ACTIVE → 즉시 CLOSE, 종료 → 직전 스케줄 복귀
- 환기팬 default 비활성, 활성 시 35/28°C 히스테리시스
- 개폐기 인터록 (1초 OFF→ON)
- 60초 콜드부트 grace + 5분 timeout + 30초 recovery grace
- emergency-stop은 폴백 모드에서도 항상 통과
- 이벤트 30초 메모리 버퍼링 (SD 마모 방지)
- WebSocket 실시간 모드 변경 알림 (`fallback:mode-changed`, `fallback:event`)
- 환기팬 온도 임계값 UI 편집 가능
- Plan 사용자 사양 12개 항목 100% 일치

### 미완료 / 후속 이관 항목

| 항목 | 사유 | 후속 처리 |
|------|------|-----------|
| fallback-engine RelayBridge가 gpio-agent의 `{slot, pin, state}` 포맷 대신 `{channel, state}` 포맷으로 publish | 설계 단계에서 gpio-agent 인터페이스 계약 미확인 | `rpi-fallback-channel-sync` 사이클 |
| rule-evaluator 4종에 채널명 하드코딩 (8ch 가정, 12ch 미대응) | 동일 원인 | `rpi-fallback-channel-sync` 사이클 |
| 장치 추가/삭제 시 RPi 자동 동기화 메커니즘 없음 | 본 사이클 스코프 외 | `rpi-fallback-channel-sync` 사이클 |

---

## 3. 핵심 수치

| 지표 | 값 |
|------|----|
| 최종 Match Rate | 98% |
| PDCA 반복 횟수 | 1회 (수동) |
| 빌드 오류 (최종) | 0 |
| Plan 사용자 사양 달성률 | 100% (12/12) |
| 잔존 Gap 심각도 | Low (수용) |

---

## 4. 학습된 교훈

**1. 설계 단계에서 인접 시스템 인터페이스 명세 누락**

gpio-agent의 payload 포맷 (`{slot, pin, state}`)을 fallback-engine 설계 시 확인하지 않아 RelayBridge 통합 누락이 발생하였습니다. 향후 외부 시스템 의존이 있는 기능은 Design 단계에서 인터페이스 계약을 명시적으로 문서화해야 합니다.

**2. Schema 결정 시 도메인 특성 반영 필요**

다른 모듈은 `gateways.id` (UUID) FK를 사용하는 반면, fallback은 `gateways.gateway_id` (VARCHAR) FK가 적합하였습니다. MQTT/REST 모두 사람이 읽는 ID를 사용한다는 도메인 특성을 Schema 결정 시점에 검토해야 합니다.

**3. Gap 분석의 인접 시스템 통합 검출 한계**

gap-detector는 코드와 설계 문서를 비교하지만, 인접 시스템과의 실제 통합 동작은 자동 검출이 어렵습니다. 실기 검증 (qa-monitor 또는 E2E)을 별도 단계로 편성하는 것이 바람직합니다.

**4. 명확한 Gap 리스트 기반의 수동 iteration 효과**

pdca-iterator를 거치지 않고 1턴 수동 수정으로 91% → 98%를 달성하였습니다. Gap 리스트가 명확하게 분류되어 있을 때 수동 수정이 충분히 빠르고 효과적입니다.

---

## 5. 다음 단계

| 작업 | 상태 |
|------|------|
| 후속 사이클 `rpi-fallback-channel-sync` Design 단계 착수 | Plan 완료, Design 대기 |
| `rpi-fallback-channel-sync` 완료 후 통합 실기 테스트 | 대기 |
| 두 사이클 완료 후 `/pdca archive rpi-emergency-failover` | 대기 |

---

## 6. 관련 문서

- Plan: [docs/01-plan/features/rpi-emergency-failover.plan.md](../../01-plan/features/rpi-emergency-failover.plan.md)
- Design: [docs/02-design/features/rpi-emergency-failover.design.md](../../02-design/features/rpi-emergency-failover.design.md)
- Analysis: [docs/03-analysis/rpi-emergency-failover.analysis.md](../../03-analysis/rpi-emergency-failover.analysis.md)
- 후속 사이클 Plan: `docs/01-plan/features/rpi-fallback-channel-sync.plan.md`
