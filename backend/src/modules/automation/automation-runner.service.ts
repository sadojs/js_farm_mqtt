import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AutomationRule } from './entities/automation-rule.entity';
import { AutomationLog } from './entities/automation-log.entity';
import { Device } from '../devices/entities/device.entity';
import { EventsGateway } from '../gateway/events.gateway';
import { DevicesService } from '../devices/devices.service';
import { RainOverrideService } from '../rain-override/rain-override.service';
import { HighTempOverrideService } from './high-temp-override.service';

type LogicOp = 'AND' | 'OR';

@Injectable()
export class AutomationRunnerService {
  private readonly logger = new Logger(AutomationRunnerService.name);

  // 이전 실행 상태 캐시: ruleId → { matched, relayOnPhase, hysteresisAction }
  private readonly lastState = new Map<string, { matched: boolean; relayOnPhase?: boolean; hysteresisAction?: 'on' | 'off' | 'hold'; cycleAnchorMs?: number; directionStartMs?: number }>();

  constructor(
    @InjectRepository(AutomationRule)
    private readonly rulesRepo: Repository<AutomationRule>,
    @InjectRepository(AutomationLog)
    private readonly logsRepo: Repository<AutomationLog>,
    @InjectRepository(Device)
    private readonly devicesRepo: Repository<Device>,
    private readonly eventsGateway: EventsGateway,
    private readonly devicesService: DevicesService,
    private readonly rainOverride: RainOverrideService,
    private readonly highTempOverride: HighTempOverrideService,
    private readonly dataSource: DataSource,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async runEnabledRules() {
    const rules = await this.rulesRepo.find({
      where: { enabled: true },
      order: { priority: 'DESC', createdAt: 'ASC' },
    });

    for (const rule of rules) {
      // 초 단위 사이클은 별도 cron이 처리 — 분 단위 cron에서 중복 실행 방지
      if (this.hasSubMinuteRelay(rule)) continue;
      await this.executeRule(rule);
    }
  }

  // 개폐기 등 초 단위 ON/OFF 사이클을 위한 10초 주기 실행기
  @Cron('*/10 * * * * *')
  async runSubMinuteRelayRules() {
    const rules = await this.rulesRepo.find({
      where: { enabled: true },
      order: { priority: 'DESC', createdAt: 'ASC' },
    });

    for (const rule of rules) {
      if (!this.hasSubMinuteRelay(rule)) continue;
      await this.executeRule(rule);
    }
  }

  private hasSubMinuteRelay(rule: AutomationRule): boolean {
    const groups = (rule.conditions as any)?.groups;
    if (!Array.isArray(groups)) return false;
    for (const g of groups) {
      for (const cond of (g.conditions || [])) {
        if (cond.relay && (cond.relayOnSeconds || cond.relayOffSeconds)) return true;
      }
    }
    return false;
  }

  /** 조건 무시, 액션만 즉시 실행 (음성 명령 등에서 사용) */
  async forceExecuteRule(rule: AutomationRule) {
    this.logger.log(`강제 실행: rule=${rule.name} (조건 무시)`);
    const actionResults: any[] = [];
    let success = true;
    let errorMessage: string | undefined;

    try {
      const actions = Array.isArray(rule.actions) ? rule.actions : [rule.actions];
      for (const action of actions) {
        const executed = await this.executeAction(rule, action);
        actionResults.push(executed);
      }

      this.eventsGateway.broadcastAutomationExecuted(rule.userId, {
        ruleId: rule.id,
        ruleName: rule.name,
        success: true,
        actions: actionResults,
      });
    } catch (err: any) {
      success = false;
      errorMessage = err?.message || '강제 실행 실패';
      this.logger.error(`Rule ${rule.id} force execution failed: ${errorMessage}`);
    }

    const deviceNames = actionResults
      .flatMap((r: any) => r.devices || [])
      .map((d: any) => d.deviceName || d.deviceId)
      .filter(Boolean);
    await this.logsRepo.save(
      this.logsRepo.create({
        ruleId: rule.id,
        userId: rule.userId,
        success,
        conditionsMet: { type: 'force_execute', ruleName: rule.name },
        actionsExecuted: { deviceNames, results: actionResults },
        errorMessage,
      }),
    );

    return { executed: success, actions: actionResults, errorMessage };
  }

  /**
   * 룰 enable/disable toggle 시 호출 — runner의 in-memory state + device의 manual override 리셋.
   * 동작:
   *  - lastState 캐시 삭제 → 다음 cron tick에 신규 매칭처럼 재평가
   *  - 룰 대상 device의 userOverride / ruleIntendedState / relayActivePhase 리셋
   *    (사용자가 룰을 명시적으로 재활성화 = 자동제어 의도 → 수동 우회 해제)
   *  - 룰 disable 시 device의 sticky 상태도 정리하여 UI 토글이 즉시 반영
   */
  async onRuleToggled(rule: AutomationRule): Promise<void> {
    this.lastState.delete(rule.id);
    const ids = this.extractTargetDeviceIds(rule);
    for (const id of ids) {
      const dev = await this.devicesRepo.findOne({ where: { id } });
      if (!dev) continue;
      const settings: any = dev.deviceSettings || {};
      let changed = false;
      if (settings.userOverride) { settings.userOverride = false; changed = true; }
      if (settings.ruleIntendedState != null) { settings.ruleIntendedState = null; changed = true; }
      // 룰 disable 시: sticky 정리 + switchState=false → UI 즉시 반영
      if (!rule.enabled && (settings.relayActivePhase || settings.switchState)) {
        settings.relayActivePhase = null;
        settings.relayActiveRuleId = null;
        settings.relayActiveUntil = null;
        settings.switchState = false;
        changed = true;
      }
      if (changed) {
        dev.deviceSettings = settings;
        await this.devicesRepo.save(dev).catch(() => undefined);
        this.eventsGateway.broadcastDeviceSwitchUpdate?.(dev.userId, {
          deviceId: dev.id,
          switchState: settings.switchState ?? null,
          switchStates: settings.switchStates ?? null,
          online: dev.online,
        });
      }
    }
    this.logger.log(`onRuleToggled: rule=${rule.name} enabled=${rule.enabled} → lastState + devices(${ids.length}) reset`);
  }

  /**
   * 사용자가 수동 우회 release(룰 의도와 일치하는 토글)할 때 호출됨.
   * 해당 device를 target으로 하는 룰들의 lastState 캐시 클리어 → 다음 cron tick에 신규 매칭처럼 재평가.
   * (relay cycle OFF 구간에서 사용자가 ON으로 release했을 때 룰이 다시 OFF로 보낼 수 있도록)
   */
  @OnEvent('device.manual.released')
  async onDeviceManualReleased({ deviceId }: { deviceId: string }): Promise<void> {
    try {
      const rules = await this.rulesRepo.find({ where: { enabled: true } });
      let cleared = 0;
      for (const rule of rules) {
        const ids = this.extractTargetDeviceIds(rule);
        if (ids.includes(deviceId) && this.lastState.has(rule.id)) {
          this.lastState.delete(rule.id);
          cleared += 1;
        }
      }
      if (cleared > 0) {
        this.logger.log(`[manual-release] device ${deviceId} → ${cleared}개 룰의 lastState 클리어 (다음 cron tick에 재평가)`);
      }
    } catch (err: any) {
      this.logger.warn(`onDeviceManualReleased 처리 실패: ${err?.message ?? err}`);
    }
  }

  /** 룰 actions에서 대상 device id 추출 (페어 포함) */
  private extractTargetDeviceIds(rule: AutomationRule): string[] {
    const action: any = Array.isArray(rule.actions) ? rule.actions[0] : rule.actions;
    const ids = new Set<string>();
    if (action?.targetDeviceId) ids.add(action.targetDeviceId);
    if (Array.isArray(action?.targetDeviceIds)) action.targetDeviceIds.forEach((id: string) => ids.add(id));
    return [...ids];
  }

  async executeRule(rule: AutomationRule) {
    const evaluatedAt = new Date();

    // 비 감지 우회: 개폐기 룰이고 해당 구역에 비 감지 우회 활성 시 즉시 skip
    if (this.rainOverride.isOpenerRainOverridden(rule.groupId) && await this.isOpenerRule(rule)) {
      this.lastState.delete(rule.id);
      return { executed: false, reason: 'rain_override_active' };
    }

    const conditionResult = await this.evaluateRuleConditions(rule, evaluatedAt);

    if (!conditionResult.matched) {
      // 룰 active → inactive 전환: 대상 device의 relayActivePhase 해제 + switchState=false
      const prev = this.lastState.get(rule.id);
      if (prev?.matched) {
        await this.clearRelayActivePhase(rule).catch(err =>
          this.logger.warn(`relayActivePhase 해제 실패: ${err.message}`)
        );
      }
      this.lastState.delete(rule.id);
      return { executed: false, reason: 'conditions_not_met', details: conditionResult.details };
    }

    // 릴레이 모드 체크: 조건이 매칭된 시간 범위 내에서 ON/OFF 사이클 실행
    // 히스테리시스(방향: on=열기, off=닫기)를 먼저 산출 — 사이클 anchor/10분 캡의 세션 경계 판정용.
    const hysteresisAction = this.extractHysteresisAction(conditionResult.details);
    const prevRelay = this.lastState.get(rule.id);
    const nowMs = evaluatedAt.getTime();
    // 새 세션 = 최초 매칭이거나 방향이 바뀐 경우 → 사이클 anchor / 10분 타이머 리셋.
    const newSession = !prevRelay?.matched || prevRelay?.hysteresisAction !== hysteresisAction;
    const cycleAnchorMs = newSession ? nowMs : (prevRelay?.cycleAnchorMs ?? nowMs);
    const directionStartMs = newSession ? nowMs : (prevRelay?.directionStartMs ?? nowMs);
    // 사이클을 룰 활성화 시각(anchor)에 정렬 → 항상 동작(ON)부터 시작 (기존 epoch 정렬은 대기부터 시작 가능).
    const relayResult = this.checkRelayCycle(rule, evaluatedAt, cycleAnchorMs);
    if (relayResult) {
      // 고온 무대기 강제열림: 개폐기 '열림' 방향(hysteresis 'on') 이고 구역이 고온 오버라이드
      // 활성이면, 동작/대기 듀티의 대기(off) phase 를 생략하고 연속 '열림'을 유지한다.
      // (10분 캡은 아래에서 그대로 적용 — 완전 개방 후 정지.)
      if (hysteresisAction === 'on'
        && await this.isOpenerRule(rule)
        && await this.highTempOverride.isActive(rule.groupId)) {
        relayResult.isOnPhase = true;
      }
      // 동일 방향 10분 초과 시 자동 OFF + 정지 (개폐기는 실제 ~3분이면 완전 개/폐 — 무한 반복 방지).
      if (nowMs - directionStartMs >= 10 * 60 * 1000) {
        relayResult.isOnPhase = false;
      }

      // 비-페어 device(예: 유동팬)에서 hysteresisAction='off'는 룰 종료로 간주.
      // (페어 device는 'off' 시 반대 방향으로 라우팅하지만 단일 device는 그냥 stop)
      if (hysteresisAction === 'off') {
        const isOpenerRule = await this.isOpenerRule(rule);
        if (!isOpenerRule) {
          const wasActive = this.lastState.get(rule.id)?.matched === true;
          // 항상 clearRelayActivePhase 호출 — backend 재시작으로 lastState 캐시가 비어있어도
          // device.deviceSettings.relayActivePhase가 남아있으면 정리 (내부에서 idempotent)
          await this.clearRelayActivePhase(rule).catch(err =>
            this.logger.warn(`relayActivePhase 해제 실패: ${err.message}`)
          );
          this.lastState.delete(rule.id);
          // 활성 → 비활성 전환은 "변화 시점" — 로그 1건만 남긴다.
          // (사용자가 환풍기 등이 언제 꺼졌는지 추적 가능)
          if (wasActive) {
            await this.logsRepo.save(
              this.logsRepo.create({
                ruleId: rule.id,
                userId: rule.userId,
                success: true,
                conditionsMet: {
                  type: 'relay',
                  ruleName: rule.name,
                  hysteresisAction: 'off',
                  equipmentType: (rule.actions as any)?.equipmentType || null,
                  deactivated: true,
                },
                actionsExecuted: { deviceNames: [], command: 'off' },
              }),
            ).catch(err => this.logger.warn(`룰 종료 로그 저장 실패: ${err?.message ?? err}`));
          }
          return { executed: false, reason: 'hysteresis_off_non_opener' };
        }
      }
      // 릴레이 상태 변경 시에만 실행 (ON→OFF 또는 OFF→ON)
      // hysteresis 방향이 바뀐 경우(예: 열기 사이클 → 닫기 사이클)도 무조건 즉시 반영
      const prev = this.lastState.get(rule.id);
      const phaseChanged = prev?.relayOnPhase !== relayResult.isOnPhase;
      const directionChanged = prev?.hysteresisAction !== hysteresisAction;
      if (prev?.matched && !phaseChanged && !directionChanged) {
        // 상태는 안 바뀌지만 룰이 active이므로 sticky 유지 — relayActiveUntil 갱신 (heartbeat)
        await this.refreshRelayActiveUntil(rule).catch(() => undefined);
        return { executed: false, reason: 'relay_state_unchanged' };
      }
      // 로그는 "의미 있는 변화"에서만 기록한다 — 룰이 막 활성화되었거나(이전 매치 없음)
      // 펄스 방향이 바뀌었을 때(예: 열기 → 닫기)만 logsRepo.save 호출.
      // 같은 활성 사이클 내의 30s ON ↔ 60s OFF 펄스 토글은 발행은 하되 로그는 생략.
      const isNewActivation = !prev?.matched || directionChanged;
      this.lastState.set(rule.id, { matched: true, relayOnPhase: relayResult.isOnPhase, hysteresisAction, cycleAnchorMs, directionStartMs });
      return this.executeRelayAction(rule, relayResult, hysteresisAction, isNewActivation);
    }

    // 일반 자동화: 이미 조건 충족 중이면 중복 실행 방지
    const prev = this.lastState.get(rule.id);
    if (prev?.matched) {
      return { executed: false, reason: 'already_active' };
    }
    this.lastState.set(rule.id, { matched: true });

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

      this.eventsGateway.broadcastAutomationExecuted(rule.userId, {
        ruleId: rule.id,
        ruleName: rule.name,
        success: true,
        actions: actionResults,
      });
    } catch (err: any) {
      success = false;
      errorMessage = err?.message || '자동 제어 액션 실행 실패';
      this.logger.error(`Rule ${rule.id} execution failed: ${errorMessage}`);
      this.eventsGateway.broadcastAutomationExecuted(rule.userId, {
        ruleId: rule.id,
        ruleName: rule.name,
        success: false,
        actions: actionResults,
      });
    }

    // 로그에 요약 정보 포함 (executeAction 반환: { action, devices: [{ deviceName, commands, ... }] })
    const deviceNames = actionResults
      .flatMap((r: any) => r.devices || [])
      .map((d: any) => d.deviceName || d.deviceId)
      .filter(Boolean);
    const commandSummary = actionResults
      .flatMap((r: any) => r.devices || [])
      .map((d: any) => d.commands?.map((c: any) => `${c.code}=${c.value}`)?.join(', '))
      .filter(Boolean)
      .join('; ');
    await this.logsRepo.save(
      this.logsRepo.create({
        ruleId: rule.id,
        userId: rule.userId,
        success,
        conditionsMet: {
          ...conditionResult.details,
          ruleName: rule.name,
          equipmentType: rule.actions?.equipmentType || null,
        },
        actionsExecuted: {
          deviceNames,
          commandSummary: commandSummary || null,
          results: actionResults,
        },
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

    // 조건별 특정 디바이스 센서값 사전 수집
    const allConditions = conditions.groups.flatMap((g: any) => g.conditions || []);
    const deviceIds = [...new Set(
      allConditions.map((c: any) => c.sensor_device_id).filter(Boolean),
    )] as string[];
    const deviceSensorOverrides = await this.getDeviceSensorValues(deviceIds);

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
        const effectiveSensorMap = condition.sensor_device_id && deviceSensorOverrides.has(condition.sensor_device_id)
          ? { ...sensorMap, ...deviceSensorOverrides.get(condition.sensor_device_id) }
          : sensorMap;
        const result = this.evaluateSingleCondition(condition, effectiveSensorMap, now);
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
          hysteresisAction: (result as any).hysteresisAction,
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
    // v2 위저드: field 'time' (분 단위 0~1439). 레거시: field 'hour' (시 단위 0~23)
    if (condition.field === 'hour' || condition.field === 'time') {
      const isMinuteBased = condition.field === 'time';
      const currentMinutes = now.getHours() * 60 + now.getMinutes();
      const currentHour = now.getHours();
      const currentValue = isMinuteBased ? currentMinutes : currentHour;
      const weekdayMatched = this.isWeekdayMatched(condition, now);
      if (!weekdayMatched) {
        return { matched: false, actual: currentValue, isOnceMatched: false, onceDateKey: undefined };
      }
      const hourMatched = this.evaluateTimeHour(condition.operator, condition.value, currentValue);
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
      // slot.start/end는 분(>=24) 또는 시(<24) 단위. 분으로 정규화하여 평가.
      const slotsMin = condition.timeSlots.map((s: any) => ({
        start: Number(s.start) < 24 ? Number(s.start) * 60 : Number(s.start),
        end: Number(s.end) < 24 ? Number(s.end) * 60 : Number(s.end),
      }));
      const currentMinutes = now.getHours() * 60 + now.getMinutes();
      const weekdayMatched = this.isWeekdayMatched(condition, now);
      if (!weekdayMatched) {
        return { matched: false, actual: currentMinutes, isOnceMatched: false, onceDateKey: undefined };
      }
      // 시작 시각 정확히 일치 → ON 발화 (1분 윈도우)
      for (const slot of slotsMin) {
        if (currentMinutes === slot.start) {
          return { matched: true, actual: currentMinutes, isOnceMatched: false, onceDateKey: undefined, timeAction: 'on' };
        }
        if (currentMinutes === slot.end) {
          return { matched: true, actual: currentMinutes, isOnceMatched: false, onceDateKey: undefined, timeAction: 'off' };
        }
      }
      const inActiveSlot = slotsMin.some((s: any) => currentMinutes >= s.start && currentMinutes < s.end);
      return { matched: false, actual: currentMinutes, isOnceMatched: false, onceDateKey: undefined, inActiveSlot };
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

    // 하위호환: 기존 eq 조건은 해당 시간 한 시간 범위로 처리
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

    // 스키마: sensor_data.user_id=uuid, sensor_data.device_id=uuid,
    //         devices.user_id=varchar, devices.house_id=varchar, devices.id=uuid,
    //         houses.id=uuid, houses.group_id=uuid, group_devices.group_id=uuid, group_devices.device_id=uuid
    if (groupId) {
      params.push(groupId);
      groupFilter = `AND (
        d.id IN (SELECT gd.device_id FROM group_devices gd WHERE gd.group_id = $2::uuid)
        OR h.group_id = $2::uuid
      )`;
    }

    if (houseId) {
      params.push(houseId);
      // devices.house_id는 varchar이므로 cast 없이 직접 비교
      houseFilter = `AND d.house_id = $${params.length}`;
    }

    const rows = await this.dataSource.query(
      `
      SELECT DISTINCT ON (sd.sensor_type)
        sd.sensor_type,
        sd.value
      FROM sensor_data sd
      JOIN devices d ON d.id = sd.device_id
      LEFT JOIN houses h ON h.id::text = d.house_id
      WHERE sd.user_id = $1::uuid
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

  private async getDeviceSensorValues(
    deviceIds: string[],
  ): Promise<Map<string, Record<string, number | boolean>>> {
    const result = new Map<string, Record<string, number | boolean>>();
    if (!deviceIds.length) return result;

    const rows = await this.dataSource.query(
      `
      SELECT DISTINCT ON (device_id, sensor_type)
        device_id,
        sensor_type,
        value
      FROM sensor_data
      WHERE device_id = ANY($1)
      ORDER BY device_id, sensor_type, time DESC
      `,
      [deviceIds],
    );

    for (const row of rows) {
      if (!result.has(row.device_id)) result.set(row.device_id, {});
      const numeric = Number(row.value);
      result.get(row.device_id)![row.sensor_type] = Number.isNaN(numeric)
        ? this.toBoolean(row.value)
        : numeric;
    }
    return result;
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
    let candidateDevices: Device[];
    // targetDeviceId(단일)와 targetDeviceIds(다중)의 합집합 사용 — 룰을 나중에 여러 장치로
    // 편집(targetDeviceIds 추가)했는데 원래 targetDeviceId 하나만 동작하던 버그 수정.
    const mergedTargetIds = [
      ...(action?.targetDeviceId ? [action.targetDeviceId] : []),
      ...(Array.isArray(action?.targetDeviceIds) ? action.targetDeviceIds : []),
    ];
    const targetIds = mergedTargetIds.length > 0
      ? [...new Set<string>(mergedTargetIds)]
      : null;

    if (targetIds) {
      // 명시적 targetIds는 user_id 검사 없이 조회 (admin이 다른 사용자 그룹의 룰을 만든 경우 호환)
      candidateDevices = await this.devicesRepo
        .createQueryBuilder('d')
        .where('d.id IN (:...ids)', { ids: targetIds })
        .getMany();
    } else {
      candidateDevices = await this.findTargetDevices(rule, action?.deviceType);
    }
    if (candidateDevices.length === 0) {
      throw new Error(`제어 가능한 장비를 찾을 수 없습니다.`);
    }

    const commands = this.buildCommands(action);
    if (commands.length === 0) {
      throw new Error(`지원하지 않는 명령입니다. command=${action?.command || 'unknown'}`);
    }

    const results: any[] = [];
    for (const device of candidateDevices) {
      // 수동/타이머 우회 활성 device 는 룰 실행 대상에서 제외(relay 경로와 동일). 만료 시 자동 복귀.
      if ((device.deviceSettings as any)?.userOverride) {
        this.logger.log(`[manual-override] ${device.name} 수동/타이머 우회 활성 — 룰 실행 skip (rule=${rule.name})`);
        results.push({ deviceId: device.id, deviceName: device.name, success: true, skipped: true });
        continue;
      }
      this.logger.log(
        `자동 제어 명령 전송: rule=${rule.name}, device=${device.name}(${device.id}), command=${JSON.stringify(commands)}`,
      );
      try {
        await this.devicesService.controlDevice(device.id, rule.userId, commands, undefined, 'automation');
        results.push({ deviceId: device.id, deviceName: device.name, success: true, commands });
      } catch (err: any) {
        results.push({ deviceId: device.id, deviceName: device.name, success: false, error: err?.message });
      }
    }

    const hasFailure = results.some((r) => !r.success);
    if (hasFailure) {
      throw new Error(`일부 장비 명령 전송 실패: ${JSON.stringify(results)}`);
    }

    return { action, devices: results };
  }

  private async findTargetDevices(rule: AutomationRule, deviceType?: string) {
    const targetHouseId = this.getRuleHouseId(rule);
    // 스키마 혼재: devices.user_id/house_id는 varchar, houses.group_id는 uuid
    // 따라서 group_id 비교만 uuid CAST 필요
    const qb = this.devicesRepo
      .createQueryBuilder('d')
      .leftJoin('houses', 'h', 'h.id::text = d.house_id')
      .where('d.user_id = :userId', { userId: rule.userId })
      .andWhere('d.device_type = :deviceType', { deviceType: 'actuator' });

    if (rule.groupId) {
      qb.andWhere('h.group_id = CAST(:groupId AS uuid)', { groupId: rule.groupId });
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

  private buildCommands(action: any): { code: string; value: any }[] {
    const command = action?.command;
    const isOn = command !== 'off';
    return [{ code: 'state', value: isOn ? 'ON' : 'OFF' }];
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

  // 릴레이 사이클 체크: 조건에 relay=true가 있으면 ON/OFF 사이클 위상 계산
  // - relayOnSeconds/relayOffSeconds 가 있으면 초 단위 사이클 (epoch 기준)
  // - 그 외엔 기존 분 단위 사이클 (시간 범위 시작점 기준)
  private checkRelayCycle(rule: AutomationRule, now: Date, anchorMs?: number): { isOnPhase: boolean; condition: any } | null {
    const conditions = rule.conditions;
    if (!conditions?.groups?.length) return null;

    for (const group of conditions.groups) {
      for (const cond of group.conditions || []) {
        if (!cond.relay) continue;

        // 초 단위 (개폐기 30/60s 등)
        if (cond.relayOnSeconds || cond.relayOffSeconds) {
          const onSec = Number(cond.relayOnSeconds) || 30;
          const offSec = Number(cond.relayOffSeconds) || 60;
          const cycleSec = onSec + offSec;
          // 사이클을 룰 활성화 시각(anchorMs)에 정렬 → 항상 동작(ON) 구간부터 시작.
          // (anchor 미제공 시 epoch 기준 폴백 — 하위호환)
          const anchorSec = anchorMs != null ? Math.floor(anchorMs / 1000) : 0;
          const elapsedSec = Math.floor(now.getTime() / 1000) - anchorSec;
          const cyclePos = ((elapsedSec % cycleSec) + cycleSec) % cycleSec;
          const isOnPhase = cyclePos < onSec;
          return { isOnPhase, condition: cond };
        }

        // 분 단위 (기존)
        const onMinutes = cond.relayOnMinutes || 50;
        const offMinutes = cond.relayOffMinutes || 10;
        const cycleLength = onMinutes + offMinutes;

        let startHour = 0;
        if (cond.field === 'hour' && Array.isArray(cond.value)) {
          startHour = Number(cond.value[0]);
        }
        const currentHour = now.getHours();
        const currentMinute = now.getMinutes();
        const elapsedMinutes = (currentHour - startHour) * 60 + currentMinute;

        const cyclePosition = ((elapsedMinutes % cycleLength) + cycleLength) % cycleLength;
        const isOnPhase = cyclePosition < onMinutes;
        return { isOnPhase, condition: cond };
      }
    }
    return null;
  }

  /** 룰의 대상 장치가 개폐기인지 (opener_open/opener_close).
   * action에 equipmentType이 명시되면 그것을 우선 사용, 없으면 targetDeviceId로 DB 조회.
   */
  private async isOpenerRule(rule: AutomationRule): Promise<boolean> {
    const action: any = Array.isArray(rule.actions) ? rule.actions[0] : rule.actions;
    const eq = action?.equipmentType;
    if (eq === 'opener_open' || eq === 'opener_close') return true;
    const targetId = action?.targetDeviceId || (Array.isArray(action?.targetDeviceIds) ? action.targetDeviceIds[0] : null);
    if (!targetId) return false;
    const dev = await this.devicesRepo.findOne({ where: { id: targetId } });
    return dev?.equipmentType === 'opener_open' || dev?.equipmentType === 'opener_close';
  }

  private extractHysteresisAction(details: any): 'on' | 'off' | 'hold' | undefined {
    if (!details?.groups) return undefined;
    for (const g of details.groups) {
      for (const c of (g.conditions || [])) {
        if (c.hysteresisAction === 'on' || c.hysteresisAction === 'off') return c.hysteresisAction;
      }
    }
    return undefined;
  }

  // 개폐기 페어(opener_open/opener_close)에서 hysteresisAction에 맞는 대상 장치를 선택
  private async resolveOpenerTargets(action: any, hysteresisAction?: 'on' | 'off' | 'hold'): Promise<string[] | null> {
    if (!hysteresisAction || hysteresisAction === 'hold') return null;
    const targetId = action?.targetDeviceId
      ?? (Array.isArray(action?.targetDeviceIds) && action.targetDeviceIds[0]);
    if (!targetId) return null;
    const device = await this.devicesRepo.findOne({ where: { id: targetId } });
    if (!device) return null;
    const isOpener = device.equipmentType === 'opener_open' || device.equipmentType === 'opener_close';
    if (!isOpener) return null;
    // 'on' (온도 ≥ ON 임계값) → 열림 장치, 'off' (온도 ≤ OFF 임계값) → 닫힘 장치
    const wantOpen = hysteresisAction === 'on';
    if ((wantOpen && device.equipmentType === 'opener_open')
      || (!wantOpen && device.equipmentType === 'opener_close')) {
      return [device.id];
    }
    // 반대편 장치로 스위칭
    if (device.pairedDeviceId) return [device.pairedDeviceId];
    return [device.id];
  }

  /** 룰이 active 상태인 동안 relayActiveUntil 만료 방지 (매분 heartbeat) */
  private async refreshRelayActiveUntil(rule: AutomationRule): Promise<void> {
    const action: any = Array.isArray(rule.actions) ? rule.actions[0] : rule.actions;
    const ids: string[] = [];
    if (action?.targetDeviceId) ids.push(action.targetDeviceId);
    if (Array.isArray(action?.targetDeviceIds)) ids.push(...action.targetDeviceIds);
    const until = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    for (const id of [...new Set(ids)]) {
      const dev = await this.devicesRepo.findOne({ where: { id } });
      if (!dev) continue;
      const settings: any = dev.deviceSettings || {};
      if (settings.relayActivePhase) {
        settings.relayActiveUntil = until;
        dev.deviceSettings = settings;
        await this.devicesRepo.save(dev);
      }
    }
  }

  /**
   * 룰이 inactive 전환 시 — 대상 device의 relayActivePhase 해제 + switchState=false.
   * 펄스 사이클 sticky 상태를 정리하여 UI 토글이 OFF로 돌아가도록.
   */
  private async clearRelayActivePhase(rule: AutomationRule): Promise<void> {
    const action: any = Array.isArray(rule.actions) ? rule.actions[0] : rule.actions;
    const ids: string[] = [];
    if (action?.targetDeviceId) ids.push(action.targetDeviceId);
    if (Array.isArray(action?.targetDeviceIds)) ids.push(...action.targetDeviceIds);
    for (const id of [...new Set(ids)]) {
      const dev = await this.devicesRepo.findOne({ where: { id } });
      if (!dev) continue;
      // 페어 device도 함께 정리 (개폐기 페어)
      const targets = [dev];
      if (dev.pairedDeviceId) {
        const paired = await this.devicesRepo.findOne({ where: { id: dev.pairedDeviceId } });
        if (paired) targets.push(paired);
      }
      for (const t of targets) {
        const settings: any = t.deviceSettings || {};
        if (settings.relayActivePhase || settings.switchState
          || settings.ruleIntendedState != null || settings.userOverride) {
          settings.relayActivePhase = null;
          settings.relayActiveRuleId = null;
          settings.relayActiveUntil = null;
          settings.switchState = false;
          // 룰 inactive 전환 시 수동 pin/release state도 리셋 (룰이 더 이상 device를 관리하지 않음)
          settings.ruleIntendedState = null;
          settings.userOverride = false;
          t.deviceSettings = settings;
          await this.devicesRepo.save(t);
          this.eventsGateway.broadcastDeviceSwitchUpdate?.(t.userId, {
            deviceId: t.id,
            switchState: false,
            switchStates: settings.switchStates ?? null,
            online: t.online,
          });
        }
      }
    }
  }

  private async executeRelayAction(
    rule: AutomationRule,
    relay: { isOnPhase: boolean; condition: any },
    hysteresisAction?: 'on' | 'off' | 'hold',
    shouldLog: boolean = true,
  ) {
    const action = Array.isArray(rule.actions) ? rule.actions[0] : rule.actions;
    // 개폐기 페어 라우팅: hysteresis 방향에 따라 open/close 장치 선택
    const openerTargets = await this.resolveOpenerTargets(action, hysteresisAction);
    let actionOverride = openerTargets
      ? { ...action, targetDeviceId: openerTargets[0], targetDeviceIds: openerTargets, command: relay.isOnPhase ? 'on' : 'off' }
      : { ...action, command: relay.isOnPhase ? 'on' : 'off' };

    // userOverride 체크 — 수동 우회 활성 device는 룰 실행 대상에서 제외
    const targetIds: string[] = [
      ...(actionOverride.targetDeviceId ? [actionOverride.targetDeviceId] : []),
      ...(Array.isArray(actionOverride.targetDeviceIds) ? actionOverride.targetDeviceIds : []),
    ];
    const skippedIds: string[] = [];
    const remainingIds: string[] = [];
    for (const id of new Set(targetIds)) {
      const dev = await this.devicesRepo.findOne({ where: { id } });
      if (dev && (dev.deviceSettings as any)?.userOverride) {
        skippedIds.push(id);
        this.logger.log(`[manual-override] ${dev.name} 수동 우회 활성 — 룰 실행 skip (rule=${rule.name})`);
      } else {
        remainingIds.push(id);
      }
    }
    if (remainingIds.length === 0) {
      // 모든 대상이 수동 우회 — 발행 안 함, 로그만 남김
      return { executed: false, reason: 'manual_override_all', skippedIds };
    }
    if (skippedIds.length > 0) {
      // 일부 대상만 우회 — 나머지로만 실행
      actionOverride = {
        ...actionOverride,
        targetDeviceId: remainingIds[0],
        targetDeviceIds: remainingIds,
      };
    }

    let success = true;
    let errorMessage: string | undefined;
    let actionResult: any;

    try {
      actionResult = await this.executeAction(rule, actionOverride);
      this.logger.log(`릴레이 ${relay.isOnPhase ? 'ON' : 'OFF'} 실행: rule=${rule.name}`);

      // 개폐기/팬: 펄스 사이클 active 표시 → frontend UI가 sticky ON 표시
      // (펄스 OFF 구간이어도 룰 동작 중이라 화면은 ON 유지)
      const targetDevices: any[] = actionResult?.devices || [];
      for (const td of targetDevices) {
        if (!td?.deviceId) continue;
        const dev = await this.devicesRepo.findOne({ where: { id: td.deviceId } });
        if (!dev) continue;

        // 페어 전환 정리: 이 device가 opener면 페어(반대 방향)의 sticky 해제
        if ((dev.equipmentType === 'opener_open' || dev.equipmentType === 'opener_close') && dev.pairedDeviceId) {
          const paired = await this.devicesRepo.findOne({ where: { id: dev.pairedDeviceId } });
          if (paired?.deviceSettings) {
            const ps: any = paired.deviceSettings;
            if (ps.relayActivePhase || ps.switchState) {
              ps.relayActivePhase = null;
              ps.relayActiveRuleId = null;
              ps.relayActiveUntil = null;
              ps.switchState = false;
              paired.deviceSettings = ps;
              await this.devicesRepo.save(paired);
              this.eventsGateway.broadcastDeviceSwitchUpdate?.(paired.userId, {
                deviceId: paired.id,
                switchState: false,
                switchStates: ps.switchStates ?? null,
                online: paired.online,
              });
            }
          }
        }

        const settings: any = dev.deviceSettings || {};
        const direction = dev.equipmentType === 'opener_open' ? 'open'
          : dev.equipmentType === 'opener_close' ? 'close'
          : 'fan';
        settings.relayActivePhase = direction;
        settings.relayActiveRuleId = rule.id;
        settings.relayActiveUntil = new Date(Date.now() + 5 * 60 * 1000).toISOString();
        // 룰 active 동안은 switchState도 true로 sticky 유지
        settings.switchState = true;
        // 수동 pin/release 정책: 룰이 active 동안 device가 "동작 상태"여야 함을 기록
        // 사용자가 다른 상태(OFF)로 토글하면 userOverride=true로 pin
        // 사용자가 다시 ON으로 토글하면 → 룰 의도와 일치 → userOverride=false로 release
        // (relay 펄스 OFF 구간이라도 사용자 관점에서 rule은 "동작 중"이므로 true 유지)
        settings.ruleIntendedState = true;
        dev.deviceSettings = settings;
        await this.devicesRepo.save(dev);
        this.eventsGateway.broadcastDeviceSwitchUpdate?.(dev.userId, {
          deviceId: dev.id,
          switchState: true,
          switchStates: settings.switchStates ?? null,
          online: dev.online,
        });
      }
    } catch (err: any) {
      success = false;
      errorMessage = err.message;
      this.logger.error(`릴레이 실행 실패: ${err.message}`);
    }

    // 릴레이 실행 로그 기록 — 새 활성화/방향 전환/실패에서만 기록(shouldLog).
    // 같은 활성 사이클 내의 펄스 토글은 사용자 입장에선 "변화 없음"이므로 로그 생략.
    if (shouldLog || !success) {
      const deviceNames = actionResult?.devices
        ? actionResult.devices.map((d: any) => d.deviceName || d.deviceId).filter(Boolean)
        : [];
      await this.logsRepo.save(
        this.logsRepo.create({
          ruleId: rule.id,
          userId: rule.userId,
          success,
          conditionsMet: {
            type: 'relay',
            ruleName: rule.name,
            isOnPhase: relay.isOnPhase,
            relayOnMinutes: relay.condition.relayOnMinutes,
            relayOffMinutes: relay.condition.relayOffMinutes,
            relayOnSeconds: relay.condition.relayOnSeconds,
            relayOffSeconds: relay.condition.relayOffSeconds,
            hysteresisAction: hysteresisAction || null,
            field: relay.condition.field,
            equipmentType: action?.equipmentType || null,
          },
          actionsExecuted: {
            deviceNames,
            command: relay.isOnPhase ? 'on' : 'off',
          },
          errorMessage,
        }),
      );
    }

    return { executed: success, relay: true, isOnPhase: relay.isOnPhase, actions: actionResult ? [actionResult] : [] };
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
