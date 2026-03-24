import { Controller, Get, Query, UseGuards, Res } from '@nestjs/common';
import { Response } from 'express';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('reports')
@UseGuards(JwtAuthGuard)
export class ReportsController {
  constructor(private reportsService: ReportsService) {}

  private getEffectiveUserId(user: any): string {
    return user.role === 'farm_user' && user.parentUserId ? user.parentUserId : user.id;
  }

  @Get('statistics')
  async getStatistics(
    @CurrentUser() user: any,
    @Query('groupId') groupId?: string,
    @Query('sensorType') sensorType?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.reportsService.getStatistics(this.getEffectiveUserId(user), {
      groupId,
      sensorType,
      startDate,
      endDate,
    });
  }

  @Get('hourly')
  async getHourlyData(
    @CurrentUser() user: any,
    @Query('groupId') groupId?: string,
    @Query('sensorType') sensorType?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.reportsService.getHourlyData(this.getEffectiveUserId(user), {
      groupId,
      sensorType,
      startDate,
      endDate,
    });
  }

  @Get('actuator-stats')
  async getActuatorStats(
    @CurrentUser() user: any,
    @Query('groupId') groupId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.reportsService.getActuatorStats(this.getEffectiveUserId(user), {
      groupId,
      startDate,
      endDate,
    });
  }

  @Get('export/csv')
  async exportCsv(
    @CurrentUser() user: any,
    @Res() res: Response,
    @Query('groupId') groupId?: string,
    @Query('sensorType') sensorType?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const csv = await this.reportsService.exportCsv(this.getEffectiveUserId(user), {
      groupId,
      sensorType,
      startDate,
      endDate,
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=sensor_report_${new Date().toISOString().slice(0, 10)}.csv`);
    res.send('\uFEFF' + csv);
  }

  @Get('weather-hourly')
  async getWeatherHourly(
    @CurrentUser() user: any,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.reportsService.getWeatherHourly(this.getEffectiveUserId(user), {
      startDate,
      endDate,
    });
  }
}
