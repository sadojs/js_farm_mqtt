# 생육단계 기반 작업 관리 (Stage-Based Task Management) Design Document

> **Summary**: crop_batches에 생육단계/정식일/그룹ID 추가, task_templates를 단계+유연간격으로 리디자인, 생육 피드백 기반 간격 조정, Harvest.vue에 작업 탭 통합
>
> **Project**: smart-farm-platform
> **Author**: AI Assistant
> **Date**: 2026-02-24
> **Status**: Draft
> **Plan Reference**: `docs/01-plan/features/stage-based-task-management.plan.md`

---

## 1. DB 스키마 변경

### 1.1 crop_batches ALTER

```sql
-- 그룹 연동
ALTER TABLE crop_batches ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES house_groups(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_crop_batches_group ON crop_batches(group_id);

-- 정식일
ALTER TABLE crop_batches ADD COLUMN IF NOT EXISTS transplant_date DATE;

-- 생육단계
ALTER TABLE crop_batches ADD COLUMN IF NOT EXISTS current_stage VARCHAR(30) DEFAULT 'seedling';
ALTER TABLE crop_batches ADD COLUMN IF NOT EXISTS stage_started_at TIMESTAMPTZ DEFAULT NOW();

-- house_name을 optional로 변경 (기존 NOT NULL → 제약 삭제 or default '')
-- 기존 데이터 호환을 위해 유지, 새 배치는 그룹에서 자동 설정
```

### 1.2 task_templates ALTER

```sql
-- 작물 유형 + 단계
ALTER TABLE task_templates ADD COLUMN IF NOT EXISTS crop_type VARCHAR(50) DEFAULT 'cherry_tomato';
ALTER TABLE task_templates ADD COLUMN IF NOT EXISTS stage_name VARCHAR(30);

-- 유연한 간격 (min/max)
ALTER TABLE task_templates ADD COLUMN IF NOT EXISTS interval_min_days INT;
ALTER TABLE task_templates ADD COLUMN IF NOT EXISTS interval_max_days INT;

-- 기존 interval_days는 유지 (호환용, 새 로직에서는 min/max 우선 사용)
```

### 1.3 task_occurrences ALTER

```sql
-- 생육 피드백
ALTER TABLE task_occurrences ADD COLUMN IF NOT EXISTS growth_feedback VARCHAR(20);
-- growth_fast, normal, growth_slow

-- 허용 윈도우 종료일
ALTER TABLE task_occurrences ADD COLUMN IF NOT EXISTS window_end_date DATE;
```

### 1.4 프리셋 데이터 교체

```sql
-- 기존 프리셋 삭제
DELETE FROM task_templates WHERE is_preset = true;

-- 새 7종 프리셋 삽입 (onModuleInit에서 처리)
```

---

## 2. Backend 엔티티 변경

### 2.1 CropBatch 엔티티 수정

파일: `backend/src/modules/harvest/entities/crop-batch.entity.ts`

```typescript
// 추가 컬럼
@Column({ name: 'group_id', type: 'uuid', nullable: true })
groupId: string;

@Column({ name: 'transplant_date', type: 'date', nullable: true })
transplantDate: string;

@Column({ name: 'current_stage', default: 'seedling' })
currentStage: string;

@Column({ name: 'stage_started_at', type: 'timestamptz', nullable: true })
stageStartedAt: Date;
```

### 2.2 TaskTemplate 엔티티 수정

파일: `backend/src/modules/harvest/entities/task-template.entity.ts`

```typescript
// 추가 컬럼
@Column({ name: 'crop_type', default: 'cherry_tomato' })
cropType: string;

@Column({ name: 'stage_name', nullable: true })
stageName: string;

@Column({ name: 'interval_min_days', type: 'int', nullable: true })
intervalMinDays: number;

@Column({ name: 'interval_max_days', type: 'int', nullable: true })
intervalMaxDays: number;

// 기존 intervalDays 유지
```

### 2.3 TaskOccurrence 엔티티 수정

파일: `backend/src/modules/harvest/entities/task-occurrence.entity.ts`

```typescript
// 추가 컬럼
@Column({ name: 'growth_feedback', nullable: true })
growthFeedback: string;

@Column({ name: 'window_end_date', type: 'date', nullable: true })
windowEndDate: string;
```

---

## 3. Backend DTO 변경

### 3.1 CreateBatchDto 수정

파일: `backend/src/modules/harvest/dto/create-batch.dto.ts`

```typescript
export class CreateBatchDto {
  @IsString() cropName: string;
  @IsOptional() @IsString() variety?: string;
  @IsOptional() @IsString() houseName?: string;  // optional로 변경
  @IsOptional() @IsUUID() houseId?: string;
  @IsOptional() @IsUUID() groupId?: string;       // NEW
  @IsDateString() sowDate: string;
  @IsOptional() @IsDateString() transplantDate?: string;  // NEW
  @IsInt() @Min(1) @Max(365) growDays: number;
  @IsOptional() @IsString() stage?: string;
  @IsOptional() @IsString() memo?: string;
}

export class UpdateBatchDto {
  // 위와 동일하되 모두 @IsOptional()
  @IsOptional() @IsUUID() groupId?: string;           // NEW
  @IsOptional() @IsDateString() transplantDate?: string; // NEW
  // ... 기존 필드들
}

// NEW: 단계 변경 DTO
export class ChangeStageDto {
  @IsIn(['seedling', 'vegetative', 'flowering_fruit', 'harvest'])
  stage: string;
}
```

### 3.2 CreateTaskTemplateDto 수정

파일: `backend/src/modules/harvest/dto/task-template.dto.ts`

```typescript
export class CreateTaskTemplateDto {
  @IsString() taskName: string;
  @IsOptional() @IsString() cropType?: string;      // NEW
  @IsOptional() @IsIn(['seedling', 'vegetative', 'flowering_fruit', 'harvest'])
  stageName?: string;                                  // NEW
  @IsInt() @Min(1) @Max(365) intervalDays: number;    // 호환 유지
  @IsOptional() @IsInt() @Min(1) intervalMinDays?: number;  // NEW
  @IsOptional() @IsInt() @Min(1) intervalMaxDays?: number;  // NEW
  @IsInt() @Min(0) startOffsetDays: number;
  @IsOptional() @IsIn(['anchor', 'shift', 'one_time']) defaultRescheduleMode?: string;
}
```

### 3.3 CompleteOccurrenceDto 수정

파일: `backend/src/modules/harvest/dto/occurrence-action.dto.ts`

```typescript
export class CompleteOccurrenceDto {
  @IsIn(['anchor', 'shift', 'one_time']) rescheduleMode: string;
  @IsOptional() @IsBoolean() rememberChoice?: boolean;
  @IsOptional() @IsString() memo?: string;
  @IsOptional() @IsIn(['growth_fast', 'normal', 'growth_slow'])
  growthFeedback?: string;   // NEW
}
```

---

## 4. Backend 서비스 리디자인

### 4.1 HarvestTaskService — 핵심 변경

파일: `backend/src/modules/harvest/harvest-task.service.ts`

#### 4.1.1 프리셋 교체 (onModuleInit)

```typescript
const STAGE_TASK_PRESETS = [
  // seedling
  { taskName: '육묘 점검', cropType: 'cherry_tomato', stageName: 'seedling',
    intervalMinDays: 3, intervalMaxDays: 3, startOffsetDays: 0, defaultRescheduleMode: 'anchor' },
  // vegetative
  { taskName: '순따기', cropType: 'cherry_tomato', stageName: 'vegetative',
    intervalMinDays: 5, intervalMaxDays: 7, startOffsetDays: 7, defaultRescheduleMode: 'anchor' },
  { taskName: '유인', cropType: 'cherry_tomato', stageName: 'vegetative',
    intervalMinDays: 7, intervalMaxDays: 7, startOffsetDays: 0, defaultRescheduleMode: 'anchor' },
  { taskName: '병해충 점검', cropType: 'cherry_tomato', stageName: 'vegetative',
    intervalMinDays: 7, intervalMaxDays: 7, startOffsetDays: 0, defaultRescheduleMode: 'anchor' },
  // flowering_fruit
  { taskName: '화방 점검', cropType: 'cherry_tomato', stageName: 'flowering_fruit',
    intervalMinDays: 5, intervalMaxDays: 5, startOffsetDays: 0, defaultRescheduleMode: 'anchor' },
  { taskName: '적엽', cropType: 'cherry_tomato', stageName: 'flowering_fruit',
    intervalMinDays: 10, intervalMaxDays: 14, startOffsetDays: 7, defaultRescheduleMode: 'anchor' },
  // harvest
  { taskName: '수확 점검', cropType: 'cherry_tomato', stageName: 'harvest',
    intervalMinDays: 2, intervalMaxDays: 2, startOffsetDays: 0, defaultRescheduleMode: 'shift' },
];
```

onModuleInit에서:
1. 기존 is_preset=true인 모든 레코드 삭제
2. 새 7종 삽입 (intervalDays = Math.ceil((min+max)/2) 호환 설정)

#### 4.1.2 배치에 단계별 템플릿 자동 적용

```typescript
async applyStageTemplates(userId: string, batchId: string, stage: string): Promise<void> {
  const batch = await this.batchRepo.findOneOrFail({ where: { id: batchId, userId } });
  const templates = await this.templateRepo.find({
    where: { stageName: stage, isPreset: true },
  });

  for (const template of templates) {
    // 이미 적용된 템플릿은 스킵
    const existing = await this.batchTaskRepo.findOne({
      where: { batchId, templateId: template.id },
    });
    if (existing) continue;

    const anchorDate = this.calcAnchorDate(batch, template);
    const batchTask = this.batchTaskRepo.create({
      batchId, templateId: template.id, anchorDate,
      rescheduleMode: template.defaultRescheduleMode,
    });
    const saved = await this.batchTaskRepo.save(batchTask);
    await this.generateFlexOccurrences(saved, template, OCCURRENCE_DAYS);
  }
}
```

#### 4.1.3 유연한 간격 occurrence 생성

```typescript
private async generateFlexOccurrences(
  batchTask: BatchTask, template: TaskTemplate, days: number
): Promise<void> {
  const minDays = template.intervalMinDays || template.intervalDays;
  const maxDays = template.intervalMaxDays || template.intervalDays;
  const midDays = Math.ceil((minDays + maxDays) / 2);
  const windowExtra = maxDays - minDays;

  const anchor = new Date(batchTask.anchorDate);
  const today = new Date(); today.setHours(0,0,0,0);
  const endDate = new Date(today);
  endDate.setDate(endDate.getDate() + days);

  const occurrences: Partial<TaskOccurrence>[] = [];
  for (let k = 0; ; k++) {
    const schedDate = new Date(anchor);
    schedDate.setDate(schedDate.getDate() + k * midDays);
    if (schedDate > endDate) break;
    if (schedDate < today) continue;

    const windowEnd = new Date(schedDate);
    windowEnd.setDate(windowEnd.getDate() + windowExtra);

    occurrences.push({
      batchTaskId: batchTask.id,
      batchId: batchTask.batchId,
      scheduledDate: schedDate.toISOString().slice(0,10),
      windowEndDate: windowEnd.toISOString().slice(0,10),
      status: 'planned',
    });
  }

  if (occurrences.length > 0) {
    await this.occurrenceRepo.createQueryBuilder()
      .insert().into(TaskOccurrence)
      .values(occurrences as any[]).execute();
  }
}
```

#### 4.1.4 생육 피드백 → 다음 간격 조정

```typescript
async completeOccurrence(userId: string, id: string, dto: CompleteOccurrenceDto) {
  const occurrence = await this.occurrenceRepo.findOneOrFail({ where: { id } });
  await this.batchRepo.findOneOrFail({ where: { id: occurrence.batchId, userId } });

  const today = new Date().toISOString().slice(0,10);
  occurrence.status = 'done';
  occurrence.doneDate = today;
  if (dto.memo) occurrence.memo = dto.memo;
  if (dto.growthFeedback) occurrence.growthFeedback = dto.growthFeedback;
  await this.occurrenceRepo.save(occurrence);

  // Remember choice
  if (dto.rememberChoice) {
    await this.batchTaskRepo.update(
      { id: occurrence.batchTaskId },
      { rescheduleMode: dto.rescheduleMode as any },
    );
  }

  // 생육 피드백 기반 다음 간격 조정
  if (dto.growthFeedback && dto.rescheduleMode === 'shift') {
    await this.rescheduleWithFeedback(occurrence, dto.rescheduleMode, dto.growthFeedback);
  } else {
    await this.reschedule(occurrence, dto.rescheduleMode);
  }
  return occurrence;
}

private async rescheduleWithFeedback(
  occurrence: TaskOccurrence, mode: string, feedback: string
): Promise<void> {
  const batchTask = await this.batchTaskRepo.findOneOrFail({
    where: { id: occurrence.batchTaskId },
  });
  const template = await this.templateRepo.findOneOrFail({
    where: { id: batchTask.templateId },
  });

  const minDays = template.intervalMinDays || template.intervalDays;
  const maxDays = template.intervalMaxDays || template.intervalDays;

  let nextInterval: number;
  switch (feedback) {
    case 'growth_fast': nextInterval = minDays; break;
    case 'growth_slow': nextInterval = maxDays; break;
    default: nextInterval = Math.ceil((minDays + maxDays) / 2); break;
  }

  // shift 모드: 완료일 + nextInterval이 새 anchor
  batchTask.anchorDate = occurrence.doneDate;
  await this.batchTaskRepo.save(batchTask);

  // 기존 planned 삭제
  await this.occurrenceRepo.createQueryBuilder()
    .delete().from(TaskOccurrence)
    .where('batch_task_id = :batchTaskId', { batchTaskId: batchTask.id })
    .andWhere('status = :status', { status: 'planned' })
    .andWhere('scheduled_date > :doneDate', { doneDate: occurrence.doneDate })
    .execute();

  // nextInterval 기반 재생성
  await this.generateFlexOccurrencesWithInterval(
    batchTask, template, OCCURRENCE_DAYS, nextInterval
  );
}
```

#### 4.1.5 단계 변경 로직

```typescript
async changeStage(userId: string, batchId: string, newStage: string): Promise<CropBatch> {
  const batch = await this.batchRepo.findOneOrFail({ where: { id: batchId, userId } });
  const oldStage = batch.currentStage;
  if (oldStage === newStage) return batch;

  // 1. 이전 단계 planned occurrence → skipped
  await this.archiveStageOccurrences(batchId, oldStage);

  // 2. batch 업데이트
  batch.currentStage = newStage;
  batch.stageStartedAt = new Date();
  await this.batchRepo.save(batch);

  // 3. 새 단계 템플릿 자동 적용
  await this.applyStageTemplates(userId, batchId, newStage);

  return batch;
}

private async archiveStageOccurrences(batchId: string, stage: string): Promise<void> {
  // stage에 해당하는 template들의 batch_task → planned occurrence를 skipped로 변경
  const templates = await this.templateRepo.find({
    where: { stageName: stage, isPreset: true },
  });
  const templateIds = templates.map(t => t.id);
  if (templateIds.length === 0) return;

  const batchTasks = await this.batchTaskRepo
    .createQueryBuilder('bt')
    .where('bt.batch_id = :batchId', { batchId })
    .andWhere('bt.template_id IN (:...templateIds)', { templateIds })
    .getMany();

  for (const bt of batchTasks) {
    await this.occurrenceRepo
      .createQueryBuilder()
      .update(TaskOccurrence)
      .set({ status: 'skipped' as any })
      .where('batch_task_id = :btId', { btId: bt.id })
      .andWhere('status = :status', { status: 'planned' })
      .execute();

    bt.isActive = false;
    await this.batchTaskRepo.save(bt);
  }
}
```

#### 4.1.6 단계 자동 판정

```typescript
determineStage(sowDate: string, transplantDate?: string): string {
  const today = new Date(); today.setHours(0,0,0,0);
  if (!transplantDate) return 'seedling';

  const tp = new Date(transplantDate);
  if (today < tp) return 'seedling';

  const daysSinceTransplant = Math.floor((today.getTime() - tp.getTime()) / 86400000);
  if (daysSinceTransplant >= 65) return 'harvest';
  if (daysSinceTransplant >= 30) return 'flowering_fruit';
  return 'vegetative';
}
```

#### 4.1.7 배치별 작업 요약 (NEW API)

```typescript
async getTaskSummary(userId: string, batchId: string) {
  const today = new Date().toISOString().slice(0,10);
  const todayTasks = await this.occurrenceRepo
    .createQueryBuilder('o')
    .innerJoin('batch_tasks', 'bt', 'bt.id = o.batch_task_id')
    .innerJoin('task_templates', 'tt', 'tt.id = bt.template_id')
    .select(['o.id AS "id"', 'o.scheduled_date AS "scheduledDate"',
             'o.status AS "status"', 'o.window_end_date AS "windowEndDate"',
             'tt.task_name AS "taskName"'])
    .where('o.batch_id = :batchId', { batchId })
    .andWhere('o.status = :status', { status: 'planned' })
    .andWhere('o.scheduled_date <= :today', { today })
    .orderBy('o.scheduled_date', 'ASC')
    .getRawMany();

  const upcoming = await this.occurrenceRepo
    .createQueryBuilder('o')
    .innerJoin('batch_tasks', 'bt', 'bt.id = o.batch_task_id')
    .innerJoin('task_templates', 'tt', 'tt.id = bt.template_id')
    .select(['o.id AS "id"', 'o.scheduled_date AS "scheduledDate"',
             'o.window_end_date AS "windowEndDate"',
             'tt.task_name AS "taskName"'])
    .where('o.batch_id = :batchId', { batchId })
    .andWhere('o.status = :status', { status: 'planned' })
    .andWhere('o.scheduled_date > :today', { today })
    .orderBy('o.scheduled_date', 'ASC')
    .limit(2)
    .getRawMany();

  return { todayTasks, upcoming };
}
```

### 4.2 HarvestService — 배치 생성 확장

파일: `backend/src/modules/harvest/harvest.service.ts`

```typescript
// create 메서드 수정
async create(userId: string, dto: CreateBatchDto) {
  // groupId → group 정보에서 houseName 자동 설정
  let houseName = dto.houseName || '';
  if (dto.groupId && !dto.houseName) {
    // groupId로 그룹명 조회하여 houseName에 설정 (역호환)
    const group = await this.dataSource.getRepository('HouseGroup')
      .findOne({ where: { id: dto.groupId } });
    if (group) houseName = (group as any).name;
  }

  const batch = this.batchRepo.create({
    ...dto,
    userId,
    houseName,
  });
  return this.batchRepo.save(batch);
}
```

### 4.3 HarvestTaskController — 새 API

파일: `backend/src/modules/harvest/harvest-task.controller.ts`

```typescript
// 추가 엔드포인트

@Put('batches/:batchId/stage')
changeStage(
  @CurrentUser() user: any,
  @Param('batchId') batchId: string,
  @Body() dto: ChangeStageDto,
) {
  return this.taskService.changeStage(
    this.getEffectiveUserId(user), batchId, dto.stage
  );
}

@Get('batches/:batchId/task-summary')
getTaskSummary(
  @CurrentUser() user: any,
  @Param('batchId') batchId: string,
) {
  return this.taskService.getTaskSummary(
    this.getEffectiveUserId(user), batchId
  );
}
```

### 4.4 findOccurrences 수정

기존 findOccurrences에 `groupId` 필터 추가 (이미 존재하지만 group_id 기반으로 변경):

```typescript
// crop_batches.group_id 기준 필터
if (query.groupId) {
  qb.andWhere('cb.group_id = :groupId', { groupId: query.groupId });
}
```

또한 select에 추가:
```typescript
'o.growth_feedback AS "growthFeedback"',
'o.window_end_date AS "windowEndDate"',
'cb.group_id AS "groupId"',
'cb.current_stage AS "currentStage"',
```

---

## 5. Frontend 변경

### 5.1 task-presets.ts 리디자인

파일: `frontend/src/utils/task-presets.ts`

```typescript
// 생육단계 상수
export const GROWTH_STAGES = [
  { value: 'seedling', label: '육묘', color: '#F59E0B', icon: '🌱' },
  { value: 'vegetative', label: '영양생장', color: '#10B981', icon: '🌿' },
  { value: 'flowering_fruit', label: '개화착과', color: '#8B5CF6', icon: '🌸' },
  { value: 'harvest', label: '수확', color: '#EF4444', icon: '🍅' },
] as const;

// 생육 피드백 상수
export const GROWTH_FEEDBACK = [
  { value: 'growth_fast', label: '순 많음', icon: '🌱', description: '생육이 빠릅니다 → 다음 작업을 앞당깁니다' },
  { value: 'normal', label: '보통', icon: '🌿', description: '정상 생육 → 기본 간격 유지' },
  { value: 'growth_slow', label: '거의 없음', icon: '🍂', description: '생육이 느립니다 → 다음 작업을 늦춥니다' },
] as const;

// 재스케줄 모드 (기존 유지, 한국어명만 업데이트)
export const RESCHEDULE_MODES = [
  { value: 'anchor', label: '주기 유지', description: '원래 간격 그대로 유지', recommended: true },
  { value: 'shift', label: '시리즈 이동', description: '완료일 기준으로 전체 이동', recommended: false },
  { value: 'one_time', label: '이번만 반영', description: '이번 작업만 날짜 변경', recommended: false },
] as const;

export type GrowthStage = typeof GROWTH_STAGES[number]['value'];
export type GrowthFeedback = typeof GROWTH_FEEDBACK[number]['value'];

export function getStageInfo(stage: string) {
  return GROWTH_STAGES.find(s => s.value === stage) || GROWTH_STAGES[0];
}

export function needsFeedback(intervalMin: number, intervalMax: number): boolean {
  return intervalMin !== intervalMax;
}
```

### 5.2 harvest.api.ts 수정

파일: `frontend/src/api/harvest.api.ts`

```typescript
export interface CropBatch {
  id: string;
  userId: string;
  cropName: string;
  variety: string | null;
  houseName: string;
  houseId: string | null;
  groupId: string | null;          // NEW
  transplantDate: string | null;   // NEW
  currentStage: string;            // NEW
  stageStartedAt: string | null;   // NEW
  sowDate: string;
  growDays: number;
  stage: string;
  memo: string | null;
  status: 'active' | 'completed';
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBatchRequest {
  cropName: string;
  variety?: string;
  houseName?: string;       // optional로 변경
  houseId?: string;
  groupId?: string;         // NEW
  transplantDate?: string;  // NEW
  sowDate: string;
  growDays: number;
  stage?: string;
  memo?: string;
}
```

### 5.3 harvest-task.api.ts 수정

파일: `frontend/src/api/harvest-task.api.ts`

```typescript
export interface TaskTemplate {
  id: string;
  userId: string;
  taskName: string;
  cropType: string;              // NEW
  stageName: string | null;      // NEW
  intervalDays: number;
  intervalMinDays: number | null; // NEW
  intervalMaxDays: number | null; // NEW
  startOffsetDays: number;
  defaultRescheduleMode: string;
  isPreset: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OccurrenceWithContext {
  id: string;
  scheduledDate: string;
  windowEndDate: string | null;     // NEW
  status: string;
  doneDate: string | null;
  memo: string | null;
  growthFeedback: string | null;    // NEW
  taskName: string;
  intervalDays: number;
  intervalMinDays: number | null;   // NEW
  intervalMaxDays: number | null;   // NEW
  batchId: string;
  cropName: string;
  variety: string | null;
  houseName: string;
  houseId: string | null;
  groupId: string | null;
  groupName: string | null;
  currentStage: string;             // NEW
  batchTaskId: string;
  rescheduleMode: string;
}

export interface TaskSummary {                // NEW
  todayTasks: { id: string; scheduledDate: string; taskName: string; windowEndDate: string | null }[];
  upcoming: { id: string; scheduledDate: string; taskName: string; windowEndDate: string | null }[];
}

export const harvestTaskApi = {
  // ... 기존 메서드 유지

  // NEW: 단계 변경
  changeStage: (batchId: string, stage: string) =>
    apiClient.put(`/harvest/batches/${batchId}/stage`, { stage }),

  // NEW: 배치별 작업 요약
  getTaskSummary: (batchId: string) =>
    apiClient.get<TaskSummary>(`/harvest/batches/${batchId}/task-summary`),

  // 완료 처리 (growthFeedback 추가)
  completeOccurrence: (id: string, data: {
    rescheduleMode: string;
    rememberChoice?: boolean;
    memo?: string;
    growthFeedback?: string;  // NEW
  }) =>
    apiClient.put(`/harvest/occurrences/${id}/complete`, data),
}
```

### 5.4 Harvest.vue 리디자인

파일: `frontend/src/views/Harvest.vue`

#### 탭 구조 변경 (3탭)

```
기존: [진행중 (N)] [완료 (N)]
변경: [배치] [작업] [완료]
```

- **배치 탭**: 기존 진행중 배치 카드 목록 + 생성/수정 (알림 섹션 포함)
- **작업 탭**: 오늘의 작업 배너 + 리스트/달력 뷰
- **완료 탭**: 기존 완료 배치 목록

#### 배치 생성 모달 변경

- `하우스/구역` → `그룹` 드롭다운
  - `groupApi.getGroups()` 호출 → 목록 표시
  - 선택 시 `form.groupId` 설정
  - houseName은 그룹명에서 자동 설정 (또는 빈값)
- `정식일` 필드 추가 (date input, optional)
- houseName 자유입력 제거

#### 배치 카드 변경

- 단계 배지: `getStageInfo(batch.currentStage)` → 아이콘+색상
- "다음 작업" 미리보기: `harvestTaskApi.getTaskSummary(batch.id)` 호출
- 단계 변경 시 `harvestTaskApi.changeStage()` → 확인 다이얼로그

#### 작업 탭 (TaskCalendar 통합)

기존 TaskCalendar.vue의 핵심 로직을 Harvest.vue의 작업 탭으로 이동:
- 오늘의 작업 배너 (todayTasks from all batches)
- 리스트 뷰 (기본): 주간 그룹핑
- 달력 뷰 (선택): 월간 그리드
- 그룹 필터 (그룹 탭)
- 완료/연기/스킵 + RescheduleSheet

### 5.5 RescheduleSheet.vue 수정

파일: `frontend/src/components/harvest/RescheduleSheet.vue`

기존 + 생육 피드백 단계 추가:

1. **Step 1**: 생육 피드백 선택 (interval_min != interval_max인 경우만)
   - growth_fast / normal / growth_slow 3버튼
   - interval_min == interval_max이면 이 단계 스킵
2. **Step 2**: 재스케줄 옵션 선택 (기존 3옵션)
3. **Step 3**: 확인 + Remember choice

```typescript
// emit 변경
defineEmits<{
  close: []
  confirm: [mode: string, remember: boolean, feedback?: string]
}>()
```

### 5.6 TaskCalendar.vue 삭제

- `frontend/src/views/TaskCalendar.vue` 삭제
- `frontend/src/router/index.ts`에서 `/task-calendar` 라우트 제거
- `frontend/src/App.vue`에서 "작업 달력" 네비 링크 제거 (데스크탑 + 모바일)

---

## 6. 구현 순서

| Phase | Step | 작업 | 파일 |
|-------|------|------|------|
| 1 | 1 | crop_batches ALTER (group_id, transplant_date, current_stage, stage_started_at) | schema.sql |
| 1 | 2 | task_templates ALTER (crop_type, stage_name, interval_min/max_days) | schema.sql |
| 1 | 3 | task_occurrences ALTER (growth_feedback, window_end_date) | schema.sql |
| 2 | 4 | CropBatch entity 수정 (4개 컬럼 추가) | crop-batch.entity.ts |
| 2 | 5 | TaskTemplate entity 수정 (4개 컬럼 추가) | task-template.entity.ts |
| 2 | 6 | TaskOccurrence entity 수정 (2개 컬럼 추가) | task-occurrence.entity.ts |
| 2 | 7 | CreateBatchDto/UpdateBatchDto 수정 (groupId, transplantDate) + ChangeStageDto | create-batch.dto.ts |
| 2 | 8 | CreateTaskTemplateDto 수정 (cropType, stageName, intervalMin/Max) | task-template.dto.ts |
| 2 | 9 | CompleteOccurrenceDto 수정 (growthFeedback) | occurrence-action.dto.ts |
| 3 | 10 | HarvestTaskService 리디자인 (프리셋7종, 단계적용, 유연간격, 피드백, 단계변경) | harvest-task.service.ts |
| 3 | 11 | HarvestService 수정 (create에 groupId→houseName 연동) | harvest.service.ts |
| 4 | 12 | HarvestTaskController 수정 (changeStage, getTaskSummary API) | harvest-task.controller.ts |
| 4 | 13 | findOccurrences select 확장 (windowEndDate, growthFeedback, groupId, currentStage) | harvest-task.service.ts |
| 5 | 14 | task-presets.ts 리디자인 (GROWTH_STAGES, GROWTH_FEEDBACK, 유틸함수) | task-presets.ts |
| 5 | 15 | harvest.api.ts 수정 (CropBatch, CreateBatchRequest 타입) | harvest.api.ts |
| 5 | 16 | harvest-task.api.ts 수정 (TaskTemplate, OccurrenceWithContext, TaskSummary, 새 API) | harvest-task.api.ts |
| 6 | 17 | Harvest.vue 리디자인 (3탭, 그룹드롭다운, 정식일, 배치카드+단계+다음작업, 작업탭) | Harvest.vue |
| 6 | 18 | RescheduleSheet.vue 수정 (생육 피드백 단계 추가) | RescheduleSheet.vue |
| 7 | 19 | TaskCalendar.vue 삭제 | TaskCalendar.vue |
| 7 | 20 | router/index.ts에서 /task-calendar 제거 | router/index.ts |
| 7 | 21 | App.vue에서 "작업 달력" 네비 링크 제거 | App.vue |
| 8 | 22 | Backend 빌드 (`npm run build`) | — |
| 8 | 23 | Frontend 빌드 (`npm run build`) | — |

---

## 7. 검증 항목 (25항목)

### 7.1 DB (3)

| # | 검증 항목 | 기대 결과 |
|---|----------|----------|
| V-01 | crop_batches에 group_id, transplant_date, current_stage, stage_started_at 컬럼 존재 | ALTER 문 성공 |
| V-02 | task_templates에 crop_type, stage_name, interval_min_days, interval_max_days 컬럼 존재 | ALTER 문 성공 |
| V-03 | task_occurrences에 growth_feedback, window_end_date 컬럼 존재 | ALTER 문 성공 |

### 7.2 Backend 엔티티/DTO (5)

| # | 검증 항목 | 기대 결과 |
|---|----------|----------|
| V-04 | CropBatch entity에 groupId, transplantDate, currentStage, stageStartedAt 필드 | 컴파일 성공 |
| V-05 | TaskTemplate entity에 cropType, stageName, intervalMinDays, intervalMaxDays 필드 | 컴파일 성공 |
| V-06 | TaskOccurrence entity에 growthFeedback, windowEndDate 필드 | 컴파일 성공 |
| V-07 | CreateBatchDto에 groupId, transplantDate 필드, houseName optional | 유효성 검증 통과 |
| V-08 | CompleteOccurrenceDto에 growthFeedback 필드 | 유효성 검증 통과 |

### 7.3 Backend 서비스 (7)

| # | 검증 항목 | 기대 결과 |
|---|----------|----------|
| V-09 | onModuleInit: 기존 프리셋 삭제 + 7종 신규 프리셋 생성 | 로그 확인 |
| V-10 | applyStageTemplates: 배치에 현재 단계 템플릿 자동 적용 | batch_tasks + occurrences 생성 |
| V-11 | generateFlexOccurrences: interval_min/max 기반 occurrence 생성, window_end_date 설정 | 날짜 검증 |
| V-12 | completeOccurrence + growthFeedback: growth_fast→minDays, growth_slow→maxDays | 다음 occurrence 간격 검증 |
| V-13 | changeStage: 이전 planned→skipped, 새 단계 템플릿 적용 | 상태 전환 확인 |
| V-14 | determineStage: sowDate/transplantDate 기준 단계 자동 판정 | 4단계 정확성 |
| V-15 | getTaskSummary: 배치별 오늘 작업 + 다음 2건 반환 | API 응답 확인 |

### 7.4 Backend 컨트롤러 (2)

| # | 검증 항목 | 기대 결과 |
|---|----------|----------|
| V-16 | PUT /harvest/batches/:id/stage | 단계 변경 + occurrence 재생성 |
| V-17 | GET /harvest/batches/:id/task-summary | 작업 요약 JSON 반환 |

### 7.5 Frontend 프리셋/API (3)

| # | 검증 항목 | 기대 결과 |
|---|----------|----------|
| V-18 | GROWTH_STAGES 4종 + GROWTH_FEEDBACK 3종 상수 | 타입 정확 |
| V-19 | CropBatch 타입에 groupId, transplantDate, currentStage 필드 | 타입 호환 |
| V-20 | harvestTaskApi에 changeStage, getTaskSummary 메서드 | API 호출 가능 |

### 7.6 Frontend UI (3)

| # | 검증 항목 | 기대 결과 |
|---|----------|----------|
| V-21 | Harvest.vue 3탭 (배치/작업/완료) 전환 | 탭 정상 동작 |
| V-22 | 배치 생성 모달에 그룹 드롭다운 + 정식일 필드 | 선택/입력 가능 |
| V-23 | RescheduleSheet에 생육 피드백 선택 UI (min≠max인 경우) | 3옵션 표시 |

### 7.7 삭제/정리 (2)

| # | 검증 항목 | 기대 결과 |
|---|----------|----------|
| V-24 | TaskCalendar.vue 삭제, /task-calendar 라우트 제거 | 404 또는 라우트 없음 |
| V-25 | App.vue에서 "작업 달력" 네비 링크 제거 | 메뉴에 표시 안됨 |

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-02-24 | Initial design — stage-based redesign | AI Assistant |
