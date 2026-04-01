import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'farm_admin', 'farm_user')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('weather')
  getWeather(@CurrentUser() user: any) {
    const effectiveUserId = user.role === 'farm_user' && user.parentUserId ? user.parentUserId : user.id;
    return this.dashboardService.getWeatherForUser(effectiveUserId);
  }

  @Get('widgets')
  getWidgets(@CurrentUser() user: any) {
    const effectiveUserId = user.role === 'farm_user' && user.parentUserId ? user.parentUserId : user.id;
    return this.dashboardService.getWidgetData(effectiveUserId);
  }
}
