import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { FallbackConfigService } from './fallback-config.service';
import { UpdateFallbackConfigDto } from './dto/update-config.dto';
import { UpsertOpenerScheduleDto } from './dto/upsert-opener-schedule.dto';
import { MqttService } from '../mqtt/mqtt.service';
import { EmergencyStopService } from './emergency-stop.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { HeartbeatService } from './heartbeat.service';
import { PlatformScope } from '../../common/farm-context/platform-scope.decorator';
import { GatewayOwnershipGuard } from '../../common/guards/gateway-ownership.guard';

@PlatformScope()
@Controller('fallback-config')
@UseGuards(JwtAuthGuard, RolesGuard, GatewayOwnershipGuard)
export class FallbackConfigController {
  constructor(
    private readonly service: FallbackConfigService,
    private readonly mqtt: MqttService,
    private readonly emergency: EmergencyStopService,
    private readonly heartbeat: HeartbeatService,
  ) {}

  // ───────── 페일오버 드릴: 서버 하트비트 토글 (admin 전용) ─────────
  // 주의: ':gatewayId' 파라미터 라우트보다 먼저 선언해야 'heartbeat' 가 gatewayId 로 매칭되지 않음.

  @Get('heartbeat/status')
  @Roles('admin')
  getHeartbeatStatus() {
    return this.heartbeat.getStatus();
  }

  @Post('heartbeat/toggle')
  @Roles('admin')
  toggleHeartbeat(@Body() body: { disabled: boolean; gatewayId?: string }) {
    return this.heartbeat.setDisabled(!!body?.disabled, body?.gatewayId);
  }

  @Get(':gatewayId')
  @Roles('admin', 'farm_admin')
  async getFull(@Param('gatewayId') gatewayId: string) {
    const full = await this.service.getFullConfig(gatewayId);
    const emergency = await this.emergency.status(gatewayId).catch(() => null);
    return { ...full, emergency };
  }

  @Patch(':gatewayId')
  @Roles('admin', 'farm_admin')
  async updateConfig(
    @Param('gatewayId') gatewayId: string,
    @Body() dto: UpdateFallbackConfigDto,
  ) {
    return this.service.updateConfig(gatewayId, dto);
  }

  @Put(':gatewayId/opener/:month')
  @Roles('admin', 'farm_admin')
  async upsertSchedule(
    @Param('gatewayId') gatewayId: string,
    @Param('month', ParseIntPipe) month: number,
    @Body() dto: UpsertOpenerScheduleDto,
  ) {
    return this.service.upsertOpenerSchedule(gatewayId, month, dto);
  }

  @Delete(':gatewayId/opener/:month')
  @Roles('admin', 'farm_admin')
  async disableSchedule(
    @Param('gatewayId') gatewayId: string,
    @Param('month', ParseIntPipe) month: number,
  ) {
    return this.service.disableOpenerSchedule(gatewayId, month);
  }

  @Get(':gatewayId/mode')
  @Roles('admin', 'farm_admin', 'farm_user')
  async getMode(@Param('gatewayId') gatewayId: string) {
    return this.service.getMode(gatewayId);
  }

  @Get(':gatewayId/events')
  @Roles('admin', 'farm_admin')
  async getEvents(
    @Param('gatewayId') gatewayId: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.service.getEvents(
      gatewayId,
      limit ? parseInt(limit, 10) : 100,
      offset ? parseInt(offset, 10) : 0,
    );
  }

  /** 룰을 강제로 재동기화 (관리자 트리거) */
  @Post(':gatewayId/resync')
  @Roles('admin', 'farm_admin')
  async resync(@Param('gatewayId') gatewayId: string) {
    await this.service.publishSync(gatewayId);
    return { ok: true };
  }

  /**
   * 비상 정지 — 정지 유지(래치). 해제 전까지 서버·Pi 모두 이 게이트웨이 릴레이 ON 차단.
   * 실행자는 로그인 사용자로 기록(본문 by 는 무시 — 이전엔 'admin' 고정).
   */
  @Post(':gatewayId/emergency-stop')
  @Roles('admin', 'farm_admin')
  async emergencyStop(
    @Param('gatewayId') gatewayId: string,
    @Body() body: { reason?: string },
    @CurrentUser() user: any,
  ) {
    const res = await this.emergency.stop(gatewayId, { id: user.id, username: user.username }, body?.reason || 'manual');
    return { ok: true, ...res };
  }

  /** 비상 정지 해제 — 장비는 꺼진 상태 그대로, 자동제어·수동 조작이 다시 가능해진다 */
  @Post(':gatewayId/emergency-release')
  @Roles('admin', 'farm_admin')
  async emergencyRelease(@Param('gatewayId') gatewayId: string, @CurrentUser() user: any) {
    const res = await this.emergency.release(gatewayId, { id: user.id, username: user.username });
    return { ok: true, ...res };
  }

  @Get(':gatewayId/emergency')
  @Roles('admin', 'farm_admin', 'farm_user')
  async emergencyStatus(@Param('gatewayId') gatewayId: string) {
    return this.emergency.status(gatewayId);
  }
}
