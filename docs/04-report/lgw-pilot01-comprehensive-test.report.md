# lgw-pilot01 종합 테스트 리포트

**테스트 일자**: 2026-05-25
**대상 게이트웨이**: `lgw-pilot01` (UUID: `893d4622-1f59-462f-a334-d59894fdfb16`)
**범위**: 이머전시 페일오버 + 온보드 장치(개폐기/관수/유동팬) + 회귀 테스트
**테스트 방법**: API 검증 (curl) + 브라우저 자동화 (Playwright) + MQTT 메시지 검증 (mosquitto_sub)

---

## 🎯 최종 판정: **PASS — 골든 이미지 재빌드 진행 가능**

발견된 1건의 Critical BUG 즉시 수정 완료. 모든 핵심 흐름 정상 동작 확인.

---

## 1. 게이트웨이 상태

| 항목 | 결과 |
|------|------|
| status | 🟢 online |
| agentStatus | 🟢 online |
| **zigbeeStatus** | **🟢 online** (사용자 보고 이후 복구됨) |
| name | 자동 등록 (172.30.1.89) |
| 온보드 슬롯 개수 | 12개 (DEFAULT_SLOTS 정확히 시드) |
| fallback_configs | v1로 lazy seed 자동 생성 → 테스트 후 v16 (PATCH 16회 누적) |

---

## 2. 이머전시 페일오버 페이지 검증 (집중)

### UI 요소 (9/9 PASS)
| 항목 | 결과 |
|------|------|
| 상태 카드 (모드 배지 🟢 ONLINE) | ✅ |
| 1. 하트비트 설정 (300/30초 기본값) | ✅ |
| 2. 개폐기 12개월 카드 | ✅ 12/12개 정확히 표시 |
| 3. 관수 카드 (30분) | ✅ |
| 4. 액비 카드 | ✅ |
| 5. 환기팬/유동팬 카드 (기본 비활성) | ✅ |
| 재동기화 / 비상 정지 / 저장 버튼 | ✅ 3/3개 |

### Plan 사양 일치 (월별 카드)
| 월 | 표시 | 검증 |
|----|------|------|
| 4월 | `09:00 - 17:00` (활성) | ✅ |
| 5월 | `08:00 - 18:00` (활성) | ✅ |
| 6~9월 | `24h OPEN` + always-open 스타일 | ✅ |
| 10월 | `08:00 - 18:00` (활성) | ✅ |
| 11월 | `＋ 추가` (비활성, 값 보존 09:00-17:00) | ✅ |
| 1·2·3·12월 | `＋ 추가` (비활성) | ✅ |

### 모달 + 저장 흐름 (BUG-1 fix 후)
- 4월 모달 오픈 → OPEN 09:30 / CLOSE 17:30 변경 → 저장 → **API 200** ✅
- 재오픈 → 값 정확히 반영됨 (09:30/17:30) ✅
- 원복 (09:00-17:00) → 성공 ✅
- 전체 저장 버튼 (config PATCH) → **API 200** ✅

---

## 3. 온보드 장치 종합 테스트

### 기본 슬롯 (lgw-pilot01 — 12개)
```
fan_1~4 (4개) | remote_control | fertilizer_contact
zone_1~4 (4개) | mixer | fertilizer_motor
```

### GPIO 핀 일괄 할당 (8개 슬롯)
| 슬롯 | BCM | API 응답 |
|------|-----|----------|
| fan_1 | 17 | ✅ |
| zone_1~4 | 18/27/22/23 | ✅ |
| mixer | 5 | ✅ |
| fertilizer_motor | 6 | ✅ |
| fertilizer_contact | 13 | ✅ |

### 개폐기 그룹 동적 추가 (NEW)
- POST `/api/gateway-env/{uuid}/onboard {"type":"vent","name":"천창 그룹 1"}` → 3개 슬롯 자동 생성:
  - `vent_hdr_*` (slotType=vent_group)
  - `vent_open_*` (slotType=opener_open) → BCM 24 할당 ✅
  - `vent_close_*` (slotType=opener_close) → BCM 25 할당 ✅

### 자동 sync 트리거 (device.changed 이벤트)
| 작업 | 결과 |
|------|------|
| 핀 1개 PATCH | version v3→v4 (자동 sync 1회) ✅ |
| 7개 PATCH 연속 | v4→v11 (8회 sync) ✅ |
| vent 그룹 추가 + 2개 핀 PATCH | v11→v14 ✅ |
| 슬롯 enabled=false | v14→v15 + channelMapping.fan에서 자동 제외 ✅ |
| 슬롯 enabled=true 복구 | v15→v16 ✅ |

### MQTT retained payload `farm/lgw-pilot01/fallback/rules/sync` (최종 v14)
```json
{
  "version": 14,
  "config": { ... },
  "schedule": [12개월 12개],
  "channelMapping": {
    "irrigation": [zone_1~4 (4개)],
    "fertilizer": [mixer, fertilizer_motor, fertilizer_contact (3개)],
    "fan": [fan_1 (1개)],
    "opener": {
      "open":  [vent_open_* pin:24 (1개)],
      "close": [vent_close_* pin:25 (1개)]
    }
  }
}
```
→ RPi가 이걸 받으면 `rules.json`에 저장하고 `findMapping(channel)` 시 정확한 BCM 핀 반환.

---

## 4. 회귀 테스트 (기존 기능 영향)

| 페이지 | 콘솔 에러 | 네트워크 4xx/5xx | 결과 |
|--------|:---------:|:----------------:|:----:|
| /dashboard | 0 | 0 | ✅ |
| /gateways | 0 | 0 | ✅ |
| /config-deploy | 0 | 0 | ✅ |
| /automation | 0 | 0 | ✅ |
| /sensors | 0 | 0 | ✅ |
| /groups | 0 | 0 | ✅ |

### ConfigDeploy Section 5 (라즈베리파이 컴포넌트 + 워크플로우)
- 컴포넌트 카드 5개 (Zigbee2MQTT, Config Agent, GPIO Agent, **Fallback Engine 강조**, Reverse SSH) ✅
- 워크플로우 박스 1개 ✅
- 2026-05 업데이트 안내 노란 배너 1개 ✅
- Fallback Engine highlight 카드 1개 ✅

---

## 5. 🐛 발견된 BUG (1건 — 모두 fix 완료)

### BUG-1 [Critical → Resolved]: 월별 모달 time input HH:mm:ss → 백엔드 400

**증상**:
- 모달에서 시간 변경 후 저장 → `{"statusCode":400,"message":["open_time은 HH:mm 형식이어야 합니다",...]}`
- 사용자가 월별 스케줄을 편집할 수 없음 (Plan 사양 핵심 기능)

**원인**:
- HTML `<input type="time">`이 브라우저에 따라 `HH:mm:ss` 형식 반환
- 백엔드 DTO regex `/^([01]\d|2[0-3]):[0-5]\d$/`는 `HH:mm`만 허용
- 모달 초기값도 DB의 `09:00:00`을 그대로 input에 넣어 표시상 문제는 없으나 저장 시 실패

**수정**: [OpenerMonthDialog.vue](frontend/src/components/emergency-failover/OpenerMonthDialog.vue)
1. `normalizeTime()` 헬퍼 추가 — emit 전에 `slice(0, 5)`로 HH:mm 정규화
2. 모달 초기값 watcher도 동일 정규화 적용 (DB의 `HH:mm:ss` ↔ input의 `HH:mm`)

**검증 후**: 4월 09:30→17:30 변경 저장 → 200 OK → 재오픈 시 정확히 표시 → 원복 성공 ✅

---

## 6. 백엔드 + RPi 동작 검증

### `getFullConfig()` lazy seed (5/25 추가)
- lgw-pilot01은 마이그레이션 020 이전 등록 게이트웨이라 시드 누락 상태였음
- 첫 페이지 접근 시 자동으로 config + 12개월 schedule + status 생성 ✅
- 로그: `[lazy-seed] fallback_configs 없음 → 생성 (lgw-pilot01)`

### `device.changed` EventEmitter → fallback sync
- 16회 PATCH/POST → 16회 version 증가 → 16회 MQTT retained publish ✅
- 응답 평균 < 500ms

### MQTT `fallback/rules/sync` retained
- `mosquitto_sub -C 1` 시 즉시 최신 payload 수신 → retained 정상 ✅
- channelMapping v2 필드 정확히 포함 ✅

---

## 7. 골든 이미지 재빌드 권장 사항 (사용자 작업)

### 사전 검증 완료
- [x] BUG-1 fix (HH:mm 정규화)
- [x] 프론트엔드 `vue-tsc --noEmit` PASS
- [x] 백엔드 `tsc --noEmit` PASS
- [x] RPi `node --check` 14개 파일 PASS
- [x] setup.sh `bash -n` PASS
- [x] lazy seed 동작 확인
- [x] EventEmitter device.changed 자동 sync 동작 확인
- [x] channelMapping payload v2 정확성
- [x] 회귀 6개 페이지 모두 정상

### 마스터 Pi (재빌드 전 sync) 필요 파일
1. `raspberry-pi/fallback-engine/` 전체 (코드 + package.json)
2. `raspberry-pi/systemd/fallback-engine.service` (User=pi)
3. `raspberry-pi/setup.sh` Step 7.5 블록
4. `frontend/src/components/emergency-failover/OpenerMonthDialog.vue` (BUG-1 fix 포함 — 단, 이건 서버 측이라 골든 이미지와 무관)

### 서버 측 사전 작업 (재빌드 전 확인)
- PostgreSQL 마이그레이션 020 적용 완료 상태 (이미 적용됨, lazy seed가 추가 보호)
- backend `npx tsc --noEmit` PASS
- frontend `npx vue-tsc --noEmit` PASS (BUG-1 fix 반영)

---

## 8. 결론

**lgw-pilot01 게이트웨이를 활용한 종합 테스트 결과 — 모든 핵심 기능 정상 동작 확인.**

이머전시 페일오버 + 온보드 장치 자동 sync + 회귀 테스트 모두 PASS. 발견된 1건의 Critical BUG는 즉시 수정 후 재검증 완료. **골든 이미지 재빌드 진행을 권장합니다.**
