# Design: rpi-hostname-gateway-id-unify

**Feature ID**: `rpi-hostname-gateway-id-unify`
**작성일**: 2026-05-23
**기반 문서**: [01-plan/features/rpi-hostname-gateway-id-unify.plan.md](../../01-plan/features/rpi-hostname-gateway-id-unify.plan.md)
**상태**: Design

---

## 1. 아키텍처 결정 (ADR)

### 옵션 A vs B vs C

| 옵션 | 설명 | 장점 | 단점 |
|---|---|---|---|
| **A. 신규 통합 endpoint** | `POST /api/config-deploy/:gw/identity` 추가, 분리 endpoint는 유지(deprecated) | 명시적, 하위 호환 | 새 명령/스크립트 필요 |
| B. hostname endpoint에 cascade 옵션 | `POST /api/.../hostname` body `{hostname, cascadeGatewayId?}` | 기존 API 활용 | hostname 의미가 부풀음(side-effect) |
| C. backend 측 자동 cascade (default ON) | hostname 배포하면 무조건 gateway-id도 자동 | 사용자 액션 1회 | 의도하지 않은 변경 발생 가능 |

### 결정: **A + C 결합** (최종)

- **신규 endpoint `POST /api/config-deploy/:gw/identity`** body `{name}` 추가 — 가장 명확한 의미
- **기존 hostname endpoint**는 default cascade ON (서버 옵션으로 차단 가능)
- 프론트엔드는 신규 endpoint만 사용
- 기존 분리 호출도 동작 — 다만 hostname 변경 시 자동으로 gateway-id도 cascade (의도된 통합 정책)

근거: 1번 클릭으로 의도된 결과 + 명시적 API 제공 + 하위 호환

---

## 2. API 설계

### 2.1 신규 endpoint

```
POST /api/config-deploy/:gatewayId/identity
Authorization: Bearer <token>
Content-Type: application/json

Body: {
  "name": "lgw-pilot01"
}

Response 202 Accepted:
{
  "requestId": "uuid",
  "action": "identity_update",
  "status": "pending",
  "publishedAt": "ISO8601"
}
```

### 2.2 DTO

`backend/src/modules/config-deploy/dto/update-identity.dto.ts`:
```typescript
import { IsString, MinLength, MaxLength, Matches } from 'class-validator';

export class UpdateIdentityDto {
  /** RFC 1123 hostname + gateway-id 통합. 둘이 항상 같은 값이라는 전제. */
  @IsString()
  @MinLength(1)
  @MaxLength(63)
  @Matches(/^[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/, {
    message: 'name은 소문자/숫자/하이픈으로 구성하며 소문자로 시작하고 영숫자로 끝나야 합니다 (RFC 1123, 1~63자)',
  })
  name!: string;
}
```

(RFC 1123 hostname 정규식이 gateway-id 정규식보다 좁음 — 통합 정규식은 더 좁은 hostname 기준 사용)

### 2.3 Cascade 정책

`config-deploy.service.ts`:
1. `name` 받으면 `applyIdentity(gatewayId, name)` 호출
2. PI에 `identity_update` MQTT 명령 publish — `farm/{gatewayId}/config/request` topic
3. PI가 hostname + gateway-id 통합 처리 (apply-identity.sh)
4. 응답 받으면 cascade DB UPDATE (gateways.hostname, gateways.gateway_id, devices.gateway_id, fallback_* 모두)

### 2.4 기존 endpoint 자동 cascade

`POST /api/config-deploy/:gw/hostname`에 query `?cascadeGatewayId=true` (default true) 추가.
PI 측에서도 hostname_update 처리 후 자동으로 apply-gateway-id 호출.

기존 호출자(없을 가능성 높지만)에 변화 없음. cascade가 의도된 동작.

---

## 3. PI 측 설계

### 3.1 신규 스크립트 `apply-identity.sh`

```bash
#!/usr/bin/env bash
# apply-identity.sh — hostname + gateway-id 통합 변경 (atomic)
#
# 사용법: apply-identity.sh <name>
#
# 동작:
#   1. apply-hostname.sh <name> (재시작 안 함)
#   2. apply-gateway-id.sh <name> (재시작 포함)
#   3. 단일 응답 emit
set -u
NAME="$1"
RESULT=$(bash /opt/smart-farm/scripts/apply-hostname.sh "$NAME" 2>&1)
HOSTNAME_OK=$?
RESULT2=$(bash /opt/smart-farm/scripts/apply-gateway-id.sh "$NAME" 2>&1)
GW_OK=$?
if [ "$HOSTNAME_OK" = "0" ] && [ "$GW_OK" = "0" ]; then
  printf '{"ok":true,"status":"success","detail":"identity unified to %s","serviceRestarted":true}\n' "$NAME"
else
  printf '{"ok":false,"status":"partial","detail":"hostname=%d gateway-id=%d","name":"%s"}\n' "$HOSTNAME_OK" "$GW_OK" "$NAME"
fi
```

### 3.2 config-agent handler 추가

`raspberry-pi/config-agent/handlers/identity.js`:
```javascript
const { execScript } = require('./exec-script');
module.exports = async function handleIdentity(payload) {
  const { name } = payload;
  if (!name) return { ok: false, detail: 'name required' };
  return execScript('apply-identity.sh', [name]);
};
```

config-agent index.js에서 `identity_update` action을 위 핸들러로 매핑.

### 3.3 하위 호환

기존 apply-hostname.sh, apply-gateway-id.sh는 그대로 유지 — 단독 사용 가능.

---

## 4. 백엔드 cascade 통합

기존 `applyDbChanges()` 안에 `identity_update` 분기 추가:

```typescript
if (pending.action === 'identity_update' && pending.name) {
  const newName = pending.name;
  await this.gatewayRepo.manager.transaction(async (mgr) => {
    const gw = await mgr.findOne(Gateway, { where: { gatewayId } });
    if (!gw) return;
    await mgr.update(Gateway, { id: gw.id }, {
      gatewayId: newName,
      hostname: newName,                  // hostname 컬럼이 있다면 동시 갱신
      lastConfigAppliedAt: new Date(),
    });
    await mgr.query(`UPDATE devices SET gateway_id = $1 WHERE gateway_id = $2`, [newName, gatewayId])
      .catch(e => this.logger.warn(`devices cascade: ${e.message}`));
    for (const tbl of ['fallback_configs','fallback_gateway_status','fallback_opener_schedule','fallback_events']) {
      await mgr.query(`UPDATE ${tbl} SET gateway_id = $1 WHERE gateway_id = $2`, [newName, gatewayId])
        .catch(e => this.logger.warn(`${tbl} cascade: ${e.message}`));
    }
  });
  this.logger.log(`identity cascade 완료: ${gatewayId} -> ${newName}`);
}
```

---

## 5. 프론트엔드 설계

### 5.1 ConfigDeploy.vue 카드 통합

기존 2개 카드(`HostnameCard`, `GatewayIdCard`) → 1개 카드 `IdentityCard`:

```vue
<template>
  <Card>
    <h3>게이트웨이 이름</h3>
    <p>현재: {{ gateway.gatewayId }} (= hostname)</p>
    <input v-model="newName" placeholder="예: lgw-farm01" />
    <Button @click="deploy">배포</Button>
  </Card>
</template>

<script setup>
async function deploy() {
  await configDeployApi.deployIdentity(gateway.gatewayId, newName.value)
  toast.success(`이름 변경 요청 전송 (${newName.value})`)
}
</script>
```

### 5.2 API 클라이언트

`frontend/src/api/config-deploy.api.ts`:
```typescript
deployIdentity: (gatewayId: string, name: string) =>
  apiClient.post(`/config-deploy/${gatewayId}/identity`, { name })
```

---

## 6. 데이터 모델 변경

**변경 없음**. `gateways` 테이블의 `hostname` 컬럼이 이미 존재 (이전 검증 시 확인됨).

다만 invariant 추가: `hostname === gateway_id` (코드 레벨에서 강제, DB 제약 미추가 — 향후 옵션).

---

## 7. 검증 시나리오

### AT-01: 신규 endpoint 배포
```bash
TOKEN=$(cat /tmp/.sf-token)
curl -X POST http://localhost:3100/api/config-deploy/lgw-pilot01/identity \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name": "lgw-test01"}'
# Expected: HTTP 202, requestId 발급
# 12~22초 후 PI hostname=lgw-test01, gateway-id=lgw-test01, Z2M base_topic=farm/lgw-test01/z2m
```

### AT-02: 기존 hostname endpoint cascade
```bash
curl -X POST http://localhost:3100/api/config-deploy/lgw-test01/hostname \
  -d '{"hostname": "lgw-pilot01"}'  # default cascadeGatewayId=true
# Expected: hostname + gateway-id 모두 lgw-pilot01로 변경
```

### AT-03: cascade 끄기
```bash
curl -X POST 'http://localhost:3100/api/config-deploy/lgw-pilot01/hostname?cascadeGatewayId=false' \
  -d '{"hostname": "lgw-experimental"}'
# Expected: hostname만 변경, gateway-id는 lgw-pilot01 유지
```

### AT-04: 멱등성 (같은 이름 재배포)
```bash
curl -X POST /api/config-deploy/lgw-pilot01/identity -d '{"name": "lgw-pilot01"}'
# Expected: HTTP 202, 변경 없음 — PI에서도 no-op 처리
```

---

## 8. 단계별 구현 순서 (Do Phase)

1. **DTO + API endpoint** — `update-identity.dto.ts` + controller `@Post(':gw/identity')`
2. **Service applyIdentity()** — MQTT publish `identity_update` action + cascade
3. **PI script `apply-identity.sh`** — apply-hostname + apply-gateway-id 순차 실행
4. **config-agent handler `identity.js`** + action 매핑
5. **hostname endpoint cascade 옵션** — `?cascadeGatewayId=true` 처리
6. **Frontend `IdentityCard.vue`** + API client deployIdentity()
7. **검증 (AT-01~04)** + 양산 절차서 업데이트

---

## 9. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| identity 변경 중 부분 실패 (hostname OK, gateway-id 실패) | apply-identity.sh가 정확한 status 반환 + backend가 partial 상태 DB에 기록 |
| 기존 lgw-dev/lgw-pilot01에 적용 시 운영 영향 | 새 endpoint는 신규 호출에만 영향, 기존 데이터는 그대로 |
| Frontend 카드 통합 후 사용자 혼란 | 명확한 라벨 "게이트웨이 이름 (hostname + ID)" + 툴팁 |
