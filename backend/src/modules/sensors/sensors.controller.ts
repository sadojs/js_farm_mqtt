import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { SensorsService } from './sensors.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('sensor-data')
@UseGuards(JwtAuthGuard)
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
    const userId = user.role === 'farm_user' && user.parentUserId ? user.parentUserId : user.id;
    return this.sensorsService.getLatest(userId);
  }
}
