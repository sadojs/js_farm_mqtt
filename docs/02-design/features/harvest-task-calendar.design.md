# 수확관리 작업 달력 (Harvest Task Calendar) Design Document

> **Summary**: 배치+작업템플릿 → 달력 자동 일정 + 재스케줄 옵션 상세 설계
>
> **Plan**: `docs/01-plan/features/harvest-task-calendar.plan.md`
> **Date**: 2026-02-24
> **Status**: Draft

---

## 1. 데이터 구조

### 1.1 신규 테이블 DDL

```sql
-- ═══ 1. 작업 템플릿 ═══
CREATE TABLE task_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_name VARCHAR(100) NOT NULL,
  interval_days INT NOT NULL CHECK (interval_days BETWEEN 1 AND 365),
  start_offset_days INT NOT NULL DEFAULT 0 CHECK (start_offset_days >= 0),
  default_reschedule_mode VARCHAR(20) NOT NULL DEFAULT 'anchor'
    CHECK (default_reschedule_mode IN ('anchor', 'shift', 'one_time')),
  is_preset BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_task_templates_user ON task_templates(user_id);
CREATE TRIGGER update_task_templates_updated_at BEFORE UPDATE ON task_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ═══ 2. 배치-템플릿 연결 ═══
CREATE TABLE batch_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES crop_batches(id) ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES task_templates(id) ON DELETE CASCADE,
  anchor_date DATE NOT NULL,
  reschedule_mode VARCHAR(20) NOT NULL DEFAULT 'anchor'
    CHECK (reschedule_mode IN ('anchor', 'shift', 'one_time')),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(batch_id, template_id)
);
CREATE INDEX idx_batch_tasks_batch ON batch_tasks(batch_id);

-- ═══ 3. 개별 작업 일정 ═══
CREATE TABLE task_occurrences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_task_id UUID NOT NULL REFERENCES batch_tasks(id) ON DELETE CASCADE,
  batch_id UUID NOT NULL REFERENCES crop_batches(id) ON DELETE CASCADE,
  scheduled_date DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'done', 'skipped')),
  done_date DATE,
  memo TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_task_occurrences_batch ON task_occurrences(batch_id, scheduled_date);
CREATE INDEX idx_task_occurrences_date ON task_occurrences(scheduled_date, status);
CREATE INDEX idx_task_occurrences_batch_task ON task_occurrences(batch_task_id, scheduled_date);
```

### 1.2 기존 테이블 ALTER

```sql
-- crop_batches에 house_id 추가 (optional FK)
ALTER TABLE crop_batches ADD COLUMN house_id UUID REFERENCES houses(id) ON DELETE SET NULL;
CREATE INDEX idx_crop_batches_house ON crop_batches(house_id);
```

### 1.3 ER 관계

```
task_templates (1) ──< batch_tasks (N) >── (1) crop_batches
                              │
                              └──< task_occurrences (N)

crop_batches (N) >── (1) houses >── (1) house_groups
```

---

## 2. Backend 설계

### 2.1 Entities

#### `modules/harvest/entities/task-template.entity.ts`

```typescript
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('task_templates')
export class TaskTemplate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'task_name' })
  taskName: string;

  @Column({ name: 'interval_days', type: 'int' })
  intervalDays: number;

  @Column({ name: 'start_offset_days', type: 'int', default: 0 })
  startOffsetDays: number;

  @Column({ name: 'default_reschedule_mode', default: 'anchor' })
  defaultRescheduleMode: 'anchor' | 'shift' | 'one_time';

  @Column({ name: 'is_preset', default: false })
  isPreset: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
```

#### `modules/harvest/entities/batch-task.entity.ts`

```typescript
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';

@Entity('batch_tasks')
export class BatchTask {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'batch_id', type: 'uuid' })
  batchId: string;

  @Column({ name: 'template_id', type: 'uuid' })
  templateId: string;

  @Column({ name: 'anchor_date', type: 'date' })
  anchorDate: string;

  @Column({ name: 'reschedule_mode', default: 'anchor' })
  rescheduleMode: 'anchor' | 'shift' | 'one_time';

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
```

#### `modules/harvest/entities/task-occurrence.entity.ts`

```typescript
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('task_occurrences')
export class TaskOccurrence {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'batch_task_id', type: 'uuid' })
  batchTaskId: string;

  @Column({ name: 'batch_id', type: 'uuid' })
  batchId: string;

  @Column({ name: 'scheduled_date', type: 'date' })
  scheduledDate: string;

  @Column({ default: 'planned' })
  status: 'planned' | 'done' | 'skipped';

  @Column({ name: 'done_date', type: 'date', nullable: true })
  doneDate: string;

  @Column({ type: 'text', nullable: true })
  memo: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
```

#### `modules/harvest/entities/crop-batch.entity.ts` (수정)

```typescript
// 기존 필드 유지 + houseId 추가
@Column({ name: 'house_id', type: 'uuid', nullable: true })
houseId: string;
```

### 2.2 DTOs

#### `modules/harvest/dto/task-template.dto.ts`

```typescript
import { IsString, IsInt, Min, Max, IsOptional, IsIn } from 'class-validator';

export class CreateTaskTemplateDto {
  @IsString()
  taskName: string;

  @IsInt()
  @Min(1)
  @Max(365)
  intervalDays: number;

  @IsInt()
  @Min(0)
  startOffsetDays: number;

  @IsOptional()
  @IsIn(['anchor', 'shift', 'one_time'])
  defaultRescheduleMode?: string;
}

export class UpdateTaskTemplateDto {
  @IsOptional()
  @IsString()
  taskName?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  intervalDays?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  startOffsetDays?: number;

  @IsOptional()
  @IsIn(['anchor', 'shift', 'one_time'])
  defaultRescheduleMode?: string;
}
```

#### `modules/harvest/dto/occurrence-action.dto.ts`

```typescript
import { IsIn, IsOptional, IsBoolean, IsString } from 'class-validator';

export class CompleteOccurrenceDto {
  @IsIn(['anchor', 'shift', 'one_time'])
  rescheduleMode: string;

  @IsOptional()
  @IsBoolean()
  rememberChoice?: boolean;

  @IsOptional()
  @IsString()
  memo?: string;
}

export class ApplyTemplateDto {
  @IsString()
  templateId: string;
}
```

### 2.3 Service: `modules/harvest/harvest-task.service.ts`

```typescript
@Injectable()
export class HarvestTaskService {
  constructor(
    @InjectRepository(TaskTemplate) private templateRepo: Repository<TaskTemplate>,
    @InjectRepository(BatchTask) private batchTaskRepo: Repository<BatchTask>,
    @InjectRepository(TaskOccurrence) private occurrenceRepo: Repository<TaskOccurrence>,
    @InjectRepository(CropBatch) private batchRepo: Repository<CropBatch>,
  ) {}

  // ── 템플릿 CRUD ──

  async findAllTemplates(userId: string): Promise<TaskTemplate[]>
  // user_id = userId OR is_preset = true, ORDER BY is_preset DESC, task_name ASC

  async createTemplate(userId: string, dto: CreateTaskTemplateDto): Promise<TaskTemplate>
  // is_preset = false (사용자 정의)

  async updateTemplate(userId: string, id: string, dto: UpdateTaskTemplateDto): Promise<TaskTemplate>
  // is_preset 인 경우 수정 불가 (throw ForbiddenException)

  async removeTemplate(userId: string, id: string): Promise<void>
  // is_preset 인 경우 삭제 불가 + CASCADE로 batch_tasks/occurrences 자동 삭제

  // ── 배치에 템플릿 적용 ──

  async applyTemplate(userId: string, batchId: string, templateId: string): Promise<BatchTask>
  // 1. batch 조회 → sowDate 확인
  // 2. anchor_date = sowDate + template.startOffsetDays
  // 3. batch_task 생성 (reschedule_mode = template.defaultRescheduleMode)
  // 4. generateOccurrences(batchTask, 90) 호출
  // 5. return batchTask

  async removeTemplateFromBatch(userId: string, batchId: string, batchTaskId: string): Promise<void>
  // batch_task 삭제 → CASCADE로 occurrences 삭제

  // ── Occurrence 조회 ──

  async findOccurrences(userId: string, query: {
    startDate: string;    // YYYY-MM-DD
    endDate: string;      // YYYY-MM-DD
    groupId?: string;     // 그룹 필터
    houseId?: string;     // 하우스 필터
    batchId?: string;     // 배치 필터
  }): Promise<OccurrenceWithContext[]>
  // JOIN batch_tasks → task_templates (task_name, interval_days)
  // JOIN crop_batches (crop_name, variety, house_name, house_id)
  // LEFT JOIN houses → house_groups (group 필터용)
  // WHERE scheduled_date BETWEEN startDate AND endDate
  // 그룹/하우스 필터 적용
  // ORDER BY scheduled_date, crop_name

  // ── Occurrence 액션 ──

  async completeOccurrence(userId: string, id: string, dto: CompleteOccurrenceDto): Promise<TaskOccurrence>
  // 1. occurrence 조회
  // 2. status = 'done', done_date = today
  // 3. rememberChoice → batch_task.reschedule_mode 업데이트
  // 4. reschedule 로직 실행 (아래 참조)

  async postponeOccurrence(userId: string, id: string): Promise<TaskOccurrence>
  // scheduled_date += 1일 (이번만 반영 방식)

  async skipOccurrence(userId: string, id: string): Promise<TaskOccurrence>
  // status = 'skipped', future는 변경 없음

  // ── 재스케줄 핵심 로직 ──

  private async reschedule(occurrence: TaskOccurrence, mode: string): Promise<void>
  // mode === 'anchor':
  //   → 아무것도 안 함 (future는 원래 anchor 기준 그대로)
  //
  // mode === 'shift':
  //   → batch_task.anchor_date = done_date
  //   → 현재 occurrence 이후의 planned 건 전부 삭제
  //   → generateOccurrences(batchTask, 90) 재생성 (done_date 이후부터)
  //
  // mode === 'one_time':
  //   → 해당 occurrence만 done_date 기록, future는 변경 없음

  // ── Occurrence 생성 유틸 ──

  private async generateOccurrences(batchTask: BatchTask, days: number): Promise<void>
  // anchor = batchTask.anchorDate
  // interval = template.intervalDays
  // for k = 0, 1, 2, ... while (anchor + k*interval) <= (today + days):
  //   scheduled_date = anchor + k * interval
  //   if scheduled_date >= today: INSERT occurrence (planned)
  // bulk insert
}
```

**응답 타입: OccurrenceWithContext**

```typescript
interface OccurrenceWithContext {
  id: string;
  scheduledDate: string;
  status: 'planned' | 'done' | 'skipped';
  doneDate: string | null;
  memo: string | null;
  // 템플릿 정보
  taskName: string;
  intervalDays: number;
  // 배치 정보
  batchId: string;
  cropName: string;
  variety: string | null;
  houseName: string;
  houseId: string | null;
  // 그룹 정보 (JOIN)
  groupId: string | null;
  groupName: string | null;
  // 재스케줄 관련
  batchTaskId: string;
  rescheduleMode: string;
}
```

### 2.4 Controller: `modules/harvest/harvest-task.controller.ts`

```typescript
@Controller('harvest')
@UseGuards(JwtAuthGuard)
export class HarvestTaskController {
  // getEffectiveUserId 동일 패턴

  // ── 템플릿 ──
  @Get('templates')             findAllTemplates()
  @Post('templates')            createTemplate(@Body() dto)
  @Put('templates/:id')         updateTemplate(@Param('id'), @Body() dto)
  @Delete('templates/:id')      removeTemplate(@Param('id'))

  // ── 배치-템플릿 연결 ──
  @Post('batches/:batchId/apply-template')    applyTemplate(@Param('batchId'), @Body() dto)
  @Delete('batches/:batchId/tasks/:taskId')   removeTemplateFromBatch(@Param('batchId'), @Param('taskId'))

  // ── Occurrence ──
  @Get('occurrences')                         findOccurrences(@Query() query)
  @Put('occurrences/:id/complete')            completeOccurrence(@Param('id'), @Body() dto)
  @Put('occurrences/:id/postpone')            postponeOccurrence(@Param('id'))
  @Put('occurrences/:id/skip')                skipOccurrence(@Param('id'))
}
```

### 2.5 Module 수정: `harvest.module.ts`

```typescript
@Module({
  imports: [TypeOrmModule.forFeature([
    CropBatch,
    TaskTemplate,    // 추가
    BatchTask,       // 추가
    TaskOccurrence,  // 추가
  ])],
  controllers: [
    HarvestController,
    HarvestTaskController,  // 추가
  ],
  providers: [
    HarvestService,
    HarvestTaskService,     // 추가
  ],
})
export class HarvestModule {}
```

### 2.6 프리셋 시딩 (is_preset = true)

서비스 초기화 시 또는 별도 seed 스크립트로 6종 프리셋 삽입:

| task_name | interval_days | start_offset_days | default_reschedule_mode |
|-----------|:------------:|:-----------------:|:----------------------:|
| 순따기 | 7 | 7 | anchor |
| 유도 | 7 | 10 | shift |
| 관수 | 1 | 0 | anchor |
| 시비 | 14 | 7 | anchor |
| 방제 | 10 | 14 | anchor |
| 적엽 | 14 | 21 | anchor |

→ `HarvestTaskService.onModuleInit()`에서 프리셋 6종 upsert:
```typescript
@Injectable()
export class HarvestTaskService implements OnModuleInit {
  async onModuleInit() {
    for (const preset of TASK_PRESETS) {
      const existing = await this.templateRepo.findOne({
        where: { taskName: preset.taskName, isPreset: true },
      });
      if (!existing) {
        await this.templateRepo.save(this.templateRepo.create({
          ...preset,
          userId: '00000000-0000-0000-0000-000000000000', // system user
          isPreset: true,
        }));
      }
    }
  }
}
```

---

## 3. Frontend 설계

### 3.1 작업 프리셋 상수: `utils/task-presets.ts`

```typescript
export interface TaskPreset {
  taskName: string
  intervalDays: number
  startOffsetDays: number
  defaultRescheduleMode: 'anchor' | 'shift' | 'one_time'
  description: string  // UI 설명용
}

export const TASK_PRESETS: TaskPreset[] = [
  { taskName: '순따기', intervalDays: 7, startOffsetDays: 7,
    defaultRescheduleMode: 'anchor', description: '곁순 제거 (정식 후 7일~, 7일 간격)' },
  { taskName: '유도', intervalDays: 7, startOffsetDays: 10,
    defaultRescheduleMode: 'shift', description: '생장점 유도 (정식 후 10일~, 7일 간격)' },
  { taskName: '관수', intervalDays: 1, startOffsetDays: 0,
    defaultRescheduleMode: 'anchor', description: '물주기 (매일)' },
  { taskName: '시비', intervalDays: 14, startOffsetDays: 7,
    defaultRescheduleMode: 'anchor', description: '비료 투입 (정식 후 7일~, 14일 간격)' },
  { taskName: '방제', intervalDays: 10, startOffsetDays: 14,
    defaultRescheduleMode: 'anchor', description: '병해충 방제 (정식 후 14일~, 10일 간격)' },
  { taskName: '적엽', intervalDays: 14, startOffsetDays: 21,
    defaultRescheduleMode: 'anchor', description: '노화 잎 제거 (정식 후 21일~, 14일 간격)' },
]

export const RESCHEDULE_MODES = [
  { value: 'anchor', label: '주기 유지', description: '원래 간격 그대로 유지 (SOP 루틴에 적합)', recommended: true },
  { value: 'shift', label: '시리즈 이동', description: '완료일 기준으로 전체 이동', recommended: false },
  { value: 'one_time', label: '이번만 반영', description: '이번 작업만 날짜 변경', recommended: false },
]
```

### 3.2 API 클라이언트: `api/harvest-task.api.ts`

```typescript
import apiClient from './client'

export interface TaskTemplate {
  id: string
  userId: string
  taskName: string
  intervalDays: number
  startOffsetDays: number
  defaultRescheduleMode: 'anchor' | 'shift' | 'one_time'
  isPreset: boolean
  createdAt: string
  updatedAt: string
}

export interface OccurrenceWithContext {
  id: string
  scheduledDate: string
  status: 'planned' | 'done' | 'skipped'
  doneDate: string | null
  memo: string | null
  taskName: string
  intervalDays: number
  batchId: string
  cropName: string
  variety: string | null
  houseName: string
  houseId: string | null
  groupId: string | null
  groupName: string | null
  batchTaskId: string
  rescheduleMode: string
}

export const harvestTaskApi = {
  // 템플릿
  getTemplates: () =>
    apiClient.get<TaskTemplate[]>('/harvest/templates'),
  createTemplate: (data: { taskName: string; intervalDays: number; startOffsetDays: number; defaultRescheduleMode?: string }) =>
    apiClient.post<TaskTemplate>('/harvest/templates', data),
  updateTemplate: (id: string, data: Partial<{ taskName: string; intervalDays: number; startOffsetDays: number; defaultRescheduleMode: string }>) =>
    apiClient.put<TaskTemplate>(`/harvest/templates/${id}`, data),
  deleteTemplate: (id: string) =>
    apiClient.delete(`/harvest/templates/${id}`),

  // 배치-템플릿
  applyTemplate: (batchId: string, templateId: string) =>
    apiClient.post(`/harvest/batches/${batchId}/apply-template`, { templateId }),
  removeTemplateFromBatch: (batchId: string, batchTaskId: string) =>
    apiClient.delete(`/harvest/batches/${batchId}/tasks/${batchTaskId}`),

  // Occurrence
  getOccurrences: (params: { startDate: string; endDate: string; groupId?: string; houseId?: string; batchId?: string }) =>
    apiClient.get<OccurrenceWithContext[]>('/harvest/occurrences', { params }),
  completeOccurrence: (id: string, data: { rescheduleMode: string; rememberChoice?: boolean; memo?: string }) =>
    apiClient.put(`/harvest/occurrences/${id}/complete`, data),
  postponeOccurrence: (id: string) =>
    apiClient.put(`/harvest/occurrences/${id}/postpone`),
  skipOccurrence: (id: string) =>
    apiClient.put(`/harvest/occurrences/${id}/skip`),
}
```

### 3.3 달력 페이지: `views/TaskCalendar.vue`

**구조:**
```
<template>
  <div class="page-container">
    <!-- 헤더 -->
    <header class="page-header">
      <h2>작업 달력</h2>
      <div class="header-actions">
        <button @click="showTemplateModal = true">템플릿 관리</button>
        <div class="view-toggle">
          <button :class="{ active: viewMode === 'calendar' }" @click="viewMode = 'calendar'">달력</button>
          <button :class="{ active: viewMode === 'list' }" @click="viewMode = 'list'">리스트</button>
        </div>
      </div>
    </header>

    <!-- 그룹 필터 탭 -->
    <div v-if="groups.length > 1" class="group-tabs">
      <button :class="['group-tab', { active: !selectedGroupId }]" @click="selectedGroupId = null">전체</button>
      <button v-for="g in groups" :key="g.id"
        :class="['group-tab', { active: selectedGroupId === g.id }]"
        @click="selectedGroupId = g.id">
        {{ g.name }}
      </button>
    </div>

    <!-- 달력 뷰 -->
    <div v-if="viewMode === 'calendar'" class="calendar-view">
      <!-- 월 네비게이션 -->
      <div class="calendar-nav">
        <button @click="prevMonth">&lt;</button>
        <span>{{ currentYear }}년 {{ currentMonth }}월</span>
        <button @click="nextMonth">&gt;</button>
        <button class="btn-today" @click="goToday">오늘</button>
      </div>

      <!-- 요일 헤더 -->
      <div class="calendar-weekdays">
        <div v-for="d in ['일','월','화','수','목','금','토']" :key="d">{{ d }}</div>
      </div>

      <!-- 달력 그리드 -->
      <div class="calendar-grid">
        <div v-for="day in calendarDays" :key="day.dateStr"
          :class="['calendar-cell', {
            today: day.isToday,
            'other-month': !day.isCurrentMonth,
            selected: day.dateStr === selectedDate,
            'has-tasks': day.count > 0,
          }]"
          @click="selectDate(day.dateStr)">
          <span class="day-number">{{ day.day }}</span>
          <div v-if="day.count > 0" class="task-dots">
            <span v-if="day.doneCount > 0" class="dot done">{{ day.doneCount }}</span>
            <span v-if="day.plannedCount > 0" class="dot planned">{{ day.plannedCount }}</span>
            <span v-if="day.overdueCount > 0" class="dot overdue">{{ day.overdueCount }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 리스트 뷰 -->
    <div v-if="viewMode === 'list'" class="list-view">
      <!-- 날짜 범위 선택 -->
      <div class="list-date-range">
        <button :class="{ active: listRange === 'today' }" @click="listRange = 'today'">오늘</button>
        <button :class="{ active: listRange === 'week' }" @click="listRange = 'week'">이번 주</button>
        <button :class="{ active: listRange === 'month' }" @click="listRange = 'month'">이번 달</button>
      </div>
    </div>

    <!-- 선택된 날짜의 작업 리스트 -->
    <div class="day-tasks">
      <h3 class="day-tasks-title">
        {{ formatDateKR(selectedDate) }} 작업
        <span class="task-count">({{ selectedDayOccurrences.length }}건)</span>
      </h3>

      <!-- 그룹별 묶음 -->
      <div v-for="group in groupedOccurrences" :key="group.key" class="task-group-section">
        <div class="task-group-header">
          <span class="group-name">{{ group.groupName }}</span>
          <span class="house-name">{{ group.houseName }}</span>
        </div>

        <div v-for="item in group.items" :key="item.id" class="occurrence-card">
          <div class="occurrence-left">
            <span :class="['status-icon', item.status]">
              {{ item.status === 'done' ? '✅' : item.status === 'skipped' ? '⏭️' : '🔵' }}
            </span>
            <div class="occurrence-info">
              <span class="task-name">{{ item.taskName }}</span>
              <span class="batch-name">{{ item.cropName }}{{ item.variety ? ` / ${item.variety}` : '' }}</span>
            </div>
          </div>
          <div v-if="item.status === 'planned'" class="occurrence-actions">
            <button class="btn-complete" @click="handleComplete(item)">완료</button>
            <button class="btn-postpone" @click="handlePostpone(item)">연기</button>
            <button class="btn-skip" @click="handleSkip(item)">스킵</button>
          </div>
          <div v-else class="occurrence-done-info">
            <span v-if="item.doneDate">{{ item.doneDate }}</span>
          </div>
        </div>
      </div>

      <!-- 빈 상태 -->
      <div v-if="selectedDayOccurrences.length === 0" class="empty-day">
        이 날짜에 예정된 작업이 없습니다.
      </div>
    </div>

    <!-- 재스케줄 Bottom Sheet -->
    <RescheduleSheet
      v-if="showRescheduleSheet"
      :occurrence="rescheduleTarget"
      @confirm="confirmReschedule"
      @close="showRescheduleSheet = false"
    />

    <!-- 템플릿 관리 모달 -->
    <!-- (생략 — 기존 모달 패턴 동일) -->
  </div>
</template>
```

**Script 핵심 로직:**

```typescript
<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { harvestTaskApi, type OccurrenceWithContext } from '../api/harvest-task.api'
import { groupApi } from '../api/group.api'
import type { HouseGroup } from '../types/group.types'
import RescheduleSheet from '../components/harvest/RescheduleSheet.vue'
import { TASK_PRESETS, RESCHEDULE_MODES } from '../utils/task-presets'

const groups = ref<HouseGroup[]>([])
const selectedGroupId = ref<string | null>(null)
const viewMode = ref<'calendar' | 'list'>('calendar')
const currentYear = ref(new Date().getFullYear())
const currentMonth = ref(new Date().getMonth() + 1)
const selectedDate = ref(new Date().toISOString().slice(0, 10))
const occurrences = ref<OccurrenceWithContext[]>([])
const showRescheduleSheet = ref(false)
const rescheduleTarget = ref<OccurrenceWithContext | null>(null)

// 달력 날짜 배열 계산 (6주 × 7일 = 42셀)
const calendarDays = computed(() => { /* ... */ })

// 선택된 날짜의 occurrence
const selectedDayOccurrences = computed(() =>
  occurrences.value.filter(o => o.scheduledDate === selectedDate.value)
)

// 그룹별 묶음 표시
const groupedOccurrences = computed(() => {
  const items = selectedDayOccurrences.value
  const map = new Map<string, { groupName: string; houseName: string; items: OccurrenceWithContext[] }>()

  for (const item of items) {
    const key = `${item.groupId || 'unassigned'}-${item.houseId || item.houseName}`
    if (!map.has(key)) {
      map.set(key, {
        groupName: item.groupName || '미분류',
        houseName: item.houseName,
        items: [],
      })
    }
    map.get(key)!.items.push(item)
  }
  return Array.from(map.values())
})

// 완료 → 예정일 != 오늘 → 재스케줄 시트 표시
async function handleComplete(item: OccurrenceWithContext) {
  const today = new Date().toISOString().slice(0, 10)
  if (item.scheduledDate !== today && item.rescheduleMode === 'anchor') {
    // 날짜 불일치 → 재스케줄 옵션 제시
    rescheduleTarget.value = item
    showRescheduleSheet.value = true
  } else if (item.rescheduleMode !== 'anchor') {
    // Remember choice가 설정된 경우 → 자동 적용
    await harvestTaskApi.completeOccurrence(item.id, { rescheduleMode: item.rescheduleMode })
    await loadOccurrences()
  } else {
    // 예정일 당일 + anchor 모드 → 바로 완료
    await harvestTaskApi.completeOccurrence(item.id, { rescheduleMode: 'anchor' })
    await loadOccurrences()
  }
}

async function confirmReschedule(mode: string, rememberChoice: boolean) {
  if (!rescheduleTarget.value) return
  await harvestTaskApi.completeOccurrence(rescheduleTarget.value.id, {
    rescheduleMode: mode,
    rememberChoice,
  })
  showRescheduleSheet.value = false
  await loadOccurrences()
}
</script>
```

### 3.4 재스케줄 Bottom Sheet: `components/harvest/RescheduleSheet.vue`

```
<template>
  <div class="sheet-overlay" @click.self="$emit('close')">
    <div class="sheet-content">
      <h3>📋 "{{ occurrence.taskName }}"를 {{ dayDiff }}일 {{ early ? '빨리' : '늦게' }} 완료했습니다</h3>
      <p class="sheet-question">이후 일정은 어떻게 할까요?</p>

      <div class="reschedule-options">
        <label v-for="mode in RESCHEDULE_MODES" :key="mode.value"
          :class="['option-card', { selected: selectedMode === mode.value }]">
          <input type="radio" v-model="selectedMode" :value="mode.value" />
          <div class="option-body">
            <span class="option-label">
              {{ mode.label }}
              <span v-if="mode.recommended" class="badge-recommend">권장</span>
            </span>
            <span class="option-desc">{{ mode.description }}</span>
            <span class="option-preview">→ 다음: {{ previewNextDate(mode.value) }}</span>
          </div>
        </label>
      </div>

      <label class="remember-toggle">
        <input type="checkbox" v-model="rememberChoice" />
        이 작업은 앞으로 항상 이 방식으로
      </label>

      <div class="sheet-actions">
        <button class="btn-secondary" @click="$emit('close')">취소</button>
        <button class="btn-primary" @click="$emit('confirm', selectedMode, rememberChoice)">확인</button>
      </div>
    </div>
  </div>
</template>
```

### 3.5 Harvest.vue 하우스 선택 연동

배치 추가/수정 모달에 하우스 드롭다운 추가:

```html
<!-- 기존 자유 입력을 드롭다운 + 자유 입력 전환으로 변경 -->
<div class="form-group">
  <label>하우스/구역 *</label>
  <div class="house-select-row">
    <select v-if="houses.length > 0" v-model="form.houseId" @change="onHouseSelect">
      <option value="">직접 입력</option>
      <option v-for="h in houses" :key="h.id" :value="h.id">
        {{ getGroupName(h.groupId) }} / {{ h.name }}
      </option>
    </select>
    <input v-model="form.houseName" :placeholder="form.houseId ? '' : '예: 하우스 1'"
      :disabled="!!form.houseId" />
  </div>
</div>
```

- houses 목록은 `groupApi.getHouses()` 로 로드
- 하우스 선택 시 `form.houseId = h.id`, `form.houseName = h.name` 자동 설정
- "직접 입력" 선택 시 `form.houseId = null`, houseName 자유 입력

### 3.6 라우터 + 네비게이션

```typescript
// router/index.ts 추가
{ path: '/task-calendar', name: 'TaskCalendar', component: () => import('../views/TaskCalendar.vue') }

// App.vue 네비게이션에 추가 (수확 관리 다음)
// 데스크탑: <router-link to="/task-calendar">작업 달력</router-link>
// 모바일: <router-link to="/task-calendar" class="nav-link" @click="showMobile = false">작업 달력</router-link>
```

---

## 4. 구현 순서 (7 Phase)

| Phase | 설명 | 파일 | 검증 |
|:-----:|------|------|------|
| **1** | DB 스키마 | schema.sql (DDL 3개 + ALTER 1개) | 테이블 생성 확인 |
| **2** | Backend 엔티티 | task-template.entity.ts, batch-task.entity.ts, task-occurrence.entity.ts, crop-batch.entity.ts (수정) | import 확인 |
| **3** | Backend DTO + 서비스 + 컨트롤러 | task-template.dto.ts, occurrence-action.dto.ts, harvest-task.service.ts, harvest-task.controller.ts, harvest.module.ts (수정) | `nest build` 통과 |
| **4** | Frontend 프리셋 + API 클라이언트 | task-presets.ts, harvest-task.api.ts | import 확인 |
| **5** | Frontend 달력 페이지 + 재스케줄 시트 | TaskCalendar.vue, RescheduleSheet.vue | 렌더링 확인 |
| **6** | Harvest.vue 하우스 선택 연동 + 라우터/네비 | Harvest.vue (수정), router/index.ts (수정), App.vue (수정) | 네비게이션 확인 |
| **7** | 빌드 검증 | — | `nest build` + `vue-tsc && vite build` |

---

## 5. 검증 항목 (25개)

| # | 카테고리 | 검증 항목 | 방법 |
|---|---------|----------|------|
| 1 | DB | task_templates 테이블 생성 | SQL |
| 2 | DB | batch_tasks 테이블 생성 + UNIQUE 제약 | SQL |
| 3 | DB | task_occurrences 테이블 생성 + 인덱스 3개 | SQL |
| 4 | DB | crop_batches.house_id 컬럼 추가 | SQL |
| 5 | Entity | TaskTemplate 엔티티 6개 컬럼 매핑 | build |
| 6 | Entity | BatchTask 엔티티 5개 컬럼 매핑 | build |
| 7 | Entity | TaskOccurrence 엔티티 6개 컬럼 매핑 | build |
| 8 | Entity | CropBatch.houseId 추가 | build |
| 9 | DTO | CreateTaskTemplateDto 4개 필드 + 검증 | build |
| 10 | DTO | CompleteOccurrenceDto rescheduleMode + rememberChoice | build |
| 11 | Service | findAllTemplates 프리셋 + 사용자 정의 반환 | API |
| 12 | Service | applyTemplate → 90일치 occurrence 생성 | API |
| 13 | Service | completeOccurrence + reschedule anchor 모드 | API |
| 14 | Service | completeOccurrence + reschedule shift 모드 | API |
| 15 | Service | completeOccurrence + reschedule one_time 모드 | API |
| 16 | Service | postponeOccurrence → +1일 | API |
| 17 | Service | skipOccurrence → status 변경 | API |
| 18 | Service | rememberChoice → batch_task.rescheduleMode 업데이트 | API |
| 19 | Service | 프리셋 6종 onModuleInit upsert | startup |
| 20 | Controller | 10개 엔드포인트 등록 + effectiveUserId | build |
| 21 | Frontend | 달력 월간 뷰 렌더링 | 브라우저 |
| 22 | Frontend | 날짜 클릭 → occurrence 리스트 표시 | 브라우저 |
| 23 | Frontend | 그룹 탭 필터링 | 브라우저 |
| 24 | Frontend | 재스케줄 Bottom Sheet 3옵션 + Remember | 브라우저 |
| 25 | Build | nest build + vue-tsc && vite build 통과 | CLI |

---

## 6. 기존 코드 수정 범위

| 파일 | 변경 내용 |
|------|----------|
| `crop-batch.entity.ts` | `houseId` 컬럼 1개 추가 |
| `create-batch.dto.ts` | `houseId?: string` 필드 추가 (CreateBatchDto, UpdateBatchDto) |
| `harvest.module.ts` | 3개 엔티티 + 1개 서비스 + 1개 컨트롤러 등록 |
| `schema.sql` | DDL 3개 + ALTER 1개 추가 |
| `Harvest.vue` | 하우스 선택 드롭다운 추가 (모달 내) |
| `harvest.api.ts` | CropBatch 인터페이스에 `houseId` 추가 |
| `router/index.ts` | `/task-calendar` 라우트 1개 추가 |
| `App.vue` | 네비게이션 링크 1개 추가 (데스크탑 + 모바일) |

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-02-24 | Initial draft | AI Assistant |
