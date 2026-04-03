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
      userId: user.sub || user.id,
      isAdmin: user.role === 'admin',
      groupId,
      action,
      targetType,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }
}
