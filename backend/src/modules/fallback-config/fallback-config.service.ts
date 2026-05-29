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
    private readonly mqtt: MqttService,
    private readonly events: EventsGateway,
  ) {}

  onModuleInit() {
    this.mqtt.setFallbackHandlers({
      mode: (gw, payload) => this.handleModeMessage(gw, payload),
      events: (gw, payload) => this.handleEventsMessage(gw, payload),
      ack: (gw, payload) => this.handleAckMessage(gw, payload),
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

    // 환기팬: onTemp > offTemp 강제
    if (next.fanOnTemp <= next.fanOffTemp) {
      throw new BadRequestException(
        '환기팬 ON 임계값은 OFF 임계값보다 커야 합니다',
      );
    }

    Object.assign(config, dto);
    config.version = (config.version ?? 1) + 1;
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

  private async bumpVersionAndSync(gatewayId: string) {
    await this.configRepo.increment({ gatewayId }, 'version', 1);
    await this.publishSync(gatewayId);
  }

  async publishSync(gatewayId: string) {
    const { config, schedule } = await this.getFullConfig(gatewayId);
    const channelMapping = await this.buildChannelMapping(gatewayId);
    await this.mqtt.publishFallbackRulesSync(gatewayId, {
      version: config.version,
      config: {
        heartbeatTimeoutSeconds: config.heartbeatTimeoutSeconds,
        recoveryGraceSeconds: config.recoveryGraceSeconds,
        openerEnabled: config.openerEnabled,
        openerRainOverride: config.openerRainOverride,
        irrigationEnabled: config.irrigationEnabled,
        irrigationMaxRuntimeMinutes: config.irrigationMaxRuntimeMinutes,
        fertilizerEnabled: config.fertilizerEnabled,
        fanEnabled: config.fanEnabled,
        fanOnTemp: config.fanOnTemp,
        fanOffTemp: config.fanOffTemp,
      },
      schedule: schedule.map((s) => ({
        month: s.month,
        enabled: s.enabled,
        mode: s.mode,
        openTime: s.openTime,
        closeTime: s.closeTime,
      })),
      channelMapping,
    });
  }

  /**
   * rpi-fallback-channel-sync: gateway_onboard_devices 테이블에서 슬롯 정보 빌드.
   * gpio_pin이 NULL인 슬롯, enabled=false 슬롯, 미지원 slot_type은 제외.
   */
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
      const entry = { channel: s.slotKey, pin: s.gpioPin, name: s.name };
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
          // 폴백 대상 아님
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
    return result;
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
