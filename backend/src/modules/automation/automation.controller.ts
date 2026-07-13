import { Controller, Get, Post, Put, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { AutomationService } from './automation.service';
import { CreateRuleDto, UpdateRuleDto } from './dto/create-rule.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ActivityLogService } from '../activity-log/activity-log.service';

@Controller('automation')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'farm_admin', 'farm_user')
export class AutomationController {
  constructor(
    private automationService: AutomationService,
    private activityLog: ActivityLogService,
  ) {}

  private getEffectiveUserId(user: any): string | null {
    if (user.role === 'admin') return null;
    return user.role === 'farm_user' && user.parentUserId ? user.parentUserId : user.id;
  }

  @Get('rules')
  findAll(@CurrentUser() user: any, @Query('farmUserId') farmUserId?: string) {
    if (user.role === 'admin') {
      return this.automationService.findAll(farmUserId ?? null);
    }
    return this.automationService.findAll(this.getEffectiveUserId(user));
  }

  @Post('rules')
  async create(@CurrentUser() user: any, @Body() dto: CreateRuleDto) {
    // admin이 룰을 만들 때 user_id 결정 우선순위:
    //   1) targetUserId 명시 → 그 사용자
    //   2) groupId 기반으로 group owner 추론
    //   3) admin 자기 자신 (fallback)
    let userId = (user.role === 'admin' && (dto as any).targetUserId)
      ? (dto as any).targetUserId
      : this.getEffectiveUserId(user);

    if (user.role === 'admin' && !userId && dto.groupId) {
      userId = await this.automationService.resolveGroupOwner(dto.groupId);
    }
    if (!userId) {
      // 최종 fallback: admin 자기 자신 (NOT NULL 제약 위반 방지)
      userId = user.id;
    }
    const result = await this.automationService.create(userId, dto);
    this.activityLog.log({
      userId: user.id, userName: user.name || user.username,
      groupId: dto.groupId, action: 'rule.create', targetType: 'rule',
      targetId: result.id, targetName: dto.name,
      details: { menu: '자동화', ruleType: result.ruleType, equipmentType: result.actions?.equipmentType },
    });
    return result;
  }

  @Put('rules/:id')
  async update(@Param('id') id: string, @CurrentUser() user: any, @Body() dto: UpdateRuleDto) {
    const result = await this.automationService.update(id, this.getEffectiveUserId(user), dto);
    this.activityLog.log({
      userId: user.id, userName: user.name || user.username,
      groupId: result.groupId, action: 'rule.update', targetType: 'rule',
      targetId: id, targetName: dto.name || result.name,
      details: { menu: '자동화', ruleType: result.ruleType },
    });
    return result;
  }

  @Patch('rules/:id/toggle')
  async toggle(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Query('autoEnableRemote') autoEnableRemote?: string,
  ) {
    const result = await this.automationService.toggle(id, this.getEffectiveUserId(user), {
      autoEnableRemote: autoEnableRemote === 'true',
    });
    this.activityLog.log({
      userId: user.id, userName: user.name || user.username,
      groupId: result.groupId, action: result.enabled ? 'rule.enable' : 'rule.disable', targetType: 'rule',
      targetId: id, targetName: result.name,
      details: { menu: '자동화', ruleType: result.ruleType, equipmentType: result.actions?.equipmentType },
    });
    return result;
  }

  @Post('rules/:id/run')
  runNow(@Param('id') id: string, @CurrentUser() user: any) {
    return this.automationService.runRuleNow(id, this.getEffectiveUserId(user));
  }

  @Delete('rules/:id')
  async remove(@Param('id') id: string, @CurrentUser() user: any) {
    const result = await this.automationService.remove(id, this.getEffectiveUserId(user));
    this.activityLog.log({
      userId: user.id, userName: user.name || user.username,
      action: 'rule.delete', targetType: 'rule', targetId: id,
      details: { menu: '자동화' },
    });
    return result;
  }

  @Get('irrigation/status')
  getIrrigationStatus(@CurrentUser() user: any) {
    return this.automationService.getIrrigationStatus(this.getEffectiveUserId(user));
  }

  @Post('rules/bulk-disable')
  bulkDisableByDevice(@CurrentUser() user: any, @Body() dto: { deviceId: string }) {
    return this.automationService.bulkDisableByDevice(this.getEffectiveUserId(user), dto.deviceId);
  }

  /** 개폐기 수동 제어 진입 — 해당 개폐기(페어 포함)를 제어 중인 활성 룰 조회 */
  @Get('device/:deviceId/active-rules')
  getActiveRulesForDevice(@CurrentUser() user: any, @Param('deviceId') deviceId: string) {
    return this.automationService.getActiveRulesForDevice(this.getEffectiveUserId(user), deviceId);
  }

  /** 개폐기 수동 제어 진입 — 활성 룰 전부 정지 (재개는 자동제어 페이지에서 수동) */
  @Post('device/:deviceId/stop-rules')
  stopActiveRulesForDevice(@CurrentUser() user: any, @Param('deviceId') deviceId: string) {
    return this.automationService.stopActiveRulesForDevice(this.getEffectiveUserId(user), deviceId);
  }

  // ── 일괄제어: 여러 장치 대상 룰 일괄 조회/정지 + 원복 ──
  /** 일괄제어 진입 — 대상 장치들을 제어 중인 활성 룰 조회 (팝업 리스트용) */
  @Post('devices/active-rules')
  getActiveRulesForDevices(@CurrentUser() user: any, @Body() dto: { deviceIds: string[] }) {
    return this.automationService.getActiveRulesForDevices(this.getEffectiveUserId(user), dto?.deviceIds ?? []);
  }

  /** 일괄제어 진입 — 대상 장치들의 활성 룰 전부 정지 (disabled_reason='bulk') */
  @Post('devices/stop-rules')
  stopActiveRulesForDevices(@CurrentUser() user: any, @Body() dto: { deviceIds: string[] }) {
    return this.automationService.stopActiveRulesForDevices(this.getEffectiveUserId(user), dto?.deviceIds ?? []);
  }

  /** 일괄제어로 정지된 룰 목록 (원복 배너용 — 새로고침에도 유지) */
  @Get('bulk-stopped-rules')
  getBulkStoppedRules(@CurrentUser() user: any) {
    return this.automationService.getBulkStoppedRules(this.getEffectiveUserId(user));
  }

  /** 일괄제어로 정지된 룰 원복(재활성화). ruleIds 미지정 시 전체 */
  @Post('rules/restore')
  restoreBulkStoppedRules(@CurrentUser() user: any, @Body() dto: { ruleIds?: string[] }) {
    return this.automationService.restoreBulkStoppedRules(this.getEffectiveUserId(user), dto?.ruleIds);
  }

  @Get('logs/stats')
  getLogStats(@CurrentUser() user: any) {
    return this.automationService.getLogStats(this.getEffectiveUserId(user));
  }

  @Get('logs')
  getLogs(
    @CurrentUser() user: any,
    @Query('ruleId') ruleId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('type') type?: string,
  ) {
    return this.automationService.getLogs(this.getEffectiveUserId(user), {
      ruleId,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      type,
    });
  }
}
