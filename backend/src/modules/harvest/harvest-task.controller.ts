import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { HarvestTaskService } from './harvest-task.service';
import { CreateTaskTemplateDto, UpdateTaskTemplateDto } from './dto/task-template.dto';
import { CompleteOccurrenceDto, ApplyTemplateDto } from './dto/occurrence-action.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('harvest')
@UseGuards(JwtAuthGuard)
export class HarvestTaskController {
  constructor(private harvestTaskService: HarvestTaskService) {}

  private getEffectiveUserId(user: any): string {
    return user.role === 'farm_user' && user.parentUserId ? user.parentUserId : user.id;
  }

  // ── 템플릿 ──

  @Get('templates')
  findAllTemplates(@CurrentUser() user: any) {
    return this.harvestTaskService.findAllTemplates(this.getEffectiveUserId(user));
  }

  @Post('templates')
  createTemplate(@CurrentUser() user: any, @Body() dto: CreateTaskTemplateDto) {
    return this.harvestTaskService.createTemplate(this.getEffectiveUserId(user), dto);
  }

  @Put('templates/:id')
  updateTemplate(@CurrentUser() user: any, @Param('id') id: string, @Body() dto: UpdateTaskTemplateDto) {
    return this.harvestTaskService.updateTemplate(this.getEffectiveUserId(user), id, dto);
  }

  @Delete('templates/:id')
  removeTemplate(@CurrentUser() user: any, @Param('id') id: string) {
    return this.harvestTaskService.removeTemplate(this.getEffectiveUserId(user), id);
  }

  @Get('batches/:batchId/task-summary')
  getTaskSummary(
    @CurrentUser() user: any,
    @Param('batchId') batchId: string,
  ) {
    return this.harvestTaskService.getTaskSummary(this.getEffectiveUserId(user), batchId);
  }

  // ── 배치-템플릿 연결 ──

  @Post('batches/:batchId/apply-template')
  applyTemplate(
    @CurrentUser() user: any,
    @Param('batchId') batchId: string,
    @Body() dto: ApplyTemplateDto,
  ) {
    return this.harvestTaskService.applyTemplate(this.getEffectiveUserId(user), batchId, dto.templateId);
  }

  @Delete('batches/:batchId/tasks/:taskId')
  removeTemplateFromBatch(
    @CurrentUser() user: any,
    @Param('batchId') batchId: string,
    @Param('taskId') taskId: string,
  ) {
    return this.harvestTaskService.removeTemplateFromBatch(this.getEffectiveUserId(user), batchId, taskId);
  }

  // ── Occurrence ──

  @Get('occurrences')
  findOccurrences(
    @CurrentUser() user: any,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('groupId') groupId?: string,
    @Query('houseId') houseId?: string,
    @Query('batchId') batchId?: string,
  ) {
    return this.harvestTaskService.findOccurrences(this.getEffectiveUserId(user), {
      startDate,
      endDate,
      groupId,
      houseId,
      batchId,
    });
  }

  @Put('occurrences/:id/complete')
  completeOccurrence(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: CompleteOccurrenceDto,
  ) {
    return this.harvestTaskService.completeOccurrence(this.getEffectiveUserId(user), id, dto);
  }

  @Put('occurrences/:id/postpone')
  postponeOccurrence(@CurrentUser() user: any, @Param('id') id: string) {
    return this.harvestTaskService.postponeOccurrence(this.getEffectiveUserId(user), id);
  }

  @Put('occurrences/:id/skip')
  skipOccurrence(@CurrentUser() user: any, @Param('id') id: string) {
    return this.harvestTaskService.skipOccurrence(this.getEffectiveUserId(user), id);
  }
}
