import { Injectable, ForbiddenException, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { TaskTemplate } from './entities/task-template.entity';
import { BatchTask } from './entities/batch-task.entity';
import { TaskOccurrence } from './entities/task-occurrence.entity';
import { CropBatch } from './entities/crop-batch.entity';
import { CreateTaskTemplateDto, UpdateTaskTemplateDto } from './dto/task-template.dto';
import { CompleteOccurrenceDto } from './dto/occurrence-action.dto';

// 정식일 기준 단계별 오프셋 (일)
const STAGE_OFFSETS: Record<string, number> = {
  vegetative: 0,       // 정식일부터
  flowering_fruit: 30, // 정식 후 30일
  harvest: 65,         // 정식 후 65일
};

// 단계 진행 순서
const STAGE_ORDER = ['vegetative', 'flowering_fruit', 'harvest'];

// 방울토마토 단계별 6종 프리셋 (seedling 제거 - 종묘사 위탁)
const STAGE_TASK_PRESETS = [
  { taskName: '순따기', cropType: 'cherry_tomato', stageName: 'vegetative',
    intervalMinDays: 5, intervalMaxDays: 7, startOffsetDays: 7, defaultRescheduleMode: 'anchor' as const },
  { taskName: '유인', cropType: 'cherry_tomato', stageName: 'vegetative',
    intervalMinDays: 7, intervalMaxDays: 7, startOffsetDays: 0, defaultRescheduleMode: 'anchor' as const },
  { taskName: '병해충 점검', cropType: 'cherry_tomato', stageName: 'vegetative',
    intervalMinDays: 7, intervalMaxDays: 7, startOffsetDays: 0, defaultRescheduleMode: 'anchor' as const },
  { taskName: '화방 점검', cropType: 'cherry_tomato', stageName: 'flowering_fruit',
    intervalMinDays: 5, intervalMaxDays: 5, startOffsetDays: 0, defaultRescheduleMode: 'anchor' as const },
  { taskName: '적엽', cropType: 'cherry_tomato', stageName: 'flowering_fruit',
    intervalMinDays: 10, intervalMaxDays: 14, startOffsetDays: 7, defaultRescheduleMode: 'anchor' as const },
  { taskName: '수확 점검', cropType: 'cherry_tomato', stageName: 'harvest',
    intervalMinDays: 2, intervalMaxDays: 2, startOffsetDays: 0, defaultRescheduleMode: 'shift' as const },
];

const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

@Injectable()
export class HarvestTaskService implements OnModuleInit {
  private readonly logger = new Logger(HarvestTaskService.name);

  constructor(
    @InjectRepository(TaskTemplate) private templateRepo: Repository<TaskTemplate>,
    @InjectRepository(BatchTask) private batchTaskRepo: Repository<BatchTask>,
    @InjectRepository(TaskOccurrence) private occurrenceRepo: Repository<TaskOccurrence>,
    @InjectRepository(CropBatch) private batchRepo: Repository<CropBatch>,
    private dataSource: DataSource,
  ) {}

  async onModuleInit() {
    try {
      for (const preset of STAGE_TASK_PRESETS) {
        const midDays = Math.ceil((preset.intervalMinDays + preset.intervalMaxDays) / 2);
        // upsert: task_name + stage_name + crop_type 기준으로 존재하면 업데이트, 없으면 생성
        const existing = await this.dataSource.query(
          `SELECT id FROM task_templates WHERE task_name = $1 AND stage_name = $2 AND crop_type = $3 AND is_preset = true LIMIT 1`,
          [preset.taskName, preset.stageName, preset.cropType],
        );
        if (existing.length > 0) {
          await this.dataSource.query(
            `UPDATE task_templates SET interval_days = $1, interval_min_days = $2, interval_max_days = $3, start_offset_days = $4, default_reschedule_mode = $5 WHERE id = $6`,
            [midDays, preset.intervalMinDays, preset.intervalMaxDays, preset.startOffsetDays, preset.defaultRescheduleMode, existing[0].id],
          );
          this.logger.log(`Stage preset updated: ${preset.stageName}/${preset.taskName}`);
        } else {
          await this.dataSource.query(
            `INSERT INTO task_templates (user_id, task_name, crop_type, stage_name, interval_days, interval_min_days, interval_max_days, start_offset_days, default_reschedule_mode, is_preset)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)`,
            [SYSTEM_USER_ID, preset.taskName, preset.cropType, preset.stageName, midDays, preset.intervalMinDays, preset.intervalMaxDays, preset.startOffsetDays, preset.defaultRescheduleMode],
          );
          this.logger.log(`Stage preset created: ${preset.stageName}/${preset.taskName}`);
        }
      }
    } catch (err) {
      this.logger.warn(`Preset init failed (will retry on next restart): ${err.message}`);
    }
  }

  // ── 단계 판정 (정식일 기준 자동 계산, seedling 없음) ──

  determineStage(sowDate: string, transplantDate?: string): string {
    if (!transplantDate) return 'vegetative';

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tp = new Date(transplantDate);

    // 정식일 이전이라도 vegetative (seedling 단계 없음)
    if (today < tp) return 'vegetative';

    const daysSinceTransplant = Math.floor((today.getTime() - tp.getTime()) / 86400000);
    if (daysSinceTransplant >= STAGE_OFFSETS.harvest) return 'harvest';
    if (daysSinceTransplant >= STAGE_OFFSETS.flowering_fruit) return 'flowering_fruit';
    return 'vegetative';
  }

  // ── 단계별 템플릿 자동 적용 ──

  async applyStageTemplates(userId: string, batchId: string, stage: string): Promise<void> {
    const batch = await this.batchRepo.findOneOrFail({ where: { id: batchId, userId } });
    const growEndDate = this.addDays(batch.sowDate, batch.growDays);
    const templates = await this.templateRepo.find({
      where: { stageName: stage, isPreset: true },
    });

    for (const template of templates) {
      const existing = await this.batchTaskRepo.findOne({
        where: { batchId, templateId: template.id },
      });

      if (existing) {
        // 비활성 batch_task → 재활성화 + occurrence 재생성
        if (!existing.isActive) {
          existing.isActive = true;
          existing.anchorDate = this.calcAnchorDate(batch, template);
          await this.batchTaskRepo.save(existing);
          await this.generateFlexOccurrences(existing, template, growEndDate, batch.transplantDate);
        }
        continue;
      }

      const anchorDate = this.calcAnchorDate(batch, template);
      const batchTask = this.batchTaskRepo.create({
        batchId,
        templateId: template.id,
        anchorDate,
        rescheduleMode: template.defaultRescheduleMode,
      });
      const saved = await this.batchTaskRepo.save(batchTask);
      await this.generateFlexOccurrences(saved, template, growEndDate, batch.transplantDate);
    }
  }

  private calcAnchorDate(batch: CropBatch, template: TaskTemplate): string {
    // 정식일(transplantDate) + 단계 오프셋 + 템플릿 startOffset
    const stageName = template.stageName || 'vegetative';
    const baseDate = batch.transplantDate || batch.sowDate;
    const stageOffset = STAGE_OFFSETS[stageName] || 0;
    return this.addDays(baseDate, stageOffset + template.startOffsetDays);
  }

  // ── 자동 단계 진행 (정식일 기준) ──

  async autoAdvanceStages(userId: string): Promise<void> {
    const batches = await this.batchRepo.find({
      where: { userId, status: 'active' as any },
    });

    for (const batch of batches) {
      const expectedStage = this.determineStage(batch.sowDate, batch.transplantDate);
      if (batch.currentStage === expectedStage) continue;

      const oldIdx = STAGE_ORDER.indexOf(batch.currentStage);
      const newIdx = STAGE_ORDER.indexOf(expectedStage);

      // 전진만 허용 (역행 불가)
      if (newIdx <= oldIdx) continue;

      batch.currentStage = expectedStage;
      batch.stage = expectedStage;
      batch.stageStartedAt = new Date();
      await this.batchRepo.save(batch);

      // 기존 단계와 새 단계 사이의 템플릿 적용
      for (let i = oldIdx + 1; i <= newIdx; i++) {
        await this.applyStageTemplates(userId, batch.id, STAGE_ORDER[i]);
      }

      this.logger.log(`Auto-advanced batch ${batch.id}: ${batch.currentStage} → ${expectedStage}`);
    }
  }

  // ── 배치별 작업 요약 ──

  async getTaskSummary(userId: string, batchId: string) {
    await this.batchRepo.findOneOrFail({ where: { id: batchId, userId } });
    const today = new Date().toISOString().slice(0, 10);

    const todayTasks = await this.dataSource
      .createQueryBuilder()
      .select([
        'o.id AS "id"',
        `TO_CHAR(o.scheduled_date, 'YYYY-MM-DD') AS "scheduledDate"`,
        'o.status AS "status"',
        `TO_CHAR(o.window_end_date, 'YYYY-MM-DD') AS "windowEndDate"`,
        'tt.task_name AS "taskName"',
      ])
      .from('task_occurrences', 'o')
      .innerJoin('batch_tasks', 'bt', 'bt.id = o.batch_task_id')
      .innerJoin('task_templates', 'tt', 'tt.id = bt.template_id')
      .where('o.batch_id = :batchId', { batchId })
      .andWhere('o.status = :status', { status: 'planned' })
      .andWhere('o.scheduled_date <= :today', { today })
      .orderBy('o.scheduled_date', 'ASC')
      .getRawMany();

    const upcoming = await this.dataSource
      .createQueryBuilder()
      .select([
        'o.id AS "id"',
        `TO_CHAR(o.scheduled_date, 'YYYY-MM-DD') AS "scheduledDate"`,
        `TO_CHAR(o.window_end_date, 'YYYY-MM-DD') AS "windowEndDate"`,
        'tt.task_name AS "taskName"',
      ])
      .from('task_occurrences', 'o')
      .innerJoin('batch_tasks', 'bt', 'bt.id = o.batch_task_id')
      .innerJoin('task_templates', 'tt', 'tt.id = bt.template_id')
      .where('o.batch_id = :batchId', { batchId })
      .andWhere('o.status = :status', { status: 'planned' })
      .andWhere('o.scheduled_date > :today', { today })
      .orderBy('o.scheduled_date', 'ASC')
      .limit(2)
      .getRawMany();

    return { todayTasks, upcoming };
  }

  // ── 템플릿 CRUD ──

  async findAllTemplates(userId: string): Promise<TaskTemplate[]> {
    return this.templateRepo
      .createQueryBuilder('t')
      .where('t.user_id = :userId OR t.is_preset = true', { userId })
      .orderBy('t.is_preset', 'DESC')
      .addOrderBy('t.stage_name', 'ASC')
      .addOrderBy('t.task_name', 'ASC')
      .getMany();
  }

  async createTemplate(userId: string, dto: CreateTaskTemplateDto): Promise<TaskTemplate> {
    const template = this.templateRepo.create({
      taskName: dto.taskName,
      cropType: dto.cropType || 'cherry_tomato',
      stageName: dto.stageName || null,
      intervalDays: dto.intervalDays,
      intervalMinDays: dto.intervalMinDays || dto.intervalDays,
      intervalMaxDays: dto.intervalMaxDays || dto.intervalDays,
      startOffsetDays: dto.startOffsetDays,
      defaultRescheduleMode: (dto.defaultRescheduleMode || 'anchor') as TaskTemplate['defaultRescheduleMode'],
      userId,
      isPreset: false,
    });
    return this.templateRepo.save(template);
  }

  async updateTemplate(userId: string, id: string, dto: UpdateTaskTemplateDto): Promise<TaskTemplate> {
    const template = await this.templateRepo.findOneOrFail({ where: { id } });
    if (template.isPreset) throw new ForbiddenException('프리셋 템플릿은 수정할 수 없습니다.');
    if (template.userId !== userId) throw new ForbiddenException('권한이 없습니다.');

    const updateData: Partial<TaskTemplate> = {};
    if (dto.taskName !== undefined) updateData.taskName = dto.taskName;
    if (dto.cropType !== undefined) updateData.cropType = dto.cropType;
    if (dto.stageName !== undefined) updateData.stageName = dto.stageName;
    if (dto.intervalDays !== undefined) updateData.intervalDays = dto.intervalDays;
    if (dto.intervalMinDays !== undefined) updateData.intervalMinDays = dto.intervalMinDays;
    if (dto.intervalMaxDays !== undefined) updateData.intervalMaxDays = dto.intervalMaxDays;
    if (dto.startOffsetDays !== undefined) updateData.startOffsetDays = dto.startOffsetDays;
    if (dto.defaultRescheduleMode !== undefined) {
      updateData.defaultRescheduleMode = dto.defaultRescheduleMode as TaskTemplate['defaultRescheduleMode'];
    }
    await this.templateRepo.update(id, updateData);
    return this.templateRepo.findOneOrFail({ where: { id } });
  }

  async removeTemplate(userId: string, id: string): Promise<void> {
    const template = await this.templateRepo.findOneOrFail({ where: { id } });
    if (template.isPreset) throw new ForbiddenException('프리셋 템플릿은 삭제할 수 없습니다.');
    if (template.userId !== userId) throw new ForbiddenException('권한이 없습니다.');
    await this.templateRepo.delete(id);
  }

  // ── 배치에 템플릿 적용 (수동) ──

  async applyTemplate(userId: string, batchId: string, templateId: string) {
    const batch = await this.batchRepo.findOneOrFail({ where: { id: batchId, userId } });
    const template = await this.templateRepo.findOneOrFail({ where: { id: templateId } });

    const anchorDate = this.calcAnchorDate(batch, template);
    const batchTask = this.batchTaskRepo.create({
      batchId,
      templateId,
      anchorDate,
      rescheduleMode: template.defaultRescheduleMode,
    });
    const saved = await this.batchTaskRepo.save(batchTask);
    const growEndDate = this.addDays(batch.sowDate, batch.growDays);
    await this.generateFlexOccurrences(saved, template, growEndDate, batch.transplantDate);
    return saved;
  }

  async removeTemplateFromBatch(userId: string, batchId: string, batchTaskId: string): Promise<void> {
    await this.batchRepo.findOneOrFail({ where: { id: batchId, userId } });
    await this.batchTaskRepo.delete({ id: batchTaskId, batchId });
  }

  // ── Occurrence 조회 ──

  async findOccurrences(userId: string, query: {
    startDate: string;
    endDate: string;
    groupId?: string;
    houseId?: string;
    batchId?: string;
  }) {
    const qb = this.dataSource
      .createQueryBuilder()
      .select([
        'o.id AS "id"',
        `TO_CHAR(o.scheduled_date, 'YYYY-MM-DD') AS "scheduledDate"`,
        `TO_CHAR(o.window_end_date, 'YYYY-MM-DD') AS "windowEndDate"`,
        'o.status AS "status"',
        `TO_CHAR(o.done_date, 'YYYY-MM-DD') AS "doneDate"`,
        'o.growth_feedback AS "growthFeedback"',
        'o.memo AS "memo"',
        'tt.task_name AS "taskName"',
        'tt.interval_days AS "intervalDays"',
        'tt.interval_min_days AS "intervalMinDays"',
        'tt.interval_max_days AS "intervalMaxDays"',
        'tt.stage_name AS "stageName"',
        'cb.id AS "batchId"',
        'cb.crop_name AS "cropName"',
        'cb.variety AS "variety"',
        'cb.house_name AS "houseName"',
        'cb.house_id AS "houseId"',
        'cb.group_id AS "groupId"',
        'cb.current_stage AS "currentStage"',
        'hg.id AS "hgGroupId"',
        'hg.name AS "groupName"',
        'bt.id AS "batchTaskId"',
        'bt.reschedule_mode AS "rescheduleMode"',
      ])
      .from('task_occurrences', 'o')
      .innerJoin('batch_tasks', 'bt', 'bt.id = o.batch_task_id')
      .innerJoin('task_templates', 'tt', 'tt.id = bt.template_id')
      .innerJoin('crop_batches', 'cb', 'cb.id = o.batch_id')
      .leftJoin('house_groups', 'hg', 'hg.id = cb.group_id')
      .where('cb.user_id = :userId', { userId })
      .andWhere('o.scheduled_date BETWEEN :startDate AND :endDate', {
        startDate: query.startDate,
        endDate: query.endDate,
      });

    if (query.groupId) {
      qb.andWhere('cb.group_id = :groupId', { groupId: query.groupId });
    }
    if (query.houseId) {
      qb.andWhere('cb.house_id = :houseId', { houseId: query.houseId });
    }
    if (query.batchId) {
      qb.andWhere('cb.id = :batchId', { batchId: query.batchId });
    }

    qb.orderBy('o.scheduled_date', 'ASC')
      .addOrderBy('cb.crop_name', 'ASC');

    return qb.getRawMany();
  }

  // ── Occurrence 액션 ──

  async completeOccurrence(userId: string, id: string, dto: CompleteOccurrenceDto) {
    const occurrence = await this.occurrenceRepo.findOneOrFail({ where: { id } });
    await this.batchRepo.findOneOrFail({ where: { id: occurrence.batchId, userId } });

    const today = new Date().toISOString().slice(0, 10);
    occurrence.status = 'done';
    occurrence.doneDate = today;
    if (dto.memo) occurrence.memo = dto.memo;
    if (dto.growthFeedback) occurrence.growthFeedback = dto.growthFeedback;
    await this.occurrenceRepo.save(occurrence);

    // remember choice
    if (dto.rememberChoice) {
      await this.batchTaskRepo.update(
        { id: occurrence.batchTaskId },
        { rescheduleMode: dto.rescheduleMode as any },
      );
    }

    // 생육 피드백 + shift 모드 → 피드백 기반 간격 조정
    if (dto.growthFeedback && dto.rescheduleMode === 'shift') {
      await this.rescheduleWithFeedback(occurrence, dto.growthFeedback);
    } else {
      await this.reschedule(occurrence, dto.rescheduleMode);
    }
    return occurrence;
  }

  async postponeOccurrence(userId: string, id: string) {
    const occurrence = await this.occurrenceRepo.findOneOrFail({ where: { id } });
    await this.batchRepo.findOneOrFail({ where: { id: occurrence.batchId, userId } });

    occurrence.scheduledDate = this.addDays(occurrence.scheduledDate, 1);
    return this.occurrenceRepo.save(occurrence);
  }

  async skipOccurrence(userId: string, id: string) {
    const occurrence = await this.occurrenceRepo.findOneOrFail({ where: { id } });
    await this.batchRepo.findOneOrFail({ where: { id: occurrence.batchId, userId } });

    occurrence.status = 'skipped';
    return this.occurrenceRepo.save(occurrence);
  }

  // ── 재스케줄 로직 ──

  private async reschedule(occurrence: TaskOccurrence, mode: string): Promise<void> {
    if (mode === 'anchor' || mode === 'one_time') return;

    if (mode === 'shift') {
      const batchTask = await this.batchTaskRepo.findOneOrFail({
        where: { id: occurrence.batchTaskId },
      });
      const template = await this.templateRepo.findOneOrFail({
        where: { id: batchTask.templateId },
      });
      const batch = await this.batchRepo.findOneOrFail({ where: { id: batchTask.batchId } });
      const growEndDate = this.addDays(batch.sowDate, batch.growDays);

      batchTask.anchorDate = occurrence.doneDate;
      await this.batchTaskRepo.save(batchTask);

      await this.deleteFuturePlanned(batchTask.id, occurrence.doneDate);
      await this.generateFlexOccurrences(batchTask, template, growEndDate);
    }
  }

  private async rescheduleWithFeedback(
    occurrence: TaskOccurrence, feedback: string
  ): Promise<void> {
    const batchTask = await this.batchTaskRepo.findOneOrFail({
      where: { id: occurrence.batchTaskId },
    });
    const template = await this.templateRepo.findOneOrFail({
      where: { id: batchTask.templateId },
    });
    const batch = await this.batchRepo.findOneOrFail({ where: { id: batchTask.batchId } });
    const growEndDate = this.addDays(batch.sowDate, batch.growDays);

    const minDays = template.intervalMinDays || template.intervalDays;
    const maxDays = template.intervalMaxDays || template.intervalDays;

    let nextInterval: number;
    switch (feedback) {
      case 'growth_fast': nextInterval = minDays; break;
      case 'growth_slow': nextInterval = maxDays; break;
      default: nextInterval = Math.ceil((minDays + maxDays) / 2); break;
    }

    batchTask.anchorDate = occurrence.doneDate;
    await this.batchTaskRepo.save(batchTask);

    await this.deleteFuturePlanned(batchTask.id, occurrence.doneDate);
    await this.generateFlexOccurrencesWithInterval(batchTask, template, growEndDate, nextInterval);
  }

  private async deleteFuturePlanned(batchTaskId: string, afterDate: string): Promise<void> {
    await this.occurrenceRepo
      .createQueryBuilder()
      .delete()
      .from(TaskOccurrence)
      .where('batch_task_id = :batchTaskId', { batchTaskId })
      .andWhere('status = :status', { status: 'planned' })
      .andWhere('scheduled_date > :afterDate', { afterDate })
      .execute();
  }

  // ── Occurrence 생성 (유연 간격) ──

  private async generateFlexOccurrences(
    batchTask: BatchTask, template: TaskTemplate, growEndDate: string, transplantDate?: string
  ): Promise<void> {
    const minDays = template.intervalMinDays || template.intervalDays;
    const maxDays = template.intervalMaxDays || template.intervalDays;
    const midDays = Math.ceil((minDays + maxDays) / 2);
    await this.generateFlexOccurrencesWithInterval(batchTask, template, growEndDate, midDays, transplantDate);
  }

  private async generateFlexOccurrencesWithInterval(
    batchTask: BatchTask, template: TaskTemplate, growEndDate: string, interval: number, transplantDate?: string
  ): Promise<void> {
    const minDays = template.intervalMinDays || template.intervalDays;
    const maxDays = template.intervalMaxDays || template.intervalDays;
    const windowExtra = maxDays - minDays;

    const anchor = new Date(batchTask.anchorDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 정식일이 미래면 정식일 기준, 아니면 오늘 기준으로 occurrence 시작
    const cutoffDate = transplantDate ? new Date(transplantDate) : today;
    const baseDate = cutoffDate > today ? cutoffDate : today;
    // growEndDate(파종일+생육일수)까지 occurrence 생성
    const endDate = new Date(growEndDate);

    const occurrences: Partial<TaskOccurrence>[] = [];

    for (let k = 0; ; k++) {
      const schedDate = new Date(anchor);
      schedDate.setDate(schedDate.getDate() + k * interval);

      if (schedDate > endDate) break;
      if (schedDate < cutoffDate) continue;

      const windowEnd = new Date(schedDate);
      windowEnd.setDate(windowEnd.getDate() + windowExtra);

      occurrences.push({
        batchTaskId: batchTask.id,
        batchId: batchTask.batchId,
        scheduledDate: schedDate.toISOString().slice(0, 10),
        windowEndDate: windowExtra > 0 ? windowEnd.toISOString().slice(0, 10) : undefined,
        status: 'planned',
      });
    }

    if (occurrences.length > 0) {
      await this.occurrenceRepo
        .createQueryBuilder()
        .insert()
        .into(TaskOccurrence)
        .values(occurrences as any[])
        .execute();
    }

    this.logger.log(`Generated ${occurrences.length} flex occurrences for batchTask ${batchTask.id} (interval=${interval}d)`);
  }

  // ── 날짜 변경 시 occurrence 재생성 ──

  async regenerateOccurrences(userId: string, batchId: string): Promise<void> {
    const batch = await this.batchRepo.findOneOrFail({ where: { id: batchId, userId } });

    // 1. 기존 planned occurrence 모두 삭제
    await this.dataSource.query(
      `DELETE FROM task_occurrences WHERE batch_id = $1 AND status = 'planned'`,
      [batchId],
    );

    // 2. 기존 batch_tasks 삭제
    await this.dataSource.query(
      `DELETE FROM batch_tasks WHERE batch_id = $1`,
      [batchId],
    );

    // 3. 새 단계 판정
    const newStage = this.determineStage(batch.sowDate, batch.transplantDate);
    batch.currentStage = newStage;
    batch.stage = newStage;
    batch.stageStartedAt = new Date();
    await this.batchRepo.save(batch);

    // 4. 현재 단계까지의 모든 템플릿 재적용
    const currentIdx = STAGE_ORDER.indexOf(newStage);
    for (let i = 0; i <= currentIdx; i++) {
      await this.applyStageTemplates(userId, batchId, STAGE_ORDER[i]);
    }

    this.logger.log(`Regenerated occurrences for batch ${batchId} (stage=${newStage})`);
  }

  // ── 유틸 ──

  private addDays(dateStr: string, days: number): string {
    const d = new Date(dateStr);
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }
}
