import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { HarvestTaskLog } from './entities/harvest-task-log.entity';
import { CropBatch } from '../harvest/entities/crop-batch.entity';
import { Device } from '../devices/entities/device.entity';
import { CreateTaskLogDto } from './dto/create-task-log.dto';

// ── 강원도 횡성군 군내면 기준 작업 타입 설정 ──
interface StageInterval { intervalMin: number; intervalMax: number; }
interface TaskConfigEntry {
  name: string; icon: string;
  // 첫 작업 시기 (정식일 기준 / 파종일 기준)
  firstAfterTransplantMin: number; firstAfterTransplantMax: number;
  firstAfterSowMin: number; firstAfterSowMax: number;
  // 단계별 반복 간격
  stageIntervals: Record<string, StageInterval>;
  // 기본 간격 (단계 매칭 안 될 때)
  intervalDays: number; intervalMin: number; intervalMax: number;
  effectDuration: number;
  description: string;
}

const TASK_CONFIG: Record<string, TaskConfigEntry> = {
  training: {
    name: '유인 작업', icon: '🌿',
    firstAfterTransplantMin: 7, firstAfterTransplantMax: 10,
    firstAfterSowMin: 30, firstAfterSowMax: 40,
    stageIntervals: {
      vegetative:      { intervalMin: 5,  intervalMax: 7 },
      flowering_fruit: { intervalMin: 7,  intervalMax: 10 },
      harvest:         { intervalMin: 10, intervalMax: 14 },
    },
    intervalDays: 7, intervalMin: 5, intervalMax: 10, effectDuration: 5,
    description: '줄기를 지지대에 유인하여 수광량 확보 및 통풍 개선',
  },
  leaf_removal: {
    name: '하엽 제거', icon: '🍃',
    firstAfterTransplantMin: 14, firstAfterTransplantMax: 21,
    firstAfterSowMin: 45, firstAfterSowMax: 55,
    stageIntervals: {
      vegetative:      { intervalMin: 10, intervalMax: 14 },
      flowering_fruit: { intervalMin: 7,  intervalMax: 10 },
      harvest:         { intervalMin: 5,  intervalMax: 7 },
    },
    intervalDays: 10, intervalMin: 7, intervalMax: 14, effectDuration: 7,
    description: '노화 하엽 제거로 통풍 개선 및 병해 예방',
  },
  pesticide: {
    name: '병충해 방제', icon: '🧴',
    firstAfterTransplantMin: 7, firstAfterTransplantMax: 14,
    firstAfterSowMin: 30, firstAfterSowMax: 40,
    stageIntervals: {
      vegetative:      { intervalMin: 10, intervalMax: 14 },
      flowering_fruit: { intervalMin: 10, intervalMax: 14 },
      harvest:         { intervalMin: 14, intervalMax: 21 },
    },
    intervalDays: 12, intervalMin: 10, intervalMax: 14, effectDuration: 12,
    description: '예방적 방제로 잿빛곰팡이·흰가루병·진딧물 등 억제',
  },
};

const TASK_TYPES = ['leaf_removal', 'training', 'pesticide'] as const;

// ── 환경 데이터 타입 ──
export interface EnvData {
  temperature: number | null;
  humidity: number | null;
  dewPoint: number | null;
  vpdValue: number | null;
  vpdStatus: string | null;
  condensationLevel: string | null;
  highHumidityHours: number;
}

@Injectable()
export class HarvestRecService {
  private readonly logger = new Logger(HarvestRecService.name);

  constructor(
    @InjectRepository(HarvestTaskLog)
    private readonly logRepo: Repository<HarvestTaskLog>,
    @InjectRepository(CropBatch)
    private readonly batchRepo: Repository<CropBatch>,
    @InjectRepository(Device)
    private readonly deviceRepo: Repository<Device>,
    private readonly dataSource: DataSource,
  ) {}

  // ══════════════════════════════════════
  // GET /harvest-rec/recommendations
  // ══════════════════════════════════════
  async getRecommendations(userId: string) {
    // 1) 활성 배치
    const batch = await this.batchRepo.findOne({
      where: { userId, status: 'active' },
      order: { createdAt: 'DESC' },
    });

    if (!batch) {
      return {
        summary: { status: 'good', statusLabel: '배치 없음', mainReason: '활성 배치를 등록하세요', subInfo: '' },
        cards: [],
        environment: this.emptyEnv(),
        activeBatch: null,
      };
    }

    // 2) 센서 데이터 (독립 쿼리)
    const env = await this.getEnvironmentData(userId);

    // 3) 작업 이력
    const lastDoneMap = await this.getLastDoneMap(batch.id);

    // 4) 카드 생성
    const todayRef = new Date(); todayRef.setHours(0, 0, 0, 0);
    // 작업 기준일: 정식일이 있으면 정식일, 없으면 파종일
    const taskRefDate = batch.transplantDate || batch.sowDate;
    const taskRef = new Date(taskRefDate); taskRef.setHours(0, 0, 0, 0);
    const taskRefNotReached = taskRef > todayRef;

    const cards = TASK_TYPES.map(taskType => {
      const config = TASK_CONFIG[taskType];
      const lastDone = lastDoneMap.get(taskType) ?? null;
      const daysSinceLast = lastDone
        ? Math.floor((Date.now() - new Date(lastDone).getTime()) / 86400000)
        : null;

      // 단계별 간격 적용
      const stageInterval = config.stageIntervals[batch.currentStage];
      const activeIntervalMin = stageInterval?.intervalMin ?? config.intervalMin;
      const activeIntervalMax = stageInterval?.intervalMax ?? config.intervalMax;
      const activeIntervalDays = Math.round((activeIntervalMin + activeIntervalMax) / 2);

      // 작업 기준일(정식일 또는 파종일)이 미래면 아직 작업 불필요
      const priorityScore = taskRefNotReached ? 0 : this.calcPriorityScore(taskType, daysSinceLast, env, batch.currentStage);
      const riskScore = taskRefNotReached ? 0 : this.calcRiskScore(env, daysSinceLast, activeIntervalDays);
      const delayRatio = taskRefNotReached ? 0 : this.calcDelayRatio(daysSinceLast, activeIntervalMax);
      const window = this.calcRecommendedWindow(daysSinceLast, config, batch.currentStage, batch.sowDate, batch.transplantDate);
      const reasons = this.generateReasons(taskType, daysSinceLast, env, batch.currentStage, activeIntervalDays);
      const status = this.determineStatus(priorityScore, riskScore, delayRatio, window.start);
      const effectRemaining = daysSinceLast != null
        ? Math.max(0, config.effectDuration - daysSinceLast)
        : null;

      return {
        taskType,
        taskName: config.name,
        icon: config.icon,
        priorityScore,
        riskScore,
        delayRatio: Math.round(delayRatio * 100) / 100,
        daysSinceLast,
        recommendedWindowStart: window.start,
        recommendedWindowEnd: window.end,
        status,
        reasons,
        effectRemaining: effectRemaining && effectRemaining > 0 ? effectRemaining : null,
        lastCompletedAt: lastDone ? new Date(lastDone).toISOString() : null,
      };
    });

    // priority_score DESC 정렬
    cards.sort((a, b) => b.priorityScore - a.priorityScore);

    // 5) 요약 배너
    const maxScore = Math.max(...cards.map(c => c.priorityScore));
    const topCard = cards[0];
    const summaryStatus = maxScore >= 70 ? 'warning' : maxScore >= 40 ? 'caution' : 'good';
    const statusLabels = { good: '수확 품질 양호', caution: '수확 품질 주의', warning: '수확 품질 위험' };

    let mainReason = '환경 양호 — 정기 관리만 유지하세요';
    let subInfo = '';
    if (topCard && topCard.reasons.length > 0) {
      mainReason = topCard.reasons[0];
      if (topCard.reasons.length > 1) subInfo = topCard.reasons[1];
    }
    if (env.highHumidityHours >= 1 && !subInfo) {
      subInfo = `최근 6시간 고습 ${env.highHumidityHours}시간 지속`;
    }

    return {
      summary: { status: summaryStatus, statusLabel: statusLabels[summaryStatus], mainReason, subInfo },
      cards,
      environment: {
        temperature: env.temperature,
        humidity: env.humidity,
        dewPoint: env.dewPoint,
        vpdValue: env.vpdValue,
        vpdStatus: env.vpdStatus,
        condensationLevel: env.condensationLevel,
        highHumidityHours: env.highHumidityHours,
      },
      activeBatch: {
        id: batch.id,
        cropName: batch.cropName,
        variety: batch.variety,
        currentStage: batch.currentStage,
        sowDate: batch.sowDate,
        transplantDate: batch.transplantDate,
        growDays: batch.growDays,
        groupId: batch.groupId,
        memo: batch.memo,
        status: batch.status,
      },
    };
  }

  // ══════════════════════════════════════
  // POST /harvest-rec/task-logs
  // ══════════════════════════════════════
  async createTaskLog(userId: string, dto: CreateTaskLogDto) {
    const batch = await this.batchRepo.findOne({ where: { id: dto.batchId, userId } });
    if (!batch) throw new Error('배치를 찾을 수 없습니다.');

    const log = this.logRepo.create({
      batchId: dto.batchId,
      userId,
      taskType: dto.taskType,
      completedAt: new Date(),
    });
    return this.logRepo.save(log);
  }

  // ══════════════════════════════════════
  // GET /harvest-rec/task-logs
  // ══════════════════════════════════════
  async getTaskLogs(userId: string, batchId?: string) {
    const where: any = { userId };
    if (batchId) where.batchId = batchId;
    return this.logRepo.find({ where, order: { completedAt: 'DESC' }, take: 50 });
  }

  // ──────────────────────────────────────
  // Private: 환경 데이터 조회
  // ──────────────────────────────────────
  private async getEnvironmentData(userId: string): Promise<EnvData> {
    const empty = this.emptyEnv();

    // QXJ 디바이스 조회
    const devices = await this.deviceRepo
      .createQueryBuilder('d')
      .select('d.id')
      .where('d.userId = :userId', { userId })
      .andWhere('d.category LIKE :cat', { cat: '%qxj%' })
      .getMany();

    const deviceIds = devices.map(d => d.id);
    if (deviceIds.length === 0) return empty;

    // 최신 센서값
    const latest: any[] = await this.dataSource.query(
      `SELECT DISTINCT ON (sensor_type) sensor_type, value
       FROM sensor_data
       WHERE device_id = ANY($1)
         AND sensor_type IN ('temperature', 'humidity', 'dew_point')
       ORDER BY sensor_type, time DESC`,
      [deviceIds],
    );

    const sMap = new Map(latest.map(r => [r.sensor_type, Number(r.value)]));
    const temp = sMap.get('temperature') ?? null;
    const hum = sMap.get('humidity') ?? null;
    const dew = sMap.get('dew_point') ?? null;

    // VPD 계산
    let vpdValue: number | null = null;
    let vpdStatus: string | null = null;
    if (temp != null && hum != null) {
      const es = 0.6108 * Math.exp((17.27 * temp) / (temp + 237.3));
      vpdValue = Math.round(es * (1 - hum / 100) * 100) / 100;
      if (vpdValue < 0.4) vpdStatus = 'LOW';
      else if (vpdValue > 1.4) vpdStatus = 'HIGH';
      else vpdStatus = 'OK';
    }

    // 결로 등급
    let condensationLevel: string | null = null;
    if (temp != null && dew != null) {
      const margin = temp - dew;
      if (margin < 1) condensationLevel = 'critical';
      else if (margin < 2) condensationLevel = 'danger';
      else if (margin < 4) condensationLevel = 'warning';
      else condensationLevel = 'safe';
    }

    // 6시간 습도 트렌드 → 고습 시간 계산
    let highHumidityHours = 0;
    try {
      const trend: any[] = await this.dataSource.query(
        `SELECT value FROM sensor_data
         WHERE device_id = ANY($1)
           AND sensor_type = 'humidity'
           AND time >= NOW() - INTERVAL '6 hours'
         ORDER BY time ASC`,
        [deviceIds],
      );
      if (trend.length >= 2) {
        const highCount = trend.filter(r => Number(r.value) > 80).length;
        highHumidityHours = Math.round((highCount / trend.length) * 6 * 10) / 10;
      }
    } catch (e) {
      this.logger.warn('Failed to query humidity trend', e);
    }

    return { temperature: temp, humidity: hum, dewPoint: dew, vpdValue, vpdStatus, condensationLevel, highHumidityHours };
  }

  // ──────────────────────────────────────
  // Private: 마지막 완료일 맵
  // ──────────────────────────────────────
  private async getLastDoneMap(batchId: string): Promise<Map<string, Date>> {
    const rows: any[] = await this.dataSource.query(
      `SELECT task_type, MAX(completed_at) as last_done
       FROM harvest_task_logs
       WHERE batch_id = $1
       GROUP BY task_type`,
      [batchId],
    );
    return new Map(rows.map(r => [r.task_type, r.last_done]));
  }

  // ──────────────────────────────────────
  // Private: priority_score (0~100)
  // ──────────────────────────────────────
  private calcPriorityScore(taskType: string, daysSinceLast: number | null, env: EnvData, stage: string): number {
    const config = TASK_CONFIG[taskType];
    const si = config.stageIntervals[stage];
    const interval = si ? Math.round((si.intervalMin + si.intervalMax) / 2) : config.intervalDays;

    // 1) 주기 기반 (0~35)
    let baseCycleScore = 20; // 한 번도 안 한 경우
    if (daysSinceLast != null) {
      const ratio = daysSinceLast / interval;
      if (ratio < 0.5) baseCycleScore = ratio * 20;
      else if (ratio <= 1.0) baseCycleScore = 10 + (ratio - 0.5) * 30;
      else baseCycleScore = Math.min(35, 25 + (ratio - 1) * 10);
    }

    // 2) 환경 가중 (0~35)
    const condBonus = this.getCondensationBonus(env.condensationLevel);
    let envMod = 0;
    if (taskType === 'leaf_removal') {
      envMod = Math.min(35, env.highHumidityHours * 5 + condBonus);
    } else if (taskType === 'training') {
      const vpdBonus = env.vpdStatus === 'LOW' ? 15 : 0;
      const humBonus = (env.humidity ?? 0) > 80 ? 10 : (env.humidity ?? 0) > 70 ? 5 : 0;
      envMod = Math.min(35, vpdBonus + humBonus);
    } else if (taskType === 'pesticide') {
      envMod = Math.min(35, env.highHumidityHours * 8 + condBonus * 1.5);
    }

    // 3) 생육 단계 (0~10)
    const stageMod = stage === 'harvest' ? 10 : stage === 'flowering_fruit' ? 5 : 0;

    // 4) 효과 감경 (0~15)
    let effectMod = 0;
    if (daysSinceLast != null && daysSinceLast < config.effectDuration) {
      effectMod = 15 * ((config.effectDuration - daysSinceLast) / config.effectDuration);
    }

    return Math.round(Math.max(0, Math.min(100, baseCycleScore + envMod + stageMod - effectMod)));
  }

  // ──────────────────────────────────────
  // Private: risk_score (0~100)
  // ──────────────────────────────────────
  private calcRiskScore(env: EnvData, daysSinceLast: number | null, interval: number): number {
    const humidityRisk = Math.min(40, env.highHumidityHours * 7);
    const condRisk = this.getCondensationBonus(env.condensationLevel) * 2; // 0~30
    const vpdRisk = env.vpdStatus === 'LOW' ? 15 : env.vpdStatus === 'HIGH' ? 10 : 0;

    let delayRisk = 0;
    if (daysSinceLast != null) {
      const overdue = Math.max(0, daysSinceLast - interval);
      delayRisk = Math.min(15, overdue * 3);
    }

    return Math.round(Math.max(0, Math.min(100, humidityRisk + condRisk + vpdRisk + delayRisk)));
  }

  // ──────────────────────────────────────
  // Private: delayRatio
  // ──────────────────────────────────────
  private calcDelayRatio(daysSinceLast: number | null, intervalMax: number): number {
    if (daysSinceLast == null) return 0;
    const overdue = Math.max(0, daysSinceLast - intervalMax);
    return overdue / intervalMax;
  }

  // ──────────────────────────────────────
  // Private: 권장 기간 (정식일 우선, 없으면 파종일 기준)
  // ──────────────────────────────────────
  private calcRecommendedWindow(
    daysSinceLast: number | null,
    config: TaskConfigEntry,
    stage: string,
    sowDate?: string,
    transplantDate?: string | null,
  ) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 단계별 간격
    const si = config.stageIntervals[stage];
    const iMin = si?.intervalMin ?? config.intervalMin;
    const iMax = si?.intervalMax ?? config.intervalMax;

    if (daysSinceLast == null) {
      // 작업 이력 없음 → 첫 작업 권장 기간 계산
      let firstMin: number;
      let firstMax: number;
      let ref: Date;

      if (transplantDate) {
        // 정식일 기준
        ref = new Date(transplantDate);
        firstMin = config.firstAfterTransplantMin;
        firstMax = config.firstAfterTransplantMax;
      } else if (sowDate) {
        // 파종일 기준
        ref = new Date(sowDate);
        firstMin = config.firstAfterSowMin;
        firstMax = config.firstAfterSowMax;
      } else {
        ref = today;
        firstMin = iMin;
        firstMax = iMax;
      }
      ref.setHours(0, 0, 0, 0);

      const start = new Date(ref); start.setDate(start.getDate() + firstMin);
      const end = new Date(ref); end.setDate(end.getDate() + firstMax);

      if (end < today) {
        return { start: this.fmt(today), end: this.fmt(today) };
      }
      if (start < today) {
        return { start: this.fmt(today), end: this.fmt(end) };
      }
      return { start: this.fmt(start), end: this.fmt(end) };
    }

    // 이력 있음 → 단계별 간격 적용
    const daysUntilMin = Math.max(0, iMin - daysSinceLast);
    const daysUntilMax = Math.max(0, iMax - daysSinceLast);
    const start = new Date(today); start.setDate(start.getDate() + daysUntilMin);
    const end = new Date(today); end.setDate(end.getDate() + daysUntilMax);
    return { start: this.fmt(start), end: this.fmt(end) };
  }

  // ──────────────────────────────────────
  // Private: 상태 판정
  // ──────────────────────────────────────
  private determineStatus(priorityScore: number, riskScore: number, delayRatio: number, windowStart: string): string {
    if (riskScore >= 75) return 'URGENT';
    if (delayRatio >= 0.5) return 'DELAYED';
    const today = new Date();
    const start = new Date(windowStart);
    const diff = Math.ceil((start.getTime() - today.getTime()) / 86400000);
    if (diff <= 1 && diff >= 0) return 'UPCOMING';
    return 'NORMAL';
  }

  // ──────────────────────────────────────
  // Private: 추천 사유
  // ──────────────────────────────────────
  private generateReasons(taskType: string, daysSinceLast: number | null, env: EnvData, stage: string, interval: number): string[] {
    const reasons: string[] = [];

    if (env.highHumidityHours >= 3) {
      reasons.push(`최근 6시간 고습 ${env.highHumidityHours}시간 지속`);
    } else if (env.highHumidityHours >= 1) {
      reasons.push(`고습 환경 감지 (${env.highHumidityHours}시간)`);
    }

    if (env.condensationLevel === 'critical' || env.condensationLevel === 'danger') {
      reasons.push('결로 위험 증가 감지');
    }

    if (env.vpdStatus === 'LOW') {
      reasons.push('과습으로 곰팡이 위험 상승');
    } else if (env.vpdStatus === 'HIGH') {
      reasons.push('건조 스트레스 감지');
    }

    if (daysSinceLast != null && daysSinceLast > interval * 1.2) {
      reasons.push(`작업 주기 초과 (${daysSinceLast}일 경과)`);
    } else if (daysSinceLast == null) {
      reasons.push('첫 작업 필요');
    }

    if (stage === 'harvest') {
      reasons.push('수확기 품질 관리 강화 권장');
    }

    if (reasons.length === 0) {
      reasons.push('정기 관리 권장');
    }

    return reasons;
  }

  // ── Helpers ──
  private getCondensationBonus(level: string | null): number {
    if (level === 'critical') return 15;
    if (level === 'danger') return 10;
    if (level === 'warning') return 5;
    return 0;
  }

  private emptyEnv(): EnvData {
    return { temperature: null, humidity: null, dewPoint: null, vpdValue: null, vpdStatus: null, condensationLevel: null, highHumidityHours: 0 };
  }

  private fmt(d: Date): string {
    return d.toISOString().slice(0, 10);
  }
}
