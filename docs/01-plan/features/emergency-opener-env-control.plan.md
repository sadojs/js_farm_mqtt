---
template: plan
version: 1.0
description: 이머전시 페일오버 개폐기 — 온습도 조건 제어(primary) + 시간 스케줄 백업 강등
---

# emergency-opener-env-control Planning Document

> **Summary**: 통신 단절(이머전시 페일오버) 시 라즈베리파이가 개폐기를 **온도/습도 조건**(유동팬과 동일 방식)으로 자율 제어하고, 온습도계가 동작하지 않으면 **기존 월별 시간 스케줄을 백업**으로 자동 전환한다.
>
> **Project**: smart-farm-mqtt
> **Version**: 0.x
> **Author**: ohjeongseok
> **Date**: 2026-07-05
> **Status**: Draft

---

## 1. Overview

### 1.1 Purpose

현재 이머전시 페일오버(서버 통신 단절 시 Pi가 로컬 룰로 작물 안전 동작)에서 **개폐기는 "월별 on/off 시간 스케줄"로만** 동작한다. 하지만 개폐기의 본래 목적은 하우스 내부 **온도·습도 조절**이므로, 시간 고정 제어는 이상기온/급변 상황에 부적절하다.

**해결**: 개폐기도 유동팬처럼 **온습도 임계값(히스테리시스) 기반**으로 개방/닫힘을 판단하는 것을 **주(primary) 제어**로 만들고, **온습도계가 동작하지 않을 때(측정값 없음/오래됨)** 기존 월별 시간 스케줄이 **백업(fallback)**으로 자동 동작하게 한다.

### 1.2 Background

- 유동팬은 이미 온습도 제어가 구현됨 — `raspberry-pi/fallback-engine/lib/rule-evaluator/fan.js`: `fanTriggerType`(temperature|humidity) + `fanOnTemp`/`fanOffTemp` 히스테리시스, `state.lastTemperature`/`state.lastHumidity`를 읽음.
- 개폐기는 `lib/rule-evaluator/opener.js`에서 **월별 시간 스케줄만** 평가 — `store.scheduleFor(month)` → `{ mode: 'time'|'always-open', openTime, closeTime }`. 우적(비) 오버라이드가 최우선, 개방/닫힘 페어 인터록(`OPENER_INTERLOCK_DELAY_MS = 1000ms`) 유지.
- **핵심 공백 — "온습도계 동작 안 함" 감지 불가**: `rule-evaluator/index.js#ingestSensor()`는 z2m 메시지의 온/습도 값을 `state.lastTemperature/Humidity`에 **타임스탬프 없이** 덮어쓴다(last-writer-wins). `fan.js`의 유일한 가드는 `typeof reading !== 'number'`(부팅 후 첫 수신 전까지만 참)뿐이라, **센서가 죽어도 마지막 옛 값을 영원히 유효로 취급**한다. 개폐기 온습도 제어를 primary로 삼으려면 이 stale 감지가 반드시 선행돼야 한다.
- stale 감지 선례: `lib/heartbeat-watchdog.js`(lastSeenAt + timeoutMs + `COLD_BOOT_GRACE_MS`)가 그대로 복제 가능한 템플릿.
- 설정 배포 경로: backend `fallback-config.service.publishSync()` → MQTT `publishFallbackRulesSync` → Pi `rule-store.js`(`DEFAULT_RULES.config` + `schedule`). backend↔Pi 간 **공유 타입 없음**(필드명 일치로 수동 동기).

### 1.3 Related Documents

- 유동팬 온습도 제어 선례: `raspberry-pi/fallback-engine/lib/rule-evaluator/fan.js`
- stale 감지 패턴: `raspberry-pi/fallback-engine/lib/heartbeat-watchdog.js`
- 개폐기 시간 스케줄 현행: `lib/rule-evaluator/opener.js`, `fallback-config/entities/fallback-opener-schedule.entity.ts`
- fan-trigger 추가 선례(마이그레이션·양측 동기): 커밋 `c405958`, `backend/database/migrations/023_fallback_fan_trigger.sql`
- 프론트 재사용 대상: `frontend/src/components/emergency-failover/FanFailoverCard.vue`
- 관련 메모리: [[project_emergency_failover]]

---

## 2. Scope

### 2.1 In Scope

- [ ] **개폐기 온습도 조건 제어(primary)** — `openerTriggerType`(temperature|humidity), `openerOnValue`(개방 임계), `openerOffValue`(닫힘 임계), 히스테리시스. 판정: reading > on → 개방 / reading < off → 닫힘 (on > off).
- [ ] **온습도계 이상 감지(sensor staleness)** — `ingestSensor()`에 `lastTemperatureAt`/`lastHumidityAt` 타임스탬프 기록 + `sensorTimeoutSeconds` 설정 + cold-boot grace. 값 없음/오래됨 → "센서 이상".
- [ ] **시간 스케줄 백업 강등** — 센서 정상이면 온습도 제어, 센서 이상이면 **기존 월별 시간 스케줄로 자동 전환**. 스케줄 데이터(12행)·UI는 보존하되 의미를 "백업"으로 변경.
- [ ] **우선순위 정합** — 우적(비) 오버라이드 최우선 → (센서 정상? 온습도 : 시간 스케줄). 개방/닫힘 인터록(1초) 유지.
- [ ] **백엔드 스키마/배포** — `FallbackConfig` 엔티티·`UpdateFallbackConfigDto`에 opener 조건 + `sensorTimeoutSeconds` 필드 추가, `publishSync` payload 반영, 마이그레이션, `updateConfig()` 검증(on>off, 범위).
- [ ] **Pi 룰 엔진** — `DEFAULT_RULES.config` 기본값, `SensorWatchdog` 모듈(heartbeat-watchdog 패턴), `opener.js` primary/backup 분기.
- [ ] **프론트 UI** — 개폐기 온습도 조건 카드(FanFailoverCard 재사용/일반화), 월별 스케줄 카드 "백업(온습도계 이상 시)" 재라벨, `openerValid` 저장 게이팅, 측정값 소스 안내 갱신.
- [ ] **동작 모드 가시화** — 현재 개폐기가 어떤 근거(온습도/백업 스케줄/우적)로 동작 중인지 이벤트·상태카드 한글 표기.

### 2.2 Out of Scope

- ❌ **폴백 전용 센서 개별 선택** — 오프라인에서는 env-config 매핑 조회 불가라 기존대로 "게이트웨이 수신 온/습도 최근값(last-writer-wins)"을 사용. 특정 온습도계 지정 기능은 별도 과제.
- ❌ **온라인(정상) 자동제어 룰 변경** — 서버 연결 시의 automation 엔진은 손대지 않음. 본 과제는 페일오버 로컬 룰만 대상.
- ❌ **개폐기 부분 개방(%)** — 릴레이 on/off(전량 개방/닫힘)만. 위치 피드백 없음.
- ❌ **유동팬 로직 변경** — fan.js는 참조·공유 헬퍼 추출 대상일 뿐 동작 변경 없음.

---

## 3. Requirements

### 3.1 Functional Requirements

- **FR-01 개폐기 온습도 primary 제어**: Pi가 온/습도 최근값을 읽어 히스테리시스로 개방/닫힘을 판단한다. `openerTriggerType`에 따라 °C 또는 % 사용. 현재 닫힘 상태에서 `reading > openerOnValue`면 개방, 현재 개방 상태에서 `reading < openerOffValue`면 닫힘. `openerOnValue > openerOffValue` 강제.
- **FR-02 온습도계 이상 감지**: `ingestSensor()`가 온·습도 수신 시각을 기록한다. `now - lastAt > sensorTimeoutSeconds`(기본값 제안: 600초=10분) 또는 값 없음이면 "센서 이상"으로 판정. 부팅 직후 오탐 방지 위해 cold-boot grace(예: 60초) 적용.
- **FR-03 시간 스케줄 백업 전환**: 센서 정상이면 FR-01, 센서 이상이면 **기존 월별 시간 스케줄(`store.scheduleFor(month)`)로 자동 동작**. 전환/복귀는 히스테리시스 없이 즉시(단, cold-boot grace 내 제외).
- **FR-04 우선순위·안전**: 평가 우선순위 = 우적(비) 오버라이드 → primary(온습도) / backup(시간). 어떤 경로든 개방/닫힘 동시 ON 금지(인터록 1초 OFF→ON) 유지. `openerEnabled=false`면 전체 비활성.
- **FR-05 백엔드 설정/배포**: `FallbackConfig`(엔티티+DTO)에 `openerTriggerType`, `openerOnValue`, `openerOffValue`, `sensorTimeoutSeconds` 추가. `publishSync()` payload `config`에 포함. `updateConfig()`에서 on>off·범위(-10~100) 검증(fan과 동일 규칙 재사용). 마이그레이션 신설(023 선례).
- **FR-06 Pi 룰 반영**: `rule-store.js` `DEFAULT_RULES.config`에 신규 필드 기본값 추가(applySync 병합 시 누락 대비). `SensorWatchdog` 신규 모듈로 stale 판정을 매 tick 1회 계산해 `opener.js`에 전달. `opener.js`는 우적 → (fresh? 온습도 : 스케줄) 분기.
- **FR-07 프론트 UI**: 개폐기 온습도 조건 편집 카드 제공(`FanFailoverCard.vue` 재사용/일반화 — 단위·step·min/max·트리거 전환 시 기본값 리셋 UX 포함). 월별 스케줄 카드는 유지하되 "온습도계 이상 시 동작하는 백업" 문구로 재라벨. `EmergencyFailover.vue`에 `openerValid` 게이팅·`editable` 필드 추가·측정값 소스 안내 갱신.
- **FR-08 동작 근거 표시**: 페일오버 이벤트/상태카드에 개폐기 제어 근거(온습도 개방/닫힘, 백업 스케줄, 우적, 센서 이상 전환)를 한글로 표기.

### 3.2 Non-Functional Requirements

- **NFR-01 오프라인 독립성**: 모든 판단은 Pi 로컬에서 수행. 서버·env-config 조회 없이 동작.
- **NFR-02 안전 우선**: 인터록·우적 최우선 원칙 불변. 센서 이상 시에도 무동작이 아니라 안전한 백업(시간 스케줄)로 전환.
- **NFR-03 하위호환**: 기존 `fallback_opener_schedule`(12행) 데이터·API 보존. 신규 필드는 기본값으로 안전 동작(예: `openerTriggerType` 미설정 시 기존 스케줄-only 동작과 동등).
- **NFR-04 버전 단조성**: `config.version` 증가로만 Pi 반영(`rule-store.applySync`가 `version <=` payload 무시). 채널 매핑 변경 시 auto-resync 유지.
- **NFR-05 오탐 최소화**: cold-boot grace + 합리적 timeout 기본값으로 "정상인데 백업 전환" / "죽은 센서로 계속 제어" 양극단 방지.
- **NFR-06 양측 동기 안전**: backend↔Pi 공유 타입 부재 → 신규 필드는 (1)DTO (2)엔티티 (3)publishSync literal (4)Pi DEFAULT_RULES.config **4곳 동시 수정** 체크리스트로 누락 방지.

---

## 4. Success Criteria

### 4.1 Definition of Done

- [ ] 서버 단절 상태에서 온도(또는 습도)가 개방 임계 초과 시 개폐기가 **개방**, 닫힘 임계 미만 시 **닫힘**을 자율 수행(실측 또는 시뮬레이션).
- [ ] 온습도 수신을 인위적으로 끊으면(센서 제거/무응답) `sensorTimeoutSeconds` 경과 후 **월별 시간 스케줄로 자동 전환**, 센서 복구 시 온습도 제어로 복귀.
- [ ] 우적 감지 시 위 어떤 상태에서도 즉시 닫힘(최우선) 동작.
- [ ] 개방/닫힘 동시 ON이 어떤 경로에서도 발생하지 않음(인터록 1초 확인).
- [ ] 관리자 UI에서 개폐기 온습도 임계값·트리거 종류를 설정·저장하면 Pi에 반영(version bump + waitForSync).
- [ ] 상태카드/이벤트에 "온습도 개방/닫힘" vs "백업 스케줄" 동작 근거가 한글로 표시.

### 4.2 Quality Criteria

- [ ] Gap 분석 Match Rate ≥ 90%.
- [ ] 신규 필드 4곳 동기 누락 없음(DTO/엔티티/publishSync/DEFAULT_RULES).
- [ ] 기존 페일오버 시나리오(유동팬·관수·시비·우적) 회귀 없음.
- [ ] Pi 오프라인 단독 동작(서버 연결 0) 확인.

---

## 5. Risks and Mitigation

| 리스크 | 영향 | 완화 |
|---|---|---|
| stale timeout 값 부적절(너무 짧음→정상인데 백업 전환 / 너무 김→죽은 센서로 계속 제어) | 오동작·과열 | 합리적 기본값(10분) + 관리자 설정 가능 + cold-boot grace |
| 온습도 last-writer-wins(여러 센서 혼재 시 값 튐) | 부정확 개방/닫힘 | 기존 운영 제약(단일 온습도계) 유지 안내, 센서 개별 선택은 별도 과제로 명시 |
| backend↔Pi 수동 동기 필드 누락 | 반영 안 됨/기본값 동작 | 4곳 동시수정 체크리스트(NFR-06) + applySync 기본값 병합 |
| 개방 방향 의미(고온에 개방 vs 저온에 개방) 오해 | 반대 동작 | 설계 단계에서 "환기=고온/고습에 개방, 저온/저습에 닫힘" 기본 확정, UI 문구 명시 |
| 전환 순간 채터링(임계 근처 반복 개폐) | 모터·릴레이 마모 | 히스테리시스(on≠off) + 센서전환은 grace 내 억제, 인터록 1초 |

---

## 6. Architecture Considerations

### 6.1 Project Level Selection

**Enterprise** — Pi 엣지 룰 엔진 + 백엔드 배포 파이프라인 + 프론트 설정 UI 3계층 동기가 필요한 안전 관련 기능.

### 6.2 Key Architectural Decisions

- **온습도 판정 로직 공유화**: `fan.js`의 히스테리시스 판정을 공용 헬퍼(예: `lib/rule-evaluator/hysteresis.js`)로 추출해 fan·opener가 재사용(중복·불일치 방지). fan 동작은 불변.
- **SensorWatchdog = HeartbeatWatchdog 복제**: `lastTemperatureAt`/`lastHumidityAt` + `sensorTimeoutSeconds` + cold-boot grace. 매 tick `RuleEvaluator.evaluate()`에서 1회 계산해 `opener.evaluate(args)`에 `sensorFresh` 전달(fan/opener 간 최초의 공유 의존성).
- **스케줄 테이블 유지, 의미만 변경**: `fallback_opener_schedule`(12행)·UpsertOpenerScheduleDto·월별 UI는 그대로. 평가 시 "primary 실패(센서 이상) 시 사용하는 backup"으로 역할만 강등.
- **opener 조건 필드 위치**: fan과 대칭되게 `FallbackConfig`(단일행)에 `openerTriggerType/openerOnValue/openerOffValue` 추가(별도 테이블 아님). 스케줄은 별도 테이블 유지.

### 6.3 데이터 흐름 (개폐기 평가)

```
[관리자 UI] 개폐기 온습도 임계 + 백업 스케줄 설정
   → PATCH fallback-config (updateConfig 검증)
   → publishSync(payload.config += openerTrigger/On/Off, sensorTimeoutSeconds)
   → MQTT publishFallbackRulesSync
   → Pi rule-store.applySync (version↑, DEFAULT_RULES.config 병합, persist)

[Pi 매 tick 30s] ingestSensor(z2m) → lastTemp/Humidity(+At)
   RuleEvaluator.evaluate():
     sensorFresh = SensorWatchdog(now, lastAt, timeout, grace)
     opener.evaluate({ rainActive, sensorFresh, reading, cfg, store }):
        if rainActive        → 닫힘(최우선)
        elif !openerEnabled  → 무동작
        elif sensorFresh     → 온습도 히스테리시스(개방/닫힘)   # primary
        else                 → 월별 시간 스케줄(store.scheduleFor) # backup
     setOpenerIntent(intent)  # 인터록 1초 OFF→ON
```

### 6.4 Clean Architecture Approach

- Pi: 순수 판정 로직(hysteresis, watchdog)과 부수효과(relay-bridge)를 분리. `opener.js`는 의도(intent)만 계산, 채널 토글은 기존 `setOpenerIntent`.
- Backend: DTO 검증(입력) ↔ 엔티티(저장) ↔ publishSync(전파) 계층 유지. 신규 필드는 fan 패턴을 그대로 따름.

---

## 7. Convention Prerequisites

### 7.1 Existing Project Conventions

- fan 필드 명명(`fanTriggerType/fanOnTemp/fanOffTemp`)과 대칭되는 opener 명명.
- 마이그레이션 번호 순차(다음 번호 신설), forward-only.
- Pi/backend 필드명 일치로 수동 동기(공유 타입 없음).

### 7.2 Conventions to Define/Verify

- opener 조건 필드명 확정: `openerOnValue/openerOffValue`(단위 트리거 의존) vs `openerOpenTemp/openerCloseTemp`. → **fan과 대칭 위해 `openerTriggerType/openerOnValue/openerOffValue` 제안**(on=개방, off=닫힘).
- `sensorTimeoutSeconds` 기본값·범위 확정(제안 600s, 120~3600).
- cold-boot grace 값 확정(제안 60s, heartbeat와 동일).
- 개방 방향 의미 확정(환기: 고온/고습 개방).

### 7.3 Environment Variables Needed

- 없음(설정은 DB/룰 배포 경유). Pi 상수(`SENSOR_COLD_BOOT_GRACE_MS`)는 코드 상수 또는 config 필드.

### 7.4 Pipeline Integration

- 배포: 기존 `smartfarm_mqtt pull 빌드 배포` + Pi 룰 자동 resync(version). Pi 엔진 코드 변경은 `apply-agent-update.sh` 경로로 배포.

---

## 8. Next Steps

1. `/pdca design emergency-opener-env-control` — 상세 설계(필드 확정, opener.js 분기 의사코드, SensorWatchdog 인터페이스, UI 컴포넌트 재사용/신설 결정, 마이그레이션 SQL, 4곳 동기 체크리스트).
2. 설계 확정 후 `/pdca do` — Pi(watchdog·opener·hysteresis 추출) → backend(DTO/엔티티/publishSync/마이그레이션) → frontend(카드·게이팅·문구) 순 구현.
3. `/pdca analyze` — Gap 분석(≥90%).

### 확인 필요(설계 전 사용자 결정)

- **개방 방향**: 환기 목적상 "온도/습도가 **높을 때 개방**, 낮을 때 닫힘"이 기본이 맞는지? (fan과 동일 방향)
- **센서 이상 timeout 기본값**: 10분이 적절한지, 더 짧게/길게?
- **트리거 종류**: 개폐기도 온도/습도 **택1**(fan과 동일)인지, 아니면 온·습도 **동시 조건**(둘 중 하나라도 초과 시 개방)까지 필요한지?

---

## Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-07-05 | ohjeongseok | 최초 Plan 작성 — 개폐기 온습도 primary + 시간 스케줄 백업 강등, 온습도계 stale 감지 |
