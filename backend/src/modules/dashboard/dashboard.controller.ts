import { Controller, Get, HttpException, NotFoundException, UseGuards } from '@nestjs/common';
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
  async getWeather(@CurrentUser() user: any) {
    const effectiveUserId = user.role === 'farm_user' && user.parentUserId ? user.parentUserId : user.id;
    try {
      return await this.dashboardService.getWeatherCached(effectiveUserId);
    } catch (e) {
      // 플랫폼 관리자가 농장 보기(X-Farm-Context) 중이면: 어느 농장의 무엇을 어디서 고치는지 알려주는 관리자용 문구
      const code = e instanceof HttpException ? (e.getResponse() as any)?.code : undefined;
      if (user.farmContext && (code === 'FARM_ADDRESS_MISSING' || code === 'FARM_ADDRESS_UNMAPPED')) {
        const farm = await this.dashboardService.describeFarm(effectiveUserId);
        const what = code === 'FARM_ADDRESS_MISSING'
          ? '농장 위치(주소)가 설정되지 않았습니다'
          : `농장 위치(${farm.address})로 날씨 지역을 찾지 못했습니다`;
        throw new NotFoundException({
          code,
          message: `[${farm.farmName}] ${what} — 날씨 표시와 날씨 조건 자동 제어가 동작하지 않습니다. 콘솔 '사용자'에서 ${farm.farmName} 관리자 계정(@${farm.username})을 편집해 '농장 위치'를 입력하세요.`,
        });
      }
      throw e;
    }
  }

  @Get('widgets')
  getWidgets(@CurrentUser() user: any) {
    const effectiveUserId = user.role === 'farm_user' && user.parentUserId ? user.parentUserId : user.id;
    return this.dashboardService.getWidgetData(effectiveUserId);
  }
}
