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
  /** 기후 정규값으로 백필한 일수 (실측 weather_data/센서 결측 구간) */
  backfilledDays: number;
  /** 파종일~오늘 총 계산 일수 */
  totalDays: number;
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
    let backfilledDays = 0;
    let totalDays = 0;

    if (source === 'sensor' || source === 'sensor_with_gap_fill') {
      const result = await this.calculateFromSensor(batch, offset, source === 'sensor_with_gap_fill');
      currentGdd = result.gdd;
      dailyAvg = result.dailyAvg;
      backfilledDays = result.backfilledDays;
      totalDays = result.totalDays;
    } else {
      const result = await this.calculateFromWeather(batch, offset);
      currentGdd = result.gdd;
      dailyAvg = result.dailyAvg;
      backfilledDays = result.backfilledDays;
      totalDays = result.totalDays;
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
      backfilledDays,
      totalDays,
    };
  }

  private async calculateFromSensor(
    batch: CropBatch,
    offset: number,
    _gapFill: boolean,
  ): Promise<{ gdd: number; dailyAvg: number; backfilledDays: number; totalDays: number }> {
    // 실내센서 > weather_data > climate_normals 우선순위로 일별 집계
    // (센서 device 가 없으면 helper 내부에서 weather/normals 로 자동 폴백)
    const series = await this.buildElapsedDailyGdd(batch, offset, { useSensor: true });
    return this.reduceSeries(series);
  }

  private async calculateFromWeather(
    batch: CropBatch,
    offset: number,
  ): Promise<{ gdd: number; dailyAvg: number; backfilledDays: number; totalDays: number }> {
    const series = await this.buildElapsedDailyGdd(batch, offset, { useSensor: false });
    return this.reduceSeries(series);
  }

  /** 일별 시리즈 → 누적 GDD / 일평균 / 백필일수 집계 */
  private reduceSeries(
    series: Array<{ date: string; dailyGdd: number; source: 'sensor' | 'weather' | 'normal' }>,
  ): { gdd: number; dailyAvg: number; backfilledDays: number; totalDays: number } {
    const totalGdd = series.reduce((sum, r) => sum + r.dailyGdd, 0);
    const dailyAvg = series.length > 0 ? totalGdd / series.length : 0;
    const backfilledDays = series.filter((r) => r.source === 'normal').length;
    return { gdd: totalGdd, dailyAvg, backfilledDays, totalDays: series.length };
  }

  /**
   * 파종일 ~ 오늘 일별 GDD 시리즈(경과분).
   *
   * 일별 온도 소스 우선순위:
   *   실내센서(≥12h) > 센서+외기 블렌드(부분 커버) > weather_data(외기+오프셋)
   *   > climate_normals 월평균(외기+오프셋)  ← 백필
   *
   * weather_data 시작 이전/중간 결측 구간을 기후 정규값으로 백필한다.
   * (백필이 없으면 `time >= sowingDate` 가 데이터 시작일이 같은 서로 다른 파종일 배치에
   *  동일 행 집합을 반환 → 누적 GDD 가 붕괴되는 문제를 해결)
   */
  private async buildElapsedDailyGdd(
    batch: CropBatch,
    offset: number,
    opts: { useSensor: boolean },
  ): Promise<Array<{ date: string; dailyGdd: number; source: 'sensor' | 'weather' | 'normal' }>> {
    const baseTemp = parseFloat(String(batch.baseTemp ?? 10)) || 10;
    const transplant = batch.transplantDate ? String(batch.transplantDate).slice(0, 10) : null;
    const sowing = String(batch.sowingDate).slice(0, 10);

    // 백필용 기후 정규값 (사용자 관측 위치 nx/ny 기준)
    const loc = await this.dataSource.query<{ nx: number; ny: number }[]>(
      `SELECT nx, ny FROM weather_data WHERE user_id = $1 ORDER BY time DESC LIMIT 1`,
      [batch.userId],
    );
    const nx = loc[0]?.nx;
    const ny = loc[0]?.ny;
    const normals: Record<number, number> =
      nx != null && ny != null ? await this.climateService.getMonthlyNormals(nx, ny) : {};

    // 일별 외기 평균 (weather_data)
    const wRows = await this.dataSource.query<{ day: string; avg_temp: string }[]>(
      `SELECT (DATE_TRUNC('day', time))::date::text AS day, AVG(temperature) AS avg_temp
       FROM weather_data
       WHERE user_id = $1 AND time >= $2::date
       GROUP BY 1`,
      [batch.userId, sowing],
    );
    const weatherMap = new Map<string, number>();
    for (const r of wRows) weatherMap.set(r.day, parseFloat(r.avg_temp));

    // 일별 실내센서 평균 + 시간 커버리지
    const sensorMap = new Map<string, { avg: number; hours: number }>();
    if (opts.useSensor && batch.groupId) {
      const devRows = await this.dataSource.query<{ device_id: string }[]>(
        `SELECT em.device_id FROM env_mappings em
         WHERE em.group_id = $1 AND em.role_key = 'internal_temp' AND em.source_type = 'sensor'
         LIMIT 1`,
        [batch.groupId],
      );
      if (devRows.length > 0) {
        const sRows = await this.dataSource.query<{ day: string; avg_temp: string; hours_covered: string }[]>(
          `SELECT (DATE_TRUNC('day', time))::date::text AS day,
                  AVG(value::numeric) AS avg_temp,
                  COUNT(DISTINCT DATE_TRUNC('hour', time)) AS hours_covered
           FROM sensor_data
           WHERE device_id = $1 AND sensor_type = 'temperature' AND time >= $2::date
           GROUP BY 1`,
          [devRows[0].device_id, sowing],
        );
        for (const r of sRows) {
          sensorMap.set(r.day, { avg: parseFloat(r.avg_temp), hours: parseInt(r.hours_covered, 10) });
        }
      }
    }

    // 파종일 ~ 오늘 일별 순회 (UTC 기준 달력일)
    const series: Array<{ date: string; dailyGdd: number; source: 'sensor' | 'weather' | 'normal' }> = [];
    const todayStr = new Date().toISOString().slice(0, 10);
    const cur = new Date(`${sowing}T00:00:00.000Z`);
    for (let guard = 0; guard < 2000; guard++) {
      const dateStr = cur.toISOString().slice(0, 10);
      if (dateStr > todayStr) break;
      const month = cur.getUTCMonth() + 1;
      const dayOffset = transplant && dateStr < transplant ? NURSERY_OFFSET : offset;

      const s = sensorMap.get(dateStr);
      const w = weatherMap.get(dateStr);
      const n = normals[month];

      let temp: number | null = null;
      let src: 'sensor' | 'weather' | 'normal' = 'weather';
      if (s && s.hours >= 12) {
        temp = s.avg; // 실내 센서 충분 커버 → 오프셋 없이 그대로
        src = 'sensor';
      } else if (s && w != null) {
        // 부분 커버: 센서 실측 + 나머지 시간은 외기(+오프셋) 추정
        temp = (s.avg * s.hours + (w + dayOffset) * (24 - s.hours)) / 24;
        src = 'sensor';
      } else if (s) {
        temp = s.avg;
        src = 'sensor';
      } else if (w != null) {
        temp = w + dayOffset;
        src = 'weather';
      } else if (n != null) {
        temp = n + dayOffset; // 백필: 기후 정규값 + 오프셋
        src = 'normal';
      } else {
        cur.setUTCDate(cur.getUTCDate() + 1);
        continue; // 데이터 전무한 날은 스킵
      }

      series.push({ date: dateStr, dailyGdd: Math.max(temp - baseTemp, 0), source: src });
      cur.setUTCDate(cur.getUTCDate() + 1);
    }

    return series;
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
    dailyPoints: Array<{ date: string; cumulativeGdd: number; dailyGdd: number; source: 'sensor' | 'weather' | 'normal' }>;
    milestones: Array<{ gddThreshold: number; title: string; milestoneType: string; priority: string; reachedDate: string | null; estimatedDate: string | null }>;
    estimatedHarvestDate: string;
    backfilledDays: number;
    totalDays: number;
  }> {
    const { source, offset } = await this.resolveSource(batch);
    const targetGdd = batch.targetGdd ?? CROP_TARGET_GDD[batch.cropType] ?? 1200;

    // 일별 GDD 시리즈 — 파종일부터, 결측 구간은 기후 정규값으로 백필 (calculateGdd 와 동일 경로)
    const useSensor = source === 'sensor' || source === 'sensor_with_gap_fill';
    const series = await this.buildElapsedDailyGdd(batch, offset, { useSensor });

    // 누적 GDD 계산
    let cumulative = 0;
    const dailyPoints = series.map(r => {
      cumulative += r.dailyGdd;
      return {
        date: r.date,
        cumulativeGdd: Math.round(cumulative * 10) / 10,
        dailyGdd: Math.round(r.dailyGdd * 10) / 10,
        source: r.source,
      };
    });

    const currentGdd = cumulative;
    const backfilledDays = series.filter(r => r.source === 'normal').length;

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
      backfilledDays,
      totalDays: series.length,
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
