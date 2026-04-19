import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CropBatchService } from './crop-batch.service';
import { GddService } from './gdd.service';
import { KmaClimateService } from './kma-climate.service';
import { CreateCropBatchDto } from './dto/create-crop-batch.dto';
import { UpdateCropBatchDto } from './dto/update-crop-batch.dto';

@Controller('crop-management')
@UseGuards(JwtAuthGuard)
export class CropManagementController {
  constructor(
    private readonly batchService: CropBatchService,
    private readonly gddService: GddService,
    private readonly climateService: KmaClimateService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  private effectiveUserId(user: any): string {
    return user.role === 'farm_user' && user.parentUserId ? user.parentUserId : user.id;
  }

  // ──── 배치 CRUD ────

  @Get('batches')
  getBatches(@CurrentUser() user: any) {
    return this.batchService.findAllByUser(this.effectiveUserId(user));
  }

  @Post('batches')
  createBatch(@CurrentUser() user: any, @Body() dto: CreateCropBatchDto) {
    return this.batchService.create(this.effectiveUserId(user), dto);
  }

  @Put('batches/:id')
  updateBatch(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: UpdateCropBatchDto,
  ) {
    return this.batchService.update(this.effectiveUserId(user), id, dto);
  }

  @Delete('batches/:id')
  async removeBatch(@CurrentUser() user: any, @Param('id') id: string) {
    await this.batchService.remove(this.effectiveUserId(user), id);
    return { ok: true };
  }

  // ──── GDD / 생육 단계 ────

  @Get('batches/:id/gdd')
  getGdd(@CurrentUser() user: any, @Param('id') id: string) {
    return this.batchService.getGdd(this.effectiveUserId(user), id);
  }

  @Get('batches/:id/milestones')
  getMilestones(@CurrentUser() user: any, @Param('id') id: string) {
    return this.batchService.getMilestones(this.effectiveUserId(user), id);
  }

  @Get('batches/:id/harvest-prediction')
  getHarvestPrediction(@CurrentUser() user: any, @Param('id') id: string) {
    return this.batchService.getHarvestPrediction(this.effectiveUserId(user), id);
  }

  @Post('batches/:id/calibrate')
  triggerCalibrate(@CurrentUser() user: any, @Param('id') id: string) {
    return this.batchService.triggerCalibrate(this.effectiveUserId(user), id);
  }

  @Get('batches/:id/timeline')
  getTimeline(@CurrentUser() user: any, @Param('id') id: string) {
    return this.batchService.getTimeline(this.effectiveUserId(user), id);
  }

  // ──── 대시보드 요약 ────

  @Get('dashboard')
  getDashboard(@CurrentUser() user: any) {
    return this.batchService.getDashboard(this.effectiveUserId(user));
  }

  // ──── 마스터 마일스톤 ────

  @Get('milestones/master')
  getMasterMilestones(@Query('cropType') cropType: string) {
    // GddService를 직접 사용할 DataSource 없이 간단하게 처리
    return this.gddService['dataSource'].query(
      `SELECT * FROM crop_milestones
       WHERE ($1::text IS NULL OR crop_type = $1)
       ORDER BY crop_type, gdd_threshold`,
      [cropType ?? null],
    );
  }

  // ──── 생육관리 기능 ON/OFF 설정 ────

  /** 현재 사용자 기준 기능 활성화 여부 반환 (플랫폼 설정 + 개인 설정 병합) */
  @Get('feature')
  async getFeatureSetting(@CurrentUser() user: any) {
    const userId = this.effectiveUserId(user);
    const rows: { scope: string; enabled: boolean; updated_by: string | null }[] =
      await this.dataSource.query(
        `SELECT scope, enabled, updated_by FROM crop_feature_settings WHERE scope IN ('platform', $1)`,
        [userId],
      );
    const platform = rows.find((r) => r.scope === 'platform');
    const personal  = rows.find((r) => r.scope === userId);

    const platformEnabled = platform?.enabled ?? true;
    const userEnabled = personal?.enabled ?? true;

    // 관리자가 이 사용자의 설정을 변경한 경우 (updated_by가 본인이 아님)
    const lockedByAdmin =
      personal !== undefined &&
      !personal.enabled &&
      personal.updated_by !== null &&
      personal.updated_by !== userId;

    return { enabled: platformEnabled && userEnabled, platformEnabled, userEnabled, lockedByAdmin };
  }

  /** 기능 설정 변경 (본인 또는 platform 범위) */
  @Patch('feature')
  async setFeatureSetting(
    @CurrentUser() user: any,
    @Body() body: { enabled: boolean; scope?: 'platform' | 'personal' },
  ) {
    const userId = this.effectiveUserId(user);
    const isAdmin = user.role === 'admin';
    const isFarmAdmin = user.role === 'farm_admin';

    if (!isAdmin && !isFarmAdmin) throw new ForbiddenException('권한이 없습니다.');

    const targetScope = (body.scope === 'platform' && isAdmin) ? 'platform' : userId;

    await this.dataSource.query(
      `INSERT INTO crop_feature_settings (scope, enabled, updated_by, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (scope) DO UPDATE SET enabled = $2, updated_by = $3, updated_at = NOW()`,
      [targetScope, body.enabled, userId],
    );
    return { ok: true, scope: targetScope, enabled: body.enabled };
  }

  /** 플랫폼 관리자: 특정 사용자의 기능 설정 변경 */
  @Patch('feature/users/:targetUserId')
  async setUserFeatureSetting(
    @CurrentUser() user: any,
    @Param('targetUserId') targetUserId: string,
    @Body() body: { enabled: boolean },
  ) {
    if (user.role !== 'admin') throw new ForbiddenException('플랫폼 관리자만 변경 가능합니다.');

    await this.dataSource.query(
      `INSERT INTO crop_feature_settings (scope, enabled, updated_by, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (scope) DO UPDATE SET enabled = $2, updated_by = $3, updated_at = NOW()`,
      [targetUserId, body.enabled, user.id],
    );
    return { ok: true, userId: targetUserId, enabled: body.enabled };
  }

  /** 플랫폼 관리자: 전체 사용자 기능 설정 목록 조회 */
  @Get('feature/all')
  async getAllFeatureSettings(@CurrentUser() user: any) {
    if (user.role !== 'admin') throw new ForbiddenException('플랫폼 관리자만 조회 가능합니다.');

    const rows: { scope: string; enabled: boolean }[] = await this.dataSource.query(
      `SELECT scope, enabled FROM crop_feature_settings`,
    );
    // scope별 맵으로 반환
    const map: Record<string, boolean> = {};
    for (const r of rows) map[r.scope] = r.enabled;
    return map;
  }

  // ──── 오프셋 차용 후보 조회 ────

  @Get('offset-suggestions')
  getOffsetSuggestions(
    @CurrentUser() user: any,
    @Query('groupId') groupId: string,
    @Query('cropType') cropType: string,
  ) {
    return this.gddService.getOffsetSuggestions(
      this.effectiveUserId(user),
      groupId,
      cropType,
    );
  }

  // ──── 기후 정규값 관리 ────

  /** 사용자 위치의 기후 정규값 조회 */
  @Get('climate-normals')
  async getClimateNormals(@CurrentUser() user: any) {
    const userId = this.effectiveUserId(user);
    // 최근 날씨 데이터에서 nx/ny 확인
    const rows = await this.dataSource.query<{ nx: number; ny: number }[]>(
      `SELECT nx, ny FROM weather_data WHERE user_id = $1 ORDER BY time DESC LIMIT 1`,
      [userId],
    );
    if (rows.length === 0) return { normals: {}, source: 'builtin', cached: false };

    const { nx, ny } = rows[0];
    const cached = await this.climateService.isCached(nx, ny);
    const normals = await this.climateService.getMonthlyNormals(nx, ny);

    return { nx, ny, normals, cached };
  }

  /** 기후 정규값 KMA ASOS API로 즉시 갱신 (admin only) */
  @Post('climate-normals/refresh')
  async refreshClimateNormals(@CurrentUser() user: any) {
    if (user.role !== 'admin') throw new ForbiddenException('플랫폼 관리자만 가능합니다.');

    const userId = this.effectiveUserId(user);
    const rows = await this.dataSource.query<{ nx: number; ny: number }[]>(
      `SELECT DISTINCT nx, ny FROM weather_data WHERE user_id = $1 ORDER BY nx, ny LIMIT 5`,
      [userId],
    );

    const results: Array<{ nx: number; ny: number; status: string }> = [];
    for (const { nx, ny } of rows) {
      try {
        await this.climateService.fetchAndCacheNormals(nx, ny);
        results.push({ nx, ny, status: 'ok' });
      } catch (e) {
        results.push({ nx, ny, status: `error: ${e.message}` });
      }
    }
    return { refreshed: results };
  }
}
