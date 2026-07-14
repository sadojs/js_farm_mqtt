import { Controller, Get, Post, Put, Patch, Delete, Body, Param, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { DevicesService } from './devices.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ActivityLogService } from '../activity-log/activity-log.service';

@Controller('devices')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'farm_admin', 'farm_user')
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
    return this.devicesService.findAllByUser(this.getEffectiveUserId(user), user.role);
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

  // 구역관리 카드 순서 저장 (드래그 정렬). ':id' 파라미터 라우트보다 먼저 선언.
  // farm_user 는 제외(드래그 핸들 숨김과 동일 정책).
  @Patch('reorder')
  @Roles('admin', 'farm_admin')
  @HttpCode(HttpStatus.OK)
  reorder(
    @CurrentUser() user: any,
    @Body() body: { orders: { id: string; displayOrder: number }[] },
  ) {
    return this.devicesService.reorder(this.getEffectiveUserId(user), body?.orders ?? [], user.role);
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
    return this.devicesService.updateByUser(id, this.getEffectiveUserId(user), body, user.role);
  }

  @Get(':id/status')
  getStatus(
    @Param('id') id: string,
    @CurrentUser() user: any,
  ) {
    return this.devicesService.getDeviceStatus(id, this.getEffectiveUserId(user), user.role);
  }

  @Get(':id/sensor-channels')
  getSensorChannels(
    @Param('id') id: string,
    @CurrentUser() user: any,
  ) {
    return this.devicesService.getSensorChannels(id, this.getEffectiveUserId(user), user.role);
  }

  @Post(':id/control')
  async control(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() body: { commands: { code: string; value: any }[] },
  ) {
    const result = await this.devicesService.controlDevice(id, this.getEffectiveUserId(user), body.commands, user.role);
    const cmdSummary = body.commands.map(c => `${c.code}=${c.value}`).join(', ');
    this.activityLog.log({
      userId: user.id, userName: user.name || user.username,
      action: 'device.control', targetType: 'device', targetId: id,
      targetName: result.deviceName,
      details: { menu: '장치 관리', commands: body.commands, commandSummary: cmdSummary, equipmentType: result.equipmentType },
    });
    return result;
  }

  @Patch(':id/name')
  async renameDevice(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() body: { name: string },
  ) {
    const result = await this.devicesService.updateByUser(id, this.getEffectiveUserId(user), { name: body.name?.trim() }, user.role);
    this.activityLog.log({
      userId: user.id, userName: user.name || user.username,
      action: 'device.rename', targetType: 'device', targetId: id,
      targetName: result.name,
      details: { menu: '장치 관리', newName: result.name },
    });
    return { id: result.id, name: result.name };
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

  /**
   * 채널 활성/비활성 토글 — onboard와 동일 패턴 (매핑은 보존, enabled 상태만 별도 관리).
   * body: { key: 'zone_3', enabled: false }
   */
  @Patch(':id/channel-enabled')
  updateChannelEnabled(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() body: { key: string; enabled: boolean },
  ) {
    return this.devicesService.updateChannelEnabled(
      id,
      this.getEffectiveUserId(user),
      user.role,
      body.key,
      body.enabled,
    );
  }

  /**
   * Zigbee 다채널 컨트롤러의 child device channel_code 변경.
   * body: { channelCode: 'switch_5' } — 다른 child가 쓰는 코드면 409
   */
  @Patch(':id/channel-code')
  updateChannelCode(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() body: { channelCode: string },
  ) {
    return this.devicesService.updateChannelCode(
      id,
      this.getEffectiveUserId(user),
      user.role,
      body.channelCode,
    );
  }

  /**
   * 우적센서 rain-override 비활성화 토글 (오탐 방지).
   * body: { disabled: true|false }
   */
  @Patch(':id/rain-override-disabled')
  updateRainOverrideDisabled(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() body: { disabled: boolean },
  ) {
    return this.devicesService.updateRainOverrideDisabled(
      id,
      this.getEffectiveUserId(user),
      user.role,
      body.disabled,
    );
  }

  @Get(':id/dependencies')
  getDependencies(@Param('id') id: string, @CurrentUser() user: any) {
    return this.devicesService.getDependencies(id, this.getEffectiveUserId(user));
  }

  // ── device-replacement (Hot Swap) ─────────────────────────────

  /**
   * 교체 전 영향 분석 — 보존될 룰/매핑/페어/children 카운트 + 호환 조건.
   */
  @Get(':id/replace-preview')
  getReplacePreview(@Param('id') id: string, @CurrentUser() user: any) {
    return this.devicesService.getReplacePreview(
      id,
      this.getEffectiveUserId(user),
      user.role,
    );
  }

  /**
   * 장치 교체 실행 — devices.id 유지, IEEE/friendly_name swap (controller는 children도 일괄).
   * 트랜잭션 + activity_logs + z2m unpair(best-effort) + WebSocket broadcast.
   */
  @Post(':id/replace')
  @HttpCode(HttpStatus.OK)
  async replaceDevice(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() body: import('./dto/replace-device.dto').ReplaceDeviceDto,
  ) {
    return this.devicesService.replaceDeviceTx({
      oldDeviceId: id,
      newIeee: body.newIeee,
      newFriendlyName: body.newFriendlyName,
      newZigbeeModel: body.newZigbeeModel,
      newChannelCount: body.newChannelCount,
      pairedNewIeee: body.pairedNewIeee,
      pairedNewFriendlyName: body.pairedNewFriendlyName,
      forceStopRunningTimeline: body.forceStopRunningTimeline,
      user: {
        id: this.getEffectiveUserId(user),
        name: user.name || user.username || 'unknown',
        role: user.role,
      },
    });
  }

  @Delete(':id/opener-pair')
  @HttpCode(HttpStatus.OK)
  removeOpenerPair(@Param('id') id: string, @CurrentUser() user: any) {
    return this.devicesService.removeOpenerPair(id, this.getEffectiveUserId(user));
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentUser() user: any) {
    const result = await this.devicesService.remove(id, this.getEffectiveUserId(user), user.role);
    this.activityLog.log({
      userId: user.id, userName: user.name || user.username,
      action: 'device.delete', targetType: 'device', targetId: id,
      details: { menu: '장치 관리' },
    });
    return result;
  }
}
