import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Device } from './entities/device.entity';
import { TuyaProject } from '../users/entities/tuya-project.entity';
import { AutomationRule } from '../automation/entities/automation-rule.entity';
import { TuyaService } from '../integrations/tuya/tuya.service';
import { EventsGateway } from '../gateway/events.gateway';

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
    @InjectRepository(TuyaProject) private tuyaProjectRepo: Repository<TuyaProject>,
    @InjectRepository(AutomationRule) private rulesRepo: Repository<AutomationRule>,
    private tuyaService: TuyaService,
    private eventsGateway: EventsGateway,
  ) {}

  async findAllByUser(userId: string) {
    return this.devicesRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  async registerBatch(userId: string, devices: { tuyaDeviceId: string; name: string; category: string; deviceType: string; equipmentType?: string; icon?: string; online?: boolean }[], houseId?: string) {
    const results: Device[] = [];

    for (const d of devices) {
      // 이미 등록된 장비인지 확인 (같은 유저 + 같은 Tuya ID)
      const existing = await this.devicesRepo.findOne({
        where: { userId, tuyaDeviceId: d.tuyaDeviceId },
      });

      if (existing) {
        // 기존 장비 업데이트
        existing.name = d.name;
        existing.category = d.category;
        existing.deviceType = d.deviceType as 'sensor' | 'actuator';
        if (d.equipmentType) existing.equipmentType = d.equipmentType as any;
        if (d.icon) existing.icon = d.icon;
        existing.online = d.online ?? existing.online;
        if (d.online) existing.lastSeen = new Date();
        if (houseId) existing.houseId = houseId;
        results.push(await this.devicesRepo.save(existing));
      } else {
        // 새 장비 등록
        const entity = this.devicesRepo.create({
          userId,
          ...(houseId && { houseId }),
          tuyaDeviceId: d.tuyaDeviceId,
          name: d.name,
          category: d.category,
          deviceType: d.deviceType as 'sensor' | 'actuator',
          ...(d.equipmentType && { equipmentType: d.equipmentType as any }),
          icon: d.icon,
          online: d.online ?? false,
          ...(d.online && { lastSeen: new Date() }),
        });
        results.push(await this.devicesRepo.save(entity));
      }
    }

    // 개폐기 페어링: opener_open + opener_close 쌍이 있으면 상호 pairedDeviceId 설정
    const openerOpen = results.find(d => d.equipmentType === 'opener_open');
    const openerClose = results.find(d => d.equipmentType === 'opener_close');
    if (openerOpen && openerClose) {
      openerOpen.pairedDeviceId = openerClose.id;
      openerClose.pairedDeviceId = openerOpen.id;
      // openerGroupName 설정 (프론트에서 전달)
      const groupName = devices.find(d => (d as any).openerGroupName)?.['openerGroupName'];
      if (groupName) {
        openerOpen.openerGroupName = groupName;
        openerClose.openerGroupName = groupName;
      }
      await this.devicesRepo.save([openerOpen, openerClose]);
    }

    return results;
  }

  async updateOnlineStatus(tuyaDeviceId: string, online: boolean) {
    await this.devicesRepo.update(
      { tuyaDeviceId },
      { online, lastSeen: new Date() },
    );
  }

  async controlDevice(id: string, userId: string, commands: { code: string; value: any }[]) {
    const device = await this.devicesRepo.findOne({ where: { id, userId } });
    if (!device) throw new NotFoundException('장비를 찾을 수 없습니다.');

    const tuyaProject = await this.tuyaProjectRepo.findOne({ where: { userId } });
    if (!tuyaProject) throw new NotFoundException('Tuya 프로젝트 설정이 없습니다.');

    const credentials = {
      accessId: tuyaProject.accessId,
      accessSecret: tuyaProject.accessSecretEncrypted,
      endpoint: tuyaProject.endpoint,
    };

    const result = await this.tuyaService.sendDeviceCommand(credentials, device.tuyaDeviceId, commands);
    this.logger.log(`장비 제어: ${device.name} → ${JSON.stringify(commands)}`);
    return result;
  }

  async getDeviceStatus(id: string, userId: string) {
    const device = await this.devicesRepo.findOne({ where: { id, userId } });
    if (!device) throw new NotFoundException('장비를 찾을 수 없습니다.');

    const tuyaProject = await this.tuyaProjectRepo.findOne({ where: { userId } });
    if (!tuyaProject) throw new NotFoundException('Tuya 프로젝트 설정이 없습니다.');

    const credentials = {
      accessId: tuyaProject.accessId,
      accessSecret: tuyaProject.accessSecretEncrypted,
      endpoint: tuyaProject.endpoint,
    };

    try {
      const result = await this.tuyaService.getDeviceStatus(credentials, device.tuyaDeviceId);
      return {
        success: true,
        deviceId: device.id,
        tuyaDeviceId: device.tuyaDeviceId,
        online: device.online,
        status: result.result || [],
      };
    } catch (err: any) {
      return {
        success: false,
        deviceId: device.id,
        online: device.online,
        status: [],
        message: err.message,
      };
    }
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

    // 장비가 속한 그룹 목록 조회
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

    // 두 장비 모두 의존성 검사
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

    // 원자적 삭제
    await this.devicesRepo.query(
      'DELETE FROM group_devices WHERE device_id = ANY($1)',
      [ids],
    );
    await this.devicesRepo.delete({ id: In(ids) });

    return { message: '개폐기 페어가 삭제되었습니다.', deletedIds: ids };
  }

  async remove(id: string, userId: string) {
    const device = await this.devicesRepo.findOne({ where: { id, userId } });
    if (!device) throw new NotFoundException();

    // 개폐기는 개별 삭제 불가 — opener-pair 엔드포인트 사용
    if (device.equipmentType === 'opener_open' || device.equipmentType === 'opener_close') {
      throw new BadRequestException('개폐기 장비는 /devices/:id/opener-pair 를 통해 쌍으로 삭제해야 합니다.');
    }

    // 자동화 의존성 체크
    const rules: { id: string; name: string; enabled: boolean }[] =
      await this.devicesRepo.query(DEVICE_DEPENDENCY_SQL, [userId, id]);

    if (rules.length > 0) {
      throw new ConflictException({
        message: '자동화 룰에서 사용 중인 장비는 삭제할 수 없습니다.',
        dependencies: { automationRules: rules },
      });
    }

    // group_devices 조인 테이블에서 먼저 제거 (외래키 제약 방지)
    await this.devicesRepo.query('DELETE FROM group_devices WHERE device_id = $1', [id]);
    await this.devicesRepo.remove(device);
    return { message: '삭제되었습니다.' };
  }

  /**
   * 5분마다 Tuya Cloud에서 장비 온라인 상태를 동기화
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async syncDeviceOnlineStatus() {
    const tuyaProjects = await this.tuyaProjectRepo.find({ where: { enabled: true } });

    for (const project of tuyaProjects) {
      try {
        const credentials = {
          accessId: project.accessId,
          accessSecret: project.accessSecretEncrypted,
          endpoint: project.endpoint,
        };

        const result = await this.tuyaService.apiGet(
          credentials,
          '/v1.0/iot-01/associated-users/devices?last_row_key=&size=100',
        );

        if (!result.success || !result.result?.devices) continue;

        const tuyaDevices: { id: string; online: boolean }[] = result.result.devices;

        // DB에 등록된 이 사용자의 장비 조회
        const dbDevices = await this.devicesRepo.find({ where: { userId: project.userId } });

        for (const dbDevice of dbDevices) {
          const tuyaDevice = tuyaDevices.find(td => td.id === dbDevice.tuyaDeviceId);
          if (!tuyaDevice) continue;

          // 상태가 변경된 경우에만 업데이트
          if (dbDevice.online !== tuyaDevice.online) {
            await this.devicesRepo.update(
              { id: dbDevice.id },
              { online: tuyaDevice.online, lastSeen: new Date() },
            );
            this.eventsGateway.broadcastDeviceStatus(dbDevice.id, tuyaDevice.online);
            this.logger.log(`장비 상태 변경: ${dbDevice.name} → ${tuyaDevice.online ? '온라인' : '오프라인'}`);
          }
        }
      } catch (err) {
        this.logger.error(`장비 상태 동기화 실패 (userId: ${project.userId}):`, err.message);
      }
    }
  }
}
