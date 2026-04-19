import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CropBatch } from './entities/crop-batch.entity';
import { GddService } from './gdd.service';
import { CreateCropBatchDto } from './dto/create-crop-batch.dto';
import { UpdateCropBatchDto } from './dto/update-crop-batch.dto';
import { getCropBaseTemp, getCropTargetGdd } from './crop-defaults.constants';

@Injectable()
export class CropBatchService {
  constructor(
    @InjectRepository(CropBatch)
    private readonly repo: Repository<CropBatch>,
    private readonly gddService: GddService,
  ) {}

  async findAllByUser(userId: string): Promise<CropBatch[]> {
    return this.repo.find({
      where: { userId, isActive: true },
      order: { createdAt: 'DESC' },
    });
  }

  async create(userId: string, dto: CreateCropBatchDto): Promise<CropBatch> {
    const batch = this.repo.create({
      userId,
      groupId: dto.groupId ?? null,
      cropType: dto.cropType,
      seedlingType: dto.seedlingType,
      sowingDate: dto.sowingDate,
      transplantDate: dto.transplantDate ?? null,
      baseTemp: dto.baseTemp ?? getCropBaseTemp(dto.cropType, dto.seedlingType),
      targetGdd: dto.targetGdd ?? getCropTargetGdd(dto.cropType, dto.seedlingType),
      tempSource: dto.tempSource ?? 'auto',
      greenhouseOffset: dto.greenhouseOffset ?? null,
      offsetSource: dto.offsetSource ?? null,
      borrowedGroupId: dto.borrowedGroupId ?? null,
      notes: dto.notes ?? null,
    });
    const saved = await this.repo.save(batch);

    // 생성 직후 자동 보정 시도 (비동기, 오류 무시)
    this.gddService.autoCalibrate(saved).catch(() => {});

    return saved;
  }

  async update(userId: string, id: string, dto: UpdateCropBatchDto): Promise<CropBatch> {
    const batch = await this.findOneOwned(userId, id);
    Object.assign(batch, {
      ...(dto.cropType !== undefined && { cropType: dto.cropType }),
      ...(dto.seedlingType !== undefined && { seedlingType: dto.seedlingType }),
      ...(dto.sowingDate !== undefined && { sowingDate: dto.sowingDate }),
      ...(dto.transplantDate !== undefined && { transplantDate: dto.transplantDate }),
      ...(dto.baseTemp !== undefined && { baseTemp: dto.baseTemp }),
      ...(dto.targetGdd !== undefined && { targetGdd: dto.targetGdd }),
      ...(dto.tempSource !== undefined && { tempSource: dto.tempSource }),
      ...(dto.greenhouseOffset !== undefined && { greenhouseOffset: dto.greenhouseOffset }),
      ...(dto.offsetSource !== undefined && { offsetSource: dto.offsetSource }),
      ...(dto.borrowedGroupId !== undefined && { borrowedGroupId: dto.borrowedGroupId }),
      ...(dto.notes !== undefined && { notes: dto.notes }),
      ...(dto.isActive !== undefined && { isActive: dto.isActive }),
    });
    return this.repo.save(batch);
  }

  async remove(userId: string, id: string): Promise<void> {
    const batch = await this.findOneOwned(userId, id);
    batch.isActive = false;
    await this.repo.save(batch);
  }

  async getGdd(userId: string, id: string) {
    const batch = await this.findOneOwned(userId, id);
    return this.gddService.calculateGdd(batch);
  }

  async getMilestones(userId: string, id: string) {
    const batch = await this.findOneOwned(userId, id);
    const gddResult = await this.gddService.calculateGdd(batch);
    const milestones = await this.gddService.getMilestones(batch, gddResult.currentGdd);
    return { gdd: gddResult, milestones };
  }

  async getHarvestPrediction(userId: string, id: string) {
    const batch = await this.findOneOwned(userId, id);
    return this.gddService.getHarvestPrediction(batch);
  }

  async getDashboard(userId: string) {
    const batches = await this.findAllByUser(userId);

    // groupId → groupName 매핑 (한 번만 쿼리)
    const groupIds = [...new Set(batches.map((b) => b.groupId).filter(Boolean))] as string[];
    let groupNameMap: Record<string, string> = {};
    if (groupIds.length > 0) {
      const rows: { id: string; name: string }[] = await this.repo.manager.query(
        `SELECT id, name FROM house_groups WHERE id = ANY($1)`,
        [groupIds],
      );
      groupNameMap = Object.fromEntries(rows.map((r) => [r.id, r.name]));
    }

    const results = await Promise.all(
      batches.map(async (batch) => {
        const gdd = await this.gddService.calculateGdd(batch);
        const milestones = await this.gddService.getMilestones(batch, gdd.currentGdd);
        const nextMilestone = milestones.find((m) => m.status !== 'done') ?? null;
        return {
          batchId: batch.id,
          groupId: batch.groupId,
          groupName: batch.groupId ? (groupNameMap[batch.groupId] ?? null) : null,
          cropType: batch.cropType,
          sowingDate: batch.sowingDate,
          gdd,
          nextMilestone,
        };
      }),
    );
    return results;
  }

  async getTimeline(userId: string, id: string) {
    const batch = await this.findOneOwned(userId, id);
    return this.gddService.getTimeline(batch);
  }

  async triggerCalibrate(userId: string, id: string) {
    const batch = await this.findOneOwned(userId, id);
    const offset = await this.gddService.autoCalibrate(batch);
    return { offset };
  }

  private async findOneOwned(userId: string, id: string): Promise<CropBatch> {
    const batch = await this.repo.findOne({ where: { id } });
    if (!batch) throw new NotFoundException('배치를 찾을 수 없습니다.');
    if (batch.userId !== userId) throw new ForbiddenException();
    return batch;
  }
}
