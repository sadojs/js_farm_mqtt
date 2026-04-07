import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThanOrEqual } from 'typeorm';
import { AutomationRule } from './entities/automation-rule.entity';
import { CreateRuleDto, UpdateRuleDto } from './dto/create-rule.dto';
import { AutomationLog } from './entities/automation-log.entity';
import { AutomationRunnerService } from './automation-runner.service';
import { IrrigationSchedulerService } from './irrigation-scheduler.service';
import { DevicesService } from '../devices/devices.service';
import { Device } from '../devices/entities/device.entity';
import { TuyaProject } from '../users/entities/tuya-project.entity';
import { TuyaService } from '../integrations/tuya/tuya.service';
import { decryptTuyaSecret } from '../../common/utils/crypto.util';

@Injectable()
export class AutomationService {
  private readonly logger = new Logger(AutomationService.name);

  constructor(
    @InjectRepository(AutomationRule) private rulesRepo: Repository<AutomationRule>,
    @InjectRepository(AutomationLog) private logsRepo: Repository<AutomationLog>,
    @InjectRepository(Device) private devicesRepo: Repository<Device>,
    @InjectRepository(TuyaProject) private tuyaRepo: Repository<TuyaProject>,
    private readonly runnerService: AutomationRunnerService,
    private readonly irrigationScheduler: IrrigationSchedulerService,
    private readonly devicesService: DevicesService,
    private readonly tuyaService: TuyaService,
  ) {}

  async findAll(userId: string) {
    const rules = await this.rulesRepo.find({
      where: { userId },
      order: { priority: 'DESC', createdAt: 'DESC' },
    });
    return rules.map((rule) => this.withTarget(rule));
  }

  async create(userId: string, dto: CreateRuleDto) {
    this.validateIrrigationConditions(dto.conditions);
    const conditionsWithTarget = this.prepareConditions(dto.conditions, dto.houseId);
    const ruleType = this.determineRuleType(conditionsWithTarget);
    const rule = this.rulesRepo.create({
      userId,
      groupId: dto.groupId,
      name: dto.name,
      description: dto.description,
      ruleType,
      conditions: conditionsWithTarget,
      actions: dto.actions,
      priority: dto.priority ?? 0,
    });
    const saved = await this.rulesRepo.save(rule);
    return this.withTarget(saved);
  }

  async update(id: string, userId: string, dto: UpdateRuleDto) {
    const rule = await this.rulesRepo.findOne({ where: { id, userId } });
    if (!rule) throw new NotFoundException();

    if (dto.name !== undefined) rule.name = dto.name;
    if (dto.description !== undefined) rule.description = dto.description;
    if (dto.groupId !== undefined) rule.groupId = dto.groupId;
    const nextHouseId = dto.houseId ?? rule.conditions?.target?.houseId;
    if (dto.conditions !== undefined) {
      this.validateIrrigationConditions(dto.conditions);
      rule.conditions = this.prepareConditions(dto.conditions, nextHouseId);
      rule.ruleType = this.determineRuleType(rule.conditions);
    } else if (dto.houseId !== undefined) {
      rule.conditions = this.prepareConditions(rule.conditions, dto.houseId);
    }
    if (dto.actions !== undefined) rule.actions = dto.actions;
    if (dto.priority !== undefined) rule.priority = dto.priority;

    const saved = await this.rulesRepo.save(rule);
    return this.withTarget(saved);
  }

  async toggle(id: string, userId: string, options?: { autoEnableRemote?: boolean }) {
    const rule = await this.rulesRepo.findOne({ where: { id, userId } });
    if (!rule) throw new NotFoundException();
    rule.enabled = !rule.enabled;
    const saved = await this.rulesRepo.save(rule);

    // FR-03: 관수 룰 활성화 시 원격제어 자동 ON
    let remoteControlEnabled = false;
    if (saved.enabled && options?.autoEnableRemote && (saved.conditions as any)?.type === 'irrigation') {
      const deviceIds = this.extractDeviceIds(saved.actions);
      for (const did of deviceIds) {
        const ok = await this.ensureRemoteControlOn(did);
        if (ok) remoteControlEnabled = true;
      }
    }

    return { ...saved, remoteControlEnabled };
  }

  async remove(id: string, userId: string) {
    const rule = await this.rulesRepo.findOne({ where: { id, userId } });
    if (!rule) throw new NotFoundException();
    await this.rulesRepo.remove(rule);
    return { message: '삭제되었습니다.' };
  }

  async getLogs(
    userId: string,
    params: { ruleId?: string; page?: number; limit?: number; type?: string },
  ) {
    const page = Math.max(1, Number(params.page || 1));
    const limit = Math.min(100, Math.max(1, Number(params.limit || 20)));

    const qb = this.logsRepo
      .createQueryBuilder('l')
      .where('l.user_id = :userId', { userId })
      .orderBy('l.executed_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (params.ruleId) {
      qb.andWhere('l.rule_id = :ruleId', { ruleId: params.ruleId });
    }

    if (params.type === 'irrigation') {
      qb.andWhere("l.conditions_met->>'type' IN (:...types)", {
        types: ['irrigation', 'irrigation_started', 'irrigation_cancelled'],
      });
    }

    const items = await qb.getMany();

    // ruleName 조인
    const ruleIds = [...new Set(items.map(l => l.ruleId))];
    const rules = ruleIds.length > 0
      ? await this.rulesRepo.findByIds(ruleIds)
      : [];
    const ruleMap = new Map(rules.map(r => [r.id, r.name]));

    return {
      data: items.map(log => ({
        ...log,
        ruleName: ruleMap.get(log.ruleId) || null,
      })),
      total: items.length,
    };
  }

  async getLogStats(userId: string) {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    // todayCount: 완료/취소만 카운트 (started 제외 — 시작+완료가 각각 1건으로 중복 집계되는 문제 방지)
    const todayCount = await this.logsRepo
      .createQueryBuilder('l')
      .where('l.user_id = :userId', { userId })
      .andWhere('l.executed_at >= :today', { today })
      .andWhere("l.conditions_met->>'type' IN (:...types)", {
        types: ['irrigation', 'irrigation_cancelled'],
      })
      .getCount()

    const [successCount, totalCount] = await Promise.all([
      this.logsRepo.count({ where: { userId, success: true } }),
      this.logsRepo.count({ where: { userId } }),
    ])

    const successRate = totalCount > 0 ? Math.round((successCount / totalCount) * 100) : 0

    const mostActiveRow = await this.logsRepo
      .createQueryBuilder('l')
      .select('l.rule_id', 'ruleId')
      .addSelect('COUNT(*)', 'cnt')
      .where('l.user_id = :userId', { userId })
      .groupBy('l.rule_id')
      .orderBy('cnt', 'DESC')
      .limit(1)
      .getRawOne()

    let mostActiveRule: string | null = null
    if (mostActiveRow?.ruleId) {
      const rule = await this.rulesRepo.findOne({ where: { id: mostActiveRow.ruleId, userId } })
      mostActiveRule = rule?.name || null
    }

    return { todayCount, successRate, mostActiveRule }
  }

  async runRuleNow(id: string, userId: string) {
    const rule = await this.rulesRepo.findOne({ where: { id, userId } });
    if (!rule) throw new NotFoundException();
    return this.runnerService.forceExecuteRule(rule);
  }

  private validateIrrigationConditions(conditions: any): void {
    if (!conditions || conditions.type !== 'irrigation') return;
    const fertilizer = conditions.fertilizer;
    if (!fertilizer?.enabled) return;

    const fertTotal = (fertilizer.duration || 0) + (fertilizer.preStopWait || 0);
    if (fertTotal <= 0) return;

    const zones = conditions.zones || [];
    const violations: string[] = [];
    for (const zone of zones) {
      if (!zone.enabled) continue;
      if ((zone.duration || 0) < fertTotal) {
        violations.push(
          `${zone.name || zone.zone + '구역'}: 관주시간(${zone.duration}분) < 투여시간(${fertilizer.duration}분)+종료전대기(${fertilizer.preStopWait}분)=${fertTotal}분`,
        );
      }
    }
    if (violations.length > 0) {
      throw new BadRequestException(
        `관주시간이 액비 투여시간+종료전대기보다 짧습니다: ${violations.join(', ')}`,
      );
    }
  }

  private determineRuleType(conditions: any): 'weather' | 'time' | 'hybrid' {
    const types = new Set<string>();
    for (const group of conditions?.groups || []) {
      for (const condition of group?.conditions || []) {
        types.add(condition.type);
      }
    }
    const hasTime = types.has('time');
    const hasSensor = types.has('sensor') || types.has('weather');
    if (hasTime && hasSensor) return 'hybrid';
    if (hasTime) return 'time';
    return 'weather';
  }

  private prepareConditions(conditions: any, houseId?: string) {
    const cloned = JSON.parse(JSON.stringify(conditions || {}));
    cloned.target = {
      ...(cloned.target || {}),
      houseId: houseId || undefined,
    };

    const weekStart = this.getCurrentWeekStartDate();
    for (const group of cloned.groups || []) {
      for (const condition of group.conditions || []) {
        const isIrrigationOnceHour = condition?.field === 'hour' &&
          condition?.scheduleType === 'once' &&
          Array.isArray(condition?.daysOfWeek) &&
          condition.daysOfWeek.length > 0;
        if (isIrrigationOnceHour) {
          condition.onceWeekStart = condition.onceWeekStart || weekStart;
          condition.executedDates = Array.isArray(condition.executedDates)
            ? condition.executedDates
            : [];
        } else if (condition?.field === 'hour' && condition?.scheduleType !== 'once') {
          condition.onceWeekStart = undefined;
          condition.executedDates = undefined;
          condition.executedAt = undefined;
        }
      }
    }

    return cloned;
  }

  private withTarget(rule: AutomationRule) {
    return {
      ...rule,
      houseId: rule.conditions?.target?.houseId,
    };
  }

  private getCurrentWeekStartDate() {
    const now = new Date();
    const day = now.getDay(); // 0=Sun
    const diffToMonday = day === 0 ? 6 : day - 1;
    const monday = new Date(now);
    monday.setHours(0, 0, 0, 0);
    monday.setDate(now.getDate() - diffToMonday);
    return monday.toISOString().slice(0, 10);
  }

  /** 관수 장비별 자동화 상태 조회 */
  async getIrrigationStatus(userId: string) {
    const rules = await this.rulesRepo.find({ where: { userId } });
    const irrigationRules = rules.filter(r => (r.conditions as any)?.type === 'irrigation');

    // 장비별 그룹핑
    const deviceRuleMap = new Map<string, AutomationRule[]>();
    for (const rule of irrigationRules) {
      const deviceIds = this.extractDeviceIds(rule.actions);
      for (const deviceId of deviceIds) {
        const arr = deviceRuleMap.get(deviceId) || [];
        arr.push(rule);
        deviceRuleMap.set(deviceId, arr);
      }
    }

    // 그룹 이름 캐시
    const groupNameCache = new Map<string, string>();
    for (const rule of irrigationRules) {
      if (rule.groupId && !groupNameCache.has(rule.groupId)) {
        const row = await this.devicesRepo.query(
          'SELECT name FROM house_groups WHERE id = $1', [rule.groupId],
        );
        groupNameCache.set(rule.groupId, row?.[0]?.name || null);
      }
    }

    const result: any[] = [];
    for (const [deviceId, devRules] of deviceRuleMap) {
      try {
        const device = await this.devicesRepo.findOne({ where: { id: deviceId } });
        if (!device) continue;
        const activeInfo = this.irrigationScheduler.getActiveByDevice(device.tuyaDeviceId);
        const groupId = devRules[0]?.groupId || null;
        result.push({
          deviceId,
          deviceName: device.name,
          groupId,
          groupName: groupId ? groupNameCache.get(groupId) || null : null,
          tuyaDeviceId: device.tuyaDeviceId,
          enabledRuleCount: devRules.filter(r => r.enabled).length,
          totalRuleCount: devRules.length,
          isRunning: !!activeInfo,
          runningRule: activeInfo ? {
            ruleId: activeInfo.ruleId,
            ruleName: activeInfo.ruleName,
            startedAt: activeInfo.startedAt,
            estimatedEndAt: activeInfo.estimatedEndAt,
          } : undefined,
          ruleSummaries: devRules.filter(r => r.enabled).map(r => {
            const cond = r.conditions as any;
            return {
              ruleId: r.id,
              ruleName: r.name,
              startTime: cond?.startTime || null,
              enabledZones: cond?.zones?.filter((z: any) => z.enabled).length || 0,
              totalZones: cond?.zones?.length || 0,
              days: cond?.schedule?.days || [],
              repeat: cond?.schedule?.repeat ?? true,
            };
          }),
        });
      } catch {
        // 장비가 삭제된 경우 무시
      }
    }
    return result;
  }

  /** 특정 장비의 관수 룰 일괄 비활성화 (FR-04) */
  async bulkDisableByDevice(userId: string, deviceId: string) {
    const rules = await this.rulesRepo.find({ where: { userId } });
    const targetRules = rules.filter(r => {
      if ((r.conditions as any)?.type !== 'irrigation') return false;
      return this.extractDeviceIds(r.actions).includes(deviceId);
    });

    let disabledCount = 0;
    for (const rule of targetRules) {
      if (rule.enabled) {
        rule.enabled = false;
        await this.rulesRepo.save(rule);
        disabledCount++;
      }
    }

    // 진행 중인 관수 중단
    let stoppedIrrigation = false;
    try {
      const device = await this.devicesRepo.findOne({ where: { id: deviceId } });
      if (device) stoppedIrrigation = await this.irrigationScheduler.stopByDevice(device.tuyaDeviceId);
    } catch {
      // 장비 못 찾으면 무시
    }

    return { disabledCount, stoppedIrrigation };
  }

  /** 룰 actions에서 대상 장비 ID 배열 추출 */
  private extractDeviceIds(actions: any): string[] {
    const ids: string[] = [];
    if (actions?.targetDeviceId) ids.push(actions.targetDeviceId);
    if (Array.isArray(actions?.targetDeviceIds)) {
      for (const id of actions.targetDeviceIds) {
        if (id && !ids.includes(id)) ids.push(id);
      }
    }
    return ids;
  }

  /** 원격제어 자동 ON (FR-03) */
  private async ensureRemoteControlOn(deviceId: string): Promise<boolean> {
    try {
      const device = await this.devicesRepo.findOne({ where: { id: deviceId } });
      if (!device) return false;

      const mapping = this.devicesService.getEffectiveMapping(device);
      const remoteCode = mapping['remote_control'];
      if (!remoteCode) return false;

      const credentials = await this.tuyaRepo.findOne({
        where: { userId: device.userId, enabled: true },
      });
      if (!credentials) return false;

      const tuyaCreds = {
        accessId: credentials.accessId,
        accessSecret: decryptTuyaSecret(credentials.accessSecretEncrypted),
        endpoint: credentials.endpoint,
      };

      await this.tuyaService.sendDeviceCommand(tuyaCreds, device.tuyaDeviceId, [
        { code: remoteCode, value: true },
      ]);
      this.logger.log(`원격제어 자동 ON: ${device.name}`);
      return true;
    } catch (err: any) {
      this.logger.warn(`원격제어 자동 ON 실패: ${err.message}`);
      return false;
    }
  }
}
