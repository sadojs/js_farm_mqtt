import { Controller, Get, Post, Put, Patch, Delete, Body, Param, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { DevicesService } from './devices.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ActivityLogService } from '../activity-log/activity-log.service';

@Controller('devices')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'farm_admin')
export class DevicesController {
  constructor(
    private devicesService: DevicesService,
    private activityLog: ActivityLogService,
  ) {}

  private getEffectiveUserId(user: any): string {
    return user.role === 'farm_user' && user.parentUserId ? user.parentUserId : user.id;
  }

  @Get()
  findAll(@CurrentUser() user: any) {
    return this.devicesService.findAllByUser(this.getEffectiveUserId(user));
  }

  @Post('register')
  async register(
    @CurrentUser() user: any,
    @Body() body: { devices: any[]; houseId?: string },
  ) {
    const result = await this.devicesService.registerBatch(this.getEffectiveUserId(user), body.devices, body.houseId);
    for (const d of body.devices) {
      this.activityLog.log({
        userId: user.id, userName: user.name || user.username,
        action: 'device.register', targetType: 'device', targetName: d.name,
        details: { menu: '장치 관리', category: d.category, deviceType: d.deviceType },
      });
    }
    return result;
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.devicesService.findOneByUser(id, this.getEffectiveUserId(user));
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() body: Partial<{ name: string; category: string; equipmentType: string; icon: string }>,
  ) {
    return this.devicesService.updateByUser(id, this.getEffectiveUserId(user), body);
  }

  @Get(':id/status')
  getStatus(
    @Param('id') id: string,
    @CurrentUser() user: any,
  ) {
    return this.devicesService.getDeviceStatus(id, this.getEffectiveUserId(user));
  }

  @Post(':id/control')
  async control(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() body: { commands: { code: string; value: any }[] },
  ) {
    const result = await this.devicesService.controlDevice(id, this.getEffectiveUserId(user), body.commands);
    const cmdSummary = body.commands.map(c => `${c.code}=${c.value}`).join(', ');
    this.activityLog.log({
      userId: user.id, userName: user.name || user.username,
      action: 'device.control', targetType: 'device', targetId: id,
      targetName: result.deviceName,
      details: { menu: '장치 관리', commands: body.commands, commandSummary: cmdSummary, equipmentType: result.equipmentType },
    });
    return result;
  }

  @Patch(':id/channel-mapping')
  updateChannelMapping(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() body: { mapping: Record<string, string> },
  ) {
    return this.devicesService.updateChannelMapping(
      id,
      this.getEffectiveUserId(user),
      user.role,
      body.mapping,
    );
  }

  @Get(':id/dependencies')
  getDependencies(@Param('id') id: string, @CurrentUser() user: any) {
    return this.devicesService.getDependencies(id, this.getEffectiveUserId(user));
  }

  @Delete(':id/opener-pair')
  @HttpCode(HttpStatus.OK)
  removeOpenerPair(@Param('id') id: string, @CurrentUser() user: any) {
    return this.devicesService.removeOpenerPair(id, this.getEffectiveUserId(user));
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentUser() user: any) {
    const result = await this.devicesService.remove(id, this.getEffectiveUserId(user));
    this.activityLog.log({
      userId: user.id, userName: user.name || user.username,
      action: 'device.delete', targetType: 'device', targetId: id,
      details: { menu: '장치 관리' },
    });
    return result;
  }
}
