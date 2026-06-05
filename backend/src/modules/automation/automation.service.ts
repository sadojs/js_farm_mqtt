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

@Injectable()
export class AutomationService {
  private readonly logger = new Logger(AutomationService.name);

  constructor(
    @InjectRepository(AutomationRule) private rulesRepo: Repository<AutomationRule>,
    @InjectRepository(AutomationLog) private logsRepo: Repository<AutomationLog>,
    @InjectRepository(Device) private devicesRepo: Repository<Device>,
    private readonly runnerService: AutomationRunnerService,
    private readonly irrigationScheduler: IrrigationSchedulerService,
    private readonly devicesService: DevicesService,
  ) {}

  async findAll(userId: string | null) {
    const rules = await this.rulesRepo.find({
      where: userId ? { userId } : {},
      order: { priority: 'DESC', createdAt: 'DESC' },
    });
    return rules.map((rule) => this.withTarget(rule));
  }

  /** groupId로 owner user_id 추론 (admin이 룰 생성 시 사용) */
  async resolveGroupOwner(groupId: string): Promise<string | null> {
    const row = await this.rulesRepo.manager.query(
      `SELECT user_id FROM house_groups WHERE id = $1::uuid LIMIT 1`,
      [groupId],
    );
    return row?.[0]?.user_id ?? null;
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

  async update(id: string, userId: string | null, dto: UpdateRuleDto) {
    const rule = await this.rulesRepo.findOne({ where: userId ? { id, userId } : { id } });
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

    // 룰 update 시 runner의 in-memory lastState 강제 무효화 + 대상 device의 manual override / rule intent 리셋
    // 이유: conditions 변경(특히 relay: true→false 같은 모드 전환) 시 stale lastState가 'already_active'로 publish를 막아
    //       새 조건이 즉시 반영되지 않는 문제 발생. toggle과 동일하게 처리.
    try {
      this.runnerService.onRuleToggled(saved);
    } catch (err: any) {
      this.logger.warn(`onRuleToggled (update) 호출 실패: ${err?.message ?? err}`);
    }

    return this.withTarget(saved);
  }

  async toggle(id: string, userId: string | null, options?: { autoEnableRemote?: boolean }) {
    const rule = await this.rulesRepo.findOne({ where: userId ? { id, userId } : { id } });
    if (!rule) throw new NotFoundException();
    rule.enabled = !rule.enabled;
    const saved = await this.rulesRepo.save(rule);

    // 룰 toggle 시 runner의 in-memory lastState 강제 무효화 + 대상 device의 manual override / rule intent 리셋
    // → 룰 disable→enable 시 즉시 재평가되고 ON/OFF가 새로 적용되도록 보장.
    try {
      this.runnerService.onRuleToggled(saved);
    } catch (err: any) {
      this.logger.warn(`onRuleToggled 호출 실패: ${err?.message ?? err}`);
    }

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

  async remove(id: string, userId: string | null) {
    const rule = await this.rulesRepo.findOne({ where: userId ? { id, userId } : { id } });
    if (!rule) throw new NotFoundException();
    // 삭제 직전 runner의 in-memory lastState + 대상 device의 sticky 상태 정리
    // (rule.enabled를 false로 가정한 cleanup — relayActivePhase / ruleIntendedState 등 리셋)
    try {
      rule.enabled = false;
      this.runnerService.onRuleToggled(rule);
    } catch (err: any) {
      this.logger.warn(`onRuleToggled (remove) 호출 실패: ${err?.message ?? err}`);
    }
    await this.rulesRepo.remove(rule);
    return { message: '삭제되었습니다.' };
  }

  async getLogs(
    userId: string | null,
    params: { ruleId?: string; page?: number; limit?: number; type?: string },
  ) {
    const page = Math.max(1, Number(params.page || 1));
    const limit = Math.min(100, Math.max(1, Number(params.limit || 20)));

    const qb = this.logsRepo
      .createQueryBuilder('l')
      .orderBy('l.executed_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (userId) qb.where('l.user_id = :userId', { userId });

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

  async getLogStats(userId: string | null) {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const todayQb = this.logsRepo
      .createQueryBuilder('l')
      .andWhere('l.executed_at >= :today', { today })
      .andWhere("l.conditions_met->>'type' IN (:...types)", {
        types: ['irrigation', 'irrigation_cancelled'],
      })
    if (userId) todayQb.where('l.user_id = :userId', { userId })
    const todayCount = await todayQb.getCount()

    const userWhere = userId ? { userId } : {}
    const [successCount, totalCount] = await Promise.all([
      this.logsRepo.count({ where: { ...userWhere, success: true } }),
      this.logsRepo.count({ where: userWhere }),
    ])

    const successRate = totalCount > 0 ? Math.round((successCount / totalCount) * 100) : 0

    const mostActiveQb = this.logsRepo
      .createQueryBuilder('l')
      .select('l.rule_id', 'ruleId')
      .addSelect('COUNT(*)', 'cnt')
      .groupBy('l.rule_id')
      .orderBy('cnt', 'DESC')
      .limit(1)
    if (userId) mostActiveQb.where('l.user_id = :userId', { userId })
    const mostActiveRow = await mostActiveQb.getRawOne()

    let mostActiveRule: string | null = null
    if (mostActiveRow?.ruleId) {
      const rule = await this.rulesRepo.findOne({
        where: userId ? { id: mostActiveRow.ruleId, userId } : { id: mostActiveRow.ruleId },
      })
      mostActiveRule = rule?.name || null
    }

    return { todayCount, successRate, mostActiveRule }
  }

  async runRuleNow(id: string, userId: string | null) {
    const rule = await this.rulesRepo.findOne({ where: userId ? { id, userId } : { id } });
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
  async getIrrigationStatus(userId: string | null) {
    const rules = await this.rulesRepo.find({ where: userId ? { userId } : {} });
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
        const activeInfo = this.irrigationScheduler.getActiveByDevice(device.friendlyName);
        const groupId = devRules[0]?.groupId || null;
        result.push({
          deviceId,
          deviceName: device.name,
          groupId,
          groupName: groupId ? groupNameCache.get(groupId) || null : null,
          friendlyName: device.friendlyName,
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
  async bulkDisableByDevice(userId: string | null, deviceId: string) {
    const rules = await this.rulesRepo.find({ where: userId ? { userId } : {} });
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
      if (device) stoppedIrrigation = await this.irrigationScheduler.stopByDevice(device.friendlyName);
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
  /** 원격제어 자동 ON (FR-03) — B접점 페어 동시 ON */
  private async ensureRemoteControlOn(deviceId: string): Promise<boolean> {
    try {
      const device = await this.devicesRepo.findOne({ where: { id: deviceId } });
      if (!device) return false;

      const mapping = this.devicesService.getEffectiveMapping(device);
      const remoteCode = mapping['remote_control'];
      if (!remoteCode) return false;

      // devicesService.controlDevice 경유 → B접점 페어링 로직 자동 실행 (MQTT)
      await this.devicesService.controlDevice(deviceId, device.userId, [
        { code: remoteCode, value: true },
      ]);
      this.logger.log(`원격제어 + B접점 자동 ON: ${device.name}`);
      return true;
    } catch (err: any) {
      this.logger.warn(`원격제어 자동 ON 실패: ${err.message}`);
      return false;
    }
  }
}
