import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { WorkerPayrollService } from './worker-payroll.service';
import { SaveWorkerDto } from './dto/worker.dto';
import { UpsertAdvanceDto } from './dto/advance.dto';
import { SetDayDto } from './dto/day-override.dto';
import { CreateSeasonDto, UpdateSeasonDto } from './dto/season.dto';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { PlatformScope } from '../../common/farm-context/platform-scope.decorator';

@Controller('worker-payroll')
@UseGuards(JwtAuthGuard)
export class WorkerPayrollController {
  constructor(
    private readonly service: WorkerPayrollService,
    private readonly activityLog: ActivityLogService,
  ) {}

  /** 연도 쿼리 (선택) — 4자리가 아니면 무시 */
  private yearOf(year?: string): number | undefined {
    return year && /^\d{4}$/.test(year) ? Number(year) : undefined;
  }

  private logSeason(user: any, action: string, season: any, details: Record<string, any> = {}) {
    this.activityLog.log({
      userId: user.id,
      userName: user.name || user.username,
      action,
      targetType: 'payroll_season',
      targetId: season.id,
      targetName: `${season.seasonYear} 시즌`,
      details: { menu: '일꾼 관리', ...details },
    });
  }

  private ownerId(user: any): string {
    return user.role === 'farm_user' && user.parentUserId ? user.parentUserId : user.id;
  }

  /** 관리자(admin/farm_admin) 전용 동작 */
  private assertManager(user: any): void {
    if (user.role !== 'admin' && user.role !== 'farm_admin') {
      throw new ForbiddenException('농장 관리자만 가능합니다.');
    }
  }

  // ──── 일꾼 목록 / 본인 ────

  @Get('workers')
  listWorkers(@CurrentUser() user: any, @Query('year') year?: string) {
    this.assertManager(user);
    return this.service.listWorkers(this.ownerId(user), this.yearOf(year));
  }

  /** 일꾼 본인 프로필 (farm_user 진입점) */
  @PlatformScope()
  @Get('me')
  getMe(@CurrentUser() user: any) {
    return this.service.getMyWorker(user.id);
  }

  @Get('workers/:id')
  getWorker(@CurrentUser() user: any, @Param('id') id: string) {
    return this.service.getWorker(user, id);
  }

  @Post('workers')
  saveWorker(@CurrentUser() user: any, @Body() dto: SaveWorkerDto) {
    this.assertManager(user);
    return this.service.saveWorker(this.ownerId(user), dto);
  }

  @Delete('workers/:id')
  async removeWorker(@CurrentUser() user: any, @Param('id') id: string) {
    this.assertManager(user);
    await this.service.removeWorker(this.ownerId(user), id);
    return { ok: true };
  }

  // ──── 가불 ────

  @Get('workers/:id/advances')
  listAdvances(@CurrentUser() user: any, @Param('id') id: string) {
    return this.service.listAdvances(user, id);
  }

  @Post('workers/:id/advances')
  addAdvance(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: UpsertAdvanceDto,
  ) {
    this.assertManager(user);
    return this.service.addAdvance(this.ownerId(user), id, dto);
  }

  @Delete('advances/:advanceId')
  async removeAdvance(@CurrentUser() user: any, @Param('advanceId') advanceId: string) {
    this.assertManager(user);
    await this.service.removeAdvance(this.ownerId(user), advanceId);
    return { ok: true };
  }

  // ──── 일자 근무 설정 (관리자) ────

  @Post('workers/:id/day')
  setDay(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: SetDayDto,
  ) {
    this.assertManager(user);
    return this.service.setDay(this.ownerId(user), id, dto);
  }

  // ──── 근무 달력 / 정산 (읽기는 본인/관리자) ────

  @Get('workers/:id/calendar')
  getCalendar(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Query('periodStart') periodStart?: string,
    @Query('seasonId') seasonId?: string,
  ) {
    return this.service.getCalendar(user, id, periodStart, seasonId);
  }

  @Get('workers/:id/settlement')
  getSettlement(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Query('periodStart') periodStart?: string,
    @Query('seasonId') seasonId?: string,
  ) {
    return this.service.getSettlement(user, id, periodStart, seasonId);
  }

  /** 정산 확정 요청 (일꾼 또는 관리자) */
  @Post('workers/:id/settlement/request')
  requestSettlement(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() body: { periodStart?: string; variableAmounts?: Record<string, number>; seasonId?: string },
  ) {
    return this.service.requestSettlement(user, id, body?.periodStart, body?.variableAmounts, body?.seasonId);
  }

  /** 정산 승인 (관리자) — 변동 공제 금액 함께 입력 */
  @Post('workers/:id/settlement/approve')
  approveSettlement(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() body: { periodStart?: string; variableAmounts?: Record<string, number>; seasonId?: string },
  ) {
    this.assertManager(user);
    return this.service.approveSettlement(
      this.ownerId(user),
      id,
      body?.periodStart,
      body?.variableAmounts,
      body?.seasonId,
    );
  }

  // ──── 시즌 (재고용 · 조건 수정 · 마감) ────

  @Get('workers/:id/seasons')
  listSeasons(@CurrentUser() user: any, @Param('id') id: string) {
    return this.service.listSeasons(user, id);
  }

  /** 재고용 — 새 시즌 시작 */
  @Post('workers/:id/seasons')
  async createSeason(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: CreateSeasonDto,
  ) {
    this.assertManager(user);
    const season = await this.service.createSeason(this.ownerId(user), id, dto);
    this.logSeason(user, 'payroll.season.create', season, { workerId: id, startDate: season.startDate });
    return season;
  }

  @Put('seasons/:seasonId')
  updateSeason(
    @CurrentUser() user: any,
    @Param('seasonId') seasonId: string,
    @Body() dto: UpdateSeasonDto,
  ) {
    this.assertManager(user);
    return this.service.updateSeason(this.ownerId(user), seasonId, dto);
  }

  @Post('seasons/:seasonId/close')
  async closeSeason(@CurrentUser() user: any, @Param('seasonId') seasonId: string) {
    this.assertManager(user);
    const season = await this.service.closeSeason(this.ownerId(user), seasonId);
    this.logSeason(user, 'payroll.season.close', season);
    return season;
  }

  @Post('seasons/:seasonId/reopen')
  async reopenSeason(@CurrentUser() user: any, @Param('seasonId') seasonId: string) {
    this.assertManager(user);
    const season = await this.service.reopenSeason(this.ownerId(user), seasonId);
    this.logSeason(user, 'payroll.season.reopen', season);
    return season;
  }

  // ──── 정산 이력 (관리자) ────

  @Get('settlements')
  listSettlements(@CurrentUser() user: any) {
    this.assertManager(user);
    return this.service.listSettlements(this.ownerId(user));
  }
}
