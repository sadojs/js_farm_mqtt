# Plan: 플랫폼 관리자 농장·구역 통합 관리 기능

## 기능 개요

플랫폼 관리자(admin)가 농장 관리자 계정 생성부터 게이트웨이 등록, 구역 생성·할당까지
전체 온보딩 워크플로를 관리자 화면에서 직접 완결할 수 있도록 기능을 확장한다.

---

## 배경 및 문제 정의

### 현재 상태

| 기능 | admin | farm_admin | 구현 상태 |
|------|:-----:|:----------:|----------|
| 농장 관리자 계정 생성 | ✅ | - | 구현됨 (UserManagement) |
| 게이트웨이 등록 + 농장 할당 | ✅ | ✅ | 구현됨 (GatewayManagement) |
| 농장(그룹) 생성 | ❌ | ✅ | admin 미지원 |
| 구역(house) 생성 | ❌ | ✅ | admin 미지원 |
| 구역에 게이트웨이 할당 | ❌ | ✅ | admin 미지원 |
| 전체 농장·구역 조회 | ✅ | 본인것만 | 조회는 가능, 수정 불가 |

### 핵심 문제

- `groups.service.ts` 의 `createGroup` / `createHouse` / `assignGatewayToGroup` 이
  `userId` 를 farm_admin 자신으로 고정하여, admin이 다른 계정 소유 농장에 구역을 생성할 수 없음
- admin이 구역관리 페이지(`Groups.vue`)에 접근해도 자신이 생성한 house만 보이고
  편집 UI가 farm_admin 기준으로만 설계되어 있음

---

## 요구사항

### 이미 구현된 기능 (검증만 필요)

**R-01** 농장 관리자 계정 생성 시 농장 이름 지정  
- 현재: `UserManagement.vue` → `POST /api/users` → `users.farmName` 컬럼 유무 확인 필요
- 검증 포인트: users 테이블에 farmName 컬럼이 없고 `name` 필드로 대체되고 있음
  → 농장 이름 = 사용자 이름(`name`) 또는 별도 컬럼 추가 여부 결정 필요

**R-02** 게이트웨이 등록 후 소유 농장(farm_admin) 지정  
- 현재: `gateways.user_id` 로 소유자 지정
- 검증 포인트: admin이 게이트웨이 생성 시 다른 farm_admin을 owner로 지정할 수 있는지

### 신규 구현 필요

**R-03** 관리자 농장·구역 관리 페이지 (별도 페이지로 분리)  
- 기존 `Groups.vue` (farm_admin / farm_user 전용)는 수정하지 않는다
- 신규 `AdminFarmManagement.vue` 페이지를 admin 전용으로 추가한다
- 접근: 사이드바 메뉴 "농장 관리" (admin에게만 노출)

**R-04** 전체 농장·구역 조회  
- 모든 farm_admin 소유 house_groups + houses를 소유자 정보와 함께 표시
- 소유자 이름, 계정, 구역 수, 게이트웨이 할당 현황을 한눈에 파악

**R-05** 농장(house_group) 생성  
- admin이 특정 farm_admin을 선택하여 그 소유의 농장 생성
- 생성된 house_group.user_id = 선택한 farm_admin.id

**R-06** 구역(house) 생성 및 농장에 추가  
- 선택한 farm_admin + house_group 아래 house 추가
- house.user_id = 선택한 farm_admin.id

**R-07** 구역에 게이트웨이 할당  
- 해당 farm_admin 소유 게이트웨이 목록에서 선택하여 house에 연결
- 기존 `assignGatewayToGroup` 로직을 admin도 사용 가능하도록 권한 확장

---

## UI/UX 설계 방향

### 페이지 구조: 2-패널 레이아웃

```
┌─────────────────────────────────────────────────────────────────┐
│  농장 관리 (플랫폼 관리자 전용)              [+ 농장 추가]       │
├──────────────┬──────────────────────────────────────────────────┤
│              │                                                  │
│  농장 목록   │  선택된 농장 상세 / 구역 목록                    │
│  (좌측 패널) │  (우측 패널)                                     │
│              │                                                  │
│  ▶ ohgane농장│  ┌─────────────────────────────────────────┐    │
│    (mtest)   │  │ ohgane농장          소유자: mtest         │    │
│              │  │                          [구역 추가] [편집]│    │
│  ▶ test2농장 │  ├─────────────────────────────────────────┤    │
│    (mtest2)  │  │ 1동    게이트웨이: lgw-dev   [할당변경]   │    │
│              │  │ 2동    게이트웨이: 미할당    [할당]        │    │
│  [+ 농장추가]│  │ 3동    게이트웨이: 미할당    [할당]        │    │
│              │  └─────────────────────────────────────────┘    │
└──────────────┴──────────────────────────────────────────────────┘
```

### 워크플로 (신규 농장 온보딩)

```
① 사이드바 "농장 관리" 클릭
② [+ 농장 추가] → 소유자(farm_admin) 선택 + 농장명 입력 → 저장
③ 농장 카드 클릭 → 우측 패널에서 [구역 추가] → 구역명 입력 → 저장
④ 구역 행의 [할당] → 소유자의 게이트웨이 목록 드롭다운 → 선택 → 저장
```

### 고려 사항

- farm_admin 계정이 없는 경우: "먼저 농장 관리자 계정을 생성하세요" 안내 + 링크
- 게이트웨이가 이미 다른 구역에 할당된 경우: 경고 표시 (충돌 방지)
- farm_admin 본인도 자신의 농장/구역은 기존 페이지에서 편집 가능 (권한 분리 유지)

---

## 구현 범위

### Backend

| 항목 | 파일 | 변경 내용 |
|------|------|----------|
| 전체 users 조회 (farm_admin only) | `users.controller.ts` | admin용 `GET /api/users?role=farm_admin` |
| groups admin 생성 | `groups.controller.ts` | `POST /api/groups` body에 `targetUserId` 수용 |
| groups service 권한 확장 | `groups.service.ts` | admin이 타 userId로 group/house 생성 허용 |
| houses admin 생성 | `groups.service.ts` | createHouse에 targetUserId 지원 |
| gateway 할당 권한 확장 | `groups.service.ts` | admin이 타 user의 gateway를 house에 할당 가능 |
| 전체 groups 조회 개선 | `groups.service.ts` | findAllGroups에 소유자 정보(user) 포함 |

### Frontend

| 항목 | 파일 | 변경 내용 |
|------|------|----------|
| 신규 뷰 | `AdminFarmManagement.vue` | admin 전용 2-패널 농장·구역 관리 페이지 |
| API 레이어 | `group.api.ts` | admin 전용 API 호출 함수 추가 |
| 라우터 | `router/index.ts` | `/admin/farms` 경로 추가 (requiresAdmin) |
| 사이드바 | `App.vue` 또는 Layout | "농장 관리" 메뉴 admin 전용 노출 |

---

## 비고

- `Groups.vue` (기존 구역관리 페이지)는 **수정하지 않는다** — farm_admin / farm_user 경험 유지
- 데이터는 공유: admin이 생성한 구역은 farm_admin 페이지에서도 동일하게 보임
- 추후 구역별 권한 이양 기능(admin → farm_admin 소유 이전)은 별도 계획으로 분리

---

## 예상 작업량

- Backend: 2~3시간 (권한 확장 중심, 신규 엔드포인트 최소화)
- Frontend: 4~5시간 (신규 페이지 UI 구현)
- 합계: 약 7~8시간
