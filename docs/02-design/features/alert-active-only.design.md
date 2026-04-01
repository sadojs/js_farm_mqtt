# Design: 센서 알림 - 활성 알림만 표시

> Plan 참조: `docs/01-plan/features/alert-active-only.plan.md`
> 참조: smart-farm-platform 동일 기능과 일치시킴

## 1. Backend 변경

### 1.1 Controller (`sensor-alerts.controller.ts`)

변경 없음 — 기존 `resolved` 파라미터 로직 유지.
프론트엔드에서 항상 `resolved=false`로 요청하여 미해결 알림만 가져옴.

## 2. Frontend 변경

### 2.1 Alerts View (`views/Alerts.vue`)

#### 2.1.1 기본 필터값

```typescript
const filter = ref('unresolved')
```

#### 2.1.2 필터 옵션 (3개 — platform과 동일)

```typescript
const filterOptions = [
  { label: '전체 (미해결)', value: 'unresolved' },
  { label: '심각', value: 'critical' },
  { label: '경고', value: 'warning' },
]
```

- 해결됨/전체 필터 제거 — 해결된 알림은 조회할 필요 없음

#### 2.1.3 loadAlerts() — 항상 미해결만 요청

```typescript
const res = await sensorAlertsApi.getAlerts({ resolved: 'false' })
```

#### 2.1.4 filteredAlerts — severity만 클라이언트 필터

```typescript
const filteredAlerts = computed(() => {
  switch (filter.value) {
    case 'critical': return visibleAlerts.value.filter(a => a.severity === 'critical')
    case 'warning': return visibleAlerts.value.filter(a => a.severity === 'warning')
    default: return visibleAlerts.value
  }
})
```

#### 2.1.5 unresolvedCount

```typescript
const unresolvedCount = computed(() => visibleAlerts.value.filter(a => !a.resolved).length)
```

#### 2.1.6 watch(filter) 불필요

서버 재요청 없이 클라이언트에서 severity만 필터하므로 `watch` 제거.

---

## 3. 수정 파일 체크리스트

| # | 파일 | 변경 |
|---|------|------|
| 1 | `frontend/src/views/Alerts.vue` | 필터 옵션 3개, loadAlerts resolved=false, filteredAlerts severity 필터 |

## 4. smart-farm-platform과의 일치 확인

| 항목 | platform | mqtt (수정 후) |
|------|----------|---------------|
| 기본 필터 | `unresolved` | `unresolved` |
| 필터 옵션 | 3개 | 3개 |
| loadAlerts | `{ resolved: 'false' }` | `{ resolved: 'false' }` |
| filteredAlerts | severity만 필터 | severity만 필터 |
| Backend Controller | 원본 유지 | 원본 유지 |
