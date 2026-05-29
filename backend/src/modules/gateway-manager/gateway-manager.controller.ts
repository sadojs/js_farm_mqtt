import { Controller, Get, Post, Put, Patch, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { GatewayManagerService } from './gateway-manager.service';
import { MqttService } from '../mqtt/mqtt.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('gateways')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'farm_admin', 'farm_user')
export class GatewayManagerController {
  constructor(
    private gatewayService: GatewayManagerService,
    private mqttService: MqttService,
  ) {}

  private getEffectiveUserId(user: any): string {
    return user.role === 'farm_user' && user.parentUserId ? user.parentUserId : user.id;
  }

  @Get()
  findAll(@CurrentUser() user: any) {
    // admin은 전체 게이트웨이 조회
    if (user.role === 'admin') {
      return this.gatewayService.findAll();
    }
    return this.gatewayService.findAllByUser(this.getEffectiveUserId(user));
  }

  @Post()
  @Roles('admin', 'farm_admin')
  create(
    @CurrentUser() user: any,
    @Body() body: { gatewayId: string; name: string; location?: string; userId?: string },
  ) {
    // admin이 소유자를 지정한 경우 해당 userId 사용, 아니면 본인
    const ownerId = (user.role === 'admin' && body.userId) ? body.userId : this.getEffectiveUserId(user);
    return this.gatewayService.create(ownerId, body);
  }

  @Put(':id')
  @Roles('admin', 'farm_admin')
  update(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() body: { name?: string; location?: string; userId?: string; houseId?: string | null },
  ) {
    // admin은 모든 게이트웨이 수정 가능 (소유자 변경 포함)
    if (user.role === 'admin') {
      return this.gatewayService.updateByAdmin(id, body);
    }
    return this.gatewayService.update(id, this.getEffectiveUserId(user), body);
  }

  @Delete(':id')
  @Roles('admin', 'farm_admin')
  remove(@CurrentUser() user: any, @Param('id') id: string) {
    if (user.role === 'admin') {
      return this.gatewayService.removeByAdmin(id);
    }
    return this.gatewayService.remove(id, this.getEffectiveUserId(user));
  }

  /** 게이트웨이 구역 할당 / 해제 */
  @Patch(':id/zone')
  @Roles('admin', 'farm_admin')
  assignZone(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() body: { groupId: string | null },
  ) {
    return this.gatewayService.assignZone(id, this.getEffectiveUserId(user), user.role, body.groupId ?? null);
  }

  /** 특정 게이트웨이에 페어링된 Zigbee 장비 목록 */
  @Get(':id/zigbee-devices')
  async getZigbeeDevices(
    @CurrentUser() user: any,
    @Param('id') id: string,
  ) {
    const gw = await this.gatewayService.findOne(id, this.getEffectiveUserId(user));
    return this.mqttService.getZigbeeDevices(gw.gatewayId);
  }

  /** 페어링 모드 ON/OFF */
  @Post(':id/permit-join')
  @Roles('admin', 'farm_admin')
  async permitJoin(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() body: { enable: boolean },
  ) {
    // admin은 모든 게이트웨이 접근 가능, farm_admin은 자신 소유만
    const gw = await this.gatewayService.findOneByRole(id, this.getEffectiveUserId(user), user.role);
    await this.mqttService.permitJoin(gw.gatewayId, body.enable);
    return { success: true, gatewayId: gw.gatewayId, permitJoin: body.enable };
  }

  /** Pi systemd 서비스 재시작 (allowlist 검증) — gpio-agent 무응답 등 복구용 */
  @Post(':id/restart-service')
  @Roles('admin', 'farm_admin')
  async restartService(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() body: { service: string },
  ) {
    const gw = await this.gatewayService.findOneByRole(id, this.getEffectiveUserId(user), user.role);
    return this.gatewayService.restartPiService(gw, body.service);
  }
}
