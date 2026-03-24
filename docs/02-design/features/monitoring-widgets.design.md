# Design: monitoring-widgets

> 대시보드 실시간 환경 모니터링 위젯 7종 - 상세 설계

## 1. 데이터 소스 매핑 (확정)

| 필드 | 소스 | 테이블/API | 비고 |
|------|------|-----------|------|
| `inside_temp` | qxj 센서 | `sensor_data` WHERE device_id=qxj, sensor_type='temperature' | 하우스 내부 온도 |
| `inside_rh` | qxj 센서 | `sensor_data` WHERE device_id=qxj, sensor_type='humidity' | 하우스 내부 습도 |
| `inside_dewpoint` | qxj 센서 | `sensor_data` WHERE device_id=qxj, sensor_type='dew_point' | 하우스 내부 이슬점 |
| `uv` | qxj 센서 | `sensor_data` WHERE device_id=qxj, sensor_type='uv' | Tuya uv_index |
| `rainfall` | qxj 센서 | `sensor_data` WHERE device_id=qxj, sensor_type='rainfall' | 강우량 |
| `outside_temp` | KMA API | `GET /dashboard/weather` → weather.temperature | 외부 온도 |
| `outside_rh` | KMA API | `GET /dashboard/weather` → weather.humidity | 외부 습도 |
| `co2` | hjjcy 센서 | sensor_data (별도 조회, 위젯 미사용) | hjjcy는 CO2만 사용 |

## 2. 백엔드 설계

### 2-1. 신규 엔드포인트: `GET /dashboard/widgets`

**파일**: `backend/src/modules/dashboard/dashboard.controller.ts`

```typescript
@Get('widgets')
getWidgets(@CurrentUser() user: any) {
  const effectiveUserId = user.role === 'farm_user' && user.parentUserId
    ? user.parentUserId : user.id;
  return this.dashboardService.getWidgetData(effectiveUserId);
}
```

### 2-2. DashboardService 확장

**파일**: `backend/src/modules/dashboard/dashboard.service.ts`

신규 메서드: `getWidgetData(userId: string)`

```typescript
async getWidgetData(userId: string) {
  // 1) qxj 디바이스 ID 조회
  const qxjDevices = await this.devicesRepo.find({
    where: { userId, category: Like('%qxj%'), deviceType: 'sensor' }
  });
  const qxjIds = qxjDevices.map(d => d.id);

  if (qxjIds.length === 0) {
    return { inside: null, history: null, trend6h: null, uvStats14d: null };
  }

  // 2~5) 병렬 실행
  const [latest, history, trend6h, uvStats] = await Promise.all([
    this.getLatestSensorValues(qxjIds),      // 최신 내부 값
    this.getHistoryValues(qxjIds),            // 10분 전 값
    this.getTrend6h(qxjIds),                  // 6시간 트렌드
    this.getUvStats14d(qxjIds),               // UV 14일 통계
  ]);

  return { inside: latest, history, trend6h, uvStats14d: uvStats };
}
```

### 2-3. SQL 쿼리 상세

#### Q1: 최신 내부 센서값

```sql
SELECT DISTINCT ON (sensor_type) sensor_type, value, time
FROM sensor_data
WHERE device_id = ANY($1)
  AND sensor_type IN ('temperature', 'humidity', 'dew_point', 'uv', 'rainfall')
ORDER BY sensor_type, time DESC
```

→ 반환: `{ temperature, humidity, dewPoint, uv, rainfall }`

#### Q2: 10분 전 값 (변화율 계산용)

```sql
SELECT DISTINCT ON (sensor_type) sensor_type, value, time
FROM sensor_data
WHERE device_id = ANY($1)
  AND sensor_type IN ('temperature', 'humidity')
  AND time BETWEEN (NOW() - INTERVAL '15 minutes') AND (NOW() - INTERVAL '8 minutes')
ORDER BY sensor_type, time DESC
```

- 10분 전 ± 2분 범위에서 가장 최근 샘플
- 없으면 null 반환

→ 반환: `{ temperature, humidity, timestamp }`

#### Q3: 6시간 트렌드

```sql
SELECT sensor_type, value, time
FROM sensor_data
WHERE device_id = ANY($1)
  AND sensor_type IN ('temperature', 'humidity', 'uv')
  AND time >= NOW() - INTERVAL '6 hours'
ORDER BY time ASC
```

→ 센서타입별로 그룹화하여 `{ time, value }[]` 배열로 변환

#### Q4: UV 14일 통계

```sql
SELECT MIN(value) as min, MAX(value) as max
FROM sensor_data
WHERE device_id = ANY($1)
  AND sensor_type = 'uv'
  AND time >= NOW() - INTERVAL '14 days'
  AND value > 0
```

→ 반환: `{ min, max }` 또는 null

### 2-4. DashboardModule 의존성 추가

**파일**: `backend/src/modules/dashboard/dashboard.module.ts`

```typescript
@Module({
  imports: [
    TypeOrmModule.forFeature([User, Device, SensorData]),  // Device, SensorData 추가
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
  exports: [DashboardService],
})
```

### 2-5. 응답 인터페이스

```typescript
interface WidgetDataResponse {
  inside: {
    temperature: number | null;
    humidity: number | null;
    dewPoint: number | null;
    uv: number | null;
    rainfall: number | null;
  } | null;
  history: {
    temperature: number | null;
    humidity: number | null;
    timestamp: string | null;
  } | null;
  trend6h: {
    temperature: { time: string; value: number }[];
    humidity: { time: string; value: number }[];
    uv: { time: string; value: number }[];
  } | null;
  uvStats14d: {
    min: number;
    max: number;
  } | null;
}
```

## 3. 프론트엔드 설계

### 3-1. API 클라이언트

**파일**: `frontend/src/api/dashboard.api.ts`

```typescript
export interface WidgetDataResponse {
  inside: {
    temperature: number | null;
    humidity: number | null;
    dewPoint: number | null;
    uv: number | null;
    rainfall: number | null;
  } | null;
  history: {
    temperature: number | null;
    humidity: number | null;
    timestamp: string | null;
  } | null;
  trend6h: {
    temperature: { time: string; value: number }[];
    humidity: { time: string; value: number }[];
    uv: { time: string; value: number }[];
  } | null;
  uvStats14d: { min: number; max: number } | null;
}

export const dashboardApi = {
  getWeather: () => apiClient.get<DashboardWeatherResponse>('/dashboard/weather'),
  getWidgets: () => apiClient.get<WidgetDataResponse>('/dashboard/widgets'),  // 추가
}
```

### 3-2. 계산 유틸리티 모듈

**파일**: `frontend/src/utils/widget-calculations.ts` (신규)

#### 함수 목록

| # | 함수 | 시그니처 | 설명 |
|---|------|----------|------|
| 1 | `calcSatVaporPressure` | `(tempC: number) => number` | 포화 수증기압 (kPa) |
| 2 | `calcVPD` | `(tempC: number, rhPct: number) => { value: number; status: 'LOW'\|'OK'\|'HIGH' }` | VPD + 상태 |
| 3 | `calcVentScore` | `(inT: number, outT: number, inRH: number, outRH: number) => { score: number; dT: number; dRH: number; status: 'Normal'\|'Recommended'\|'Urgent' }` | 환기 스코어 |
| 4 | `calcTempRate` | `(now: number, prev: number) => { delta: number; status: string; statusKey: string }` | 온도 10분 변화 |
| 5 | `calcRhRate` | `(now: number, prev: number) => { delta: number; status: string; statusKey: string }` | 습도 10분 변화 |
| 6 | `calcUVRisk` | `(uv: number, stats14d?: { min: number; max: number }) => { value: number; label: string; category: string }` | UV 위험도 |
| 7 | `calcEnvScore` | `(params: EnvScoreParams) => { score: number; color: 'green'\|'yellow'\|'red' }` | 환경 점수 |
| 8 | `clip` | `(v: number, min: number, max: number) => number` | 범위 제한 헬퍼 |

#### 상세 구현 명세

```typescript
// === 1. 포화 수증기압 ===
export function calcSatVaporPressure(tempC: number): number {
  return 0.6108 * Math.exp((17.27 * tempC) / (tempC + 237.3));
}

// === 2. VPD ===
export function calcVPD(tempC: number, rhPct: number) {
  const es = calcSatVaporPressure(tempC);
  const vpd = es * (1 - rhPct / 100);
  const value = Math.round(vpd * 100) / 100; // 소수 2자리
  let status: 'LOW' | 'OK' | 'HIGH' = 'OK';
  if (vpd < 0.4) status = 'LOW';
  else if (vpd > 1.2) status = 'HIGH';
  return { value, status };
}

// === 3. 환기 스코어 ===
export function calcVentScore(inT: number, outT: number, inRH: number, outRH: number) {
  const dT = inT - outT;
  const dRH = inRH - outRH;
  const score = Math.round((Math.max(0, dT) * 1.0 + Math.max(0, dRH) * 0.1) * 10) / 10;
  let status: 'Normal' | 'Recommended' | 'Urgent' = 'Normal';
  if (score > 6) status = 'Urgent';
  else if (score > 3) status = 'Recommended';
  return { score, dT: Math.round(dT * 10) / 10, dRH: Math.round(dRH * 10) / 10, status };
}

// === 4. 온도 변화율 ===
export function calcTempRate(now: number, prev: number) {
  const delta = Math.round((now - prev) * 10) / 10;
  let status = 'Stable';
  let statusKey = 'stable';
  if (delta > 2.0) { status = '매우 급상승'; statusKey = 'very-rapid'; }
  else if (delta > 1.0) { status = '급상승'; statusKey = 'rapid-warming'; }
  else if (delta < -2.0) { status = '매우 급하강'; statusKey = 'very-rapid-cooling'; }
  else if (delta < -1.0) { status = '급하강'; statusKey = 'rapid-cooling'; }
  return { delta, status, statusKey };
}

// === 5. 습도 변화율 ===
export function calcRhRate(now: number, prev: number) {
  const delta = Math.round((now - prev) * 10) / 10;
  let status = 'Stable';
  let statusKey = 'stable';
  if (delta > 5) { status = '급가습'; statusKey = 'rapid-humidifying'; }
  else if (delta < -5) { status = '급건조'; statusKey = 'rapid-drying'; }
  return { delta, status, statusKey };
}

// === 6. UV 위험도 ===
export function calcUVRisk(uv: number, stats14d?: { min: number; max: number }) {
  // uv_index 기준 카테고리 (정수값)
  if (uv <= 2) return { value: uv, label: '낮음', category: 'low' };
  if (uv <= 5) return { value: uv, label: '보통', category: 'moderate' };
  if (uv <= 7) return { value: uv, label: '높음', category: 'high' };
  if (uv <= 10) return { value: uv, label: '매우높음', category: 'very-high' };
  return { value: uv, label: '위험', category: 'extreme' };
  // Note: raw UV norm 로직은 stats14d 있을 때 사용, 현재 Tuya가 uv_index 제공
}

// === 7. 환경 점수 ===
interface EnvScoreParams {
  vpd: number;           // VPD 값 (kPa)
  insideTemp: number;    // 내부 온도
  insideDewpoint?: number | null;  // 내부 이슬점 (null 가능)
  uvNorm?: number | null;          // UV norm (null 가능)
}
export function calcEnvScore(params: EnvScoreParams) {
  const { vpd, insideTemp, insideDewpoint, uvNorm } = params;

  const S_vpd = clip(1 - Math.abs(vpd - 0.8) / 0.8, 0, 1);
  const S_cond = insideDewpoint != null
    ? clip((insideTemp - insideDewpoint) / 4, 0, 1)
    : 1;

  // 온도 쾌적 점수: Tmin=20, Tmax=30, d=5
  let S_T: number;
  if (insideTemp >= 20 && insideTemp <= 30) {
    S_T = 1;
  } else if (insideTemp < 20) {
    S_T = clip((insideTemp - 15) / 5, 0, 1);
  } else {
    S_T = clip((35 - insideTemp) / 5, 0, 1);
  }

  const S_uv = uvNorm != null ? 1 - Math.max(0, uvNorm - 0.7) : 1;

  const score = Math.round(100 * (4 * S_vpd + 3 * S_cond + 3 * S_T + 1 * S_uv) / 11);
  let color: 'green' | 'yellow' | 'red' = 'green';
  if (score < 60) color = 'red';
  else if (score < 80) color = 'yellow';
  return { score, color };
}

export function clip(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
```

### 3-3. 위젯 컴포넌트

**파일**: `frontend/src/components/dashboard/MonitoringWidgets.vue` (신규)

#### Props

```typescript
interface Props {
  widgetData: WidgetDataResponse | null;
  weatherData: { temperature: number | null; humidity: number | null } | null;
  loading: boolean;
}
```

- `widgetData`: `GET /dashboard/widgets` 응답 (내부 센서)
- `weatherData`: `GET /dashboard/weather` → weather 객체 (외부 온습도)
- `loading`: 로딩 상태

#### 카드 구조 (공통)

```html
<div class="widget-card">
  <div class="widget-header">
    <span class="widget-title">{{ title }}</span>
    <span :class="['widget-badge', badgeClass]">{{ badgeText }}</span>
  </div>
  <div class="widget-body">
    <span class="widget-value">{{ value }}</span>
    <span class="widget-unit">{{ unit }}</span>
  </div>
  <div class="widget-hint">{{ hint }}</div>
  <!-- 선택: sparkline -->
  <svg v-if="trendData" class="widget-sparkline">...</svg>
</div>
```

#### 7개 카드 상세

| # | title | value | unit | badge | hint | sparkline |
|---|-------|-------|------|-------|------|-----------|
| 1 | 내부 VPD | `0.65` | kPa | LOW/OK/HIGH | "적정범위 0.4~1.2 kPa" | trend6h.temperature 기반 VPD 계산 |
| 2 | 환기 필요도 | `4.2` | pt | Normal/Recommended/Urgent | "ΔT +3.0°C ΔRH +12%" | - |
| 3 | 온도 변화 | `+1.2` | °C/10m | Stable/Rapid/Very rapid | "10분간 온도 변화량" | trend6h.temperature |
| 4 | 습도 변화 | `-2.1` | %/10m | Stable/급가습/급건조 | "10분간 습도 변화량" | trend6h.humidity |
| 5 | 내외부 비교 | ΔT/ΔRH | °C / % | - | - | 게이지 바 |
| 6 | UV 위험도 | `3` | idx | 낮음~위험 | "자외선 지수 카테고리" | trend6h.uv |
| 7 | 환경 점수 | `78` | /100 | 색상 원형 | "종합 환경 상태" | - |

#### 카드 5 (내외부 비교) 게이지 바 설계

```html
<!-- ΔT 게이지 (-10 ~ +10) -->
<div class="gauge-row">
  <span class="gauge-label">ΔT</span>
  <div class="gauge-bar">
    <div class="gauge-fill" :style="{ width: gaugePercent(dT, -10, 10) + '%' }"></div>
    <div class="gauge-center"></div>
  </div>
  <span class="gauge-value">{{ dT > 0 ? '+' : '' }}{{ dT }}°C</span>
</div>
<!-- ΔRH 게이지 (-40 ~ +40) -->
<div class="gauge-row">
  <span class="gauge-label">ΔRH</span>
  <div class="gauge-bar">
    <div class="gauge-fill" :style="{ width: gaugePercent(dRH, -40, 40) + '%' }"></div>
    <div class="gauge-center"></div>
  </div>
  <span class="gauge-value">{{ dRH > 0 ? '+' : '' }}{{ dRH }}%</span>
</div>
```

게이지 퍼센트 계산:
```typescript
function gaugePercent(value: number, min: number, max: number): number {
  return ((clip(value, min, max) - min) / (max - min)) * 100;
}
```

#### 카드 7 (환경 점수) 원형 표시

```html
<div class="score-circle" :class="scoreColor">
  <span class="score-value">{{ score }}</span>
</div>
```

CSS:
```css
.score-circle { width: 80px; height: 80px; border-radius: 50%; display: flex; ... }
.score-circle.green { background: rgba(76, 175, 80, 0.15); border: 3px solid #4CAF50; }
.score-circle.yellow { background: rgba(255, 193, 7, 0.15); border: 3px solid #FFC107; }
.score-circle.red { background: rgba(244, 67, 54, 0.15); border: 3px solid #F44336; }
```

#### Sparkline (SVG)

```typescript
function sparklinePath(data: { time: string; value: number }[]): string {
  if (data.length < 2) return '';
  const minV = Math.min(...data.map(d => d.value));
  const maxV = Math.max(...data.map(d => d.value));
  const range = maxV - minV || 1;
  const w = 120, h = 32;
  return data.map((d, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((d.value - minV) / range) * h;
    return `${i === 0 ? 'M' : 'L'}${x},${y}`;
  }).join(' ');
}
```

SVG: `<svg viewBox="0 0 120 32"><path :d="path" fill="none" stroke="var(--accent)" stroke-width="1.5"/></svg>`

### 3-4. Dashboard.vue 수정

**파일**: `frontend/src/views/Dashboard.vue`

```diff
 <script setup lang="ts">
-import { computed, onMounted, ref } from 'vue'
+import { computed, onMounted, ref } from 'vue'
 import { dashboardApi } from '../api/dashboard.api'
+import type { WidgetDataResponse } from '../api/dashboard.api'
 import SummaryCards from '../components/dashboard/SummaryCards.vue'
+import MonitoringWidgets from '../components/dashboard/MonitoringWidgets.vue'

+const widgetData = ref<WidgetDataResponse | null>(null)

 async function refreshWeather() {
   loading.value = true
   errorMessage.value = ''
   try {
-    const { data } = await dashboardApi.getWeather()
+    const [weatherRes, widgetRes] = await Promise.all([
+      dashboardApi.getWeather(),
+      dashboardApi.getWidgets(),
+    ])
+    const data = weatherRes.data
+    widgetData.value = widgetRes.data

     // ... 기존 weather 처리 로직 유지
   } catch (err) { ... }
 }
```

```diff
 <!-- 템플릿 -->
 <div class="weather-card">...</div>

+<!-- 환경 모니터링 위젯 -->
+<MonitoringWidgets
+  :widget-data="widgetData"
+  :weather-data="weather"
+  :loading="loading"
+/>

 <SummaryCards />
```

### 3-5. CSS 레이아웃

```css
/* 위젯 그리드 */
.monitoring-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  margin-bottom: 20px;
}

/* 환경 점수: 전체 너비 */
.monitoring-grid .widget-card.full-width {
  grid-column: 1 / -1;
}

/* 카드 */
.widget-card {
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: 14px;
  padding: 18px 20px;
  box-shadow: var(--shadow-card);
}

.widget-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.widget-title {
  font-size: calc(14px * var(--content-scale, 1));
  font-weight: 600;
  color: var(--text-secondary);
}

.widget-badge {
  padding: 3px 10px;
  border-radius: 12px;
  font-size: calc(12px * var(--content-scale, 1));
  font-weight: 600;
}
.widget-badge.ok, .widget-badge.normal, .widget-badge.stable { background: var(--accent-bg); color: var(--accent); }
.widget-badge.low, .widget-badge.recommended { background: var(--bg-info-banner); color: var(--text-info-banner); }
.widget-badge.high, .widget-badge.urgent, .widget-badge.rapid { background: rgba(244,67,54,0.1); color: #F44336; }

.widget-value {
  font-size: calc(32px * var(--content-scale, 1));
  font-weight: 700;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}

.widget-unit {
  font-size: calc(16px * var(--content-scale, 1));
  color: var(--text-muted);
  margin-left: 4px;
}

.widget-hint {
  font-size: calc(12px * var(--content-scale, 1));
  color: var(--text-muted);
  margin-top: 8px;
}

/* 반응형 */
@media (max-width: 1024px) {
  .monitoring-grid { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 768px) {
  .monitoring-grid { grid-template-columns: 1fr; }
}
```

## 4. 파일 변경 목록

### 신규 파일

| # | 파일 | 설명 |
|---|------|------|
| N1 | `frontend/src/utils/widget-calculations.ts` | 계산 로직 모듈 (8개 함수) |
| N2 | `frontend/src/components/dashboard/MonitoringWidgets.vue` | 위젯 컴포넌트 |

### 수정 파일

| # | 파일 | 변경 내용 |
|---|------|----------|
| M1 | `backend/src/modules/dashboard/dashboard.controller.ts` | `getWidgets()` 엔드포인트 추가 |
| M2 | `backend/src/modules/dashboard/dashboard.service.ts` | `getWidgetData()` + 4개 private 메서드 추가 |
| M3 | `backend/src/modules/dashboard/dashboard.module.ts` | `TypeOrmModule.forFeature`에 Device, SensorData 추가 |
| M4 | `frontend/src/api/dashboard.api.ts` | `WidgetDataResponse` 타입 + `getWidgets()` 추가 |
| M5 | `frontend/src/views/Dashboard.vue` | MonitoringWidgets import + widgetData ref + 병렬 API 호출 + 템플릿 추가 |

## 5. 구현 순서

### Phase 1: 백엔드 API (M3 → M2 → M1)

| Step | 파일 | 작업 |
|------|------|------|
| 1-1 | `dashboard.module.ts` | imports에 Device, SensorData 엔티티 추가 |
| 1-2 | `dashboard.service.ts` | constructor에 `@InjectRepository(Device)`, `@InjectRepository(SensorData)` 추가 |
| 1-3 | `dashboard.service.ts` | `getWidgetData()` 메서드 구현 |
| 1-4 | `dashboard.service.ts` | `getLatestSensorValues()` private 메서드 (Q1) |
| 1-5 | `dashboard.service.ts` | `getHistoryValues()` private 메서드 (Q2) |
| 1-6 | `dashboard.service.ts` | `getTrend6h()` private 메서드 (Q3) |
| 1-7 | `dashboard.service.ts` | `getUvStats14d()` private 메서드 (Q4) |
| 1-8 | `dashboard.controller.ts` | `@Get('widgets') getWidgets()` 추가 |

### Phase 2: 프론트엔드 유틸 (N1)

| Step | 파일 | 작업 |
|------|------|------|
| 2-1 | `widget-calculations.ts` | `clip`, `calcSatVaporPressure` 함수 |
| 2-2 | `widget-calculations.ts` | `calcVPD` 함수 |
| 2-3 | `widget-calculations.ts` | `calcVentScore` 함수 |
| 2-4 | `widget-calculations.ts` | `calcTempRate`, `calcRhRate` 함수 |
| 2-5 | `widget-calculations.ts` | `calcUVRisk` 함수 |
| 2-6 | `widget-calculations.ts` | `calcEnvScore` 함수 + EnvScoreParams 인터페이스 |

### Phase 3: API 클라이언트 (M4)

| Step | 파일 | 작업 |
|------|------|------|
| 3-1 | `dashboard.api.ts` | `WidgetDataResponse` 인터페이스 추가 |
| 3-2 | `dashboard.api.ts` | `getWidgets()` 메서드 추가 |

### Phase 4: 위젯 컴포넌트 (N2)

| Step | 파일 | 작업 |
|------|------|------|
| 4-1 | `MonitoringWidgets.vue` | Props 정의, computed로 7개 위젯 데이터 계산 |
| 4-2 | `MonitoringWidgets.vue` | 카드 1-4: VPD, 환기스코어, 온도변화, 습도변화 |
| 4-3 | `MonitoringWidgets.vue` | 카드 5: ΔT/ΔRH 게이지 바 |
| 4-4 | `MonitoringWidgets.vue` | 카드 6: UV 위험도 |
| 4-5 | `MonitoringWidgets.vue` | 카드 7: 환경 점수 원형 (전체 너비) |
| 4-6 | `MonitoringWidgets.vue` | sparklinePath 함수 + SVG sparkline 렌더링 |
| 4-7 | `MonitoringWidgets.vue` | 반응형 CSS (3열→2열→1열) |

### Phase 5: Dashboard 통합 (M5)

| Step | 파일 | 작업 |
|------|------|------|
| 5-1 | `Dashboard.vue` | import MonitoringWidgets + widgetData ref |
| 5-2 | `Dashboard.vue` | refreshWeather()에 Promise.all 병렬 호출 추가 |
| 5-3 | `Dashboard.vue` | 템플릿에 `<MonitoringWidgets>` 삽입 (날씨카드 아래, SummaryCards 위) |

### Phase 6: 빌드 검증

| Step | 작업 |
|------|------|
| 6-1 | 백엔드 빌드 (`cd backend && npm run build`) |
| 6-2 | 프론트엔드 빌드 (`cd frontend && npx vue-tsc --noEmit && npx vite build`) |

## 6. 검증 항목 (Gap Analysis용)

| # | 카테고리 | 검증 항목 |
|---|----------|----------|
| 1 | Backend API | `GET /dashboard/widgets` 엔드포인트 존재 |
| 2 | Backend API | getEffectiveUserId 패턴 적용 |
| 3 | Backend API | qxj device_id 기반 sensor_data 조회 |
| 4 | Backend API | 최신값 + 10분전 + 6h트렌드 + UV통계 병렬 실행 |
| 5 | Backend Module | Device, SensorData 엔티티 import |
| 6 | Utils | calcVPD: es 공식 + 0.4/1.2 임계값 |
| 7 | Utils | calcVentScore: dT*1.0 + dRH*0.1 + 3/6 임계값 |
| 8 | Utils | calcTempRate: ±1.0/±2.0 임계값 |
| 9 | Utils | calcRhRate: ±5 임계값 |
| 10 | Utils | calcUVRisk: 0-2/3-5/6-7/8-10/11+ 구간 |
| 11 | Utils | calcEnvScore: 4/3/3/1 가중치 + 80/60 색상 |
| 12 | Component | 7개 위젯 카드 렌더링 |
| 13 | Component | ΔT/ΔRH 게이지 바 (-10~+10 / -40~+40) |
| 14 | Component | 환경점수 원형 (green/yellow/red) |
| 15 | Component | sparkline SVG |
| 16 | Component | 반응형 grid (3열→2열→1열) |
| 17 | Dashboard | MonitoringWidgets 배치 (날씨카드↔SummaryCards 사이) |
| 18 | Dashboard | Promise.all 병렬 API 호출 |
| 19 | API Client | WidgetDataResponse 타입 + getWidgets() |
| 20 | UI | 데이터 없음 시 "-" 표시 |
| 21 | UI | CSS 변수 사용 (하드코딩 색상 없음) |
