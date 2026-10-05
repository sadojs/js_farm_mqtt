import { Inject, Injectable, Logger, OnApplicationBootstrap, forwardRef } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AutomationRule } from './entities/automation-rule.entity';
import { AutomationLog } from './entities/automation-log.entity';
import { Device } from '../devices/entities/device.entity';
import { Gateway } from '../gateway-manager/entities/gateway.entity';
import { MqttService } from '../mqtt/mqtt.service';
import { EventsGateway } from '../gateway/events.gateway';
import { DevicesService } from '../devices/devices.service';

interface ScheduledAction {
  time: number; // ms offset from start
  type: 'zone_on' | 'zone_off' | 'mixer_on' | 'mixer_off' | 'fertilizer_on' | 'fertilizer_off';
  switchCode: string;
  value: boolean;
  label: string;
  /** 구역 액션의 기능 키(zone_1 등) — 수동 타이머가 잡고 있는 구역이면 건너뛰기 위해 */
  fnKey?: string;
}

/** 서버 재시작에도 남는 관수 진행 표시 (device_settings.irrigationRun) */
interface IrrigationRunMarker {
  ruleId: string;
  ruleName: string;
  startedAt: string;
  estimatedEndAt: string;
}

interface ActiveIrrigation {
  ruleId: string;
  ruleName: string;
  userId: string;
  deviceId: string;
  gatewayId: string;
  friendlyName: string;
  device: Device;       // setTimeout 시점에 source/매핑 그대로 사용
  gateway: Gateway;     // onboard 라우팅에 gateway.id (UUID) 필요
  startedAt: number;
  estimatedEndAt: number;
  timers: ReturnType<typeof setTimeout>[];
}

// zone 번호 → function_key 매핑 (실제 switch 코드는 장비별 channelMapping에서 결정)
const ZONE_FUNCTION_KEY: Record<number, string> = {
  1: 'zone_1',
  2: 'zone_2',
  3: 'zone_3',
  4: 'zone_4',
};

@Injectable()
export class IrrigationSchedulerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(IrrigationSchedulerService.name);
  private activeIrrigations = new Map<string, ActiveIrrigation>();

  constructor(
    @InjectRepository(AutomationRule)
    private readonly rulesRepo: Repository<AutomationRule>,
    @InjectRepository(AutomationLog)
    private readonly logsRepo: Repository<AutomationLog>,
    @InjectRepository(Device)
    private readonly devicesRepo: Repository<Device>,
    @InjectRepository(Gateway)
    private readonly gatewayRepo: Repository<Gateway>,
    private readonly mqttService: MqttService,
    private readonly eventsGateway: EventsGateway,
    @Inject(forwardRef(() => DevicesService))
    private readonly devicesService: DevicesService,
  ) {}

  @Cron('0 * * * * *') // 매분 0초에 실행
  async checkIrrigationRules() {
    const rules = await this.rulesRepo.find({ where: { enabled: true } });
    const now = new Date();

    for (const rule of rules) {
      const conditions = rule.conditions as any;
      if (conditions?.type !== 'irrigation') continue;
      if (this.activeIrrigations.has(rule.id)) continue;

      if (this.shouldStartNow(conditions, now)) {
        this.logger.log(`관수 스케줄 시작: ${rule.name} (${rule.id})`);
        await this.startIrrigation(rule, conditions);
      }
    }
  }

  /** 즉시 1회 관수 (음성·즉시실행) — 룰 조건(시각)은 바꾸지 않는다 */
  async startNow(rule: AutomationRule) {
    if (this.activeIrrigations.has(rule.id)) return { started: false, reason: 'already_running' };
    await this.startIrrigation(rule, rule.conditions as any);
    return { started: this.activeIrrigations.has(rule.id) };
  }

  private shouldStartNow(conditions: any, now: Date): boolean {
    const scheduleList = (conditions.schedules && conditions.schedules.length > 0)
      ? conditions.schedules
      : [{ startTime: conditions.startTime, days: conditions.schedule?.days ?? [], repeat: conditions.schedule?.repeat ?? true }];

    return scheduleList.some((sched: any) => {
      if (!sched.startTime || !sched.days?.includes(now.getDay())) return false;
      const [h, m] = sched.startTime.split(':').map(Number);
      return now.getHours() === h && now.getMinutes() === m;
    });
  }

  private async startIrrigation(rule: AutomationRule, conditions: any) {
    try {
      await this._startIrrigationInternal(rule, conditions);
    } catch (err: any) {
      this.logger.error(`관수 시작 실패: ${rule.name} - ${err.message}`, err.stack);
    }
  }

  private async _startIrrigationInternal(rule: AutomationRule, conditions: any) {
    const actions = rule.actions as any;
    const deviceIds = actions?.targetDeviceIds || (actions?.targetDeviceId ? [actions.targetDeviceId] : []);
    if (deviceIds.length === 0) {
      this.logger.warn(`관수 룰 ${rule.id}: 대상 장비 없음`);
      return;
    }

    const device = await this.devicesRepo.findOne({ where: { id: deviceIds[0] } });
    if (!device) {
      this.logger.warn(`관수 룰 ${rule.id}: 장비 찾을 수 없음`);
      return;
    }

    if (!device.gatewayId || !device.friendlyName) {
      this.logger.warn(`관수 룰 ${rule.id}: 장비에 게이트웨이 또는 friendlyName 없음`);
      return;
    }

    const gateway = await this.gatewayRepo.findOne({ where: { id: device.gatewayId } });
    if (!gateway) {
      this.logger.warn(`관수 룰 ${rule.id}: 게이트웨이를 찾을 수 없음`);
      return;
    }

    // 수동 타이머(채널 override)가 걸린 구역은 이번 관수에서 제외 (이전: 구역 하나라도 있으면 스케줄 전체 스킵)
    const heldZones = this.heldChannelKeys(device);

    // 장비 채널 매핑 로드
    const mapping = this.devicesService.getEffectiveMapping(device);

    // 원격제어(remote_control) OFF 상태면 스케줄 스킵 — 상태는 device_settings.switchStates 에 기록됨
    // (이전: 존재하지 않는 device.switchStates 를 봐서 항상 통과하던 문제 수정)
    const remoteControlSwitch = mapping['remote_control'];
    const savedStates = (device.deviceSettings as any)?.switchStates;
    if (remoteControlSwitch && savedStates && savedStates[remoteControlSwitch] === false) {
      this.logger.log(`관수 스케줄 스킵: 원격제어(${remoteControlSwitch}) OFF - ${rule.name}`);
      return;
    }

    // 타임라인 생성 — 수동 타이머가 잡고 있는 구역 제외
    const effectiveConditions = heldZones.size
      ? { ...conditions, zones: (conditions.zones || []).filter((z: any) => !heldZones.has(ZONE_FUNCTION_KEY[z.zone])) }
      : conditions;
    if (heldZones.size) {
      this.logger.log(`관수: 수동 타이머 구역 제외 (${[...heldZones].join(', ')}) - ${rule.name}`);
    }
    const timeline = this.buildTimeline(effectiveConditions, mapping);
    if (timeline.length === 0) {
      this.logger.log(`관수 스케줄 스킵: 실행할 구역 없음 - ${rule.name}`);
      return;
    }
    this.logger.log(`관수 타임라인 (${timeline.length}개 액션): ${JSON.stringify(timeline.map(a => ({ t: Math.round(a.time / 60000), type: a.type, sw: a.switchCode })))}`);

    // 타이머 등록
    const timers: ReturnType<typeof setTimeout>[] = [];
    const totalDurationMs = timeline.length > 0 ? timeline[timeline.length - 1].time + 5000 : 0;
    const active: ActiveIrrigation = {
      ruleId: rule.id,
      ruleName: rule.name,
      userId: rule.userId,
      deviceId: deviceIds[0],
      gatewayId: gateway.gatewayId,
      friendlyName: device.friendlyName,
      device,
      gateway,
      startedAt: Date.now(),
      estimatedEndAt: Date.now() + totalDurationMs,
      timers,
    };
    this.activeIrrigations.set(rule.id, active);
    await this.setRunMarker(active.deviceId, {
      ruleId: rule.id,
      ruleName: rule.name,
      startedAt: new Date(active.startedAt).toISOString(),
      estimatedEndAt: new Date(active.estimatedEndAt).toISOString(),
    });

    // 관수 시작 이벤트
    this.eventsGateway.emitIrrigationStarted({
      userId: rule.userId,
      ruleId: rule.id,
      ruleName: rule.name,
      deviceId: deviceIds[0],
      tuyaDeviceId: device.friendlyName,
      startedAt: active.startedAt,
      estimatedEndAt: active.estimatedEndAt,
    });

    // 관수 시작 로그 기록 (mapping에 실제 존재하는 구역만 집계)
    const enabledZones = conditions.zones.filter((z: any) => z.enabled && mapping[ZONE_FUNCTION_KEY[z.zone]]);
    const totalIrrigationMin = enabledZones.reduce((sum: number, z: any) => sum + (z.duration || 0), 0);
    const fertilizerMin = conditions.fertilizer?.enabled ? (conditions.fertilizer.duration || 0) : 0;
    const groupName = await this.fetchGroupName(rule.groupId);
    await this.logsRepo.save(
      this.logsRepo.create({
        ruleId: rule.id,
        userId: rule.userId,
        success: true,
        conditionsMet: {
          type: 'irrigation_started',
          startTime: conditions.startTime,
          deviceName: device.name,
          groupName,
          enabledZones: enabledZones.length,
          totalZones: conditions.zones.length,
          irrigationMin: totalIrrigationMin,
          fertilizerMin,
        },
        actionsExecuted: { status: 'started', estimatedDurationMin: Math.round(totalDurationMs / 60000) },
      }),
    );

    for (const action of timeline) {
      const timer = setTimeout(async () => {
        try {
          // 관수 도중 사용자가 이 구역에 수동 타이머를 걸었으면 그 구역 명령은 건너뜀(타이머 우선)
          if (action.fnKey) {
            const fresh = await this.devicesRepo.findOne({ where: { id: active.deviceId } });
            if (fresh && this.heldChannelKeys(fresh).has(action.fnKey)) {
              this.logger.log(`관수 명령 건너뜀(수동 타이머 우선): ${action.label}`);
              return;
            }
          }
          this.logger.log(`관수 실행: ${action.label} (${action.switchCode}=${action.value})`);
          // device.source에 따라 onboard(gpio-agent) / zigbee(z2m) 자동 라우팅
          await this.devicesService.publishDeviceSwitch(active.device, active.gateway, action.switchCode, action.value);
        } catch (err: any) {
          this.logger.error(`관수 명령 실패: ${action.label} - ${err.message}`);
        }
      }, action.time);
      timers.push(timer);
    }

    // 마지막 액션 이후 정리
    const cleanupTimer = setTimeout(async () => {
      try {
        // 관수 종료 이벤트
        this.eventsGateway.emitIrrigationStopped({
          userId: rule.userId,
          ruleId: rule.id,
          tuyaDeviceId: device.friendlyName,
        });
        this.activeIrrigations.delete(rule.id);
        await this.clearRunMarker(active.deviceId);
        this.logger.log(`관수 완료: ${rule.name}`);

        // 비반복: 이번 주 남은 요일이 없으면 비활성화
        // 주간 순서: 월(1)→화(2)→수(3)→목(4)→금(5)→토(6)→일(0)
        if (conditions.schedule?.repeat === false) {
          const today = new Date().getDay();
          const days: number[] = conditions.schedule?.days || [];
          const todayOrder = today === 0 ? 7 : today;
          const hasRemaining = days.some(d => {
            const dOrder = d === 0 ? 7 : d;
            return dOrder > todayOrder;
          });
          if (!hasRemaining) {
            rule.enabled = false;
            await this.rulesRepo.save(rule);
            this.logger.log(`관수 비반복 룰 비활성화 (이번 주 완료): ${rule.name}`);
          } else {
            this.logger.log(`관수 비반복 룰 유지: 이번 주 남은 요일 있음 - ${rule.name}`);
          }
        }

        // 로그 기록
        await this.logsRepo.save(
          this.logsRepo.create({
            ruleId: rule.id,
            userId: rule.userId,
            success: true,
            conditionsMet: {
              type: 'irrigation',
              startTime: conditions.startTime,
              startedAt: new Date(active.startedAt).toISOString(),  // 실제 시작 timestamp
              endedAt: new Date().toISOString(),                     // 실제 종료 timestamp
              deviceName: device.name,
              groupName: await this.fetchGroupName(rule.groupId),
              enabledZones: conditions.zones.filter((z: any) => z.enabled && mapping[ZONE_FUNCTION_KEY[z.zone]]).length,
              totalZones: conditions.zones.length,
              irrigationMin: conditions.zones.filter((z: any) => z.enabled && mapping[ZONE_FUNCTION_KEY[z.zone]]).reduce((s: number, z: any) => s + (z.duration || 0), 0),
              fertilizerMin: conditions.fertilizer?.enabled ? (conditions.fertilizer.duration || 0) : 0,
            },
            actionsExecuted: { timeline: timeline.map(a => a.label), estimatedDurationMin: Math.round(totalDurationMs / 60000) },
          }),
        );

        this.eventsGateway.broadcastAutomationExecuted(rule.userId, {
          ruleId: rule.id,
          ruleName: rule.name,
          success: true,
          actions: [{ type: 'irrigation_complete' }],
        });
      } catch (err: any) {
        this.logger.error(`관수 정리 실패: ${rule.name} - ${err.message}`);
      }
    }, totalDurationMs);
    timers.push(cleanupTimer);
  }

  /**
   * 관수 타임라인 생성
   *
   * 예: 10:00 시작, 관수 30분, 대기 5분, 액비투여 10분, 종료전대기 5분
   *
   * 10:00  1구역 ON + 교반기 ON
   * 10:15  액비모터 ON  (30 - 10 - 5 = 15분 후)
   * 10:25  액비모터 OFF (30 - 5 = 25분 후)
   * 10:30  1구역 OFF + 교반기 OFF
   * 10:30~10:35  대기 (모두 OFF)
   * 10:35  2구역 ON + 교반기 ON → 이하 반복
   */
  private buildTimeline(conditions: any, mapping: Record<string, string>): ScheduledAction[] {
    const actions: ScheduledAction[] = [];
    const zones = (conditions.zones || [])
      .filter((z: any) => z.enabled)
      .sort((a: any, b: any) => a.zone - b.zone);
    const fertilizer = conditions.fertilizer || { enabled: false, duration: 0, preStopWait: 0 };
    const fertEnabled = fertilizer.enabled !== false && fertilizer.duration > 0;
    const fertDurationMs = fertilizer.duration * 60000;
    const fertPreStopMs = fertilizer.preStopWait * 60000;

    let offsetMs = 0;

    for (const zone of zones) {
      const zoneDurationMs = zone.duration * 60000;
      const waitTimeMs = (zone.waitTime || 0) * 60000;
      const fnKey = ZONE_FUNCTION_KEY[zone.zone];
      if (!fnKey) continue;
      const switchCode = mapping[fnKey];
      if (!switchCode) continue;

      // 1) 구역 ON
      actions.push({
        time: offsetMs,
        type: 'zone_on',
        switchCode,
        value: true,
        label: `${zone.name} ON`,
        fnKey,
      });

      // 2) 교반기 ON (관수 시작과 동시, 관수 종료와 동시에 OFF)
      //    [정정 2026-05-26]: 액비모터가 활성화되어 있을 때만 교반기 동작.
      //    교반기의 목적은 액상비료를 물에 잘 녹이는 것이므로 액비가 없으면 동작 불필요.
      const mixerActive = !!(conditions.mixer?.enabled && fertEnabled && mapping['mixer']);
      if (mixerActive) {
        actions.push({
          time: offsetMs,
          type: 'mixer_on',
          switchCode: mapping['mixer'],
          value: true,
          label: `교반기 ON (${zone.name})`,
        });
      }

      // 3) 액비모터 ON/OFF
      //    시작: 관수시간 - (투여시간 + 종료전대기)
      //    종료: 관수시간 - 종료전대기
      if (fertEnabled && mapping['fertilizer_motor']) {
        const fertStartMs = zoneDurationMs - fertDurationMs - fertPreStopMs;
        const fertEndMs = zoneDurationMs - fertPreStopMs;

        if (fertStartMs >= 0 && fertEndMs > fertStartMs) {
          actions.push({
            time: offsetMs + fertStartMs,
            type: 'fertilizer_on',
            switchCode: mapping['fertilizer_motor'],
            value: true,
            label: `액비모터 ON (${zone.name}, ${Math.round(fertStartMs / 60000)}분 후)`,
          });
          actions.push({
            time: offsetMs + fertEndMs,
            type: 'fertilizer_off',
            switchCode: mapping['fertilizer_motor'],
            value: false,
            label: `액비모터 OFF (${zone.name}, ${Math.round(fertEndMs / 60000)}분 후)`,
          });
        }
      }

      // 4) 구역 OFF
      actions.push({
        time: offsetMs + zoneDurationMs,
        type: 'zone_off',
        switchCode,
        value: false,
        label: `${zone.name} OFF`,
        fnKey,
      });

      // 5) 교반기 OFF (관수 종료와 동시) — 액비 활성 시에만
      if (mixerActive) {
        actions.push({
          time: offsetMs + zoneDurationMs,
          type: 'mixer_off',
          switchCode: mapping['mixer'],
          value: false,
          label: `교반기 OFF (${zone.name})`,
        });
      }

      // 6) 대기시간 후 다음 구역
      offsetMs += zoneDurationMs + waitTimeMs;
    }

    actions.sort((a, b) => a.time - b.time);
    return actions;
  }

  /** 특정 장비의 가동 정보 조회 */
  getActiveByDevice(friendlyName: string): ActiveIrrigation | undefined {
    for (const [, active] of this.activeIrrigations) {
      if (active.friendlyName === friendlyName) return active;
    }
    return undefined;
  }

  /** 특정 장비의 가동 중단 — 모든 관수 스위치 OFF */
  async stopByDevice(friendlyName: string): Promise<boolean> {
    for (const [ruleId, active] of this.activeIrrigations) {
      if (active.friendlyName === friendlyName) {
        // 1) 예약 타이머 모두 취소
        active.timers.forEach(t => clearTimeout(t));
        this.activeIrrigations.delete(ruleId);
        await this.clearRunMarker(active.deviceId);

        // 2) 현재 ON 상태인 스위치들 OFF 명령 전송
        try {
          const device = await this.devicesRepo.findOne({ where: { id: active.deviceId } });
          if (device) {
            const mapping = this.devicesService.getEffectiveMapping(device);

            // 구역, 교반기, 액비모터 모두 OFF
            const offCodes = [
              ...Object.entries(mapping)
                .filter(([key]) => key.startsWith('zone_') || key === 'mixer' || key === 'fertilizer_motor')
                .map(([, code]) => code),
            ];
            for (const code of offCodes) {
              try {
                // source별 라우팅 (onboard → gpio-agent, zigbee → z2m)
                await this.devicesService.publishDeviceSwitch(active.device, active.gateway, code, false);
              } catch {
                // 개별 스위치 OFF 실패 시 계속 진행
              }
            }
            this.logger.log(`관수 강제 중단 + 스위치 OFF: ${offCodes.join(', ')}`);
          }
        } catch (err: any) {
          this.logger.warn(`관수 중단 시 스위치 OFF 실패: ${err.message}`);
        }

        // 취소 로그 기록
        await this.logsRepo.save(
          this.logsRepo.create({
            ruleId,
            userId: active.userId,
            success: true,
            conditionsMet: { type: 'irrigation_cancelled' },
            actionsExecuted: { status: 'cancelled' },
          }),
        );

        this.eventsGateway.emitIrrigationStopped({ userId: active.userId, ruleId, tuyaDeviceId: friendlyName });
        this.logger.log(`관수 강제 중단: ruleId=${ruleId}`);
        return true;
      }
    }
    return false;
  }

  /** 원격제어 OFF(devices.service) → 진행 중인 관수 타임라인 중단 */
  @OnEvent('irrigation.remote-off')
  async onRemoteOff(payload: { friendlyName: string }) {
    if (payload?.friendlyName && (await this.stopByDevice(payload.friendlyName))) {
      this.logger.log(`원격제어 OFF → 진행 중 관수 중단: ${payload.friendlyName}`);
    }
  }

  /**
   * 서버 재시작 복구: 재시작 전에 진행 중이던 관수(예약 타이머는 메모리라 사라짐)는
   * 구역·교반기·액비모터를 모두 OFF 해 밸브가 열린 채 남지 않게 한다. 남은 구역은 실행하지 않는다.
   * MQTT 연결을 기다리기 위해 부팅 20초 후 실행.
   */
  onApplicationBootstrap() {
    setTimeout(() => { void this.recoverInterruptedRuns(); }, 20_000).unref?.();
  }

  async recoverInterruptedRuns() {
    let devices: Device[] = [];
    try {
      devices = await this.devicesRepo
        .createQueryBuilder('d')
        .where(`d.device_settings ? 'irrigationRun'`)
        .getMany();
    } catch (err: any) {
      this.logger.warn(`관수 복구 조회 실패: ${err.message}`);
      return;
    }
    for (const device of devices) {
      const run = (device.deviceSettings as any)?.irrigationRun as IrrigationRunMarker | undefined;
      if (!run || [...this.activeIrrigations.values()].some((a) => a.deviceId === device.id)) continue;
      try {
        const gateway = device.gatewayId ? await this.gatewayRepo.findOne({ where: { id: device.gatewayId } }) : null;
        if (gateway) {
          const mapping = this.devicesService.getEffectiveMapping(device);
          const offCodes = Object.entries(mapping)
            .filter(([key]) => key.startsWith('zone_') || key === 'mixer' || key === 'fertilizer_motor')
            .map(([, code]) => code);
          for (const code of offCodes) {
            await this.devicesService.publishDeviceSwitch(device, gateway, code, false).catch(() => undefined);
          }
        }
        await this.clearRunMarker(device.id);
        await this.logsRepo.save(this.logsRepo.create({
          ruleId: run.ruleId,
          userId: device.userId,
          success: false,
          conditionsMet: { type: 'irrigation_interrupted', deviceName: device.name, startedAt: run.startedAt },
          actionsExecuted: { status: 'interrupted', reason: 'server_restart' },
        }));
        this.eventsGateway.sendNotification(device.userId, {
          type: 'warning',
          title: '💧 관수 중단',
          message: `${device.name}: 서버 재시작으로 진행 중이던 관수(${run.ruleName})를 안전하게 중단했습니다. 남은 구역은 실행되지 않았습니다.`,
        });
        this.logger.warn(`서버 재시작 복구: 진행 중 관수 안전 정지 — ${device.name} (${run.ruleName})`);
      } catch (err: any) {
        this.logger.error(`관수 복구 실패: ${device.name} - ${err.message}`);
      }
    }
  }

  /** 수동 타이머(channelOverrides)가 아직 유효한 기능 키 목록 */
  private heldChannelKeys(device: Device): Set<string> {
    const held = new Set<string>();
    const chOv = (device.deviceSettings as any)?.channelOverrides;
    if (chOv && typeof chOv === 'object') {
      const nowMs = Date.now();
      for (const [key, o] of Object.entries<any>(chOv)) {
        if (o?.until && new Date(o.until).getTime() > nowMs) held.add(key);
      }
    }
    return held;
  }

  /** device_settings 의 다른 키를 덮어쓰지 않도록 jsonb 부분 갱신 */
  private async setRunMarker(deviceId: string, marker: IrrigationRunMarker) {
    await this.devicesRepo.query(
      `UPDATE devices SET device_settings = jsonb_set(COALESCE(device_settings, '{}'::jsonb), '{irrigationRun}', $2::jsonb) WHERE id::text = $1`,
      [deviceId, JSON.stringify(marker)],
    ).catch((e: any) => this.logger.warn(`관수 진행 표시 저장 실패: ${e.message}`));
  }

  private async clearRunMarker(deviceId: string) {
    await this.devicesRepo.query(
      `UPDATE devices SET device_settings = device_settings - 'irrigationRun' WHERE id::text = $1 AND device_settings ? 'irrigationRun'`,
      [deviceId],
    ).catch((e: any) => this.logger.warn(`관수 진행 표시 삭제 실패: ${e.message}`));
  }

  private async fetchGroupName(groupId: string | null | undefined): Promise<string | null> {
    if (!groupId) return null;
    try {
      const rows = await this.devicesRepo.query('SELECT name FROM house_groups WHERE id = $1', [groupId]);
      return rows?.[0]?.name || null;
    } catch {
      return null;
    }
  }
}
