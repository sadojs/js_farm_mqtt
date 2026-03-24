# Design: 환경 모니터링 그룹 스코프 고정 (env-group-scope)

## 메타

| 항목 | 내용 |
|------|------|
| Feature | env-group-scope |
| Phase | Design |
| 작성일 | 2026-03-01 |
| Plan 참조 | `docs/01-plan/features/env-group-scope.plan.md` |

---

## 아키텍처 개요

### 핵심 원칙

1. **그룹별 스코프 분리**: 환경 모니터링은 반드시 해당 그룹의 `env_mappings` 기반으로만 데이터 표시
2. **env_mappings 미설정 = 데이터 없음**: 사용자가 명시적으로 설정하지 않은 그룹은 빈 상태 표시
3. **백엔드 변경 없음**: 기존 `GET /env-config/groups/:groupId/resolved` API 재활용

### 변경 범위

| 파일 | 변경 | 내용 |
|------|------|------|
| `Sensors.vue` | 수정 | 그룹 확장 시 getResolved 호출, MonitoringWidgets→ResolvedEnvPanel 교체 |
| `ResolvedEnvPanel.vue` | **신규** | 역할별 env 데이터 카드 컴포넌트 |
| `Reports.vue` | 수정 | 그룹 선택 시 env_mappings 미설정 배너 |

---

## 데이터 구조

### ResolvedValue (기존 타입 — 변경 없음)

```typescript
// frontend/src/api/env-config.api.ts (기존)
export interface ResolvedValue {
  value: number | null
  unit: string
  label: string
  category: string       // 'internal' | 'external'
  source: string         // 장비명/sensorType 또는 '기상청 날씨' 또는 '미설정'
  updatedAt: string | null
}
```

### Sensors.vue 상태 변경

```typescript
// 추가할 상태
const resolvedByGroup = ref<Record<string, Record<string, ResolvedValue> | null>>({})
// groupId → resolved 데이터 (null = 로딩 중 또는 에러)

const loadingResolvedFor = ref<Set<string>>(new Set())
// 현재 로딩 중인 groupId 집합

// 제거할 상태
// const widgetData = ref<WidgetDataResponse | null>(null)   ← 제거
// const weatherData = ref<...> = null                      ← 제거
// const widgetLoading = ref(false)                         ← 제거
```

### env_mappings 설정 여부 판별

```typescript
// 모든 역할이 '미설정'이면 → 환경 설정 없음
function isEnvConfigured(groupId: string): boolean {
  const resolved = resolvedByGroup.value[groupId]
  if (!resolved) return false
  return Object.values(resolved).some(r => r.source !== '미설정')
}
```

---

## 컴포넌트 상세 설계

### 신규: ResolvedEnvPanel.vue

**경로**: `frontend/src/components/dashboard/ResolvedEnvPanel.vue`

#### Props

```typescript
interface Props {
  resolved: Record<string, ResolvedValue>
}
```

#### 역할 아이콘 매핑

```typescript
const ROLE_ICONS: Record<string, string> = {
  indoor_temperature:  '🌡',
  indoor_humidity:     '💧',
  co2:                 '🌫',
  uv:                  '☀️',
  rainfall:            '🌧',
  outdoor_temperature: '🌡',
  outdoor_humidity:    '💧',
  wind_speed:          '💨',
}
// fallback: '📊'
```

#### Computed

```typescript
const internalItems = computed(() =>
  Object.entries(resolved).filter(([, v]) => v.category === 'internal')
)
const externalItems = computed(() =>
  Object.entries(resolved).filter(([, v]) => v.category === 'external')
)
```

#### 렌더 로직

- `value !== null` → 값 표시 (소수점 1자리 / 정수)
- `value === null` && `source !== '미설정'` → `—` 표시 (데이터 수집 중)
- `source === '미설정'` → `미설정` 텍스트 (dim 스타일)

#### 카드 레이아웃 (내부 환경 / 외부 환경 섹션)

```
┌─────────────────────────────────────────────────┐
│ [내부 환경]                                       │
│  🌡  실내 온도    25.3 °C     ● 온습도센서 A     │
│  💧  실내 습도    68 %        ● 온습도센서 A     │
│  🌫  CO2         1,250 ppm   ● CO2센서           │
│  ☀️  UV           3           ● 온습도센서 A     │
│                                                   │
│ [외부 환경]                                       │
│  🌡  외부 온도    8.2 °C      ● 기상청 날씨      │
│  💧  외부 습도    45 %        ● 기상청 날씨      │
│  💨  풍속         2.1 m/s     ● 기상청 날씨      │
└─────────────────────────────────────────────────┘
```

---

### 수정: Sensors.vue

#### 그룹 확장 흐름 (수정된 toggleGroup)

```typescript
async function toggleGroup(groupId: string) {
  if (expandedGroups.value.has(groupId)) {
    expandedGroups.value.delete(groupId)
  } else {
    expandedGroups.value.add(groupId)
    // 캐시 없으면 fetch
    if (!(groupId in resolvedByGroup.value) && !loadingResolvedFor.value.has(groupId)) {
      loadingResolvedFor.value.add(groupId)
      try {
        const { data } = await envConfigApi.getResolved(groupId)
        resolvedByGroup.value = { ...resolvedByGroup.value, [groupId]: data }
      } catch {
        resolvedByGroup.value = { ...resolvedByGroup.value, [groupId]: null }
      } finally {
        loadingResolvedFor.value.delete(groupId)
      }
    }
  }
}
```

#### 그룹 section 템플릿 변경

```html
<!-- Before: MonitoringWidgets (전체 qxj 글로벌 데이터) -->
<div v-if="expandedGroups.has(group.id)" class="group-widgets">
  <MonitoringWidgets :widget-data="widgetData" ... />
</div>

<!-- After: ResolvedEnvPanel (그룹별 env_mappings 기반 데이터) -->
<div v-if="expandedGroups.has(group.id)" class="group-widgets">
  <!-- 로딩 중 -->
  <div v-if="loadingResolvedFor.has(group.id)" class="env-loading">
    환경 데이터 불러오는 중...
  </div>
  <!-- env_mappings 설정된 경우 -->
  <ResolvedEnvPanel
    v-else-if="isEnvConfigured(group.id) && resolvedByGroup[group.id]"
    :resolved="resolvedByGroup[group.id]"
  />
  <!-- env_mappings 미설정 -->
  <div v-else class="env-config-placeholder">
    <span class="placeholder-icon">⚙</span>
    <p class="placeholder-title">환경 설정이 필요합니다</p>
    <p class="placeholder-desc">이 그룹의 센서 역할 매핑을 설정하면 실시간 환경 데이터를 확인할 수 있습니다.</p>
    <router-link to="/groups" class="btn-config">그룹 환경 설정하기 →</router-link>
  </div>
</div>
```

#### 제거되는 요소들

```typescript
// 제거
import MonitoringWidgets from '@/components/dashboard/MonitoringWidgets.vue'
import { dashboardApi } from '@/api/dashboard.api'
import type { WidgetDataResponse } from '@/api/dashboard.api'

const widgetData = ref<WidgetDataResponse | null>(null)
const weatherData = ref<...>(null)
const widgetLoading = ref(false)

async function fetchWidgetData() { ... }

// WebSocket 핸들러에서 fetchWidgetData() 호출 제거
function handleSensorUpdate() {
  // fetchWidgetData() 제거 — env 데이터는 별도 새로고침
  deviceStore.fetchAllSensorStatuses()
}
```

#### 추가되는 요소들

```typescript
// 추가
import { envConfigApi } from '@/api/env-config.api'
import type { ResolvedValue } from '@/api/env-config.api'
import ResolvedEnvPanel from '@/components/dashboard/ResolvedEnvPanel.vue'
import { useRouter } from 'vue-router'

const router = useRouter()
const resolvedByGroup = ref<Record<string, Record<string, ResolvedValue> | null>>({})
const loadingResolvedFor = ref<Set<string>>(new Set())

function isEnvConfigured(groupId: string): boolean {
  const resolved = resolvedByGroup.value[groupId]
  if (!resolved) return false
  return Object.values(resolved).some(r => r.source !== '미설정')
}
```

#### onMounted 정리

```typescript
onMounted(async () => {
  await Promise.all([
    groupStore.fetchGroups(),
    deviceStore.fetchDevices(),
    // fetchWidgetData() ← 제거
  ])
  await deviceStore.fetchAllSensorStatuses()
  for (const g of sensorGroups.value) {
    expandedGroups.value.add(g.id)
    // 확장된 그룹들의 resolved 데이터 초기 로딩
    if (!(g.id in resolvedByGroup.value)) {
      loadingResolvedFor.value.add(g.id)
      envConfigApi.getResolved(g.id)
        .then(({ data }) => {
          resolvedByGroup.value = { ...resolvedByGroup.value, [g.id]: data }
        })
        .catch(() => {
          resolvedByGroup.value = { ...resolvedByGroup.value, [g.id]: null }
        })
        .finally(() => {
          loadingResolvedFor.value.delete(g.id)
        })
    }
  }
  loading.value = false
  on('sensor:update', handleSensorUpdate)
})
```

---

### 수정: Reports.vue

#### 추가 상태

```typescript
import { envConfigApi } from '../api/env-config.api'

const envWarning = ref(false)
```

#### selectedGroup watch 수정

```typescript
watch(selectedGroup, async (newGroupId) => {
  if (!newGroupId) {
    envWarning.value = false
    return
  }
  try {
    const { data: resolved } = await envConfigApi.getResolved(newGroupId)
    const allUnmapped = Object.values(resolved).every(r => r.source === '미설정')
    envWarning.value = allUnmapped
  } catch {
    envWarning.value = false
  }
  // 기존 데이터 조회도 함께 진행 (updateDateRange 호출)
  updateDateRange(dateRange.value)
})
```

#### 템플릿 — 배너 추가

```html
<!-- filter-section 바로 아래, 로딩 표시 위에 추가 -->
<div v-if="envWarning" class="env-warning-banner">
  <span>⚠️</span>
  <span>이 그룹은 환경 설정(센서 매핑)이 되어 있지 않습니다.
    <router-link to="/groups">그룹 관리에서 환경 설정</router-link>을 먼저 진행해 주세요.
  </span>
</div>
```

#### CSS

```css
.env-warning-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  background: var(--warning-bg, rgba(255, 152, 0, 0.1));
  border: 1px solid var(--warning, #ff9800);
  border-radius: 8px;
  color: var(--text-primary);
  font-size: 14px;
  margin-bottom: 16px;
}
.env-warning-banner a {
  color: var(--accent);
  font-weight: 600;
}
```

---

## ResolvedEnvPanel.vue — 전체 구조

```vue
<template>
  <div class="resolved-env-panel">
    <!-- 내부 환경 섹션 -->
    <div v-if="internalItems.length > 0" class="env-section">
      <h4 class="env-section-title">내부 환경</h4>
      <div class="env-grid">
        <div v-for="[key, item] in internalItems" :key="key" class="env-item">
          <span class="env-icon">{{ ROLE_ICONS[key] ?? '📊' }}</span>
          <div class="env-info">
            <span class="env-label">{{ item.label }}</span>
            <span :class="['env-value', item.source === '미설정' ? 'unmapped' : '']">
              {{ formatValue(item) }}
              <span v-if="item.value !== null" class="env-unit">{{ item.unit }}</span>
            </span>
          </div>
          <span class="env-source">{{ item.source }}</span>
        </div>
      </div>
    </div>

    <!-- 외부 환경 섹션 -->
    <div v-if="externalItems.length > 0" class="env-section">
      <h4 class="env-section-title">외부 환경</h4>
      <div class="env-grid">
        <div v-for="[key, item] in externalItems" :key="key" class="env-item">
          <span class="env-icon">{{ ROLE_ICONS[key] ?? '📊' }}</span>
          <div class="env-info">
            <span class="env-label">{{ item.label }}</span>
            <span :class="['env-value', item.source === '미설정' ? 'unmapped' : '']">
              {{ formatValue(item) }}
              <span v-if="item.value !== null" class="env-unit">{{ item.unit }}</span>
            </span>
          </div>
          <span class="env-source">{{ item.source }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { ResolvedValue } from '@/api/env-config.api'

const props = defineProps<{ resolved: Record<string, ResolvedValue> }>()

const ROLE_ICONS: Record<string, string> = {
  indoor_temperature: '🌡', indoor_humidity: '💧', co2: '🌫',
  uv: '☀️', rainfall: '🌧', outdoor_temperature: '🌡',
  outdoor_humidity: '💧', wind_speed: '💨',
}

const internalItems = computed(() =>
  Object.entries(props.resolved).filter(([, v]) => v.category === 'internal')
)
const externalItems = computed(() =>
  Object.entries(props.resolved).filter(([, v]) => v.category === 'external')
)

function formatValue(item: ResolvedValue): string {
  if (item.source === '미설정') return '미설정'
  if (item.value === null) return '—'
  const n = Number(item.value)
  return ['co2'].includes(item.unit) ? Math.round(n).toLocaleString() : n.toFixed(1)
}
</script>
```

---

## 구현 순서 (4 Phase, 10 Step)

### Phase 1 — ResolvedEnvPanel 컴포넌트 신규 생성
- Step 1: `ResolvedEnvPanel.vue` 생성 (template + script + style)
- Step 2: ROLE_ICONS, formatValue, internalItems/externalItems 구현

### Phase 2 — Sensors.vue 수정 (핵심)
- Step 3: `import` 교체 (MonitoringWidgets/dashboardApi 제거 → envConfigApi/ResolvedEnvPanel/useRouter 추가)
- Step 4: 상태 변경 (widgetData/weatherData/widgetLoading 제거 → resolvedByGroup/loadingResolvedFor 추가)
- Step 5: `toggleGroup` 수정 (async, getResolved 호출 추가)
- Step 6: `isEnvConfigured` 함수 추가
- Step 7: 템플릿 수정 (MonitoringWidgets → ResolvedEnvPanel/placeholder 교체)
- Step 8: `onMounted` 수정 (fetchWidgetData 제거, 초기 resolved 로딩 추가)
- Step 9: WebSocket 핸들러 정리 (fetchWidgetData 제거)

### Phase 3 — Reports.vue 수정 (보조)
- Step 10: `envWarning` 상태 + `selectedGroup` watch + 배너 템플릿 추가

### Phase 4 — 빌드 검증
- `vue-tsc --noEmit` + `vite build` 에러 없음 확인

---

## 검증 항목 (12개)

| # | 항목 | 기준 |
|---|------|------|
| 1 | ResolvedEnvPanel — internal 섹션 렌더 | category=internal 항목만 표시 |
| 2 | ResolvedEnvPanel — external 섹션 렌더 | category=external 항목만 표시 |
| 3 | ResolvedEnvPanel — value 포맷 | null→'—', 미설정→'미설정', 숫자→소수점1자리 |
| 4 | Sensors.vue — env_mappings 있는 그룹 확장 | ResolvedEnvPanel 표시 |
| 5 | Sensors.vue — env_mappings 없는 그룹 확장 | 플레이스홀더 + "환경 설정하기" 버튼 |
| 6 | Sensors.vue — 그룹 확장 시 getResolved 호출 | API 1회만 호출 (캐시) |
| 7 | Sensors.vue — 로딩 중 표시 | 스켈레톤/로딩 텍스트 |
| 8 | Sensors.vue — MonitoringWidgets 제거 | 글로벌 qxj 데이터 노출 없음 |
| 9 | Sensors.vue — 다른 그룹 데이터 혼재 없음 | 그룹 A 확장 시 그룹 B 데이터 미표시 |
| 10 | Reports.vue — env_mappings 미설정 그룹 선택 | 경고 배너 표시 |
| 11 | Reports.vue — env_mappings 있는 그룹 선택 | 배너 없음 |
| 12 | 빌드 — vue-tsc + vite | 에러 없음 |
