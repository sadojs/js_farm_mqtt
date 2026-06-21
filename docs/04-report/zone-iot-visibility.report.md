# zone-iot-visibility Completion Report

> **Status**: Complete
>
> **Project**: Smart Farm MQTT Platform
> **Author**: 오정석
> **Completion Date**: 2026-06-21
> **PDCA Cycle**: zone-iot-visibility

---

## 1. 요약

구역별 IoT 사용 여부 토글을 HouseGroup 단위로 구현하여, 비-IoT 구역을 IoT 화면에서 일괄 숨기는 동시에 방재일정·농작업·생육관리 등 비-IoT 모듈에는 전체 구역을 그대로 노출하는 분리가 완료되었다.

---

## 2. 배경 및 목적

### Plan 핵심 인용

> 방재일정·농작업 일정·작물재배 같은 **비-IoT 부가기능**은 농장의 모든 구역에 대해 계획·기록해야 한다.
> 그러나 구역이 8개를 넘기면서 구역 관리 카드 화면이 너무 길어져 IoT 구역 찾기가 어렵고, 자동제어 룰·게이트웨이 구역 할당·장치 등록의 드롭다운에 비-IoT 구역까지 다 떠서 오선택 위험이 생겼다.

목표:
- 구역별 `iot_enabled` 플래그를 두고, 끈 구역은 IoT 화면에서 숨김
- 방재일정·농작업·생육관리에는 그대로 표시 (비-IoT 모듈 변경 0줄)
- 비활성 구역은 "구역 표시 설정" 모달에서 일괄 관리
- admin / farm_admin 만 토글 가능, farm_user 는 readonly

---

## 3. 결과

### 3.1 핵심 지표

| 지표 | 값 |
|------|-----|
| Match Rate | **97%** |
| 변경 파일 수 | **21 files** |
| 삽입 라인 | **1,457 insertions** |
| 커밋 | `01a59be` feat(zones): 구역 IoT 사용 여부 토글 |
| nest build | EXIT 0 |
| vue-tsc | EXIT 0 |
| API E2E | 7개 그룹 OFF/ON 시나리오 모두 통과 |
| 브라우저 검증 | 완료 |

### 3.2 기능 요건 달성 현황

| ID | 요건 | 상태 |
|----|------|:----:|
| F1 | houses.iot_enabled + house_groups.iot_enabled 마이그레이션 | 완료 |
| F2 | 구역 관리 메인: 활성 구역만 카드 표시 + 숨김 배지 + 안내 배너 | 완료 |
| F3 | 구역 표시 설정 모달: 일괄 토글 + 저장 + 영향 카운트 다이얼로그 | 완료 |
| F4 | IoT 드롭다운/리스트 8종 — 활성 구역만 노출 | 완료 |
| F5 | 비-IoT 모듈(spray-schedule, work-log, crop-management, worker-payroll, zone-notes) 변경 0줄 | 완료 |
| F6 | GET /api/groups?iotOnly=true (하위호환 옵션) | 완료 |
| F7 | PATCH /api/groups/houses/iot-enabled (bulk) | 완료 |

### 3.3 비기능 요건 달성 현황

| 요건 | 상태 |
|------|:----:|
| OFF 시도 시 영향 카운트 합산 확인 다이얼로그 | 완료 |
| 변경 후 닫기 — "저장하지 않은 변경" 확인 | 완료 |
| 저장 성공 시 groupStore 즉시 재조회 | 완료 |
| farm_user 모달 readonly (토글 disabled) | 완료 |
| 모바일 하단 시트 (@media max-width: 600px) | 완료 |

---

## 4. 주요 의사결정

### 4.1 토글 단위 변경 — House → HouseGroup

초기 설계(Plan v2)는 House 단위 토글을 제안했다. 그러나 mtest 계정 검증 중 7개 HouseGroup 중 5개가 House를 포함하지 않는 것을 발견했다. 사용자가 "구역"으로 인식하는 단위는 HouseGroup이므로, 마이그레이션 034(`house_groups.iot_enabled`)를 추가하고 service·store·Modal 전체를 group 단위로 재작업했다.

영향:
- 마이그레이션 2개 (033: houses, 034: house_groups)
- 백엔드 `bulkUpdateIotEnabled` 대상이 groupsRepo, 휘하 houses 동기화 포함
- `getIotRelatedCounts` 파라미터가 houseIds → groupIds 로 변경

### 4.2 하위호환 유지 — ?iotOnly=true 옵션

백엔드는 `GET /api/groups?iotOnly=true` 옵션을 추가하는 방식을 채택했다. 기존 호출(`?iotOnly` 없음)은 전체 구역을 그대로 반환하므로 비-IoT 모듈(spray-schedule, work-log, crop-management, worker-payroll, zone-notes)은 코드를 한 줄도 수정하지 않고도 전체 구역을 계속 받는다.

### 4.3 드롭다운 vs Lookup 분리

선택 목록(드롭다운, 장치 등록, 자동제어 룰 위저드 등)은 `iotGroups`(활성만)를 사용한다. 그러나 이미 저장된 데이터의 lookup — 예컨대 룰에 저장된 groupId 로 구역 이름을 표시 — 은 `groups`(전체)를 사용한다. 이를 통해 비활성 구역에 매핑된 기존 룰도 정상 표시·관리된다.

### 4.4 일괄 토글 + 영향 카운트 다이얼로그

ZoneVisibilityModal에서 N개 토글을 변경한 후 [저장]을 클릭하면:
1. OFF로 바뀌는 group에 연결된 자원을 `getIotRelatedCounts` API로 일괄 조회
2. 장치·룰·게이트웨이 합산 카운트가 0이 아닐 경우에만 영향 확인 다이얼로그 표시
3. 연결 자원 없으면 즉시 저장

ConfirmHideModal은 별도 파일 대신 ZoneVisibilityModal 인라인으로 구현했다(설계 대비 의도적 단순화).

---

## 5. 코드 변경 위치 매트릭스

### 5.1 Backend

| 파일 | 내용 |
|------|------|
| `backend/database/migrations/033_zone_iot_visibility.sql` | houses.iot_enabled + 부분 인덱스 + COMMENT |
| `backend/database/migrations/034_house_group_iot_enabled.sql` | house_groups.iot_enabled + 부분 인덱스 + COMMENT |
| `backend/src/modules/groups/entities/house.entity.ts` | iotEnabled 컬럼 추가 |
| `backend/src/modules/groups/entities/house-group.entity.ts` | iotEnabled 컬럼 추가 |
| `backend/src/modules/groups/groups.service.ts` | findAllGroups({iotOnly}), bulkUpdateIotEnabled(), getIotRelatedCounts() |
| `backend/src/modules/groups/groups.controller.ts` | GET ?iotOnly=true, PATCH /houses/iot-enabled, GET /houses/iot-related-counts |

### 5.2 Frontend

| 파일 | 내용 |
|------|------|
| `frontend/src/types/group.types.ts` | HouseGroup.iotEnabled, House.iotEnabled, IotRelatedCounts 타입 |
| `frontend/src/api/group.api.ts` | getGroups({iotOnly}), bulkUpdateIotEnabled, getIotRelatedCounts |
| `frontend/src/stores/group.store.ts` | iotGroups ref, hiddenZoneCount computed, fetchIotGroups(), bulkUpdateIotEnabled() |
| `frontend/src/views/Groups.vue` | 메인 그리드 = iotGroups, 숨김 배지 버튼, 안내 배너, ZoneVisibilityModal 연결 |
| `frontend/src/components/groups/ZoneVisibilityModal.vue` | 신규: 일괄 토글 + 영향 카운트 다이얼로그 + 인라인 확인 모달 |
| `frontend/src/views/Dashboard.vue` | groupStore.iotGroups |
| `frontend/src/views/Devices.vue` | groupStore.iotGroups |
| `frontend/src/views/Automation.vue` | groupStore.iotGroups |
| `frontend/src/views/Sensors.vue` | groupStore.iotGroups |
| `frontend/src/views/Reports.vue` | groupStore.iotGroups |
| `frontend/src/components/dashboard/SummaryCards.vue` | groupStore.iotGroups |
| `frontend/src/components/devices/DeviceRegistration.vue` | groupStore.iotGroups |
| `frontend/src/components/groups/AddDeviceModal.vue` | groupStore.iotGroups |
| `frontend/src/components/automation/RuleWizardModal.vue` | groupStore.iotGroups |
| `frontend/src/components/automation/StepTargetSelect.vue` | groupStore.iotGroups |
| `frontend/src/components/automation/v2/StepFarmSelect.vue` | groupStore.iotGroups |
| `frontend/src/components/reports/SensorCompareChart.vue` | groupStore.iotGroups |
| gateway-manager, env-config, sensor-alerts 관련 | groupStore.iotGroups |

### 5.3 비-IoT 모듈 보존 (변경 0줄)

| 모듈 | 상태 |
|------|:----:|
| spray-schedule | 변경 없음 — groupStore.groups(전체) 그대로 |
| work-log | 변경 없음 |
| crop-management | 변경 없음 |
| worker-payroll | 변경 없음 |
| zone-notes | 변경 없음 |

---

## 6. 검증 내역

### 6.1 DB 마이그레이션

| 항목 | 결과 |
|------|:----:|
| 033: houses.iot_enabled BOOLEAN NOT NULL DEFAULT TRUE | 통과 |
| 033: idx_houses_iot_enabled 부분 인덱스 | 통과 |
| 033: COMMENT 추가 | 통과 |
| 034: house_groups.iot_enabled BOOLEAN NOT NULL DEFAULT TRUE | 통과 |
| 034: 부분 인덱스 + COMMENT | 통과 |
| 기존 구역 전체 iot_enabled=true 초기화 | 통과 |

### 6.2 API E2E (mtest 계정, 7개 HouseGroup 기준)

| 시나리오 | 결과 |
|----------|:----:|
| GET /api/groups — 전체 7개 반환 | 통과 |
| GET /api/groups?iotOnly=true — 활성만 반환 | 통과 |
| PATCH /api/groups/houses/iot-enabled — group 단위 OFF | 통과 |
| PATCH 후 GET?iotOnly=true — 변경 즉시 반영 | 통과 |
| GET /api/groups/houses/iot-related-counts?ids= — 영향 카운트 집계 | 통과 |
| farm_user 권한으로 PATCH 시도 — 403 반환 | 통과 |
| 전체 ON 복구 | 통과 |

### 6.3 타입 검사 및 빌드

| 항목 | 결과 |
|------|:----:|
| vue-tsc | EXIT 0 |
| nest build | EXIT 0 |

### 6.4 브라우저 동작 확인

| 항목 | 결과 |
|------|:----:|
| 구역 관리 메인: iotGroups만 카드 표시 | 확인 |
| 숨김 배지 (N>0 일 때만) | 확인 |
| 하단 안내 배너 (N>0 일 때만) | 확인 |
| ZoneVisibilityModal 일괄 토글 후 저장 | 확인 |
| 영향 카운트 다이얼로그 표시 | 확인 |
| 저장 성공 후 메인 카드 즉시 반영 | 확인 |
| 자동제어 룰 위저드 구역 드롭다운 — 활성만 | 확인 |
| 방재일정/농작업 — 전체 구역 그대로 노출 | 확인 |
| farm_user 모달 readonly | 확인 |
| 모바일 하단 시트 | 확인 |

---

## 7. 운영 가이드

### 7.1 마이그레이션 적용

```bash
# 컨테이너 기준
docker compose exec postgres psql -U postgres -d smartfarm \
  -f /migrations/033_zone_iot_visibility.sql

docker compose exec postgres psql -U postgres -d smartfarm \
  -f /migrations/034_house_group_iot_enabled.sql
```

적용 후 기존 구역 전체는 `iot_enabled = true`로 초기화된다. 기존 동작에 변화 없음.

### 7.2 백엔드 재시작

마이그레이션 적용 후 백엔드를 재시작해야 새 엔티티 컬럼이 TypeORM에 반영된다.

```bash
docker compose restart backend
```

### 7.3 토글 사용 절차

1. **구역 관리** 화면 → 우측 상단 "구역 표시 설정" 버튼 클릭
2. 모달에서 각 구역의 토글 ON/OFF 조작
3. OFF로 변경하는 구역에 연결 자원(장치·룰·게이트웨이)이 있으면 영향 카운트 확인 다이얼로그 표시 → [숨기기] 확인
4. [저장] → 메인 카드 및 모든 IoT 드롭다운 즉시 갱신
5. 비활성화된 구역의 자동제어·알림은 백엔드에서 계속 동작함

---

## 8. 잔여 PARTIAL Gap 4건

동작 차이 없음 — 기록 목적으로만 보고한다.

| # | 항목 | 분류 | 영향도 |
|---|------|:----:|:------:|
| 1 | BulkIotEnabledDto 별도 파일 부재 | 의도적 변경 | 낮음 — 컨트롤러 인라인 타입으로 동작 동일, class-validator 미적용 |
| 2 | 부트스트랩 fetchIotGroups 명시 호출 | 부분 | 낮음 — fetchIotGroups()가 fetchGroups() 래퍼이므로 실질적 차이 없음 |
| 3 | 카드 배지 "● IoT 사용" 생략 | 의도적 생략 | 없음 — 설계서 자체에서 "활성만이므로 항상 IoT 사용으로 보임" 명시 |
| 4 | ConfirmHideModal 별도 파일 없음 | 의도적 변경 | 없음 — ZoneVisibilityModal 인라인으로 동일 UX 달성 |

---

## 9. 후속 작업 후보

다음은 이번 사이클의 Out-of-Scope 또는 구현 중 발견된 옵션 후보다. 필요성과 우선순위 검토 후 별도 PDCA로 진행한다.

| 후보 | 내용 | 검토 포인트 |
|------|------|-------------|
| HouseGroup + House 이중 토글 분리 | 현재는 group 단위 단일 토글. House(세부 구역) 단위로도 분리가 필요한지 | 운영 피드백 수집 후 결정 권장 |
| 비-IoT 구역 장치 등록 강제 차단 | 현재는 UI 숨김만. iot_enabled=false 구역에 새 장치 등록 시 API 레벨에서 거부할지 | 의도치 않은 등록 사고 빈도 확인 후 결정 |
| 토글 변경 이력 activity_logs UI 필터 | 백엔드에서 `zone.iot_visibility.changed` 액션 로그 기록 중. 프론트 활동 로그 탭에 필터 추가 여부 | 활동 로그 UI 개선 사이클과 묶어서 처리 권장 |

---

## 10. PDCA 사이클 완료 상태

| 단계 | 문서 | 상태 |
|------|------|:----:|
| Plan | docs/01-plan/features/zone-iot-visibility.plan.md | 완료 |
| Design | docs/02-design/features/zone-iot-visibility.design.md | 완료 (v2) |
| Do | commit 01a59be — 21 files, 1,457 insertions | 완료 |
| Check | docs/03-analysis/zone-iot-visibility.analysis.md | Match Rate 97% |
| Act | 본 문서 | 완료 |

---

## Related Documents

- Plan: [zone-iot-visibility.plan.md](../01-plan/features/zone-iot-visibility.plan.md)
- Design: [zone-iot-visibility.design.md](../02-design/features/zone-iot-visibility.design.md)
- Analysis: [zone-iot-visibility.analysis.md](../03-analysis/zone-iot-visibility.analysis.md)
