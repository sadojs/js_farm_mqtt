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
import { HeartbeatService } from './heartbeat.service';

@Controller('fallback-config')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FallbackConfigController {
  constructor(
    private readonly service: FallbackConfigService,
    private readonly mqtt: MqttService,
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
    return this.service.getFullConfig(gatewayId);
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

  /** 비상 정지 (폴백 모드에서도 통과) */
  @Post(':gatewayId/emergency-stop')
  @Roles('admin', 'farm_admin')
  async emergencyStop(
    @Param('gatewayId') gatewayId: string,
    @Body() body: { reason: string; by: string },
  ) {
    await this.mqtt.publishEmergencyStop(
      gatewayId,
      body.reason ?? 'manual',
      body.by ?? 'unknown',
    );
    return { ok: true };
  }
}
