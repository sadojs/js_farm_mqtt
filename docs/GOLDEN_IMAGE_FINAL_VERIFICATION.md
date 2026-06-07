# Golden Image 최종 회귀 검증 보고서 — 2026-06-07

> 라즈베리파이 골든 이미지 추출 + SD 배포 + 프로덕션 롤아웃 직전 최종 회귀.
> 기준: [TEST_SCENARIOS.md](./TEST_SCENARIOS.md) TC-01~10 + 최근 회귀 6건 (총 10 + 6 = 16 항목, 24 sub-check).
> 계정: `mtest` (farm_admin) / 게이트웨이: `hk-house` / 16 devices, 5 rules.

---

## 종합

| 영역 | 결과 |
|---|---|
| TC-01~10 핵심 시나리오 | **10/10 PASS** |
| 최근 회귀 (sprint 추가) | **6/6 PASS** |
| 자동 스크립트 24 sub-check | **22 PASS / 2 FAIL** |
| **FAIL 항목 분석** | 둘 다 **테스트 스크립트 버그** (코드는 정상) |

**판정: 골든 이미지 추출 진행 가능 ✅**

---

## TC-01~10 결과

| TC | 영역 | 결과 | 비고 |
|---|---|---|---|
| TC-01 | 장치 분류 무결성 | ✅ PASS | 16 device, source⊆{onboard,zigbee}, equipmentType⊆허용집합, opener pair 2:2 |
| TC-02 | 단일 라우팅 3 path | ✅ PASS | GPIO 4건 + Z2M 1건 캡처, switch_2→state_l2 변환 확인 |
| TC-03 | 개폐기 인터록 1초 | ✅ PASS | MQTT 캡처로 검증: vent_open OFF → 1006ms → vent_close ON |
| TC-04 | 페어 단일 삭제 차단 | ✅ PASS | HTTP 400 "/devices/:id/opener-pair 로 쌍 삭제" |
| TC-05 | 관수 원격제어 연동 | ✅ PASS | 룰 toggle 시 remoteControlEnabled 동기화 (룰 enabled=false → null/false) |
| TC-06 | 자동제어룰 CRUD | ✅ PASS | CREATE(POST 201) / UPDATE(**PUT** 200) / DELETE(204) |
| TC-07 | 액비 시간 백엔드 차단 | ✅ PASS | 액비 룰 1건, duration ≤ 30분 위반 0건 |
| TC-08 | 수동 pin/release 정책 | ✅ PASS | `deviceSettings` 에 `ruleIntendedState/userOverride/relayActiveRuleId` 키 노출 |
| TC-09 | autoEnableRemote 룰 토글 | ✅ PASS | `?autoEnableRemote=true` 쿼리 호출 시 룰 정상 생성 |
| TC-10 | Device Replacement | ✅ PASS | replacement-candidates endpoint 가용 |

---

## 최근 회귀 (이번 sprint 추가/수정)

| 항목 | 검증 | 결과 |
|---|---|---|
| reports uuid::text 캐스팅 | `/reports/actuator-stats?groupId=…` → 6 rows | ✅ PASS |
| reports gateway→house→group 필터 | `/reports/statistics?groupId=…` → 6 rows | ✅ PASS |
| reports hourly 필터 | `/reports/hourly?groupId=…` → 78 rows | ✅ PASS |
| sensors E1 리스킨 (회귀 영향 X) | env-config resolved → 5+ roles 정상 | ✅ PASS |
| 자동제어 로그 dedup | 지난 20분 = 0건 (펄스 토글 로그 미생성) | ✅ PASS |
| emergency-failover fanTriggerType | `fallback-config/hk-house` → `temperature` | ✅ PASS |

---

## FAIL 분석 — 테스트 스크립트 버그

### FAIL ① "인터록: 닫기 ON 인 상태" — 검증 방법 오류
- **스크립트**: `device.switchState` 폴링으로 인터록 후 닫기 상태 확인 시도
- **실제**: `switchState` 컬럼은 onboard relay의 비동기 ack 를 기다리는 별개 슬롯이라 즉시 조회 시점에 null 반환
- **MQTT 캡처로 재검증**: vent_open ON → vent_open OFF (인터록) → 1006ms 대기 → vent_close ON ✅
- **결론**: **코드 정상**, 테스트 검증 방식만 보강 필요 (publishedMqttBus 또는 deviceSettings.relayActivePhase 폴링)

### FAIL ② "룰 UPDATE" — HTTP 메서드 오류
- **스크립트**: `PATCH /automation/rules/:id` 호출 → 404 "Cannot PATCH"
- **실제**: 룰 수정은 **PUT** 메서드를 사용. PATCH 미지원
- **PUT 재검증**: 200 OK, name 정상 갱신 확인 ✅
- **결론**: **코드 정상**, 스크립트 메서드 수정 필요

---

## 골든 이미지 추출 전 체크리스트

- [x] backend tsc / frontend vue-tsc EXIT 0
- [x] vite build 성공 (chunk size 정상 범위)
- [x] backend 헬스체크 OK (DB 1ms, MQTT online)
- [x] PostgreSQL 최근 ERROR 없음 (uuid 캐스팅 픽스 이후 클린)
- [x] 자동제어 로그 노이즈 dedup 작동 — 정적 룰 0건/20분
- [x] 알림 센터 데두프 — 토스트 only success/info, 60초 dedup
- [x] 이머전시 페일오버 fanTriggerType 컬럼 + RPi rule-store 기본값 반영
- [x] 마이그레이션 023 적용 완료 (`/opt/homebrew/.../psql -f ...`)
- [x] 사이드바: 플랫폼 관리자에 "우리 농장" 미노출
- [x] 사용자 관리 U3 마스터-디테일 리스킨 적용 (logic 무변경)

---

## 라즈베리파이 골든 이미지 배포 시 주의 사항

### 필수 동기화 흐름
1. **마이그레이션 023** (`fan_trigger_type` 컬럼) 이 적용된 DB 로 백엔드 시작.
2. 백엔드가 `publishSync` 호출 시 `fanTriggerType` 을 포함하여 RPi 에 전송.
3. RPi 의 `fallback-engine` (`rule-store.js`, `rule-evaluator/index.js`, `fan.js`) 이 신규 코드 반영되어 있어야 함.

### RPi 측 업데이트 절차
```bash
# 골든 이미지에 이미 포함되어 있어야 함:
cd /opt/smart-farm/raspberry-pi/fallback-engine
git pull origin main  # 또는 image 에 baked in
sudo systemctl restart fallback-engine

# 검증
journalctl -u fallback-engine -n 50 --no-pager
# "ingestSensor … humidity" 라인이 보이면 정상
```

### 첫 부팅 시 자동 검증 항목
- [ ] `fallback_configs.fan_trigger_type` 컬럼 NOT NULL DEFAULT 'temperature' 적용
- [ ] RPi 가 동기화 페이로드에서 `fanTriggerType` 키 수신
- [ ] 환기팬 폴백 모드에서 humidity 트리거 작동 (수동 발행으로 검증 가능)
- [ ] 폴백 이벤트가 한글로 표시 (`/emergency-failover` 페이지)

---

## 결론

- 모든 핵심 시나리오 PASS
- 자동 스크립트의 2건 FAIL은 검증 방법 오류 — 실제 코드/동작은 정상
- 이번 sprint 추가 변경 (reports/sensors/logs/notifications/emergency-failover) 모두 회귀 통과
- **골든 이미지 추출 진행을 권고합니다.**

마지막 검증 시각: `2026-06-07 12:57 KST`
검증자: Claude (mtest 자동 스크립트 + MQTT 캡처 보조)
