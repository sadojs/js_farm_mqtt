# Design: 리포트 비교분석 기능

> Plan 참조: `docs/01-plan/features/report-comparison.plan.md`
> 참조: smart-farm-platform `SensorCompareChart.vue` 이식

## 1. 신규 컴포넌트: SensorCompareChart.vue

### 1.1 파일 경로

`frontend/src/components/reports/SensorCompareChart.vue`

### 1.2 UI 구조

```
┌─ 비교 설정 ─────────────────────────────┐
│ [그룹1 선택]  vs  [그룹2 선택]           │
│ [항목 선택]  [기간 선택]  [비교 버튼]     │
└──────────────────────────────────────────┘

┌─ 오버레이 라인 차트 (300px) ────────────┐
│ ──── 그룹1 (실선 #2e7d32)               │
│ - - - 그룹2 (점선 #2196f3)              │
└──────────────────────────────────────────┘

┌─ 통계 비교 테이블 ──────────────────────┐
│        │ 그룹1   │ 그룹2   │ 차이      │
│ 평균   │ 22.3°C  │ 21.8°C  │ +0.5°C   │
│ 최고   │ 28.1°C  │ 27.5°C  │ -        │
│ 최저   │ 18.2°C  │ 17.9°C  │ -        │
└──────────────────────────────────────────┘
```

### 1.3 데이터 소스 (mqtt 프로젝트 적응)

platform은 `/api/reports/sensor-data`를 사용하지만, mqtt에는 해당 엔드포인트가 없음.
기존 `/reports/hourly` API를 활용:

```typescript
// platform (원본)
client.get('/api/reports/sensor-data', { params: { groupId, sensorType, dateRange } })

// mqtt (적응) — reportApi 사용
const now = new Date()
const start = new Date(now.getTime() - periodMs)
reportApi.getHourlyData({ groupId, sensorType: metric, startDate: start.toISOString(), endDate: now.toISOString() })
```

기간 변환:
- `1d` → 24시간 전
- `7d` → 7일 전
- `30d` → 30일 전

### 1.4 응답 데이터 매핑

hourly API 응답 필드: `{ time, sensor_type, avg_value, min_value, max_value, count }`

```typescript
// calcStats에서 avg_value 필드 사용
const values = data.map(d => Number(d.avg_value)).filter(v => !isNaN(v))
```

### 1.5 차트 구현

platform과 동일한 Chart.js 직접 렌더링 방식:
- canvas ref + `new Chart()` 직접 생성
- 그룹1: 실선 (#2e7d32), 그룹2: 점선 (#2196f3, borderDash [5,5])
- tension: 0.3, pointRadius: 2
- 타임스탬프 라벨: `M/D H:MM` 형식
- cleanup: `onUnmounted`에서 `chartInstance.destroy()`

### 1.6 통계 비교 테이블

- 평균 차이 색상: `|diff| < 0.5` → neutral(회색), `> 0` → positive(빨강), `< 0` → negative(파랑)
- 최고/최저: 차이 표시 없음 (`-`)

### 1.7 메트릭 옵션

```typescript
const metricOptions = [
  { value: 'temperature', label: '온도 (°C)', unit: '°C' },
  { value: 'humidity', label: '습도 (%)', unit: '%' },
  { value: 'co2', label: 'CO₂ (ppm)', unit: 'ppm' },
  { value: 'light', label: '조도 (lx)', unit: 'lx' },
  { value: 'soil_moisture', label: '토양수분 (%)', unit: '%' },
]
```

### 1.8 의존성

- `chart.js` (이미 설치됨 — Reports.vue에서 사용 중)
- `useGroupStore` (이미 존재)
- `reportApi` (이미 존재 — `getHourlyData`)
- `EmptyState` 컴포넌트 (이미 존재)

---

## 2. Reports.vue 수정

### 2.1 탭 추가

```vue
<!-- 헤더 아래, 필터 위에 탭 추가 -->
<div class="main-tabs">
  <button class="main-tab" :class="{ active: reportTab === 'data' }" @click="reportTab = 'data'">
    센서 데이터
  </button>
  <button class="main-tab" :class="{ active: reportTab === 'compare' }" @click="reportTab = 'compare'">
    비교 분석
  </button>
</div>
```

### 2.2 조건부 렌더링

```vue
<!-- 기존 필터/차트/테이블을 v-if="reportTab === 'data'"로 감싸기 -->
<template v-if="reportTab === 'data'">
  <!-- 기존 필터, 차트, 테이블 전체 -->
</template>

<!-- 비교 분석 탭 -->
<SensorCompareChart v-if="reportTab === 'compare'" />
```

### 2.3 state 추가

```typescript
const reportTab = ref('data')
```

### 2.4 import 추가

```typescript
import SensorCompareChart from '../components/reports/SensorCompareChart.vue'
```

### 2.5 탭 스타일

```css
.main-tabs {
  display: flex;
  gap: 0;
  margin-bottom: 20px;
  border-bottom: 2px solid var(--border-input);
}
.main-tab {
  padding: 12px 24px;
  background: none;
  border: none;
  font-size: 15px;
  font-weight: 500;
  color: var(--text-secondary);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -2px;
  transition: all 0.2s;
}
.main-tab.active {
  color: var(--accent);
  border-bottom-color: var(--accent);
  font-weight: 600;
}
.main-tab:hover:not(.active) {
  color: var(--text-primary);
}
```

---

## 3. Backend

변경 없음 — 기존 `/reports/hourly` API가 groupId + sensorType 파라미터를 지원.

---

## 4. 수정 파일 체크리스트

| # | 파일 | 변경 |
|---|------|------|
| 1 | `frontend/src/components/reports/SensorCompareChart.vue` | **신규** — platform 이식 + hourly API 적응 |
| 2 | `frontend/src/views/Reports.vue` | 탭 추가 + 조건부 렌더링 + import + 스타일 |

## 5. 구현 순서

```
1. SensorCompareChart.vue 생성 (platform 기반 + API 적응)
   ↓
2. Reports.vue에 탭 UI + 컴포넌트 연결
```
