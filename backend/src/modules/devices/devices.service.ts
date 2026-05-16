import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { RainOverrideService } from '../rain-override/rain-override.service';
import { Device } from './entities/device.entity';
import { AutomationRule } from '../automation/entities/automation-rule.entity';
import { Gateway } from '../gateway-manager/entities/gateway.entity';
import { GatewayOnboardDevice } from '../gateway-env/entities/gateway-onboard-device.entity';
import { MqttService } from '../mqtt/mqtt.service';
import { AVAILABLE_SWITCH_CODES, detectChannelCount, getDefaultMappingByCount } from './channel-mapping.constants';

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
  ) {}

  /** 장치가 속한 구역(house_group) ID 조회 — rain-override 등에서 사용 */
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
    return this.devicesRepo.find({
      where: role === 'admin' ? {} : { userId },
      order: { createdAt: 'DESC' },
    });
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
    return this.devicesRepo.save(device);
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

  getEffectiveMapping(device: Device, switchCodes?: string[]): Record<string, string> {
    if (device.channelMapping) return { ...device.channelMapping };
    const deviceAny = device as any;
    const codes = switchCodes ?? (deviceAny.switchStates ? Object.keys(deviceAny.switchStates) : []);
    const count = detectChannelCount(codes);
    return { ...getDefaultMappingByCount(count) };
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
    const device = await this.devicesRepo.findOne({ where: { id, userId } });
    if (!device) throw new NotFoundException('장비를 찾을 수 없습니다.');
    if (device.equipmentType !== 'irrigation') {
      throw new BadRequestException('관수 장비만 채널 매핑을 설정할 수 있습니다.');
    }
    const invalid = Object.values(mapping).filter(v => v !== '' && !AVAILABLE_SWITCH_CODES.includes(v));
    if (invalid.length > 0) {
      throw new BadRequestException(`유효하지 않은 switch 코드: ${invalid.join(', ')}`);
    }
    device.channelMapping = mapping;
    return this.devicesRepo.save(device);
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

      if (remoteCmd) {
        if (remoteCmd.value === true) {
          // 원격제어 ON → fertilizer_b_contact 자동 ON
          const bContactSwitch = mapping['fertilizer_b_contact'];
          await this.mqttService.controlDevice(gateway.gatewayId, device.friendlyName, {
            [bContactSwitch]: true,
          });
        } else if (remoteCmd.value === false) {
          // 원격제어 OFF → 모든 관수 스위치 강제 OFF
          const allSwitches = Object.values(mapping).filter(Boolean);
          const offPayload: Record<string, any> = {};
          for (const sw of allSwitches) offPayload[sw] = false;
          await this.mqttService.controlDevice(gateway.gatewayId, device.friendlyName, offPayload);
          this.logger.log(`원격제어 OFF: 전체 스위치 OFF — ${device.name}`);
          // 원격제어 OFF → 해당 장치의 활성 관주 자동화 룰 전체 비활성화
          try {
            const allRules = await this.rulesRepo.find({ where: { userId: device.userId, enabled: true } });
            const toDisable = allRules.filter(r => {
              if ((r.conditions as any)?.type !== 'irrigation') return false;
              const acts = r.actions as any;
              const ids: string[] = [];
              if (acts?.targetDeviceId) ids.push(acts.targetDeviceId);
              if (Array.isArray(acts?.targetDeviceIds)) ids.push(...acts.targetDeviceIds);
              return ids.includes(id);
            });
            if (toDisable.length > 0) {
              for (const r of toDisable) r.enabled = false;
              await this.rulesRepo.save(toDisable);
              this.logger.log(`원격제어 OFF → 관주 룰 ${toDisable.length}개 자동 비활성화: ${device.name}`);
            }
          } catch (err: any) {
            this.logger.warn(`관주 룰 비활성화 실패: ${err.message}`);
          }
          return { success: true, deviceId: device.id, command: offPayload, deviceName: device.name, equipmentType: device.equipmentType };
        }
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
            await this.mqttService.controlDevice(pairedGw.gatewayId, paired.friendlyName, { state: 'OFF' });
            this.logger.log(`개폐기 인터록 (Zigbee): ${paired.name} OFF → 1초 대기`);
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

  async remove(id: string, userId: string) {
    const device = await this.devicesRepo.findOne({ where: { id, userId } });
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
}
