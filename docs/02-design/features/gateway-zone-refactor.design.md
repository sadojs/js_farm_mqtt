# Design: gateway-zone-refactor

> Plan: [gateway-zone-refactor.plan.md](../../01-plan/features/gateway-zone-refactor.plan.md)

---

## 1. 현재 구조 분석

### 1-1. 현재 DB 관계

```
gateways (house_id FK → houses.id)
  └── houses (group_id FK → house_groups.id)
        └── house_groups
              └── group_devices (M:N → devices)

gateway_onboard_devices (gateway_id FK → gateways.id)
  현재 슬롯: 개폐기 3쌍(6) + 팬 3 + 원격/B접점/구역4/교반기/액비 = 17개

devices (zigbee 장치, source: 'zigbee'|'onboard')
```

### 1-2. 현재 DEFAULT_SLOTS (변경 필요)

현재: 개폐기 3쌍 + 팬 3개 + 구역 4개 = 17개  
변경: **팬 4개 + 원격제어 + B접점 + 구역 7개 + 교반기 + 액비 = 15개**

---

## 2. 목표 구조

### 2-1. 데이터 모델

```
house_groups (구역)
  ├── gateways[] (game.house_id → house.id, house.group_id → house_groups.id)
  │     └── gateway_onboard_devices[] (onboard 장치 15개)
  │     └── devices[] (zigbee 장치, source='zigbee')
  └── [구역 페이지에서 모든 게이트웨이의 활성 장치를 조회]
```

**게이트웨이-구역 관계**: 기존 `gateway → house → group` 3단 계층 유지  
- `gateway.houseId` → `house.id` → `house.groupId` → `house_groups.id`  
- **1게이트웨이 = 1house = 1구역** (house는 gateway-group 연결 어댑터 역할)
- 구역 하나에 house 여러 개 → 게이트웨이 여러 개 허용

### 2-2. 온보드 슬롯 재정의 (15개)

```typescript
const DEFAULT_SLOTS = [
  // 팬 (1~4)
  { slotKey: 'fan_1', slotType: 'fan', pairKey: null, name: '유동팬 1번', sortOrder: 1 },
  { slotKey: 'fan_2', slotType: 'fan', pairKey: null, name: '유동팬 2번', sortOrder: 2 },
  { slotKey: 'fan_3', slotType: 'fan', pairKey: null, name: '유동팬 3번', sortOrder: 3 },
  { slotKey: 'fan_4', slotType: 'fan', pairKey: null, name: '유동팬 4번', sortOrder: 4 },
  // 관주 컨트롤 (5~6)
  { slotKey: 'remote_control',      slotType: 'remote_control',     name: '원격제어 ON/OFF',    sortOrder: 5 },
  { slotKey: 'fertilizer_contact',  slotType: 'fertilizer_contact', name: '액비/교반기 B접점',   sortOrder: 6 },
  // 관주 구역 (7~13)
  { slotKey: 'zone_1', slotType: 'irrigation_zone', name: '1구역 관주', sortOrder: 7 },
  { slotKey: 'zone_2', slotType: 'irrigation_zone', name: '2구역 관주', sortOrder: 8 },
  { slotKey: 'zone_3', slotType: 'irrigation_zone', name: '3구역 관주', sortOrder: 9 },
  { slotKey: 'zone_4', slotType: 'irrigation_zone', name: '4구역 관주', sortOrder: 10 },
  { slotKey: 'zone_5', slotType: 'irrigation_zone', name: '5구역 관주', sortOrder: 11 },
  { slotKey: 'zone_6', slotType: 'irrigation_zone', name: '6구역 관주', sortOrder: 12 },
  { slotKey: 'zone_7', slotType: 'irrigation_zone', name: '7구역 관주', sortOrder: 13 },
  // 교반기/액비 (14~15)
  { slotKey: 'mixer',            slotType: 'mixer',            name: '교반기', sortOrder: 14 },
  { slotKey: 'fertilizer_motor', slotType: 'fertilizer_motor', name: '액비',   sortOrder: 15 },
]
```

**기존 DB 데이터 마이그레이션**:
- `opener_*` 슬롯 레코드 → 삭제 (개폐기는 지그비로만)
- `fan_4` 추가 (누락분)
- `zone_5`, `zone_6`, `zone_7` 추가 (기존 4개 → 7개)

---

## 3. Backend 설계

### 3-1. `gateway-env` 모듈 변경

#### `ensureOnboardDevices()` 수정
```typescript
// DEFAULT_SLOTS 15개로 변경
// 기존 opener_* 슬롯 soft-delete 또는 제거
// 멱등성 유지: 이미 있는 슬롯은 수정하지 않음 (사용자가 이름 바꿨을 수 있음)
// 누락된 슬롯만 추가
```

#### 새 API: `GET /api/gateway-env/:gatewayId/all-devices`
구역 페이지가 호출하는 통합 조회 엔드포인트.
```typescript
// 응답 형태
{
  onboard: GatewayOnboardDevice[],  // enabled 여부 포함 전체
  zigbee: Device[],                  // source='zigbee'
}
```

#### 기존 API 유지 (변경 없음)
- `PATCH /api/gateway-env/:gatewayId/onboard/:id` — 이름/활성화 수정
- `GET /api/gateway-env/:gatewayId/zigbee` — 지그비 장치 목록
- `POST /api/gateway-env/:gatewayId/zigbee` — 지그비 장치 추가
- `PATCH /api/gateway-env/:gatewayId/zigbee/:id` — 이름/채널매핑 수정
- `DELETE /api/gateway-env/:gatewayId/zigbee/:id` — 지그비 장치 삭제
- `GET /api/gateway-env/:gatewayId/zigbee/scan` — 스캔

### 3-2. `gateway-manager` 모듈 변경

#### 새 API: `PATCH /api/gateways/:id/zone`
게이트웨이를 구역(house_group)에 할당/해제.
```typescript
// Body: { groupId: string | null }
// 로직:
//   1. groupId가 null이면 gateway.houseId = null (할당 해제)
//   2. groupId 있으면:
//      - 해당 group의 houses[0] 조회 (없으면 생성)
//      - gateway.houseId = house.id
//      - 이미 다른 구역에 할당된 경우 ConflictException 반환
// 응답: { gateway, group }
```

#### `getAll()` 응답에 `groupId`, `groupName` 추가
```typescript
// gateway 조회 시 house → group JOIN으로 구역명 포함
SELECT gw.*, hg.name as group_name, hg.id as group_id
FROM gateways gw
LEFT JOIN houses h ON h.id = gw.house_id
LEFT JOIN house_groups hg ON hg.id = h.group_id
WHERE gw.user_id = $userId
```

### 3-3. `groups` 모듈 변경

#### `findAllGroups()` 수정
현재: `gateway → house → group` 체인으로 devices 포함  
변경: `group_devices` M:N 조인 제거, gateway 기반 장치만 사용
```typescript
// 구역 조회 시 group_devices 관계 제거
// 대신 각 group의 house에 속한 gateway들의 활성 onboard + zigbee 장치 조회
// devices 관계(@ManyToMany) 삭제 or deprecated
```

#### 구역 내 장치 수 카운트 API: `GET /api/groups/:id/device-count`
```typescript
// 응답: { onboardCount, zigbeeCount, sensorCount, actuatorCount }
```

### 3-4. `devices` 모듈 (deprecated 처리)

- `POST /api/devices` — 비활성화 (게이트웨이 환경 설정에서만 추가)
- `DELETE /api/devices/:id` — 비활성화
- `PATCH /api/devices/:id` — 비활성화 (이름 변경 포함)
- `GET /api/devices` — 유지 (읽기 전용, 구역 정보 포함 조회)

---

## 4. Frontend 설계

### 4-1. GatewayManagement.vue 변경

```
[기존]                              [변경]
┌──────────────────────┐           ┌──────────────────────────────────┐
│ 게이트웨이 카드        │           │ 게이트웨이 카드                    │
│  - 이름, 상태         │           │  - 이름, 상태                     │
│  - 환경설정 버튼       │   →       │  - 할당 구역: [1동 하우스 ▼] 드롭다운│
│  - 구역관리로 이동     │           │  - 환경설정 버튼 (→ /gateways/:id/env)│
└──────────────────────┘           │  - 원격접속 버튼                   │
                                   └──────────────────────────────────┘
```

- **구역 할당 드롭다운**: 전체 구역 목록 + "할당 안 함" 옵션
  - 다른 구역에 이미 할당된 경우 경고 모달
  - `PATCH /api/gateways/:id/zone` 호출
- 환경설정 버튼: `router.push('/gateways/:id/env')`로 직접 이동

### 4-2. GatewayEnvSettings.vue 변경

#### 온보드 섹션 재구성 (15개 슬롯)
```
┌─────────────────────────────────────────────┐
│ 온보드 GPIO 장치                              │
│  ┌─ 팬 ──────────────────────────────────┐   │
│  │ [✓] 유동팬 1번  [이름 편집] [비활성화]  │   │
│  │ [✓] 유동팬 2번  ...                    │   │
│  │ [✓] 유동팬 3번                         │   │
│  │ [✓] 유동팬 4번                         │   │
│  └─────────────────────────────────────── ┘   │
│  ┌─ 관주 ─────────────────────────────────┐   │
│  │ [✓] 원격제어 ON/OFF  [이름 편집]        │   │
│  │ [✓] 액비/교반기 B접점                   │   │
│  │ [✓] 1구역 관주  ...  [7구역 관주]       │   │
│  │ [✓] 교반기                              │   │
│  │ [✓] 액비                                │   │
│  └─────────────────────────────────────── ┘   │
├─────────────────────────────────────────────┤
│ 지그비 장치                                   │
│  [기존 zigbee 장치 카드들]                    │
│  [+ 장치 추가] 버튼                           │
└─────────────────────────────────────────────┘
```

- 온보드 장치 카드: 이름 인라인 편집, 활성화 토글 (삭제 버튼 없음)
- 관주 장치(onboard): 채널 고정 표시 (편집 불가, 단순 뱃지로 표시)
- 지그비 장치 카드: 이름 편집, 삭제, 채널 맵핑(관수 장치인 경우)

#### 지그비 장치 추가 플로우 (기존 유지)
1. "장치 추가" 클릭 → 스캔 모달
2. 장치 선택 → 타입 선택 (센서/팬/관수/개폐기)
3. 개폐기: 열림+닫힘 2개 필수 선택 (인터록)
4. 관수: 채널 수(8/12) 선택 + 채널 맵핑

### 4-3. Groups.vue 변경

```
구역 카드 (변경 후)
┌───────────────────────────────────────────┐
│ [구역명]  [구역 설명]                       │
├───────────────────────────────────────────┤
│ 측정기 (N)                                 │
│  [센서카드 1] [센서카드 2] ...              │
├───────────────────────────────────────────┤
│ 장치 (N)                                   │
│  [팬 1] [팬 2] [관수 1구역] ... [개폐기]    │
│  각 장치: ON/OFF 토글                      │
├───────────────────────────────────────────┤
│ 자동제어 룰 (N)                             │
│  [룰명] [활성화 토글] [값 편집] (생성/삭제 X)│
├───────────────────────────────────────────┤
│ [+ 게이트웨이 추가] 버튼                    │
└───────────────────────────────────────────┘
```

- 게이트웨이 목록 카드 제거 (구역에서 게이트웨이 리스트 미표시)
- 장치 목록: `GET /api/groups/:id/devices-summary` 또는 group 조회 시 포함
- 자동제어 룰: 값(트리거 임계값, 시간 등)만 수정 가능, 생성/삭제 버튼 없음
- 게이트웨이 추가 버튼: 기존 모달 유지 (구역에 게이트웨이 할당)

### 4-4. GroupCreation.vue 변경

- 현재: 게이트웨이 선택 체크박스 (기존 구현 유지)
- 변경: 없음 (이미 올바른 구조)

### 4-5. Devices.vue + 메뉴 제거

- `router/index.ts`: `/devices` 라우트 삭제
- `App.vue`: 사이드바 "장치 관리" 메뉴 항목 제거
- 기존 `Devices.vue` 파일 삭제

---

## 5. API 변경 요약

### 신규 API

| Method | Path | 설명 |
|--------|------|------|
| PATCH | `/api/gateways/:id/zone` | 게이트웨이 구역 할당/해제 |
| GET | `/api/gateway-env/:id/all-devices` | 온보드+지그비 통합 조회 |

### 변경 API

| Method | Path | 변경 내용 |
|--------|------|---------|
| GET | `/api/gateways` | 응답에 `groupId`, `groupName` 추가 |
| GET | `/api/groups` | `devices` 관계 → gateway 기반 장치로 대체 |

### Deprecated API

| Method | Path | 대체 |
|--------|------|------|
| POST | `/api/devices` | `POST /api/gateway-env/:id/zigbee` |
| DELETE | `/api/devices/:id` | `DELETE /api/gateway-env/:id/zigbee/:id` |
| PATCH | `/api/devices/:id` | `PATCH /api/gateway-env/:id/zigbee/:id` |

---

## 6. DB 마이그레이션

### 6-1. `gateway_onboard_devices` 슬롯 변경

```sql
-- 기존 opener_* 슬롯 삭제
DELETE FROM gateway_onboard_devices WHERE slot_key LIKE 'opener_%';

-- fan_4 추가 (게이트웨이별로 없는 경우)
INSERT INTO gateway_onboard_devices (id, gateway_id, slot_key, slot_type, name, enabled, sort_order)
SELECT gen_random_uuid(), id, 'fan_4', 'fan', '유동팬 4번', true, 4
FROM gateways
WHERE id NOT IN (
  SELECT gateway_id FROM gateway_onboard_devices WHERE slot_key = 'fan_4'
);

-- zone_5, zone_6, zone_7 추가
-- (각각 동일 패턴으로)

-- sort_order 재정렬 (fan 1-4 → remote_control → fertilizer → zone 1-7 → mixer → motor)
```

### 6-2. `group_devices` 조인 테이블

- 즉시 삭제하지 않음 (기존 데이터 보존)
- `HouseGroup.devices` 관계를 코드에서 제거 → 테이블은 유지
- 추후 데이터 안정화 후 DROP TABLE

### 6-3. `gateways.house_id` 유니크 제약

```sql
-- 한 gateway는 하나의 house에만 속할 수 있음
ALTER TABLE gateways ADD CONSTRAINT gateways_house_id_unique UNIQUE (house_id);
```

---

## 7. 구현 순서 (Phase별)

### Phase 1: 온보드 슬롯 변경 + 구역 할당 API (백엔드)

1. `gateway-env.service.ts` DEFAULT_SLOTS 15개로 변경
2. DB 마이그레이션 스크립트 실행
3. `gateway-manager.service.ts` `PATCH /:id/zone` API 추가
4. `gateway-manager.service.ts` `getAll()` 응답에 groupId/groupName 추가

### Phase 2: 게이트웨이 페이지 UI (프론트엔드)

1. `GatewayManagement.vue` — 구역 할당 드롭다운 추가
2. `GatewayManagement.vue` — 환경설정 버튼 경로 수정 (`/gateways/:id/env`)
3. `gateway.api.ts` — `assignZone(gatewayId, groupId)` 메서드 추가

### Phase 3: 환경 설정 페이지 온보드 섹션 리빌드 (프론트엔드)

1. `GatewayEnvSettings.vue` — 온보드 슬롯 15개 레이아웃 재구성
2. 팬 섹션 / 관주 섹션 그룹핑
3. 온보드 관주 채널 표시 (뱃지, 고정값)

### Phase 4: 구역 페이지 장치 표시 리빌드 (프론트엔드)

1. `Groups.vue` — 게이트웨이 카드 섹션 제거
2. `Groups.vue` — 측정기/장치/룰 통합 표시
3. 장치 ON/OFF 토글 기능
4. 자동제어 룰 값 편집 UI

### Phase 5: 장치 관리 페이지 제거

1. `router/index.ts` — `/devices` 라우트 제거
2. `App.vue` — 사이드바 메뉴 제거
3. `Devices.vue` 파일 삭제

---

## 8. 컴포넌트/파일 목록

### 수정 파일

| 파일 | 변경 내용 |
|------|---------|
| `backend/src/modules/gateway-env/gateway-env.service.ts` | DEFAULT_SLOTS 15개 변경, all-devices API |
| `backend/src/modules/gateway-env/gateway-env.controller.ts` | all-devices 엔드포인트 추가 |
| `backend/src/modules/gateway-manager/gateway-manager.service.ts` | zone 할당 API, getAll groupName 포함 |
| `backend/src/modules/gateway-manager/gateway-manager.controller.ts` | PATCH /:id/zone 엔드포인트 |
| `backend/src/modules/groups/groups.service.ts` | devices 관계 제거, gateway 기반 장치 조회 |
| `backend/src/modules/groups/entities/house-group.entity.ts` | ManyToMany devices 관계 제거 |
| `frontend/src/views/GatewayManagement.vue` | 구역 할당 드롭다운 추가 |
| `frontend/src/views/GatewayEnvSettings.vue` | 온보드 15개 슬롯 레이아웃 |
| `frontend/src/views/Groups.vue` | 게이트웨이 섹션 제거, 장치/측정기/룰 표시 |
| `frontend/src/api/gateway.api.ts` | assignZone 메서드 추가 |
| `frontend/src/router/index.ts` | /devices 라우트 제거 |
| `frontend/src/App.vue` | 사이드바 장치 메뉴 제거 |

### 삭제 파일

| 파일 | 사유 |
|------|------|
| `frontend/src/views/Devices.vue` | 장치 관리 페이지 제거 |

---

## 9. 위험 요소 및 완화 방안

| 위험 | 완화 |
|------|------|
| 기존 opener_* onboard 데이터 손실 | 삭제 전 백업 SQL 작성 |
| group_devices 테이블 즉시 삭제 시 기존 데이터 손실 | 코드에서만 제거, 테이블 보존 |
| 구역 할당 변경 시 기존 houseId 관계 파괴 | 할당 해제 시 house record는 보존, house_id만 null |
| 장치 관리 페이지 제거 시 사용자 혼란 | 안내 메시지로 환경 설정 페이지 유도 |
