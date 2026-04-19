import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { CropBatch } from './entities/crop-batch.entity';
import {
  CROP_TARGET_GDD,
  CROP_MIN_DAILY_GDD,
  GROWTH_STAGES,
  resolveGrowthStage,
  TempSourceQuality,
  SOURCE_BADGE,
  DEFAULT_GREENHOUSE_OFFSET,
  NURSERY_OFFSET,
} from './crop-defaults.constants';
import { KmaClimateService } from './kma-climate.service';

export type OffsetStrategy = 'calibrated' | 'manual' | 'borrowed' | 'community' | 'default';

export interface GddResult {
  currentGdd: number;
  targetGdd: number;
  progressPct: number;
  stage: { key: string; label: string; emoji: string };
  sourceQuality: TempSourceQuality;
  sourceBadge: { color: string; emoji: string; label: string };
  dailyAvg: number;
  offsetInfo: { value: number; strategy: OffsetStrategy };
}

export interface MilestoneStatus {
  id: string;
  title: string;
  milestoneType: string;
  gddThreshold: number;
  priority: string;
  description: string | null;
  status: 'done' | 'imminent' | 'upcoming';
  estimatedDate: string | null;
}

export interface HarvestPrediction {
  currentGdd: number;
  targetGdd: number;
  remainingGdd: number;
  // ── 현재 속도 기반 예측 ──
  dailyAvgGdd: number;
  estimatedDaysLeft: number;
  estimatedDate: string;
  optimisticDate: string;
  pessimisticDate: string;
  // ── 계절 패턴 기반 예측 (기후 정규값) ──
  seasonal: {
    estimatedDate: string;
    estimatedDaysLeft: number;
    source: 'kma_asos' | 'weather_data' | 'builtin';
    dataYears: number;
    monthlyForecast: Array<{ month: string; label: string; expectedDailyGdd: number; role: 'actual' | 'forecast' }>;
  };
  // ── 예측 방법 및 신뢰도 ──
  predictionMethod: 'rate_only' | 'seasonal_only' | 'blended';
  daysElapsed: number;
  confidence: 'low' | 'medium' | 'high';
}

export interface OffsetSuggestion {
  selfCalibrated: number | null;
  otherGroups: Array<{ groupId: string; groupName: string; offset: number; cropType: string }>;
  communityAverage: { cropType: string; offset: number; sampleCount: number } | null;
}

@Injectable()
export class GddService {
  constructor(
    @InjectRepository(CropBatch)
    private readonly batchRepo: Repository<CropBatch>,
    private readonly dataSource: DataSource,
    private readonly climateService: KmaClimateService,
  ) {}

  // ──────────────────────────────────────────────────
  // 온도 소스 결정
  // ──────────────────────────────────────────────────

  async resolveSource(batch: CropBatch): Promise<{ source: TempSourceQuality; offset: number; offsetStrategy: OffsetStrategy }> {
    // 실내 센서 강제 모드: 센서만 사용, 오프셋 불필요
    if (batch.tempSource === 'sensor') {
      if (batch.groupId) {
        const hasActive = await this.checkActiveSensor(batch.groupId);
        if (hasActive) return { source: 'sensor', offset: 0, offsetStrategy: 'calibrated' };
      }
      // 센서 강제인데 센서 없음 → weather + offset 으로 폴백
    }

    // auto 모드: 실내 센서가 있으면 센서 우선
    if (batch.tempSource === 'auto' && batch.groupId) {
      const hasActive = await this.checkActiveSensor(batch.groupId);
      if (hasActive) return { source: 'sensor', offset: 0, offsetStrategy: 'calibrated' };
    }

    // 기상청 데이터 사용 → 항상 하우스 오프셋 적용
    // (tempSource가 'weather'이든 'auto'로 폴백되든 동일)
    const { value: offset, strategy: offsetStrategy } = await this.resolveOffset(batch);
    return {
      source: 'weather_with_offset',
      offset,
      offsetStrategy,
    };
  }

  private async checkActiveSensor(groupId: string): Promise<boolean> {
    const rows = await this.dataSource.query<{ device_id: string }[]>(
      `SELECT em.device_id
       FROM env_mappings em
       WHERE em.group_id = $1
         AND em.role_key = 'internal_temp'
         AND em.source_type = 'sensor'
         AND em.device_id IS NOT NULL
       LIMIT 1`,
      [groupId],
    );
    if (rows.length === 0) return false;

    const deviceId = rows[0].device_id;
    const recent = await this.dataSource.query<{ cnt: string }[]>(
      `SELECT COUNT(*) AS cnt
       FROM sensor_data
       WHERE device_id = $1
         AND time >= NOW() - INTERVAL '24 hours'`,
      [deviceId],
    );
    return parseInt(recent[0]?.cnt ?? '0', 10) > 0;
  }

  private async resolveOffset(batch: CropBatch): Promise<{ value: number; strategy: OffsetStrategy }> {
    // TypeORM은 decimal 컬럼을 문자열로 반환하므로 명시적으로 숫자 변환
    const parseDecimal = (v: unknown): number | null => {
      if (v == null) return null;
      const n = typeof v === 'number' ? v : parseFloat(String(v));
      return isNaN(n) ? null : n;
    };

    // 1. 자체 보정값
    const offset = parseDecimal(batch.greenhouseOffset);
    if (offset != null && batch.offsetSource === 'calibrated') {
      return { value: offset, strategy: 'calibrated' };
    }
    // 2. 수동 지정
    if (offset != null) {
      return { value: offset, strategy: 'manual' };
    }
    // 3. 차용한 그룹
    if (batch.borrowedGroupId) {
      const borrowed = await this.batchRepo.findOne({
        where: { groupId: batch.borrowedGroupId, isActive: true },
        order: { offsetCalibratedAt: 'DESC' },
      });
      const borrowedOffset = parseDecimal(borrowed?.greenhouseOffset);
      if (borrowedOffset != null) return { value: borrowedOffset, strategy: 'borrowed' };
    }
    // 4. 커뮤니티 중앙값
    const community = await this.dataSource.query<{ median_offset: string }[]>(
      `SELECT median_offset FROM crop_community_offsets WHERE crop_type = $1 AND sample_count > 0`,
      [batch.cropType],
    );
    if (community.length > 0 && community[0].median_offset != null) {
      return { value: parseFloat(community[0].median_offset), strategy: 'community' };
    }
    // 최종 폴백: 한국 비닐하우스 평균 내외 온도차 기본값
    return { value: DEFAULT_GREENHOUSE_OFFSET, strategy: 'default' };
  }

  // ──────────────────────────────────────────────────
  // GDD 계산 (메인)
  // ──────────────────────────────────────────────────

  async calculateGdd(batch: CropBatch): Promise<GddResult> {
    const { source, offset, offsetStrategy } = await this.resolveSource(batch);
    // TypeORM decimal 컬럼은 문자열로 반환될 수 있으므로 명시적 변환
    const targetGdd = parseFloat(String(batch.targetGdd ?? CROP_TARGET_GDD[batch.cropType] ?? 1200));

    let currentGdd = 0;
    let dailyAvg = 0;

    if (source === 'sensor' || source === 'sensor_with_gap_fill') {
      const result = await this.calculateFromSensor(batch, offset, source === 'sensor_with_gap_fill');
      currentGdd = result.gdd;
      dailyAvg = result.dailyAvg;
    } else {
      const result = await this.calculateFromWeather(batch, offset);
      currentGdd = result.gdd;
      dailyAvg = result.dailyAvg;
    }

    const stage = resolveGrowthStage(currentGdd);
    const progressPct = Math.min(Math.round((currentGdd / targetGdd) * 100), 100);

    return {
      currentGdd: Math.round(currentGdd * 10) / 10,
      targetGdd,
      progressPct,
      stage: { key: stage.key, label: stage.label, emoji: stage.emoji },
      sourceQuality: source,
      sourceBadge: SOURCE_BADGE[source],
      dailyAvg: Math.round(dailyAvg * 10) / 10,
      offsetInfo: { value: Math.round(offset * 10) / 10, strategy: offsetStrategy },
    };
  }

  private async calculateFromSensor(
    batch: CropBatch,
    offset: number,
    gapFill: boolean,
  ): Promise<{ gdd: number; dailyAvg: number }> {
    const deviceRows = await this.dataSource.query<{ device_id: string }[]>(
      `SELECT em.device_id
       FROM env_mappings em
       WHERE em.group_id = $1
         AND em.role_key = 'internal_temp'
         AND em.source_type = 'sensor'
       LIMIT 1`,
      [batch.groupId],
    );

    if (deviceRows.length === 0) {
      return this.calculateFromWeather(batch, offset);
    }

    const deviceId = deviceRows[0].device_id;
    const baseTemp = batch.baseTemp ?? 10;

    // 일별 센서 데이터 시간 커버리지 + 기상청 갭 채움 포함 GDD
    const rows = await this.dataSource.query<{ day: string; gdd: string; hours_covered: string }[]>(
      `WITH daily_sensor AS (
         SELECT
           DATE_TRUNC('day', time) AS day,
           AVG(value::numeric) AS avg_temp,
           COUNT(DISTINCT DATE_TRUNC('hour', time)) AS hours_covered
         FROM sensor_data
         WHERE device_id = $1
           AND sensor_type = 'temperature'
           AND time >= $2::date
         GROUP BY 1
       ),
       daily_weather AS (
         SELECT
           DATE_TRUNC('day', time) AS day,
           AVG(temperature) AS avg_temp
         FROM weather_data
         WHERE user_id = $3
           AND time >= $2::date
         GROUP BY 1
       )
       SELECT
         COALESCE(ds.day, dw.day) AS day,
         GREATEST(
           COALESCE(
             CASE WHEN ds.hours_covered >= 12 THEN ds.avg_temp
                  ELSE (ds.avg_temp * ds.hours_covered + dw.avg_temp * (24 - ds.hours_covered)) / 24
             END,
             dw.avg_temp + $5
           ) - $4,
           0
         ) AS gdd,
         COALESCE(ds.hours_covered, 0) AS hours_covered
       FROM daily_sensor ds
       FULL OUTER JOIN daily_weather dw ON ds.day = dw.day
       ORDER BY day`,
      [deviceId, batch.sowingDate, batch.userId, baseTemp, offset],
    );

    const totalGdd = rows.reduce((sum, r) => sum + parseFloat(r.gdd), 0);
    const dailyAvg = rows.length > 0 ? totalGdd / rows.length : 0;

    // 갭 채움 여부에 따라 source 재분류
    const hasGap = rows.some((r) => parseInt(r.hours_covered) < 12);
    if (hasGap && !gapFill) {
      // source를 sensor_with_gap_fill로 업데이트 필요 (호출자에서 처리)
    }

    return { gdd: totalGdd, dailyAvg };
  }

  private async calculateFromWeather(
    batch: CropBatch,
    offset: number,
  ): Promise<{ gdd: number; dailyAvg: number }> {
    const baseTemp = batch.baseTemp ?? 10;
    // 정식일 전(육묘기): NURSERY_OFFSET, 정식일 이후: 일반 오프셋
    // $5가 NULL이면 조건이 false가 되어 전 기간 일반 오프셋 적용
    const transplantDate = batch.transplantDate ?? null;

    const rows = await this.dataSource.query<{ gdd: string }[]>(
      `SELECT GREATEST(
         AVG(temperature) +
         CASE
           WHEN $5::date IS NOT NULL AND DATE_TRUNC('day', time) < $5::date
           THEN $6
           ELSE $3
         END
         - $4, 0
       ) AS gdd
       FROM weather_data
       WHERE user_id = $1
         AND time >= $2::date
       GROUP BY DATE_TRUNC('day', time)
       ORDER BY 1`,
      [batch.userId, batch.sowingDate, offset, baseTemp, transplantDate, NURSERY_OFFSET],
    );

    const totalGdd = rows.reduce((sum, r) => sum + parseFloat(r.gdd), 0);
    const dailyAvg = rows.length > 0 ? totalGdd / rows.length : 0;

    return { gdd: totalGdd, dailyAvg };
  }

  // ──────────────────────────────────────────────────
  // 마일스톤 목록
  // ──────────────────────────────────────────────────

  async getMilestones(batch: CropBatch, currentGdd: number): Promise<MilestoneStatus[]> {
    const rows = await this.dataSource.query<{
      id: string;
      title: string;
      milestone_type: string;
      gdd_threshold: string;
      priority: string;
      description: string | null;
    }[]>(
      `SELECT id, title, milestone_type, gdd_threshold, priority, description
       FROM crop_milestones
       WHERE crop_type = $1
         AND seedling_type = $2
       ORDER BY gdd_threshold ASC`,
      [batch.cropType, batch.seedlingType],
    );

    // upcoming 마일스톤 임계값만 추출해 예상일 일괄 계산
    const upcomingThresholds = rows
      .map((r) => parseFloat(r.gdd_threshold))
      .filter((t) => t > currentGdd);

    let estimatedDates: Record<number, string> = {};
    if (upcomingThresholds.length > 0) {
      estimatedDates = await this.estimateFutureMilestoneDates(batch, currentGdd, upcomingThresholds);
    }

    return rows.map((r) => {
      const threshold = parseFloat(r.gdd_threshold);
      let status: 'done' | 'imminent' | 'upcoming';
      if (currentGdd >= threshold) {
        status = 'done';
      } else if (threshold - currentGdd <= 50) {
        status = 'imminent';
      } else {
        status = 'upcoming';
      }
      return {
        id: r.id,
        title: r.title,
        milestoneType: r.milestone_type,
        gddThreshold: threshold,
        priority: r.priority,
        description: r.description,
        status,
        estimatedDate: status !== 'done' ? (estimatedDates[threshold] ?? null) : null,
      };
    });
  }

  // ──────────────────────────────────────────────────
  // GDD 타임라인 (일별 누적 추이)
  // ──────────────────────────────────────────────────

  async getTimeline(batch: CropBatch): Promise<{
    cropType: string;
    sowingDate: string;
    targetGdd: number;
    currentGdd: number;
    dailyPoints: Array<{ date: string; cumulativeGdd: number; dailyGdd: number }>;
    milestones: Array<{ gddThreshold: number; title: string; milestoneType: string; priority: string; reachedDate: string | null; estimatedDate: string | null }>;
    estimatedHarvestDate: string;
  }> {
    const { source, offset } = await this.resolveSource(batch);
    const targetGdd = batch.targetGdd ?? CROP_TARGET_GDD[batch.cropType] ?? 1200;
    const baseTemp = batch.baseTemp ?? 10;

    // 일별 GDD 데이터 포인트
    let dailyRows: Array<{ day: string; daily_gdd: number }> = [];

    if (source === 'sensor' || source === 'sensor_with_gap_fill') {
      const deviceRows = await this.dataSource.query<{ device_id: string }[]>(
        `SELECT em.device_id FROM env_mappings em
         WHERE em.group_id = $1 AND em.role_key = 'internal_temp' AND em.source_type = 'sensor'
         LIMIT 1`,
        [batch.groupId],
      );

      if (deviceRows.length > 0) {
        const deviceId = deviceRows[0].device_id;
        const rows = await this.dataSource.query<{ day: string; daily_gdd: string }[]>(
          `WITH daily_sensor AS (
             SELECT DATE_TRUNC('day', time) AS day,
                    AVG(value::numeric) AS avg_temp,
                    COUNT(DISTINCT DATE_TRUNC('hour', time)) AS hours_covered
             FROM sensor_data
             WHERE device_id = $1 AND sensor_type = 'temperature' AND time >= $2::date
             GROUP BY 1
           ),
           daily_weather AS (
             SELECT DATE_TRUNC('day', time) AS day, AVG(temperature) AS avg_temp
             FROM weather_data
             WHERE user_id = $3 AND time >= $2::date
             GROUP BY 1
           )
           SELECT
             COALESCE(ds.day, dw.day) AS day,
             GREATEST(
               COALESCE(
                 CASE WHEN COALESCE(ds.hours_covered, 0) >= 12 THEN ds.avg_temp
                      ELSE COALESCE(dw.avg_temp, ds.avg_temp) + $5
                 END,
                 COALESCE(dw.avg_temp, 0) + $5
               ) - $4, 0
             ) AS daily_gdd
           FROM daily_sensor ds
           FULL OUTER JOIN daily_weather dw ON ds.day = dw.day
           ORDER BY day`,
          [deviceId, batch.sowingDate, batch.userId, baseTemp, offset],
        );
        dailyRows = rows.map(r => ({ day: r.day, daily_gdd: parseFloat(r.daily_gdd) }));
      }
    }

    // sensor 데이터 없으면 weather fallback (육묘기 오프셋 분기 적용)
    if (dailyRows.length === 0) {
      const transplantDate = batch.transplantDate ?? null;
      const rows = await this.dataSource.query<{ day: string; daily_gdd: string }[]>(
        `SELECT DATE_TRUNC('day', time) AS day,
                GREATEST(
                  AVG(temperature) +
                  CASE
                    WHEN $5::date IS NOT NULL AND DATE_TRUNC('day', time) < $5::date
                    THEN $6
                    ELSE $3
                  END
                  - $4, 0
                ) AS daily_gdd
         FROM weather_data
         WHERE user_id = $1 AND time >= $2::date
         GROUP BY DATE_TRUNC('day', time)
         ORDER BY day`,
        [batch.userId, batch.sowingDate, offset, baseTemp, transplantDate, NURSERY_OFFSET],
      );
      dailyRows = rows.map(r => ({ day: r.day, daily_gdd: parseFloat(r.daily_gdd) }));
    }

    // 누적 GDD 계산
    let cumulative = 0;
    const dailyPoints = dailyRows.map(r => {
      cumulative += r.daily_gdd;
      return {
        date: r.day.toString().split('T')[0],
        cumulativeGdd: Math.round(cumulative * 10) / 10,
        dailyGdd: Math.round(r.daily_gdd * 10) / 10,
      };
    });

    const currentGdd = cumulative;

    // 마일스톤 — 도달 날짜 계산
    const milestoneRows = await this.dataSource.query<{
      gdd_threshold: string; title: string; milestone_type: string; priority: string;
    }[]>(
      `SELECT gdd_threshold, title, milestone_type, priority
       FROM crop_milestones
       WHERE crop_type = $1 AND (seedling_type IS NULL OR seedling_type = $2)
       ORDER BY gdd_threshold ASC`,
      [batch.cropType, batch.seedlingType],
    );

    const milestonesBase = milestoneRows.map(m => {
      const threshold = parseFloat(m.gdd_threshold);
      const reached = dailyPoints.find(p => p.cumulativeGdd >= threshold);
      return {
        gddThreshold: threshold,
        title: m.title,
        milestoneType: m.milestone_type,
        priority: m.priority,
        reachedDate: reached?.date ?? null,
      };
    });

    // 미래 마일스톤 예상 날짜 시뮬레이션
    const futureMilestones = milestonesBase.filter(m => m.reachedDate === null);
    const estimatedDates = futureMilestones.length > 0
      ? await this.estimateFutureMilestoneDates(batch, currentGdd, futureMilestones.map(m => m.gddThreshold))
      : {};

    const milestones = milestonesBase.map(m => ({
      ...m,
      estimatedDate: m.reachedDate !== null ? null : (estimatedDates[m.gddThreshold] ?? null),
    }));

    // 예상 수확일
    // 목표 GDD에 가장 가까운 마일스톤의 estimatedDate 우선 사용
    // (estimateFutureMilestoneDates가 계절 시뮬레이션으로 계산한 값과 일치)
    const harvestMilestone = milestones.find(m => m.gddThreshold >= targetGdd && m.estimatedDate);
    let estimatedHarvestDate: string;
    if (harvestMilestone?.estimatedDate) {
      estimatedHarvestDate = harvestMilestone.estimatedDate;
    } else if (milestones.find(m => m.gddThreshold >= targetGdd)?.reachedDate) {
      // 이미 수확 GDD 도달한 경우
      estimatedHarvestDate = milestones.find(m => m.gddThreshold >= targetGdd)!.reachedDate!;
    } else {
      // 마일스톤이 없거나 targetGdd에 해당하는 마일스톤이 없으면 계절 시뮬레이션 직접 계산
      const fallbackDates = await this.estimateFutureMilestoneDates(batch, currentGdd, [targetGdd]);
      estimatedHarvestDate = fallbackDates[targetGdd] ?? new Date().toISOString().split('T')[0];
    }

    return {
      cropType: batch.cropType,
      sowingDate: batch.sowingDate,
      targetGdd,
      currentGdd: Math.round(currentGdd * 10) / 10,
      dailyPoints,
      milestones,
      estimatedHarvestDate,
    };
  }

  /**
   * 기후 정규값으로 미래 마일스톤 예상 도달 날짜를 계산합니다.
   * @param thresholds 아직 도달하지 못한 GDD 임계값 목록 (오름차순)
   * @returns Record<gddThreshold, ISO 날짜 문자열>
   */
  private async estimateFutureMilestoneDates(
    batch: CropBatch,
    currentGdd: number,
    thresholds: number[],
  ): Promise<Record<number, string>> {
    // TypeORM decimal 컬럼은 문자열로 반환될 수 있으므로 명시적 변환
    const baseTemp = parseFloat(String(batch.baseTemp ?? 10)) || 10;

    const weatherRow = await this.dataSource.query<{ nx: number; ny: number }[]>(
      `SELECT nx, ny FROM weather_data WHERE user_id = $1 ORDER BY time DESC LIMIT 1`,
      [batch.userId],
    );
    const nx = weatherRow[0]?.nx ?? 96;
    const ny = weatherRow[0]?.ny ?? 148;
    const monthlyTemps = await this.climateService.getMonthlyNormals(nx, ny);
    // 미래 마일스톤도 외기 기후 정규값 시뮬레이션 → 항상 하우스 오프셋 적용
    const { value: regularOffset } = await this.resolveOffset(batch);
    const transplantDate = batch.transplantDate ? new Date(batch.transplantDate) : null;

    const sorted = [...thresholds].sort((a, b) => a - b);
    const result: Record<number, string> = {};
    let acc = currentGdd;
    let thIdx = 0;
    const today = new Date();

    for (let d = 0; d < 730 && thIdx < sorted.length; d++) {
      const sim = new Date(today);
      sim.setDate(today.getDate() + d);
      // 정식 전(육묘기): NURSERY_OFFSET, 정식 후: 일반 오프셋
      const offset = transplantDate && sim < transplantDate ? NURSERY_OFFSET : regularOffset;
      const month = sim.getMonth() + 1;
      const avgTemp = monthlyTemps[month] ?? 10;
      const dailyGdd = Math.max(avgTemp + offset - baseTemp, 0);
      acc += dailyGdd;

      while (thIdx < sorted.length && acc >= sorted[thIdx]) {
        result[sorted[thIdx]] = sim.toISOString().split('T')[0];
        thIdx++;
      }
    }

    return result;
  }

  // ──────────────────────────────────────────────────
  // 수확일 예측 (현재 속도 + 계절 패턴 이중 예측)
  // ──────────────────────────────────────────────────

  async getHarvestPrediction(batch: CropBatch): Promise<HarvestPrediction> {
    const gddResult = await this.calculateGdd(batch);
    const { currentGdd, targetGdd, dailyAvg } = gddResult;

    const remaining = Math.max(targetGdd - currentGdd, 0);
    const minDaily = CROP_MIN_DAILY_GDD[batch.cropType] ?? 5;

    // 파종 이후 경과일
    const sowingMs = new Date(batch.sowingDate).getTime();
    const daysElapsed = Math.max(1, Math.round((Date.now() - sowingMs) / 86400000));

    // ── 계절 패턴 기반 예측 ──
    const seasonal = await this.getSeasonalPrediction(batch, remaining);

    const addDays = (days: number) => {
      const d = new Date();
      d.setDate(d.getDate() + days);
      return d.toISOString().split('T')[0];
    };

    // ── 현재 속도 기반 예측 ──
    // 현재 일평균 GDD가 MIN_DAILY 미만이면 (저온 계절 등) 계절 패턴 속도를 기준으로 사용
    // (실제 봄 저온 기간에 0.X GDD/일이 나와 수백 일 예측이 뜨는 문제 방지)
    const seasonalDailyRate = seasonal.estimatedDaysLeft > 0
      ? remaining / seasonal.estimatedDaysLeft
      : minDaily;
    const effectiveDailyRate = dailyAvg >= minDaily
      ? dailyAvg
      : Math.max(seasonalDailyRate, minDaily);

    const estimatedDays = Math.round(remaining / effectiveDailyRate);
    const optimisticDays = Math.round(remaining / (effectiveDailyRate * 1.2));
    const pessimisticDays = Math.round(remaining / (effectiveDailyRate * 0.8));

    // ── 신뢰도 및 예측 방법 결정 ──
    let predictionMethod: HarvestPrediction['predictionMethod'];
    let confidence: HarvestPrediction['confidence'];

    // 현재 속도가 너무 낮으면 계절 패턴 전용으로 표시
    if (daysElapsed < 7 || dailyAvg < minDaily) {
      predictionMethod = 'seasonal_only';
      confidence = daysElapsed < 7 ? 'low' : 'medium';
    } else if (daysElapsed < 30) {
      predictionMethod = 'blended';
      confidence = 'medium';
    } else {
      predictionMethod = 'blended';
      confidence = 'high';
    }

    return {
      currentGdd,
      targetGdd,
      remainingGdd: Math.round(remaining * 10) / 10,
      dailyAvgGdd: Math.round(effectiveDailyRate * 10) / 10,
      estimatedDaysLeft: estimatedDays,
      estimatedDate: addDays(estimatedDays),
      optimisticDate: addDays(optimisticDays),
      pessimisticDate: addDays(pessimisticDays),
      seasonal,
      predictionMethod,
      daysElapsed,
      confidence,
    };
  }

  /**
   * 계절 패턴 기반 수확일 예측
   * - climate_normals 테이블의 월별 평균 기온으로 미래 GDD 시뮬레이션
   * - 오프셋 반영 (하우스 내부온도 보정)
   */
  private async getSeasonalPrediction(
    batch: CropBatch,
    remainingGdd: number,
  ): Promise<HarvestPrediction['seasonal']> {
    // TypeORM decimal 컬럼은 문자열로 반환될 수 있으므로 명시적 변환
    const baseTemp = parseFloat(String(batch.baseTemp ?? 10)) || 10;

    // 사용자의 날씨 관측 위치 (nx, ny) 조회
    const weatherRow = await this.dataSource.query<{ nx: number; ny: number }[]>(
      `SELECT nx, ny FROM weather_data WHERE user_id = $1 ORDER BY time DESC LIMIT 1`,
      [batch.userId],
    );

    const nx = weatherRow[0]?.nx ?? 96; // 기본: 횡성 근처
    const ny = weatherRow[0]?.ny ?? 148;

    // 기후 정규값 조회 (없으면 내장값 즉시 반환, 백그라운드 fetch)
    const monthlyTemps = await this.climateService.getMonthlyNormals(nx, ny);

    // 기후 정규값 메타 조회
    const metaRows = await this.dataSource.query<{ source: string; data_years: string }[]>(
      `SELECT cn.source, cn.data_years
       FROM climate_normals cn
       WHERE cn.nx = $1 AND cn.ny = $2
       LIMIT 1`,
      [nx, ny],
    );
    const source = (metaRows[0]?.source ?? 'builtin') as 'kma_asos' | 'weather_data' | 'builtin';
    const dataYears = metaRows[0]?.data_years ? parseInt(metaRows[0].data_years, 10) : 0;

    // 계절 예측은 기후 정규값(외기 온도) 기반 시뮬레이션
    // → 실내 센서 유무와 무관하게 항상 하우스 오프셋 적용
    const { value: regularOffset } = await this.resolveOffset(batch);
    const transplantDate = batch.transplantDate ? new Date(batch.transplantDate) : null;

    // 오늘부터 월별로 시뮬레이션 → 잔여 GDD 소진 날짜 찾기
    const today = new Date();
    let accGdd = 0;
    let daysLeft = 0;
    const monthlyForecast: HarvestPrediction['seasonal']['monthlyForecast'] = [];
    const maxDays = 500;

    // 지난달 기준 실측 월 파악
    const actualMonthsCutoff = today.getMonth() + 1; // 현재 월 이전은 실측 가능

    const visited = new Set<string>();
    for (let d = 0; d < maxDays && accGdd < remainingGdd; d++) {
      const sim = new Date(today);
      sim.setDate(sim.getDate() + d);
      // 정식 전(육묘기): NURSERY_OFFSET, 정식 후: 일반 오프셋
      const offset = transplantDate && sim < transplantDate ? NURSERY_OFFSET : regularOffset;
      const month = sim.getMonth() + 1;
      const avgTemp = monthlyTemps[month] ?? 10;
      const dailyGdd = Math.max(avgTemp + offset - baseTemp, 0);
      accGdd += dailyGdd;
      daysLeft = d + 1;

      // 월별 포캐스트 집계 (월당 1회)
      const mKey = `${sim.getFullYear()}-${String(month).padStart(2, '0')}`;
      if (!visited.has(mKey)) {
        visited.add(mKey);
        monthlyForecast.push({
          month: mKey,
          label: `${sim.getFullYear()}년 ${month}월`,
          expectedDailyGdd: Math.round(dailyGdd * 10) / 10,
          role: month <= actualMonthsCutoff && sim.getFullYear() <= today.getFullYear() ? 'actual' : 'forecast',
        });
      }
    }

    const harvestDate = new Date(today);
    harvestDate.setDate(today.getDate() + daysLeft);

    return {
      estimatedDate: harvestDate.toISOString().split('T')[0],
      estimatedDaysLeft: daysLeft,
      source,
      dataYears,
      monthlyForecast: monthlyForecast.slice(0, 8), // 최대 8개월
    };
  }

  // ──────────────────────────────────────────────────
  // 오프셋 차용 후보 조회
  // ──────────────────────────────────────────────────

  async getOffsetSuggestions(userId: string, groupId: string, cropType: string): Promise<OffsetSuggestion> {
    // 같은 사용자의 다른 그룹 (실내 센서 보정값 있는 것만)
    const otherBatches = await this.dataSource.query<{
      group_id: string;
      greenhouse_offset: string;
      crop_type: string;
    }[]>(
      `SELECT DISTINCT ON (group_id) group_id, greenhouse_offset, crop_type
       FROM gdd_batches
       WHERE user_id = $1
         AND group_id != $2
         AND group_id IS NOT NULL
         AND greenhouse_offset IS NOT NULL
         AND offset_source = 'calibrated'
         AND is_active = TRUE
       ORDER BY group_id, offset_calibrated_at DESC`,
      [userId, groupId],
    );

    // 그룹 이름 조회
    const groupIds = otherBatches.map((b) => b.group_id);
    let groupNames: Record<string, string> = {};
    if (groupIds.length > 0) {
      const nameRows = await this.dataSource.query<{ id: string; name: string }[]>(
        `SELECT id, name FROM house_groups WHERE id = ANY($1)`,
        [groupIds],
      );
      groupNames = Object.fromEntries(nameRows.map((r) => [r.id, r.name]));
    }

    // 커뮤니티 중앙값
    const community = await this.dataSource.query<{ median_offset: string; sample_count: string }[]>(
      `SELECT median_offset, sample_count FROM crop_community_offsets WHERE crop_type = $1`,
      [cropType],
    );

    return {
      selfCalibrated: null,
      otherGroups: otherBatches.map((b) => ({
        groupId: b.group_id,
        groupName: groupNames[b.group_id] ?? b.group_id,
        offset: parseFloat(b.greenhouse_offset),
        cropType: b.crop_type,
      })),
      communityAverage:
        community.length > 0 && community[0].median_offset != null
          ? {
              cropType,
              offset: parseFloat(community[0].median_offset),
              sampleCount: parseInt(community[0].sample_count, 10),
            }
          : null,
    };
  }

  // ──────────────────────────────────────────────────
  // 자동 보정값 계산 (크론 또는 수동 트리거)
  // ──────────────────────────────────────────────────

  async autoCalibrate(batch: CropBatch): Promise<number | null> {
    if (!batch.groupId) return null;

    const deviceRows = await this.dataSource.query<{ device_id: string }[]>(
      `SELECT em.device_id
       FROM env_mappings em
       WHERE em.group_id = $1
         AND em.role_key = 'internal_temp'
         AND em.source_type = 'sensor'
       LIMIT 1`,
      [batch.groupId],
    );
    if (deviceRows.length === 0) return null;

    const deviceId = deviceRows[0].device_id;

    const rows = await this.dataSource.query<{ offset: string }[]>(
      `WITH hourly_sensor AS (
         SELECT
           DATE_TRUNC('hour', time) AS hour,
           AVG(value::numeric) AS indoor_avg
         FROM sensor_data
         WHERE device_id = $1
           AND sensor_type = 'temperature'
           AND time >= NOW() - INTERVAL '30 days'
         GROUP BY 1
       )
       SELECT AVG(hs.indoor_avg - wd.temperature) AS offset
       FROM hourly_sensor hs
       JOIN weather_data wd
         ON DATE_TRUNC('hour', wd.time) = hs.hour
        AND wd.user_id = $2`,
      [deviceId, batch.userId],
    );

    const offsetVal = rows[0]?.offset != null ? parseFloat(rows[0].offset) : null;
    if (offsetVal == null) return null;

    await this.batchRepo.update(batch.id, {
      greenhouseOffset: Math.round(offsetVal * 10) / 10,
      offsetSource: 'calibrated',
      offsetCalibratedAt: new Date(),
    });

    // 커뮤니티 오프셋 갱신 (비동기 — 오류 무시)
    this.updateCommunityOffset(batch.cropType).catch(() => {});

    return Math.round(offsetVal * 10) / 10;
  }

  private async updateCommunityOffset(cropType: string): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO crop_community_offsets (crop_type, median_offset, sample_count, updated_at)
       SELECT
         $1 AS crop_type,
         PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY greenhouse_offset) AS median_offset,
         COUNT(*) AS sample_count,
         NOW() AS updated_at
       FROM gdd_batches
       WHERE crop_type = $1
         AND offset_source = 'calibrated'
         AND greenhouse_offset IS NOT NULL
       ON CONFLICT (crop_type)
       DO UPDATE SET
         median_offset = EXCLUDED.median_offset,
         sample_count  = EXCLUDED.sample_count,
         updated_at    = EXCLUDED.updated_at`,
      [cropType],
    );
  }
}
