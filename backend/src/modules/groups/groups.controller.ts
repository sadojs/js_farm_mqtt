import { Controller, Get, Post, Put, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { GroupsService } from './groups.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ActivityLogService } from '../activity-log/activity-log.service';

@Controller('groups')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'farm_admin', 'farm_user')
export class GroupsController {
  constructor(
    private groupsService: GroupsService,
    private activityLog: ActivityLogService,
  ) {}

  private getEffectiveUserId(user: any): string {
    return user.role === 'farm_user' && user.parentUserId ? user.parentUserId : user.id;
  }

  @Get()
  findAllGroups(@CurrentUser() user: any, @Query('iotOnly') iotOnly?: string) {
    return this.groupsService.findAllGroups(
      this.getEffectiveUserId(user),
      user.role,
      { iotOnly: iotOnly === 'true' },
    );
  }

  // 구역 표시 순서 저장 (드래그 정렬). ':id' 라우트보다 먼저. farm_user 제외.
  @Patch('reorder')
  @Roles('admin', 'farm_admin')
  reorder(@CurrentUser() user: any, @Body() body: { orders: { id: string; displayOrder: number }[] }) {
    return this.groupsService.reorderGroups(this.getEffectiveUserId(user), body?.orders ?? [], user.role);
  }

  @Get(':id/dependencies')
  getDependencies(@Param('id') id: string, @CurrentUser() user: any) {
    return this.groupsService.getDependencies(id, this.getEffectiveUserId(user), user.role);
  }

  @Post()
  async createGroup(@CurrentUser() user: any, @Body() body: any) {
    const effectiveUserId = (user.role === 'admin' && body.targetUserId)
      ? body.targetUserId
      : this.getEffectiveUserId(user);
    const result = await this.groupsService.createGroup(effectiveUserId, body);
    if (result) {
      this.activityLog.log({
        userId: user.id, userName: user.name || user.username,
        groupId: result.id, groupName: body.name,
        action: 'group.create', targetType: 'group',
        targetId: result.id, targetName: body.name,
        details: { menu: '그룹 관리' },
      });
    }
    return result;
  }

  @Put(':id')
  async updateGroup(@Param('id') id: string, @CurrentUser() user: any, @Body() body: any) {
    const result = await this.groupsService.updateGroup(id, this.getEffectiveUserId(user), body, user.role);
    if (result) {
      this.activityLog.log({
        userId: user.id, userName: user.name || user.username,
        groupId: id, groupName: body.name || result.name,
        action: 'group.update', targetType: 'group',
        targetId: id, targetName: body.name || result.name,
        details: { menu: '그룹 관리' },
      });
    }
    return result;
  }

  @Delete(':id')
  removeGroup(@Param('id') id: string, @CurrentUser() user: any) {
    return this.groupsService.removeGroup(id, this.getEffectiveUserId(user), user.role);
  }

  @Get('houses')
  findAllHouses(@CurrentUser() user: any, @Query('iotOnly') iotOnly?: string) {
    return this.groupsService.findAllHouses(this.getEffectiveUserId(user), {
      iotOnly: iotOnly === 'true',
    });
  }

  @Get('houses/iot-related-counts')
  getIotRelatedCounts(@CurrentUser() user: any, @Query('ids') ids?: string) {
    const list = (ids ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    return this.groupsService.getIotRelatedCounts(
      this.getEffectiveUserId(user),
      user.role,
      list,
    );
  }

  @Patch('houses/iot-enabled')
  @Roles('admin', 'farm_admin')
  async bulkUpdateIotEnabled(
    @CurrentUser() user: any,
    @Body() body: { updates: Array<{ id: string; enabled: boolean }> },
  ) {
    const result = await this.groupsService.bulkUpdateIotEnabled(
      this.getEffectiveUserId(user),
      user.role,
      body?.updates ?? [],
    );
    this.activityLog.log({
      userId: user.id,
      userName: user.name || user.username,
      action: 'zone.iot_visibility.changed',
      targetType: 'house',
      targetId: '',
      targetName: '',
      details: { menu: '구역 표시 설정', updates: body?.updates ?? [] },
    });
    return result;
  }

  @Post('houses')
  createHouse(@CurrentUser() user: any, @Body() body: any) {
    const effectiveUserId = (user.role === 'admin' && body.targetUserId)
      ? body.targetUserId
      : this.getEffectiveUserId(user);
    return this.groupsService.createHouse(effectiveUserId, body);
  }

  @Put('houses/:id')
  updateHouse(@Param('id') id: string, @CurrentUser() user: any, @Body() body: any) {
    return this.groupsService.updateHouse(id, this.getEffectiveUserId(user), body, user.role);
  }

  @Delete('houses/:id')
  removeHouse(@Param('id') id: string, @CurrentUser() user: any) {
    return this.groupsService.removeHouse(id, this.getEffectiveUserId(user), user.role);
  }

  @Post(':id/control')
  controlGroup(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() body: { commands: { code: string; value: any }[] },
  ) {
    return this.groupsService.controlGroup(id, this.getEffectiveUserId(user), body.commands);
  }

  @Post(':id/gateway')
  assignGateway(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() body: { gatewayId: string },
  ) {
    return this.groupsService.assignGatewayToGroup(id, this.getEffectiveUserId(user), body.gatewayId);
  }

  @Post(':id/devices')
  assignDevices(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() body: { deviceIds: string[] },
  ) {
    return this.groupsService.assignDevices(id, this.getEffectiveUserId(user), body.deviceIds);
  }

  @Delete(':id/devices/:deviceId')
  removeDeviceFromGroup(
    @Param('id') id: string,
    @Param('deviceId') deviceId: string,
    @CurrentUser() user: any,
  ) {
    return this.groupsService.removeDeviceFromGroup(id, this.getEffectiveUserId(user), deviceId);
  }
}
