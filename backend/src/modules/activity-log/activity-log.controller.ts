import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ActivityLogService } from './activity-log.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('activity-logs')
@UseGuards(JwtAuthGuard)
export class ActivityLogController {
  constructor(private readonly service: ActivityLogService) {}

  @Get()
  findAll(
    @CurrentUser() user: any,
    @Query('groupId') groupId?: string,
    @Query('action') action?: string,
    @Query('targetType') targetType?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.findAll({
      // 농장 단위 — 농장 사용자는 소속 농장, 농장 관리자는 자기 농장 (본인 + 소속 사용자들의 조작을 함께 본다)
      userId: user.role === 'farm_user' && user.parentUserId ? user.parentUserId : (user.sub || user.id),
      isAdmin: user.role === 'admin',
      groupId,
      action,
      targetType,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }
}
