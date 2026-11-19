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
import { DeviceArbiterService, Want, ArbiterSource } from './device-arbiter.service';
import { isGatewayLatched } from '../../common/emergency/emergency-latch';

type LogicOp = 'AND' | 'OR';

/**
 * 자동 제어가 믿는 센서값의 최대 나이. 이보다 오래된 값은 '없음'으로 본다
 * (센서가 죽은 뒤 마지막 값으로 며칠씩 제어하던 문제). Pi 폴백의 센서 타임아웃(1200초)과 같은 기준.
 */
const SENSOR_MAX_AGE_MIN = Number(process.env.AUTOMATION_SENSOR_MAX_AGE_MIN) || 20;
/** 기상청 날씨값(1시간 주기 수집)의 최대 나이 */
const WEATHER_MAX_AGE_MIN = Number(process.env.AUTOMATION_WEATHER_MAX_AGE_MIN) || 180;

/** 수동 우회 또는 아직 유효한 타이머·방재가 걸린 장비 — 룰이 건드리지 않는다 */
export function isManuallyHeld(settings: any): boolean {
  if (!settings) return false;
  if (settings.userOverride) return true;
  return !!(settings.overrideUntil && new Date(settings.overrideUntil).getTime() > Date.now());
}

@Injectable()
export class AutomationRunnerService {
  private readonly logger = new Logger(AutomationRunnerService.name);

  // 이전 실행 상태 캐시: ruleId → { matched, relayOnPhase, hysteresisAction }
  private readonly lastState = new Map<string, { matched: boolean; relayOnPhase?: boolean; hysteresisAction?: 'on' | 'off' | 'hold'; cycleAnchorMs?: number; directionStartMs?: number; targetIds?: string[] }>();
  /** 중재기에서 밀려 이번 평가에서 건너뛸 장치 — ruleId → deviceIds (executeAction 이 읽는다) */
  private readonly arbiterBlocked = new Map<string, Set<string>>();
  /** 센서 끊김으로 멈춘 룰 — 같은 알림을 반복하지 않기 위한 표시 */
  private readonly staleNotified = new Set<string>();
  /** 센서 끊김으로 월별 시간표(백업)로 운전 중인 개폐기 룰 — 전환 시점에만 알리기 위함 */
  private readonly backupActive = new Set<string>();

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
    private readonly arbiter: DeviceArbiterService,
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
    this.dropState(rule.id);
    const ids = this.extractTargetDeviceIds(rule);
    for (const id of ids) {
      const dev = await this.devicesRepo.findOne({ where: { id } });
      if (!dev) continue;
      const settings: any = dev.deviceSettings || {};
      let changed = false;
      // 타이머·방재(overrideUntil 미래)는 룰 수정/토글로 풀지 않는다 — 만료 시 정상 복귀
      // (이전: 룰을 고치거나 켜면 방재 중에도 즉시 보호가 풀려 개폐기가 열리던 문제)
      const timerActive = !!(settings.overrideUntil && new Date(settings.overrideUntil).getTime() > Date.now());
      if (settings.userOverride && !timerActive) { settings.userOverride = false; changed = true; }
      if (settings.ruleIntendedState != null) { settings.ruleIntendedState = null; changed = true; }
      // 룰 disable 시: 이 룰이 켜 둔 장비는 실제 OFF 발행 후 sticky 정리 + switchState=false → UI 즉시 반영
      const heldByOther = !rule.enabled ? this.otherActiveRuleFor(dev.id, rule.id) : null;
      if (heldByOther && settings.switchState) {
        // 다른 룰이 켜 두고 있는 장비 — 끄지 않고 소유만 넘긴다
        settings.relayActiveRuleId = heldByOther;
        dev.deviceSettings = settings;
        await this.devicesRepo.save(dev).catch(() => undefined);
        continue;
      }
      if (!rule.enabled && !timerActive) {
        await this.turnOffIfRuleOwned(dev, rule, settings);
      }
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
   * 개별 수동 제어로 룰을 정지할 때 호출 — 룰 enable/disable 토글과 달리 '개별'이므로
   * 룰의 다른 대상 장치는 건드리지 않는다(현재 상태 유지). 이 룰이 제어하던 장치들 중
   * 실제 수동 조작 대상(deviceId)과 그 개폐기 페어의 rule sticky 만 해제하고 룰 캐시를 무효화한다.
   * (기존엔 onRuleToggled 가 룰의 전체 대상 장치를 리셋해, 3개 중 1개만 만졌는데 나머지 2개도
   *  꺼지던 문제.)
   */
  async onRuleStoppedForDevice(rule: AutomationRule, deviceId: string): Promise<void> {
    this.dropState(rule.id);
    const ids = new Set<string>([deviceId]);
    const dev = await this.devicesRepo.findOne({ where: { id: deviceId } });
    if (dev?.pairedDeviceId) ids.add(dev.pairedDeviceId);
    for (const id of ids) {
      const d = await this.devicesRepo.findOne({ where: { id } });
      if (!d) continue;
      const s: any = d.deviceSettings || {};
      if (s.relayActivePhase || s.relayActiveRuleId || s.ruleIntendedState != null || s.userOverride) {
        // 수동 제어 대상만 rule sticky 해제 (switchState 는 곧 수동 제어가 덮어씀 — 여기선 유지).
        s.relayActivePhase = null;
        s.relayActiveRuleId = null;
        s.relayActiveUntil = null;
        s.ruleIntendedState = null;
        s.userOverride = false;
        d.deviceSettings = s;
        await this.devicesRepo.save(d).catch(() => undefined);
        this.eventsGateway.broadcastDeviceSwitchUpdate?.(d.userId, {
          deviceId: d.id,
          switchState: s.switchState ?? null,
          switchStates: s.switchStates ?? null,
          online: d.online,
        });
      }
    }
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

  /** 룰 상태 캐시를 지우고 중재기 요청도 철회한다 (룰이 멈추거나 바뀐 경우) */
  private dropState(ruleId: string) {
    this.lastState.delete(ruleId);
    this.arbiterBlocked.delete(ruleId);
    this.arbiter.releaseAll('rule', ruleId);
    this.arbiter.releaseAll('backup_schedule', ruleId);
  }

  /** 개폐기 열림/닫힘 쌍을 하나로 묶는 키 — 둘 중 어느 쪽 id 로 와도 같다 */
  private async arbiterDeviceKey(device: Device): Promise<string> {
    const isOpener = device.equipmentType === 'opener_open' || device.equipmentType === 'opener_close';
    if (isOpener && device.pairedDeviceId) return [device.id, device.pairedDeviceId].sort()[0];
    return device.id;
  }

  /**
   * 이 룰이 지금 원하는 상태를 중재기에 등록하고, 더 우선하는 다른 룰에 밀리는 장치 id 를 돌려준다.
   * (이전: 우선순위 높은 룰이 먼저 실행된 뒤 낮은 룰이 같은 장치에 반대 명령을 덮어썼다.)
   */
  private async claimForRule(
    rule: AutomationRule,
    isOpener: boolean,
    hysteresisAction: 'on' | 'off' | 'hold' | undefined,
    source: ArbiterSource,
  ): Promise<{ blocked: Set<string>; total: number }> {
    const action: any = Array.isArray(rule.actions) ? rule.actions[0] : rule.actions;
    const targets = await this.resolveOpenerTargets(action, hysteresisAction)
      .then((t) => t ?? this.extractTargetDeviceIds(rule));
    const blocked = new Set<string>();
    for (const id of new Set(targets)) {
      const device = await this.devicesRepo.findOne({ where: { id } });
      if (!device) continue;
      const opener = device.equipmentType === 'opener_open' || device.equipmentType === 'opener_close';
      const want: Want = opener
        ? (device.equipmentType === 'opener_open' ? 'open' : 'close')
        : (action?.command === 'off' ? 'off' : 'on');
      const decision = this.arbiter.claim({
        deviceKey: await this.arbiterDeviceKey(device),
        source,
        key: rule.id,
        want,
        rulePriority: rule.priority ?? 0,
        label: rule.name,
        userId: rule.userId,
        deviceName: device.name,
      });
      if (!decision.allowed) {
        blocked.add(id);
        this.logger.log(`[arbiter] ${rule.name} → ${device.name} 보류: ${this.arbiter.explain(await this.arbiterDeviceKey(device))}`);
      }
    }
    return { blocked, total: new Set(targets).size };
  }

  async executeRule(rule: AutomationRule) {
    const evaluatedAt = new Date();

    // 고온 > 비: 비가 오는 중이면 고온 여부를 먼저 새로 판정해 닫힘 양보 상태를 맞춘다
    if (rule.groupId && this.rainOverride.getZoneState(rule.groupId).rainDetected) {
      await this.highTempOverride.isActive(rule.groupId).catch(() => false);
    }
    // 비 감지 우회: 개폐기 룰이고 해당 구역에 비 감지 우회 활성 시 즉시 skip
    if (this.rainOverride.isOpenerRainOverridden(rule.groupId) && await this.isOpenerRule(rule)) {
      this.dropState(rule.id);
      return { executed: false, reason: 'rain_override_active' };
    }

    let conditionResult: { matched: boolean; details: any; onceConditionHits: string[] } =
      await this.evaluateRuleConditions(rule, evaluatedAt);
    const isOpener = await this.isOpenerRule(rule);

    // 개폐기 룰의 온습도계 값이 오래됐으면(이머전시와 같은 규칙) 월별 시간표(백업)로 운전한다.
    // 비(우적) 닫힘은 위에서 이미 처리됐고, 고온 강제열림은 백업 방향보다 우선한다.
    let usingBackup = false;
    if (!conditionResult.matched && isOpener && this.checkRelayCycle(rule, evaluatedAt)) {
      const backup = await this.openerBackupAction(rule, evaluatedAt).catch((err) => {
        this.logger.warn(`[opener-backup] 판정 실패 ${rule.name}: ${err?.message ?? err}`);
        return null;
      });
      if (backup) {
        usingBackup = true;
        conditionResult = {
          matched: true,
          details: {
            type: 'opener_backup',
            reason: backup.reason,
            groups: [{ logic: 'AND', conditions: [{ matched: true, hysteresisAction: backup.action, backup: true }] }],
          },
          onceConditionHits: [] as string[],
        };
        await this.notifyBackupStart(rule, backup).catch(() => undefined);
      }
    }
    if (!usingBackup) this.backupActive.delete(rule.id);

    // 히스테리시스 '유지' 구간(켜는 기준과 끄는 기준 사이): 켜져 있던 장비는 그대로 둔다.
    // (이전: 유지 구간을 '조건 불충족'으로 처리해 켜는 기준 바로 아래에서 꺼졌다 — 히스테리시스 무력화.)
    // 개폐기는 유지 구간에서 멈추는 것이 맞으므로 제외.
    let holdAsOn = false;
    if (!conditionResult.matched && !isOpener && this.isHysteresisHold(conditionResult.details)) {
      const wasOn = this.lastState.get(rule.id)?.matched || (await this.ruleOwnsRunningDevice(rule));
      if (!wasOn) {
        return { executed: false, reason: 'hysteresis_hold_idle', details: conditionResult.details };
      }
      holdAsOn = true;
    }

    if (!conditionResult.matched && !holdAsOn) {
      // 룰 active → inactive 전환: 대상 device의 relayActivePhase 해제 + switchState=false
      const prev = this.lastState.get(rule.id);
      if (prev?.matched) {
        await this.clearRelayActivePhase(rule).catch(err =>
          this.logger.warn(`relayActivePhase 해제 실패: ${err.message}`)
        );
        await this.notifyIfSensorStale(rule).catch(() => undefined);
      }
      this.dropState(rule.id);
      return { executed: false, reason: 'conditions_not_met', details: conditionResult.details };
    }
    this.staleNotified.delete(rule.id);

    // 장치 목표 상태 중재 — 룰이 끝나는 중(비-개폐기의 히스테리시스 '끄기')이 아니면 요청을 등록하고,
    // 같은 장치를 반대로 원하는 더 우선하는 룰이 있으면 이 룰은 이번 평가에서 그 장치를 건드리지 않는다.
    {
      const endingNonOpener = !isOpener && !holdAsOn
        && this.extractHysteresisAction(conditionResult.details) === 'off'
        && (Array.isArray(rule.actions) ? rule.actions[0] : rule.actions)?.command !== 'off';
      if (endingNonOpener) {
        this.arbiter.releaseAll('rule', rule.id);
        this.arbiterBlocked.delete(rule.id);
      } else {
        const claimAction = holdAsOn ? 'on' : this.extractHysteresisAction(conditionResult.details);
        const { blocked, total } = await this.claimForRule(rule, isOpener, claimAction, usingBackup ? 'backup_schedule' : 'rule');
        if (blocked.size > 0 && blocked.size >= total) {
          this.lastState.delete(rule.id); // 요청은 유지(충돌 추적), 실행 상태만 비운다
          this.arbiterBlocked.delete(rule.id);
          return { executed: false, reason: 'arbiter_blocked', blocked: [...blocked] };
        }
        if (blocked.size > 0) this.arbiterBlocked.set(rule.id, blocked);
        else this.arbiterBlocked.delete(rule.id);
      }
    }

    // 릴레이 모드 체크: 조건이 매칭된 시간 범위 내에서 ON/OFF 사이클 실행
    // 히스테리시스(방향: on=열기, off=닫기)를 먼저 산출 — 사이클 anchor/10분 캡의 세션 경계 판정용.
    const hysteresisAction = holdAsOn ? 'on' : this.extractHysteresisAction(conditionResult.details);
    const targetIds = this.extractTargetDeviceIds(rule);
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
        && isOpener
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
        if (!isOpener) {
          const wasActive = this.lastState.get(rule.id)?.matched === true;
          // 항상 clearRelayActivePhase 호출 — backend 재시작으로 lastState 캐시가 비어있어도
          // device.deviceSettings.relayActivePhase가 남아있으면 정리 (내부에서 idempotent)
          await this.clearRelayActivePhase(rule).catch(err =>
            this.logger.warn(`relayActivePhase 해제 실패: ${err.message}`)
          );
          this.dropState(rule.id);
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
      this.lastState.set(rule.id, { matched: true, relayOnPhase: relayResult.isOnPhase, hysteresisAction, cycleAnchorMs, directionStartMs, targetIds });
      return this.executeRelayAction(rule, relayResult, hysteresisAction, isNewActivation);
    }

    // 주기 없는 히스테리시스 룰: 끄는 기준 이하로 내려가면 이 룰이 켠 장비를 끈다.
    // (이전: 방향을 보지 않고 액션을 그대로 실행 → 낮은 값에서 ON 을 다시 보내고, 꺼지는 경로가 없었다.)
    const actionCommand = (Array.isArray(rule.actions) ? rule.actions[0] : rule.actions)?.command;
    if (hysteresisAction === 'off' && !isOpener && actionCommand !== 'off') {
      const wasActive = this.lastState.get(rule.id)?.matched === true || (await this.ruleOwnsRunningDevice(rule));
      await this.clearRelayActivePhase(rule).catch(err =>
        this.logger.warn(`룰 종료 처리 실패: ${err.message}`)
      );
      this.dropState(rule.id);
      if (wasActive) {
        await this.logsRepo.save(
          this.logsRepo.create({
            ruleId: rule.id,
            userId: rule.userId,
            success: true,
            conditionsMet: {
              ...conditionResult.details,
              ruleName: rule.name,
              hysteresisAction: 'off',
              equipmentType: (rule.actions as any)?.equipmentType || null,
              deactivated: true,
            },
            actionsExecuted: { deviceNames: [], command: 'off' },
          }),
        ).catch(err => this.logger.warn(`룰 종료 로그 저장 실패: ${err?.message ?? err}`));
      }
      return { executed: false, reason: 'hysteresis_off' };
    }

    // 일반 자동화: 이미 조건 충족 중이면 중복 실행 방지
    const prev = this.lastState.get(rule.id);
    if (prev?.matched) {
      return { executed: false, reason: 'already_active' };
    }
    this.lastState.set(rule.id, { matched: true, hysteresisAction, targetIds });

    const actionResults: any[] = [];
    let success = true;
    let errorMessage: string | undefined;

    try {
      const actions = Array.isArray(rule.actions) ? rule.actions : [rule.actions];
      for (const action of actions) {
        const executed = await this.executeAction(rule, action);
        actionResults.push(executed);
      }
      // 히스테리시스 룰이 켠 장비에 '이 룰이 켰다'는 표시를 남긴다 → 끄는 기준에서 이 룰이 끌 수 있다.
      if (hysteresisAction === 'on' && actionCommand !== 'off') {
        await this.markRuleOwnership(rule, actionResults).catch(() => undefined);
      }

      // 대상 장비가 전부 수동/타이머/방재로 건너뛰어졌으면 '한 번 실행' 조건을 소진하지 않고,
      // 다음 평가에서 다시 시도한다(이전: 실행 안 됐는데 소진·비활성화되던 문제).
      const allSkipped = actionResults.length > 0 && actionResults.every((r: any) =>
        Array.isArray(r?.devices) && r.devices.length > 0 && r.devices.every((d: any) => d.skipped));
      if (allSkipped) {
        this.lastState.delete(rule.id);
        this.logger.log(`[once-defer] ${rule.name}: 대상 장비 모두 수동/타이머 우선 — 실행·소진 보류`);
      } else if (conditionResult.onceConditionHits.length > 0) {
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
      // 구역 장치 = group_devices 직접 매핑 ∪ 구역에 연결된 게이트웨이의 장치 (migration 053)
      groupFilter = `AND (
        d.id IN (SELECT gd.device_id FROM group_devices gd WHERE gd.group_id = $2::uuid)
        OR g.group_id = $2::uuid
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
      LEFT JOIN gateways g ON g.id::text = d.gateway_id
      WHERE sd.user_id = $1::uuid
        AND sd.time > now() - make_interval(mins => ${SENSOR_MAX_AGE_MIN})
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
        AND time > now() - make_interval(mins => ${SENSOR_MAX_AGE_MIN})
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
           AND sd.time > now() - make_interval(mins => ${SENSOR_MAX_AGE_MIN})
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
      // 이 구역을 소유한 농장의 날씨만 사용 (이전: 농장 구분 없이 최신 1건 → 다른 농장 날씨로 동작할 수 있었음)
      const latestWeather = await this.dataSource.query(
        `SELECT temperature, humidity, precipitation, wind_speed
         FROM weather_data
         WHERE user_id::text = (SELECT user_id::text FROM house_groups WHERE id::text = $1)
           AND time > now() - make_interval(mins => ${WEATHER_MAX_AGE_MIN})
         ORDER BY time DESC LIMIT 1`,
        [groupId],
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
    const arbiterSkip = this.arbiterBlocked.get(rule.id);
    for (const device of candidateDevices) {
      if (arbiterSkip?.has(device.id)) {
        results.push({ deviceId: device.id, deviceName: device.name, success: true, skipped: true });
        continue;
      }
      // 수동/타이머 우회 활성 device 는 룰 실행 대상에서 제외(relay 경로와 동일). 만료 시 자동 복귀.
      if (isGatewayLatched(device.gatewayId)) {
        this.logger.log(`[emergency] ${device.name} 비상 정지 유지 중 — 룰 실행 skip (rule=${rule.name})`);
        results.push({ deviceId: device.id, deviceName: device.name, success: true, skipped: true });
        continue;
      }
      if (isManuallyHeld(device.deviceSettings)) {
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
    // 구역의 장치 = 구역에 연결된 게이트웨이의 장치 ∪ group_devices 직접 매핑 (migration 053)
    // (이전: devices.house_id 경로만 — house_id 가 비거나 어긋난 장치는 룰 대상에서 빠짐)
    const qb = this.devicesRepo
      .createQueryBuilder('d')
      .leftJoin('gateways', 'g', 'g.id::text = d.gateway_id')
      .where('d.user_id = :userId', { userId: rule.userId })
      .andWhere('d.device_type = :deviceType', { deviceType: 'actuator' });

    if (rule.groupId) {
      qb.andWhere(
        '(g.group_id = CAST(:groupId AS uuid) OR d.id IN (SELECT gd.device_id FROM group_devices gd WHERE gd.group_id = CAST(:groupId AS uuid)))',
        { groupId: rule.groupId },
      );
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

  /**
   * 히스테리시스 '유지' 구간인가 — 유지(hold) 조건을 충족으로 치면 룰 전체가 성립하고,
   * 실제로 유지 조건이 하나 이상 있을 때.
   */
  private isHysteresisHold(details: any): boolean {
    if (!Array.isArray(details?.groups)) return false;
    let anyHold = false;
    const groupResults = details.groups.map((g: any) => {
      const results = (g.conditions || []).map((c: any) => {
        if (c.hysteresisAction === 'hold') { anyHold = true; return true; }
        return !!c.matched;
      });
      return g.logic === 'OR' ? results.some(Boolean) : results.every(Boolean);
    });
    if (!anyHold) return false;
    return details.logic === 'OR' ? groupResults.some(Boolean) : groupResults.every(Boolean);
  }

  /** 이 룰이 켜 둔 장비가 아직 켜져 있는가 (서버 재시작으로 메모리 상태가 비어도 유지 구간을 이어가기 위해) */
  private async ruleOwnsRunningDevice(rule: AutomationRule): Promise<boolean> {
    for (const id of this.extractTargetDeviceIds(rule)) {
      const dev = await this.devicesRepo.findOne({ where: { id } });
      const s: any = dev?.deviceSettings;
      if (s?.switchState === true && s.relayActiveRuleId === rule.id) return true;
    }
    return false;
  }

  /** 주기 없는 히스테리시스 룰이 켠 장비에 소유 표시(relayActiveRuleId) — 다른 필드는 건드리지 않는다 */
  private async markRuleOwnership(rule: AutomationRule, actionResults: any[]): Promise<void> {
    const ids = actionResults
      .flatMap((r: any) => r?.devices || [])
      .filter((d: any) => d?.success && !d.skipped && d.deviceId)
      .map((d: any) => d.deviceId as string);
    for (const id of new Set<string>(ids)) {
      await this.devicesRepo.query(
        `UPDATE devices SET device_settings = jsonb_set(COALESCE(device_settings, '{}'::jsonb), '{relayActiveRuleId}', to_jsonb($2::text)) WHERE id::text = $1`,
        [id, rule.id],
      );
    }
  }

  /** 같은 장비를 지금 켜 두고 있는 다른 룰 (있으면 이 룰이 끝나도 끄지 않고 소유만 넘긴다) */
  private otherActiveRuleFor(deviceId: string, exceptRuleId: string): string | null {
    for (const [ruleId, st] of this.lastState) {
      if (ruleId === exceptRuleId || !st.matched || st.hysteresisAction === 'off') continue;
      if (st.targetIds?.includes(deviceId)) return ruleId;
    }
    return null;
  }

  /** 룰 조건이 참조하는 센서 중 최근 SENSOR_MAX_AGE_MIN 분 안에 값이 없는 것 */
  private async findStaleSensors(rule: AutomationRule): Promise<Array<{ id: string; name: string }>> {
    const sensorIds = [...new Set<string>(
      ((rule.conditions as any)?.groups || [])
        .flatMap((g: any) => g.conditions || [])
        .map((c: any) => c.sensor_device_id)
        .filter(Boolean),
    )];
    if (sensorIds.length === 0) return [];
    return this.dataSource.query(
      `SELECT d.id::text AS id, d.name FROM devices d
       WHERE d.id::text = ANY($1)
         AND NOT EXISTS (SELECT 1 FROM sensor_data sd WHERE sd.device_id = d.id
                         AND sd.time > now() - make_interval(mins => $2))`,
      [sensorIds, SENSOR_MAX_AGE_MIN],
    );
  }

  /** 룰이 멈춘 이유가 센서 끊김이면 한 번 알린다 */
  private async notifyIfSensorStale(rule: AutomationRule): Promise<void> {
    if (this.staleNotified.has(rule.id)) return;
    const rows = await this.findStaleSensors(rule);
    if (rows.length === 0) return;
    this.staleNotified.add(rule.id);
    const names = rows.map((r) => r.name).join(', ');
    this.logger.warn(`[stale-sensor] ${rule.name}: ${names} 값이 ${SENSOR_MAX_AGE_MIN}분 넘게 없음 → 자동 제어 중지`);
    this.eventsGateway.sendNotification(rule.userId, {
      type: 'warning',
      title: '⚠️ 자동 제어 중지',
      message: `측정기(${names}) 값이 ${SENSOR_MAX_AGE_MIN}분 넘게 들어오지 않아 "${rule.name}" 자동 제어를 멈추고 장비를 껐습니다. 측정기를 확인해 주세요.`,
    });
  }

  /**
   * 개폐기 백업 판정 — 이머전시(Pi 폴백)와 같은 규칙.
   * 룰이 참조하는 온습도계 값이 SENSOR_MAX_AGE_MIN 분 넘게 없으면, 그 게이트웨이의 월별 시간표로 열림/닫힘을 정한다.
   *  - 시간표 없음/꺼짐, 개폐기 폴백 꺼짐: null (기존처럼 룰 중지)
   *  - mode 'always-open': 열림, 'time': openTime~closeTime 사이 열림(자정 넘김 지원), 그 밖 닫힘
   *  - 고온 강제열림이 활성이면(고온 센서 정상) 시간표가 닫힘이어도 열림
   */
  private async openerBackupAction(
    rule: AutomationRule,
    now: Date,
  ): Promise<{ action: 'on' | 'off'; reason: string; sensors: string } | null> {
    const stale = await this.findStaleSensors(rule);
    if (stale.length === 0) return null;
    const targetId = this.extractTargetDeviceIds(rule)[0];
    if (!targetId) return null;
    const month = now.getMonth() + 1;
    const rows: any[] = await this.dataSource.query(
      `SELECT fc.opener_enabled AS "openerEnabled", s.enabled, s.mode,
              to_char(s.open_time, 'HH24:MI') AS "openTime", to_char(s.close_time, 'HH24:MI') AS "closeTime"
       FROM devices d
       JOIN gateways g ON g.id::text = d.gateway_id OR g.gateway_id = d.gateway_id
       JOIN fallback_configs fc ON fc.gateway_id = g.gateway_id
       JOIN fallback_opener_schedule s ON s.gateway_id = g.gateway_id AND s.month = $2
       WHERE d.id = $1::uuid
       LIMIT 1`,
      [targetId, month],
    );
    const sch = rows[0];
    if (!sch || sch.openerEnabled === false || !sch.enabled) return null;

    const sensors = stale.map((r) => r.name).join(', ');
    let open: boolean;
    let reason: string;
    if (sch.mode === 'always-open') {
      open = true;
      reason = `${month}월 시간표: 항상 열림`;
    } else if (sch.mode === 'time' && sch.openTime && sch.closeTime) {
      const toMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
      const cur = now.getHours() * 60 + now.getMinutes();
      const o = toMin(sch.openTime);
      const c = toMin(sch.closeTime);
      open = o <= c ? (cur >= o && cur < c) : (cur >= o || cur < c);
      reason = `${month}월 시간표 ${sch.openTime}~${sch.closeTime}: ${open ? '열림' : '닫힘'} 시간대`;
    } else {
      return null;
    }
    if (!open && await this.highTempOverride.isActive(rule.groupId)) {
      open = true;
      reason += ' → 고온 강제열림 우선';
    }
    return { action: open ? 'on' : 'off', reason, sensors };
  }

  private async notifyBackupStart(rule: AutomationRule, b: { reason: string; sensors: string }): Promise<void> {
    if (this.backupActive.has(rule.id)) return;
    this.backupActive.add(rule.id);
    this.logger.warn(`[opener-backup] ${rule.name}: ${b.sensors} 값이 ${SENSOR_MAX_AGE_MIN}분 넘게 없음 → 월별 시간표로 운전 (${b.reason})`);
    this.eventsGateway.sendNotification(rule.userId, {
      type: 'warning',
      title: '⚠️ 측정기 이상 — 시간표로 개폐기 운전',
      message: `측정기(${b.sensors}) 값이 ${SENSOR_MAX_AGE_MIN}분 넘게 들어오지 않아 "${rule.name}"을(를) 이머전시와 같은 월별 시간표로 운전합니다. (${b.reason}) 측정기를 확인해 주세요.`,
    });
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

  // 개폐기 페어(opener_open/opener_close)에서 hysteresisAction에 맞는 대상 장치를 선택.
  // 다중 개폐기 룰(여러 그룹을 targetDeviceIds로 지정)이면 각 개폐기를 방향에 맞는 장치로 매핑.
  private async resolveOpenerTargets(action: any, hysteresisAction?: 'on' | 'off' | 'hold'): Promise<string[] | null> {
    if (!hysteresisAction || hysteresisAction === 'hold') return null;
    const ids = [
      ...(action?.targetDeviceId ? [action.targetDeviceId] : []),
      ...(Array.isArray(action?.targetDeviceIds) ? action.targetDeviceIds : []),
    ];
    if (ids.length === 0) return null;
    // 'on' (측정값 ≥ ON 임계값) → 열림 장치, 'off' (≤ OFF 임계값) → 닫힘 장치
    const wantOpen = hysteresisAction === 'on';
    const result = new Set<string>();
    let anyOpener = false;
    for (const id of new Set<string>(ids)) {
      const device = await this.devicesRepo.findOne({ where: { id } });
      if (!device) continue;
      const isOpener = device.equipmentType === 'opener_open' || device.equipmentType === 'opener_close';
      if (!isOpener) { result.add(id); continue; } // 개폐기 아닌 대상은 그대로 통과
      anyOpener = true;
      if ((wantOpen && device.equipmentType === 'opener_open')
        || (!wantOpen && device.equipmentType === 'opener_close')) {
        result.add(device.id);
      } else if (device.pairedDeviceId) {
        result.add(device.pairedDeviceId); // 반대편 페어로 스위칭
      } else {
        result.add(device.id);
      }
    }
    if (!anyOpener) return null; // 개폐기 대상이 하나도 없으면 일반 경로 사용
    return [...result];
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
  /**
   * 룰이 켜 둔(relayActiveRuleId = 이 룰, switchState=true) 장비에 OFF 를 실제로 발행.
   * 사용자가 수동으로 잡고 있는(userOverride) 장비·관수 장비는 건드리지 않는다.
   */
  private async turnOffIfRuleOwned(device: Device, rule: AutomationRule, settings: any) {
    if (!settings?.switchState || settings.relayActiveRuleId !== rule.id || settings.userOverride) return;
    if (device.equipmentType === 'irrigation') return;
    try {
      await this.devicesService.controlDevice(device.id, rule.userId, [{ code: 'switch_1', value: false }], undefined, 'automation');
      this.logger.log(`[rule-end] ${rule.name} 종료/비활성 → ${device.name} OFF`);
    } catch (err: any) {
      this.logger.warn(`[rule-end] ${device.name} OFF 실패: ${err?.message ?? err}`);
    }
  }

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
        // 활성 타이머 override(overrideUntil 미래)는 룰 inactive 전환이 지우면 안 된다.
        // 타이머는 사용자가 시간제로 건 독립 의도(만료/취소로만 해제) — 여기서 userOverride 를
        // 지우면 다음 틱에 러너가 장치를 다시 잡아 '타이머 중 자동화룰 동작' 버그가 발생한다.
        if (settings.overrideUntil && new Date(settings.overrideUntil).getTime() > Date.now()) {
          continue;
        }
        // 같은 장비를 다른 룰이 지금 켜 두고 있으면 끄지 않고 소유만 넘긴다
        // (이전: 룰 하나가 끝나면 장비를 꺼 버리고, 아직 유효한 다른 룰은 다시 켜지 않았다.)
        const other = this.otherActiveRuleFor(t.id, rule.id);
        if (other && settings.switchState) {
          if (settings.relayActiveRuleId !== other) {
            settings.relayActiveRuleId = other;
            t.deviceSettings = settings;
            await this.devicesRepo.save(t);
          }
          this.logger.log(`[rule-end] ${rule.name} 종료 — ${t.name} 은 다른 룰이 가동 중이라 유지`);
          continue;
        }
        if (settings.relayActivePhase || settings.switchState
          || settings.ruleIntendedState != null || settings.userOverride) {
          // 이 룰이 켜 둔 장비면 실제로 OFF 발행 (이전: DB 표시만 '꺼짐'으로 바꾸고 장비는 켜진 채 남음)
          await this.turnOffIfRuleOwned(t, rule, settings);
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
      if (dev && (isManuallyHeld(dev.deviceSettings) || isGatewayLatched(dev.gatewayId))) {
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
