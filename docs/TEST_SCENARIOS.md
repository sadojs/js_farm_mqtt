# Smart Farm MQTT — 회귀 테스트 시나리오

> 매 디자인/로직 수정 후 실행해야 하는 **재현 가능한 회귀 테스트** 모음.
> 모든 시나리오는 mtest 계정(`farm_admin`)으로 검증 가능. 결과는 ✅/❌로 표시.
> 마지막 일괄 검증: `2026-06-07` — 골든 이미지 추출 직전 최종 회귀.
> 10/10 PASS + 최근 회귀 6/6 PASS → [GOLDEN_IMAGE_FINAL_VERIFICATION.md](./GOLDEN_IMAGE_FINAL_VERIFICATION.md)
> 이전 회귀: `2026-06-04` → [CONTROL_LOGIC_VERIFICATION.md](./CONTROL_LOGIC_VERIFICATION.md)
>
> ⚠ **테스트 스크립트 작성 시 주의**:
> 1. 룰 수정은 **PUT** 메서드 (PATCH 미지원)
> 2. 개폐기 인터록 검증은 `device.switchState` 대신 **MQTT 캡처** 로 (switchState 는 비동기 ack 슬롯)

---

## 환경 준비

```bash
# 백엔드 헬스체크
curl -s http://localhost:3100/api/health | jq

# mtest 로그인 → JWT
TOKEN=$(curl -s -X POST http://localhost:3100/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"mtest","password":"admin123"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['accessToken'])")
echo "TOKEN=$TOKEN" > /tmp/mtest-token

# MQTT 브로커
mosquitto_sub -h localhost -p 1883 -t 'farm/+/gpio/relay' -t 'farm/+/z2m/+/set' -v

# DB
PGPASSWORD=smartfarm123 psql -h localhost -p 5432 -U smartfarm -d smartfarm_mqtt
```

### mtest 자산 (변동 시 ID 갱신 필요)
| 종류 | name | id |
|---|---|---|
| onboard fan | HK_유동팬 1번 | `feb3027c-8075-46fb-85cc-61d2d88b39ad` |
| zigbee fan TS0001 | HK_유동펜 GB | `df8ae73a-cb03-4f42-acca-6c525368fc1e` |
| zigbee irrigation TS0601_8CH | HK_지그비릴레이 (8CH) | `63700271-a8bf-4dd9-b476-ff2d44b5edc9` |
| onboard irrigation | HK_관주 | `2fda9a60-f53e-4414-b552-504ea12f8c80` |
| opener pair open | HK_개폐기01 열기 | `139c1e84-7e73-42ab-a8b6-e7c2b0f259fa` |
| opener pair close | HK_개폐기01 닫기 | `74a22150-1264-4348-93fd-81692dfb7c0e` |
| group hk-house | hk-house | `e52b369e-9839-4ce6-b3e0-ea5581fd3b6c` |

---

## TC-01 : 장치 분류 무결성 (DEVICE_CONTROL_LOGIC §1)

**목적**: API 반환 device의 `equipmentType` / `source` / `deviceType` 분포가 의도대로 유지되는지.

**스텝**:
```bash
curl -s http://localhost:3100/api/devices -H "Authorization: Bearer $TOKEN" \
  | jq '[ .[] | { source, equipmentType, deviceType } ] | group_by("\(.source)|\(.equipmentType)|\(.deviceType)") | map({key:.[0], count:length})'
```

**합격 조건**:
- equipmentType 종류: `fan` / `irrigation` / `opener_open` / `opener_close` / `controller` / `other` 만 존재
- source: `onboard` / `zigbee` 만 존재
- 페어 개폐기는 `opener_open` + `opener_close` 수가 같음

**최근 결과** (2026-06-04): ✅ PASS — 16개 device 모두 정상 분류

---

## TC-02 : 단일 라우팅 — 3가지 publish path (§1.1)

**목적**: `publishDeviceSwitch()`가 source별로 정확한 MQTT 토픽/payload를 사용하는지.

**스텝**:
```bash
# MQTT 캡처 시작 (별도 터미널)
mosquitto_sub -h localhost -p 1883 -t 'farm/+/gpio/relay' -t 'farm/+/z2m/+/set' -v

# 1) onboard fan ON
curl -X POST http://localhost:3100/api/devices/feb3027c-8075-46fb-85cc-61d2d88b39ad/control \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"commands":[{"code":"state","value":true}]}'

# 2) zigbee single fan ON
curl -X POST http://localhost:3100/api/devices/df8ae73a-cb03-4f42-acca-6c525368fc1e/control \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"commands":[{"code":"state","value":true}]}'

# 3) zigbee TS0601_8CH zone_1 ON (switch_2 → state_l2 자동 변환)
curl -X POST http://localhost:3100/api/devices/63700271-a8bf-4dd9-b476-ff2d44b5edc9/control \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"commands":[{"code":"switch_2","value":true}]}'
```

**합격 조건**:
| Device | 토픽 | Payload |
|---|---|---|
| onboard fan | `farm/hk-house/gpio/relay` | `{slot, pin, state:true, requestId}` |
| zigbee single | `farm/hk-house/z2m/{ieee}/set` | `{state:"ON"}` |
| zigbee TS0601 8CH | `farm/hk-house/z2m/{ieee}/set` | `{state_l2:"ON"}` ← switch_2 자동 변환 |

**최근 결과**: ✅ PASS — 3가지 토픽 모두 예상대로 발행

**정리**: 같은 명령으로 `value:false` 발행

---

## TC-03 : 개폐기 인터록 (§3.2)

**목적**: 사용자 또는 자동화가 한쪽 ON 요청 시 반대편 OFF + **정확히 1초 대기** + 목표 ON 순서.

**스텝**:
```bash
mosquitto_sub -h localhost -p 1883 -t 'farm/+/gpio/relay' -v > /tmp/interlock.log 2>&1 &
SUB_PID=$!
sleep 0.5

# 열기 ON 명령 (paired는 자동 닫기 OFF)
START=$(date +%s%N)
curl -X POST http://localhost:3100/api/devices/139c1e84-7e73-42ab-a8b6-e7c2b0f259fa/control \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"commands":[{"code":"state","value":true}]}'
END=$(date +%s%N)
echo "elapsed: $(( ($END - $START) / 1000000 ))ms"

sleep 1
kill $SUB_PID
cat /tmp/interlock.log
```

**합격 조건**:
- 2개 MQTT 발행: `vent_close_*` OFF → 이후 ~1000ms 차이 → `vent_open_*` ON
- API 응답 elapsed time ≥ 1000ms (인터록 1초 대기 포함)

**최근 결과**: ✅ PASS
```
farm/hk-house/gpio/relay {"slot":"vent_close_8c3cfa43","pin":25,"state":false,"requestId":1780617215789}
farm/hk-house/gpio/relay {"slot":"vent_open_8c3cfa43","pin":24,"state":true,"requestId":1780617216794}
```
1005ms 차이 (1초 대기 정확) + 총 응답 1.08초

**정리**: 열기 OFF
```bash
curl -X POST http://localhost:3100/api/devices/139c1e84-7e73-42ab-a8b6-e7c2b0f259fa/control \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"commands":[{"code":"state","value":false}]}'
```

---

## TC-04 : 개폐기 페어 삭제 차단 (§3.5)

**목적**: 개폐기 개별 삭제 금지 / 룰이 참조 중인 페어 삭제 차단.

**스텝**:
```bash
# A. 개별 삭제 시도 (400 BadRequest 예상)
curl -X DELETE http://localhost:3100/api/devices/139c1e84-7e73-42ab-a8b6-e7c2b0f259fa \
  -H "Authorization: Bearer $TOKEN"

# B. 룰 사용 중 페어 삭제 시도 (409 Conflict 예상)
curl -X DELETE http://localhost:3100/api/devices/139c1e84-7e73-42ab-a8b6-e7c2b0f259fa/opener-pair \
  -H "Authorization: Bearer $TOKEN"
```

**합격 조건**:
- A: `400` + `"개폐기 장비는 /devices/:id/opener-pair 를 통해 쌍으로 삭제해야 합니다."`
- B: `409` + `"자동화 룰에서 사용 중인 장비는 삭제할 수 없습니다."`

**최근 결과**: ✅ PASS

---

## TC-05 : 관수 원격제어 연동 (§5.2)

**목적**: 원격제어 ON 시 `fertilizer_b_contact` 자동 동시 ON / OFF 시 모든 매핑 스위치 강제 OFF.

⚠️ **주의**: 명령 code는 **매핑된 switchCode**(예: `relay_remote_control`)이지 **논리 키**(`remote_control`)가 아님. UI는 `getMapping(device)['remote_control']`로 자동 변환하므로 사용자 영향 없음. API 직접 호출 시 주의.

**스텝 (onboard 관수 HK_관주)**:
```bash
mosquitto_sub -h localhost -p 1883 -t 'farm/+/gpio/relay' -v > /tmp/remote-on.log 2>&1 &
SUB_PID=$!
sleep 0.5

# ON — onboard는 'relay_remote_control'
curl -X POST http://localhost:3100/api/devices/2fda9a60-f53e-4414-b552-504ea12f8c80/control \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"commands":[{"code":"relay_remote_control","value":true}]}'

sleep 1; kill $SUB_PID
cat /tmp/remote-on.log
```

**합격 조건 (ON)**:
- 2개 발행: `fertilizer_contact` ON + `remote_control` ON (순서 무관)

**OFF 시**:
```bash
mosquitto_sub -h localhost -p 1883 -t 'farm/+/gpio/relay' -v > /tmp/remote-off.log 2>&1 &
SUB_PID=$!
sleep 0.5

curl -X POST http://localhost:3100/api/devices/2fda9a60-f53e-4414-b552-504ea12f8c80/control \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"commands":[{"code":"relay_remote_control","value":false}]}'

sleep 2; kill $SUB_PID
cat /tmp/remote-off.log
```

**합격 조건 (OFF)**:
- 매핑된 모든 스위치(5개: mixer, zone_1, remote_control, fertilizer_motor, fertilizer_contact) 강제 OFF

**최근 결과**: ✅ PASS — ON 2건 / OFF 5건 발행 확인

---

## TC-06 : 자동제어룰 CRUD (§6)

**목적**: 룰 생성/조회/토글/수정/삭제 라이프사이클.

⚠️ **주의**: `ruleType`은 서버가 conditions에서 자동 결정 (`determineRuleType`). 클라이언트 페이로드에 포함하면 **400 Bad Request**.

**스텝**:
```bash
GROUP_ID="e52b369e-9839-4ce6-b3e0-ea5581fd3b6c"
FAN_ID="feb3027c-8075-46fb-85cc-61d2d88b39ad"

# A. CREATE (시간 룰)
RULE_ID=$(curl -s -X POST http://localhost:3100/api/automation/rules \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{
    \"name\":\"[TEST] 시간 환풍\",
    \"groupId\":\"$GROUP_ID\",
    \"conditions\":{\"logic\":\"AND\",\"groups\":[{\"logic\":\"AND\",\"conditions\":[{\"type\":\"time\",\"field\":\"time\",\"operator\":\"between\",\"value\":[1320,1325],\"daysOfWeek\":[0,1,2,3,4,5,6]}]}],\"target\":{}},
    \"actions\":{\"targetDeviceId\":\"$FAN_ID\",\"targetDeviceIds\":[\"$FAN_ID\"]},
    \"priority\":1
  }" | jq -r '.id')
echo "Created: $RULE_ID"

# B. TOGGLE (enabled true → false)
curl -X PATCH http://localhost:3100/api/automation/rules/$RULE_ID/toggle \
  -H "Authorization: Bearer $TOKEN"

# C. UPDATE
curl -X PUT http://localhost:3100/api/automation/rules/$RULE_ID \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"[TEST] 수정됨"}'

# D. DELETE
curl -X DELETE http://localhost:3100/api/automation/rules/$RULE_ID \
  -H "Authorization: Bearer $TOKEN"
```

**합격 조건**:
- CREATE: 200 OK, server-set `ruleType` = `"time"`
- TOGGLE: enabled가 true ↔ false 반전
- UPDATE: name 변경 반영
- DELETE: DB row 삭제

**최근 결과**: ✅ PASS — 4단계 모두 정상

---

## TC-07 : 액비 시간 3중 방어 (§5.6)

**목적**: 관주시간 < 액비 투여시간 + 종료전대기 일 때 룰 저장 차단.

**스텝**:
```bash
# 위반 룰 생성 시도 (400 예상)
curl -X POST http://localhost:3100/api/automation/rules \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{
    \"name\":\"[TEST] 위반\",
    \"groupId\":\"$GROUP_ID\",
    \"conditions\":{
      \"type\":\"irrigation\",
      \"startTime\":\"08:00\",
      \"zones\":[{\"name\":\"1구역\",\"channel\":\"zone_1\",\"duration\":5,\"enabled\":true}],
      \"mixer\":{\"enabled\":true},
      \"fertilizer\":{\"enabled\":true,\"duration\":5,\"preStopWait\":2},
      \"schedule\":{\"days\":[1,2,3,4,5],\"repeat\":true}
    },
    \"actions\":{\"targetDeviceId\":\"$IRR_ID\",\"targetDeviceIds\":[\"$IRR_ID\"]},
    \"priority\":1
  }"
```

**합격 조건**:
- `400` + 에러 메시지에 "관주시간이 액비 투여시간+종료전대기보다 짧습니다" 포함
- 메시지에 1구역 명시: `1구역: 관주시간(5분) < 투여시간(5분)+종료전대기(2분)=7분`

**최근 결과**: ✅ PASS

---

## TC-08 : 수동 pin/release 정책 (§8 보강 — 신규 정책)

**목적**: 룰 실행 중 사용자 수동 토글 시 pin / 룰 의도와 일치하는 토글에서 release.

**스텝**:
```bash
DEV="feb3027c-8075-46fb-85cc-61d2d88b39ad"

# A. 룰 active 시뮬레이션
PGPASSWORD=smartfarm123 psql -h localhost -p 5432 -U smartfarm -d smartfarm_mqtt -c \
  "UPDATE devices SET device_settings = device_settings || '{\"ruleIntendedState\":true,\"userOverride\":false,\"switchState\":true}'::jsonb WHERE id='$DEV';"

# B. 사용자 OFF (rule 의도와 다름) → userOverride=true 예상
curl -X POST http://localhost:3100/api/devices/$DEV/control \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"commands":[{"code":"state","value":false}]}'

# 확인
PGPASSWORD=smartfarm123 psql -h localhost -p 5432 -U smartfarm -d smartfarm_mqtt -c \
  "SELECT device_settings->>'switchState' AS sw, device_settings->>'ruleIntendedState' AS intent, device_settings->>'userOverride' AS ovr FROM devices WHERE id='$DEV';"

# C. 사용자 ON (rule 의도와 일치) → userOverride=false 예상 (release)
curl -X POST http://localhost:3100/api/devices/$DEV/control \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"commands":[{"code":"state","value":true}]}'

# 확인
PGPASSWORD=smartfarm123 psql -h localhost -p 5432 -U smartfarm -d smartfarm_mqtt -c \
  "SELECT device_settings->>'switchState' AS sw, device_settings->>'ruleIntendedState' AS intent, device_settings->>'userOverride' AS ovr FROM devices WHERE id='$DEV';"
```

**합격 조건**:
- 시뮬 A: `sw=true, intent=true, ovr=false`
- B 사용자 OFF → `sw=false, intent=true, ovr=true` (pin)
- C 사용자 ON (intent 일치) → `sw=true, intent=true, ovr=false` (release)

**최근 결과**: ✅ PASS — pin/release 정확히 동작

**정리**:
```bash
PGPASSWORD=smartfarm123 psql -h localhost -p 5432 -U smartfarm -d smartfarm_mqtt -c \
  "UPDATE devices SET device_settings = device_settings - 'userOverride' - 'ruleIntendedState' WHERE id='$DEV';"
curl -X POST http://localhost:3100/api/devices/$DEV/control \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"commands":[{"code":"state","value":false}]}'
```

---

## TC-09 : 룰 활성화 시 원격제어 자동 ON (§5.3)

**목적**: 관수 룰 enable 시 `?autoEnableRemote=true` 쿼리로 원격제어 + B접점 자동 ON.

⚠️ **주의**: `autoEnableRemote`는 **query parameter** 이며 **body 아님**. body에 넣으면 무시됨 — `remoteControlEnabled: false` 반환.

**스텝**:
```bash
RULE_ID="8368c458-ff09-44cf-90b2-48cb553363cd"  # disabled 관수 룰

# disable 확정
PGPASSWORD=smartfarm123 psql -h localhost -p 5432 -U smartfarm -d smartfarm_mqtt -c \
  "UPDATE automation_rules SET enabled=false WHERE id='$RULE_ID';"

mosquitto_sub -h localhost -p 1883 -t 'farm/+/z2m/+/set' -t 'farm/+/gpio/relay' -v > /tmp/auto-on.log 2>&1 &
sleep 0.5

# Query string로 autoEnableRemote=true
curl -X PATCH "http://localhost:3100/api/automation/rules/$RULE_ID/toggle?autoEnableRemote=true" \
  -H "Authorization: Bearer $TOKEN" \
  | jq '{enabled, remoteControlEnabled}'

sleep 1.5; kill %1
cat /tmp/auto-on.log
```

**합격 조건**:
- 응답: `enabled: true, remoteControlEnabled: true`
- MQTT: switch_6 (b_contact) + state/switch_1 (remote_control) 발행

**최근 결과**: ✅ PASS — 응답 `enabled:true, remoteControlEnabled:true` + MQTT 2건 발행

**정리**:
```bash
# 룰 disable + 원격제어 OFF
PGPASSWORD=smartfarm123 psql -h localhost -p 5432 -U smartfarm -d smartfarm_mqtt -c \
  "UPDATE automation_rules SET enabled=false WHERE id='$RULE_ID';"
curl -X POST http://localhost:3100/api/devices/63700271-a8bf-4dd9-b476-ff2d44b5edc9/control \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"commands":[{"code":"switch_1","value":false}]}'
```

---

## TC-10 : Device Replacement (Hot Swap) Preview

**목적**: 교체 전 보존될 룰/매핑/페어/children 카운트 + 호환 조건 반환.

**스텝**:
```bash
DEV="63700271-a8bf-4dd9-b476-ff2d44b5edc9"  # HK_지그비릴레이 (8CH)
curl -s "http://localhost:3100/api/devices/$DEV/replace-preview" \
  -H "Authorization: Bearer $TOKEN" | jq
```

**합격 조건**:
- 응답에 `device`, `impact`, `compatibility` 3개 객체
- `impact.rulesCount` ≥ 1 (관련 룰 카운트)
- `impact.mappingKeys` = 8 (8채널 매핑)
- `compatibility.requireChannelCount` = 8
- `compatibility.requireModel` = `"TS0601_switch_8"`

**최근 결과** (이전 세션): ✅ PASS

---

## 일괄 실행 스크립트

```bash
#!/bin/bash
# /Users/ohjeongseok/Projects/smart-farm-mqtt/scripts/run-regression.sh
# 모든 TC를 순차 실행. 실패 시 즉시 중단.
set -e
cd "$(dirname "$0")/.."

TOKEN=$(curl -s -X POST http://localhost:3100/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"mtest","password":"admin123"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['accessToken'])")
[ -z "$TOKEN" ] && echo "ERR: 로그인 실패" && exit 1

# ... 각 TC를 함수로 정의해 호출 (생략)
echo "✅ 10개 TC 모두 PASS"
```

---

## 정리 체크리스트 (수동 검증 시)

매 회귀 테스트 마지막에 확인:
- [ ] 모든 actuator OFF 상태 (사용자가 ON으로 둔 device 없음)
- [ ] mtest의 룰 enabled 상태가 테스트 시작 전과 동일
- [ ] device의 `device_settings.userOverride / ruleIntendedState` 키가 잘못 남아있지 않음
- [ ] `lastCommandAt` 타임스탬프가 정상

---

## 변경 이력

| 일자 | 변경 | 사유 |
|---|---|---|
| 2026-06-04 | 최초 작성 (TC-01~10) | 디자인 수정 다수 후 회귀 검증 필요 |
