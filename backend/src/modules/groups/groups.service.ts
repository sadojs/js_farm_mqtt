import { ConflictException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { HouseGroup } from './entities/house-group.entity';
import { House } from './entities/house.entity';
import { Device } from '../devices/entities/device.entity';
import { AutomationRule } from '../automation/entities/automation-rule.entity';
import { Gateway } from '../gateway-manager/entities/gateway.entity';
import { MqttService } from '../mqtt/mqtt.service';

@Injectable()
export class GroupsService {
  constructor(
    @InjectRepository(HouseGroup) private groupsRepo: Repository<HouseGroup>,
    @InjectRepository(House) private housesRepo: Repository<House>,
    @InjectRepository(Device) private devicesRepo: Repository<Device>,
    @InjectRepository(AutomationRule) private rulesRepo: Repository<AutomationRule>,
    @InjectRepository(Gateway) private gatewayRepo: Repository<Gateway>,
    @Optional() @Inject(MqttService) private mqttService?: MqttService,
  ) {}

  async findAllGroups(userId: string) {
    return this.groupsRepo.find({
      where: { userId },
      relations: ['houses', 'devices'],
      order: { createdAt: 'DESC' },
    });
  }

  async createGroup(userId: string, data: { name: string; description?: string; manager?: string; houseIds?: string[] }) {
    const group = this.groupsRepo.create({
      userId,
      name: data.name,
      description: data.description,
      manager: data.manager,
    });
    const saved = await this.groupsRepo.save(group);

    if (data.houseIds?.length) {
      await this.housesRepo.update(
        data.houseIds.map(id => ({ id, userId })) as any,
        { groupId: saved.id },
      );
    }
    return this.groupsRepo.findOne({ where: { id: saved.id }, relations: ['houses'] });
  }

  async findAllHouses(userId: string) {
    return this.housesRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  async createHouse(userId: string, data: { name: string; location?: string; description?: string; area?: number; groupId?: string }) {
    const house = this.housesRepo.create({ userId, ...data });
    return this.housesRepo.save(house);
  }

  async updateGroup(id: string, userId: string, data: { name?: string; description?: string; manager?: string; enableGroupControl?: boolean; enableAutomation?: boolean }) {
    const group = await this.groupsRepo.findOne({ where: { id, userId } });
    if (!group) throw new NotFoundException();

    if (data.name !== undefined) group.name = data.name;
    if (data.description !== undefined) group.description = data.description;
    if (data.manager !== undefined) group.manager = data.manager;
    if (data.enableGroupControl !== undefined) group.enableGroupControl = data.enableGroupControl;
    if (data.enableAutomation !== undefined) group.enableAutomation = data.enableAutomation;

    await this.groupsRepo.save(group);
    return this.groupsRepo.findOne({ where: { id }, relations: ['houses'] });
  }

  async getDependencies(id: string, userId: string) {
    const group = await this.groupsRepo.findOne({ where: { id, userId } });
    if (!group) throw new NotFoundException();

    const automationRules = await this.rulesRepo.find({
      where: { groupId: id, userId },
      select: ['id', 'name', 'enabled'],
    });

    return {
      canDelete: automationRules.length === 0,
      automationRules: automationRules.map(r => ({ id: r.id, name: r.name, enabled: r.enabled })),
    };
  }

  async removeGroup(id: string, userId: string) {
    const group = await this.groupsRepo.findOne({ where: { id, userId } });
    if (!group) throw new NotFoundException();

    // 자동화 의존성 체크
    const rules = await this.rulesRepo.find({
      where: { groupId: id, userId },
      select: ['id', 'name', 'enabled'],
    });

    if (rules.length > 0) {
      throw new ConflictException({
        message: '자동화 룰에서 사용 중인 그룹은 삭제할 수 없습니다.',
        dependencies: {
          automationRules: rules.map(r => ({ id: r.id, name: r.name, enabled: r.enabled })),
        },
      });
    }

    await this.groupsRepo.remove(group);
    return { message: '삭제되었습니다.' };
  }

  async updateHouse(id: string, userId: string, data: { name?: string; location?: string; description?: string; area?: number; groupId?: string }) {
    const house = await this.housesRepo.findOne({ where: { id, userId } });
    if (!house) throw new NotFoundException();

    if (data.name !== undefined) house.name = data.name;
    if (data.location !== undefined) house.location = data.location;
    if (data.description !== undefined) house.description = data.description;
    if (data.area !== undefined) house.area = data.area;
    if (data.groupId !== undefined) house.groupId = data.groupId;

    return this.housesRepo.save(house);
  }

  async removeHouse(id: string, userId: string) {
    const house = await this.housesRepo.findOne({ where: { id, userId } });
    if (!house) throw new NotFoundException();
    await this.housesRepo.remove(house);
    return { message: '삭제되었습니다.' };
  }

  /** 그룹 내 actuator 장비 일괄 제어 */
  async controlGroup(groupId: string, userId: string, commands: { code: string; value: any }[]) {
    const group = await this.groupsRepo.findOne({
      where: { id: groupId, userId },
      relations: ['devices'],
    });
    if (!group) throw new NotFoundException('그룹을 찾을 수 없습니다.');

    const actuators = (group.devices || []).filter(d => d.deviceType === 'actuator');
    const results: { deviceId: string; name: string; success: boolean; error?: string }[] = [];

    for (const device of actuators) {
      try {
        if (!device.gatewayId || !device.friendlyName || !this.mqttService) {
          results.push({ deviceId: device.id, name: device.name, success: false, error: 'MQTT 미연결 또는 장비 정보 없음' });
          continue;
        }
        const gateway = await this.gatewayRepo.findOne({ where: { id: device.gatewayId } });
        if (!gateway) {
          results.push({ deviceId: device.id, name: device.name, success: false, error: '게이트웨이 없음' });
          continue;
        }
        const command: Record<string, any> = {};
        for (const cmd of commands) {
          command[cmd.code] = cmd.value;
        }
        await this.mqttService.controlDevice(gateway.gatewayId, device.friendlyName, command);
        results.push({ deviceId: device.id, name: device.name, success: true });
      } catch (err: any) {
        results.push({ deviceId: device.id, name: device.name, success: false, error: err.message });
      }
    }

    return { groupId, controlled: results.length, results };
  }

  async assignDevices(groupId: string, userId: string, deviceIds: string[]) {
    const group = await this.groupsRepo.findOne({
      where: { id: groupId, userId },
      relations: ['devices'],
    });
    if (!group) throw new NotFoundException();

    const devices = await this.devicesRepo.find({
      where: { id: In(deviceIds), userId },
    });

    group.devices = [...group.devices, ...devices.filter(d => !group.devices.some(gd => gd.id === d.id))];
    await this.groupsRepo.save(group);

    return this.groupsRepo.findOne({
      where: { id: groupId },
      relations: ['houses', 'devices'],
    });
  }

  async removeDeviceFromGroup(groupId: string, userId: string, deviceId: string) {
    const group = await this.groupsRepo.findOne({
      where: { id: groupId, userId },
      relations: ['devices'],
    });
    if (!group) throw new NotFoundException();

    group.devices = group.devices.filter(d => d.id !== deviceId);
    await this.groupsRepo.save(group);

    return { message: '장비가 그룹에서 제거되었습니다.' };
  }
}
