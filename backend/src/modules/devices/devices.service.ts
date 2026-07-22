// controller equipment_type support added (zigbee-channel-actuator)
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, forwardRef } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { RainOverrideService } from '../rain-override/rain-override.service';
import { Device } from './entities/device.entity';
import { AutomationRule } from '../automation/entities/automation-rule.entity';
import { Gateway } from '../gateway-manager/entities/gateway.entity';
import { GatewayOnboardDevice } from '../gateway-env/entities/gateway-onboard-device.entity';
import { MqttService } from '../mqtt/mqtt.service';
import { IrrigationSchedulerService } from '../automation/irrigation-scheduler.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { EventsGateway } from '../gateway/events.gateway';
import { AVAILABLE_SWITCH_CODES, AVAILABLE_SWITCH_CODES_12CH, detectChannelCount, getDefaultMappingByCount } from './channel-mapping.constants';

const DEVICE_DEPENDENCY_SQL = `
  SELECT id, name, enabled FROM automation_rules
  WHERE user_id = $1
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(actions) = 'array'
           THEN actions
           ELSE jsonb_build_array(actions)
      END
    ) AS action
    WHERE action->>'targetDeviceId' = $2
       OR action->'targetDeviceIds' ? $2
  )
`;

@Injectable()
export class DevicesService {
  private readonly logger = new Logger(DevicesService.name);

  constructor(
    @InjectRepository(Device) private devicesRepo: Repository<Device>,
    @InjectRepository(AutomationRule) private rulesRepo: Repository<AutomationRule>,
    @InjectRepository(Gateway) private gatewayRepo: Repository<Gateway>,
    @InjectRepository(GatewayOnboardDevice) private onboardRepo: Repository<GatewayOnboardDevice>,
    private mqttService: MqttService,
    private dataSource: DataSource,
    @Inject(forwardRef(() => RainOverrideService))
    private rainOverride: RainOverrideService,
    @Inject(forwardRef(() => IrrigationSchedulerService))
    private irrigationScheduler: IrrigationSchedulerService,
    private activityLog: ActivityLogService,
    private eventsGateway: EventsGateway,
    private eventEmitter: EventEmitter2,
  ) {}

  /**
   * 매 분: 개폐기 최대 동작시간(10분) 초과 자동 OFF — 자동제어 사이클/우적 닫힘/수동 제어 공통.
   * 개폐기는 실제 ~3분이면 완전 개/폐되므로 같은 동작이 10분 넘게 지속되면 강제 정지.
   * switchState=ON 이고 lastCommandAt 이 10분 초과인 개폐기를 OFF.
   * (자동제어 사이클은 매 ON 펄스마다 lastCommandAt 갱신되어 여기엔 안 걸림 —
   *  automation-runner의 방향별 10분 cap이 사이클을 처리. 이 cron은 우적/수동/stuck 백스톱.)
   * cron 기반이라 백엔드 재시작에도 안전.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async autoOffStuckOpeners() {
    const OPENER_MAX_MS = 10 * 60 * 1000;
    const openers = await this.devicesRepo.find({
      where: [{ equipmentType: 'opener_open' }, { equipmentType: 'opener_close' }],
    });
    const now = Date.now();
    for (const dev of openers) {
      const s: any = dev.deviceSettings || {};
      if (s.switchState !== true) continue;
      // 자동제어 룰이 현재 유지 중인 개폐기는 강제 OFF 안 함.
      // (룰 10분 방향 cap 이후엔 모터가 이미 정지하고 switchState 는 "열림/닫힘 유지" 표시일 뿐 —
      //  여기서 OFF 하면 사용자가 원하는 '열림 상태 유지'가 깨진다.)
      // relayActiveUntil 이 미래면 룰이 활성으로 유지 중 → 스킵. 만료(백엔드 다운 등)면 stale 로 보고 OFF.
      if (s.relayActivePhase && s.relayActiveUntil && new Date(s.relayActiveUntil).getTime() > now) continue;
      const lastMs = s.lastCommandAt ? new Date(s.lastCommandAt).getTime() : null;
      if (lastMs == null || now - lastMs < OPENER_MAX_MS) continue;
      try {
        await this.controlDevice(dev.id, dev.userId, [{ code: 'state', value: false }], 'admin', 'automation');
        this.logger.warn(`개폐기 최대 동작 10분 초과 → 자동 OFF: ${dev.name} (lastCommandAt=${s.lastCommandAt})`);
      } catch (e: any) {
        this.logger.warn(`개폐기 auto-off 실패 (${dev.name}): ${e?.message ?? e}`);
      }
    }
  }

  /** 장치가 속한 구역(house_group) ID 조회 — rain-override 등에서 사용 */
  /**
   * device.source에 따라 MQTT 발행을 라우팅 — automation scheduler 등 외부에서 단일 진입점으로 사용.
   * - onboard: gpio-agent 토픽 (`farm/{gw}/gpio/relay`)
   * - 외 (zigbee): z2m 토픽 (`farm/{gw}/z2m/{friendly}/set`)
   */
  async publishDeviceSwitch(
    device: Device,
    gateway: Gateway,
    switchCode: string,
    value: boolean,
  ): Promise<void> {
    if (device.source === 'onboard') {
      await this.publishOnboardRelay(gateway.gatewayId, gateway.id, switchCode, value);
      return;
    }

    // zigbee path — child device(parent_device_id 보유)는 parent의 friendlyName + 자기 channel_code 사용
    let publishFriendlyName = device.friendlyName;
    let publishKey = switchCode;
    let publishModel = (device as any).zigbeeModel;

    if ((device as any).parentDeviceId) {
      const parent = await this.devicesRepo.findOne({ where: { id: (device as any).parentDeviceId } });
      if (!parent) {
        throw new BadRequestException(`child device ${device.id}: parent 미발견`);
      }
      publishFriendlyName = parent.friendlyName!;
      publishKey = (device as any).channelCode ?? switchCode;
      publishModel = (parent as any).zigbeeModel ?? publishModel;
    }

    if (!publishFriendlyName) {
      throw new BadRequestException(`device ${device.id}: friendlyName 미설정 — z2m 발행 불가`);
    }

    const z2mKey = this.translateSwitchKeyForZ2m(publishKey, publishModel);
    // z2m payload format: TS0601 등 z2m converter는 {state_l1: "ON"|"OFF"} 문자열 기대.
    // boolean true/false는 일부 모델에서만 동작하고 TS0601 multi-channel은 무시됨.
    // (예전 path가 ON/OFF로 동작하던 zigbeeTestChannel과 통일)
    await this.mqttService.controlDevice(gateway.gatewayId, publishFriendlyName, {
      [z2mKey]: value ? 'ON' : 'OFF',
    });
  }

  /**
   * z2m payload 정규화 — TS0601 등 다채널 컨트롤러를 위한 키/값 변환.
   * - {switch_1: true} → {state_l1: "ON"}  (TS0601)
   * - {switch_1: true} → {state: "ON"}     (단일 채널 처리, buildMqttCommand가 이미 변환)
   * - boolean true/false → "ON"/"OFF" 문자열
   */
  private normalizeForZ2m(payload: any, zigbeeModel?: string | null): Record<string, any> {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(payload || {})) {
      // 키 변환 (switch_N → state_lN for TS0601)
      const newKey = this.translateSwitchKeyForZ2m(k, zigbeeModel);
      // 값 변환 (boolean → "ON"/"OFF" 문자열)
      if (typeof v === 'boolean') {
        out[newKey] = v ? 'ON' : 'OFF';
      } else {
        out[newKey] = v;
      }
    }
    return out;
  }

  /** Tuya TS0601 multi-channel은 switch_N 대신 state_lN payload 사용 */
  private translateSwitchKeyForZ2m(switchCode: string, zigbeeModel?: string | null): string {
    if (!zigbeeModel) return switchCode;
    if (!zigbeeModel.toLowerCase().includes('ts0601')) return switchCode;
    const m = switchCode.match(/^switch_(\d+)$/);
    return m ? `state_l${m[1]}` : switchCode;
  }

  /**
   * onboard 관수 controller의 channelMapping switchCode (예: 'relay_zone_1', 'relay_remote_control')를
   * gateway_onboard_devices 슬롯으로 reverse lookup하여 gpio-agent에게 publishGpioRelay 호출.
   * z2m이 처리 못하는 onboard device의 단일 진실 path.
   */
  private async publishOnboardRelay(
    gatewayCode: string,
    gatewayUuid: string,
    switchCode: string,
    state: boolean,
  ): Promise<void> {
    // switchCode = 'relay_<slotKey>' → slotKey 추출
    const slotKey = switchCode.startsWith('relay_') ? switchCode.slice(6) : switchCode;
    // 반드시 gateway_id 로 필터 — 동일 slot_key가 여러 게이트웨이에 존재
    const slot = await this.onboardRepo.findOne({ where: { slotKey, gatewayId: gatewayUuid } as any });
    if (!slot) {
      this.logger.warn(`onboard slot ${slotKey}@${gatewayCode} 미등록 — skip publish`);
      return;
    }
    if (slot.gpioPin == null) {
      // remote_control 등 GPIO 핀이 없는 논리 슬롯은 UI 상태만 기록 (publish skip)
      this.logger.debug(`onboard slot ${slotKey}@${gatewayCode}: 핀 없음 — UI-only 슬롯 skip`);
      return;
    }
    await this.mqttService.publishGpioRelay(gatewayCode, {
      slot: slot.slotKey,
      pin: slot.gpioPin,
      state,
    });
  }

  private async getDeviceGroupId(deviceId: string): Promise<string | null> {
    const rows = await this.dataSource.query(`
      SELECT h.group_id::text AS group_id
      FROM devices d
      JOIN houses h ON h.id::text = d.house_id
      WHERE d.id = $1
      LIMIT 1
    `, [deviceId]);
    return rows[0]?.group_id ?? null;
  }

  /**
   * 특정 센서 디바이스가 발행하는 측정 채널 목록과 최근 값 조회.
   * - 최근 24시간 sensor_data 에서 sensor_type 별 최신 1건씩 반환
   * - 자동제어 위저드에서 "온습도센서1 - 온도 (24.2°C)" 형태 셀렉터 채움용
   */
  async getSensorChannels(deviceId: string, userId: string, role?: string) {
    // 권한 확인
    const where = role === 'admin' ? { id: deviceId } : { id: deviceId, userId };
    const device = await this.devicesRepo.findOne({ where });
    if (!device) throw new NotFoundException('장비를 찾을 수 없습니다.');
    if (device.deviceType !== 'sensor') return [];

    const rows: Array<{ sensor_type: string; value: number; unit: string | null; time: string }> = await this.dataSource.query(`
      SELECT DISTINCT ON (sensor_type)
        sensor_type, value, unit, time
      FROM sensor_data
      WHERE device_id = $1
        AND time >= now() - INTERVAL '24 hours'
      ORDER BY sensor_type, time DESC
    `, [deviceId]);

    return rows.map(r => ({
      field: r.sensor_type,
      lastValue: r.value == null ? null : Number(r.value),
      unit: r.unit || this.defaultUnitFor(r.sensor_type),
      updatedAt: r.time,
    }));
  }

  private defaultUnitFor(field: string): string {
    const map: Record<string, string> = {
      temperature: '°C',
      humidity: '%',
      soil_temperature: '°C',
      soil_moisture: '%',
      co2: 'ppm',
      illuminance_lux: 'lux',
      ec: 'mS/cm',
      ph: 'pH',
      wind_speed: 'm/s',
      rainfall: 'mm',
      battery: '%',
      linkquality: '',
    };
    return map[field] ?? '';
  }

  async findAllByUser(userId: string, role?: string) {
    const devices = await this.devicesRepo.find({
      where: role === 'admin' ? {} : { userId },
      order: { createdAt: 'DESC' },
    });
    // deviceSettings 내의 switchState/switchStates를 최상위 필드로 노출 (frontend 호환)
    return devices.map(d => this.exposeSwitchFields(d));
  }

  /** deviceSettings의 switchState/switchStates/disabledChannels를 최상위로 expose */
  exposeSwitchFields(device: Device): any {
    const settings = (device.deviceSettings as any) || {};
    let switchStates = settings.switchStates ?? null;
    // 관수: 액비/교반기 B접점은 원격제어와 페어(물리 GPIO 없는 논리 슬롯) —
    // 표시/상태를 항상 원격제어에 미러하여 둘이 어긋나 보이는 문제 방지.
    if (device.equipmentType === 'irrigation' && switchStates) {
      const mapping = this.getEffectiveMapping(device);
      const remoteCode = mapping['remote_control'];
      const bCode = mapping['fertilizer_b_contact'];
      if (remoteCode && bCode) {
        switchStates = { ...switchStates, [bCode]: !!switchStates[remoteCode] };
      }
    }
    return {
      ...device,
      switchState: settings.switchState ?? null,
      switchStates,
      relayActivePhase: settings.relayActivePhase ?? null,
      disabledChannels: Array.isArray(settings.disabledChannels) ? settings.disabledChannels : [],
      rainOverrideDisabled: !!settings.rainOverrideDisabled,
      // 수동 우회 정책 — frontend가 배지 표시용으로 사용
      userOverride: !!settings.userOverride,
      ruleIntendedState: settings.ruleIntendedState ?? null,
      // 임시 타이머(override-until) — frontend 카운트다운/배지용
      overrideUntil: settings.overrideUntil ?? null,
      overrideDirection: settings.overrideDirection ?? null,
      overrideValue: settings.overrideValue ?? null,
      channelOverrides: settings.channelOverrides ?? {},
    };
  }

  // ─────────── 임시 타이머 (override-until) ───────────
  // 설정 시간 동안 강제 상태 유지(자동제어 무시) → 만료 시 자동제어 복귀.
  // 서버 저장(deviceSettings)이라 브라우저를 닫아도 만료·복귀가 보장됨.
  // - 팬/개폐기: 장치 단위 (userOverride=true + overrideUntil). 기존 relay 크론 스킵을 재활용.
  // - 관수: 채널 단위 (channelOverrides[key]). 원격제어·액비/교반기(B접점) 제외, 그 외(구역·교반기·액비모터) 허용.
  //
  // ⚠️ controlDevice 는 switchState/인터록 결과를 DB에 기록하므로, override 필드는 반드시
  //    controlDevice 이후 "다시 로드한" 최신 device 에 얹어 저장한다(과거 stale 객체 저장이
  //    controlDevice 의 기록을 덮어써 인터록·팬·채널이 동작 안 하던 버그).

  /** 관수 채널 타이머 제외 대상 — 원격제어·액비/교반기(B접점) */
  private static readonly TIMER_EXCLUDED_CHANNELS = new Set(['remote_control', 'fertilizer_b_contact']);

  async setDeviceTimer(
    id: string,
    userId: string,
    dto: { channelKey?: string; direction?: 'open' | 'close'; value?: boolean; durationMinutes: number },
    role?: string,
  ) {
    const minutes = Math.round(Number(dto.durationMinutes));
    if (!minutes || minutes < 1 || minutes > 720) {
      throw new BadRequestException('타이머 시간은 1~720분이어야 합니다.');
    }
    const until = new Date(Date.now() + minutes * 60000).toISOString();
    const device = await this.devicesRepo.findOne({ where: role === 'admin' ? { id } : { id, userId } });
    if (!device) throw new NotFoundException('장비를 찾을 수 없습니다.');
    const settings: any = device.deviceSettings || {};

    // ── 관수 채널 타이머 (원격제어·액비/교반기 B접점 제외) ──
    if (dto.channelKey) {
      const key = dto.channelKey;
      if (DevicesService.TIMER_EXCLUDED_CHANNELS.has(key)) {
        throw new BadRequestException('원격제어·액비/교반기(B접점) 채널은 타이머를 설정할 수 없습니다.');
      }
      const mapping = this.getEffectiveMapping(device);
      const switchCode = mapping[key];
      const disabled = new Set<string>(settings.disabledChannels ?? []);
      if (!switchCode || disabled.has(key)) {
        throw new BadRequestException('비활성/미매핑 채널입니다.');
      }
      await this.controlDevice(id, userId, [{ code: switchCode, value: true }], role); // 강제 ON
      // controlDevice 이후 최신 상태를 다시 로드해서 override 만 얹는다.
      const fresh = await this.devicesRepo.findOne({ where: { id } });
      const fs: any = fresh?.deviceSettings || settings;
      fs.channelOverrides = fs.channelOverrides || {};
      fs.channelOverrides[key] = { until, desiredState: true };
      if (fresh) { fresh.deviceSettings = fs; await this.devicesRepo.save(fresh); }
      return { ok: true, channelKey: key, until };
    }

    // ── 개폐기 타이머 (방향 필요, 쌍 함께 override) ──
    const isOpener = device.equipmentType === 'opener_open' || device.equipmentType === 'opener_close';
    if (isOpener) {
      if (dto.direction !== 'open' && dto.direction !== 'close') {
        throw new BadRequestException('개폐기 타이머는 방향(open/close)이 필요합니다.');
      }
      const wantOpen = dto.direction === 'open';
      const isThisOpen = device.equipmentType === 'opener_open';
      const targetId = wantOpen === isThisOpen ? device.id : (device.pairedDeviceId || device.id);
      await this.controlDevice(targetId, userId, [{ code: 'switch_1', value: true }], role); // 인터록(반대편 OFF→1초→ON)은 controlDevice가 처리
      // 인터록이 DB에 기록한 switchState 를 덮어쓰지 않도록 쌍 모두 최신 상태를 다시 로드해 override 만 얹는다.
      for (const did of [device.id, device.pairedDeviceId].filter(Boolean) as string[]) {
        const d = await this.devicesRepo.findOne({ where: { id: did } });
        if (!d) continue;
        const s: any = d.deviceSettings || {};
        s.userOverride = true; s.overrideUntil = until; s.overrideDirection = dto.direction;
        d.deviceSettings = s;
        await this.devicesRepo.save(d);
      }
      return { ok: true, direction: dto.direction, until };
    }

    // ── 팬 타이머 ──
    const value = dto.value !== false;
    await this.controlDevice(id, userId, [{ code: 'switch_1', value }], role);
    const fresh = await this.devicesRepo.findOne({ where: { id } });
    const fs: any = fresh?.deviceSettings || settings;
    fs.userOverride = true; fs.overrideUntil = until; fs.overrideValue = value;
    if (fresh) { fresh.deviceSettings = fs; await this.devicesRepo.save(fresh); }
    return { ok: true, value, until };
  }

  async cancelDeviceTimer(id: string, userId: string, dto: { channelKey?: string }, role?: string) {
    const device = await this.devicesRepo.findOne({ where: role === 'admin' ? { id } : { id, userId } });
    if (!device) throw new NotFoundException('장비를 찾을 수 없습니다.');
    const settings: any = device.deviceSettings || {};

    if (dto.channelKey) {
      const mapping = this.getEffectiveMapping(device);
      const sc = mapping[dto.channelKey];
      if (sc) await this.controlDevice(id, userId, [{ code: sc, value: false }], 'admin', 'automation').catch(() => undefined);
      if (settings.channelOverrides) delete settings.channelOverrides[dto.channelKey];
      device.deviceSettings = settings;
      await this.devicesRepo.save(device);
      return { ok: true };
    }
    // 장치 타이머 해제 → override 클리어(자동제어가 다음 tick에 재구동). 개폐기 쌍도 함께.
    for (const did of [device.id, device.pairedDeviceId].filter(Boolean) as string[]) {
      const d = did === device.id ? device : await this.devicesRepo.findOne({ where: { id: did } });
      if (!d) continue;
      const s: any = d.deviceSettings || {};
      s.userOverride = false; delete s.overrideUntil; delete s.overrideDirection; delete s.overrideValue;
      d.deviceSettings = s;
      await this.devicesRepo.save(d);
    }
    this.eventEmitter.emit('device.manual.released', { deviceId: device.id });
    return { ok: true };
  }

  /** 만료된 타이머 정리(10초 주기) — override 클리어 후 자동제어 복귀, 관수 채널은 OFF. */
  @Cron('*/10 * * * * *')
  async clearExpiredTimers() {
    const now = Date.now();
    let devices: Device[];
    try {
      devices = await this.devicesRepo.find({ where: { deviceType: 'actuator' } });
    } catch { return; }
    for (const d of devices) {
      const s: any = d.deviceSettings;
      if (!s) continue;
      let changed = false;
      if (s.overrideUntil && new Date(s.overrideUntil).getTime() <= now) {
        s.userOverride = false; delete s.overrideUntil; delete s.overrideDirection; delete s.overrideValue;
        changed = true;
        this.eventEmitter.emit('device.manual.released', { deviceId: d.id });
        this.logger.log(`[timer-expire] ${d.name} 타이머 만료 → 자동제어 복귀`);
      }
      if (s.channelOverrides && typeof s.channelOverrides === 'object') {
        const mapping = this.getEffectiveMapping(d);
        for (const [key, ov] of Object.entries<any>(s.channelOverrides)) {
          if (ov?.until && new Date(ov.until).getTime() <= now) {
            const sc = mapping[key];
            if (sc) await this.controlDevice(d.id, d.userId, [{ code: sc, value: false }], 'admin', 'automation').catch(() => undefined);
            delete s.channelOverrides[key];
            changed = true;
            this.logger.log(`[timer-expire] ${d.name}/${key} 채널 타이머 만료 → OFF·자동제어 복귀`);
          }
        }
      }
      if (changed) {
        d.deviceSettings = s;
        await this.devicesRepo.save(d).catch(() => undefined);
      }
    }
  }

  async findOneByUser(id: string, userId: string) {
    const device = await this.devicesRepo.findOne({ where: { id, userId } });
    if (!device) throw new NotFoundException('장비를 찾을 수 없습니다.');
    return device;
  }

  /**
   * 구역관리 카드 순서 배치 저장. 드래그 정렬 확정(pointerup) 시 1회 호출.
   * admin은 전체, 그 외는 본인 소유 장치만 갱신.
   */
  async reorder(
    userId: string,
    orders: { id: string; displayOrder: number }[],
    role?: string,
  ): Promise<{ updated: number }> {
    if (!Array.isArray(orders) || orders.length === 0) return { updated: 0 };
    let updated = 0;
    for (const o of orders) {
      if (!o || !o.id || typeof o.displayOrder !== 'number' || Number.isNaN(o.displayOrder)) continue;
      const where: any = role === 'admin' ? { id: o.id } : { id: o.id, userId };
      const res = await this.devicesRepo.update(where, { displayOrder: Math.round(o.displayOrder) } as any);
      updated += res.affected ?? 0;
    }
    return { updated };
  }

  /** 특정 구역(house)의 현재 최대 display_order (신규 장치 append용). 없으면 -1. */
  private async maxDisplayOrder(houseId?: string | null): Promise<number> {
    if (!houseId) return -1;
    const row = await this.devicesRepo
      .createQueryBuilder('d')
      .select('MAX(d.display_order)', 'max')
      .where('d.house_id = :houseId', { houseId })
      .getRawOne<{ max: string | null }>();
    const max = row?.max == null ? -1 : parseInt(String(row.max), 10);
    return Number.isNaN(max) ? -1 : max;
  }

  async updateByUser(id: string, userId: string, data: Partial<{ name: string; category: string; equipmentType: string; icon: string }>, role?: string) {
    // admin은 user_id 검사 없이 수정 가능
    const where: any = role === 'admin' ? { id } : { id, userId };
    const device = await this.devicesRepo.findOne({ where });
    if (!device) throw new NotFoundException('장비를 찾을 수 없습니다.');
    if (data.name !== undefined) device.name = data.name;
    if (data.category !== undefined) device.category = data.category;
    if (data.equipmentType !== undefined) device.equipmentType = data.equipmentType as any;
    if (data.icon !== undefined) device.icon = data.icon;

    // 페어 개폐기의 경우: name이 "<X> 열기" / "<X> 닫기" 패턴이면 opener_group_name도 동기화 +
    // 페어 device(반대편)의 opener_group_name도 함께 갱신 — 그룹 카드 헤더가 즉시 반영되도록.
    let openerGroupBase: string | null = null;
    if (data.name !== undefined && (device.equipmentType === 'opener_open' || device.equipmentType === 'opener_close')) {
      const m = device.name.match(/^(.+?)\s*(열기|열림|닫기|닫힘)$/);
      const base = m ? m[1].trim() : device.name.trim();
      if (base) {
        openerGroupBase = base;
        if (base !== (device as any).openerGroupName) {
          (device as any).openerGroupName = base;
          if (device.pairedDeviceId) {
            await this.devicesRepo.update({ id: device.pairedDeviceId }, { openerGroupName: base } as any);
          }
        }
      }
    }

    const saved = await this.devicesRepo.save(device);

    // 양방향 동기화: onboard device의 이름 변경 → onboard 슬롯 name도 갱신.
    // ensureOnboardDevices가 slot.name → device.name으로 흘러보내므로, slot.name을 갱신하지 않으면
    // 다음 호출에서 device.name이 옛 값으로 덮어쓰여짐.
    if (data.name !== undefined && device.source === 'onboard') {
      try {
        if (device.equipmentType === 'opener_open' || device.equipmentType === 'opener_close') {
          // 개폐기: vent_group header slot의 name을 group base로 갱신 (페어 양쪽이 같은 pair_key)
          if (openerGroupBase && device.onboardDeviceId) {
            const ownSlot = await this.onboardRepo.findOne({ where: { id: device.onboardDeviceId } as any });
            if (ownSlot?.pairKey) {
              await this.onboardRepo.update(
                { pairKey: ownSlot.pairKey, slotType: 'vent_group' } as any,
                { name: openerGroupBase } as any,
              );
            }
          }
        } else if (device.equipmentType === 'fan' && device.onboardDeviceId) {
          // 유동팬: 1:1 매핑이므로 slot.name = device.name
          await this.onboardRepo.update(
            { id: device.onboardDeviceId } as any,
            { name: device.name } as any,
          );
        } else if (device.equipmentType === 'irrigation') {
          // 관수: gateway 단위로 1 device. irrigation_group header slot이 있으면 동기화.
          // pairKey 일치하는 irrig_hdr 슬롯이 정의되어 있을 때만 의미 있음.
          const irrigHeader = await this.onboardRepo.findOne({
            where: { gatewayId: device.gatewayId as any, slotType: 'irrigation_group' as any } as any,
          });
          if (irrigHeader) {
            await this.onboardRepo.update({ id: irrigHeader.id } as any, { name: device.name } as any);
          }
        }
      } catch (err: any) {
        this.logger.warn(`onboard 슬롯 name 역동기화 실패 (device=${device.id}): ${err?.message ?? err}`);
      }
    }

    return saved;
  }

  async registerBatch(userId: string, devices: {
    zigbeeIeee: string; friendlyName?: string; zigbeeModel?: string;
    name: string; category: string; deviceType: string;
    equipmentType?: string; icon?: string; online?: boolean; gatewayId?: string;
  }[], houseId?: string) {
    const results: Device[] = [];
    // 신규 장치는 해당 구역의 max(display_order)+1 부터 부여해 섹션 끝에 붙는다.
    let nextOrder = (await this.maxDisplayOrder(houseId)) + 1;

    for (const d of devices) {
      const existing = await this.devicesRepo.findOne({
        where: { userId, zigbeeIeee: d.zigbeeIeee },
      });

      if (existing) {
        existing.name = d.name;
        existing.category = d.category;
        existing.deviceType = d.deviceType as 'sensor' | 'actuator';
        if (d.friendlyName) existing.friendlyName = d.friendlyName;
        if (d.zigbeeModel) existing.zigbeeModel = d.zigbeeModel;
        if (d.equipmentType) existing.equipmentType = d.equipmentType as any;
        if (d.icon) existing.icon = d.icon;
        if (d.gatewayId) existing.gatewayId = d.gatewayId;
        existing.online = d.online ?? existing.online;
        if (d.online) existing.lastSeen = new Date();
        if (houseId) existing.houseId = houseId;
        results.push(await this.devicesRepo.save(existing));
      } else {
        const entity = this.devicesRepo.create({
          userId,
          ...(houseId && { houseId }),
          zigbeeIeee: d.zigbeeIeee,
          friendlyName: d.friendlyName,
          zigbeeModel: d.zigbeeModel,
          name: d.name,
          category: d.category,
          deviceType: d.deviceType as 'sensor' | 'actuator',
          ...(d.equipmentType && { equipmentType: d.equipmentType as any }),
          ...(d.gatewayId && { gatewayId: d.gatewayId }),
          icon: d.icon,
          online: d.online ?? false,
          ...(d.online && { lastSeen: new Date() }),
          displayOrder: nextOrder++,
        });
        results.push(await this.devicesRepo.save(entity));
      }
    }

    // 개폐기 페어링
    const openerOpen = results.find(d => d.equipmentType === 'opener_open');
    const openerClose = results.find(d => d.equipmentType === 'opener_close');
    if (openerOpen && openerClose) {
      openerOpen.pairedDeviceId = openerClose.id;
      openerClose.pairedDeviceId = openerOpen.id;
      const groupName = devices.find(d => (d as any).openerGroupName)?.['openerGroupName'];
      if (groupName) {
        openerOpen.openerGroupName = groupName;
        openerClose.openerGroupName = groupName;
      }
      await this.devicesRepo.save([openerOpen, openerClose]);
    }

    return results;
  }

  /**
   * 자동제어룰/스케줄러용 effective mapping —
   * deviceSettings.disabledChannels에 포함된 키는 제거 (매핑 자체는 보존하되 동작 대상 제외).
   * 환경설정 UI는 device.channelMapping을 직접 사용 (전체 매핑 표시).
   */
  getEffectiveMapping(device: Device, switchCodes?: string[]): Record<string, string> {
    const base: Record<string, string> = device.channelMapping
      ? { ...device.channelMapping }
      : (() => {
          const deviceAny = device as any;
          const codes = switchCodes ?? (deviceAny.switchStates ? Object.keys(deviceAny.switchStates) : []);
          const count = detectChannelCount(codes);
          return { ...getDefaultMappingByCount(count) };
        })();
    const settings: any = device.deviceSettings || {};
    const disabled = new Set<string>(Array.isArray(settings.disabledChannels) ? settings.disabledChannels : []);
    if (disabled.size === 0) return base;
    const filtered: Record<string, string> = {};
    for (const [k, v] of Object.entries(base)) {
      if (!disabled.has(k)) filtered[k] = v;
    }
    return filtered;
  }

  async updateChannelMapping(
    id: string,
    userId: string,
    role: string,
    mapping: Record<string, string>,
  ): Promise<Device> {
    if (role !== 'admin' && role !== 'farm_admin') {
      throw new ForbiddenException('채널 매핑 수정 권한이 없습니다.');
    }
    // admin은 owner 무관하게 수정 가능
    const where: any = role === 'admin' ? { id } : { id, userId };
    const device = await this.devicesRepo.findOne({ where });
    if (!device) throw new NotFoundException('장비를 찾을 수 없습니다.');
    if (device.equipmentType !== 'irrigation') {
      throw new BadRequestException('관수 장비만 채널 매핑을 설정할 수 있습니다.');
    }
    // 8CH/12CH 모두 허용 (zigbee 컨트롤러 모델에 따라 채널 수 다름)
    const ALL_SWITCH_CODES = new Set<string>([...AVAILABLE_SWITCH_CODES, ...AVAILABLE_SWITCH_CODES_12CH]);
    const invalid = Object.values(mapping).filter(v => v !== '' && !ALL_SWITCH_CODES.has(v));
    if (invalid.length > 0) {
      throw new BadRequestException(`유효하지 않은 switch 코드: ${invalid.join(', ')}`);
    }
    device.channelMapping = mapping;
    return this.devicesRepo.save(device);
  }

  /**
   * 우적센서 rain-override 비활성화 토글 — deviceSettings.rainOverrideDisabled 갱신.
   * 오탐 방지용 (옆집 스프링쿨러 등으로 인한 잘못된 개폐기 닫힘 방지).
   */
  async updateRainOverrideDisabled(
    id: string,
    userId: string,
    role: string,
    disabled: boolean,
  ): Promise<Device> {
    const where: any = role === 'admin' ? { id } : { id, userId };
    const device = await this.devicesRepo.findOne({ where });
    if (!device) throw new NotFoundException('장비를 찾을 수 없습니다.');
    const settings: any = device.deviceSettings || {};
    settings.rainOverrideDisabled = disabled;
    device.deviceSettings = settings;
    return this.exposeSwitchFields(await this.devicesRepo.save(device));
  }

  /**
   * Zigbee 다채널 컨트롤러 child의 channel_code 변경.
   * 다른 child가 이미 사용 중인 코드면 ConflictException.
   */
  async updateChannelCode(
    id: string,
    userId: string,
    role: string,
    newChannelCode: string,
  ): Promise<Device> {
    if (role !== 'admin' && role !== 'farm_admin') {
      throw new ForbiddenException('채널 코드 수정 권한이 없습니다.');
    }
    const where: any = role === 'admin' ? { id } : { id, userId };
    const device = await this.devicesRepo.findOne({ where });
    if (!device) throw new NotFoundException('장비를 찾을 수 없습니다.');
    if (!(device as any).parentDeviceId) {
      throw new BadRequestException('child device만 channel_code 변경 가능합니다.');
    }
    // 같은 parent의 다른 child가 같은 코드 쓰는지 검사
    const conflict = await this.devicesRepo.findOne({
      where: {
        parentDeviceId: (device as any).parentDeviceId,
        channelCode: newChannelCode,
      } as any,
    });
    if (conflict && conflict.id !== device.id) {
      throw new ConflictException(`다른 채널이 이미 ${newChannelCode}를 사용 중입니다.`);
    }
    (device as any).channelCode = newChannelCode;
    return this.exposeSwitchFields(await this.devicesRepo.save(device));
  }

  /**
   * 채널 활성/비활성 토글 — 매핑은 보존, deviceSettings.disabledChannels 목록만 갱신.
   * onboard 패턴과 동일: enabled=false여도 gpio_pin/switch_code 정보는 유지.
   */
  async updateChannelEnabled(
    id: string,
    userId: string,
    role: string,
    key: string,
    enabled: boolean,
  ): Promise<Device> {
    if (role !== 'admin' && role !== 'farm_admin') {
      throw new ForbiddenException('채널 활성화 수정 권한이 없습니다.');
    }
    const where: any = role === 'admin' ? { id } : { id, userId };
    const device = await this.devicesRepo.findOne({ where });
    if (!device) throw new NotFoundException('장비를 찾을 수 없습니다.');
    // irrigation: zigbee 관수 8/12채널 + controller: 다채널 zigbee 컨트롤러 (fan/opener) 둘 다 허용
    if (device.equipmentType !== 'irrigation' && device.equipmentType !== 'controller') {
      throw new BadRequestException('관수 또는 다채널 컨트롤러 장비만 채널 활성화 상태를 설정할 수 있습니다.');
    }
    const settings: any = device.deviceSettings || {};
    const disabled = new Set<string>(Array.isArray(settings.disabledChannels) ? settings.disabledChannels : []);
    if (enabled) disabled.delete(key);
    else disabled.add(key);
    settings.disabledChannels = [...disabled];
    device.deviceSettings = settings;
    const saved = await this.devicesRepo.save(device);
    return this.exposeSwitchFields(saved);
  }

  /**
   * 장치 제어.
   * @param callerSource - 호출자 컨텍스트 (자동제어 vs 사용자 vs rain-override 구분용).
   *                       'automation' | 'rain-override' | undefined(사용자)
   */
  /**
   * 개폐기 쌍(open/close) 단위 직렬화 락.
   * 인터록(반대편 OFF→1초 대기→자기 ON)은 단일 호출 내에서만 성립하므로, 플래핑으로
   * rain-override(닫기 ON)와 자동제어(열기 ON)가 1초 이내로 겹쳐 호출되면 두 시퀀스가
   * 인터리빙돼 열기·닫기 릴레이가 동시에 ON 될 수 있다(인터록 위반). 같은 개폐기 쌍의
   * controlDevice 호출을 이 락으로 직렬화해 한 번에 하나의 OFF→대기→ON 시퀀스만 진행시킨다.
   */
  private openerLocks = new Map<string, Promise<unknown>>();

  private async withOpenerLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.openerLocks.get(key) ?? Promise.resolve();
    const run = prev.catch(() => undefined).then(fn);
    this.openerLocks.set(key, run);
    try {
      return await run;
    } finally {
      if (this.openerLocks.get(key) === run) this.openerLocks.delete(key);
    }
  }

  /** 개폐기(opener_open/close)면 쌍을 정규화한 락 키, 아니면 null. */
  private async openerLockKey(id: string, role?: string, userId?: string): Promise<string | null> {
    const d = await this.devicesRepo.findOne({ where: role === 'admin' ? { id } : { id, userId } });
    if (!d) return null;
    const isOpener = d.equipmentType === 'opener_open' || d.equipmentType === 'opener_close';
    if (!isOpener) return null;
    const pair = d.pairedDeviceId ?? undefined;
    const ids = pair ? [d.id, pair].sort() : [d.id];
    return `opener:${ids.join('|')}`;
  }

  /**
   * 공개 진입점 — 개폐기면 쌍 단위 락으로 직렬화한 뒤 실제 제어(controlDeviceInner)를 수행한다.
   * (개폐기가 아니면 락 없이 즉시 위임 — 팬/관수 등 일반 제어 경로에는 오버헤드 없음.)
   */
  async controlDevice(
    id: string,
    userId: string,
    commands: { code: string; value: any }[],
    role?: string,
    callerSource?: 'automation' | 'rain-override',
    durationMs?: number,
  ) {
    const lockKey = await this.openerLockKey(id, role, userId);
    if (lockKey) {
      return this.withOpenerLock(lockKey, () =>
        this.controlDeviceInner(id, userId, commands, role, callerSource, durationMs));
    }
    return this.controlDeviceInner(id, userId, commands, role, callerSource, durationMs);
  }

  private async controlDeviceInner(
    id: string,
    userId: string,
    commands: { code: string; value: any }[],
    role?: string,
    callerSource?: 'automation' | 'rain-override',
    /** 온보드 GPIO 개폐기 등: state=ON 이후 이 시간(ms) 뒤 gpio-agent가 자동 OFF(동작 펄스).
     *  개폐기 모터가 계속 켜지지 않도록 rain-override/자동제어의 닫힘 동작 시간에 사용. */
    durationMs?: number,
  ) {
    const device = await this.devicesRepo.findOne({ where: role === 'admin' ? { id } : { id, userId } });
    if (!device) throw new NotFoundException('장비를 찾을 수 없습니다.');
    if (!device.friendlyName) throw new BadRequestException('장비의 friendly_name이 설정되지 않았습니다.');

    // ── 수동 pin/release 정책 ──
    // 사용자 명령(callerSource undefined)일 때만 적용 — 자동제어/rain-override는 영향 없음.
    // 정책:
    //   1) ruleIntendedState가 활성(non-null)이고 새 값이 룰 의도와 다르면 → userOverride=true (pin)
    //      → 룰이 다음 cron tick에 이 device를 건너뜀 → 사용자 수동 상태 유지
    //   2) userOverride=true이고 새 값이 룰 의도와 같으면 → userOverride=false (release)
    //      → 다음 cron tick에 룰이 다시 publish하여 ON/OFF 결정
    //   3) ruleIntendedState가 null(룰 inactive)이면 일반 수동 제어, override 변경 없음
    // (단일채널 단순 비교 — irrigation/controller는 다중 스위치라 ruleIntendedState=true 기반 비교)
    if (!callerSource) {
      const settings: any = device.deviceSettings || {};
      const isOpenerDev = device.equipmentType === 'opener_open' || device.equipmentType === 'opener_close';

      // ── 개폐기: 수동 pin/release(userOverride) 정책 제거 ──
      // 개폐기는 양방향 인터록 + 펄스 듀티사이클이라 "단일 목표상태 비교" 기반 pin이 성립하지 않음
      // (수동 조작이 다음 tick에 룰에 덮여 둘 다 OFF 되는 충돌). 개폐기는 자동제어와 공존하지 않으며,
      // 활성 룰이 있으면 프론트가 '룰 정지' 팝업으로 처리한다. → openers는 pin 로직을 건너뛴다.
      if (!isOpenerDev) {
        const intent: boolean | null = settings.ruleIntendedState ?? null;
        const isOnCmd = commands.some(c => c.value === true || c.value === 'ON' || c.value === 1);
        const isOffCmd = commands.some(c => c.value === false || c.value === 'OFF' || c.value === 0);

        // 단일 ON/OFF 명령만 처리 (관수의 다중 switch는 ruleIntendedState 적용 안 함)
        if (intent != null && (isOnCmd || isOffCmd)) {
          const newValue = isOnCmd;
          if (settings.userOverride && newValue === intent) {
            settings.userOverride = false;
            device.deviceSettings = settings;
            await this.devicesRepo.save(device).catch(() => undefined);
            this.logger.log(`[manual-release] ${device.name} 자동제어 복귀 (사용자 토글이 룰 의도와 일치)`);
            // 룰이 다음 cron tick에 즉시 재평가하도록 lastState 클리어 신호 emit
            this.eventEmitter.emit('device.manual.released', { deviceId: device.id });
          } else if (!settings.userOverride && newValue !== intent) {
            settings.userOverride = true;
            device.deviceSettings = settings;
            await this.devicesRepo.save(device).catch(() => undefined);
            this.logger.log(`[manual-pin] ${device.name} 수동 우회 활성 (rule=${intent ? 'ON' : 'OFF'}, user=${newValue ? 'ON' : 'OFF'})`);
          }
        }
      }
    }

    // ── child device (다채널 컨트롤러의 채널) 경로 ──
    // parent.friendlyName + channel_code (TS0601이면 state_lN 자동 변환)
    // controlDevice의 buildMqttCommand는 switch_N → state ON/OFF만 변환하므로
    // 다채널 컨트롤러는 publishDeviceSwitch path를 사용해야 동작
    if ((device as any).parentDeviceId) {
      const gateway = device.gatewayId
        ? await this.gatewayRepo.findOne({ where: { id: device.gatewayId } })
        : null;
      if (!gateway) throw new NotFoundException('장비에 연결된 게이트웨이를 찾을 수 없습니다.');

      // 개폐기 페어 인터록 (child opener의 경우도)
      const isOpener = device.equipmentType === 'opener_open' || device.equipmentType === 'opener_close';
      const isOnCmd = commands.some(c => (c.value === true || c.value === 'ON' || c.value === 1));
      if (isOpener && isOnCmd && device.pairedDeviceId) {
        const paired = await this.devicesRepo.findOne({ where: { id: device.pairedDeviceId } });
        if (paired) {
          const pairedGw = paired.gatewayId
            ? await this.gatewayRepo.findOne({ where: { id: paired.gatewayId } })
            : gateway;
          if (pairedGw && paired.friendlyName) {
            const switchCode = (paired as any).channelCode ?? 'state';
            await this.publishDeviceSwitch(paired, pairedGw, switchCode, false);
            this.logger.log(`개폐기 인터록 (child): ${paired.name} OFF (key=${switchCode}) → 1초 대기`);
            await new Promise(r => setTimeout(r, 1000));
          }
        }
      }

      // 자기 channel_code로 publish (publishDeviceSwitch 내부에서 parent.friendlyName + state_lN 변환)
      const switchCode = (device as any).channelCode || commands[0]?.code || 'state';
      const value = commands[0]?.value === true || commands[0]?.value === 'ON' || commands[0]?.value === 1;
      await this.publishDeviceSwitch(device, gateway, switchCode, value);

      // 낙관적 상태 기록 (parent의 switchStates에)
      try {
        const parent = await this.devicesRepo.findOne({ where: { id: (device as any).parentDeviceId } });
        if (parent) {
          const psettings = (parent.deviceSettings || {}) as any;
          const pStates = { ...(psettings.switchStates || {}) };
          pStates[switchCode] = value;
          psettings.switchStates = pStates;
          psettings.lastCommandAt = new Date().toISOString();
          parent.deviceSettings = psettings;
          await this.devicesRepo.save(parent).catch(() => undefined);
        }
        // child 자신도 기록
        const csettings = (device.deviceSettings || {}) as any;
        csettings.switchState = value;
        csettings.lastCommandAt = new Date().toISOString();
        device.deviceSettings = csettings;
        await this.devicesRepo.save(device).catch(() => undefined);
      } catch (e: any) {
        this.logger.warn(`child switchState 기록 실패: ${e?.message ?? e}`);
      }

      return { success: true, deviceId: device.id, command: { [switchCode]: value }, deviceName: device.name, equipmentType: device.equipmentType };
    }

    // 사용자(명시되지 않은 callerSource) 호출일 때, 비 도중이면 자동 닫힘 suppress
    // 단 개폐기 장치(opener_*)에 한해
    if (!callerSource &&
        (device.equipmentType === 'opener_open' || device.equipmentType === 'opener_close')) {
      const groupId = await this.getDeviceGroupId(device.id);
      if (groupId && this.rainOverride) {
        await this.rainOverride.markUserOverrideIfRaining(groupId, userId, device.id);
      }
    }

    // 게이트웨이 조회
    const gateway = device.gatewayId
      ? await this.gatewayRepo.findOne({ where: { id: device.gatewayId } })
      : null;
    if (!gateway) throw new NotFoundException('장비에 연결된 게이트웨이를 찾을 수 없습니다.');

    // 관수 장비 원격제어 연동
    if (device.equipmentType === 'irrigation') {
      const mapping = this.getEffectiveMapping(device);
      const remoteSwitch = mapping['remote_control'];
      const remoteCmd = commands.find(c => c.code === remoteSwitch);
      const isOnboardIrrigation = device.source === 'onboard';

      if (remoteCmd) {
        if (remoteCmd.value === true) {
          // 원격제어 ON → fertilizer_b_contact 자동 페어 ON
          const bContactSwitch = mapping['fertilizer_b_contact'];
          if (bContactSwitch) {
            if (isOnboardIrrigation) {
              // onboard 관수: relay_XXX switchCode → slot lookup → publishGpioRelay
              await this.publishOnboardRelay(gateway.gatewayId, gateway.id, bContactSwitch, true);
            } else {
              // TS0601 다채널은 switch_N → state_lN 변환 필요 (raw 발행 시 무시됨)
              await this.mqttService.controlDevice(gateway.gatewayId, device.friendlyName,
                this.normalizeForZ2m({ [bContactSwitch]: true }, device.zigbeeModel));
            }
            // 페어 B접점 ON 을 낙관적 캐시에 기록 — UI(Groups)는 switchStates로 판정하므로
            // 미기록 시 실제 ON인데 OFF로 표시됨. (아래 메인 publish가 spread로 보존 + 저장)
            const pairSettings: any = device.deviceSettings || {};
            pairSettings.switchStates = { ...(pairSettings.switchStates || {}), [bContactSwitch]: true };
            device.deviceSettings = pairSettings;
          }
        } else if (remoteCmd.value === false) {
          // 원격제어 OFF → 모든 관수 스위치 강제 OFF (페어인 B접점 포함)
          const allSwitches = Object.values(mapping).filter(Boolean);
          if (isOnboardIrrigation) {
            for (const sw of allSwitches) {
              await this.publishOnboardRelay(gateway.gatewayId, gateway.id, sw, false).catch(() => undefined);
            }
            this.logger.log(`원격제어 OFF: onboard 전체 스위치 OFF — ${device.name}`);
          } else {
            const offPayload: Record<string, any> = {};
            for (const sw of allSwitches) offPayload[sw] = false;
            // TS0601 다채널은 switch_N → state_lN 변환 필요 (raw 발행 시 무시됨)
            await this.mqttService.controlDevice(gateway.gatewayId, device.friendlyName,
              this.normalizeForZ2m(offPayload, device.zigbeeModel));
            this.logger.log(`원격제어 OFF: 전체 스위치 OFF — ${device.name}`);
          }
          // 원격제어 OFF → 현재 진행 중인 관수 timeline만 중단 (룰 자체는 enabled 유지)
          // (정책 변경 2026-05-28: 의도치 않은 토글로 룰이 비활성화되는 사고 방지.
          //  사용자가 의식적으로 룰을 끄고 싶으면 자동제어 페이지에서 직접 toggle하도록 분리.)
          try {
            const allRules = await this.rulesRepo.find({ where: { userId: device.userId, enabled: true } });
            const affected = allRules.filter(r => {
              if ((r.conditions as any)?.type !== 'irrigation') return false;
              const acts = r.actions as any;
              const ids: string[] = [];
              if (acts?.targetDeviceId) ids.push(acts.targetDeviceId);
              if (Array.isArray(acts?.targetDeviceIds)) ids.push(...acts.targetDeviceIds);
              return ids.includes(id);
            });
            if (affected.length > 0) {
              // 스위치는 위에서 이미 OFF publish됨. 룰은 enabled 유지 — 다음 schedule에 자동 재시작.
              this.logger.log(`원격제어 OFF: 관주 룰 ${affected.length}개 enabled 보존 (다음 schedule 시간에 자동 재시작) — ${device.name}`);
            }
          } catch (err: any) {
            this.logger.warn(`관주 룰 처리 실패: ${err.message}`);
          }
          // device 상태 기록 (verify 응답용)
          const settings = (device.deviceSettings || {}) as any;
          const switchStates = { ...(settings.switchStates || {}) };
          for (const sw of allSwitches) switchStates[sw] = false;
          settings.switchStates = switchStates;
          device.deviceSettings = settings;
          await this.devicesRepo.save(device).catch(() => undefined);
          return { success: true, deviceId: device.id, command: {}, deviceName: device.name, equipmentType: device.equipmentType };
        }
      }

      // onboard 관수의 일반 switch 제어 (zone, mixer, fertilizer_motor 등) → gpio-agent
      if (isOnboardIrrigation) {
        for (const cmd of commands) {
          await this.publishOnboardRelay(gateway.gatewayId, gateway.id, cmd.code, !!cmd.value).catch((err) =>
            this.logger.warn(`onboard relay ${cmd.code} 실패: ${err.message}`)
          );
        }
        // device 상태 기록
        const settings = (device.deviceSettings || {}) as any;
        const switchStates = { ...(settings.switchStates || {}) };
        for (const cmd of commands) switchStates[cmd.code] = !!cmd.value;
        settings.switchStates = switchStates;
        settings.lastCommandAt = new Date().toISOString();
        device.deviceSettings = settings;
        await this.devicesRepo.save(device).catch(() => undefined);
        return { success: true, deviceId: device.id, command: commands, deviceName: device.name, equipmentType: device.equipmentType };
      }
    }

    // 개폐기 인터록: ON 명령 시 반대쪽을 먼저 OFF 후 1초 대기
    const isOpener = device.equipmentType === 'opener_open' || device.equipmentType === 'opener_close';
    const isOnCmd = commands.some(c => (c.value === true || c.value === 'ON' || c.value === 1));
    // 파트너(반대편) onboard GPIO 핀 — 자기 ON 발행 시 gpio-agent에 함께 실어보내
    // 하드웨어 인터록(동시 ON 방지)의 근거로 사용한다.
    let interlockPartnerPin: number | undefined;
    if (isOpener && isOnCmd && device.pairedDeviceId) {
      const paired = await this.devicesRepo.findOne({ where: { id: device.pairedDeviceId } });
      if (paired) {
        const pairedGw = paired.gatewayId
          ? await this.gatewayRepo.findOne({ where: { id: paired.gatewayId } })
          : gateway;
        if (pairedGw) {
          if (paired.source === 'onboard' && paired.onboardDeviceId) {
            // paired가 onboard 장치면 GPIO 토픽으로 OFF
            const pairedSlot = await this.onboardRepo.findOne({ where: { id: paired.onboardDeviceId } });
            if (pairedSlot?.gpioPin != null) {
              interlockPartnerPin = pairedSlot.gpioPin;
              await this.mqttService.publishGpioRelay(pairedGw.gatewayId, {
                slot: pairedSlot.slotKey,
                pin: pairedSlot.gpioPin,
                state: false,
              });
              this.logger.log(`개폐기 인터록 (GPIO): ${paired.name} (BCM${pairedSlot.gpioPin}) OFF → 1초 대기`);
            }
          } else if (paired.friendlyName) {
            // 통일 path — child device면 parent.friendlyName + channel_code 자동 처리,
            // TS0601이면 state_lN 자동 변환. (예전엔 직접 'state' 키 사용해서 다채널 컨트롤러에서 무시됨)
            const switchCode = (paired as any).channelCode ?? 'state';
            await this.publishDeviceSwitch(paired, pairedGw, switchCode, false);
            this.logger.log(`개폐기 인터록 (Zigbee): ${paired.name} OFF (key=${switchCode}) → 1초 대기`);
          }
          await new Promise(r => setTimeout(r, 1000));

          // 반대편(페어) device의 상태도 OFF로 정리 — 안 하면 자동제어 열림 + 수동 닫힘 시
          // 열림 device의 switchState/relayActivePhase가 stale하게 남아 UI에 둘 다 활성으로 보임.
          const ps: any = paired.deviceSettings || {};
          ps.switchState = false;
          ps.switchStates = { ...(ps.switchStates || {}), state: false, switch_1: false };
          ps.relayActivePhase = null;
          ps.relayActiveUntil = null;
          ps.relayActiveRuleId = null;
          ps.lastCommandAt = new Date().toISOString();
          paired.deviceSettings = ps;
          await this.devicesRepo.save(paired).catch(() => undefined);
          this.eventsGateway.broadcastDeviceSwitchUpdate(paired.userId, {
            deviceId: paired.id,
            switchState: false,
            switchStates: ps.switchStates,
          });
        }
      }
    }

    // ── Onboard fan/opener: GPIO 토픽 (farm/{gw}/gpio/relay)으로 publish ──
    // (Zigbee 토픽은 z2m이 처리하지만 onboard 장치는 gpio-agent가 처리)
    if (device.source === 'onboard' && device.onboardDeviceId) {
      const slot = await this.onboardRepo.findOne({ where: { id: device.onboardDeviceId } });
      if (slot?.gpioPin == null) {
        throw new BadRequestException(`${device.name}: GPIO 핀이 할당되지 않았습니다. 환경설정에서 핀을 지정해 주세요.`);
      }
      const stateCmd = commands.find(c => c.code === 'state' || c.code === 'switch' || c.code === 'switch_1');
      if (!stateCmd) {
        throw new BadRequestException(`onboard 장치는 state 명령만 지원합니다.`);
      }
      const isOn = stateCmd.value === true || stateCmd.value === 'ON' || stateCmd.value === 1;
      await this.mqttService.publishGpioRelay(gateway.gatewayId, {
        slot: slot.slotKey,
        pin: slot.gpioPin,
        state: isOn,
        // 개폐기 ON: 파트너 핀을 함께 실어보내 gpio-agent가 하드웨어 인터록(파트너 먼저 OFF) 적용
        ...(isOn && interlockPartnerPin != null ? { interlockPin: interlockPartnerPin } : {}),
        // 동작 펄스: state=ON + durationMs 면 gpio-agent가 durationMs 뒤 자동 OFF (모터 연속통전 방지)
        ...(durationMs && durationMs > 0 && isOn ? { durationMs } : {}),
      });
      // 상태 기록 (verify 응답용)
      const settings = (device.deviceSettings || {}) as any;
      settings.switchStates = { ...(settings.switchStates || {}), state: isOn, switch_1: isOn };
      // 단일채널 액추에이터(fan/opener_*): 최상위 switchState도 동기화.
      // (Groups.vue 개폐기 토글이 switchState로 판정 — 미저장 시 15초 폴링(fetchDevices)이
      //  DB의 stale switchState=false로 덮어써 토글이 되돌아가던 문제. zigbee 경로와 통일)
      if (device.equipmentType !== 'irrigation' && device.equipmentType !== 'controller') {
        settings.switchState = isOn;
      }
      settings.lastCommandAt = new Date().toISOString();
      device.deviceSettings = settings;
      await this.devicesRepo.save(device).catch(() => undefined);
      // UI 즉시 동기화 (다른 클라이언트/폴링 사이 공백 방지)
      this.eventsGateway.broadcastDeviceSwitchUpdate?.(device.userId, {
        deviceId: device.id,
        switchState: settings.switchState ?? null,
        switchStates: settings.switchStates,
        online: device.online,
      });
      this.logger.log(`Onboard GPIO 제어: ${device.name} (BCM${slot.gpioPin}) → ${isOn ? 'ON' : 'OFF'}`);
      return { success: true, deviceId: device.id, command: { state: isOn ? 'ON' : 'OFF', pin: slot.gpioPin }, deviceName: device.name, equipmentType: device.equipmentType };
    }

    // MQTT 커맨드 변환 (Tuya 형식 → Zigbee2MQTT 형식)
    // 다채널 컨트롤러(관수/controller)는 switch_1 축약 금지 — normalizeForZ2m가 state_l1로 변환해야 함
    const isMultiChannel = device.equipmentType === 'irrigation' || device.equipmentType === 'controller';
    const mqttCommand = this.buildMqttCommand(commands, isMultiChannel);
    // TS0601 multi-channel은 switch_N → state_lN 으로 키 변환 + "ON"/"OFF" 문자열 강제
    const mqttCommandForZ2m = this.normalizeForZ2m(mqttCommand, device.zigbeeModel);
    await this.mqttService.controlDevice(gateway.gatewayId, device.friendlyName, mqttCommandForZ2m);

    // Zigbee 장치 상태 낙관적(optimistic) 기록 — verify가 통과되도록
    // (z2m 응답이 ms 단위로 약간 늦어 verify(1초 후)가 false negative 발생하던 문제 해결)
    try {
      const settings = (device.deviceSettings || {}) as any;
      const stateStr = (mqttCommand as any).state ?? null;
      const isOn = stateStr === 'ON';
      const switchStates = { ...(settings.switchStates || {}) };
      // 단일 state 또는 switch_N 값 기록
      for (const [k, v] of Object.entries(mqttCommand as any)) {
        if (k === 'state') {
          switchStates.state = isOn;
          switchStates.switch_1 = isOn;
        } else if (k.startsWith('switch')) {
          switchStates[k] = v === 'ON' || v === true || v === 1;
        }
      }
      settings.switchStates = switchStates;
      // 단일채널 액추에이터(fan/opener_*): 최상위 switchState도 동기화
      // (Groups.vue 등 UI가 device.switchState로 토글 상태를 판정 — 미동기화 시 click 직후 OFF로 복귀)
      // 다채널(irrigation)은 switchStates 다중 키로 판정하므로 switchState 갱신 불필요.
      if (
        (mqttCommand as any).state !== undefined &&
        device.equipmentType !== 'irrigation' &&
        device.equipmentType !== 'controller'
      ) {
        settings.switchState = isOn;
      }
      settings.lastCommandAt = new Date().toISOString();
      device.deviceSettings = settings;
      await this.devicesRepo.save(device);

      // 동일한 정보를 WebSocket으로 broadcast — 다른 클라이언트도 즉시 반영
      this.eventsGateway.broadcastDeviceSwitchUpdate?.(device.userId, {
        deviceId: device.id,
        switchState: settings.switchState ?? null,
        switchStates: settings.switchStates ?? null,
        online: device.online,
      });
    } catch (err: any) {
      this.logger.warn(`Zigbee switchStates 기록 실패: ${err?.message}`);
    }

    this.logger.log(`장비 제어: ${device.name} → ${JSON.stringify(mqttCommand)}`);
    return { success: true, deviceId: device.id, command: mqttCommand, deviceName: device.name, equipmentType: device.equipmentType };
  }

  async getDeviceStatus(id: string | null, userId: string | null, role?: string) {
    // admin은 user_id 검사 없이 조회, 그 외는 userId 매칭
    const where: any = role === 'admin' || !userId ? { id } : { id, userId };
    const device = await this.devicesRepo.findOne({ where });
    if (!device) throw new NotFoundException('장비를 찾을 수 없습니다.');

    return {
      success: true,
      deviceId: device.id,
      zigbeeIeee: device.zigbeeIeee,
      online: device.online,
      lastSeen: device.lastSeen,
      switchStates: (device as any).deviceSettings?.switchStates || null,
      channelMapping: device.channelMapping || null,
      equipmentType: device.equipmentType,
      source: device.source,
    };
  }

  /** Tuya 커맨드 형식 → Zigbee2MQTT 커맨드 변환 */
  private buildMqttCommand(commands: { code: string; value: any }[], isMultiChannel = false): object {
    const result: Record<string, any> = {};
    for (const cmd of commands) {
      // 단일채널(팬/개폐기)만 switch_1 → state 축약. 다채널 컨트롤러(관수)는 switch_1을
      // 그대로 두어 normalizeForZ2m가 state_l1로 변환하게 함 (TS0601 다채널은 state 키 무시).
      if (!isMultiChannel && (cmd.code === 'switch' || cmd.code === 'switch_1')) {
        result.state = cmd.value ? 'ON' : 'OFF';
      } else if (cmd.code === 'percent_control') {
        result.position = Number(cmd.value);
      } else if (cmd.code === 'fan_speed_enum') {
        result.fan_speed = cmd.value;
      } else {
        result[cmd.code] = cmd.value;
      }
    }
    return result;
  }

  async getDependencies(id: string, userId: string) {
    const device = await this.devicesRepo.findOne({ where: { id, userId } });
    if (!device) throw new NotFoundException();

    const isOpener = device.equipmentType === 'opener_open' || device.equipmentType === 'opener_close';
    const isOpenerPair = isOpener && !!device.pairedDeviceId;

    const automationRules: { id: string; name: string; enabled: boolean }[] =
      await this.devicesRepo.query(DEVICE_DEPENDENCY_SQL, [userId, id]);

    let pairedDevice: Device | null = null;
    let pairedDeviceAutomationRules: { id: string; name: string; enabled: boolean }[] = [];

    if (isOpenerPair) {
      pairedDevice = await this.devicesRepo.findOne({ where: { id: device.pairedDeviceId } });
      if (pairedDevice) {
        pairedDeviceAutomationRules = await this.devicesRepo.query(
          DEVICE_DEPENDENCY_SQL,
          [userId, device.pairedDeviceId],
        );
      }
    }

    const groups: { id: string; name: string }[] = await this.devicesRepo.query(
      `SELECT g.id, g.name FROM house_groups g
       INNER JOIN group_devices gd ON gd.group_id = g.id
       WHERE gd.device_id = $1`,
      [id],
    );

    const canDelete = automationRules.length === 0 && pairedDeviceAutomationRules.length === 0 && groups.length === 0;

    return {
      canDelete,
      isOpenerPair,
      pairedDevice: pairedDevice
        ? { id: pairedDevice.id, name: pairedDevice.name, equipmentType: pairedDevice.equipmentType }
        : null,
      automationRules,
      ...(isOpenerPair && { pairedDeviceAutomationRules }),
      groups,
    };
  }

  async removeOpenerPair(id: string, userId: string) {
    const device = await this.devicesRepo.findOne({ where: { id, userId } });
    if (!device) throw new NotFoundException();

    const isOpener = device.equipmentType === 'opener_open' || device.equipmentType === 'opener_close';
    if (!isOpener) throw new BadRequestException('개폐기 장비가 아닙니다.');

    const pairedDevice = device.pairedDeviceId
      ? await this.devicesRepo.findOne({ where: { id: device.pairedDeviceId } })
      : null;

    const ids = [id, pairedDevice?.id].filter(Boolean) as string[];

    const allRules: { id: string; name: string; enabled: boolean }[] = [];
    for (const deviceId of ids) {
      const rules = await this.devicesRepo.query(DEVICE_DEPENDENCY_SQL, [userId, deviceId]);
      allRules.push(...rules);
    }

    if (allRules.length > 0) {
      throw new ConflictException({
        message: '자동화 룰에서 사용 중인 장비는 삭제할 수 없습니다.',
        dependencies: { automationRules: allRules },
      });
    }

    await this.devicesRepo.query('DELETE FROM group_devices WHERE device_id = ANY($1)', [ids]);
    await this.devicesRepo.delete({ id: In(ids) });

    return { message: '개폐기 페어가 삭제되었습니다.', deletedIds: ids };
  }

  async remove(id: string, userId: string, role?: string) {
    // admin은 userId 매칭 우회 (orphan/null userId device 정리 가능)
    const device = role === 'admin'
      ? await this.devicesRepo.findOne({ where: { id } })
      : await this.devicesRepo.findOne({ where: { id, userId } });
    if (!device) throw new NotFoundException();

    if (device.equipmentType === 'opener_open' || device.equipmentType === 'opener_close') {
      throw new BadRequestException('개폐기 장비는 /devices/:id/opener-pair 를 통해 쌍으로 삭제해야 합니다.');
    }

    const rules: { id: string; name: string; enabled: boolean }[] =
      await this.devicesRepo.query(DEVICE_DEPENDENCY_SQL, [userId, id]);

    if (rules.length > 0) {
      throw new ConflictException({
        message: '자동화 룰에서 사용 중인 장비는 삭제할 수 없습니다.',
        dependencies: { automationRules: rules },
      });
    }

    await this.devicesRepo.query('DELETE FROM group_devices WHERE device_id = $1', [id]);
    await this.devicesRepo.remove(device);
    return { message: '삭제되었습니다.' };
  }

  // ── device-replacement: Hot Swap (devices.id 유지, IEEE/friendly_name swap) ──

  /**
   * device-replacement 교체 전 영향 분석.
   * 보존될 자동제어룰 / 채널 매핑 / 페어 / children 카운트 + 호환 조건 반환.
   */
  async getReplacePreview(deviceId: string, userId: string, role: string) {
    const where: any = role === 'admin' ? { id: deviceId } : { id: deviceId, userId };
    const device = await this.devicesRepo.findOne({ where });
    if (!device) throw new NotFoundException('장비를 찾을 수 없습니다.');

    // 자동제어룰 카운트 (target + sensor 둘 다)
    const ruleRows: { id: string; name: string }[] = await this.devicesRepo.query(
      `SELECT id, name FROM automation_rules
       WHERE EXISTS (
         SELECT 1 FROM jsonb_array_elements(
           CASE WHEN jsonb_typeof(actions) = 'array' THEN actions ELSE jsonb_build_array(actions) END
         ) AS action
         WHERE action->>'targetDeviceId' = $1 OR action->'targetDeviceIds' ? $1
            OR action->'sensorDeviceIds' ? $1
       )
       OR conditions::text LIKE $2`,
      [deviceId, `%${deviceId}%`],
    );

    // 페어 정보
    let pairedDeviceName: string | null = null;
    if (device.pairedDeviceId) {
      const paired = await this.devicesRepo.findOne({ where: { id: device.pairedDeviceId } });
      pairedDeviceName = paired?.name ?? null;
    }

    // controller(parent)인 경우 children 카운트
    let childrenCount = 0;
    if (device.equipmentType === 'controller') {
      childrenCount = await this.devicesRepo.count({
        where: { parentDeviceId: device.id } as any,
      });
    }

    // 진행 중 관수 timeline
    const hasRunningTimeline = device.friendlyName
      ? !!this.irrigationScheduler.getActiveByDevice(device.friendlyName)
      : false;

    // 호환 채널 수 (irrigation only)
    let requireChannelCount: 8 | 12 | null = null;
    if (device.equipmentType === 'irrigation' && device.channelMapping) {
      const vals = Object.values(device.channelMapping).filter(Boolean) as string[];
      if (vals.length > 0) requireChannelCount = detectChannelCount(vals);
    }

    return {
      device: {
        id: device.id,
        name: device.name,
        equipmentType: device.equipmentType,
        zigbeeModel: device.zigbeeModel,
        zigbeeIeee: device.zigbeeIeee,
        friendlyName: device.friendlyName,
        source: device.source,
        parentDeviceId: (device as any).parentDeviceId ?? null,
        houseId: device.houseId,
      },
      impact: {
        rulesCount: ruleRows.length,
        ruleNames: ruleRows.map((r) => r.name).slice(0, 10),
        mappingKeys: Object.keys(device.channelMapping ?? {}).length,
        pairedDeviceId: device.pairedDeviceId ?? null,
        pairedDeviceName,
        childrenCount,
        hasRunningTimeline,
      },
      compatibility: {
        requireModel: device.zigbeeModel,
        requireEquipmentType: device.equipmentType,
        requireChannelCount,
        requirePair: !!device.pairedDeviceId,
        requireChildrenCount: childrenCount > 0 ? childrenCount : null,
      },
    };
  }

  /**
   * 호환성 검증 — 패밀리 base 일치 + 채널 수 (현장치 이하만 허용).
   * 정책:
   *  - base family (예: TS0601, TS0011) 동일 필요
   *  - 새 device 채널 수 >= 옛 device 채널 수 (채널 증설 케이스 허용)
   *  - 즉 8ch → 8ch, 8ch → 12ch 모두 OK / 12ch → 8ch는 거부
   *  - z2m generic 정의(model_id에 _switch_N 없음, 예: TS0601 → desc='12 gang')도
   *    base 추출 후 동일성 검사 (TS0601_switch_8 ↔ TS0601 통과)
   */
  private assertCompatible(
    oldDevice: Device,
    candidate: { zigbeeModel?: string; newChannelCount?: 1 | 8 | 12 },
  ): void {
    if (!candidate.zigbeeModel || !oldDevice.zigbeeModel) return;
    const a = candidate.zigbeeModel.toLowerCase();
    const b = oldDevice.zigbeeModel.toLowerCase();
    if (a === b) {
      // 정확 일치 — 추가 채널 수 검증도 생략 가능
    } else {
      // base family 추출 (TS0601_switch_8 → TS0601)
      const baseA = a.replace(/_switch_\d+$/, '');
      const baseB = b.replace(/_switch_\d+$/, '');
      if (baseA !== baseB) {
        throw new BadRequestException({
          error: 'incompatible',
          detail: `모델 패밀리 불일치: 기존 ${oldDevice.zigbeeModel} vs 새 ${candidate.zigbeeModel}`,
        });
      }
    }
    // 채널 수 검증 — 새 device가 옛 device 이상이어야 (증설 허용)
    const oldCh = this.extractChannelCount(oldDevice);
    const newCh = candidate.newChannelCount;
    if (oldCh && newCh && newCh < oldCh) {
      throw new BadRequestException({
        error: 'incompatible',
        detail: `채널 수 부족: 기존 ${oldCh}채널 → 새 ${newCh}채널 (이상이어야 함)`,
      });
    }
  }

  /** device의 채널 수 추정 (irrigation은 channel_mapping, controller는 children, 기타는 1) */
  private extractChannelCount(device: Device): 1 | 8 | 12 | null {
    if (device.equipmentType === 'irrigation' && device.channelMapping) {
      const vals = Object.values(device.channelMapping).filter(Boolean) as string[];
      if (vals.length > 0) return detectChannelCount(vals);
    }
    // model_id에서 _switch_N 추출
    const m = (device.zigbeeModel || '').toLowerCase().match(/_switch_(\d+)/);
    if (m) {
      const n = Number(m[1]);
      if (n >= 12) return 12;
      if (n >= 2) return 8;
      if (n === 1) return 1;
    }
    return null;
  }

  /**
   * device-replacement 핵심: devices.id 유지한 채 IEEE/friendly_name swap.
   * Controller인 경우 children도 동일 IEEE로 일괄 swap.
   * 페어 개폐기인 경우 양쪽 모두 동시 swap.
   *
   * 트랜잭션 commit 후 best-effort z2m unpair + WebSocket broadcast.
   */
  async replaceDeviceTx(args: {
    oldDeviceId: string;
    newIeee: string;
    newFriendlyName: string;
    newZigbeeModel?: string;
    /** 새 device가 갖는 채널 수 (frontend가 scan에서 detectedChannelCount로 전달) — 채널 수 >= 옛 device 검증용 */
    newChannelCount?: 1 | 8 | 12;
    pairedNewIeee?: string;
    pairedNewFriendlyName?: string;
    forceStopRunningTimeline?: boolean;
    user: { id: string; name: string; role: string };
  }) {
    const { oldDeviceId, newIeee, newFriendlyName } = args;

    // 1. 트랜잭션 처리
    const txResult = await this.dataSource.transaction(async (mgr) => {
      // 1.1 옛 device 조회 + 행 잠금
      const oldDevice = await mgr.findOne(Device, {
        where: { id: oldDeviceId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!oldDevice) throw new NotFoundException('장비를 찾을 수 없습니다.');
      if (args.user.role !== 'admin' && oldDevice.userId !== args.user.id) {
        throw new ForbiddenException('권한이 없습니다.');
      }

      // 1.2 호환성 재검증 (race condition 방지)
      this.assertCompatible(oldDevice, {
        zigbeeModel: args.newZigbeeModel,
        newChannelCount: args.newChannelCount,
      });

      // 1.3 새 IEEE 중복 검사 (자기 자신 제외)
      const dup = await mgr.findOne(Device, {
        where: { zigbeeIeee: newIeee, parentDeviceId: null } as any,
      });
      if (dup && dup.id !== oldDeviceId && dup.gatewayId === oldDevice.gatewayId) {
        throw new ConflictException({ error: 'duplicate_ieee', existingDeviceId: dup.id });
      }

      // 1.4 멱등 — same IEEE no-op
      if (oldDevice.zigbeeIeee === newIeee) {
        return {
          noop: true,
          deviceId: oldDevice.id,
          oldIeee: oldDevice.zigbeeIeee,
          newIeee,
          rulesCount: 0,
          childrenIds: [] as string[],
          pairedDeviceId: oldDevice.pairedDeviceId ?? null,
        };
      }

      // 1.5 진행 중 관수 timeline 검사
      if (oldDevice.friendlyName) {
        const active = this.irrigationScheduler.getActiveByDevice(oldDevice.friendlyName);
        if (active) {
          if (!args.forceStopRunningTimeline) {
            throw new ConflictException({ error: 'running_timeline', deviceName: oldDevice.name });
          }
          await this.irrigationScheduler.stopByDevice(oldDevice.friendlyName);
        }
      }

      // 1.6 페어 device 처리 (opener)
      let pairedDevice: Device | null = null;
      if (oldDevice.pairedDeviceId) {
        if (!args.pairedNewIeee || !args.pairedNewFriendlyName) {
          throw new ConflictException({
            error: 'pair_required',
            pairedDeviceId: oldDevice.pairedDeviceId,
          });
        }
        pairedDevice = await mgr.findOne(Device, {
          where: { id: oldDevice.pairedDeviceId },
          lock: { mode: 'pessimistic_write' },
        });
        if (pairedDevice) {
          const pairDup = await mgr.findOne(Device, {
            where: { zigbeeIeee: args.pairedNewIeee, parentDeviceId: null } as any,
          });
          if (pairDup && pairDup.id !== pairedDevice.id && pairDup.gatewayId === pairedDevice.gatewayId) {
            throw new ConflictException({ error: 'duplicate_ieee', existingDeviceId: pairDup.id });
          }
        }
      }

      // 1.7 Controller(parent)인 경우 children 조회 + 잠금
      let children: Device[] = [];
      if (oldDevice.equipmentType === 'controller') {
        children = await mgr.find(Device, {
          where: { parentDeviceId: oldDevice.id } as any,
          lock: { mode: 'pessimistic_write' },
        });
      }

      // 1.8 UPDATE — 옛 device 식별자 swap
      const oldIeee = oldDevice.zigbeeIeee ?? '';
      oldDevice.zigbeeIeee = newIeee;
      oldDevice.friendlyName = newFriendlyName;
      if (args.newZigbeeModel) oldDevice.zigbeeModel = args.newZigbeeModel;
      oldDevice.lastSeen = new Date();
      oldDevice.online = true;
      await mgr.save(oldDevice);

      // 1.9 Children도 동일 IEEE/friendly_name으로 일괄 swap
      const childrenIds: string[] = [];
      if (children.length > 0) {
        for (const c of children) {
          c.zigbeeIeee = newIeee;
          c.friendlyName = newFriendlyName;
          if (args.newZigbeeModel) c.zigbeeModel = args.newZigbeeModel;
          c.lastSeen = new Date();
          c.online = true;
          childrenIds.push(c.id);
        }
        await mgr.save(children);
      }

      // 1.10 페어 device swap
      let pairedOldIeee: string | undefined;
      if (pairedDevice && args.pairedNewIeee) {
        pairedOldIeee = pairedDevice.zigbeeIeee ?? undefined;
        pairedDevice.zigbeeIeee = args.pairedNewIeee;
        pairedDevice.friendlyName = args.pairedNewFriendlyName!;
        if (args.newZigbeeModel) pairedDevice.zigbeeModel = args.newZigbeeModel;
        pairedDevice.lastSeen = new Date();
        pairedDevice.online = true;
        await mgr.save(pairedDevice);
      }

      // 1.11 자동제어룰 카운트
      const ruleRows: { id: string }[] = await mgr.query(
        `SELECT id FROM automation_rules WHERE EXISTS (
           SELECT 1 FROM jsonb_array_elements(
             CASE WHEN jsonb_typeof(actions) = 'array' THEN actions ELSE jsonb_build_array(actions) END
           ) AS action
           WHERE action->>'targetDeviceId' = $1 OR action->'targetDeviceIds' ? $1
              OR action->'sensorDeviceIds' ? $1
         )
         OR conditions::text LIKE $2`,
        [oldDeviceId, `%${oldDeviceId}%`],
      );

      return {
        noop: false,
        deviceId: oldDevice.id,
        gatewayId: oldDevice.gatewayId,
        deviceName: oldDevice.name,
        userId: oldDevice.userId,
        oldIeee,
        newIeee,
        pairedDeviceId: pairedDevice?.id ?? null,
        pairedOldIeee,
        pairedNewIeee: args.pairedNewIeee,
        childrenIds,
        rulesCount: ruleRows.length,
        mappingKeysCount: Object.keys(oldDevice.channelMapping ?? {}).length,
      };
    });

    // 2. 트랜잭션 commit 후 best-effort cleanup + 알림

    // 2.1 activity_logs
    await this.activityLog.log({
      userId: args.user.id,
      userName: args.user.name,
      action: 'device.replace',
      targetType: 'device',
      targetId: txResult.deviceId,
      targetName: txResult.deviceName ?? txResult.deviceId,
      details: {
        oldIeee: txResult.oldIeee,
        newIeee: txResult.newIeee,
        pairedOldIeee: txResult.pairedOldIeee,
        pairedNewIeee: txResult.pairedNewIeee,
        childrenCount: txResult.childrenIds.length,
        preservedRules: txResult.rulesCount,
        noop: txResult.noop,
      },
    }).catch((e) => this.logger.warn(`activity_log 실패: ${e?.message ?? e}`));

    if (txResult.noop) {
      return {
        success: true, noop: true,
        deviceId: txResult.deviceId,
        oldIeee: txResult.oldIeee, newIeee: txResult.newIeee,
        preserved: { rules: 0, mappingKeys: 0, childrenCount: 0 },
      };
    }

    // 2.2 z2m unpair (best-effort)
    if (txResult.gatewayId && txResult.oldIeee && txResult.oldIeee !== txResult.newIeee) {
      try {
        // gatewayId UUID → gatewayId string 변환
        const gw = await this.gatewayRepo.findOne({ where: { id: txResult.gatewayId } });
        if (gw?.gatewayId) {
          await this.mqttService.removeZigbeeDevice(gw.gatewayId, txResult.oldIeee);
          if (txResult.pairedOldIeee && txResult.pairedOldIeee !== txResult.pairedNewIeee) {
            await this.mqttService.removeZigbeeDevice(gw.gatewayId, txResult.pairedOldIeee);
          }
        }
      } catch (e: any) {
        this.logger.warn(`z2m unpair 실패 — 운영자가 수동 정리 가능: ${e?.message ?? e}`);
      }
    }

    // 2.3 WebSocket broadcast
    try {
      this.eventsGateway.broadcastDeviceReplaced(txResult.userId ?? args.user.id, {
        deviceId: txResult.deviceId,
        oldIeee: txResult.oldIeee,
        newIeee: txResult.newIeee,
        gatewayId: txResult.gatewayId,
        preservedRules: txResult.rulesCount,
        pairedDeviceId: txResult.pairedDeviceId,
        childrenIds: txResult.childrenIds.length > 0 ? txResult.childrenIds : undefined,
      });
    } catch (e: any) {
      this.logger.warn(`device:replaced broadcast 실패: ${e?.message ?? e}`);
    }

    return {
      success: true,
      noop: false,
      deviceId: txResult.deviceId,
      oldIeee: txResult.oldIeee,
      newIeee: txResult.newIeee,
      pairedDeviceId: txResult.pairedDeviceId,
      preserved: {
        rules: txResult.rulesCount,
        mappingKeys: txResult.mappingKeysCount,
        childrenCount: txResult.childrenIds.length,
      },
    };
  }
}
