# 검증 중 발견된 버그 (rpi-golden-image-mass-production Do 단계)

## BUG-01: apply-gateway-id.sh가 fallback-engine.env GATEWAY_ID 미갱신

**파일**: [raspberry-pi/scripts/apply-gateway-id.sh:55-63](../../raspberry-pi/scripts/apply-gateway-id.sh#L55-L63)

**현상**: gateway-id 변경 시 `/etc/smartfarm/config-agent.env`, `gpio-agent.env`는 갱신하지만 `fallback-engine.env`는 누락. fallback-engine 서비스가 옛 GATEWAY_ID로 계속 동작하여 MQTT topic mismatch.

**증거**: 단계 D 검증 중
```
/etc/smartfarm/gateway-id            → lgw-default-e7874755  (갱신됨)
/etc/smartfarm/gpio-agent.env        → GATEWAY_ID=lgw-default-e7874755 ✓
/etc/smartfarm/config-agent.env      → (변경 대상에 포함됨)
/etc/smartfarm/fallback-engine.env   → GATEWAY_ID=lgw-default   ✗ (미갱신)
```

**Fix 제안**: line 55의 envfile 루프에 fallback-engine.env 추가.

```bash
for envf in /etc/smartfarm/config-agent.env /etc/smartfarm/gpio-agent.env /etc/smartfarm/fallback-engine.env; do
```

## BUG-02: first-boot-init 자동 register 후 apply-gateway-id의 --no-block restart가 환경변수 reload 보장 못 함

**파일**: [raspberry-pi/scripts/first-boot-init.sh:84-86](../../raspberry-pi/scripts/first-boot-init.sh#L84-L86) + [apply-gateway-id.sh:67-70](../../raspberry-pi/scripts/apply-gateway-id.sh#L67-L70)

**현상**: first-boot-init이 register-tunnel-key 응답으로 새 gateway-id를 받아 apply-gateway-id.sh 호출 → `systemctl restart --no-block`이 큐만 잡고 즉시 리턴 → first-boot-init exit → 시스템이 후속 처리 시 config-agent가 **이전 환경변수**로 그대로 실행되는 케이스 관측됨.

**증거**:
```
journalctl -u config-agent → "MQTT Broker 연결 성공 (게이트웨이: lgw-default)"
   (실제 systemd unit Environment은 lgw-default-e7874755로 변경됨)
```

수동 `systemctl restart config-agent` 후 정상 갱신:
```
"MQTT Broker 연결 성공 (게이트웨이: lgw-default-e7874755)"
"구독: farm/lgw-default-e7874755/config/request"
```

**Fix 제안 옵션**:
- (A) apply-gateway-id.sh를 first-boot-init에서 호출 시에는 `--no-block` 대신 `try-restart` + 명시적 검증
- (B) first-boot-init.sh 마지막에 `systemctl restart config-agent gpio-agent fallback-engine` (이미 oneshot 종료 직전이므로 안전)
- (C) (recommended) apply-gateway-id.sh가 변경 후 `systemctl reset-failed` + `systemctl restart` 동기 호출하되 30초 timeout으로 안전장치

## BUG-03: gateway-id 배포 시 DB의 gateways.gateway_id 미갱신

**파일**: 의심 — `backend/src/modules/config-deploy/config-deploy.service.ts` (gateway-id 응답 핸들러)

**현상**: PI에 gateway-id를 배포하면 PI 측 파일/환경변수는 정상 갱신되고 MQTT 토픽도 새 GATEWAY_ID로 publish하지만, 서버 DB의 `gateways.gateway_id` 칼럼은 여전히 옛 값으로 유지.

**증거**: 단계 E-2 검증
```
배포 후 PI: /etc/smartfarm/gateway-id = lgw-pilot01
         config-agent 구독 topic = farm/lgw-pilot01/config/request
DB:        gateways.gateway_id = lgw-default-e7874755 (미갱신)
         gateways.hostname    = lgw-pilot01 (E-1 hostname 배포에서 정상 갱신됨)
```

**영향**: 백엔드가 lgw-default-e7874755 키로 게이트웨이 row를 찾으려 하므로 신규 토픽 `farm/lgw-pilot01/*`의 메시지가 게이트웨이와 매칭 안 될 수 있음. 다만 backend의 `MqttBridgeHandler`가 토픽에서 gatewayId를 추출 → 단순 문자열 매칭이므로 DB row 검색 시 미스매치.

**Fix 제안**: gateway-id 응답을 받는 핸들러에서 `UPDATE gateways SET gateway_id = :new WHERE machine_id = :mid` 추가. machine_id가 안정적 PK 역할.

**정정 (E-2 검증 후속)**: 실제로 backend가 cascade UPDATE를 시도했으나 schema mismatch로 실패함:
```
query failed: UPDATE gateway_onboard_devices SET gateway_id = $1 WHERE gateway_id = $2
PARAMETERS: ["lgw-pilot01","lgw-default-e7874755"]
error: invalid input syntax for type uuid: "lgw-pilot01"
```

→ `gateway_onboard_devices.gateway_id` 컬럼이 UUID 타입으로 잘못 정의됨. 이건 `rpi-emergency-failover` 사이클에서 비슷한 schema mismatch가 발견되어 마이그레이션 020에서 일부 컬럼 UUID→VARCHAR 변환했었는데, **gateway_onboard_devices는 누락**된 듯.

**최종 Fix**:
1. 마이그레이션 추가: `ALTER TABLE gateway_onboard_devices ALTER COLUMN gateway_id TYPE VARCHAR(50) USING gateway_id::TEXT;`
2. cascade UPDATE 시 트랜잭션 명시 + 부분 실패 처리 (warn으로 끝나지 않고 main UPDATE rollback)

## BUG-04: 백엔드 자동화 룰 룬 30초 트리거 + activity_logs PK 충돌 → process abort (이전 세션 발견)

**증거**: backend-restart.log 9:38 PM에 다음 메시지 후 종료:
```
error: duplicate key value violates unique constraint "PK_d153bd1f972e9997ea908097a1d"
Node.js v22.22.1   ← process abort
```

**원인 추측**: `고온시 개폐기 자동 개방` 룰이 30초마다 트리거되며 activity_logs INSERT 시 PK 충돌 (UUID 충돌 가능성 낮음 → application code의 id 생성 로직 또는 cascade insert 문제).

**영향**: backend 자체 죽음 → PI register-tunnel-key 실패 (검증 시 발견됨, 수동 복구).

**우선순위**: HIGH — 운영 중 backend abort는 모든 게이트웨이 영향.

## BUG-05: UpdateWifiDto.password MaxLength=63이라 NetworkManager hex PMK(64자) 거부

**파일**: [backend/src/modules/config-deploy/dto/update-wifi.dto.ts:14](../../backend/src/modules/config-deploy/dto/update-wifi.dto.ts#L14)

**현상**: WPA2-PSK는 표준상 (a) 8~63자 ASCII passphrase 또는 (b) 64자 hex PMK 둘 다 허용. 그러나 DTO는 `@MaxLength(63)` 하나만 — 64자 PMK 거부.

**증거**: 단계 E-3 검증
```
nmcli con show wifi-hq psk → 64자 hex
POST /api/config-deploy/.../wifi { password: <64자 hex> } → HTTP 400
"password must be shorter than or equal to 63 characters"
```

**Fix**: `@MaxLength(63)` → `@MaxLength(64)` + 64자일 때 `@Matches(/^[0-9a-fA-F]{64}$/)` 강제(권장). 단순히 MaxLength만 64로 늘려도 동작은 함.

**임시 조치**: DTO를 MaxLength(64)로 수정 후 backend 재시작 → E-3 재시도.

## BUG-06: 신규 게이트웨이에 devices 자동 등록 안 됨

**현상**: lgw-pilot01 등록 후 `gateway_onboard_devices`는 lazy seed로 12개 생성되지만, `devices` 테이블은 0건. 자동화 룰이 device를 reference하므로 룰 등록 불가.

**원인 추측**: onboard slot → devices INSERT는 사용자가 UI에서 명시적으로 "장치로 등록" 액션을 해야 하는 구조일 가능성. 양산 시나리오에서는 자동화 필요.

**Fix 제안**: 신규 게이트웨이 등록 + onboard 시드 후 자동으로 표준 devices INSERT (slot → device 1:1 매핑) + channelMapping 자동 설정.

## BUG-07: ~~신규 게이트웨이에 fallback-config 자동 시드 안 됨~~ (정정 — 정상 동작)

**정정**: 운영 중인 lgw-dev도 `/api/fallback-config/lgw-dev` GET 404 동일 반환. 즉 `fallback_configs` row는 사용자가 명시적 설정한 경우에만 존재하고, 없으면 PI 측 fallback-engine.js의 DEFAULT 상수가 사용됨. **BUG가 아닌 design**.

**다만 UX 개선 권장**: ConfigDeploy 페이지에서 사용자가 정책을 확인하고 싶을 때 row가 없으면 "기본 정책 사용 중" + "사용자 정의" 버튼 제공. 또는 `/mode` endpoint는 동작하므로 정상 운영에는 영향 없음.

## BUG-08: fallback-engine이 MQTT 단절 시 GPIO 직접 제어 불가 (설계 미흡)

**현상**: 단계 H 검증 결과, MQTT broker 단절 시 fallback-engine은 모드 전환 + safety_off 이벤트는 publish 시도하지만 **MQTT 미연결 → drop**. relay-bridge가 `gpio-agent`에 MQTT publish 방식으로 제어 명령 보내는 구조라 외부 broker 끊김 시 PI 내부 GPIO에도 명령 전달 불가.

**로그**:
```
22:07:46 [FALLBACK] 모드 전환: fallback
22:07:46 [RELAY-BRIDGE] MQTT 미연결 — zone_1=OFF drop
22:07:46 [RELAY-BRIDGE] MQTT 미연결 — zone_2=OFF drop
... (모든 채널 drop)
```

**영향**: 단절 시 실제 안전 동작(channel OFF)이 실행 안 됨. fallback 모드 추적은 되지만 **물리적 차단은 미동작**.

**Fix 제안**:
1. PI 측 로컬 mosquitto broker 추가 (CLAUDE.md에 `mosquitto`는 옵션으로 표기되어 있음 → 골든 이미지에 강제 포함 + 외부 단절 시 로컬로 자동 fallback)
2. 또는 fallback-engine이 gpio-agent에 직접 IPC (HTTP/Unix socket) 방식으로 우회 채널 마련

**우선순위**: HIGH — 페일오버의 핵심 목적이 단절 시 자율 동작인데 현재는 단순 상태 추적만 가능.

## BUG-09: gateway-id 변경 시 fallback_gateway_status 옛 row 정리 누락

**현상**: gateway-id 배포로 `lgw-default` → `lgw-default-e7874755` → `lgw-pilot01` 변경 후 `fallback_gateway_status` 테이블에 3개 row 모두 잔존.

**증거**:
```
gateway_id            | mode     | last_heartbeat_seen_at
----------------------+----------+-------------------------
lgw-default-e7874755  | online   | 2026-05-22 22:09:00
lgw-default           | fallback | 2026-05-22 22:09:00 (이전 사이클 잔존)
lgw-pilot01           | online   | 2026-05-22 22:09:41
```

**Fix**: ConfigDeployService.gateway-id 응답 핸들러의 cascade 처리에 `fallback_gateway_status.gateway_id` UPDATE 또는 옛 row DELETE 추가.


