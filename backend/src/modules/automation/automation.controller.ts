import { Controller, Get, Post, Put, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { AutomationService } from './automation.service';
import { CreateRuleDto, UpdateRuleDto } from './dto/create-rule.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('automation')
@UseGuards(JwtAuthGuard)
export class AutomationController {
  constructor(private automationService: AutomationService) {}

  private getEffectiveUserId(user: any): string {
    return user.role === 'farm_user' && user.parentUserId ? user.parentUserId : user.id;
  }

  @Get('rules')
  findAll(@CurrentUser() user: any) {
    return this.automationService.findAll(this.getEffectiveUserId(user));
  }

  @Post('rules')
  create(@CurrentUser() user: any, @Body() dto: CreateRuleDto) {
    return this.automationService.create(this.getEffectiveUserId(user), dto);
  }

  @Put('rules/:id')
  update(@Param('id') id: string, @CurrentUser() user: any, @Body() dto: UpdateRuleDto) {
    return this.automationService.update(id, this.getEffectiveUserId(user), dto);
  }

  @Patch('rules/:id/toggle')
  toggle(@Param('id') id: string, @CurrentUser() user: any) {
    return this.automationService.toggle(id, this.getEffectiveUserId(user));
  }

  @Post('rules/:id/run')
  runNow(@Param('id') id: string, @CurrentUser() user: any) {
    return this.automationService.runRuleNow(id, this.getEffectiveUserId(user));
  }

  @Delete('rules/:id')
  remove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.automationService.remove(id, this.getEffectiveUserId(user));
  }

  @Get('logs')
  getLogs(
    @CurrentUser() user: any,
    @Query('ruleId') ruleId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.automationService.getLogs(this.getEffectiveUserId(user), {
      ruleId,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }
}
