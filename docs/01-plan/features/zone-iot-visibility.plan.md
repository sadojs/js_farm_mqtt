# Plan — zone-iot-visibility

**Feature**: zone-iot-visibility (구역 IoT 사용 여부 + 구역 표시 설정)
**Created**: 2026-06-21
**Owner**: 오정석
**Phase**: Plan (v2 — 디자인 확정 반영)

---

## 1. 배경 (Why)

방재일정·농작업 일정·작물재배 같은 **비-IoT 부가기능**은 농장의 *모든 구역*에 대해 계획·기록해야 한다.
사용자는 IoT 센서/액추에이터가 설치되지 않은 구역(노지 등)까지 포함해서 모든 구역을 생성했다.

그러나 구역이 8개를 넘기면서

- **구역 관리 카드 화면** 이 너무 길어져 IoT 구역 찾기가 어렵다
- **자동제어 룰·게이트웨이 구역 할당·장치 등록** 의 드롭다운에 비-IoT 구역까지 다 떠서 오선택 위험
- 대시보드/리포트의 구역 선택 노이즈

→ 구역별로 **"IoT 사용"** 플래그를 두고, 끈 구역은
1. 구역 관리 메인 화면에서도 **숨김** (카드 미표시),
2. 모든 IoT 드롭다운/리스트에서도 **숨김**,
3. 단, 방재일정·농작업 일정·생육관리에는 그대로 표시
4. 비활성 구역은 우측 상단 **"구역 표시 설정"** 모달에서 일괄 관리

---

## 2. 목표 (What)

### Functional Goals

- [F1] `houses.iot_enabled BOOLEAN NOT NULL DEFAULT TRUE` 컬럼 추가 (마이그레이션 1회)
- [F2] **구역 관리 메인 화면**
  - 활성 (`iot_enabled=true`) 구역 카드만 표시
  - 우측 상단에 **"👁 구역 표시 설정 · 숨김 N"** 버튼 (숨김 0 이면 배지 숨김)
  - 우측 상단에 **"+ 구역 추가"** 버튼 (기존)
  - 카드 우측에 **● IoT 사용** 배지만 (토글 X — 모달에서 관리)
  - 카드 아래에 안내 배너:
    > 👁‍🗨 IoT 미사용 구역 **N개** 가 숨겨져 있습니다 (방재·농작업 일정에는 계속 표시됨). "구역 표시 설정"에서 변경
  - 숨김이 0 이면 배너 미표시
- [F3] **"구역 표시 설정" 모달**
  - 전체 구역 목록 (활성 + 비활성 모두)
  - 각 구역마다: 아이콘 · 이름 · 메타(측정기 N · 장치 N · 작물 정식 정보) · 우측 토글 + "IoT 사용 / 미사용" 라벨
  - 토글로 N개 한꺼번에 변경 후 [저장] → 일괄 반영
  - admin / farm_admin 만 토글 가능 (farm_user 는 readonly 모달)
- [F4] **IoT 드롭다운·리스트** 도 활성 구역만 노출:
  - 자동제어 룰 생성·편집 (RuleWizardModal, IntentWizardModal, 모든 v2 step)
  - 장치 등록 (AddDeviceModal, DeviceRegistration)
  - 게이트웨이 구역 할당 (gateway-manager)
  - 환경설정 매핑 (env-config)
  - 알림 임계값 (sensor-alerts)
  - 대시보드 위젯/요약카드 (Dashboard, SummaryCards, DeviceStatusCards)
  - 리포트 구역 셀렉터 (Reports)
- [F5] **비-IoT 모듈**은 변경 0 줄 — 기존 `groups` 그대로 사용:
  - spray-schedule / work-log / crop-management / worker-payroll / zone-notes
- [F6] 백엔드 API: `GET /api/groups?iotOnly=true` (옵션, 하위호환 유지)
- [F7] 일괄 저장 API: `PATCH /api/groups/houses/iot-enabled` (bulk)

### Non-Functional Goals

- 일괄 저장 시 OFF 로 바뀌는 구역 중 IoT 연결 자원이 있는 경우 →
  **저장 직전 확인 다이얼로그** 한번에 영향 카운트(장치 N · 룰 M · 게이트웨이 K) 표시
- 모달에서 변경 후 [닫기] → 변경 폐기 확인
- 저장 성공 시 `groupStore` 가 활성/전체 모두 재조회 → 메인 카드·드롭다운 즉시 반영
- 권한: admin / farm_admin 만 토글 변경, farm_user 는 모달에서 토글 disabled

### Out of Scope

- HouseGroup(상위 그룹) 차원의 토글 (House 단위만)
- iot_enabled=false 구역에 강제 차단 로직 (UI 숨김만, 데이터 보존)
- 비활성 구역에 대한 새 권한 체계

---

## 3. 사용자 시나리오

### S1. 비-IoT 노지 등록 후 IoT 화면에서 정리

1. 사용자가 8개 구역 생성 (HK 시리즈 3개 + 노지 5개)
2. 처음에는 모두 `iot_enabled=true` → 메인 화면이 길어짐
3. **우측 상단 "구역 표시 설정"** 클릭 → 모달
4. 노지 5개의 토글 OFF → [저장]
5. 메인 카드 3개로 정리, 하단 배너 "숨김 5개"
6. 자동제어 룰 만들 때 구역 드롭다운에 HK 3개만 노출
7. 방재일정 / 농작업 일정에는 8개 구역 모두 그대로

### S2. 일시 분리

1. "HK-2동 오이" 정비 중 → IoT 화면에서만 잠시 숨기고 싶음
2. 모달에서 OFF → 영향 카운트 모달: "장치 5 · 룰 2 · 게이트웨이 1 — 그래도 숨기시겠습니까?"
3. [숨기기] → 메인에서 사라짐, 안내 배너 "숨김 1개"
4. 정비 후 모달 열어서 ON → 즉시 복귀
5. **자동제어 룰 동작·알림은 백엔드에서 계속 동작** (UI 숨김만)

### S3. 권한 분리

- farm_user 가 모달 열면 모든 토글 disabled + 상단에 "관리자에게 문의" 안내
- admin / farm_admin 은 자유

---

## 4. 영향 범위 / 의존성

| 모듈 | 변경 |
|------|------|
| `backend/database/migrations/033_zone_iot_visibility.sql` | 신규 |
| `backend/src/modules/groups/entities/house.entity.ts` | `iotEnabled` 추가 |
| `backend/src/modules/groups/groups.service.ts` | `findAllGroups({ iotOnly })`, `bulkUpdateIotEnabled()`, `getIotRelatedCounts()` |
| `backend/src/modules/groups/groups.controller.ts` | `?iotOnly=true`, `PATCH /houses/iot-enabled`, `GET /houses/iot-related-counts?ids=` |
| `backend/src/modules/groups/dto/bulk-iot-enabled.dto.ts` | 신규 |
| `frontend/src/types/group.types.ts` | `iotEnabled`, `IotRelatedCounts` |
| `frontend/src/api/group.api.ts` | `bulkUpdateIotEnabled`, `getIotRelatedCounts(ids)`, `getGroups({ iotOnly })` |
| `frontend/src/stores/group.store.ts` | `iotGroups`, `hiddenZoneCount` computed, `bulkUpdateIotEnabled()` |
| `frontend/src/views/Groups.vue` | 메인 카드 = `iotGroups`, 우측 상단 버튼, 하단 배너 |
| `frontend/src/components/groups/ZoneVisibilityModal.vue` (신규) | 일괄 토글 + 저장 |
| IoT 화면들 (Dashboard, Devices, Automation, Sensors, Reports, Env-config, Alerts, Gateway-manager + 자식 컴포넌트) | `groups` → `iotGroups` |
| 비-IoT 모듈 (spray-schedule, work-log, crop-management, worker-payroll, zone-notes) | **변경 없음** |

---

## 5. 리스크 & 대응

| 리스크 | 대응 |
|--------|------|
| 한 번에 끄면 메인 카드가 한꺼번에 사라져 당황 | 하단 배너 + 모달 진입 동선 명확 / "구역 표시 설정 · 숨김 N" 버튼 항상 노출 |
| IoT 연결 자원이 있는 구역을 끔 | 저장 직전 영향 카운트 합산 확인 모달 |
| farm_user 가 토글 시도 | 컨트롤러 `@Roles('admin','farm_admin')` + 모달 disabled |
| 모달 변경 후 닫기 | "저장하지 않은 변경" 확인 다이얼로그 |
| 캐시 어긋남 | 저장 성공 시 `fetchGroups()` + `fetchIotGroups()` 동시 재조회 |

---

## 6. 성공 기준

- [ ] 마이그레이션 통과, 기존 구역 모두 `iot_enabled=true`
- [ ] 구역 관리 메인에 활성 구역만 카드 표시
- [ ] 우측 상단 "구역 표시 설정 · 숨김 N" 버튼 + 하단 배너 동작 (숨김 0 일 때 둘 다 N 표시 없음)
- [ ] 모달에서 일괄 토글 → 저장 → 즉시 반영
- [ ] OFF 시도 시 영향 카운트 합산 확인 모달 노출
- [ ] IoT 드롭다운/리스트(자동제어·게이트웨이 구역 할당·장치 등록 등) 모두 활성 구역만
- [ ] 비-IoT 화면(방재일정·농작업·작물재배·일꾼·구역메모) 8개 구역 모두 그대로 노출
- [ ] farm_user 모달 readonly
- [ ] vue-tsc / nest build EXIT 0

---

## 7. PDCA 다음

→ `/pdca design zone-iot-visibility` (v2 디자인 반영)
