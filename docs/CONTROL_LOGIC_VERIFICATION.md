# Control Logic Verification — 2026-06-04

> mtest 계정(`farm_admin`)으로 [TEST_SCENARIOS.md](./TEST_SCENARIOS.md) 10건 회귀 검증한 결과 + [DEVICE_CONTROL_LOGIC.md](./DEVICE_CONTROL_LOGIC.md)와의 불일치 정리.
>
> 모든 ✅ 항목은 실제 동작 = 문서. **사용자 판단 필요 항목**은 ⚠️로 표시. 사용자가 "코드 수정"인지 "문서 수정"인지 결정해 주세요.

---

## 1. 검증 요약

| TC | 영역 | 결과 |
|---|---|---|
| TC-01 | 장치 분류 무결성 (§1) | ✅ PASS |
| TC-02 | 단일 라우팅 3 path (§1.1) | ✅ PASS |
| TC-03 | 개폐기 인터록 (§3.2) — 1초 대기 | ✅ PASS (1005ms 측정) |
| TC-04 | 개폐기 페어 삭제 차단 (§3.5) | ✅ PASS |
| TC-05 | 관수 원격제어 ON/OFF 연동 (§5.2) | ✅ PASS |
| TC-06 | 자동제어룰 CRUD (§6) | ✅ PASS |
| TC-07 | 액비 시간 백엔드 차단 (§5.6) | ✅ PASS |
| TC-08 | 수동 pin/release 정책 (§8 보강) | ✅ PASS |
| TC-09 | autoEnableRemote 룰 토글 (§5.3) | ✅ PASS |
| TC-10 | Device Replacement Preview | ✅ PASS (이전 세션) |

**전체 결과: 10/10 PASS** — 디자인 수정이 동작 로직에 영향 없음을 확인.

---

## 2. 문서 ↔ 실제 동작 불일치 (⚠️ 사용자 판단 필요)

아래 항목들은 동작은 **정상이지만 문서가 누락/암묵적**이라 외부 사용자가 헷갈릴 수 있습니다.
**판단**: 문서를 보강할지, 코드를 사용자 친화적으로 바꿀지 결정해 주세요.

---

### 🔹 D-01 : `ruleType`은 서버가 자동 결정 — 문서 미언급

**현재 동작**: `CreateRuleDto`에는 `ruleType` 필드가 없습니다 ([create-rule.dto.ts](../backend/src/modules/automation/dto/create-rule.dto.ts)). 클라이언트가 `ruleType`을 보내면 **400 Bad Request** (`property ruleType should not exist`).

서버가 `determineRuleType(conditions)`로 자동 결정 ([automation.service.ts:45](../backend/src/modules/automation/automation.service.ts#L45)):
- `conditions.type === 'irrigation'` → `weather` (관수 룰)
- 시간 조건만 → `time`
- 센서 + 시간 혼합 → `hybrid`
- 날씨 → `weather`

**문서 상태**: §6에 명시 없음. 사용자가 클라이언트를 직접 작성할 때 혼란.

**제안**:
- 옵션 A (문서 수정 권장): §6에 "`ruleType`은 서버가 conditions에서 자동 도출" 1문장 추가
- 옵션 B (코드 수정): DTO에 `@IsOptional() @IsString() ruleType?: string` 추가하고 무시 (그대로 server가 덮어씀)

→ **추천: A** (코드 변경 최소화, 의도가 명확)

---

### 🔹 D-02 : 관수 control API의 `code`가 매핑된 switchCode인지 논리 키인지 모호

**현재 동작**: `POST /devices/:id/control`에 `commands: [{code, value}]` 보낼 때 — 관수 device는 `code`가 **매핑된 switchCode**(예: `relay_remote_control`, `switch_1`) 여야 합니다. 논리 키(`remote_control`)를 보내면 §5.2의 자동 연동 로직(`bContact` 자동 ON)이 **silently 실행 안 됨** ([devices.service.ts:637-638](../backend/src/modules/devices/devices.service.ts#L637-L638)).

```ts
const remoteSwitch = mapping['remote_control']; // = "relay_remote_control" or "switch_1"
const remoteCmd = commands.find(c => c.code === remoteSwitch);
```

**문서 상태**: §5.2는 "원격제어 ON 시 fertilizer_b_contact 자동 동시 ON" 만 기술. `code` 값의 명세 없음.

UI는 `getMapping(device)['remote_control']`로 자동 변환하므로 실사용에 영향 없음. **API 직접 호출/E2E 테스트 시 함정**.

**제안**:
- 옵션 A (문서 수정): §5.2에 "`code` 값은 매핑된 switchCode여야 함. UI는 자동 변환" 명시
- 옵션 B (코드 수정): 논리 키도 인식하도록 `commands` 정규화 (mapping 역방향 lookup)

→ **추천: A** (UI는 이미 잘 동작, API 사용자에게 명확히 안내)

---

### 🔹 D-03 : `autoEnableRemote`는 **query parameter** (body 아님) — 문서 표기 불명확

**현재 동작**: `PATCH /automation/rules/:id/toggle?autoEnableRemote=true` 로 호출 ([automation.controller.ts:71-78](../backend/src/modules/automation/automation.controller.ts#L71-L78)):

```ts
@Patch('rules/:id/toggle')
async toggleRule(
  @Param('id') id: string,
  @CurrentUser() user: any,
  @Query('autoEnableRemote') autoEnableRemote?: string,  // ← Query
)
```

Body에 `{"autoEnableRemote":true}` 넣으면 무시되고 → `remoteControlEnabled: false` 반환 (자동 ON 동작 안 함).

**문서 상태**: §5.3은 `PATCH /automation/rules/{id}/toggle?autoEnableRemote=true` 로 query 표기 — **이미 올바름**. 하지만 위 형식이 본문 예시에 없어 e2e 테스트 작성 시 자주 실수.

**제안**:
- 옵션 A (문서 보강): §5.3에 ⚠️ 박스로 "body가 아닌 query 사용 — 흔한 실수" 강조
- 옵션 B (코드 수정): body도 받을 수 있도록 `@Body() body?: { autoEnableRemote?: boolean }` 추가, query OR body로 OR 처리

→ **추천: A** (REST convention은 query가 적절, 문서로 안내)

---

### 🔹 D-04 : 수동 pin/release 정책은 문서에 **없음** (신규 정책)

**현재 동작**: `device.deviceSettings.ruleIntendedState`와 `userOverride` 필드로 룰 vs 수동 충돌 해결 ([devices.service.ts:516-548](../backend/src/modules/devices/devices.service.ts#L516-L548)):

| 상태 | 사용자 토글 | 변화 |
|---|---|---|
| `intent != null`, `ovr=false`, `newValue != intent` | OFF | `ovr=true` (pin) |
| `ovr=true`, `newValue == intent` | ON | `ovr=false` (release) + EventEmitter → lastState 클리어 |

룰 disable→enable 시 `onRuleToggled()`가 lastState + override + intent 모두 리셋 ([automation-runner.service.ts:120-165](../backend/src/modules/automation/automation-runner.service.ts#L120)).

**문서 상태**: §8은 `markUserOverrideIfRaining` (개폐기 우적 우회만) 만 언급. 일반 pin/release는 **누락**.

**제안**:
- 옵션 A (문서 추가 권장): §8을 확장하여 "**수동 우회 일반 정책**" 절 추가:
  - `ruleIntendedState` / `userOverride` 필드 명세
  - pin/release 결정 알고리즘
  - 룰 toggle 시 리셋 동작
- 옵션 B: 별도 §10 "수동 vs 자동제어 충돌 해결" 신설

→ **추천: A** (§8과 결이 같음 — "사용자/자동화 컨텍스트 구분" 의 자연스러운 확장)

---

### 🔹 D-05 : 컨트롤러(parent/child) 다채널 zigbee — 문서에 분류 없음

**현재 동작**: 8/12채널 zigbee 컨트롤러를 `equipment_type='controller'` (parent) + N개 `fan`/`opener_*` (children, `parent_device_id` FK) 구조로 관리 ([gateway-env.service.ts](../backend/src/modules/gateway-env/gateway-env.service.ts)).
- parent는 자동제어 타겟 아님
- children은 자동제어 가능
- 모든 children이 parent와 동일 IEEE 공유

**문서 상태**: §1 테이블에 `controller` equipment_type 누락. §5(관수)에만 다채널 언급, fan/opener 컨트롤러는 미언급.

**제안**:
- 옵션 A (문서 추가 권장): §1 테이블에 `controller` 행 추가 + §5 다음에 §5b "다채널 zigbee 컨트롤러 (parent/child)" 절 신설
- migration 022 (parent_device_id, channel_code) 도 함께 언급

→ **추천: A** (이미 동작 중인 기능 — 문서만 따라잡기)

---

### 🔹 D-06 : Device Replacement (Hot Swap) — 문서에 절 없음

**현재 동작**: `POST /devices/:id/replace`로 IEEE swap. devices.id 유지로 룰/매핑/페어 자동 보존 ([devices.service.ts:1059+](../backend/src/modules/devices/devices.service.ts#L1059)).
- 호환성: 같은 base family + 채널수 ≥ 옛 device
- 페어 개폐기: 양쪽 동시 swap
- Controller: parent + children 일체 IEEE swap
- WebSocket: `device:replaced` broadcast

**문서 상태**: 별도 design doc ([device-replacement.design.md](./02-design/features/device-replacement.design.md))에 자세히 정의되어 있으나, DEVICE_CONTROL_LOGIC.md에는 미언급.

**제안**:
- 옵션 A (문서 추가): DEVICE_CONTROL_LOGIC §10 "Device Replacement (Hot Swap)" 추가 — 요약 + design.md 링크
- 옵션 B: 그대로 두기 (design.md만 참조)

→ **추천: A** (개폐기 페어/매핑/룰을 다루는 단일 진실 source 유지)

---

### 🔹 D-07 : 우적센서 `rainOverrideDisabled` 토글 — 문서에 누락

**현재 동작**: 우적센서 device에 `deviceSettings.rainOverrideDisabled=true` 설정 시 비 감지 이벤트 무시 (오탐 방지) ([rain-override.service.ts:50](../backend/src/modules/rain-override/rain-override.service.ts#L50)).

API: `PATCH /devices/:id/rain-override-disabled body={disabled:true}`

**문서 상태**: §3.4 "우적 우회" 는 ACTIVE인 경우 동작만 기술. **비활성화 가능 여부 언급 없음**.

**제안**:
- 옵션 A (문서 추가): §3.4 끝에 "**오탐 방지 — 우적센서별 비활성화 토글**" 단락 추가 (옆집 스프링쿨러 오탐 사례 등)

→ **추천: A**

---

## 3. 추가 동작 검증 (문서와 일치, 참고용)

### 🟢 §1.1 단일 라우팅 — MQTT 실측

```
onboard fan       → farm/hk-house/gpio/relay     {"slot":"fan_1","pin":17,"state":true,"requestId":...}
zigbee single fan → farm/hk-house/z2m/{ieee}/set {"state":"ON"}
zigbee TS0601 8CH → farm/hk-house/z2m/{ieee}/set {"state_l2":"ON"} ← switch_2 자동 변환
```

### 🟢 §3.2 인터록 — 1초 대기 정확도

측정값: `1005ms` (close OFF → open ON 사이) — DEVICE_CONTROL_LOGIC §3.2의 `1000ms` 와 일치 (±5ms 자연 jitter).

### 🟢 §5.2 원격제어 OFF — 5개 스위치 일괄 OFF

매핑된 모든 스위치 동시 OFF 확인:
```
mixer, zone_1, remote_control, fertilizer_motor, fertilizer_contact (5건)
```

### 🟢 §5.6 액비 시간 검증 — 백엔드 에러 메시지

400 응답 메시지에 위반 항목 명시:
```
"관주시간이 액비 투여시간+종료전대기보다 짧습니다: 1구역: 관주시간(5분) < 투여시간(5분)+종료전대기(2분)=7분"
```

### 🟢 §8 + 신규 pin/release — DB 상태 추적

```
초기:    sw=true,  intent=true,  ovr=false
OFF:     sw=false, intent=true,  ovr=true    ← pin
ON 복귀: sw=true,  intent=true,  ovr=false   ← release (+ lastState 클리어 emit)
```

---

## 4. 사용자 결정 요청

다음 7건에 대해 어떻게 처리할지 알려주세요:

| 항목 | 추천 |
|---|---|
| D-01 ruleType 서버 자동 결정 | 문서 1문장 추가 |
| D-02 관수 control code 명세 | 문서 ⚠️ 박스 추가 |
| D-03 autoEnableRemote query 강조 | 문서 ⚠️ 박스 추가 |
| D-04 수동 pin/release 정책 추가 | 문서 §8 확장 |
| D-05 Controller (parent/child) 분류 | 문서 §1 + §5b 추가 |
| D-06 Device Replacement 절 추가 | 문서 §10 추가 (요약 + design.md 링크) |
| D-07 우적센서 비활성화 토글 | 문서 §3.4 보강 |

**일괄 "문서 수정"** 또는 **항목별 "코드 수정"** 으로 결정해 주시면 즉시 반영하겠습니다.

---

## 5. 다음 회귀 검증

언제 실행:
- 디자인 수정 후
- 백엔드 자동화/devices 모듈 수정 후
- 신규 device 타입 추가 후
- 룰 평가 로직 변경 후

방법:
```bash
# 문서 [TEST_SCENARIOS.md](./TEST_SCENARIOS.md) 의 TC-01 ~ TC-10 순차 실행
# 모든 TC PASS 시: 디자인/리팩토링 변경이 동작에 영향 없음을 보장
```
