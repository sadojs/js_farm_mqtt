import {
  Controller,
  Get,
  Post,
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
import { SetDayOverrideDto } from './dto/day-override.dto';

@Controller('worker-payroll')
@UseGuards(JwtAuthGuard)
export class WorkerPayrollController {
  constructor(private readonly service: WorkerPayrollService) {}

  private effectiveUserId(user: any): string {
    return user.role === 'farm_user' && user.parentUserId ? user.parentUserId : user.id;
  }

  private assertManager(user: any): void {
    if (user.role !== 'admin' && user.role !== 'farm_admin') {
      throw new ForbiddenException('농장 관리자만 접근 가능합니다.');
    }
  }

  // ──── 일꾼 ────

  @Get('workers')
  listWorkers(@CurrentUser() user: any) {
    this.assertManager(user);
    return this.service.listWorkers(this.effectiveUserId(user));
  }

  @Get('workers/:id')
  getWorker(@CurrentUser() user: any, @Param('id') id: string) {
    this.assertManager(user);
    return this.service.getWorker(this.effectiveUserId(user), id);
  }

  @Post('workers')
  saveWorker(@CurrentUser() user: any, @Body() dto: SaveWorkerDto) {
    this.assertManager(user);
    return this.service.saveWorker(this.effectiveUserId(user), dto);
  }

  @Delete('workers/:id')
  async removeWorker(@CurrentUser() user: any, @Param('id') id: string) {
    this.assertManager(user);
    await this.service.removeWorker(this.effectiveUserId(user), id);
    return { ok: true };
  }

  // ──── 가불 ────

  @Get('workers/:id/advances')
  listAdvances(@CurrentUser() user: any, @Param('id') id: string) {
    this.assertManager(user);
    return this.service.listAdvances(this.effectiveUserId(user), id);
  }

  @Post('workers/:id/advances')
  addAdvance(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: UpsertAdvanceDto,
  ) {
    this.assertManager(user);
    return this.service.addAdvance(this.effectiveUserId(user), id, dto);
  }

  @Delete('advances/:advanceId')
  async removeAdvance(@CurrentUser() user: any, @Param('advanceId') advanceId: string) {
    this.assertManager(user);
    await this.service.removeAdvance(this.effectiveUserId(user), advanceId);
    return { ok: true };
  }

  // ──── 일자 조정 ────

  @Post('workers/:id/day-override')
  setDayOverride(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: SetDayOverrideDto,
  ) {
    this.assertManager(user);
    return this.service.setDayOverride(this.effectiveUserId(user), id, dto);
  }

  // ──── 근무 달력 / 정산 ────

  @Get('workers/:id/calendar')
  getCalendar(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Query('periodStart') periodStart?: string,
  ) {
    this.assertManager(user);
    return this.service.getCalendar(this.effectiveUserId(user), id, periodStart);
  }

  @Get('workers/:id/settlement')
  getSettlement(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Query('periodStart') periodStart?: string,
  ) {
    this.assertManager(user);
    return this.service.getSettlement(this.effectiveUserId(user), id, periodStart);
  }

  @Post('workers/:id/settlement/confirm')
  confirmSettlement(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() body: { periodStart?: string },
  ) {
    this.assertManager(user);
    return this.service.confirmSettlement(this.effectiveUserId(user), id, body?.periodStart);
  }
}
