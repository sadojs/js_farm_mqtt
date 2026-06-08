import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SprayScheduleService } from './spray-schedule.service';
import { SaveZoneConfigDto } from './dto/save-zone-config.dto';
import { MoveEventDto, CreateManualEventDto } from './dto/event.dto';

@Controller('spray-schedule')
@UseGuards(JwtAuthGuard)
export class SprayScheduleController {
  constructor(private readonly service: SprayScheduleService) {}

  private effectiveUserId(user: any): string {
    return user.role === 'farm_user' && user.parentUserId ? user.parentUserId : user.id;
  }

  /** 농장 관리자(또는 플랫폼 관리자)만 접근 — 농장 사용자 차단 */
  private assertManager(user: any): void {
    if (user.role !== 'admin' && user.role !== 'farm_admin') {
      throw new ForbiddenException('농장 관리자만 접근 가능합니다.');
    }
  }

  // ──── 구역/프로그램/약품 ────

  @Get('zones')
  getZones(@CurrentUser() user: any) {
    this.assertManager(user);
    return this.service.listZones(this.effectiveUserId(user));
  }

  @Post('zones')
  saveZone(@CurrentUser() user: any, @Body() dto: SaveZoneConfigDto) {
    this.assertManager(user);
    return this.service.saveZoneConfig(this.effectiveUserId(user), dto);
  }

  @Delete('zones/:id')
  async deleteZone(@CurrentUser() user: any, @Param('id') id: string) {
    this.assertManager(user);
    await this.service.deleteZone(this.effectiveUserId(user), id);
    return { ok: true };
  }

  @Get('zones/markers')
  getZoneMarkers(@CurrentUser() user: any) {
    this.assertManager(user);
    return this.service.getZoneMarkers(this.effectiveUserId(user));
  }

  // ──── 달력 이벤트 ────

  @Get('events')
  getEvents(
    @CurrentUser() user: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    this.assertManager(user);
    return this.service.getEvents(this.effectiveUserId(user), from, to);
  }

  @Post('events')
  createManualEvent(@CurrentUser() user: any, @Body() dto: CreateManualEventDto) {
    this.assertManager(user);
    return this.service.createManualEvent(this.effectiveUserId(user), dto);
  }

  @Patch('events/:id/move')
  moveEvent(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: MoveEventDto,
  ) {
    this.assertManager(user);
    return this.service.moveEvent(this.effectiveUserId(user), id, dto);
  }

  @Delete('events/:id')
  async deleteEvent(@CurrentUser() user: any, @Param('id') id: string) {
    this.assertManager(user);
    await this.service.deleteEvent(this.effectiveUserId(user), id);
    return { ok: true };
  }
}
