import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SensorAlert } from './entities/sensor-alert.entity';
import { SensorStandby } from './entities/sensor-standby.entity';
import { Device } from '../devices/entities/device.entity';
import {
  SENSOR_ALERT_RULES, AlertRuleParams,
  NO_DATA_WARNING_MINUTES, NO_DATA_CRITICAL_MINUTES,
  FLATLINE_WINDOW_HOURS, ACTION_GUIDES,
  FLAPPING_WINDOW_HOURS, FLAPPING_THRESHOLD,
} from './sensor-alert-rules';

@Injectable()
export class SensorAlertsService {
  private readonly logger = new Logger(SensorAlertsService.name);

  constructor(
    @InjectRepository(SensorAlert) private alertRepo: Repository<SensorAlert>,
    @InjectRepository(SensorStandby) private standbyRepo: Repository<SensorStandby>,
    @InjectRepository(Device) private deviceRepo: Repository<Device>,
    private dataSource: DataSource,
  ) {}

  // ── 센서 목록 + 대기 관리 ──

  async getSensorsWithStatus(userId: string) {
    const rows: any[] = await this.dataSource.query(`
      SELECT DISTINCT ON (sd.device_id, sd.sensor_type)
        sd.device_id, sd.sensor_type, sd.value, sd.unit, sd.time,
        d.name as device_name,
        CASE WHEN ss.id IS NOT NULL THEN true ELSE false END as standby
      FROM sensor_data sd
      JOIN devices d ON d.id = sd.device_id
      LEFT JOIN sensor_standby ss
        ON ss.device_id = sd.device_id
        AND ss.sensor_type = sd.sensor_type
        AND ss.user_id = $1
      WHERE sd.user_id = $1
      ORDER BY sd.device_id, sd.sensor_type, sd.time DESC
    `, [userId]);

    return rows.map(r => ({
      deviceId: r.device_id,
      deviceName: r.device_name,
      sensorType: r.sensor_type,
      latestValue: r.value != null ? Number(r.value) : null,
      unit: r.unit || '',
      lastSeen: r.time ? new Date(r.time).toISOString() : null,
      standby: r.standby,
    }));
  }

  async addStandby(userId: string, deviceId: string, sensorType: string) {
    const existing = await this.standbyRepo.findOne({
      where: { userId, deviceId, sensorType },
    });
    if (existing) return existing;

    // 해당 센서의 미해결 알림 일괄 해결
    await this.alertRepo.update(
      { deviceId, sensorType, resolved: false },
      { resolved: true, resolvedAt: new Date() },
    );

    const entry = this.standbyRepo.create({ userId, deviceId, sensorType });
    return this.standbyRepo.save(entry);
  }

  async removeStandby(userId: string, deviceId: string, sensorType: string) {
    await this.standbyRepo.delete({ userId, deviceId, sensorType });
    return { success: true };
  }

  // ── 알림 CRUD ──

  async findAll(userId: string, filters: { severity?: string; resolved?: boolean; deviceId?: string }) {
    const qb = this.alertRepo.createQueryBuilder('a')
      .where('a.user_id = :userId', { userId })
      .andWhere('(a.snoozed_until IS NULL OR a.snoozed_until < NOW())')
      // 대기 목록에 있는 센서의 알림 제외
      .andWhere(`NOT EXISTS (
        SELECT 1 FROM sensor_standby ss
        WHERE ss.user_id = a.user_id
          AND ss.device_id = a.device_id
          AND ss.sensor_type = a.sensor_type
      )`)
      .orderBy('a.created_at', 'DESC');

    if (filters.severity) qb.andWhere('a.severity = :severity', { severity: filters.severity });
    if (filters.resolved !== undefined) qb.andWhere('a.resolved = :resolved', { resolved: filters.resolved });
    if (filters.deviceId) qb.andWhere('a.device_id = :deviceId', { deviceId: filters.deviceId });

    return qb.getMany();
  }

  async findOneWithStats(userId: string, id: string) {
    const alert = await this.alertRepo.findOneOrFail({ where: { id, userId } });

    // 24h 통계 조회
    const stats = await this.dataSource.query(`
      SELECT
        MIN(value) as min_value,
        MAX(value) as max_value,
        MAX(value) - MIN(value) as delta,
        (SELECT value FROM sensor_data
         WHERE device_id = $1 AND sensor_type = $2
         ORDER BY time DESC LIMIT 1) as last_value
      FROM sensor_data
      WHERE device_id = $1 AND sensor_type = $2 AND time >= NOW() - INTERVAL '24 hours'
    `, [alert.deviceId, alert.sensorType]);

    return {
      ...alert,
      stats24h: stats[0] || null,
      actionGuides: ACTION_GUIDES[alert.alertType] || [],
    };
  }

  async resolve(userId: string, id: string) {
    await this.alertRepo.update({ id, userId }, { resolved: true, resolvedAt: new Date() });
    return this.alertRepo.findOneOrFail({ where: { id } });
  }

  async remove(userId: string, id: string) {
    await this.alertRepo.delete({ id, userId });
    return { success: true };
  }

  async snooze(userId: string, id: string, days: number) {
    const until = new Date();
    until.setDate(until.getDate() + (days || 1));
    await this.alertRepo.update({ id, userId }, { snoozedUntil: until });
    return this.alertRepo.findOneOrFail({ where: { id } });
  }

  // ── 크론: 이상 감지 ──

  @Cron(CronExpression.EVERY_5_MINUTES)
  async detectAnomalies() {
    const devices = await this.deviceRepo.find({
      where: { deviceType: 'sensor' },
      select: ['id', 'userId', 'name'],
    });

    // 대기 목록 전체 로드 (센서별 체크 시 사용)
    const standbyList = await this.standbyRepo.find();
    const standbySet = new Set(
      standbyList.map(s => `${s.userId}:${s.deviceId}:${s.sensorType}`),
    );

    for (const device of devices) {
      await this.checkDevice(device, standbySet);
    }

    // 조건이 정상으로 복귀한 알림 자동 해제
    await this.autoResolveAlerts(standbySet);

    // 알림/해제 반복(flapping) 감지
    await this.checkFlapping(standbySet);
  }

  private async checkDevice(
    device: { id: string; userId: string; name: string },
    standbySet: Set<string>,
  ) {
    const latestRows: { sensor_type: string; value: number; time: Date }[] =
      await this.dataSource.query(`
        SELECT DISTINCT ON (sensor_type) sensor_type, value, time
        FROM sensor_data
        WHERE device_id = $1
        ORDER BY sensor_type, time DESC
      `, [device.id]);

    // 장비가 실제로 보고하는 센서 타입만 체크 (없는 타입에 no_data 알림 방지)
    for (const row of latestRows) {
      const sensorType = row.sensor_type;
      const rule = SENSOR_ALERT_RULES[sensorType];
      if (!rule) continue; // 룰이 없는 센서 타입은 건너뛰기

      // 대기 목록에 있는 센서는 건너뛰기
      const key = `${device.userId}:${device.id}:${sensorType}`;
      if (standbySet.has(key)) continue;

      const latest = row;

      // 1) 데이터 없음 체크 (오래된 데이터)
      await this.checkNoData(device, sensorType, latest);

      // 2) 범위 이탈 체크
      await this.checkOutOfRange(device, sensorType, latest, rule);

      // 3) 급변 체크
      await this.checkSpike(device, sensorType, latest, rule);

      // 4) 값 고정 체크
      await this.checkFlatline(device, sensorType, latest, rule);
    }
  }

  // ── 개별 감지 로직 ──

  private async checkNoData(
    device: { id: string; userId: string; name: string },
    sensorType: string,
    latest: { time: Date } | undefined,
  ) {
    if (!latest) {
      await this.createAlertIfNotExists(device, sensorType, 'no_data', 'critical',
        `${sensorType} 데이터 수신 이력 없음`, null, '데이터 없음');
      return;
    }
    const minutesAgo = (Date.now() - new Date(latest.time).getTime()) / 60000;
    if (minutesAgo >= NO_DATA_CRITICAL_MINUTES) {
      await this.createAlertIfNotExists(device, sensorType, 'no_data', 'critical',
        `${Math.round(minutesAgo / 60)}시간 동안 데이터 수신 없음`, null,
        `>${NO_DATA_CRITICAL_MINUTES}분`);
    } else if (minutesAgo >= NO_DATA_WARNING_MINUTES) {
      await this.createAlertIfNotExists(device, sensorType, 'no_data', 'warning',
        `${Math.round(minutesAgo)}분 동안 데이터 수신 없음`, null,
        `>${NO_DATA_WARNING_MINUTES}분`);
    }
  }

  private async checkOutOfRange(
    device: { id: string; userId: string; name: string },
    sensorType: string,
    latest: { value: number },
    rule: AlertRuleParams,
  ) {
    const v = Number(latest.value);
    if (v < rule.min || v > rule.max) {
      const dir = v < rule.min ? '최소' : '최대';
      await this.createAlertIfNotExists(device, sensorType, 'out_of_range', 'critical',
        `${sensorType} 값 ${v}${rule.unit} — 물리적 ${dir} 범위(${rule.min}~${rule.max}) 이탈`,
        v, `${rule.min}~${rule.max}${rule.unit}`);
    }
  }

  private async checkSpike(
    device: { id: string; userId: string; name: string },
    sensorType: string,
    latest: { value: number },
    rule: AlertRuleParams,
  ) {
    const prev = await this.dataSource.query(`
      SELECT value FROM sensor_data
      WHERE device_id = $1 AND sensor_type = $2
        AND time BETWEEN NOW() - INTERVAL '15 minutes' AND NOW() - INTERVAL '5 minutes'
      ORDER BY time DESC LIMIT 1
    `, [device.id, sensorType]);

    if (prev.length === 0) return;
    const delta = Math.abs(Number(latest.value) - Number(prev[0].value));
    if (delta > rule.spikeThreshold) {
      await this.createAlertIfNotExists(device, sensorType, 'spike', 'warning',
        `${sensorType} 10분 내 ${delta.toFixed(1)}${rule.unit} 급변 (임계: ${rule.spikeThreshold}${rule.unit})`,
        Number(latest.value), `>${rule.spikeThreshold}${rule.unit}/10분`);
    }
  }

  private async checkFlatline(
    device: { id: string; userId: string; name: string },
    sensorType: string,
    latest: { value: number },
    rule: AlertRuleParams,
  ) {
    // 24시간 전체 구간의 MIN/MAX 범위로 판단 (두 점 비교 시 일일 주기 데이터에서 거짓 알림 발생)
    const stats = await this.dataSource.query(`
      SELECT MIN(value) as min_val, MAX(value) as max_val
      FROM sensor_data
      WHERE device_id = $1 AND sensor_type = $2
        AND time >= NOW() - INTERVAL '${FLATLINE_WINDOW_HOURS} hours'
    `, [device.id, sensorType]);

    if (stats.length === 0 || stats[0].min_val === null) return;
    const range = Number(stats[0].max_val) - Number(stats[0].min_val);
    if (range < rule.epsilon) {
      await this.createAlertIfNotExists(device, sensorType, 'flatline', 'warning',
        `${sensorType} ${FLATLINE_WINDOW_HOURS}시간 동안 변화량 ${range.toFixed(2)}${rule.unit} (임계: ${rule.epsilon}${rule.unit})`,
        Number(latest.value), `변화<${rule.epsilon}${rule.unit}/${FLATLINE_WINDOW_HOURS}h`);
    }
  }

  // ── flapping 감지: 6시간 내 no_data 알림/해제 반복 시 센서 점검 알림 ──

  private async checkFlapping(standbySet: Set<string>) {
    // 6시간 내 no_data 해제 이력이 있는 센서 목록 조회
    const flappingSensors: { device_id: string; sensor_type: string; user_id: string; cnt: string }[] =
      await this.dataSource.query(`
        SELECT device_id, sensor_type, user_id, COUNT(*) as cnt
        FROM sensor_alerts
        WHERE alert_type = 'no_data'
          AND resolved = true
          AND resolved_at >= NOW() - INTERVAL '${FLAPPING_WINDOW_HOURS} hours'
        GROUP BY device_id, sensor_type, user_id
        HAVING COUNT(*) >= ${FLAPPING_THRESHOLD}
      `);

    for (const row of flappingSensors) {
      const key = `${row.user_id}:${row.device_id}:${row.sensor_type}`;
      if (standbySet.has(key)) continue;

      // 이미 미해결 unstable 알림이 있으면 중복 생성 안 함
      const existing = await this.alertRepo.findOne({
        where: { deviceId: row.device_id, sensorType: row.sensor_type, alertType: 'unstable' as any, resolved: false },
      });
      if (existing) continue;

      // 장비 이름 조회
      const device = await this.deviceRepo.findOne({ where: { id: row.device_id }, select: ['id', 'userId', 'name'] });
      if (!device) continue;

      const alert = this.alertRepo.create({
        userId: row.user_id,
        deviceId: row.device_id,
        deviceName: device.name,
        sensorType: row.sensor_type,
        alertType: 'unstable' as any,
        severity: 'warning',
        message: `${row.sensor_type} 센서가 ${FLAPPING_WINDOW_HOURS}시간 내 ${row.cnt}회 데이터 끊김/복구 반복 — 센서를 점검하세요`,
        threshold: `${FLAPPING_WINDOW_HOURS}h 내 ${FLAPPING_THRESHOLD}회 이상`,
      });
      await this.alertRepo.save(alert);
      this.logger.warn(`[Flapping] ${device.name} / ${row.sensor_type}: ${row.cnt}회 반복`);
    }
  }

  // ── 자동 해제: 조건이 정상으로 복귀한 알림 ──

  private async autoResolveAlerts(standbySet: Set<string>) {
    const unresolvedAlerts = await this.alertRepo.find({
      where: { resolved: false },
    });

    for (const alert of unresolvedAlerts) {
      const key = `${alert.userId}:${alert.deviceId}:${alert.sensorType}`;

      // 대기 목록에 있는 센서의 알림은 즉시 자동 해제
      if (standbySet.has(key)) {
        await this.alertRepo.update(
          { id: alert.id },
          { resolved: true, resolvedAt: new Date() },
        );
        this.logger.log(
          `[Auto-Resolve] ${alert.deviceName} / ${alert.sensorType}: 대기 목록 센서 → 자동 해제`,
        );
        continue;
      }

      const isNormal = await this.isConditionNormal(alert);
      if (isNormal) {
        await this.alertRepo.update(
          { id: alert.id },
          { resolved: true, resolvedAt: new Date() },
        );
        this.logger.log(
          `[Auto-Resolve] ${alert.deviceName} / ${alert.sensorType} / ${alert.alertType}: 정상 복귀 확인`,
        );
      }
    }
  }

  private async isConditionNormal(alert: SensorAlert): Promise<boolean> {
    const rule = SENSOR_ALERT_RULES[alert.sensorType];
    if (!rule) return false;

    // 최신 데이터 조회
    const latestRows = await this.dataSource.query(`
      SELECT value, time FROM sensor_data
      WHERE device_id = $1 AND sensor_type = $2
      ORDER BY time DESC LIMIT 1
    `, [alert.deviceId, alert.sensorType]);

    const latest = latestRows[0];

    switch (alert.alertType) {
      case 'no_data': {
        // 데이터가 다시 수신되고 있으면 정상
        if (!latest) return false;
        const minutesAgo = (Date.now() - new Date(latest.time).getTime()) / 60000;
        return minutesAgo < NO_DATA_WARNING_MINUTES;
      }

      case 'out_of_range': {
        // 값이 정상 범위 안으로 돌아오면 정상
        if (!latest) return false;
        const v = Number(latest.value);
        return v >= rule.min && v <= rule.max;
      }

      case 'spike': {
        // 최근 10분간 급변이 없으면 정상
        if (!latest) return false;
        const prev = await this.dataSource.query(`
          SELECT value FROM sensor_data
          WHERE device_id = $1 AND sensor_type = $2
            AND time BETWEEN NOW() - INTERVAL '15 minutes' AND NOW() - INTERVAL '5 minutes'
          ORDER BY time DESC LIMIT 1
        `, [alert.deviceId, alert.sensorType]);
        // 비교 데이터 없으면 알림 생성 후 30분 경과 시 자동 해제
        if (prev.length === 0) {
          const alertAge = (Date.now() - new Date(alert.createdAt).getTime()) / 60000;
          return alertAge > 30;
        }
        const delta = Math.abs(Number(latest.value) - Number(prev[0].value));
        return delta <= rule.spikeThreshold;
      }

      case 'flatline': {
        // 감지와 동일한 24시간 윈도우로 판단 (감지/해제 기준 일치)
        if (!latest) return false;
        const recentStats = await this.dataSource.query(`
          SELECT MIN(value) as min_val, MAX(value) as max_val
          FROM sensor_data
          WHERE device_id = $1 AND sensor_type = $2
            AND time >= NOW() - INTERVAL '${FLATLINE_WINDOW_HOURS} hours'
        `, [alert.deviceId, alert.sensorType]);
        if (recentStats.length === 0 || recentStats[0].min_val === null) return false;
        const range = Number(recentStats[0].max_val) - Number(recentStats[0].min_val);
        return range >= rule.epsilon;
      }

      case 'unstable': {
        // 6시간 내 no_data 해제 횟수가 임계값 미만이면 안정화로 판단
        const resolvedCount = await this.dataSource.query(`
          SELECT COUNT(*) as cnt FROM sensor_alerts
          WHERE device_id = $1 AND sensor_type = $2
            AND alert_type = 'no_data' AND resolved = true
            AND resolved_at >= NOW() - INTERVAL '${FLAPPING_WINDOW_HOURS} hours'
        `, [alert.deviceId, alert.sensorType]);
        return Number(resolvedCount[0].cnt) < FLAPPING_THRESHOLD;
      }

      default:
        return false;
    }
  }

  // ── 중복 방지 ──

  private async createAlertIfNotExists(
    device: { id: string; userId: string; name: string },
    sensorType: string,
    alertType: string,
    severity: string,
    message: string,
    value: number | null,
    threshold: string,
  ) {
    const existing = await this.alertRepo.findOne({
      where: {
        deviceId: device.id,
        sensorType,
        alertType: alertType as any,
        resolved: false,
      },
    });
    if (existing) return;

    const alert = this.alertRepo.create({
      userId: device.userId,
      deviceId: device.id,
      deviceName: device.name,
      sensorType,
      alertType: alertType as any,
      severity: severity as any,
      message,
      value: value ?? undefined,
      threshold,
    });
    await this.alertRepo.save(alert);
    this.logger.warn(`[Alert] ${device.name} / ${sensorType}: ${message}`);
  }
}
