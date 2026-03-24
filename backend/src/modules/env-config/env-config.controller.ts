import { Controller, Get, Put, Param, Body, UseGuards } from '@nestjs/common';
import { EnvConfigService } from './env-config.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('env-config')
@UseGuards(JwtAuthGuard)
export class EnvConfigController {
  constructor(private envConfigService: EnvConfigService) {}

  private getEffectiveUserId(user: any): string {
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
}
