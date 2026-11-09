# Gap Analysis: emergency-opener-env-control

> Plan: [../01-plan/features/emergency-opener-env-control.plan.md](../01-plan/features/emergency-opener-env-control.plan.md)
> Design: [../02-design/features/emergency-opener-env-control.design.md](../02-design/features/emergency-opener-env-control.design.md)
> Date: 2026-07-05 · Phase: Check (gap-detector)

---

## 종합 점수

| 항목 | 점수 | 상태 |
|---|:-:|:-:|
| FR/NFR 커버리지 | 100% (FR 8/8, NFR 6/6) | ✅ |
| 4곳 동기 체크리스트 | 100% (4필드 × 4위치) | ✅ |
| 설계 충실도(구조/명명) | ~90% | ⚠️ |
| **Overall Match Rate** | **~96%** | ✅ |

→ Match Rate ≥ 90% → `/pdca report` 진행 가능 (iterate 불필요).

---

## FR/NFR 추적성

| 항목 | 상태 | 근거(file:line) |
|---|:-:|---|
| FR-01 온습도 primary 제어 | ✅ | `opener.js:63-77` (공용 히스테리시스) |
| FR-02 센서 이상 감지 | ✅ | `index.js:47-66` 타임스탬프; `sensor-watchdog.js:24-35` isFresh/grace |
| FR-03 시간 스케줄 백업 전환 | ✅ | `opener.js:79-103` |
| FR-04 우선순위·안전(인터록) | ✅ | `opener.js:52-103` (enabled→rain→primary→grace→backup), 인터록 1000ms 불변 |
| FR-05 백엔드 설정/배포 | ✅ | entity:50-63, dto:69-93, service:155-166(검증), 040 마이그레이션 |
| FR-06 Pi 룰 반영 | ✅ | `rule-store.js:33-36` 기본값, `sensor-watchdog.js` 신규 |
| FR-07 프론트 UI | ⚠️ | `OpenerEnvCard.vue` 기능 완비, 명명/일반화만 설계와 상이(Gap 1) |
| FR-08 동작 근거 표시 | ✅ | `fallback-event-humanizer.ts:69-82` (env-*/backup-*/rain-* 한글) |
| NFR-01 오프라인 독립성 | ✅ | Pi 로직이 로컬 store/state만 참조 |
| NFR-02 안전 우선 | ✅ | 우적 1순위, 센서 이상 시 무동작 아닌 백업 |
| NFR-03 하위호환 | ✅ | 미수신 시 기존 스케줄-only 동작과 동등 |
| NFR-04 버전 단조성 | ✅ | `rule-store.js:78-81` 불변 |
| NFR-05 오탐 최소화 | ✅ | 600s + 60s cold-boot grace |
| NFR-06 4곳 동기 | ✅ | 아래 체크리스트 |

## 4곳 동기 (검증 완료)

| 필드 | ① DTO | ② Entity | ③ publishSync | ④ Pi DEFAULT_RULES |
|---|:-:|:-:|:-:|:-:|
| openerTriggerType | ✅ | ✅ | ✅ | ✅ |
| openerOnValue | ✅ | ✅ | ✅ | ✅ |
| openerOffValue | ✅ | ✅ | ✅ | ✅ |
| sensorTimeoutSeconds | ✅ | ✅ | ✅ | ✅ |

**누락 없음** — NFR-06 완전 충족.

## fan.js 회귀 검증
`c405958`(리팩터 전) vs `60c7417`(현재) git 대조: 기존 인라인 히스테리시스와 `evaluateHysteresis()`가 경계값(`reading===onValue/offValue`) 포함 **byte-for-byte 동등**. 채널 루프·relay 호출·이벤트 payload 불변. **순수 extract-function, 동작 변화 없음.**

## Pi 스모크 테스트
7/7 통과: 온습도 개방/닫힘, 스케줄 무시, 센서 stale→백업, 부팅 grace 무동작, 미수신+grace경과→백업, 우적 최우선, fan 회귀.

---

## 발견된 차이 (Low Impact — iterate 불필요)

| # | 설계 | 구현 | 영향 |
|---|---|---|---|
| 1 | 공용 `EnvConditionCard.vue`(라벨 파라미터화, fan 재사용 가능) | opener 전용 `OpenerEnvCard.vue`(라벨 "개방/닫힘" 하드코딩) | Low — 설계가 fan 재사용을 "선택"으로 명시했고 단일 소비자라 합리적 단순화. 기능 완비 |
| 2 | `OpenerTriggerType = 'temperature'\|'humidity'` | `OpenerTriggerType = FanTriggerType`(alias) | Negligible — 결과 타입 동일 |
| 3 | index.js가 `sensorFresh` boolean 사전계산 후 전달 | `sensorWatchdog` 객체 전달, opener.js 내부에서 `isFresh` 계산 | Negligible — cfg 의존성상 오히려 합리적, tick당 1회 동일 |

**미구현 없음 / 설계에 없는 추가 기능 없음.**

## 권고
- 코드 변경 불필요(Match Rate ≥ 90%, 기능·안전·회귀 모두 충족).
- (선택) 설계 문서 5.2/3.5를 as-built(OpenerEnvCard, sensorWatchdog 전달)로 정합 — 의도된 편차로 기록.
- 다음: `/pdca report emergency-opener-env-control`.
