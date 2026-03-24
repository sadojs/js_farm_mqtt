import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { HarvestService } from './harvest.service';
import { HarvestTaskService } from './harvest-task.service';
import { CreateBatchDto, UpdateBatchDto } from './dto/create-batch.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('harvest')
@UseGuards(JwtAuthGuard)
export class HarvestController {
  constructor(
    private harvestService: HarvestService,
    private harvestTaskService: HarvestTaskService,
  ) {}

  private getEffectiveUserId(user: any): string {
    return user.role === 'farm_user' && user.parentUserId ? user.parentUserId : user.id;
  }

  @Get('batches')
  async findAll(@CurrentUser() user: any, @Query('status') status?: string) {
    const userId = this.getEffectiveUserId(user);
    // 조회 시 단계 자동 진행 (정식일 기준)
    await this.harvestTaskService.autoAdvanceStages(userId);
    return this.harvestService.findAll(userId, status);
  }

  @Get('batches/:id')
  findOne(@CurrentUser() user: any, @Param('id') id: string) {
    return this.harvestService.findOne(this.getEffectiveUserId(user), id);
  }

  @Post('batches')
  async create(@CurrentUser() user: any, @Body() dto: CreateBatchDto) {
    const userId = this.getEffectiveUserId(user);
    const batch = await this.harvestService.create(userId, dto);

    // 현재 단계까지의 모든 템플릿 적용
    const stageOrder = ['vegetative', 'flowering_fruit', 'harvest'];
    const currentIdx = stageOrder.indexOf(batch.currentStage);
    for (let i = 0; i <= currentIdx; i++) {
      await this.harvestTaskService.applyStageTemplates(userId, batch.id, stageOrder[i]);
    }
    return batch;
  }

  @Put('batches/:id')
  async update(@CurrentUser() user: any, @Param('id') id: string, @Body() dto: UpdateBatchDto) {
    const userId = this.getEffectiveUserId(user);
    const oldBatch = await this.harvestService.findOne(userId, id);
    const batch = await this.harvestService.update(userId, id, dto);

    // 날짜 변경 시 occurrence 재생성
    const datesChanged =
      (dto.sowDate && dto.sowDate !== oldBatch.sowDate) ||
      (dto.transplantDate !== undefined && dto.transplantDate !== (oldBatch.transplantDate || ''));

    if (datesChanged) {
      await this.harvestTaskService.regenerateOccurrences(userId, id);
    }

    return this.harvestService.findOne(userId, id);
  }

  @Put('batches/:id/complete')
  complete(@CurrentUser() user: any, @Param('id') id: string) {
    return this.harvestService.complete(this.getEffectiveUserId(user), id);
  }

  @Post('batches/:id/clone')
  clone(@CurrentUser() user: any, @Param('id') id: string, @Body('houseName') houseName: string) {
    return this.harvestService.clone(this.getEffectiveUserId(user), id, houseName);
  }

  @Delete('batches/:id')
  remove(@CurrentUser() user: any, @Param('id') id: string) {
    return this.harvestService.remove(this.getEffectiveUserId(user), id);
  }
}
