# Design: 수확관리 추천 시스템 (harvest-recommendation)

> Plan 참조: `docs/01-plan/features/harvest-recommendation.plan.md`

## 0. 독립성 원칙

**이 기능은 삭제해도 다른 기능에 영향이 없어야 한다.**

| 원칙 | 구현 방법 |
|------|-----------|
| 기존 엔티티 수정 금지 | CropBatch, TaskTemplate, BatchTask, TaskOccurrence 변경 없음 |
| 기존 서비스 수정 금지 | HarvestService, HarvestTaskService 변경 없음 |
| 기존 컨트롤러 수정 금지 | HarvestController, HarvestTaskController 변경 없음 |
| 기존 API 수정 금지 | harvest.api.ts, harvest-task.api.ts 변경 없음 |
| 독립 테이블 사용 | `harvest_task_logs` 신규 테이블 1개만 (DROP 가능) |
| 독립 라우트 | `/harvest-rec` 별도 route (기존 `/harvest` 유지) |
| 센서 데이터 직접 조회 | DashboardService 의존 없이 DataSource raw query 사용 |

### 삭제 시 영향도: ZERO

```
삭제 대상 (독립 파일들):
  backend/
    src/modules/harvest-rec/               ← 폴더째 삭제
  frontend/
    src/views/HarvestRecommendation.vue    ← 파일 삭제
    src/api/harvest-recommendation.api.ts  ← 파일 삭제
  router/index.ts                          ← 1줄 route 제거

삭제 후 DB:
  DROP TABLE IF EXISTS harvest_task_logs;   ← 1줄

영향받는 기존 파일: 없음 (0개)
```

## 1. 백엔드 설계

### 1.1 모듈 구조

```
backend/src/modules/harvest-rec/
├── harvest-rec.module.ts            ← 독립 NestJS 모듈
├── harvest-rec.controller.ts        ← API 컨트롤러
├── harvest-rec.service.ts           ← 추천 엔진 + 센서 조회
├── entities/
│   └── harvest-task-log.entity.ts   ← 작업 완료 로그
└── dto/
    └── create-task-log.dto.ts       ← 완료 기록 DTO
```

**기존 `harvest/` 모듈과 완전 분리된 별도 모듈.**
AppModule에 `HarvestRecModule` 1줄 추가만 필요.

### 1.2 엔티티: HarvestTaskLog

```typescript
// backend/src/modules/harvest-rec/entities/harvest-task-log.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('harvest_task_logs')
export class HarvestTaskLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'batch_id', type: 'uuid' })
  batchId: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  // 'leaf_removal' | 'training' | 'pesticide'
  @Column({ name: 'task_type', type: 'varchar', length: 30 })
  taskType: string;

  @Column({ name: 'completed_at', type: 'timestamptz', default: () => 'NOW()' })
  completedAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
```

**DB 테이블 (synchronize: false이므로 수동 생성):**

```sql
CREATE TABLE harvest_task_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL,
  user_id UUID NOT NULL,
  task_type VARCHAR(30) NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_htl_batch_type ON harvest_task_logs(batch_id, task_type);
CREATE INDEX idx_htl_user ON harvest_task_logs(user_id);
```

> 참고: `REFERENCES crop_batches(id)` FK는 의도적으로 생략.
> 이유: FK가 있으면 이 테이블을 DROP할 때 crop_batches에 의존성이 생김.
> batch_id 정합성은 서비스 레벨에서 보장.

### 1.3 DTO

```typescript
// backend/src/modules/harvest-rec/dto/create-task-log.dto.ts
import { IsString, IsIn, IsUUID } from 'class-validator';

export class CreateTaskLogDto {
  @IsUUID()
  batchId: string;

  @IsString()
  @IsIn(['leaf_removal', 'training', 'pesticide'])
  taskType: string;
}
```

### 1.4 컨트롤러

```typescript
// backend/src/modules/harvest-rec/harvest-rec.controller.ts
@Controller('harvest-rec')
@UseGuards(JwtAuthGuard)
export class HarvestRecController {
  constructor(private readonly service: HarvestRecService) {}

  // 추천 카드 + 환경 요약 조회
  @Get('recommendations')
  getRecommendations(@CurrentUser() user: any) {
    const userId = getEffectiveUserId(user);
    return this.service.getRecommendations(userId);
  }

  // 작업 완료 기록
  @Post('task-logs')
  createTaskLog(@CurrentUser() user: any, @Body() dto: CreateTaskLogDto) {
    const userId = getEffectiveUserId(user);
    return this.service.createTaskLog(userId, dto);
  }

  // 작업 완료 이력 조회 (특정 배치)
  @Get('task-logs')
  getTaskLogs(@CurrentUser() user: any, @Query('batchId') batchId?: string) {
    const userId = getEffectiveUserId(user);
    return this.service.getTaskLogs(userId, batchId);
  }
}
```

### 1.5 서비스: 추천 엔진

```typescript
// backend/src/modules/harvest-rec/harvest-rec.service.ts
@Injectable()
export class HarvestRecService {
  constructor(
    @InjectRepository(HarvestTaskLog)
    private readonly logRepo: Repository<HarvestTaskLog>,
    @InjectRepository(CropBatch)
    private readonly batchRepo: Repository<CropBatch>,
    private readonly dataSource: DataSource,
  ) {}
}
```

> CropBatch는 **읽기 전용** 참조. 수정하지 않음.
> DataSource는 센서 데이터 raw query용.

#### getRecommendations(userId) 로직

```
1) 활성 배치 조회
   → batchRepo.findOne({ where: { userId, status: 'active' }, order: { createdAt: 'DESC' } })
   → 없으면 { activeBatch: null, cards: [], summary: emptyState } 반환

2) 센서 데이터 조회 (독립 쿼리 — DashboardService 미사용)
   a) 최신 온습도/이슬점
      → SELECT DISTINCT ON (sensor_type) sensor_type, value
        FROM sensor_data WHERE device_id = ANY(qxjIds)
        AND sensor_type IN ('temperature','humidity','dew_point')
        ORDER BY sensor_type, time DESC

   b) 6시간 습도 트렌드 (고습 시간 계산용)
      → SELECT value, time FROM sensor_data
        WHERE sensor_type = 'humidity'
        AND time >= NOW() - INTERVAL '6 hours'
        ORDER BY time ASC

   c) QXJ 디바이스 ID 조회
      → SELECT id FROM devices WHERE user_id = $1 AND category LIKE '%qxj%'

3) 작업 이력 조회
   → SELECT task_type, MAX(completed_at) as last_done
     FROM harvest_task_logs
     WHERE batch_id = $1
     GROUP BY task_type

4) 점수 계산 (3개 작업 타입별)
   → calcPriorityScore(taskType, daysSinceLast, envData, stage)
   → calcRiskScore(envData)
   → generateReasons(taskType, daysSinceLast, envData, stage)

5) 응답 조립
```

#### 점수 계산 상수

```typescript
// 작업 타입별 설정
const TASK_CONFIG = {
  leaf_removal: {
    name: '하엽 제거',
    icon: '🍃',
    intervalDays: 10,       // 기본 주기
    intervalMin: 7,
    intervalMax: 14,
    effectDuration: 7,      // 효과 지속 일수
  },
  training: {
    name: '유인 작업',
    icon: '🌿',
    intervalDays: 7,
    intervalMin: 5,
    intervalMax: 10,
    effectDuration: 5,
  },
  pesticide: {
    name: '농약(방제)',
    icon: '🧴',
    intervalDays: 12,
    intervalMin: 10,
    intervalMax: 14,
    effectDuration: 12,
  },
} as const;
```

#### priority_score 계산 (0~100)

```typescript
function calcPriorityScore(
  taskType: string,
  daysSinceLast: number | null,
  env: EnvData,
  stage: string,
): number {
  const config = TASK_CONFIG[taskType];
  const interval = config.intervalDays;

  // 1) 주기 기반 (0~35)
  let baseCycleScore = 0;
  if (daysSinceLast != null) {
    const ratio = daysSinceLast / interval;
    if (ratio < 0.5) baseCycleScore = ratio * 20;          // 0~10
    else if (ratio <= 1.0) baseCycleScore = 10 + (ratio - 0.5) * 30; // 10~25
    else baseCycleScore = Math.min(35, 25 + (ratio - 1) * 10);       // 25~35
  } else {
    // 한 번도 안 한 경우: 기본 20
    baseCycleScore = 20;
  }

  // 2) 환경 가중 (0~35, 작업별 다름)
  let envMod = 0;
  if (taskType === 'leaf_removal') {
    envMod = Math.min(35, env.highHumidityHours * 5 + env.condensationBonus);
  } else if (taskType === 'training') {
    const vpdBonus = env.vpdStatus === 'LOW' ? 15 : 0;
    const humBonus = (env.humidity ?? 0) > 80 ? 10 : (env.humidity ?? 0) > 70 ? 5 : 0;
    envMod = Math.min(35, vpdBonus + humBonus);
  } else if (taskType === 'pesticide') {
    envMod = Math.min(35, env.highHumidityHours * 8 + env.condensationBonus * 1.5);
  }

  // 3) 생육 단계 (0~10)
  const stageMod = stage === 'harvest' ? 10 : stage === 'flowering_fruit' ? 5 : 0;

  // 4) 효과 감경 (0~15)
  let effectMod = 0;
  if (daysSinceLast != null && daysSinceLast < config.effectDuration) {
    effectMod = 15 * ((config.effectDuration - daysSinceLast) / config.effectDuration);
  }

  return Math.round(
    Math.max(0, Math.min(100, baseCycleScore + envMod + stageMod - effectMod))
  );
}
```

#### risk_score 계산 (0~100)

```typescript
function calcRiskScore(env: EnvData, daysSinceLast: number | null, interval: number): number {
  const humidityRisk = Math.min(40, env.highHumidityHours * 7);
  const condensationRisk = env.condensationBonus;  // 0/5/10/15 → scale to 0/10/20/30
  const vpdRisk = env.vpdStatus === 'LOW' ? 15 : env.vpdStatus === 'HIGH' ? 10 : 0;

  let delayRisk = 0;
  if (daysSinceLast != null) {
    const overdue = Math.max(0, daysSinceLast - interval);
    delayRisk = Math.min(15, overdue * 3);
  }

  return Math.round(Math.max(0, Math.min(100, humidityRisk + condensationRisk + vpdRisk + delayRisk)));
}
```

#### 고습 시간 계산

```typescript
function calcHighHumidityHours(trend6h: { value: number; time: string }[]): number {
  if (trend6h.length < 2) return 0;
  let highCount = 0;
  for (const point of trend6h) {
    if (point.value > 80) highCount++;
  }
  // 6시간 내 데이터포인트 중 80%+ 비율 → 시간 환산
  return Math.round((highCount / trend6h.length) * 6 * 10) / 10;
}
```

#### condensationBonus 매핑

```typescript
// 결로위험 등급 → 점수 보너스
function getCondensationBonus(temp: number | null, dewPoint: number | null): number {
  if (temp == null || dewPoint == null) return 0;
  const margin = temp - dewPoint;
  if (margin < 1) return 15;  // critical
  if (margin < 2) return 10;  // danger
  if (margin < 4) return 5;   // warning
  return 0;                    // safe
}
```

#### 추천 사유 생성

```typescript
function generateReasons(
  taskType: string, daysSinceLast: number | null,
  env: EnvData, stage: string, interval: number,
): string[] {
  const reasons: string[] = [];

  // 환경 사유
  if (env.highHumidityHours >= 3) {
    reasons.push(`최근 6시간 고습 ${env.highHumidityHours}시간 지속`);
  } else if (env.highHumidityHours >= 1) {
    reasons.push(`고습 환경 감지 (${env.highHumidityHours}시간)`);
  }

  if (env.condensationLevel === 'critical' || env.condensationLevel === 'danger') {
    reasons.push('결로 위험 증가 감지');
  }

  if (env.vpdStatus === 'LOW') {
    reasons.push('과습으로 곰팡이 위험 상승');
  } else if (env.vpdStatus === 'HIGH') {
    reasons.push('건조 스트레스 감지');
  }

  // 주기 사유
  if (daysSinceLast != null && daysSinceLast > interval * 1.2) {
    reasons.push(`작업 주기 초과 (${daysSinceLast}일 경과)`);
  } else if (daysSinceLast == null) {
    reasons.push('첫 작업 필요');
  }

  // 단계 사유
  if (stage === 'harvest') {
    reasons.push('수확기 품질 관리 강화 권장');
  }

  // fallback
  if (reasons.length === 0) {
    reasons.push('정기 관리 권장');
  }

  return reasons;
}
```

#### 상태 판정

```typescript
type TaskStatus = 'NORMAL' | 'UPCOMING' | 'DELAYED' | 'URGENT';

function determineStatus(
  priorityScore: number, riskScore: number,
  delayRatio: number, windowStart: string,
): TaskStatus {
  if (riskScore >= 75) return 'URGENT';
  if (delayRatio >= 0.5) return 'DELAYED';

  const today = new Date();
  const start = new Date(windowStart);
  const diffDays = Math.ceil((start.getTime() - today.getTime()) / 86400000);
  if (diffDays <= 1 && diffDays >= 0) return 'UPCOMING';

  return 'NORMAL';
}
```

#### 권장 기간 계산

```typescript
function calcRecommendedWindow(
  daysSinceLast: number | null, config: TaskConfig,
): { start: string; end: string } {
  const today = new Date();

  if (daysSinceLast == null) {
    // 한 번도 안 함 → 오늘부터 3일
    const end = new Date(today);
    end.setDate(end.getDate() + 3);
    return { start: formatDate(today), end: formatDate(end) };
  }

  // 다음 권장일 = 마지막 완료일 + intervalMin ~ intervalMax
  // daysSinceLast는 이미 경과일이므로 남은 일수 계산
  const daysUntilMin = Math.max(0, config.intervalMin - daysSinceLast);
  const daysUntilMax = Math.max(0, config.intervalMax - daysSinceLast);

  const start = new Date(today);
  start.setDate(start.getDate() + daysUntilMin);
  const end = new Date(today);
  end.setDate(end.getDate() + daysUntilMax);

  return { start: formatDate(start), end: formatDate(end) };
}
```

### 1.6 API 응답 스키마

#### GET /harvest-rec/recommendations

```typescript
interface RecommendationsResponse {
  summary: {
    status: 'good' | 'caution' | 'warning';
    statusLabel: string;
    mainReason: string;
    subInfo: string;
  };
  cards: {
    taskType: string;
    taskName: string;
    icon: string;
    priorityScore: number;
    riskScore: number;
    delayRatio: number;
    daysSinceLast: number | null;
    recommendedWindowStart: string;
    recommendedWindowEnd: string;
    status: 'NORMAL' | 'UPCOMING' | 'DELAYED' | 'URGENT';
    reasons: string[];
    effectRemaining: number | null;
    lastCompletedAt: string | null;
  }[];
  environment: {
    temperature: number | null;
    humidity: number | null;
    dewPoint: number | null;
    vpdValue: number | null;
    vpdStatus: string | null;
    condensationLevel: string | null;
    highHumidityHours: number;
  };
  activeBatch: {
    id: string;
    cropName: string;
    currentStage: string;
    sowDate: string;
    transplantDate: string | null;
    growDays: number;
  } | null;
}
```

#### POST /harvest-rec/task-logs

요청:
```json
{ "batchId": "uuid", "taskType": "leaf_removal" }
```

응답:
```json
{ "id": "uuid", "taskType": "leaf_removal", "completedAt": "2026-02-25T..." }
```

### 1.7 모듈 등록

```typescript
// backend/src/modules/harvest-rec/harvest-rec.module.ts
@Module({
  imports: [TypeOrmModule.forFeature([HarvestTaskLog, CropBatch, Device])],
  controllers: [HarvestRecController],
  providers: [HarvestRecService],
})
export class HarvestRecModule {}
```

```typescript
// app.module.ts — 1줄 추가
imports: [
  // ... 기존 모듈들
  HarvestModule,
  HarvestRecModule,  // ← 추가 (삭제 시 이 줄만 제거)
]
```

> CropBatch, Device는 TypeOrmModule.forFeature로 직접 등록.
> 기존 HarvestModule에 의존하지 않음.

## 2. 프론트엔드 설계

### 2.1 파일 구조

```
frontend/src/
├── api/
│   └── harvest-recommendation.api.ts    ← 독립 API 클라이언트
├── views/
│   └── HarvestRecommendation.vue        ← 독립 뷰 (기존 Harvest.vue 유지)
└── router/
    └── index.ts                         ← 1줄 route 추가
```

### 2.2 라우트

```typescript
// router/index.ts — 기존 harvest route 유지, 새 route 추가
{
  path: '/harvest',
  name: 'harvest',
  component: () => import('../views/Harvest.vue'),       // 기존 유지
  meta: { title: '수확 관리', requiresAuth: true }
},
{
  path: '/harvest-rec',
  name: 'harvest-rec',
  component: () => import('../views/HarvestRecommendation.vue'),  // 신규
  meta: { title: '수확 관리', requiresAuth: true }
},
```

> 완성 후 사이드바에서 `/harvest` → `/harvest-rec`으로 교체.
> 되돌리려면 사이드바만 원복하면 됨.

### 2.3 API 클라이언트

```typescript
// frontend/src/api/harvest-recommendation.api.ts
import client from './client';

export interface RecommendationCard {
  taskType: string;
  taskName: string;
  icon: string;
  priorityScore: number;
  riskScore: number;
  delayRatio: number;
  daysSinceLast: number | null;
  recommendedWindowStart: string;
  recommendedWindowEnd: string;
  status: 'NORMAL' | 'UPCOMING' | 'DELAYED' | 'URGENT';
  reasons: string[];
  effectRemaining: number | null;
  lastCompletedAt: string | null;
}

export interface RecommendationsResponse {
  summary: {
    status: 'good' | 'caution' | 'warning';
    statusLabel: string;
    mainReason: string;
    subInfo: string;
  };
  cards: RecommendationCard[];
  environment: {
    temperature: number | null;
    humidity: number | null;
    dewPoint: number | null;
    vpdValue: number | null;
    vpdStatus: string | null;
    condensationLevel: string | null;
    highHumidityHours: number;
  };
  activeBatch: {
    id: string;
    cropName: string;
    currentStage: string;
    sowDate: string;
    transplantDate: string | null;
    growDays: number;
  } | null;
}

export const harvestRecApi = {
  getRecommendations: () =>
    client.get<RecommendationsResponse>('/harvest-rec/recommendations'),

  createTaskLog: (batchId: string, taskType: string) =>
    client.post('/harvest-rec/task-logs', { batchId, taskType }),

  getTaskLogs: (batchId?: string) =>
    client.get('/harvest-rec/task-logs', { params: { batchId } }),
};
```

### 2.4 HarvestRecommendation.vue 구조

```
<template>
  <!-- 헤더 -->
  <header>
    "수확 관리" 타이틀 + 배치 설정 토글 버튼
  </header>

  <!-- 배치 없음 Empty State -->
  <EmptyState v-if="!activeBatch">
    "작물 배치를 등록하면 환경 기반 관리 추천이 시작됩니다"
    [+ 배치 추가] 버튼
  </EmptyState>

  <!-- 메인 컨텐츠 (배치 있을 때) -->
  <template v-else>

    <!-- 환경 요약 배너 -->
    <SummaryBanner :summary="data.summary" :environment="data.environment" />

    <!-- 추천 카드 3개 -->
    <div class="recommendation-cards">
      <RecommendationCard
        v-for="card in data.cards"
        :key="card.taskType"
        :card="card"
        :highlight="card === topCards[0] || card === topCards[1]"
        @complete="handleComplete(card.taskType)"
        @postpone="handlePostpone(card.taskType)"
      />
    </div>

    <!-- 배치 정보 (접이식) -->
    <CollapsibleSection title="배치 설정">
      <BatchInfo :batch="data.activeBatch" />
      <button @click="openBatchModal">배치 수정</button>
    </CollapsibleSection>

  </template>

  <!-- 배치 추가/수정 모달 (기존 로직 재사용 — 복사) -->
  <BatchModal v-if="showBatchModal" ... />
</template>
```

#### 배치 관리 독립성

기존 `Harvest.vue`의 배치 추가/수정 모달 로직을 **복사**해서 사용.
기존 `harvest.api.ts`를 **import**하여 배치 CRUD API 호출.

```typescript
// 배치 관리는 기존 API 사용 (읽기 + 생성 + 수정만)
import { harvestApi } from '../api/harvest.api';
import type { CropBatch, CreateBatchRequest } from '../api/harvest.api';
```

> 기존 harvest.api.ts는 수정하지 않음. 그냥 import해서 사용.

### 2.5 카드 UI 설계

```
┌─────────────────────────────────┐
│ 🍃 하엽 제거                     │
│                                 │
│ 우선순위      82  🔴              │
│ ━━━━━━━━━━━━━━━━━━━━━━ (게이지)  │
│                                 │
│ 📅 권장: 02/26 ~ 02/28          │
│ ⏱ 상태: D+3 작업 지연됨          │
│ 📋 마지막 완료: 13일 전           │
│                                 │
│ 💡 추천 이유:                    │
│   · 최근 6시간 고습 3.2시간 지속   │
│   · 결로 위험 증가 감지           │
│                                 │
│ 방제 효과: ━━━━━░░░░░ 3일 남음    │  ← effectRemaining이 있을 때만
│                                 │
│ [  ✓ 완료  ]   [ 1일 미루기 ]    │
└─────────────────────────────────┘
```

#### 점수 게이지 색상

```css
/* 0~39: green, 40~69: yellow, 70~100: red */
.score-gauge.green  { background: #4CAF50; }
.score-gauge.yellow { background: #FFC107; }
.score-gauge.red    { background: #F44336; }
```

#### 상태 배지

```css
.status-badge.NORMAL   { background: rgba(76,175,80,0.1); color: #2E7D32; }
.status-badge.UPCOMING { background: rgba(255,193,7,0.1); color: #F57F17; }
.status-badge.DELAYED  { background: rgba(255,152,0,0.1); color: #E65100; }
.status-badge.URGENT   { background: rgba(244,67,54,0.1); color: #C62828; }
```

### 2.6 인터랙션

#### 완료 처리

```typescript
async function handleComplete(taskType: string) {
  if (!data.value?.activeBatch) return;
  await harvestRecApi.createTaskLog(data.value.activeBatch.id, taskType);
  await loadRecommendations(); // 즉시 점수 반영
}
```

#### 1일 미루기

```typescript
function handlePostpone(taskType: string) {
  const key = `snooze:${data.value?.activeBatch?.id}:${taskType}`;
  localStorage.setItem(key, new Date().toISOString().slice(0, 10));
  // 카드 시각적으로 투명하게 처리 (점수 계산에 영향 없음)
  snoozed.value.add(taskType);
}

// 매일 자동 해제
const snoozed = ref(new Set<string>());
function loadSnoozeState() {
  const today = new Date().toISOString().slice(0, 10);
  for (const type of ['leaf_removal', 'training', 'pesticide']) {
    const key = `snooze:${data.value?.activeBatch?.id}:${type}`;
    const saved = localStorage.getItem(key);
    if (saved && saved === today) {
      snoozed.value.add(type);
    } else if (saved) {
      localStorage.removeItem(key); // 만료 → 삭제
    }
  }
}
```

### 2.7 사이드바 교체

```typescript
// frontend/src/components/layout/Sidebar.vue 또는 해당 파일
// 기존: { path: '/harvest', label: '수확 관리', icon: '🌾' }
// 변경: { path: '/harvest-rec', label: '수확 관리', icon: '🌾' }
```

> 되돌리기: path를 `/harvest`로 원복하면 됨.

## 3. 구현 순서

| 순서 | 작업 | 파일 |
|------|------|------|
| 1 | DB 테이블 생성 | psql: `CREATE TABLE harvest_task_logs` |
| 2 | 백엔드 엔티티 | `harvest-rec/entities/harvest-task-log.entity.ts` |
| 3 | 백엔드 DTO | `harvest-rec/dto/create-task-log.dto.ts` |
| 4 | 백엔드 서비스 | `harvest-rec/harvest-rec.service.ts` |
| 5 | 백엔드 컨트롤러 | `harvest-rec/harvest-rec.controller.ts` |
| 6 | 백엔드 모듈 | `harvest-rec/harvest-rec.module.ts` + app.module.ts 등록 |
| 7 | 프론트엔드 API | `api/harvest-recommendation.api.ts` |
| 8 | 프론트엔드 뷰 | `views/HarvestRecommendation.vue` |
| 9 | 라우터 등록 | `router/index.ts` — 1줄 추가 |
| 10 | 사이드바 교체 | 사이드바 `/harvest` → `/harvest-rec` |
| 11 | 빌드 & 테스트 | `npm run build` |

## 4. 삭제 가이드 (Rollback)

```bash
# 1) 사이드바 원복 (/harvest-rec → /harvest)
# 2) 라우터에서 /harvest-rec route 제거
# 3) 파일 삭제
rm -rf backend/src/modules/harvest-rec/
rm frontend/src/views/HarvestRecommendation.vue
rm frontend/src/api/harvest-recommendation.api.ts
# 4) app.module.ts에서 HarvestRecModule import 제거
# 5) DB 테이블 삭제
psql -c "DROP TABLE IF EXISTS harvest_task_logs;"
# 6) 빌드
npm run build
```

기존 `/harvest` 페이지가 그대로 살아있으므로 **즉시 원래대로 동작.**
