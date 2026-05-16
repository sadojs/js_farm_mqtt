import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { SensorsService } from './sensors.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('sensor-data')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'farm_admin', 'farm_user')
export class SensorsController {
  constructor(private sensorsService: SensorsService) {}

  @Get()
  queryData(
    @CurrentUser() user: any,
    @Query('sensorType') sensorType: string,
    @Query('startTime') startTime: string,
    @Query('endTime') endTime: string,
    @Query('aggregation') aggregation: string,
    @Query('deviceId') deviceId: string,
    @Query('limit') limit: string,
    @Query('offset') offset: string,
  ) {
    const userId = user.role === 'farm_user' && user.parentUserId ? user.parentUserId : user.id;
    return this.sensorsService.queryData(userId, {
      sensorType,
      startTime,
      endTime,
      aggregation,
      deviceId,
      limit: limit ? parseInt(limit) : undefined,
      offset: offset ? parseInt(offset) : undefined,
    });
  }

  @Get('latest')
  getLatest(@CurrentUser() user: any) {
    // 플랫폼 관리자(admin)는 모든 사용자 센서 데이터 조회 가능 (user_id 필터링 없이)
    if (user.role === 'admin') {
      return this.sensorsService.getLatest(null);
    }
    const userId = user.role === 'farm_user' && user.parentUserId ? user.parentUserId : user.id;
    return this.sensorsService.getLatest(userId);
  }
}
