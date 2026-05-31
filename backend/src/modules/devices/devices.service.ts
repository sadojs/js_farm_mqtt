// controller equipment_type support added (zigbee-channel-actuator)
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, forwardRef } from '@nestjs/common';
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
  ) {}

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
    await this.mqttService.controlDevice(gateway.gatewayId, publishFriendlyName, {
      [z2mKey]: value,
    });
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
    return {
      ...device,
      switchState: settings.switchState ?? null,
      switchStates: settings.switchStates ?? null,
      relayActivePhase: settings.relayActivePhase ?? null,
      disabledChannels: Array.isArray(settings.disabledChannels) ? settings.disabledChannels : [],
      rainOverrideDisabled: !!settings.rainOverrideDisabled,
    };
  }

  async findOneByUser(id: string, userId: string) {
    const device = await this.devicesRepo.findOne({ where: { id, userId } });
    if (!device) throw new NotFoundException('장비를 찾을 수 없습니다.');
    return device;
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
  async controlDevice(
    id: string,
    userId: string,
    commands: { code: string; value: any }[],
    role?: string,
    callerSource?: 'automation' | 'rain-override',
  ) {
    const device = await this.devicesRepo.findOne({ where: role === 'admin' ? { id } : { id, userId } });
    if (!device) throw new NotFoundException('장비를 찾을 수 없습니다.');
    if (!device.friendlyName) throw new BadRequestException('장비의 friendly_name이 설정되지 않았습니다.');

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
              await this.mqttService.controlDevice(gateway.gatewayId, device.friendlyName, {
                [bContactSwitch]: true,
              });
            }
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
            await this.mqttService.controlDevice(gateway.gatewayId, device.friendlyName, offPayload);
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
      });
      // 상태 기록 (verify 응답용)
      const settings = (device.deviceSettings || {}) as any;
      settings.switchStates = { ...(settings.switchStates || {}), state: isOn, switch_1: isOn };
      settings.lastCommandAt = new Date().toISOString();
      device.deviceSettings = settings;
      await this.devicesRepo.save(device).catch(() => undefined);
      this.logger.log(`Onboard GPIO 제어: ${device.name} (BCM${slot.gpioPin}) → ${isOn ? 'ON' : 'OFF'}`);
      return { success: true, deviceId: device.id, command: { state: isOn ? 'ON' : 'OFF', pin: slot.gpioPin }, deviceName: device.name, equipmentType: device.equipmentType };
    }

    // MQTT 커맨드 변환 (Tuya 형식 → Zigbee2MQTT 형식)
    const mqttCommand = this.buildMqttCommand(commands);
    await this.mqttService.controlDevice(gateway.gatewayId, device.friendlyName, mqttCommand);

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
      settings.lastCommandAt = new Date().toISOString();
      device.deviceSettings = settings;
      await this.devicesRepo.save(device);
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
  private buildMqttCommand(commands: { code: string; value: any }[]): object {
    const result: Record<string, any> = {};
    for (const cmd of commands) {
      if (cmd.code === 'switch' || cmd.code === 'switch_1') {
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
   * 호환성 엄격 검증 — zigbee_model + equipment_type 일치.
   * controller인 경우 채널 수 추가 검증.
   */
  private assertCompatible(
    oldDevice: Device,
    candidate: { zigbeeModel?: string; newChannelCount?: 8 | 12 },
  ): void {
    if (candidate.zigbeeModel && oldDevice.zigbeeModel
      && candidate.zigbeeModel.toLowerCase() !== oldDevice.zigbeeModel.toLowerCase()) {
      throw new BadRequestException({
        error: 'incompatible',
        detail: `모델 불일치: 기존 ${oldDevice.zigbeeModel} vs 새 ${candidate.zigbeeModel}`,
      });
    }
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
      this.assertCompatible(oldDevice, { zigbeeModel: args.newZigbeeModel });

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
