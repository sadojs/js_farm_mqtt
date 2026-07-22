import { Controller, Get, Put, Patch, Param, Body, UseGuards } from '@nestjs/common';
import { EnvConfigService } from './env-config.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('env-config')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'farm_admin', 'farm_user')
export class EnvConfigController {
  constructor(private envConfigService: EnvConfigService) {}

  private getEffectiveUserId(user: any): string | null {
    if (user.role === 'admin') return null;
    return user.role === 'farm_user' && user.parentUserId ? user.parentUserId : user.id;
  }

  @Get('roles')
  getRoles() {
    return this.envConfigService.getRoles();
  }

  @Get('groups/:groupId/sources')
  getSources(
    @CurrentUser() user: any,
    @Param('groupId') groupId: string,
  ) {
    return this.envConfigService.getSources(this.getEffectiveUserId(user), groupId);
  }

  @Get('groups/:groupId/mappings')
  getMappings(
    @CurrentUser() user: any,
    @Param('groupId') groupId: string,
  ) {
    return this.envConfigService.getMappings(this.getEffectiveUserId(user), groupId);
  }

  @Put('groups/:groupId/mappings')
  @Roles('admin', 'farm_admin') // 편집은 관리자·농장관리자만 (farm_user 는 조회만)
  saveMappings(
    @CurrentUser() user: any,
    @Param('groupId') groupId: string,
    @Body() body: { mappings: Array<{
      roleKey: string;
      sourceType: 'sensor' | 'weather';
      deviceId?: string;
      sensorType?: string;
      weatherField?: string;
    }> },
  ) {
    return this.envConfigService.saveMappings(this.getEffectiveUserId(user), groupId, body.mappings);
  }

  @Get('groups/:groupId/resolved')
  getResolved(
    @CurrentUser() user: any,
    @Param('groupId') groupId: string,
  ) {
    return this.envConfigService.getResolved(this.getEffectiveUserId(user), groupId);
  }

  // ── 구역 장치설정 (개폐기/팬 동작·대기 + 우적센서 활성화) — 통합 환경설정 ──
  @Get('groups/:groupId/device-settings')
  getZoneDeviceSettings(
    @CurrentUser() user: any,
    @Param('groupId') groupId: string,
  ) {
    return this.envConfigService.getZoneDeviceSettings(
      this.getEffectiveUserId(user),
      groupId,
    );
  }

  @Patch('groups/:groupId/device-settings')
  @Roles('admin', 'farm_admin') // 편집은 관리자·농장관리자만 (소유권은 서비스에서 검증)
  saveZoneDeviceSettings(
    @CurrentUser() user: any,
    @Param('groupId') groupId: string,
    @Body()
    body: {
      openerOperationSeconds?: number;
      openerStandbySeconds?: number;
      fanOperationMinutes?: number;
      fanStandbyMinutes?: number;
      rainEnabled?: boolean;
      highTempOverrideEnabled?: boolean;
      highTempOpenThreshold?: number | null;
    },
  ) {
    return this.envConfigService.saveZoneDeviceSettings(
      this.getEffectiveUserId(user),
      groupId,
      body,
    );
  }
}
