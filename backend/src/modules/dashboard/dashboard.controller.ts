import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
@UseGuards(JwtAuthGuard)
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
