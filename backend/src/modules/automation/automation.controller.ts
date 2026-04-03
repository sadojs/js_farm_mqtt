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
@Roles('admin', 'farm_admin')
export class AutomationController {
  constructor(
    private automationService: AutomationService,
    private activityLog: ActivityLogService,
  ) {}

  private getEffectiveUserId(user: any): string {
    return user.role === 'farm_user' && user.parentUserId ? user.parentUserId : user.id;
  }

  @Get('rules')
  findAll(@CurrentUser() user: any) {
    return this.automationService.findAll(this.getEffectiveUserId(user));
  }

  @Post('rules')
  async create(@CurrentUser() user: any, @Body() dto: CreateRuleDto) {
    const result = await this.automationService.create(this.getEffectiveUserId(user), dto);
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
