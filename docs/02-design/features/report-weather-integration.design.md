# Design: 리포트 조회 버그 수정 + 날씨 데이터 통합

## Feature ID
`report-weather-integration`

## Date
2026-02-22

## Reference
- Plan: `docs/01-plan/features/report-weather-integration.plan.md`

---

## 1. 데이터 구조 변경

### 1-1. weather_data 테이블 (신규)

```sql
CREATE TABLE weather_data (
  time TIMESTAMPTZ NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  temperature DECIMAL(5, 2),
  humidity DECIMAL(5, 2),
  precipitation DECIMAL(5, 2),
  wind_speed DECIMAL(5, 2),
  condition VARCHAR(20) DEFAULT 'clear',
  nx INT,
  ny INT
);

SELECT create_hypertable('weather_data', 'time');
CREATE INDEX idx_weather_data_user ON weather_data(user_id, time DESC);
```

- TimescaleDB Hypertable: `sensor_data`와 동일한 시계열 패턴
- `user_id` 기반 조회: 사용자별 주소가 다르므로 사용자 단위 저장
- 중복 방지: 동일 `(time, user_id)` 조합은 INSERT 전 확인

### 1-2. WeatherData 엔티티 (신규)

```typescript
// backend/src/modules/weather/weather-data.entity.ts
import { Entity, Column, PrimaryColumn } from 'typeorm';

@Entity('weather_data')
export class WeatherData {
  @PrimaryColumn({ type: 'timestamptz' })
  time: Date;

  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  temperature: number | null;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  humidity: number | null;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  precipitation: number | null;

  @Column({ name: 'wind_speed', type: 'decimal', precision: 5, scale: 2, nullable: true })
  windSpeed: number | null;

  @Column({ length: 20, default: 'clear' })
  condition: string;

  @Column({ type: 'int', nullable: true })
  nx: number | null;

  @Column({ type: 'int', nullable: true })
  ny: number | null;
}
```

- 복합 PrimaryKey: `(time, user_id)` - 같은 시간에 같은 사용자 중복 방지
- nullable 필드: 기상청 API 응답 일부 누락 가능

---

## 2. 백엔드 상세 설계

### 2-1. WeatherCollectorService (신규)

```typescript
// backend/src/modules/weather/weather-collector.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WeatherData } from './weather-data.entity';
import { DashboardService } from '../dashboard/dashboard.service';
import { User } from '../users/entities/user.entity';

@Injectable()
export class WeatherCollectorService {
  private readonly logger = new Logger(WeatherCollectorService.name);

  constructor(
    @InjectRepository(WeatherData)
    private readonly weatherRepo: Repository<WeatherData>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly dashboardService: DashboardService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async collectWeatherData() {
    // 1. 주소가 있는 활성 사용자 조회
    const users = await this.userRepo.find({
      where: { status: 'active' },
    });
    const usersWithAddress = users.filter(u => u.address);

    // 2. 현재 정시 시간 (분/초 버림)
    const now = new Date();
    now.setMinutes(0, 0, 0);

    for (const user of usersWithAddress) {
      try {
        // 3. 중복 확인
        const exists = await this.weatherRepo.findOne({
          where: { time: now, userId: user.id },
        });
        if (exists) continue;

        // 4. 기상청 API 호출 (DashboardService 재사용)
        const result = await this.dashboardService.getWeatherForUser(user.id);

        // 5. DB 저장
        const weatherData = this.weatherRepo.create({
          time: now,
          userId: user.id,
          temperature: result.weather.temperature,
          humidity: result.weather.humidity,
          precipitation: result.weather.precipitation,
          windSpeed: result.weather.windSpeed,
          condition: result.weather.condition,
          nx: result.location.nx,
          ny: result.location.ny,
        });
        await this.weatherRepo.save(weatherData);
      } catch (err) {
        this.logger.warn(`날씨 수집 실패 [${user.id}]: ${err.message}`);
      }
    }

    this.logger.log(`날씨 수집 완료: ${usersWithAddress.length}명`);
  }
}
```

**핵심 설계 결정:**
- `DashboardService.getWeatherForUser()` 재사용 → 기상청 API 호출 로직 중복 제거
- `@Cron(EVERY_HOUR)` → `ScheduleModule.forRoot()`이 이미 `app.module.ts`에 등록됨
- 사용자별 순차 처리 + try/catch → 한 명 실패해도 나머지 계속 처리
- 중복 방지: `findOne`으로 동일 `(time, userId)` 확인

### 2-2. WeatherModule (신규)

```typescript
// backend/src/modules/weather/weather.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WeatherData } from './weather-data.entity';
import { WeatherCollectorService } from './weather-collector.service';
import { DashboardModule } from '../dashboard/dashboard.module';
import { User } from '../users/entities/user.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([WeatherData, User]),
    DashboardModule,
  ],
  providers: [WeatherCollectorService],
  exports: [TypeOrmModule],
})
export class WeatherModule {}
```

### 2-3. DashboardModule 수정 (기존)

DashboardService를 외부 모듈에서 사용할 수 있도록 exports 추가:

**Before:**
```typescript
@Module({
  imports: [TypeOrmModule.forFeature([User])],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
```

**After:**
```typescript
@Module({
  imports: [TypeOrmModule.forFeature([User])],
  controllers: [DashboardController],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}
```

### 2-4. AppModule 수정 (기존)

**After (L14 추가):**
```typescript
import { WeatherModule } from './modules/weather/weather.module';
// ... imports 배열에 WeatherModule 추가
```

### 2-5. ReportsService - getWeatherHourly 메서드 추가

```typescript
// reports.service.ts에 추가
async getWeatherHourly(userId: string, params: ReportParams) {
  const conditions: string[] = ['wd.user_id = $1'];
  const values: any[] = [userId];
  let paramIndex = 2;

  if (params.startDate) {
    conditions.push(`wd.time >= $${paramIndex++}`);
    values.push(params.startDate);
  }
  if (params.endDate) {
    conditions.push(`wd.time <= $${paramIndex++}`);
    values.push(params.endDate);
  }

  const whereClause = conditions.join(' AND ');

  const query = `
    SELECT
      date_trunc('hour', wd.time) as time,
      ROUND(AVG(wd.temperature)::numeric, 2) as temperature,
      ROUND(AVG(wd.humidity)::numeric, 2) as humidity,
      ROUND(AVG(wd.precipitation)::numeric, 2) as precipitation,
      ROUND(AVG(wd.wind_speed)::numeric, 2) as wind_speed
    FROM weather_data wd
    WHERE ${whereClause}
    GROUP BY date_trunc('hour', wd.time)
    ORDER BY time ASC
    LIMIT 2000
  `;

  return this.dataSource.query(query, values);
}
```

### 2-6. ReportsController - 엔드포인트 추가

```typescript
// reports.controller.ts에 추가
@Get('weather-hourly')
async getWeatherHourly(
  @CurrentUser('id') userId: string,
  @Query('startDate') startDate?: string,
  @Query('endDate') endDate?: string,
) {
  return this.reportsService.getWeatherHourly(userId, { startDate, endDate });
}
```

---

## 3. 프론트엔드 상세 설계

### 3-1. FR-01: 리포트 조회 버그 수정

**Reports.vue L71 - "조회" 버튼 @click 변경**

**Before:**
```html
<button class="btn-primary btn-sm" @click="loadAllData" :disabled="loadingData">조회</button>
```

**After:**
```html
<button class="btn-primary btn-sm" @click="onCustomQuery" :disabled="loadingData">조회</button>
```

**Script 추가:**
```typescript
function onCustomQuery() {
  updateDateRange()
  loadAllData()
}
```

**원인 분석:** `selectPeriod('custom')` 호출 시 `updateDateRange()`를 건너뛰고, "조회" 버튼은 `loadAllData()`만 직접 호출. `loadAllData()`는 `startDate.value`가 빈 문자열이면 즉시 return → 데이터 로드 안됨.

### 3-2. report.api.ts - getWeatherHourly 추가

```typescript
// frontend/src/api/report.api.ts에 추가
export interface WeatherHourlyParams {
  startDate: string
  endDate: string
}

export const reportApi = {
  // ... 기존 메서드 유지
  getWeatherHourly: (params: WeatherHourlyParams) =>
    apiClient.get('/reports/weather-hourly', { params }),
}
```

### 3-3. FR-04: Reports.vue 데이터 + 차트 변경

#### 3-3-1. 센서 타입 옵션 라벨 변경 (L176-180)

**Before:**
```typescript
const sensorTypeOptions = [
  { value: 'temp_humidity', label: '온/습도', unit: '' },
  { value: 'temperature', label: '온도', unit: '°C' },
  { value: 'humidity', label: '습도', unit: '%' },
]
```

**After:**
```typescript
const sensorTypeOptions = [
  { value: 'temp_humidity', label: '온/습도', unit: '' },
  { value: 'temperature', label: '온도', unit: '°C' },
  { value: 'humidity', label: '습도', unit: '%' },
]
```

라벨은 동일 유지. 차트 범례에서 "실내/외부" 구분 표시.

#### 3-3-2. 날씨 데이터 상태 추가 (L200-202 근처)

```typescript
const weatherData = ref<any[]>([])
```

#### 3-3-3. loadAllData() 수정 (L435-462)

**Before:**
```typescript
const [statsRes, hourlyRes, actRes] = await Promise.all([
  reportApi.getStatistics({ ...baseParams, sensorType: undefined }),
  reportApi.getHourlyData({ ...baseParams, sensorType: undefined }),
  reportApi.getActuatorStats(baseParams),
])

statsData.value = statsRes.data || []
hourlyData.value = hourlyRes.data || []
actuatorData.value = actRes.data || []
```

**After:**
```typescript
const [statsRes, hourlyRes, actRes, weatherRes] = await Promise.all([
  reportApi.getStatistics({ ...baseParams, sensorType: undefined }),
  reportApi.getHourlyData({ ...baseParams, sensorType: undefined }),
  reportApi.getActuatorStats(baseParams),
  reportApi.getWeatherHourly({
    startDate: startDate.value,
    endDate: endDate.value,
  }),
])

statsData.value = statsRes.data || []
hourlyData.value = hourlyRes.data || []
actuatorData.value = actRes.data || []
weatherData.value = weatherRes.data || []
```

#### 3-3-4. 차트 색상 추가 (L233-236)

**After:**
```typescript
const CHART_COLORS: Record<string, { border: string; bg: string }> = {
  temperature: { border: '#4A90D9', bg: 'rgba(74, 144, 217, 0.1)' },
  humidity: { border: '#4caf50', bg: 'rgba(76, 175, 80, 0.1)' },
  weather_temp: { border: '#FF8C00', bg: 'rgba(255, 140, 0, 0.1)' },
  weather_humidity: { border: '#9C27B0', bg: 'rgba(156, 39, 176, 0.1)' },
}
```

| 데이터 | 색상 | 스타일 |
|--------|------|--------|
| 센서 온도 | `#4A90D9` (파랑) | 실선 |
| 센서 습도 | `#4caf50` (초록) | 실선 |
| 날씨 온도 | `#FF8C00` (주황) | 점선 `borderDash: [5, 5]` |
| 날씨 습도 | `#9C27B0` (보라) | 점선 `borderDash: [5, 5]` |

#### 3-3-5. sensorChartData 수정 (L248-304)

**After - temp_humidity 이중 차트:**
```typescript
const sensorChartData = computed(() => {
  const sType = selectedSensorType.value

  if (showDualChart.value) {
    const tempData = hourlyData.value.filter((d: any) => d.sensor_type === 'temperature')
    const humData = hourlyData.value.filter((d: any) => d.sensor_type === 'humidity')
    const labels = tempData.map((d: any) => formatTimeLabel(d.time))

    const datasets: any[] = [
      {
        label: '실내 온도 (°C)',
        data: tempData.map((d: any) => Number(d.avg_value)),
        borderColor: CHART_COLORS.temperature.border,
        backgroundColor: CHART_COLORS.temperature.bg,
        tension: 0.4, fill: false, yAxisID: 'y',
        pointRadius: 3, pointBackgroundColor: CHART_COLORS.temperature.border,
      },
      {
        label: '실내 습도 (%)',
        data: humData.map((d: any) => Number(d.avg_value)),
        borderColor: CHART_COLORS.humidity.border,
        backgroundColor: CHART_COLORS.humidity.bg,
        tension: 0.4, fill: false, yAxisID: 'y1',
        pointRadius: 3, pointBackgroundColor: CHART_COLORS.humidity.border,
      },
    ]

    // 날씨 데이터 추가 (점선)
    if (weatherData.value.length > 0) {
      const weatherByTime = new Map(weatherData.value.map((w: any) => [formatTimeLabel(w.time), w]))
      datasets.push(
        {
          label: '외부 온도 (°C)',
          data: labels.map(t => {
            const w = weatherByTime.get(t)
            return w ? Number(w.temperature) : null
          }),
          borderColor: CHART_COLORS.weather_temp.border,
          borderDash: [5, 5],
          tension: 0.4, fill: false, yAxisID: 'y',
          pointRadius: 2,
          pointBackgroundColor: CHART_COLORS.weather_temp.border,
        },
        {
          label: '외부 습도 (%)',
          data: labels.map(t => {
            const w = weatherByTime.get(t)
            return w ? Number(w.humidity) : null
          }),
          borderColor: CHART_COLORS.weather_humidity.border,
          borderDash: [5, 5],
          tension: 0.4, fill: false, yAxisID: 'y1',
          pointRadius: 2,
          pointBackgroundColor: CHART_COLORS.weather_humidity.border,
        },
      )
    }

    return { labels, datasets }
  }

  // 단일 센서 차트 (temperature 또는 humidity)
  const filtered = hourlyData.value.filter((d: any) => d.sensor_type === sType)
  const labels = filtered.map((d: any) => formatTimeLabel(d.time))
  const colors = CHART_COLORS[sType] || { border: '#666', bg: 'rgba(100,100,100,0.1)' }
  const weatherField = sType === 'temperature' ? 'temperature' : 'humidity'
  const weatherColor = sType === 'temperature' ? CHART_COLORS.weather_temp : CHART_COLORS.weather_humidity
  const unit = sType === 'temperature' ? '°C' : '%'

  const datasets: any[] = [{
    label: `실내 ${selectedSensorLabel.value} (${unit})`,
    data: filtered.map((d: any) => Number(d.avg_value)),
    borderColor: colors.border,
    backgroundColor: colors.bg,
    tension: 0.4, fill: true,
    pointRadius: 3, pointBackgroundColor: colors.border,
  }]

  // 날씨 데이터 추가 (점선)
  if (weatherData.value.length > 0) {
    const weatherByTime = new Map(weatherData.value.map((w: any) => [formatTimeLabel(w.time), w]))
    datasets.push({
      label: `외부 ${selectedSensorLabel.value} (${unit})`,
      data: labels.map(t => {
        const w = weatherByTime.get(t)
        return w ? Number(w[weatherField]) : null
      }),
      borderColor: weatherColor.border,
      borderDash: [5, 5],
      tension: 0.4, fill: false,
      pointRadius: 2,
      pointBackgroundColor: weatherColor.border,
    })
  }

  return { labels, datasets }
})
```

**핵심 변경:**
- 범례 라벨: "온도" → "실내 온도", "외부 온도"
- 날씨 라인: `borderDash: [5, 5]` 점선, `pointRadius: 2` 작은 점
- `weatherByTime` Map으로 센서 시간 라벨에 날씨 데이터 매핑 (시간 정렬 보장)
- 날씨 데이터가 없으면(weatherData 빈 배열) 기존 센서 라인만 표시

#### 3-3-6. lineChartOptions 수정 (L306-339)

Chart.js `spanGaps: true` 추가로 날씨 데이터 null 구간을 선으로 연결:

```typescript
const lineChartOptions = computed(() => {
  const base: any = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index' as const, intersect: false },
    plugins: { legend: { position: 'bottom' as const } },
    spanGaps: true,
  }
  // ... 나머지 동일
})
```

---

## 4. 수정 파일 요약

| # | File | FR | 변경 내용 |
|---|------|-----|----------|
| 1 | `Reports.vue` L71 | FR-01 | "조회" @click → `onCustomQuery()` (updateDateRange 호출 추가) |
| 2 | `backend/database/schema.sql` | FR-02 | `weather_data` 테이블 DDL + Hypertable + 인덱스 |
| 3 | `backend/src/modules/weather/weather-data.entity.ts` | FR-02 | WeatherData 엔티티 **(신규)** |
| 4 | `backend/src/modules/weather/weather-collector.service.ts` | FR-02 | 크론잡 수집 서비스 **(신규)** |
| 5 | `backend/src/modules/weather/weather.module.ts` | FR-02 | WeatherModule **(신규)** |
| 6 | `backend/src/modules/dashboard/dashboard.module.ts` | FR-02 | `exports: [DashboardService]` 추가 |
| 7 | `backend/src/app.module.ts` | FR-02 | WeatherModule import 추가 |
| 8 | `backend/src/modules/reports/reports.service.ts` | FR-03 | `getWeatherHourly()` 메서드 추가 |
| 9 | `backend/src/modules/reports/reports.controller.ts` | FR-03 | `GET /reports/weather-hourly` 엔드포인트 추가 |
| 10 | `frontend/src/api/report.api.ts` | FR-03 | `getWeatherHourly()` API 함수 추가 |
| 11 | `Reports.vue` script | FR-04 | `weatherData` ref + loadAllData에 날씨 추가 |
| 12 | `Reports.vue` chart | FR-04 | 차트 datasets에 날씨 점선 라인 + 범례 "실내/외부" |

**신규 파일**: 3개 (entity, service, module)
**백엔드 수정**: 4개 파일
**프론트엔드 수정**: 2개 파일
**인터페이스 변경**: 없음 (새 엔드포인트만 추가)

---

## 5. 구현 순서 (7 Phase, 12 Step)

### Phase 1: 리포트 조회 버그 수정 (FR-01)

| Step | 파일 | 작업 |
|------|------|------|
| 1-1 | Reports.vue | `onCustomQuery()` 함수 추가, "조회" 버튼 @click 변경 |

### Phase 2: weather_data DB + 엔티티 (FR-02)

| Step | 파일 | 작업 |
|------|------|------|
| 2-1 | schema.sql | weather_data 테이블 DDL (CREATE TABLE + Hypertable + 인덱스) |
| 2-2 | weather-data.entity.ts | WeatherData TypeORM 엔티티 생성 (신규 파일) |

### Phase 3: 날씨 수집 크론잡 (FR-02)

| Step | 파일 | 작업 |
|------|------|------|
| 3-1 | dashboard.module.ts | `exports: [DashboardService]` 추가 |
| 3-2 | weather-collector.service.ts | 크론잡 서비스 생성 (신규 파일) |
| 3-3 | weather.module.ts | WeatherModule 생성 (신규 파일) |
| 3-4 | app.module.ts | WeatherModule import 추가 |

### Phase 4: 날씨 조회 API (FR-03)

| Step | 파일 | 작업 |
|------|------|------|
| 4-1 | reports.service.ts | `getWeatherHourly()` 쿼리 메서드 추가 |
| 4-2 | reports.controller.ts | `GET /reports/weather-hourly` 엔드포인트 추가 |

### Phase 5: 프론트엔드 API 연동 (FR-03)

| Step | 파일 | 작업 |
|------|------|------|
| 5-1 | report.api.ts | `getWeatherHourly()` 함수 + WeatherHourlyParams 타입 추가 |

### Phase 6: 비교 차트 구현 (FR-04)

| Step | 파일 | 작업 |
|------|------|------|
| 6-1 | Reports.vue | `weatherData` ref 추가, `loadAllData()`에 날씨 API 추가, CHART_COLORS 확장 |
| 6-2 | Reports.vue | `sensorChartData` computed 수정 (날씨 점선 라인 + 범례 변경), `spanGaps` 추가 |

### Phase 7: 빌드 검증

| Step | 작업 |
|------|------|
| 7-1 | 프론트엔드 `npm run build` (vue-tsc + vite) 통과 확인 |
| 7-2 | 백엔드 `npm run build` (NestJS) 통과 확인 |

---

## 6. 영향도 분석

| 항목 | 영향 |
|------|------|
| 신규 의존성 | 없음 (`@nestjs/schedule` 이미 설치+등록 완료) |
| DB 변경 | `weather_data` 테이블 1개 추가 |
| 기존 API | 변경 없음, 새 엔드포인트만 추가 |
| 기존 UI | 차트 범례 변경 ("온도" → "실내 온도"), 날씨 데이터 없으면 기존과 동일 동작 |
| DashboardModule | `exports` 추가만, 기존 기능 영향 없음 |
| 성능 | 크론잡 매시간 1회, 사용자 수 × KMA API 호출 |
