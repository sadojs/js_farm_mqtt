import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { WorkLogService } from './work-log.service';
import {
  CreateWorkLogDto,
  MonthQueryDto,
  ToggleHiddenDto,
  UpdateWorkLogDto,
  UpsertWorkTaskTypeDto,
  WorkLogListQueryDto,
} from './dto/work-log.dto';
import { COLOR_SWATCHES, EMOJI_PALETTE } from './work-log.constants';

@UseGuards(JwtAuthGuard)
@Controller('work-log')
export class WorkLogController {
  constructor(private readonly svc: WorkLogService) {}

  // ── palette (이모지/색) — 클라이언트가 추가 모달에서 사용 ──
  @Get('palette')
  palette() {
    return { emoji: EMOJI_PALETTE, color: COLOR_SWATCHES };
  }

  // ── task types ──
  @Get('task-types')
  listTaskTypes(@CurrentUser() user: any) {
    return this.svc.listTaskTypes(user);
  }

  @Post('task-types')
  createTaskType(@CurrentUser() user: any, @Body() dto: UpsertWorkTaskTypeDto) {
    return this.svc.createTaskType(user, dto);
  }

  @Put('task-types/:id')
  updateTaskType(
    @CurrentUser() user: any,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpsertWorkTaskTypeDto,
  ) {
    return this.svc.updateTaskType(user, id, dto);
  }

  @Patch('task-types/:id/hidden')
  toggleHidden(
    @CurrentUser() user: any,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ToggleHiddenDto,
  ) {
    return this.svc.toggleHidden(user, id, dto.hidden);
  }

  @Delete('task-types/:id')
  deleteTaskType(@CurrentUser() user: any, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.svc.deleteTaskType(user, id);
  }

  // ── logs ──
  @Get('logs')
  listLogs(@CurrentUser() user: any, @Query() q: WorkLogListQueryDto) {
    return this.svc.listLogs(user, q);
  }

  @Get('logs/by-month')
  listByMonth(@CurrentUser() user: any, @Query() q: MonthQueryDto) {
    const month = q.month ?? new Date().toISOString().slice(0, 7);
    return this.svc.listLogsByMonth(user, month);
  }

  @Post('logs')
  createLog(@CurrentUser() user: any, @Body() dto: CreateWorkLogDto) {
    return this.svc.createLog(user, dto);
  }

  @Put('logs/:id')
  updateLog(
    @CurrentUser() user: any,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateWorkLogDto,
  ) {
    return this.svc.updateLog(user, id, dto);
  }

  @Delete('logs/:id')
  deleteLog(@CurrentUser() user: any, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.svc.deleteLog(user, id);
  }

  // ── board: 구역×작업종류 마지막 기록 ──
  @Get('board')
  board(@CurrentUser() user: any) {
    return this.svc.boardMatrix(user);
  }
}
