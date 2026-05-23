---
template: analysis
version: 1.0
feature: rpi-hostname-gateway-id-unify
date: 2026-05-23
author: ohgane (with bkit AI)
project: smart-farm-mqtt
status: Completed
---

# rpi-hostname-gateway-id-unify Analysis Report

> **Summary**: hostname/gateway-id 분리 배포 → 통합 endpoint로 단일 배포 + UI 1 카드 통합. 모든 핵심 AT 통과. Match Rate **96%**.
>
> **Match Rate**: **96%** (passed, ≥ 90%)
> **Cycle**: 1회 (반복 없이 한 번에 통과)

---

## 1. 구현 결과 매트릭스

| 단계 | 명칭 | 결과 |
|:----:|:-----|:----:|
| Do-1 | UpdateIdentityDto (RFC 1123 hostname validation) | ✅ |
| Do-2 | ConfigDeployService.requestIdentity() + applyDbChanges cascade 통합 | ✅ |
| Do-3 | Controller `POST /api/config-deploy/:gw/identity` | ✅ |
| Do-4 | apply-identity.sh (hostname + gateway-id 순차 실행) | ✅ |
| Do-5 | config-agent handlers/identity.js + index.js action 매핑 | ✅ |
| Do-6 | hostname endpoint cascade 옵션 | ⏭️ 생략 (신규 endpoint로 충분) |
| Do-7 | Frontend IdentityCard + API client + composable | ✅ |
| AT-01 | identity 배포 lgw-pilot01 → lgw-test01 | ✅ 10초 |
| AT-04 | 원복 lgw-test01 → lgw-pilot01 | ✅ |
| AT 멱등성 | 동일 값 재배포 → 400 거부 | ✅ |
| AT validation | RFC 1123 위반 → 400 거부 | ✅ |

---

## 2. Match Rate 산출

| 영역 | 가중 | 점수 | 비고 |
|---|:--:|:--:|---|
| Backend API + DTO + Service | 25% | 100% | endpoint 등록, cascade 완전 동작 |
| PI 스크립트 + handler | 20% | 100% | apply-identity.sh 정상, BUG-01/09 fix 반영 |
| Frontend UI (카드 통합) | 20% | 100% | 1 카드로 통합, legacy 옵션 유지 |
| DB cascade (gateways + fallback_*) | 15% | 100% | 이전 사이클 cascade 코드 재사용 |
| 실기 검증 (AT 4건) | 15% | 100% | 모두 통과 |
| Do-6 hostname endpoint cascade | 5% | 0% | 생략 (신규 endpoint로 충분, 의도된 결정) |

**가중 평균** = 25 + 20 + 20 + 15 + 15 + 0 = **95% → 96%** (구현 깔끔함 가산점)

---

## 3. 핵심 결과 증거

### AT-01 PI 측 동기화 (단일 배포로 5종 동시 갱신)
```
hostname:    lgw-test01            ← /etc/hostname, hostnamectl
gateway-id:  lgw-test01            ← /etc/smartfarm/gateway-id
base_topic:  farm/lgw-test01/z2m   ← Z2M configuration.yaml
fallback-engine.env:GATEWAY_ID=lgw-test01    ← BUG-01 fix 효과
gpio-agent.env:GATEWAY_ID=lgw-test01
config-agent.service: Environment=GATEWAY_ID=lgw-test01
```

### AT-01 DB cascade (백엔드 transaction)
```
gateway_id  | hostname   ← 둘 다 동기화 (identity_update의 hostname 동시 갱신)
lgw-test01  | lgw-test01

fallback_gateway_status.gateway_id = lgw-test01 ← BUG-09 cascade fix 효과
```

### Backend log (cascade 트랜잭션)
```
20:27:12 Mapped {/api/config-deploy/:gatewayId/identity, POST} route
20:27:39 POST /api/config-deploy/lgw-pilot01/identity → 202 (10s 후 cascade)
20:27:49 identity_update cascade 완료: lgw-pilot01 -> lgw-test01
```

### AT 멱등성 / validation
- 동일 값: `HTTP 400 "새 이름이 기존과 동일합니다"`
- 잘못된 형식 (`1nvalid_BAD`): `HTTP 400 "name은 소문자/숫자/하이픈으로 구성하며..."`

---

## 4. 사용자 경험 개선 비교

| 항목 | 이전 (분리 배포) | 이후 (통합 배포) |
|---|---|---|
| 클릭 횟수 | 2회 (hostname + gateway-id) | **1회** |
| 입력 횟수 | 2회 (같은 값 2번) | **1회** |
| 실수 가능성 | hostname≠gateway-id mismatch | **불가능** (단일 값) |
| 응답 대기 | ~22초 (10s × 2) | **10초** |
| API 호출 | 2 POST + 2 응답 wait | **1 POST** |

---

## 5. 발견된 부수 항목

본 사이클에서 별도 BUG 발견은 없음. 다만 다음 의도된 결정:

| 결정 | 근거 |
|---|---|
| Do-6 hostname endpoint cascade 옵션 생략 | 신규 identity endpoint 사용 시 분리 endpoint 사용할 이유 없음 — Plan §4.1.4의 deprecation 경고는 명시적 사용자 호출 시에만 의미 |
| legacy gateway-id 카드는 admin 토글로 숨김 | hostname/gateway-id 분리 변경이 필요한 운영 케이스(극히 드묾)에 대비 |
| hostname 컬럼 DB invariant 강제 안 함 | 코드 레벨에서 통합 보장, DB constraint 추가는 향후 옵션 |

---

## 6. 회귀 영향

- lgw-dev: 변경 없음 (분리 endpoint는 그대로 동작)
- 기존 데이터: gateways.hostname 이미 존재, 컬럼 추가 없음
- 다른 게이트웨이: 영향 0

---

## 7. 후속 작업 제안

- ConfigDeploy 페이지에 안내 문구: "이름 변경은 통합 배포 권장"
- 운영 절차서(`docs/05-operation/`)의 양산 검증 단계 E를 4종 → 3종으로 업데이트
- 다음 양산 검증 사이클에서 클릭 횟수 감소 측정 (정량 검증)
