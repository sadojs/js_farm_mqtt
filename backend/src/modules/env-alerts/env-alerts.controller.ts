import { Controller, Get, Put, Param, Body, UseGuards } from '@nestjs/common';
import { EnvAlertsService } from './env-alerts.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('env-alerts')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'farm_admin', 'farm_user')
export class EnvAlertsController {
  constructor(private readonly service: EnvAlertsService) {}

  private getEffectiveUserId(user: any): string | null {
    if (user.role === 'admin') return null;
    return user.role === 'farm_user' && user.parentUserId ? user.parentUserId : user.id;
  }

  @Get('groups/:groupId')
  get(@CurrentUser() user: any, @Param('groupId') groupId: string) {
    return this.service.get(this.getEffectiveUserId(user), groupId);
  }

  @Put('groups/:groupId')
  @Roles('admin', 'farm_admin')
  save(
    @CurrentUser() user: any,
    @Param('groupId') groupId: string,
    @Body() body: { items?: any[]; channel?: string },
  ) {
    return this.service.save(this.getEffectiveUserId(user), groupId, body ?? {});
  }
}
