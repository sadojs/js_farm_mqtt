import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AutomationRule } from './entities/automation-rule.entity';
import { AutomationLog } from './entities/automation-log.entity';
import { Device } from '../devices/entities/device.entity';
import { TuyaProject } from '../users/entities/tuya-project.entity';
import { TuyaService } from '../integrations/tuya/tuya.service';
import { EventsGateway } from '../gateway/events.gateway';

type LogicOp = 'AND' | 'OR';

@Injectable()
export class AutomationRunnerService {
  private readonly logger = new Logger(AutomationRunnerService.name);

  constructor(
    @InjectRepository(AutomationRule)
    private readonly rulesRepo: Repository<AutomationRule>,
    @InjectRepository(AutomationLog)
    private readonly logsRepo: Repository<AutomationLog>,
    @InjectRepository(Device)
    private readonly devicesRepo: Repository<Device>,
    @InjectRepository(TuyaProject)
    private readonly tuyaRepo: Repository<TuyaProject>,
    private readonly tuyaService: TuyaService,
    private readonly eventsGateway: EventsGateway,
    private readonly dataSource: DataSource,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async runEnabledRules() {
    const rules = await this.rulesRepo.find({
      where: { enabled: true },
      order: { priority: 'DESC', createdAt: 'ASC' },
    });

    for (const rule of rules) {
      await this.executeRule(rule);
    }
  }

  async executeRule(rule: AutomationRule) {
    const evaluatedAt = new Date();
    const conditionResult = await this.evaluateRuleConditions(rule, evaluatedAt);

    if (!conditionResult.matched) {
      // 릴레이 모드 체크: 조건 불일치지만 릴레이 활성 시간대 내이면 릴레이 사이클 실행
      const relayResult = this.checkRelayCycle(rule, evaluatedAt);
      if (relayResult) {
        return this.executeRelayAction(rule, relayResult, evaluatedAt);
      }
      return { executed: false, reason: 'conditions_not_met', details: conditionResult.details };
    }

    const actionResults: any[] = [];
    let success = true;
    let errorMessage: string | undefined;

    try {
      const actions = Array.isArray(rule.actions) ? rule.actions : [rule.actions];
      for (const action of actions) {
        const executed = await this.executeAction(rule, action);
        actionResults.push(executed);
      }

      if (conditionResult.onceConditionHits.length > 0) {
        await this.markOnceConditionsExecuted(rule, conditionResult.onceConditionHits, evaluatedAt);
      }

      this.eventsGateway.broadcastAutomationExecuted({
        ruleId: rule.id,
        ruleName: rule.name,
        success: true,
        actions: actionResults,
      });
    } catch (err: any) {
      success = false;
      errorMessage = err?.message || '자동화 액션 실행 실패';
      this.logger.error(`Rule ${rule.id} execution failed: ${errorMessage}`);
      this.eventsGateway.broadcastAutomationExecuted({
        ruleId: rule.id,
        ruleName: rule.name,
        success: false,
        actions: actionResults,
      });
    }

    await this.logsRepo.save(
      this.logsRepo.create({
        ruleId: rule.id,
        userId: rule.userId,
        success,
        conditionsMet: conditionResult.details,
        actionsExecuted: actionResults,
        errorMessage,
      }),
    );

    return { executed: success, details: conditionResult.details, actions: actionResults, errorMessage };
  }

  private async evaluateRuleConditions(rule: AutomationRule, now: Date) {
    const conditions = rule.conditions;
    if (!conditions?.groups?.length) {
      return { matched: false, details: { reason: 'no_conditions' }, onceConditionHits: [] as string[] };
    }

    const targetHouseId = this.getRuleHouseId(rule);
    const sensorMap = await this.getLatestSensorMap(rule.userId, rule.groupId, targetHouseId);
    const groupLogic: LogicOp = conditions.logic === 'OR' ? 'OR' : 'AND';
    const groupResults: boolean[] = [];
    const details: any[] = [];
    const onceConditionHits: string[] = [];

    for (let gi = 0; gi < conditions.groups.length; gi++) {
      const group = conditions.groups[gi];
      const conditionLogic: LogicOp = group.logic === 'OR' ? 'OR' : 'AND';
      const conditionResults: boolean[] = [];
      const conditionDetails: any[] = [];

      for (let ci = 0; ci < (group.conditions || []).length; ci++) {
        const condition = group.conditions[ci];
        const result = this.evaluateSingleCondition(condition, sensorMap, now);
        if (result.isOnceMatched) {
          const suffix = result.onceDateKey ? `:${result.onceDateKey}` : '';
          onceConditionHits.push(`${gi}:${ci}${suffix}`);
        }
        conditionResults.push(result.matched);
        conditionDetails.push({
          field: condition.field,
          operator: condition.operator,
          expected: condition.value,
          actual: result.actual,
          matched: result.matched,
        });
      }

      const groupMatched = conditionLogic === 'AND'
        ? conditionResults.every(Boolean)
        : conditionResults.some(Boolean);

      groupResults.push(groupMatched);
      details.push({
        groupIndex: gi,
        logic: conditionLogic,
        matched: groupMatched,
        conditions: conditionDetails,
      });
    }

    const matched = groupLogic === 'AND'
      ? groupResults.every(Boolean)
      : groupResults.some(Boolean);

    return {
      matched,
      details: {
        evaluatedAt: now.toISOString(),
        logic: groupLogic,
        matched,
        groups: details,
      },
      onceConditionHits,
    };
  }

  private evaluateSingleCondition(condition: any, sensorMap: Record<string, number | boolean>, now: Date) {
    if (condition.field === 'hour') {
      const currentHour = now.getHours();
      const weekdayMatched = this.isWeekdayMatched(condition, now);
      if (!weekdayMatched) {
        return { matched: false, actual: currentHour, isOnceMatched: false, onceDateKey: undefined };
      }
      const hourMatched = this.evaluateTimeHour(condition.operator, condition.value, currentHour);
      const onceSchedule = condition.scheduleType === 'once';
      if (!onceSchedule) {
        return { matched: hourMatched, actual: currentHour, isOnceMatched: false, onceDateKey: undefined };
      }

      const hasDays = Array.isArray(condition.daysOfWeek) && condition.daysOfWeek.length > 0;
      if (hasDays) {
        const inWeek = this.isInTargetWeek(condition.onceWeekStart, now);
        if (!inWeek) {
          return { matched: false, actual: currentHour, isOnceMatched: false, onceDateKey: undefined };
        }
        const dateKey = this.toDateKey(now);
        const executedDates = Array.isArray(condition.executedDates) ? condition.executedDates : [];
        const alreadyExecutedToday = executedDates.includes(dateKey);
        const matched = hourMatched && !alreadyExecutedToday;
        return {
          matched,
          actual: currentHour,
          isOnceMatched: matched,
          onceDateKey: matched ? dateKey : undefined,
        };
      }

      const alreadyExecuted = !!condition.executedAt;
      const matched = hourMatched && !alreadyExecuted;
      return {
        matched,
        actual: currentHour,
        isOnceMatched: !!matched && onceSchedule,
        onceDateKey: undefined,
      };
    }

    if (condition.field === 'once_at') {
      const alreadyExecuted = !!condition.executedAt;
      const target = typeof condition.value === 'string' ? new Date(condition.value) : null;
      const validDate = !!target && !Number.isNaN(target.getTime());
      const matched = validDate && !alreadyExecuted && now >= target;
      return {
        matched,
        actual: now.toISOString(),
        isOnceMatched: !!matched,
        onceDateKey: undefined,
      };
    }

    const actual = sensorMap[condition.field];
    if (actual === undefined || actual === null) {
      return { matched: false, actual: null, isOnceMatched: false, onceDateKey: undefined };
    }

    if (condition.field === 'rain') {
      const rainActual = this.toBoolean(actual);
      const expected = this.toBoolean(condition.value);
      return { matched: rainActual === expected, actual: rainActual, isOnceMatched: false, onceDateKey: undefined };
    }

    const actualNum = Number(actual);
    if (Number.isNaN(actualNum)) {
      return { matched: false, actual, isOnceMatched: false, onceDateKey: undefined };
    }

    // 히스테리시스 (FR-02): deviation이 있는 경우
    if (condition.deviation != null && condition.deviation > 0) {
      const base = Number(condition.value);
      const dev = Number(condition.deviation);
      const onThreshold = base + dev;
      const offThreshold = base - dev;

      if (actualNum >= onThreshold) {
        return { matched: true, actual: actualNum, isOnceMatched: false, onceDateKey: undefined, hysteresisAction: 'on' };
      }
      if (actualNum <= offThreshold) {
        return { matched: true, actual: actualNum, isOnceMatched: false, onceDateKey: undefined, hysteresisAction: 'off' };
      }
      // 사이 값: 현재 상태 유지 (matched: false로 처리하여 무동작)
      return { matched: false, actual: actualNum, isOnceMatched: false, onceDateKey: undefined, hysteresisAction: 'hold' };
    }

    // 시간대 스케줄러 (FR-03): timeSlots가 있는 경우
    if (Array.isArray(condition.timeSlots) && condition.timeSlots.length > 0) {
      const currentHour = now.getHours();
      const weekdayMatched = this.isWeekdayMatched(condition, now);
      if (!weekdayMatched) {
        return { matched: false, actual: currentHour, isOnceMatched: false, onceDateKey: undefined };
      }
      for (const slot of condition.timeSlots) {
        if (currentHour === slot.start) {
          return { matched: true, actual: currentHour, isOnceMatched: false, onceDateKey: undefined, timeAction: 'on' };
        }
        if (currentHour === slot.end) {
          return { matched: true, actual: currentHour, isOnceMatched: false, onceDateKey: undefined, timeAction: 'off' };
        }
      }
      const inActiveSlot = condition.timeSlots.some((s: any) => currentHour >= s.start && currentHour < s.end);
      return { matched: false, actual: currentHour, isOnceMatched: false, onceDateKey: undefined, inActiveSlot };
    }

    return {
      matched: this.evaluateNumericCondition(condition.operator, condition.value, actualNum),
      actual: actualNum,
      isOnceMatched: false,
      onceDateKey: undefined,
    };
  }

  private evaluateTimeHour(operator: string, value: any, currentHour: number) {
    if (operator === 'between' && Array.isArray(value) && value.length === 2) {
      const start = Number(value[0]);
      const end = Number(value[1]);
      if (Number.isNaN(start) || Number.isNaN(end)) return false;
      if (start <= end) return currentHour >= start && currentHour <= end;
      return currentHour >= start || currentHour <= end;
    }

    if (operator === 'eq') {
      return currentHour === Number(value);
    }

    return false;
  }

  private evaluateNumericCondition(operator: string, expected: any, actual: number) {
    const expectedNum = Number(expected);
    switch (operator) {
      case 'gt':
        return actual > expectedNum;
      case 'lt':
        return actual < expectedNum;
      case 'gte':
        return actual >= expectedNum;
      case 'lte':
        return actual <= expectedNum;
      case 'eq':
        return actual === expectedNum;
      case 'between': {
        if (!Array.isArray(expected) || expected.length !== 2) return false;
        const min = Number(expected[0]);
        const max = Number(expected[1]);
        return actual >= min && actual <= max;
      }
      default:
        return false;
    }
  }

  private async getLatestSensorMap(
    userId: string,
    groupId?: string,
    houseId?: string,
  ): Promise<Record<string, number | boolean>> {
    const params: any[] = [userId];
    let groupFilter = '';
    let houseFilter = '';

    if (groupId) {
      params.push(groupId);
      // group_devices 또는 houses.group_id 둘 다 확인 (센서가 하우스 없이 그룹에 직접 연결된 경우 포함)
      groupFilter = `AND (
        d.id IN (SELECT gd.device_id FROM group_devices gd WHERE gd.group_id = $2)
        OR h.group_id = $2
      )`;
    }

    if (houseId) {
      params.push(houseId);
      houseFilter = `AND d.house_id = $${params.length}`;
    }

    const rows = await this.dataSource.query(
      `
      SELECT DISTINCT ON (sd.sensor_type)
        sd.sensor_type,
        sd.value
      FROM sensor_data sd
      JOIN devices d ON d.id = sd.device_id
      LEFT JOIN houses h ON h.id = d.house_id
      WHERE sd.user_id = $1
      ${groupFilter}
      ${houseFilter}
      ORDER BY sd.sensor_type, sd.time DESC
      `,
      params,
    );

    const map: Record<string, number | boolean> = {};
    for (const row of rows) {
      const raw = row.value;
      const numeric = Number(raw);
      map[row.sensor_type] = Number.isNaN(numeric) ? this.toBoolean(raw) : numeric;
    }

    // env role 기반 매핑 병합 (groupId가 있는 경우)
    if (groupId) {
      const envRoleMap = await this.getEnvRoleMap(groupId);
      Object.assign(map, envRoleMap);
    }

    return map;
  }

  /**
   * 환경설정 역할(env role) 기반으로 최신 센서/기상 데이터 맵 생성
   * condition.field가 'internal_temp', 'external_humidity' 등의 env role key일 때 사용
   */
  private async getEnvRoleMap(groupId: string): Promise<Record<string, number | boolean>> {
    const map: Record<string, number | boolean> = {};

    // 1. sensor 매핑: env_mappings → sensor_data
    const sensorRows = await this.dataSource.query(
      `
      SELECT em.role_key,
        (SELECT sd.value FROM sensor_data sd
         WHERE sd.device_id = em.device_id AND sd.sensor_type = em.sensor_type
         ORDER BY sd.time DESC LIMIT 1) as value
      FROM env_mappings em
      WHERE em.group_id = $1 AND em.source_type = 'sensor'
        AND em.device_id IS NOT NULL AND em.sensor_type IS NOT NULL
      `,
      [groupId],
    );
    for (const row of sensorRows) {
      if (row.value != null) {
        const numeric = Number(row.value);
        map[row.role_key] = Number.isNaN(numeric) ? this.toBoolean(row.value) : numeric;
      }
    }

    // 2. weather 매핑: env_mappings → weather_data
    const weatherRows = await this.dataSource.query(
      `
      SELECT em.role_key, em.weather_field
      FROM env_mappings em
      WHERE em.group_id = $1 AND em.source_type = 'weather'
        AND em.weather_field IS NOT NULL
      `,
      [groupId],
    );
    if (weatherRows.length > 0) {
      const latestWeather = await this.dataSource.query(
        `SELECT temperature, humidity, precipitation, wind_speed
         FROM weather_data ORDER BY time DESC LIMIT 1`,
      );
      if (latestWeather.length > 0) {
        const wd = latestWeather[0];
        for (const row of weatherRows) {
          const val = wd[row.weather_field];
          if (val != null) {
            const numeric = Number(val);
            map[row.role_key] = Number.isNaN(numeric) ? this.toBoolean(val) : numeric;
          }
        }
      }
    }

    return map;
  }

  private async executeAction(rule: AutomationRule, action: any) {
    const credentials = await this.tuyaRepo.findOne({
      where: { userId: rule.userId, enabled: true },
    });
    if (!credentials) {
      throw new Error('활성화된 Tuya 프로젝트 설정이 없습니다.');
    }

    // targetDeviceId(단일) 또는 targetDeviceIds(배열)가 있으면 특정 장비를 사용
    let candidateDevices: Device[];
    const targetIds = action?.targetDeviceId
      ? [action.targetDeviceId]
      : (Array.isArray(action?.targetDeviceIds) && action.targetDeviceIds.length > 0 ? action.targetDeviceIds : null);

    if (targetIds) {
      candidateDevices = await this.devicesRepo
        .createQueryBuilder('d')
        .where('d.user_id = :userId', { userId: rule.userId })
        .andWhere('d.id IN (:...ids)', { ids: targetIds })
        .getMany();
    } else {
      candidateDevices = await this.findTargetDevices(rule, action?.deviceType);
    }
    if (candidateDevices.length === 0) {
      throw new Error(`제어 가능한 장비를 찾을 수 없습니다.`);
    }

    const commands = this.buildCommandCandidates(action);
    if (commands.length === 0) {
      throw new Error(`지원하지 않는 명령입니다. command=${action?.command || 'unknown'}`);
    }

    const results: any[] = [];
    for (const device of candidateDevices) {
      this.logger.log(
        `자동화 명령 전송: rule=${rule.name}, device=${device.name}(${device.tuyaDeviceId}), command=${JSON.stringify(commands[0])}`,
      );
      let sent = false;
      let lastError = '';
      for (const commandSet of commands) {
        try {
          const res = await this.tuyaService.sendDeviceCommand(
            {
              accessId: credentials.accessId,
              accessSecret: credentials.accessSecretEncrypted,
              endpoint: credentials.endpoint,
            },
            device.tuyaDeviceId,
            commandSet,
          );
          if (res?.success) {
            sent = true;
            results.push({
              deviceId: device.id,
              tuyaDeviceId: device.tuyaDeviceId,
              success: true,
              commands: commandSet,
            });
            break;
          }
          lastError = res?.msg || 'Tuya command failed';
        } catch (err: any) {
          lastError = err?.response?.data?.msg || err?.message || 'Tuya command failed';
        }
      }

      if (!sent) {
        results.push({
          deviceId: device.id,
          tuyaDeviceId: device.tuyaDeviceId,
          success: false,
          error: lastError || 'Unknown error',
        });
      }
    }

    const hasFailure = results.some((r) => !r.success);
    if (hasFailure) {
      throw new Error(`일부 장비 명령 전송 실패: ${JSON.stringify(results)}`);
    }

    return {
      action,
      devices: results,
    };
  }

  private async findTargetDevices(rule: AutomationRule, deviceType?: string) {
    const targetHouseId = this.getRuleHouseId(rule);
    const qb = this.devicesRepo
      .createQueryBuilder('d')
      .leftJoin('houses', 'h', 'h.id = d.house_id')
      .where('d.user_id = :userId', { userId: rule.userId })
      .andWhere('d.device_type = :deviceType', { deviceType: 'actuator' });

    if (rule.groupId) {
      qb.andWhere('h.group_id = :groupId', { groupId: rule.groupId });
    }
    if (targetHouseId) {
      qb.andWhere('d.house_id = :houseId', { houseId: targetHouseId });
    }

    const devices = await qb.getMany();
    if (!deviceType) return devices;

    const filtered = devices.filter((d) => this.matchesDeviceType(d, deviceType));
    return filtered.length > 0 ? filtered : devices;
  }

  private matchesDeviceType(device: Device, deviceType: string) {
    const category = (device.category || '').toLowerCase();
    if (deviceType === 'roof_actuator') {
      return category.includes('개폐') || category.includes('roof') || category.includes('window');
    }
    if (deviceType === 'ventilation_fan') {
      return category.includes('환풍') || category.includes('fan');
    }
    if (deviceType === 'irrigation') {
      return category.includes('관수') || category.includes('irrig');
    }
    return false;
  }

  private buildCommandCandidates(action: any): { code: string; value: any }[][] {
    const command = action?.command;
    const deviceType = action?.deviceType;
    const params = action?.parameters || {};

    // 새로운 형식: targetDeviceIds/targetDeviceId + on/off 명령
    if (action?.targetDeviceId || (Array.isArray(action?.targetDeviceIds) && action.targetDeviceIds.length > 0)) {
      const isOn = command !== 'off';
      return [
        [{ code: 'switch_1', value: isOn }],
        [{ code: 'switch', value: isOn }],
      ];
    }

    if (deviceType === 'roof_actuator') {
      const isOpen = command === 'open';
      const percentage = Number(params.percentage ?? (isOpen ? 100 : 0));
      return [
        [{ code: 'switch', value: isOpen }],
        [{ code: 'switch_1', value: isOpen }],
        [{ code: 'percent_control', value: Math.max(0, Math.min(100, percentage)) }],
      ];
    }

    if (deviceType === 'ventilation_fan') {
      const isOn = command === 'on';
      const speedMap: Record<string, string> = { low: 'low', mid: 'middle', high: 'high' };
      const speed = speedMap[params.speed] || 'middle';
      if (!isOn) {
        return [
          [{ code: 'switch', value: false }],
          [{ code: 'switch_1', value: false }],
        ];
      }
      return [
        [{ code: 'switch', value: true }, { code: 'fan_speed_enum', value: speed }],
        [{ code: 'switch_1', value: true }, { code: 'fan_speed_enum', value: speed }],
        [{ code: 'switch', value: true }],
      ];
    }

    if (deviceType === 'irrigation') {
      return [
        [{ code: 'switch', value: true }],
        [{ code: 'switch_1', value: true }],
        [{ code: 'start', value: true }],
      ];
    }

    return [];
  }

  private async markOnceConditionsExecuted(rule: AutomationRule, hits: string[], executedAt: Date) {
    const nextConditions = structuredClone(rule.conditions || {});

    for (let gi = 0; gi < (nextConditions.groups || []).length; gi++) {
      const group = nextConditions.groups[gi];
      for (let ci = 0; ci < (group.conditions || []).length; ci++) {
        const key = `${gi}:${ci}`;
        const hit = hits.find((h) => h === key || h.startsWith(`${key}:`));
        const isOnceAt = group.conditions[ci]?.field === 'once_at';
        const isHourOnce = group.conditions[ci]?.field === 'hour' && group.conditions[ci]?.scheduleType === 'once';
        if (hit && (isOnceAt || isHourOnce)) {
          group.conditions[ci].executedAt = executedAt.toISOString();
          const dateKey = hit.split(':').slice(2).join(':');
          if (isHourOnce && dateKey) {
            const executedDates = Array.isArray(group.conditions[ci].executedDates)
              ? group.conditions[ci].executedDates
              : [];
            if (!executedDates.includes(dateKey)) {
              group.conditions[ci].executedDates = [...executedDates, dateKey];
            }
          }
        }
      }
    }

    const onceConditions: any[] = [];
    for (const group of nextConditions.groups || []) {
      for (const condition of group.conditions || []) {
        const isOnceAt = condition.field === 'once_at';
        const isHourOnce = condition.field === 'hour' && condition.scheduleType === 'once';
        if (isOnceAt || isHourOnce) onceConditions.push(condition);
      }
    }

    const allOnceConsumed = onceConditions.length > 0 && onceConditions.every((c) => {
      const isHourOnceWithDays = c.field === 'hour' &&
        c.scheduleType === 'once' &&
        Array.isArray(c.daysOfWeek) &&
        c.daysOfWeek.length > 0 &&
        typeof c.onceWeekStart === 'string';
      if (isHourOnceWithDays) {
        const expectedDates = this.getExpectedDateKeysForWeek(c.onceWeekStart, c.daysOfWeek);
        const executedDates = Array.isArray(c.executedDates) ? c.executedDates : [];
        return expectedDates.every((dateKey) => executedDates.includes(dateKey));
      }
      return !!c.executedAt;
    });
    rule.conditions = nextConditions;
    if (allOnceConsumed) {
      rule.enabled = false;
    }
    await this.rulesRepo.save(rule);
  }

  // 릴레이 사이클 체크: 조건에 relay=true가 있고, 현재 활성 시간대 내이면 릴레이 ON/OFF 결정
  private checkRelayCycle(rule: AutomationRule, now: Date): { isOnPhase: boolean; condition: any } | null {
    const conditions = rule.conditions;
    if (!conditions?.groups?.length) return null;

    for (const group of conditions.groups) {
      for (const cond of group.conditions || []) {
        if (cond.relay) {
          const minuteInHour = now.getMinutes();
          const onMinutes = cond.relayOnMinutes || 50;
          const offMinutes = cond.relayOffMinutes || 10;
          const cycleLength = onMinutes + offMinutes;
          const cyclePosition = minuteInHour % cycleLength;
          const isOnPhase = cyclePosition < onMinutes;
          return { isOnPhase, condition: cond };
        }
      }
    }
    return null;
  }

  private async executeRelayAction(rule: AutomationRule, relay: { isOnPhase: boolean; condition: any }, now: Date) {
    const action = Array.isArray(rule.actions) ? rule.actions[0] : rule.actions;
    const actionOverride = { ...action, command: relay.isOnPhase ? 'on' : 'off' };

    try {
      const result = await this.executeAction(rule, actionOverride);
      this.logger.log(`릴레이 ${relay.isOnPhase ? 'ON' : 'OFF'} 실행: rule=${rule.name}`);
      return { executed: true, relay: true, isOnPhase: relay.isOnPhase, actions: [result] };
    } catch (err: any) {
      this.logger.error(`릴레이 실행 실패: ${err.message}`);
      return { executed: false, relay: true, error: err.message };
    }
  }

  private toBoolean(value: any): boolean {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value > 0;
    if (typeof value === 'string') {
      const normalized = value.toLowerCase();
      return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'rain';
    }
    return false;
  }

  private getRuleHouseId(rule: AutomationRule): string | undefined {
    const raw = rule?.conditions?.target?.houseId;
    if (typeof raw === 'string' && raw.length > 0) return raw;
    return undefined;
  }

  private isWeekdayMatched(condition: any, now: Date): boolean {
    const days = condition?.daysOfWeek;
    if (!Array.isArray(days) || days.length === 0) return true;
    const day = now.getDay();
    const normalized = day === 0 ? 7 : day; // JS: 0=Sun ... 6=Sat
    return days.includes(normalized);
  }

  private isInTargetWeek(weekStart: string | undefined, now: Date): boolean {
    if (!weekStart) return true;
    return weekStart === this.getWeekStartDateKey(now);
  }

  private getWeekStartDateKey(now: Date): string {
    const day = now.getDay();
    const diffToMonday = day === 0 ? 6 : day - 1;
    const monday = new Date(now);
    monday.setHours(0, 0, 0, 0);
    monday.setDate(now.getDate() - diffToMonday);
    return this.toDateKey(monday);
  }

  private toDateKey(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  private getExpectedDateKeysForWeek(weekStart: string, daysOfWeek: number[]): string[] {
    const [year, month, day] = weekStart.split('-').map((n: string) => Number(n));
    const monday = new Date(year, (month || 1) - 1, day || 1);
    return daysOfWeek.map((weekday) => {
      const target = new Date(monday);
      target.setDate(monday.getDate() + (weekday - 1));
      return this.toDateKey(target);
    });
  }
}
