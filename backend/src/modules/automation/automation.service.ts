import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AutomationRule } from './entities/automation-rule.entity';
import { CreateRuleDto, UpdateRuleDto } from './dto/create-rule.dto';
import { AutomationLog } from './entities/automation-log.entity';
import { AutomationRunnerService } from './automation-runner.service';

@Injectable()
export class AutomationService {
  constructor(
    @InjectRepository(AutomationRule) private rulesRepo: Repository<AutomationRule>,
    @InjectRepository(AutomationLog) private logsRepo: Repository<AutomationLog>,
    private readonly runnerService: AutomationRunnerService,
  ) {}

  async findAll(userId: string) {
    const rules = await this.rulesRepo.find({
      where: { userId },
      order: { priority: 'DESC', createdAt: 'DESC' },
    });
    return rules.map((rule) => this.withTarget(rule));
  }

  async create(userId: string, dto: CreateRuleDto) {
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

  async toggle(id: string, userId: string) {
    const rule = await this.rulesRepo.findOne({ where: { id, userId } });
    if (!rule) throw new NotFoundException();
    rule.enabled = !rule.enabled;
    return this.rulesRepo.save(rule);
  }

  async remove(id: string, userId: string) {
    const rule = await this.rulesRepo.findOne({ where: { id, userId } });
    if (!rule) throw new NotFoundException();
    await this.rulesRepo.remove(rule);
    return { message: '삭제되었습니다.' };
  }

  async getLogs(
    userId: string,
    params: { ruleId?: string; page?: number; limit?: number },
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

    const [items] = await qb.getManyAndCount();
    return items;
  }

  async runRuleNow(id: string, userId: string) {
    const rule = await this.rulesRepo.findOne({ where: { id, userId } });
    if (!rule) throw new NotFoundException();
    return this.runnerService.executeRule(rule);
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
}
