import { BadRequestException, ConflictException, ForbiddenException, forwardRef, Inject, Injectable, InternalServerErrorException, Logger, NotFoundException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { DevicesService } from '../devices/devices.service';
import { HouseGroup } from './entities/house-group.entity';
import { House } from './entities/house.entity';
import { Device } from '../devices/entities/device.entity';
import { AutomationRule } from '../automation/entities/automation-rule.entity';
import { Gateway } from '../gateway-manager/entities/gateway.entity';
import { User } from '../users/entities/user.entity';
import { MqttService } from '../mqtt/mqtt.service';
import { farmNameOf } from '../users/farm-name.util';

@Injectable()
export class GroupsService {
  private readonly logger = new Logger(GroupsService.name);

  constructor(
    @InjectRepository(HouseGroup) private groupsRepo: Repository<HouseGroup>,
    @InjectRepository(House) private housesRepo: Repository<House>,
    @InjectRepository(Device) private devicesRepo: Repository<Device>,
    @InjectRepository(AutomationRule) private rulesRepo: Repository<AutomationRule>,
    @InjectRepository(Gateway) private gatewayRepo: Repository<Gateway>,
    @InjectRepository(User) private usersRepo: Repository<User>,
    @Inject(forwardRef(() => DevicesService)) private devicesService: DevicesService,
    @Optional() @Inject(MqttService) private mqttService?: MqttService,
  ) {}

  /** 구역 표시 순서 배치 저장 (드래그 정렬). admin은 전체, 그 외 본인 소유만. */
  async reorderGroups(
    userId: string,
    orders: { id: string; displayOrder: number }[],
    role?: string,
  ): Promise<{ updated: number }> {
    if (!Array.isArray(orders) || orders.length === 0) return { updated: 0 };
    let updated = 0;
    for (const o of orders) {
      if (!o || !o.id || typeof o.displayOrder !== 'number' || Number.isNaN(o.displayOrder)) continue;
      const where: any = role === 'admin' ? { id: o.id } : { id: o.id, userId };
      const res = await this.groupsRepo.update(where, { displayOrder: Math.round(o.displayOrder) } as any);
      updated += res.affected ?? 0;
    }
    return { updated };
  }

  async findAllGroups(
    userId: string,
    role?: string,
    opts: { iotOnly?: boolean } = {},
  ) {
    const isAdmin = role === 'admin';
    const groups = await this.groupsRepo.find({
      where: isAdmin ? {} : { userId },
      relations: ['houses', 'devices'],
      order: { displayOrder: 'ASC', createdAt: 'ASC' },
    });

    let filtered = groups;
    if (opts.iotOnly) {
      // group 자체가 iot_enabled=false 면 제외. group 은 true 라도 내부 houses 중 false 는 제외.
      filtered = groups.filter((g) => g.iotEnabled !== false);
      for (const g of filtered) {
        g.houses = (g.houses ?? []).filter((h) => h.iotEnabled !== false);
      }
    }

    // 구역에 연결된 게이트웨이의 장치를 구역 장치로 포함 (게이트웨이 → 구역 직접, migration 053)
    const groupIds = groups.map(g => g.id);
    if (groupIds.length > 0) {
      const gateways = await this.gatewayRepo.find({ where: { groupId: In(groupIds) } });
      if (gateways.length > 0) {
        const gatewayIds = gateways.map(gw => gw.id);
        const gwDevices = await this.devicesRepo.find({
          where: isAdmin ? { gatewayId: In(gatewayIds) } : { gatewayId: In(gatewayIds), userId },
        });

        const gwToGroupMap = new Map(gateways.map(gw => [gw.id, gw.groupId!]));
        const devicesByGroup = new Map<string, Device[]>();

        for (const device of gwDevices) {
          const groupId = gwToGroupMap.get(device.gatewayId);
          if (!groupId) continue;
          if (!devicesByGroup.has(groupId)) devicesByGroup.set(groupId, []);
          devicesByGroup.get(groupId)!.push(device);
        }

        for (const group of groups) {
          const gwDevs = devicesByGroup.get(group.id) ?? [];
          const existingIds = new Set(group.devices.map(d => d.id));
          for (const d of gwDevs) {
            if (!existingIds.has(d.id)) {
              group.devices.push(d);
              existingIds.add(d.id);
            }
          }
        }
      }
    }

    if (isAdmin && filtered.length > 0) {
      const userIds = [...new Set(filtered.map(g => g.userId))];
      const users = await this.usersRepo.find({ where: { id: In(userIds) } });
      const userMap = new Map(users.map(u => [u.id, u]));
      return filtered.map(g => ({
        ...g,
        ownerName: userMap.get(g.userId)?.name ?? '',
        ownerFarmName: farmNameOf(userMap.get(g.userId)) ?? '',
        ownerUsername: userMap.get(g.userId)?.username ?? '',
      }));
    }

    return filtered;
  }

  async assignGatewayToGroup(groupId: string, userId: string, gatewayId: string) {
    const group = await this.groupsRepo.findOne({ where: { id: groupId, userId }, relations: ['houses'] });
    if (!group) throw new NotFoundException('그룹을 찾을 수 없습니다.');

    const gateway = await this.gatewayRepo.findOne({ where: { id: gatewayId } });
    if (!gateway) throw new NotFoundException('게이트웨이를 찾을 수 없습니다.');
    if (gateway.userId !== userId) throw new ForbiddenException('권한이 없습니다.');

    // 구역당 게이트웨이 1대 (migration 053)
    const occupied = await this.gatewayRepo.findOne({ where: { groupId: group.id } });
    if (occupied && occupied.id !== gatewayId) {
      throw new ConflictException(`"${group.name}" 구역에는 이미 게이트웨이 "${occupied.name}"이(가) 연결되어 있습니다. 한 구역에는 게이트웨이 1대만 연결할 수 있습니다.`);
    }

    // Get or create a house for this group (되돌리기 대비 — 2단계에서 제거)
    let house = group.houses[0];
    if (!house) {
      house = await this.housesRepo.save(
        this.housesRepo.create({ userId, name: group.name, groupId: group.id }),
      );
    }

    // Assign gateway to zone (+ house)
    await this.gatewayRepo.update({ id: gatewayId }, { houseId: house.id, groupId: group.id });

    // Auto-propagate houseId to all existing devices of this gateway
    await this.devicesRepo.update({ gatewayId, userId }, { houseId: house.id });

    return this.groupsRepo.findOne({ where: { id: groupId }, relations: ['houses', 'devices'] });
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

  async findAllHouses(userId: string, opts: { iotOnly?: boolean } = {}) {
    const where: any = { userId };
    if (opts.iotOnly) where.iotEnabled = true;
    return this.housesRepo.find({
      where,
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * 토글 단위는 HouseGroup (사용자가 화면에서 보는 "구역" 카드).
   * group iot_enabled 변경 시 휘하 houses 도 동일하게 맞춰서 일관성 유지.
   */
  async bulkUpdateIotEnabled(
    userId: string,
    role: string | undefined,
    updates: Array<{ id: string; enabled: boolean }>,
  ) {
    if (!updates.length) return { updated: 0 };
    const isAdmin = role === 'admin';
    const ids = updates.map((u) => u.id);
    const groups = await this.groupsRepo.find({
      where: { id: In(ids) },
      relations: ['houses'],
    });

    if (!isAdmin) {
      const denied = groups.find((g) => g.userId !== userId);
      if (denied) throw new ForbiddenException('권한이 없는 구역이 포함되어 있습니다.');
    }

    const byId = new Map(updates.map((u) => [u.id, u.enabled]));
    const housesToSave: House[] = [];
    for (const g of groups) {
      const next = byId.get(g.id);
      if (next === undefined) continue;
      g.iotEnabled = next;
      for (const h of g.houses ?? []) {
        if (h.iotEnabled !== next) {
          h.iotEnabled = next;
          housesToSave.push(h);
        }
      }
    }
    await this.groupsRepo.save(groups);
    if (housesToSave.length) await this.housesRepo.save(housesToSave);
    return { updated: groups.length };
  }

  /**
   * group(구역) 단위 영향 카운트 — 그 group 에 매핑된 device / 자동화 룰 / 게이트웨이.
   */
  async getIotRelatedCounts(
    userId: string,
    role: string | undefined,
    groupIds: string[],
  ) {
    const empty = { totals: { device: 0, rule: 0, gateway: 0 }, perHouse: [] as any[] };
    if (!groupIds.length) return empty;

    const isAdmin = role === 'admin';
    const groups = await this.groupsRepo.find({
      where: { id: In(groupIds) },
      relations: ['houses', 'devices'],
    });
    const scoped = isAdmin ? groups : groups.filter((g) => g.userId === userId);
    if (!scoped.length) return empty;

    const scopedIds = scoped.map((g) => g.id);
    const gws = scopedIds.length
      ? await this.gatewayRepo.find({ where: { groupId: In(scopedIds) } })
      : [];
    const gwCntByGroup = new Map<string, number>();
    const gwIdsByGroup = new Map<string, string[]>();
    for (const gw of gws) {
      const gId = gw.groupId;
      if (!gId) continue;
      gwCntByGroup.set(gId, (gwCntByGroup.get(gId) ?? 0) + 1);
      const arr = gwIdsByGroup.get(gId) ?? [];
      arr.push(gw.id);
      gwIdsByGroup.set(gId, arr);
    }

    const allGwIds = gws.map((g) => g.id);
    const devices = allGwIds.length
      ? await this.devicesRepo.find({
          where: { gatewayId: In(allGwIds) },
          select: ['id', 'gatewayId'],
        })
      : [];
    const gwToGroup = new Map(gws.map((g) => [g.id, g.groupId!]));
    const deviceCntByGroup = new Map<string, number>();
    for (const d of devices) {
      const gId = gwToGroup.get(d.gatewayId);
      if (!gId) continue;
      deviceCntByGroup.set(gId, (deviceCntByGroup.get(gId) ?? 0) + 1);
    }
    // group_devices (M:N) 도 합산 — 게이트웨이 경로 외에 그룹에 수동 할당된 장치
    for (const g of scoped) {
      const extra = (g.devices ?? []).filter((d) => !devices.some((dx) => dx.id === d.id));
      if (extra.length) {
        deviceCntByGroup.set(g.id, (deviceCntByGroup.get(g.id) ?? 0) + extra.length);
      }
    }

    const rules = await this.rulesRepo.find({
      where: { groupId: In(scoped.map((g) => g.id)) } as any,
      select: ['id', 'groupId'] as any,
    });
    const ruleCntByGroup = new Map<string, number>();
    for (const r of rules as any[]) {
      if (!r.groupId) continue;
      ruleCntByGroup.set(r.groupId, (ruleCntByGroup.get(r.groupId) ?? 0) + 1);
    }

    const perHouse = scoped.map((g) => ({
      id: g.id,
      name: g.name,
      device: deviceCntByGroup.get(g.id) ?? 0,
      rule: ruleCntByGroup.get(g.id) ?? 0,
      gateway: gwCntByGroup.get(g.id) ?? 0,
    }));
    const totals = perHouse.reduce(
      (acc, x) => ({
        device: acc.device + x.device,
        rule: acc.rule + x.rule,
        gateway: acc.gateway + x.gateway,
      }),
      { device: 0, rule: 0, gateway: 0 },
    );
    return { totals, perHouse };
  }

  async createHouse(userId: string, data: { name: string; location?: string; description?: string; area?: number; groupId?: string }) {
    const house = this.housesRepo.create({ userId, ...data });
    return this.housesRepo.save(house);
  }

  async updateGroup(id: string, userId: string, data: { name?: string; description?: string; manager?: string; enableGroupControl?: boolean; enableAutomation?: boolean }, role?: string) {
    const isAdmin = role === 'admin';
    const group = await this.groupsRepo.findOne({ where: isAdmin ? { id } : { id, userId } });
    if (!group) throw new NotFoundException();

    if (data.name !== undefined) group.name = data.name;
    if (data.description !== undefined) group.description = data.description;
    if (data.manager !== undefined) group.manager = data.manager;
    if (data.enableGroupControl !== undefined) group.enableGroupControl = data.enableGroupControl;
    if (data.enableAutomation !== undefined) group.enableAutomation = data.enableAutomation;

    await this.groupsRepo.save(group);
    return this.groupsRepo.findOne({ where: { id }, relations: ['houses'] });
  }

  async getDependencies(id: string, userId: string, role?: string) {
    const isAdmin = role === 'admin';
    const group = await this.groupsRepo.findOne({ where: isAdmin ? { id } : { id, userId } });
    if (!group) throw new NotFoundException();

    const automationRules = await this.rulesRepo.find({
      where: isAdmin ? { groupId: id } : { groupId: id, userId },
      select: ['id', 'name', 'enabled'],
    });

    return {
      canDelete: automationRules.length === 0,
      automationRules: automationRules.map(r => ({ id: r.id, name: r.name, enabled: r.enabled })),
    };
  }

  async removeGroup(id: string, userId: string, role?: string) {
    const isAdmin = role === 'admin';
    const group = await this.groupsRepo.findOne({ where: isAdmin ? { id } : { id, userId } });
    if (!group) throw new NotFoundException();

    // 자동화 의존성 체크
    const rules = await this.rulesRepo.find({
      where: isAdmin ? { groupId: id } : { groupId: id, userId },
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

    try {
      // TypeORM @ManyToOne이 houses.group_id에 NO ACTION FK를 생성하므로,
      // group 삭제 전에 먼저 houses.group_id를 null로 해제해야 함
      await this.housesRepo.update({ groupId: id }, { groupId: null as any });
      await this.groupsRepo.delete({ id });
    } catch (err: any) {
      this.logger.error(`구역 삭제 실패 (id=${id}): ${err.message}`, err.stack);
      throw new InternalServerErrorException(`구역 삭제 중 오류가 발생했습니다: ${err.message}`);
    }
    return { message: '삭제되었습니다.' };
  }

  async updateHouse(id: string, userId: string, data: { name?: string; location?: string; description?: string; area?: number; groupId?: string }, role?: string) {
    const isAdmin = role === 'admin';
    const house = await this.housesRepo.findOne({ where: isAdmin ? { id } : { id, userId } });
    if (!house) throw new NotFoundException();

    if (data.name !== undefined) house.name = data.name;
    if (data.location !== undefined) house.location = data.location;
    if (data.description !== undefined) house.description = data.description;
    if (data.area !== undefined) house.area = data.area;
    if (data.groupId !== undefined) house.groupId = data.groupId;

    return this.housesRepo.save(house);
  }

  async removeHouse(id: string, userId: string, role?: string) {
    const isAdmin = role === 'admin';
    const house = await this.housesRepo.findOne({ where: isAdmin ? { id } : { id, userId } });
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
        // 개별 장치 제어와 같은 경로 — 개폐기 인터록(반대편 OFF→1초→ON)·상태 기록·비상 정지 차단 적용
        // (이전: MQTT 직접 발행이라 그룹에 개폐기가 있으면 열림·닫힘이 동시에 ON 될 수 있었음)
        await this.devicesService.controlDevice(device.id, userId, commands, undefined);
        results.push({ deviceId: device.id, name: device.name, success: true });
      } catch (err: any) {
        results.push({ deviceId: device.id, name: device.name, success: false, error: err.message });
      }
    }

    return { groupId, controlled: results.length, results };
  }

  // ── 방재 모드 (하우스 밀폐 타이머) ──────────────────────────
  // 선택 하우스의 개폐기 닫기 + 유동팬 정지를 N분 타이머로 적용. 타이머는 overrideReason='protection'
  // 으로 태깅돼 자동화룰이 해당 장치를 건드리지 못하고(기존 타이머 override 메커니즘 재사용),
  // 만료 시 자동 복귀. 즉시 정지/연장은 이 태그로 그룹 범위를 식별한다.

  private async loadGroupActuators(groupId: string, userId: string, role?: string) {
    // 그룹-장치 연결은 group_devices(M2M) + gateway→house→group 체인 두 경로 (findAllGroups 와 동일).
    const isAdmin = role === 'admin';
    const where: any = isAdmin ? { id: groupId } : { id: groupId, userId };
    const group = await this.groupsRepo.findOne({ where, relations: ['houses', 'devices'] });
    if (!group) throw new NotFoundException('그룹을 찾을 수 없습니다.');
    const devices: Device[] = [...(group.devices || [])];
    {
      const gateways = await this.gatewayRepo.find({ where: { groupId: group.id } });
      const gwIds = gateways.map((g) => g.id);
      if (gwIds.length > 0) {
        const gwDevices = await this.devicesRepo.find({
          where: isAdmin ? { gatewayId: In(gwIds) } : { gatewayId: In(gwIds), userId },
        });
        const existing = new Set(devices.map((d) => d.id));
        for (const d of gwDevices) if (!existing.has(d.id)) devices.push(d);
      }
    }
    const acts = devices.filter((d) => d.deviceType === 'actuator');
    return {
      openers: acts.filter((d) => d.equipmentType === 'opener_open' || d.equipmentType === 'opener_close'),
      fans: acts.filter((d) => d.equipmentType === 'fan'),
    };
  }

  private isProtectionActive(d: Device, now: number): boolean {
    const s: any = d.deviceSettings || {};
    return s.overrideReason === 'protection' && !!s.overrideUntil && new Date(s.overrideUntil).getTime() > now;
  }

  async startProtection(
    groupId: string,
    userId: string,
    dto: { durationMinutes: number; closeOpeners?: boolean; stopFans?: boolean },
    role?: string,
  ) {
    const minutes = Math.round(Number(dto.durationMinutes));
    if (!minutes || minutes < 1 || minutes > 720) throw new BadRequestException('방재 시간은 1~720분이어야 합니다.');
    const closeOpeners = dto.closeOpeners !== false;
    const stopFans = dto.stopFans !== false;
    if (!closeOpeners && !stopFans) throw new BadRequestException('개폐기 닫기 또는 유동팬 정지 중 하나는 선택해야 합니다.');

    const { openers, fans } = await this.loadGroupActuators(groupId, userId, role);
    let appliedOpeners = 0;
    let appliedFans = 0;

    if (closeOpeners) {
      const seen = new Set<string>();
      for (const o of openers) {
        if (seen.has(o.id)) continue;
        seen.add(o.id);
        if (o.pairedDeviceId) seen.add(o.pairedDeviceId);
        try {
          await this.devicesService.setDeviceTimer(o.id, userId, { direction: 'close', durationMinutes: minutes }, role, 'protection');
          appliedOpeners++;
        } catch (e: any) { this.logger.warn(`[protection] 개폐기 타이머 실패 ${o.name}: ${e.message}`); }
      }
    }
    if (stopFans) {
      for (const f of fans) {
        try {
          await this.devicesService.setDeviceTimer(f.id, userId, { value: false, durationMinutes: minutes }, role, 'protection');
          appliedFans++;
        } catch (e: any) { this.logger.warn(`[protection] 팬 타이머 실패 ${f.name}: ${e.message}`); }
      }
    }
    const until = new Date(Date.now() + minutes * 60000).toISOString();
    this.logger.log(`[protection] group=${groupId} 방재 시작 ${minutes}분 — 개폐기 ${appliedOpeners} / 팬 ${appliedFans}`);
    await this.publishProtectionToPi(groupId, userId, role, until);
    return { ok: true, until, applied: { openers: appliedOpeners, fans: appliedFans } };
  }

  async getProtection(groupId: string, userId: string, role?: string) {
    const { openers, fans } = await this.loadGroupActuators(groupId, userId, role);
    const now = Date.now();
    const prot = [...openers, ...fans].filter((d) => this.isProtectionActive(d, now));
    if (!prot.length) return { active: false };
    const untilMs = Math.max(...prot.map((d) => new Date((d.deviceSettings as any).overrideUntil).getTime()));
    return {
      active: true,
      until: new Date(untilMs).toISOString(),
      remainingMinutes: Math.max(0, Math.ceil((untilMs - now) / 60000)),
      openers: openers.filter((d) => this.isProtectionActive(d, now)).length,
      fans: fans.filter((d) => this.isProtectionActive(d, now)).length,
    };
  }

  async extendProtection(groupId: string, userId: string, dto: { addMinutes?: number }, role?: string) {
    const add = Math.round(Number(dto.addMinutes)) || 30;
    if (add < 1 || add > 720) throw new BadRequestException('연장 시간이 올바르지 않습니다.');
    const { openers, fans } = await this.loadGroupActuators(groupId, userId, role);
    const now = Date.now();
    const MAX = now + 720 * 60000; // 현재 기준 최대 12시간
    let extended = 0;
    let newUntil = 0;
    for (const d of [...openers, ...fans]) {
      if (!this.isProtectionActive(d, now)) continue;
      const s: any = d.deviceSettings || {};
      const next = Math.min(new Date(s.overrideUntil).getTime() + add * 60000, MAX);
      s.overrideUntil = new Date(next).toISOString();
      d.deviceSettings = s;
      await this.devicesRepo.save(d);
      newUntil = Math.max(newUntil, next);
      extended++;
    }
    if (!extended) throw new BadRequestException('진행 중인 방재가 없습니다.');
    this.logger.log(`[protection] group=${groupId} 방재 ${add}분 연장 — ${extended}개 장치`);
    await this.publishProtectionToPi(groupId, userId, role, new Date(newUntil).toISOString());
    return { ok: true, until: new Date(newUntil).toISOString(), extended };
  }

  async cancelProtection(groupId: string, userId: string, role?: string) {
    const { openers, fans } = await this.loadGroupActuators(groupId, userId, role);
    const prot = [...openers, ...fans].filter((d) => (d.deviceSettings as any)?.overrideReason === 'protection');
    let cancelled = 0;
    const seen = new Set<string>();
    for (const d of prot) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      if (d.pairedDeviceId) seen.add(d.pairedDeviceId);
      try {
        await this.devicesService.cancelDeviceTimer(d.id, userId, {}, role);
        cancelled++;
      } catch (e: any) { this.logger.warn(`[protection] 정지 실패 ${d.name}: ${e.message}`); }
    }
    this.logger.log(`[protection] group=${groupId} 방재 정지 — ${cancelled}개 해제`);
    await this.publishProtectionToPi(groupId, userId, role, null);
    return { ok: true, cancelled };
  }

  /**
   * 방재 종료 시각을 이 구역 장비가 붙은 게이트웨이(Pi)에 retained 로 알린다.
   * 서버가 끊겨 Pi 가 폴백으로 동작할 때 방재 중이면 환기팬·개폐기를 움직이지 않게 하기 위함.
   * (만료는 Pi 가 시각으로 판단 — 별도 해제 발행 불필요)
   */
  private async publishProtectionToPi(groupId: string, userId: string, role: string | undefined, untilIso: string | null) {
    try {
      const { openers, fans } = await this.loadGroupActuators(groupId, userId, role);
      const gwPks = [...new Set([...openers, ...fans].map((d) => d.gatewayId).filter(Boolean))] as string[];
      if (!gwPks.length || !this.mqttService) return;
      const gws = await this.gatewayRepo.find({ where: { id: In(gwPks) } });
      for (const gw of gws) this.mqttService.publishProtection(gw.gatewayId, untilIso);
    } catch (e: any) {
      this.logger.warn(`[protection] Pi 방재 상태 발행 실패: ${e.message}`);
    }
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
