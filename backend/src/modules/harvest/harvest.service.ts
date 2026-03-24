import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CropBatch } from './entities/crop-batch.entity';
import { CreateBatchDto, UpdateBatchDto } from './dto/create-batch.dto';

@Injectable()
export class HarvestService {
  constructor(
    @InjectRepository(CropBatch) private batchRepo: Repository<CropBatch>,
  ) {}

  async findAll(userId: string, status?: string) {
    const where: any = { userId };
    if (status === 'active' || status === 'completed') where.status = status;
    return this.batchRepo.find({ where, order: { createdAt: 'DESC' } });
  }

  async findOne(userId: string, id: string) {
    return this.batchRepo.findOneOrFail({ where: { id, userId } });
  }

  async create(userId: string, dto: CreateBatchDto) {
    const stage = this.determineStage(dto.sowDate, dto.transplantDate);
    const batch = this.batchRepo.create({
      ...dto,
      userId,
      houseName: dto.houseName || '',
      currentStage: stage,
      stage: stage,
      stageStartedAt: new Date(),
    });
    return this.batchRepo.save(batch);
  }

  private determineStage(sowDate: string, transplantDate?: string): string {
    if (!transplantDate) return 'vegetative';

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tp = new Date(transplantDate);

    // 정식일 이전이라도 vegetative (seedling 단계 없음)
    if (today < tp) return 'vegetative';

    const daysSinceTransplant = Math.floor(
      (today.getTime() - tp.getTime()) / 86400000
    );
    if (daysSinceTransplant >= 65) return 'harvest';
    if (daysSinceTransplant >= 30) return 'flowering_fruit';
    return 'vegetative';
  }

  async update(userId: string, id: string, dto: UpdateBatchDto) {
    await this.batchRepo.update({ id, userId }, dto);
    return this.findOne(userId, id);
  }

  async complete(userId: string, id: string) {
    await this.batchRepo.update({ id, userId }, {
      status: 'completed',
      completedAt: new Date(),
    });
    return this.findOne(userId, id);
  }

  async clone(userId: string, id: string, houseName: string) {
    const original = await this.findOne(userId, id);
    const { id: _, createdAt, updatedAt, completedAt, status, ...data } = original;
    return this.batchRepo.save(this.batchRepo.create({
      ...data,
      houseName: houseName || data.houseName,
      status: 'active',
      completedAt: undefined,
    }));
  }

  async remove(userId: string, id: string) {
    await this.batchRepo.delete({ id, userId });
    return { deleted: true };
  }
}
