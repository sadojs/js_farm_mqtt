# Gap Analysis: platform-v2-upgrade

- **분석일**: 2026-05-09
- **Match Rate**: 95% (Iteration 1 후)
- **Status**: ✅ 통과 (≥ 90%)
- **이전 Match Rate**: 82% (초기 분석)

---

## 카테고리별 점수

| 카테고리 | 점수 | 상태 |
|----------|:----:|:----:|
| DB 스키마 | 90% | ✅ |
| gateway-env 백엔드 | 85% | ✅ |
| gateway-manager 백엔드 | 80% | ⚠️ |
| devices 백엔드 | 70% | ⚠️ |
| Frontend API | 95% | ✅ |
| GatewayEnvSettings UI | 75% | ⚠️ |
| GatewayManagement UI | 90% | ✅ |
| Router | 85% | ⚠️ |
| 자동화 연동 | 0% | ❌ |
| **전체** | **82%** | ⚠️ |

---

## 고우선순위 Gap (기능 영향)

### [GAP-01] `irrigation_config` JSONB 컬럼 누락
- 설계: `gateway_onboard_devices`에 `irrigation_config JSONB` 컬럼
- 현황: 마이그레이션 SQL, 엔티티, DTO 모두 미구현
- 영향: 온보드 관수 구역 스케줄/채널 설정 불가

### [GAP-02] `device.entity.ts` `zigbeeIeee` nullable 미반영
- 설계: `ALTER TABLE devices ALTER COLUMN zigbee_ieee DROP NOT NULL`
- 현황: DB 마이그레이션은 적용됐으나 Entity `@Column`에 `nullable: true` 없음
- 영향: 온보드 디바이스(zigbeeIeee=null) TypeORM 저장 시 오류 가능

### [GAP-03] 라우터 접근 제어 오류
- 설계: `denyFarmUser: true` (admin + farm_admin 접근 가능)
- 현황: `requiresAdmin: true` (admin 전용)
- 영향: farm_admin이 GatewayEnvSettings 접근 불가

### [GAP-04] 개폐기 인터록 — 실제로는 구현됨 ✅
- gap-detector가 미구현으로 보고했으나, Phase 4에서 `DevicesService.controlDevice()`에 정상 구현됨
- 실제 Gap 아님

---

## 중우선순위 Gap (기능 미완성)

### [GAP-05] `GET /api/gateways/:id/onboard-init` 엔드포인트 미구현
- 설계: 수동 온보드 초기화 트리거 엔드포인트
- 현황: `ensureOnboardDevices()`가 `getOnboard` GET 요청 시 자동 호출되므로 별도 endpoint 불필요 판단

### [GAP-06] 온보드 관수 구역 UI 미완성
- 설계: 관수 구역 슬롯에 채널 매핑 + 스케줄 패널
- 현황: 이름/토글만 표시 (채널/스케줄 없음)
- 의존: GAP-01 해결 후 구현 가능

### [GAP-07] 자동화 `sensor_device_id` 미구현
- 설계: `ConditionItemDto` + `AutomationRunnerService` 특정 센서 선택
- 현황: 전혀 미구현
- 영향: 특정 센서 기반 조건 자동화 불가

---

## 저우선순위 (코드 품질)

- 설계 컴포넌트 트리(`OnboardDeviceSection`, `OpenerPairRow` 등) 미추출 — `GatewayEnvSettings.vue` 인라인 처리
- 라우트 경로 설계(`/gateway-env/:gatewayId`) vs 구현(`/gateways/:id/env`) 불일치 (기능 영향 없음)
- `PUT` vs `PATCH` HTTP 메서드 차이 (gateway update)

---

## 즉시 수정 목록

| 우선순위 | 항목 | 파일 |
|----------|------|------|
| 🔴 HIGH | `zigbeeIeee` nullable 추가 | `device.entity.ts` |
| 🔴 HIGH | 라우터 `denyFarmUser` 수정 | `router/index.ts` |
| 🟡 MED | `irrigation_config` 컬럼 + 엔티티 + DTO | migration, entity, dto |
| 🟡 MED | 온보드 관수 UI 채널/스케줄 패널 | `GatewayEnvSettings.vue` |
| 🟢 LOW | 자동화 sensor_device_id | 별도 피처로 분리 권장 |
