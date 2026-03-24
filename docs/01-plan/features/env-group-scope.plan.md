# Plan: 환경 모니터링 그룹 스코프 고정 (env-group-scope)

## 메타

| 항목 | 내용 |
|------|------|
| Feature | env-group-scope |
| Phase | Plan |
| 작성일 | 2026-03-01 |
| 우선순위 | High (데이터 무결성 — 잘못된 그룹 데이터 표시) |

---

## 배경 및 현재 문제

### 핵심 버그

홍길동 농장에 **연동 하우스** 신규 그룹을 생성하고 센서 장비 1개를 할당했으나,
환경설정(env_mappings)을 하지 않은 상태에서도 **석문리 하우스의 센서 데이터**가
환경 모니터링 창 및 리포트에 표시되는 문제.

### 원인 분석 (코드 직접 확인)

#### 원인 1 — Sensors.vue MonitoringWidgets 글로벌 데이터 (메인 버그)

```
Sensors.vue
  └─ onMounted() → fetchWidgetData()
       └─ dashboardApi.getWidgets()   ← GET /dashboard/widgets (userId만 파라미터)

DashboardService.getWidgetData(userId)
  └─ devicesRepo.find({ userId, category: Like('%qxj%') })
       ← 사용자의 모든 qxj 센서를 가져옴 (그룹 무관)
  └─ 조회 결과로 MonitoringWidgets를 모든 그룹에 동일하게 표시
```

- `widgetData`는 **단 1개** ref. 모든 그룹을 펼칠 때 동일한 데이터를 사용
- 석문리 하우스에 qxj 센서가 있으면 → 연동 하우스를 펼쳐도 석문리 데이터 노출
- `env_mappings` 전혀 참조하지 않음

#### 원인 2 — 그룹에 env_mappings 미설정 시 처리 없음

`EnvConfigService.getResolved(userId, groupId)`:
- 매핑 없으면 `value: null, source: '미설정'` 반환 (정상)
- 하지만 Sensors.vue는 `getResolved`를 호출하지 않음 → MonitoringWidgets에서 대체 데이터(전체 qxj) 사용

#### 원인 3 — Reports.vue 기본값 문제 (보조)

- 기본 선택값이 `selectedGroup = ''` (전체 그룹)
- 전체 그룹 선택 시 모든 사용자 센서 데이터 표시
- 연동 하우스를 명시적으로 선택하면 정상 필터링됨 (백엔드 OK)
- 문제: 새 그룹의 센서는 env_mappings가 없어도 sensor_data가 있으면 차트에 표시됨

---

## 기대 동작

```
환경 모니터링 (Sensors.vue) — 그룹 확장 시:
  env_mappings 있음 → getResolved(groupId) 기반 데이터 표시
  env_mappings 없음 → "환경 설정이 필요합니다" 플레이스홀더 표시
                       [그룹 관리 > 환경설정으로 이동] 링크

리포트 (Reports.vue) — 그룹 선택 시:
  그룹 선택 시 → 해당 그룹의 env_mappings 기반 센서만 차트 표시
  env_mappings 없는 그룹 선택 → "환경 설정 필요" 안내 표시
```

---

## 전략

### 채택: getResolved(groupId) 기반으로 Sensors.vue 재설계

| 방식 | 설명 | 채택 |
|------|------|:----:|
| getWidgetData에 groupId 추가 | qxj 필터 → 그룹 내 qxj만 | ❌ env_mappings 무시, 구조적 문제 |
| **getResolved(groupId) 활용** | 사용자가 직접 설정한 매핑 기준 | ✅ |

**채택 이유:**
- `env_mappings`는 사용자가 "이 그룹의 환경 기준 센서"를 명시적으로 설정한 것
- 설정하지 않은 그룹은 데이터 없음이 맞는 동작
- `getResolved`는 이미 완성된 API이며 그룹 스코프가 명확

---

## UX 흐름 설계

### 환경 모니터링 — 그룹 확장 시

```
그룹 헤더 클릭 (▼ 확장)
    ↓
GET /env-config/groups/:groupId/resolved 호출 (그룹별 개별 호출)
    ↓
┌───────────────────────────────────────────────┐
│  env_mappings 있음        env_mappings 없음   │
│         ↓                        ↓            │
│  ResolvedEnvPanel 표시     "환경 설정 필요"   │
│  (역할별 센서값 카드)       플레이스홀더 표시  │
│                            [⚙ 환경 설정하기]  │
│                            버튼 → Groups.vue  │
└───────────────────────────────────────────────┘
```

### ResolvedEnvPanel UI (env_mappings 있는 그룹)

```
┌─────────────────────────────────────────┐
│ [내부 환경]                              │
│  🌡 실내 온도    25.3 °C  ● 온습도센서 A │
│  💧 실내 습도    68 %     ● 온습도센서 A │
│  🌫 CO2         1,250 ppm ● CO2센서     │
│                                         │
│ [외부 환경]                              │
│  🌡 외부 온도    8.2 °C   ● 기상청 날씨  │
│  💧 외부 습도    45 %     ● 기상청 날씨  │
└─────────────────────────────────────────┘
```

### 환경 설정 미설정 시 플레이스홀더 UI

```
┌─────────────────────────────────────────┐
│  ⚙ 환경 설정이 필요합니다               │
│                                         │
│  이 그룹의 센서 역할 매핑을 설정하면    │
│  실시간 환경 데이터를 확인할 수 있습니다 │
│                                         │
│         [그룹 환경 설정하기 →]          │
└─────────────────────────────────────────┘
```

### 리포트 — 그룹 선택 시

```
그룹 선택 드롭다운에서 특정 그룹 선택
    ↓
getResolved(groupId) 호출 → env_mappings 확인
    ↓
┌──────────────────────────────────────────┐
│  env_mappings 있음   env_mappings 없음   │
│         ↓                   ↓            │
│  매핑된 센서 기준       "환경 설정 필요" │
│  차트 데이터 표시       안내 메시지 표시 │
│  (기존 동작 유지)                        │
└──────────────────────────────────────────┘
```

---

## 기능 요구사항

### 프론트엔드

#### FR-01: Sensors.vue — 그룹별 getResolved 호출
- 그룹 확장(`toggleGroup`) 시 `envConfigApi.getResolved(groupId)` 호출
- 결과를 `resolvedByGroup: Record<string, Record<string, ResolvedValue>>` ref에 저장
- 로딩 중에는 스켈레톤 표시

#### FR-02: Sensors.vue — MonitoringWidgets 대신 ResolvedEnvPanel 표시
- 기존 `<MonitoringWidgets :widget-data="widgetData">` → `<ResolvedEnvPanel>` 로 교체
- `ResolvedEnvPanel`은 `resolved: Record<string, ResolvedValue>` prop을 받아 역할별 카드 표시

#### FR-03: Sensors.vue — env_mappings 미설정 시 플레이스홀더
- `getResolved` 결과 모든 값이 `source === '미설정'` → 플레이스홀더 표시
- `[그룹 환경 설정하기]` 버튼 → `router.push('/groups')` (또는 Groups.vue ⚙ 버튼 직접 트리거 방법 모색)

#### FR-04: Reports.vue — 그룹 선택 시 env_mappings 확인
- `selectedGroup` watch에서 `envConfigApi.getResolved(groupId)` 호출
- 모든 값이 `source === '미설정'` → "환경 설정이 필요합니다" 배너 표시 (데이터 조회 진행은 유지)

#### FR-05: ResolvedEnvPanel 컴포넌트 신규 생성
- `resolved` prop: `Record<string, ResolvedValue>`
- internal / external 섹션으로 분류 (`category` 필드 기준)
- 각 역할: 아이콘 + 라벨 + 값 + 단위 + 소스명 표시
- 값이 null인 경우 `—` 표시 (데이터 수집 중)

### 백엔드

- 변경 없음 (기존 `GET /env-config/groups/:groupId/resolved` 사용)

---

## 범위 제외 (Out of Scope)

- MonitoringWidgets (VPD/환기스코어 등 계산 위젯) 제거 — 별도 판단 필요
- getWidgetData API 변경 — 대시보드 페이지는 그대로 유지
- env_mappings 없는 그룹에서 강제로 센서 데이터 표시

---

## 수정 대상 파일

| 파일 | 변경 유형 | 내용 |
|------|-----------|------|
| `views/Sensors.vue` | 수정 | `toggleGroup` 시 `getResolved(groupId)` 호출, `resolvedByGroup` ref, MonitoringWidgets 교체 |
| `components/dashboard/ResolvedEnvPanel.vue` | 신규 | 역할별 카드 UI, internal/external 섹션, 미설정 플레이스홀더 |
| `views/Reports.vue` | 수정 | 그룹 선택 시 env_mappings 미설정 배너 |

---

## 성공 기준

- 환경 모니터링에서 연동 하우스 확장 시 "환경 설정이 필요합니다" 표시
- 환경 모니터링에서 석문리 하우스 확장 시 해당 그룹의 env_mappings 기반 데이터만 표시
- 리포트에서 env_mappings 미설정 그룹 선택 시 안내 배너 표시
- 각 그룹의 데이터가 다른 그룹 데이터와 섞이지 않음
