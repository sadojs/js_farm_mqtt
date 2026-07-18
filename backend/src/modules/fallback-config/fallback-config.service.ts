import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OnEvent } from '@nestjs/event-emitter';
import { FallbackConfig } from './entities/fallback-config.entity';
import { FallbackOpenerSchedule } from './entities/fallback-opener-schedule.entity';
import {
  FallbackEvent,
  FallbackEventType,
} from './entities/fallback-event.entity';
import {
  FallbackGatewayStatus,
  FallbackMode,
} from './entities/fallback-gateway-status.entity';
import { UpdateFallbackConfigDto } from './dto/update-config.dto';
import { UpsertOpenerScheduleDto } from './dto/upsert-opener-schedule.dto';
import { MqttService } from '../mqtt/mqtt.service';
import { EventsGateway } from '../gateway/events.gateway';
import { GatewayOnboardDevice } from '../gateway-env/entities/gateway-onboard-device.entity';
import { Gateway } from '../gateway-manager/entities/gateway.entity';
import { AutomationRule } from '../automation/entities/automation-rule.entity';
import { Device } from '../devices/entities/device.entity';

@Injectable()
export class FallbackConfigService implements OnModuleInit {
  private readonly logger = new Logger(FallbackConfigService.name);

  constructor(
    @InjectRepository(FallbackConfig)
    private readonly configRepo: Repository<FallbackConfig>,
    @InjectRepository(FallbackOpenerSchedule)
    private readonly scheduleRepo: Repository<FallbackOpenerSchedule>,
    @InjectRepository(FallbackEvent)
    private readonly eventRepo: Repository<FallbackEvent>,
    @InjectRepository(FallbackGatewayStatus)
    private readonly statusRepo: Repository<FallbackGatewayStatus>,
    @InjectRepository(GatewayOnboardDevice)
    private readonly onboardRepo: Repository<GatewayOnboardDevice>,
    @InjectRepository(Gateway)
    private readonly gatewayRepo: Repository<Gateway>,
    @InjectRepository(AutomationRule)
    private readonly automationRuleRepo: Repository<AutomationRule>,
    @InjectRepository(Device)
    private readonly deviceRepo: Repository<Device>,
    private readonly mqtt: MqttService,
    private readonly events: EventsGateway,
  ) {}

  onModuleInit() {
    // 미등록 gateway(예: rename된 옛 gateway_id) 앞으로 온 fallback 메시지는 skip.
    // 그대로 저장 시 fallback_* FK 위반(UnhandledRejection) 발생하므로 가드로 차단.
    const guard =
      (fn: (gw: string, payload: Buffer) => Promise<void>) =>
      async (gw: string, payload: Buffer) => {
        const known = await this.gatewayRepo.count({ where: { gatewayId: gw } });
        if (!known) {
          this.logger.warn(`fallback: 미등록 gateway '${gw}' 메시지 skip (rename 잔재 가능)`);
          return;
        }
        return fn(gw, payload);
      };
    this.mqtt.setFallbackHandlers({
      mode: guard((gw, payload) => this.handleModeMessage(gw, payload)),
      events: guard((gw, payload) => this.handleEventsMessage(gw, payload)),
      ack: guard((gw, payload) => this.handleAckMessage(gw, payload)),
    });
  }

  // ───────── Config + Schedule 조회 ─────────

  async getFullConfig(gatewayId: string) {
    // 게이트웨이 존재 검증 (잘못된 gatewayId 보호)
    const gw = await this.gatewayRepo.findOne({
      where: { gatewayId },
      select: ['id', 'gatewayId'],
    });
    if (!gw) throw new NotFoundException('게이트웨이를 찾을 수 없습니다');

    let config = await this.configRepo.findOne({ where: { gatewayId } });
    let schedule = await this.scheduleRepo.find({
      where: { gatewayId },
      order: { month: 'ASC' },
    });
    let status = await this.statusRepo.findOne({ where: { gatewayId } });

    // Lazy seed: 마이그레이션 020 이전에 등록된 게이트웨이는 시드가 없으므로 첫 조회 시 자동 생성.
    // 멱등 — ON CONFLICT DO NOTHING과 동일한 효과.
    if (!config) {
      this.logger.warn(`[lazy-seed] fallback_configs 없음 → 생성 (${gatewayId})`);
      config = await this.configRepo.save(this.configRepo.create({ gatewayId }));
    }
    if (!status) {
      this.logger.warn(`[lazy-seed] fallback_gateway_status 없음 → 생성 (${gatewayId})`);
      status = await this.statusRepo.save(
        this.statusRepo.create({ gatewayId, mode: 'unknown', modeChangedAt: new Date() }),
      );
    }
    if (schedule.length === 0) {
      this.logger.warn(`[lazy-seed] fallback_opener_schedule 없음 → 12개월 시드 생성 (${gatewayId})`);
      await this.seedDefaultSchedule(gatewayId);
      schedule = await this.scheduleRepo.find({
        where: { gatewayId },
        order: { month: 'ASC' },
      });
    }

    return { config, schedule, status };
  }

  /**
   * Plan 사양에 따른 월별 스케줄 기본값 시드.
   * 마이그레이션 020의 DO $$ 블록과 동일.
   */
  private async seedDefaultSchedule(gatewayId: string) {
    const defaults = [
      { month: 1,  enabled: false, mode: 'time' as const,         openTime: null,    closeTime: null },
      { month: 2,  enabled: false, mode: 'time' as const,         openTime: null,    closeTime: null },
      { month: 3,  enabled: false, mode: 'time' as const,         openTime: null,    closeTime: null },
      { month: 4,  enabled: true,  mode: 'time' as const,         openTime: '09:00', closeTime: '17:00' },
      { month: 5,  enabled: true,  mode: 'time' as const,         openTime: '08:00', closeTime: '18:00' },
      { month: 6,  enabled: true,  mode: 'always-open' as const,  openTime: null,    closeTime: null },
      { month: 7,  enabled: true,  mode: 'always-open' as const,  openTime: null,    closeTime: null },
      { month: 8,  enabled: true,  mode: 'always-open' as const,  openTime: null,    closeTime: null },
      { month: 9,  enabled: true,  mode: 'always-open' as const,  openTime: null,    closeTime: null },
      { month: 10, enabled: true,  mode: 'time' as const,         openTime: '08:00', closeTime: '18:00' },
      { month: 11, enabled: false, mode: 'time' as const,         openTime: '09:00', closeTime: '17:00' },
      { month: 12, enabled: false, mode: 'time' as const,         openTime: null,    closeTime: null },
    ];
    const rows = defaults.map((d) => this.scheduleRepo.create({ gatewayId, ...d }));
    await this.scheduleRepo.save(rows);
  }

  // ───────── Config PATCH ─────────

  async updateConfig(gatewayId: string, dto: UpdateFallbackConfigDto) {
    const config = await this.configRepo.findOne({ where: { gatewayId } });
    if (!config) throw new NotFoundException('폴백 설정이 없습니다');

    const next = { ...config, ...dto };

    // 환기팬: ON > OFF 강제 (온도/습도 모두 — 큰 값에서 켜고 작은 값에서 끈다)
    if (next.fanOnTemp <= next.fanOffTemp) {
      const unit = next.fanTriggerType === 'humidity' ? '%' : '°C';
      throw new BadRequestException(
        `환기팬 ON 임계값(${next.fanOnTemp}${unit})은 OFF 임계값(${next.fanOffTemp}${unit})보다 커야 합니다`,
      );
    }
    // 습도 모드: 0~100 범위 강제
    if (next.fanTriggerType === 'humidity') {
      if (next.fanOnTemp < 0 || next.fanOnTemp > 100 || next.fanOffTemp < 0 || next.fanOffTemp > 100) {
        throw new BadRequestException('환기팬 습도 임계값은 0~100% 범위여야 합니다');
      }
    }

    // 개폐기 온습도: 개방 임계 > 닫힘 임계 (측정값이 높으면 개방)
    if (next.openerOnValue <= next.openerOffValue) {
      const unit = next.openerTriggerType === 'humidity' ? '%' : '°C';
      throw new BadRequestException(
        `개폐기 개방 임계값(${next.openerOnValue}${unit})은 닫힘 임계값(${next.openerOffValue}${unit})보다 커야 합니다`,
      );
    }
    if (next.openerTriggerType === 'humidity') {
      if (next.openerOnValue < 0 || next.openerOnValue > 100 || next.openerOffValue < 0 || next.openerOffValue > 100) {
        throw new BadRequestException('개폐기 습도 임계값은 0~100% 범위여야 합니다');
      }
    }

    Object.assign(config, dto);
    config.version = this.nextVersion(config);
    await this.configRepo.save(config);

    await this.publishSync(gatewayId);
    return config;
  }

  // ───────── Schedule UPSERT ─────────

  async upsertOpenerSchedule(
    gatewayId: string,
    month: number,
    dto: UpsertOpenerScheduleDto,
  ) {
    if (month < 1 || month > 12) {
      throw new BadRequestException('월은 1~12 사이여야 합니다');
    }
    if (dto.mode === 'time' && (!dto.openTime || !dto.closeTime)) {
      throw new BadRequestException(
        "mode='time'일 때 openTime/closeTime은 필수입니다",
      );
    }

    let row = await this.scheduleRepo.findOne({
      where: { gatewayId, month },
    });
    if (!row) {
      row = this.scheduleRepo.create({ gatewayId, month });
    }
    row.enabled = dto.enabled;
    row.mode = dto.mode;
    row.openTime = dto.mode === 'time' ? dto.openTime! : null;
    row.closeTime = dto.mode === 'time' ? dto.closeTime! : null;
    await this.scheduleRepo.save(row);

    await this.bumpVersionAndSync(gatewayId);
    return row;
  }

  async disableOpenerSchedule(gatewayId: string, month: number) {
    const row = await this.scheduleRepo.findOne({
      where: { gatewayId, month },
    });
    if (!row) throw new NotFoundException('월 스케줄이 없습니다');
    row.enabled = false;
    await this.scheduleRepo.save(row);
    await this.bumpVersionAndSync(gatewayId);
    return row;
  }

  // ───────── Status + Events 조회 ─────────

  async getMode(gatewayId: string) {
    return this.statusRepo.findOne({ where: { gatewayId } });
  }

  async getEvents(gatewayId: string, limit = 100, offset = 0) {
    const [data, total] = await this.eventRepo.findAndCount({
      where: { gatewayId },
      order: { occurredAt: 'DESC' },
      take: Math.min(limit, 500),
      skip: offset,
    });
    return { data, total, limit, offset };
  }

  // ───────── MQTT 메시지 핸들러 ─────────

  private async handleModeMessage(gatewayId: string, payload: Buffer) {
    let parsed: { mode?: FallbackMode; since?: string };
    try {
      parsed = JSON.parse(payload.toString('utf-8'));
    } catch {
      this.logger.warn(`fallback/mode JSON 파싱 실패 (${gatewayId})`);
      return;
    }
    if (!parsed.mode) return;

    let status = await this.statusRepo.findOne({ where: { gatewayId } });
    const prevMode = status?.mode;
    if (!status) {
      status = this.statusRepo.create({
        gatewayId,
        mode: parsed.mode,
        modeChangedAt: parsed.since ? new Date(parsed.since) : new Date(),
      });
    } else if (status.mode !== parsed.mode) {
      status.mode = parsed.mode;
      status.modeChangedAt = parsed.since ? new Date(parsed.since) : new Date();
    }
    status.lastHeartbeatSeenAt = new Date();
    await this.statusRepo.save(status);
    this.logger.log(`gateway=${gatewayId} mode=${parsed.mode}`);

    // 모드 변화가 있을 때만 WebSocket emit (불필요한 brodcast 억제)
    if (prevMode !== parsed.mode) {
      this.events.broadcastFallbackModeChanged({
        gatewayId,
        mode: parsed.mode,
        modeChangedAt: status.modeChangedAt.toISOString(),
      });
    }
  }

  private async handleEventsMessage(gatewayId: string, payload: Buffer) {
    let parsed: {
      events?: Array<{
        eventType: FallbackEventType;
        payload: Record<string, unknown>;
        occurredAt: string;
      }>;
    };
    try {
      parsed = JSON.parse(payload.toString('utf-8'));
    } catch {
      this.logger.warn(`fallback/events JSON 파싱 실패 (${gatewayId})`);
      return;
    }
    if (!parsed.events?.length) return;

    const rows = parsed.events.map((e) =>
      this.eventRepo.create({
        gatewayId,
        eventType: e.eventType,
        payload: e.payload,
        occurredAt: new Date(e.occurredAt),
      }),
    );
    await this.eventRepo.save(rows);
    this.logger.log(`gateway=${gatewayId} events received: ${rows.length}`);

    // 최근 이벤트 1개 WebSocket emit (대량 batch는 마지막 것만 — UI가 자체 조회로 갱신)
    const last = parsed.events[parsed.events.length - 1];
    this.events.broadcastFallbackEvent({
      gatewayId,
      eventType: last.eventType,
      payload: last.payload,
      occurredAt: last.occurredAt,
    });
  }

  private async handleAckMessage(gatewayId: string, payload: Buffer) {
    let parsed: { version?: number; appliedAt?: string };
    try {
      parsed = JSON.parse(payload.toString('utf-8'));
    } catch {
      return;
    }
    if (typeof parsed.version !== 'number') return;
    await this.configRepo.update(
      { gatewayId },
      {
        lastAppliedVersion: parsed.version,
        lastAppliedAt: parsed.appliedAt ? new Date(parsed.appliedAt) : new Date(),
      },
    );
    this.logger.log(`gateway=${gatewayId} sync ACK v${parsed.version}`);
  }

  // ───────── 동기화 publish ─────────

  /**
   * 다음 sync version 계산 — DB version 과 Pi 가 마지막으로 적용한 version(lastAppliedVersion)
   * 중 큰 값 + 1. DB 롤백/복원 등으로 서버 version 이 후퇴해도, Pi 로컬 version 이하가 발행되어
   * 'already applied'로 무시되는 드리프트를 자가치유한다(Pi 게이트 조건: payload.version <= local).
   */
  private nextVersion(config: {
    version?: number | null;
    lastAppliedVersion?: number | null;
  }): number {
    return Math.max(config.version ?? 0, config.lastAppliedVersion ?? 0) + 1;
  }

  private async bumpVersionAndSync(gatewayId: string) {
    const config = await this.configRepo.findOne({ where: { gatewayId } });
    if (config) {
      config.version = this.nextVersion(config);
      await this.configRepo.save(config);
    } else {
      // 설정 행이 없으면 기존 동작 유지 (publishSync 가 기본값 생성 시 처리)
      await this.configRepo.increment({ gatewayId }, 'version', 1);
    }
    await this.publishSync(gatewayId);
  }

  async publishSync(gatewayId: string) {
    const { config, schedule } = await this.getFullConfig(gatewayId);
    const channelMapping = await this.buildChannelMapping(gatewayId);
    const rainInput = await this.buildRainInput(gatewayId);
    const irrigationSchedules = await this.buildIrrigationSchedules(
      gatewayId,
      channelMapping,
    );
    await this.mqtt.publishFallbackRulesSync(gatewayId, {
      version: config.version,
      config: {
        rainInput,
        heartbeatTimeoutSeconds: config.heartbeatTimeoutSeconds,
        recoveryGraceSeconds: config.recoveryGraceSeconds,
        openerEnabled: config.openerEnabled,
        openerRainOverride: config.openerRainOverride,
        irrigationEnabled: config.irrigationEnabled,
        irrigationMaxRuntimeMinutes: config.irrigationMaxRuntimeMinutes,
        fertilizerEnabled: config.fertilizerEnabled,
        fanEnabled: config.fanEnabled,
        fanTriggerType: config.fanTriggerType,
        fanOnTemp: config.fanOnTemp,
        fanOffTemp: config.fanOffTemp,
        openerTriggerType: config.openerTriggerType,
        openerOnValue: config.openerOnValue,
        openerOffValue: config.openerOffValue,
        sensorTimeoutSeconds: config.sensorTimeoutSeconds,
        // 게이트웨이 공통 개폐기/팬 동작·대기 (fallback-engine 개폐기 펄스 등에서 사용)
        openerOperationSeconds: config.openerOperationSeconds,
        openerStandbySeconds: config.openerStandbySeconds,
        fanOperationMinutes: config.fanOperationMinutes,
        fanStandbyMinutes: config.fanStandbyMinutes,
      },
      schedule: schedule.map((s) => ({
        month: s.month,
        enabled: s.enabled,
        mode: s.mode,
        openTime: s.openTime,
        closeTime: s.closeTime,
      })),
      channelMapping,
      irrigationSchedules,
    });
  }

  /**
   * rpi-fallback-channel-sync: gateway_onboard_devices 테이블에서 슬롯 정보 빌드.
   * gpio_pin이 NULL인 슬롯, enabled=false 슬롯, 미지원 slot_type은 제외.
   */
  /**
   * 폴백 관수 스케줄 조립 — 서버 automation 관수룰(conditions.type='irrigation')을
   * Pi 오프라인 실행용으로 변환. 온보드 GPIO 관수룰만(Zigbee 컨트롤러는 폴백 채널맵에
   * 없어 실행 불가하므로 제외). zone 번호→onboard slotKey(zone_N) 변환 후
   * channelMapping 에 실제 존재하는 채널만 포함(미활성/미매핑 필터).
   */
  private async buildIrrigationSchedules(
    gatewayId: string,
    channelMapping: {
      irrigation: Array<{ channel: string }>;
      fertilizer: Array<{ channel: string }>;
    },
  ): Promise<any[]> {
    const gateway = await this.gatewayRepo.findOne({
      where: { gatewayId },
      select: ['id'],
    });
    if (!gateway) return [];

    const irrigationChannels = new Set(
      channelMapping.irrigation.map((e) => e.channel),
    );
    const fertilizerChannels = new Set(
      channelMapping.fertilizer.map((e) => e.channel),
    );
    if (irrigationChannels.size === 0) return [];

    const rules = await this.automationRuleRepo
      .createQueryBuilder('r')
      .where('r.enabled = true')
      .andWhere("r.conditions->>'type' = :t", { t: 'irrigation' })
      .getMany();
    if (!rules.length) return [];

    const out: any[] = [];
    for (const rule of rules) {
      const c = rule.conditions || {};
      const a = rule.actions || {};
      const targetDeviceId =
        a.targetDeviceId ||
        (Array.isArray(a.targetDeviceIds) ? a.targetDeviceIds[0] : null);
      if (!targetDeviceId) continue;

      // 대상 장치가 이 게이트웨이 소속이면 실행 가능(온보드 GPIO + Zigbee 모두).
      // 실제 채널 존재 여부는 아래 zone→slotKey + irrigationChannels 필터로 검증(zigbee zone_N 도 포함됨).
      const device = await this.deviceRepo.findOne({
        where: { id: targetDeviceId },
        select: ['id', 'gatewayId', 'source'],
      });
      if (!device || device.gatewayId !== gateway.id) continue;

      // zone 번호 → slotKey 변환 + 채널 존재 필터
      const zones = (Array.isArray(c.zones) ? c.zones : [])
        .filter((z: any) => z && z.enabled && z.duration > 0)
        .sort((x: any, y: any) => (x.zone || 0) - (y.zone || 0))
        .map((z: any) => ({
          channel: `zone_${z.zone}`,
          durationMin: z.duration,
          waitMin: z.waitTime || 0,
        }))
        .filter((z: any) => irrigationChannels.has(z.channel));
      if (!zones.length) continue;

      const mixer =
        c.mixer && c.mixer.enabled && fertilizerChannels.has('mixer')
          ? { enabled: true, channel: 'mixer' }
          : null;
      const fertilizer =
        c.fertilizer &&
        c.fertilizer.enabled &&
        c.fertilizer.duration > 0 &&
        fertilizerChannels.has('fertilizer_motor')
          ? {
              enabled: true,
              channel: 'fertilizer_motor',
              durationMin: c.fertilizer.duration,
              preStopWaitMin: c.fertilizer.preStopWait || 0,
            }
          : null;

      // 스케줄 정규화: schedules[] 우선, 없으면 legacy startTime/schedule
      const schedules =
        Array.isArray(c.schedules) && c.schedules.length
          ? c.schedules
          : c.startTime
            ? [{ startTime: c.startTime, days: c.schedule?.days || [] }]
            : [];

      for (const s of schedules) {
        if (!s || !s.startTime || !Array.isArray(s.days) || !s.days.length)
          continue;
        out.push({
          ruleId: rule.id,
          startTime: s.startTime,
          days: s.days,
          zones,
          mixer,
          fertilizer,
        });
      }
    }
    return out;
  }

  private async buildChannelMapping(gatewayId: string) {
    // gateway_id (VARCHAR) → gateways.id (UUID) 변환 (onboard 테이블이 UUID FK)
    const gateway = await this.gatewayRepo.findOne({
      where: { gatewayId },
      select: ['id', 'gatewayId'],
    });
    if (!gateway) {
      this.logger.warn(`buildChannelMapping: gateway not found (${gatewayId})`);
      return this.emptyMapping();
    }

    const slots = await this.onboardRepo.find({
      where: { gatewayId: gateway.id, enabled: true },
    });

    const result = this.emptyMapping();
    let skippedNoPin = 0;
    let skippedType = 0;

    for (const s of slots) {
      if (s.gpioPin == null) {
        skippedNoPin++;
        continue;
      }
      const entry: any = { channel: s.slotKey, type: 'gpio', pin: s.gpioPin, name: s.name };
      switch (s.slotType) {
        case 'irrigation_zone':
        case 'irrigation_group':
          result.irrigation.push(entry);
          break;
        case 'fan':
          result.fan.push(entry);
          break;
        case 'opener_open':
          result.opener.open.push(entry);
          break;
        case 'opener_close':
          result.opener.close.push(entry);
          break;
        case 'fertilizer_contact':
        case 'mixer':
        case 'fertilizer_motor':
          result.fertilizer.push(entry);
          break;
        case 'remote_control':
        case 'vent_group':
        case 'rain_sensor':
          // 폴백 릴레이 채널 대상 아님 (rain_sensor 는 rainInput 으로 별도 전달)
          break;
        default:
          skippedType++;
      }
    }

    if (skippedNoPin > 0) {
      this.logger.warn(
        `channelMapping(${gatewayId}): gpio_pin 미지정 슬롯 ${skippedNoPin}개 제외`,
      );
    }
    if (skippedType > 0) {
      this.logger.warn(
        `channelMapping(${gatewayId}): 미지원 slot_type 슬롯 ${skippedType}개 제외`,
      );
    }

    // Zigbee 액추에이터도 채널맵에 추가(폴백에서 로컬 z2m 으로 제어). 온보드와 동일 버킷.
    await this.addZigbeeChannels(gateway.id, result);
    return result;
  }

  /** switch_N → state_lN (TS0601 만). 온라인 translateSwitchKeyForZ2m 미러 — 서버에서 사전변환. */
  private z2mKeyFor(switchCode: string, zigbeeModel?: string | null): string {
    if (zigbeeModel && zigbeeModel.toLowerCase().includes('ts0601')) {
      const m = /^switch_(\d+)$/.exec(switchCode);
      if (m) return `state_l${m[1]}`;
    }
    return switchCode;
  }

  /**
   * 게이트웨이의 Zigbee 액추에이터를 채널맵에 추가(type:'zigbee', friendlyName, z2mKey).
   * - irrigation(단일 다스위치): channelMapping(functionKey→switchCode), disabledChannels 제외, remote_control 제외.
   *   zone_*→irrigation, mixer/fertilizer_motor/fertilizer_b_contact→fertilizer.
   * - fan/opener_open/opener_close(컨트롤러 child or 단독): friendlyName/model 은 parent 우선, switchCode=channelCode??'state'.
   * 채널 key 충돌(온보드와 동일 key)은 온보드 우선(GPIO 가 더 견고) — Zigbee 는 스킵.
   */
  private async addZigbeeChannels(
    gatewayUuid: string,
    result: any,
  ): Promise<void> {
    const devices = await this.deviceRepo.find({
      where: {
        gatewayId: gatewayUuid,
        source: 'zigbee',
        deviceType: 'actuator',
        enabled: true,
      },
    });
    if (!devices.length) return;

    const seen = new Set<string>(
      [
        ...result.irrigation,
        ...result.fertilizer,
        ...result.fan,
        ...result.opener.open,
        ...result.opener.close,
      ].map((e: any) => e.channel),
    );
    const parentCache = new Map<string, any>();

    for (const d of devices) {
      if (d.equipmentType === 'controller') continue; // parent shell — 직접 제어 대상 아님

      if (d.equipmentType === 'irrigation') {
        const mapping = d.channelMapping || {};
        const disabled = new Set(
          (d.deviceSettings?.disabledChannels as string[]) ?? [],
        );
        for (const [fnKey, switchCode] of Object.entries(mapping)) {
          if (fnKey === 'remote_control' || disabled.has(fnKey)) continue;
          const cat = fnKey.startsWith('zone_')
            ? 'irrigation'
            : fnKey === 'mixer' ||
                fnKey === 'fertilizer_motor' ||
                fnKey === 'fertilizer_b_contact'
              ? 'fertilizer'
              : null;
          if (!cat || seen.has(fnKey)) continue;
          result[cat].push({
            channel: fnKey,
            type: 'zigbee',
            friendlyName: d.friendlyName,
            z2mKey: this.z2mKeyFor(switchCode as string, d.zigbeeModel),
            name: d.name,
          });
          seen.add(fnKey);
        }
        continue;
      }

      if (
        d.equipmentType === 'fan' ||
        d.equipmentType === 'opener_open' ||
        d.equipmentType === 'opener_close'
      ) {
        let friendlyName = d.friendlyName;
        let model = d.zigbeeModel;
        if (d.parentDeviceId) {
          let parent = parentCache.get(d.parentDeviceId);
          if (!parent) {
            parent = await this.deviceRepo.findOne({
              where: { id: d.parentDeviceId },
              select: ['id', 'friendlyName', 'zigbeeModel'],
            });
            parentCache.set(d.parentDeviceId, parent);
          }
          if (parent) {
            friendlyName = parent.friendlyName;
            model = parent.zigbeeModel;
          }
        }
        const switchCode = d.channelCode ?? 'state';
        // 채널 key 는 장치별 고유(여러 zigbee 팬/개폐기 구분). 온보드 fan_1/vent_* 와 충돌 없음.
        const channel = `zb_${d.id}`;
        if (seen.has(channel)) continue;
        const entry = {
          channel,
          type: 'zigbee',
          friendlyName,
          z2mKey: this.z2mKeyFor(switchCode, model),
          name: d.name,
        };
        if (d.equipmentType === 'fan') result.fan.push(entry);
        else if (d.equipmentType === 'opener_open') result.opener.open.push(entry);
        else result.opener.close.push(entry);
        seen.add(channel);
      }
    }
  }

  /**
   * 무전압 접점 우적센서 입력 설정. Pi fallback-engine 이 GPIO 를 감시해
   * farm/{gw}/z2m/rain_sensor 로 {rain} 을 발행하도록 하는 파라미터.
   * 슬롯이 없거나 비활성이면 enabled=false (감시 안 함).
   */
  private async buildRainInput(gatewayId: string) {
    const DEFAULT = { enabled: false, pin: 21, activeLow: true, friendlyName: 'rain_sensor' };
    const gateway = await this.gatewayRepo.findOne({
      where: { gatewayId },
      select: ['id', 'gatewayId'],
    });
    if (!gateway) return DEFAULT;
    const slot = await this.onboardRepo.findOne({
      where: { gatewayId: gateway.id, slotType: 'rain_sensor' },
    });
    if (!slot) return DEFAULT;
    return {
      enabled: !!slot.enabled,
      pin: slot.gpioPin ?? 21,
      activeLow: true,
      friendlyName: slot.slotKey || 'rain_sensor',
    };
  }

  private emptyMapping() {
    return {
      irrigation: [] as Array<{ channel: string; pin: number; name: string }>,
      fertilizer: [] as Array<{ channel: string; pin: number; name: string }>,
      fan: [] as Array<{ channel: string; pin: number; name: string }>,
      opener: {
        open: [] as Array<{ channel: string; pin: number; name: string }>,
        close: [] as Array<{ channel: string; pin: number; name: string }>,
      },
    };
  }

  /**
   * rpi-fallback-channel-sync: device 변경 시 자동 sync.
   * GatewayEnvService.updateOnboardDevice/createOnboardDevice/deleteOnboardDevice에서 emit.
   * 페이로드 형식: { gatewayId: VARCHAR } — 사람이 읽는 ID 기준.
   */
  @OnEvent('device.changed', { async: true })
  async handleDeviceChanged(payload: { gatewayId: string }) {
    if (!payload?.gatewayId) return;
    try {
      this.logger.log(`device.changed → resync gateway=${payload.gatewayId}`);
      await this.bumpVersionAndSync(payload.gatewayId);
    } catch (err: any) {
      this.logger.error(
        `device.changed sync 실패 (${payload.gatewayId}): ${err?.message ?? err}`,
      );
    }
  }
}
