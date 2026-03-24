import { Controller, Get, Post, Query, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { HarvestRecService } from './harvest-rec.service';
import { CreateTaskLogDto } from './dto/create-task-log.dto';

@Controller('harvest-rec')
@UseGuards(JwtAuthGuard)
export class HarvestRecController {
  constructor(private readonly service: HarvestRecService) {}

  /** 추천 카드 + 환경 요약 조회 */
  @Get('recommendations')
  getRecommendations(@CurrentUser() user: any) {
    const userId = this.getEffectiveUserId(user);
    return this.service.getRecommendations(userId);
  }

  /** 작업 완료 기록 */
  @Post('task-logs')
  createTaskLog(@CurrentUser() user: any, @Body() dto: CreateTaskLogDto) {
    const userId = this.getEffectiveUserId(user);
    return this.service.createTaskLog(userId, dto);
  }

  /** 작업 완료 이력 조회 */
  @Get('task-logs')
  getTaskLogs(@CurrentUser() user: any, @Query('batchId') batchId?: string) {
    const userId = this.getEffectiveUserId(user);
    return this.service.getTaskLogs(userId, batchId);
  }

  private getEffectiveUserId(user: any): string {
    return user.role === 'farm_user' && user.parentUserId
      ? user.parentUserId
      : user.id;
  }
}
