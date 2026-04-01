import { Controller, Get, Put, Delete, Param, Query, Body, UseGuards } from '@nestjs/common';
import { SensorAlertsService } from './sensor-alerts.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('sensor-alerts')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'farm_admin', 'farm_user')
export class SensorAlertsController {
  constructor(private alertsService: SensorAlertsService) {}

  private getEffectiveUserId(user: any): string {
    return user.role === 'farm_user' && user.parentUserId ? user.parentUserId : user.id;
  }

  @Get('sensors')
  getSensors(@CurrentUser() user: any) {
    return this.alertsService.getSensorsWithStatus(this.getEffectiveUserId(user));
  }

  @Put('sensors/standby')
  addStandby(
    @CurrentUser() user: any,
    @Body('deviceId') deviceId: string,
    @Body('sensorType') sensorType: string,
  ) {
    return this.alertsService.addStandby(this.getEffectiveUserId(user), deviceId, sensorType);
  }

  @Delete('sensors/standby')
  removeStandby(
    @CurrentUser() user: any,
    @Body('deviceId') deviceId: string,
    @Body('sensorType') sensorType: string,
  ) {
    return this.alertsService.removeStandby(this.getEffectiveUserId(user), deviceId, sensorType);
  }

  @Get()
  findAll(
    @CurrentUser() user: any,
    @Query('severity') severity?: string,
    @Query('resolved') resolved?: string,
    @Query('deviceId') deviceId?: string,
    @Query('limit') limitStr?: string,
    @Query('offset') offsetStr?: string,
  ) {
    const limit = Math.min(Math.max(parseInt(limitStr || '100', 10) || 100, 1), 200);
    const offset = Math.max(parseInt(offsetStr || '0', 10) || 0, 0);
    return this.alertsService.findAll(this.getEffectiveUserId(user), {
      severity,
      resolved: resolved === 'true' ? true : resolved === 'false' ? false : undefined,
      deviceId,
      limit,
      offset,
    });
  }

  @Get(':id')
  findOne(@CurrentUser() user: any, @Param('id') id: string) {
    return this.alertsService.findOneWithStats(this.getEffectiveUserId(user), id);
  }

  @Put(':id/resolve')
  resolve(@CurrentUser() user: any, @Param('id') id: string) {
    return this.alertsService.resolve(this.getEffectiveUserId(user), id);
  }

  @Put(':id/snooze')
  snooze(@CurrentUser() user: any, @Param('id') id: string, @Body('days') days: number) {
    return this.alertsService.snooze(this.getEffectiveUserId(user), id, days);
  }

  @Delete(':id')
  remove(@CurrentUser() user: any, @Param('id') id: string) {
    return this.alertsService.remove(this.getEffectiveUserId(user), id);
  }
}
