import {
  ConflictException, ForbiddenException, Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { DEFAULT_CHANNEL_MAPPING_8CH_ZIGBEE, DEFAULT_CHANNEL_MAPPING_12CH } from '../devices/channel-mapping.constants';
import { GatewayOnboardDevice, SlotType } from './entities/gateway-onboard-device.entity';
import { Gateway } from '../gateway-manager/entities/gateway.entity';
import { Device } from '../devices/entities/device.entity';
import { UpdateOnboardDeviceDto } from './dto/update-onboard-device.dto';
import { CreateOnboardDeviceDto } from './dto/create-onboard-device.dto';
import { AddZigbeeDeviceDto, UpdateZigbeeDeviceDto } from './dto/add-zigbee-device.dto';
import { MqttService } from '../mqtt/mqtt.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  AVAILABLE_SWITCH_CODES_8CH,
  AVAILABLE_SWITCH_CODES_12CH,
  detectChannelCount,
} from '../devices/channel-mapping.constants';

/**
 * 기본 슬롯 12개: 팬4 + 관주 8채널(원격제어·B접점·구역4·교반기·액비)
 * 8채널 = 원격제어 + B접점 + 구역 4개 + 교반기 + 액비
 * 12채널은 장치 추가 시 buildIrrigationSlots(channels=12)로 동적 생성
 */
const DEFAULT_SLOTS: Omit<GatewayOnboardDevice, 'id' | 'gatewayId' | 'createdAt' | 'updatedAt' | 'operationTime' | 'standbyTime'>[] = [
  { slotKey: 'fan_1',              slotType: 'fan',                pairKey: null, name: '유동팬 1번',       enabled: true, sortOrder: 1,  gpioPin: null },
  { slotKey: 'fan_2',              slotType: 'fan',                pairKey: null, name: '유동팬 2번',       enabled: true, sortOrder: 2,  gpioPin: null },
  { slotKey: 'fan_3',              slotType: 'fan',                pairKey: null, name: '유동팬 3번',       enabled: true, sortOrder: 3,  gpioPin: null },
  { slotKey: 'fan_4',              slotType: 'fan',                pairKey: null, name: '유동팬 4번',       enabled: true, sortOrder: 4,  gpioPin: null },
  { slotKey: 'remote_control',     slotType: 'remote_control',     pairKey: null, name: '원격제어 ON/OFF',  enabled: true, sortOrder: 5,  gpioPin: null },
  { slotKey: 'fertilizer_contact', slotType: 'fertilizer_contact', pairKey: null, name: '액비/교반기 B접점', enabled: true, sortOrder: 6,  gpioPin: null },
  { slotKey: 'zone_1',             slotType: 'irrigation_zone',    pairKey: null, name: '1구역 관주',       enabled: true, sortOrder: 7,  gpioPin: null },
  { slotKey: 'zone_2',             slotType: 'irrigation_zone',    pairKey: null, name: '2구역 관주',       enabled: true, sortOrder: 8,  gpioPin: null },
  { slotKey: 'zone_3',             slotType: 'irrigation_zone',    pairKey: null, name: '3구역 관주',       enabled: true, sortOrder: 9,  gpioPin: null },
  { slotKey: 'zone_4',             slotType: 'irrigation_zone',    pairKey: null, name: '4구역 관주',       enabled: true, sortOrder: 10, gpioPin: null },
  { slotKey: 'mixer',              slotType: 'mixer',              pairKey: null, name: '교반기',           enabled: true, sortOrder: 11, gpioPin: null },
  { slotKey: 'fertilizer_motor',   slotType: 'fertilizer_motor',   pairKey: null, name: '액비',             enabled: true, sortOrder: 12, gpioPin: null },
];

/** 구버전에서 제거된 슬롯 키 (opener_* 는 지그비로만 추가) */
const LEGACY_SLOT_KEYS = ['opener_1_open','opener_1_close','opener_2_open','opener_2_close','opener_3_open','opener_3_close'];

type SlotDef = Omit<GatewayOnboardDevice, 'id' | 'gatewayId' | 'createdAt' | 'updatedAt' | 'operationTime' | 'standbyTime'>;

function buildVentSlots(uuid: string, short: string, groupName: string, baseSort: number): SlotDef[] {
  let sort = baseSort;
  const s = (slotKey: string, slotType: SlotType, name: string): SlotDef => ({
    slotKey, slotType, pairKey: uuid, name, enabled: true, sortOrder: ++sort, gpioPin: null,
  });
  return [
    s(`vent_hdr_${short}`, 'vent_group', groupName),
    s(`vent_open_${short}`, 'opener_open', '열기'),
    s(`vent_close_${short}`, 'opener_close', '닫기'),
  ];
}

function buildIrrigationSlots(uuid: string, short: string, groupName: string, channels: 8 | 12, baseSort: number): SlotDef[] {
  let sort = baseSort;
  const s = (slotKey: string, slotType: SlotType, name: string): SlotDef => ({
    slotKey, slotType, pairKey: uuid, name, enabled: true, sortOrder: ++sort, gpioPin: null,
  });
  const zones = channels === 12
    ? [1,2,3,4,5,6,7,8].map(n => s(`irrig_z${n}_${short}`, 'irrigation_zone', `${n}구역 관주`))
    : [1,2,3,4].map(n => s(`irrig_z${n}_${short}`, 'irrigation_zone', `${n}구역 관주`));
  return [
    s(`irrig_hdr_${short}`, 'irrigation_group', groupName),
    s(`irrig_rc_${short}`, 'remote_control', '원격제어 ON/OFF'),
    s(`irrig_fc_${short}`, 'fertilizer_contact', '액비/교반기 B접점'),
    ...zones,
    s(`irrig_mx_${short}`, 'mixer', '교반기'),
    s(`irrig_fm_${short}`, 'fertilizer_motor', '액비'),
  ];
}

// 삭제 대상 device id 목록($2 = text[]) 중 하나라도 자동화 룰 action 에서 쓰이면 그 룰들을 반환.
// (devices.service 의 단일-id DEVICE_DEPENDENCY_SQL 를 다중-id 로 확장 — controller/child cascade 포함)
const GATEWAY_ENV_DEVICE_DEP_SQL = `
  SELECT DISTINCT id, name, enabled FROM automation_rules
  WHERE user_id = $1
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(actions) = 'array'
           THEN actions
           ELSE jsonb_build_array(actions)
      END
    ) AS action
    WHERE action->>'targetDeviceId' = ANY($2::text[])
       OR action->'targetDeviceIds' ?| $2::text[]
  )
`;

@Injectable()
export class GatewayEnvService {
  private readonly logger = new Logger(GatewayEnvService.name);

  constructor(
    @InjectRepository(GatewayOnboardDevice)
    private readonly onboardRepo: Repository<GatewayOnboardDevice>,
    @InjectRepository(Gateway)
    private readonly gatewayRepo: Repository<Gateway>,
    @InjectRepository(Device)
    private readonly deviceRepo: Repository<Device>,
    private readonly mqttService: MqttService,
    private readonly eventEmitter: EventEmitter2,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Zigbee 8/12채널 컨트롤러 등록 — parent + N children 일괄 생성 (트랜잭션).
   * mode='irrigation': 단일 zigbee 관수 device (기존 흐름)
   * mode='fan':        N개 유동팬 child (각 channel = 1 fan)
   * mode='opener':     N/2 페어 개폐기 child (인접 채널 1+2, 3+4, ...)
   */
  async createZigbeeController(
    gatewayId: string,
    dto: {
      ieee: string;
      friendlyName: string;
      zigbeeModel: string;
      channelCount: 8 | 12;
      mode: 'irrigation' | 'fan' | 'opener';
    },
    userId: string,
    role: string,
  ): Promise<{ controller: Device; children: Device[] }> {
    const gw = await this.assertGatewayOwner(gatewayId, userId, role);

    // 중복 IEEE 검사 (root에서만, 같은 게이트웨이 내)
    const dup = await this.deviceRepo.findOne({
      where: { gatewayId, zigbeeIeee: dto.ieee, parentDeviceId: IsNull() } as any,
    });
    if (dup) throw new ConflictException(`이미 등록된 컨트롤러: ${dto.ieee}`);

    const gwName = (gw.name && gw.name.trim()) || gw.gatewayId;

    return this.dataSource.transaction(async (mgr) => {
      // irrigation 모드 — 기존 단일 zigbee 관수 device
      if (dto.mode === 'irrigation') {
        const defaultMapping = dto.channelCount === 12
          ? DEFAULT_CHANNEL_MAPPING_12CH
          : DEFAULT_CHANNEL_MAPPING_8CH_ZIGBEE;
        const dev = await mgr.save(mgr.create(Device, {
          userId: gw.userId, gatewayId, houseId: gw.houseId ?? undefined,
          name: `${gwName}_관수`,
          category: 'irrigation', deviceType: 'actuator',
          equipmentType: 'irrigation', source: 'zigbee',
          zigbeeIeee: dto.ieee, friendlyName: dto.friendlyName,
          zigbeeModel: dto.zigbeeModel,
          channelMapping: { ...defaultMapping },
        } as Partial<Device>));
        return { controller: dev, children: [] };
      }

      // parent (controller) — 자동제어 타겟 아님
      const parent = await mgr.save(mgr.create(Device, {
        userId: gw.userId, gatewayId, houseId: gw.houseId ?? undefined,
        name: dto.mode === 'fan' ? `${gwName}_유동팬컨트롤러` : `${gwName}_개폐기컨트롤러`,
        category: dto.mode === 'fan' ? 'fan' : 'opener',
        deviceType: 'actuator',
        equipmentType: 'controller',
        source: 'zigbee',
        zigbeeIeee: dto.ieee,
        friendlyName: dto.friendlyName,
        zigbeeModel: dto.zigbeeModel,
      } as Partial<Device>));

      const children: Device[] = [];

      if (dto.mode === 'fan') {
        // N개 유동팬 child — 각 채널 = 1 fan
        for (let i = 1; i <= dto.channelCount; i++) {
          const child = await mgr.save(mgr.create(Device, {
            userId: gw.userId, gatewayId, houseId: gw.houseId ?? undefined,
            parentDeviceId: parent.id,
            name: `${gwName}_유동팬${i}`,
            category: 'fan', deviceType: 'actuator',
            equipmentType: 'fan', source: 'zigbee',
            zigbeeIeee: dto.ieee,         // parent와 동일 IEEE (인덱스는 root에만 unique)
            friendlyName: dto.friendlyName,
            zigbeeModel: dto.zigbeeModel,
            channelCode: `switch_${i}`,
          } as Partial<Device>));
          children.push(child);
        }
      } else {
        // 개폐기 페어 — 인접 채널 (1+2, 3+4, ...)
        const pairCount = dto.channelCount / 2;
        for (let p = 1; p <= pairCount; p++) {
          const openCh = p * 2 - 1;
          const closeCh = p * 2;
          const groupName = `${gwName}_개폐기${p}`;
          const openDev = await mgr.save(mgr.create(Device, {
            userId: gw.userId, gatewayId, houseId: gw.houseId ?? undefined,
            parentDeviceId: parent.id,
            name: `${groupName} 열림`,
            openerGroupName: groupName,
            category: 'opener', deviceType: 'actuator',
            equipmentType: 'opener_open', source: 'zigbee',
            zigbeeIeee: dto.ieee, friendlyName: dto.friendlyName,
            zigbeeModel: dto.zigbeeModel,
            channelCode: `switch_${openCh}`,
          } as Partial<Device>));
          const closeDev = await mgr.save(mgr.create(Device, {
            userId: gw.userId, gatewayId, houseId: gw.houseId ?? undefined,
            parentDeviceId: parent.id,
            name: `${groupName} 닫힘`,
            openerGroupName: groupName,
            category: 'opener', deviceType: 'actuator',
            equipmentType: 'opener_close', source: 'zigbee',
            zigbeeIeee: dto.ieee, friendlyName: dto.friendlyName,
            zigbeeModel: dto.zigbeeModel,
            channelCode: `switch_${closeCh}`,
          } as Partial<Device>));
          // 페어 양방향
          openDev.pairedDeviceId = closeDev.id;
          closeDev.pairedDeviceId = openDev.id;
          await mgr.save([openDev, closeDev]);
          children.push(openDev, closeDev);
        }
      }

      this.logger.log(`Zigbee 컨트롤러 등록: ${parent.name} (mode=${dto.mode}, ${children.length} children)`);
      return { controller: parent, children };
    });
  }

  /**
   * rpi-fallback-channel-sync: onboard device 변경 시 fallback-config가 자동 sync 하도록 emit.
   * UUID(gateways.id) → VARCHAR(gateways.gateway_id) 변환 후 emit.
   * 실패해도 본 흐름은 영향받지 않음 (silent fail).
   */
  private async emitDeviceChanged(gatewayUuid: string): Promise<void> {
    try {
      const gw = await this.gatewayRepo.findOne({
        where: { id: gatewayUuid },
        select: ['gatewayId'],
      });
      if (gw?.gatewayId) {
        this.eventEmitter.emit('device.changed', { gatewayId: gw.gatewayId });
      }
    } catch (err: any) {
      this.logger.warn(`device.changed emit 실패: ${err?.message ?? err}`);
    }
  }

  // ── 게이트웨이 권한 확인 ──────────────────────────────────────
  private async assertGatewayOwner(gatewayId: string, userId: string, role: string): Promise<Gateway> {
    const gw = await this.gatewayRepo.findOne({ where: { id: gatewayId } });
    if (!gw) throw new NotFoundException('게이트웨이를 찾을 수 없습니다.');
    if (role !== 'admin' && gw.userId !== userId) throw new ForbiddenException('권한이 없습니다.');
    return gw;
  }

  // ── Onboard: 초기화 (첫 호출만 DEFAULT_SLOTS 생성, 이후엔 자동 복구 안 함) ────────
  // 이전 동작: 매번 누락된 DEFAULT_SLOTS를 자동 복구 → 사용자가 삭제해도 다시 생성되는 버그
  // 새 동작: 게이트웨이의 모든 onboard 슬롯이 비어있을 때만 DEFAULT_SLOTS 생성
  async ensureOnboardDevices(gatewayId: string): Promise<GatewayOnboardDevice[]> {
    const all = await this.onboardRepo.find({ where: { gatewayId }, order: { sortOrder: 'ASC' } });

    // 구버전 opener 슬롯은 항상 제거 (마이그레이션)
    const legacy = all.filter(e => LEGACY_SLOT_KEYS.includes(e.slotKey));
    if (legacy.length > 0) {
      await this.onboardRepo.remove(legacy);
      this.logger.log(`게이트웨이 ${gatewayId}: 구버전 opener 슬롯 ${legacy.length}개 제거`);
    }

    const afterLegacy = all.filter(e => !LEGACY_SLOT_KEYS.includes(e.slotKey));

    // 슬롯이 하나도 없을 때만 DEFAULT_SLOTS 생성 (새 게이트웨이 초기 세팅)
    // 슬롯이 1개라도 있으면 사용자가 명시적으로 삭제한 것이므로 자동 복구 금지
    if (afterLegacy.length === 0) {
      const toInsert = DEFAULT_SLOTS.map(s => this.onboardRepo.create({ ...s, gatewayId }));
      await this.onboardRepo.save(toInsert);
      this.logger.log(`게이트웨이 ${gatewayId}: 초기 onboard ${toInsert.length}개 생성`);
    }
    const result = await this.onboardRepo.find({ where: { gatewayId }, order: { sortOrder: 'ASC' } });

    // devices 테이블에 온보드 장치 동기화
    const gw = await this.gatewayRepo.findOne({ where: { id: gatewayId } });
    if (gw) await this.syncOnboardToDevices(gw, result).catch(e =>
      this.logger.warn(`온보드 동기화 실패: ${e.message}`)
    );

    return result;
  }

  // ── Onboard: 목록 조회 ────────────────────────────────────────
  async getOnboardDevices(gatewayId: string, userId: string, role: string): Promise<GatewayOnboardDevice[]> {
    await this.assertGatewayOwner(gatewayId, userId, role);
    return this.ensureOnboardDevices(gatewayId);
  }

  /**
   * rpi-auto-device-provision
   * onboard slots → devices 강제 재동기화. ensureOnboardDevices는 onboard slot 1개라도
   * 있으면 자동 복구 안 함 → 운영자가 명시적으로 재동기화하고 싶을 때 사용.
   *
   * 양산 검증 단계 G에서 발견된 BUG-06 (신규 게이트웨이 devices 0건) 재분석 결과,
   * syncOnboardToDevices는 정상 작동하나 timing/race condition으로 누락된 경우 대비.
   * 결과 device 개수 + skipped 통계 반환.
   */
  async resyncOnboardDevices(
    gatewayId: string, userId: string, role: string,
  ): Promise<{ onboardSlots: number; devicesAfter: number; provisioned: number }> {
    await this.assertGatewayOwner(gatewayId, userId, role);
    const gw = await this.gatewayRepo.findOne({ where: { id: gatewayId } });
    if (!gw) throw new NotFoundException('게이트웨이를 찾을 수 없습니다.');

    const onboard = await this.onboardRepo.find({ where: { gatewayId }, order: { sortOrder: 'ASC' } });
    const devicesBefore = await this.deviceRepo.count({ where: { gatewayId, source: 'onboard' } as any });
    await this.syncOnboardToDevices(gw, onboard);
    const devicesAfter = await this.deviceRepo.count({ where: { gatewayId, source: 'onboard' } as any });

    this.logger.log(`resyncOnboardDevices [${gw.gatewayId}]: onboard=${onboard.length} devices ${devicesBefore}→${devicesAfter}`);
    return {
      onboardSlots: onboard.length,
      devicesAfter,
      provisioned: Math.max(0, devicesAfter - devicesBefore),
    };
  }

  // ── Onboard: 수정 (이름 / 활성화) ────────────────────────────
  async updateOnboardDevice(
    gatewayId: string,
    id: string,
    dto: UpdateOnboardDeviceDto,
    userId: string,
    role: string,
  ): Promise<GatewayOnboardDevice> {
    await this.assertGatewayOwner(gatewayId, userId, role);
    const device = await this.onboardRepo.findOne({ where: { id, gatewayId } });
    if (!device) throw new NotFoundException('온보드 장치를 찾을 수 없습니다.');

    if (dto.name !== undefined) device.name = dto.name;
    if (dto.operationTime !== undefined) device.operationTime = dto.operationTime;
    if (dto.standbyTime !== undefined) device.standbyTime = dto.standbyTime;
    const pinChanged = 'gpioPin' in dto && device.gpioPin !== (dto.gpioPin ?? null);
    if ('gpioPin' in dto) device.gpioPin = dto.gpioPin ?? null;
    const enabledChanged = dto.enabled !== undefined && device.enabled !== dto.enabled;
    if (dto.enabled !== undefined) {
      device.enabled = dto.enabled;
    }
    const saved = await this.onboardRepo.save(device);

    // rpi-fallback-channel-sync: 폴백 동기화에 영향있는 변경 시에만 emit
    if (pinChanged || enabledChanged) {
      void this.emitDeviceChanged(gatewayId);
    }

    // enabled 또는 name 변경 시 devices 테이블 동기화 (양방향 일관성)
    if (dto.enabled !== undefined || dto.name !== undefined) {
      const gw = await this.gatewayRepo.findOne({ where: { id: gatewayId } });
      if (gw) {
        const allOnboard = await this.onboardRepo.find({ where: { gatewayId }, order: { sortOrder: 'ASC' } });
        await this.syncOnboardToDevices(gw, allOnboard).catch(e =>
          this.logger.warn(`온보드 동기화 실패: ${e.message}`)
        );
      }
    }

    return saved;
  }

  // ── Onboard: 동적 장치 추가 ───────────────────────────────
  async createOnboardDevice(
    gatewayId: string,
    dto: CreateOnboardDeviceDto,
    userId: string,
    role: string,
  ): Promise<GatewayOnboardDevice[]> {
    await this.assertGatewayOwner(gatewayId, userId, role);

    const maxSort = (await this.onboardRepo
      .createQueryBuilder('d')
      .select('MAX(d.sortOrder)', 'max')
      .where('d.gatewayId = :gatewayId', { gatewayId })
      .getRawOne<{ max: number }>())?.max ?? 0;

    const uuid = crypto.randomUUID();
    const short = uuid.replace(/-/g, '').slice(0, 8);
    let slots: Omit<GatewayOnboardDevice, 'id' | 'gatewayId' | 'createdAt' | 'updatedAt' | 'operationTime' | 'standbyTime'>[];

    if (dto.type === 'fan') {
      slots = [{
        slotKey: `fan_dyn_${short}`,
        slotType: 'fan',
        pairKey: uuid,
        name: dto.name,
        enabled: true,
        sortOrder: maxSort + 1,
        gpioPin: null,
      }];
    } else if (dto.type === 'vent') {
      slots = buildVentSlots(uuid, short, dto.name, maxSort);
    } else {
      const channels = dto.channels ?? 8;
      slots = buildIrrigationSlots(uuid, short, dto.name, channels, maxSort);
    }

    const entities = slots.map(s => this.onboardRepo.create({ ...s, gatewayId }));
    const result = await this.onboardRepo.save(entities);
    // rpi-fallback-channel-sync: 신규 슬롯은 gpioPin=null이라 사실상 sync에서 제외되나,
    // RPi가 다음 사용자 핀 설정 직후 채워질 것을 대비해 emit (idempotent).
    void this.emitDeviceChanged(gatewayId);
    return result;
  }

  // ── Onboard: 장치 삭제 (레거시 포함) ─────────────────────
  async deleteOnboardDevice(
    gatewayId: string,
    id: string,
    userId: string,
    role: string,
  ): Promise<void> {
    const gw = await this.assertGatewayOwner(gatewayId, userId, role);
    const device = await this.onboardRepo.findOne({ where: { id, gatewayId } });
    if (!device) throw new NotFoundException('온보드 장치를 찾을 수 없습니다.');

    if (device.pairKey) {
      // 동적 그룹: 같은 pairKey를 가진 모든 슬롯 삭제
      const group = await this.onboardRepo.find({ where: { gatewayId, pairKey: device.pairKey } });
      await this.onboardRepo.remove(group);
    } else if (device.slotType === 'fan') {
      // 레거시 팬: 단일 슬롯만 삭제
      await this.onboardRepo.remove(device);
    } else {
      // 레거시 관수 그룹: pairKey=null인 팬 제외 모든 슬롯 삭제
      const legacyAll = await this.onboardRepo.find({ where: { gatewayId, pairKey: IsNull() } });
      const toDelete = legacyAll.filter(s => s.slotType !== 'fan');
      if (toDelete.length > 0) await this.onboardRepo.remove(toDelete);
    }

    // devices 테이블 동기화: 남은 슬롯 기반으로 actuator 정리
    // (이전에는 syncOnboardToDevices가 호출되지 않아 devices 테이블에 관주/팬 actuator가 남아 그룹 페이지에서 계속 보임)
    const remaining = await this.onboardRepo.find({ where: { gatewayId } });
    await this.syncOnboardToDevices(gw, remaining).catch((e) =>
      this.logger.warn(`syncOnboardToDevices after delete failed for ${gatewayId}: ${e.message}`),
    );

    // rpi-fallback-channel-sync: 삭제 후 폴백 매핑 재동기화
    void this.emitDeviceChanged(gatewayId);
  }

  // ── 온보드 장치 → devices 테이블 동기화 ────────────────────
  private async syncOnboardToDevices(gw: Gateway, onboardDevices: GatewayOnboardDevice[]): Promise<void> {
    // 게이트웨이 online 상태 = 모든 온보드 actuator의 online 상태
    const gwOnline = gw.status === 'online' || gw.agentStatus === 'online';

    // 0. 고아(orphan) device 정리: onboardDeviceId가 가리키는 슬롯이 더 이상 존재하지 않으면 삭제
    //    (슬롯 삭제 후 잔존하던 device를 청소)
    const validSlotIds = new Set(onboardDevices.map(s => s.id));
    const allOnboardDevices = await this.deviceRepo.find({
      where: { gatewayId: gw.id, source: 'onboard' } as any,
    });
    const orphans = allOnboardDevices.filter(d => d.onboardDeviceId && !validSlotIds.has(d.onboardDeviceId));
    if (orphans.length > 0) {
      await this.deviceRepo.remove(orphans);
      this.logger.log(`게이트웨이 ${gw.gatewayId}: 고아 device ${orphans.length}개 정리`);
    }

    // 1. 팬 슬롯: 활성화된 것마다 개별 Device 레코드
    const fanSlots = onboardDevices.filter(s => s.slotType === 'fan');
    for (const slot of fanSlots) {
      const existing = await this.deviceRepo.findOne({ where: { onboardDeviceId: slot.id } });
      if (slot.enabled) {
        if (existing) {
          existing.name = slot.name;
          existing.online = gwOnline;  // 게이트웨이 상태 반영
          // 게이트웨이 house 매핑이 device에 빠져있으면 보정 (위저드 그룹 필터링용)
          if (!existing.houseId && gw.houseId) existing.houseId = gw.houseId;
          // onboard device의 userId는 항상 gateway 소유자와 일치
          if (existing.userId !== gw.userId) existing.userId = gw.userId;
          await this.deviceRepo.save(existing);
        } else {
          await this.deviceRepo.save(this.deviceRepo.create({
            userId: gw.userId,
            gatewayId: gw.id,
            houseId: gw.houseId ?? undefined,
            name: slot.name,
            category: 'fan',
            deviceType: 'actuator',
            equipmentType: 'fan',
            source: 'onboard',
            onboardDeviceId: slot.id,
            friendlyName: slot.slotKey,
            online: gwOnline,
          }));
        }
      } else if (existing) {
        await this.deviceRepo.remove(existing);
      }
    }

    // 1-b. 개폐기(vent_group + opener_open + opener_close): 그룹 단위로 device 등록
    // pairKey 가 같은 vent_group 3개(header, open, close)가 한 페어
    const ventGroupHeaders = onboardDevices.filter(s => s.slotType === 'vent_group' && s.enabled);
    for (const header of ventGroupHeaders) {
      const pairKey = header.pairKey;
      if (!pairKey) continue;
      const openSlot = onboardDevices.find(s => s.slotType === 'opener_open' && s.pairKey === pairKey);
      const closeSlot = onboardDevices.find(s => s.slotType === 'opener_close' && s.pairKey === pairKey);
      if (!openSlot || !closeSlot) continue;

      // [열기] device
      let openDev = await this.deviceRepo.findOne({ where: { onboardDeviceId: openSlot.id } });
      let closeDev = await this.deviceRepo.findOne({ where: { onboardDeviceId: closeSlot.id } });
      if (!openDev) {
        openDev = await this.deviceRepo.save(this.deviceRepo.create({
          userId: gw.userId, gatewayId: gw.id, houseId: gw.houseId ?? undefined,
          name: `${header.name} 열기`, category: 'opener', deviceType: 'actuator',
          equipmentType: 'opener_open', source: 'onboard',
          onboardDeviceId: openSlot.id, friendlyName: openSlot.slotKey,
          openerGroupName: header.name,
          online: gwOnline,
        }));
      } else {
        openDev.name = `${header.name} 열기`;
        openDev.openerGroupName = header.name;
        openDev.online = gwOnline;
        if (!openDev.houseId && gw.houseId) openDev.houseId = gw.houseId;
        // onboard device의 userId는 항상 gateway 소유자와 일치 (위저드/구역관리 필터 정합성)
        if (openDev.userId !== gw.userId) openDev.userId = gw.userId;
        await this.deviceRepo.save(openDev);
      }
      if (!closeDev) {
        closeDev = await this.deviceRepo.save(this.deviceRepo.create({
          userId: gw.userId, gatewayId: gw.id, houseId: gw.houseId ?? undefined,
          name: `${header.name} 닫기`, category: 'opener', deviceType: 'actuator',
          equipmentType: 'opener_close', source: 'onboard',
          onboardDeviceId: closeSlot.id, friendlyName: closeSlot.slotKey,
          openerGroupName: header.name,
          online: gwOnline,
        }));
      } else {
        closeDev.name = `${header.name} 닫기`;
        closeDev.openerGroupName = header.name;
        closeDev.online = gwOnline;
        if (!closeDev.houseId && gw.houseId) closeDev.houseId = gw.houseId;
        if (closeDev.userId !== gw.userId) closeDev.userId = gw.userId;
        await this.deviceRepo.save(closeDev);
      }
      // 페어링 정보 업데이트 (인터록용)
      if (openDev.pairedDeviceId !== closeDev.id || closeDev.pairedDeviceId !== openDev.id) {
        openDev.pairedDeviceId = closeDev.id;
        closeDev.pairedDeviceId = openDev.id;
        await this.deviceRepo.save([openDev, closeDev]);
      }
    }

    // 1-c. 비활성화된 vent_group: 해당 device 삭제
    const inactivePairs = new Set(
      onboardDevices.filter(s => s.slotType === 'vent_group' && !s.enabled && s.pairKey).map(s => s.pairKey)
    );
    for (const pairKey of inactivePairs) {
      const slots = onboardDevices.filter(s => (s.slotType === 'opener_open' || s.slotType === 'opener_close') && s.pairKey === pairKey);
      for (const slot of slots) {
        const dev = await this.deviceRepo.findOne({ where: { onboardDeviceId: slot.id } });
        if (dev) await this.deviceRepo.remove(dev);
      }
    }

    // 2. 관주 슬롯: 활성화된 것들 → 게이트웨이당 관주 Device 1개
    //    vent/opener 슬롯은 관주 장치에 포함하지 않음
    const IRRIGATION_SLOT_TYPES = new Set([
      'remote_control', 'fertilizer_contact', 'irrigation_zone', 'mixer', 'fertilizer_motor',
    ]);
    const irrigSlots = onboardDevices.filter(s => IRRIGATION_SLOT_TYPES.has(s.slotType));
    const enabledIrrig = irrigSlots.filter(s => s.enabled)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    // race condition 방어 — 과거에 중복 INSERT된 device가 있으면 가장 오래된 1개만 keep
    const allIrrig = await this.deviceRepo.find({
      where: { gatewayId: gw.id, source: 'onboard', equipmentType: 'irrigation' },
      order: { createdAt: 'ASC' },
    });
    let existingIrrig: Device | null = null;
    if (allIrrig.length > 0) {
      existingIrrig = allIrrig[0];
      if (allIrrig.length > 1) {
        const dups = allIrrig.slice(1);
        await this.deviceRepo.remove(dups);
        this.logger.warn(`onboard 관수 device 중복 ${dups.length}건 자동 정리 (gateway=${gw.gatewayId}, keep=${existingIrrig.id})`);
      }
    }

    if (enabledIrrig.length > 0) {
      const channelMapping: Record<string, string> = {};
      let dynZoneIdx = 0;
      for (const slot of enabledIrrig) {
        let mapKey: string;
        if (slot.slotType === 'remote_control') mapKey = 'remote_control';
        else if (slot.slotType === 'fertilizer_contact') mapKey = 'fertilizer_b_contact';
        else if (slot.slotType === 'mixer') mapKey = 'mixer';
        else if (slot.slotType === 'fertilizer_motor') mapKey = 'fertilizer_motor';
        else if (slot.slotType === 'irrigation_zone') {
          // 레거시 슬롯: zone_1..12 → zone_1..12
          const legacy = slot.slotKey.match(/^zone_(\d+)$/);
          if (legacy) { mapKey = `zone_${legacy[1]}`; }
          else {
            // 동적 슬롯: irrig_z{N}_{short} → zone_{N}
            const dyn = slot.slotKey.match(/^irrig_z(\d+)_/);
            mapKey = dyn ? `zone_${dyn[1]}` : `zone_${++dynZoneIdx}`;
          }
        } else { mapKey = slot.slotKey; }
        channelMapping[mapKey] = `relay_${slot.slotKey}`;
      }
      if (existingIrrig) {
        // 사용자가 이름 변경했더라도 보존 — channelMapping/online만 갱신
        existingIrrig.channelMapping = channelMapping;
        existingIrrig.online = gwOnline;
        if (!existingIrrig.houseId && gw.houseId) existingIrrig.houseId = gw.houseId;
        if (existingIrrig.userId !== gw.userId) existingIrrig.userId = gw.userId;
        // 기본 이름("관주 컨트롤러")인 경우만 gateway_id suffix를 자동 추가 (BUG-B 완화)
        if (existingIrrig.name === '관주 컨트롤러') {
          existingIrrig.name = `관주 컨트롤러 (${gw.gatewayId})`;
        }
        await this.deviceRepo.save(existingIrrig);
      } else {
        // BUG-B fix: gateway_id를 이름에 포함하여 동일 사용자의 여러 게이트웨이 구분 가능
        await this.deviceRepo.save(this.deviceRepo.create({
          userId: gw.userId,
          gatewayId: gw.id,
          houseId: gw.houseId ?? undefined,
          name: `관주 컨트롤러 (${gw.gatewayId})`,
          category: 'irrigation',
          deviceType: 'actuator',
          equipmentType: 'irrigation',
          source: 'onboard',
          friendlyName: 'onboard_irrigation',
          channelMapping,
          online: gwOnline,
        }));
      }
    } else if (existingIrrig) {
      await this.deviceRepo.remove(existingIrrig);
    }
  }

  // ── Zigbee: 목록 ─────────────────────────────────────────────
  async getZigbeeDevices(gatewayId: string, userId: string, role: string): Promise<Device[]> {
    const gw = await this.assertGatewayOwner(gatewayId, userId, role);
    return this.deviceRepo.find({
      where: { gatewayId, userId: gw.userId, source: 'zigbee' } as any,
      order: { createdAt: 'DESC' },
    });
  }

  // ── Zigbee: 추가 ─────────────────────────────────────────────
  async addZigbeeDevice(
    gatewayId: string,
    dto: AddZigbeeDeviceDto,
    userId: string,
    role: string,
  ): Promise<Device | Device[]> {
    const gw = await this.assertGatewayOwner(gatewayId, userId, role);

    // 중복 체크: 동일 게이트웨이 + friendlyName
    const byName = await this.deviceRepo.findOne({ where: { gatewayId, friendlyName: dto.friendlyName } });
    if (byName) throw new ConflictException(`이미 등록된 장치입니다 (friendlyName: ${dto.friendlyName})`);

    // 중복 체크: 동일 사용자 + IEEE 주소
    if (dto.zigbeeIeee) {
      const byIeee = await this.deviceRepo.findOne({ where: { userId: gw.userId, zigbeeIeee: dto.zigbeeIeee } });
      if (byIeee) throw new ConflictException(`이미 등록된 Zigbee 장치입니다 (IEEE: ${dto.zigbeeIeee})`);
    }

    const save = (data: Partial<Device>) => this.deviceRepo.save(
      this.deviceRepo.create({ ...data, userId: gw.userId, gatewayId })
    );

    const base = {
      zigbeeIeee: dto.zigbeeIeee,
      friendlyName: dto.friendlyName,
      zigbeeModel: dto.zigbeeModel,
      name: dto.name,
      category: dto.category,
      deviceType: dto.deviceType as any,
      equipmentType: dto.equipmentType as any,
      icon: dto.icon,
      houseId: dto.houseId ?? gw.houseId ?? undefined,
      online: dto.online ?? false,
      source: 'zigbee' as const,
    };

    const saved = await save(base);

    // 저장 전 이미 availability 메시지를 받았다면 online 상태 즉시 반영
    const cachedOnline = dto.friendlyName
      ? this.mqttService.getCachedAvailability(gw.gatewayId, dto.friendlyName)
      : undefined;
    if (cachedOnline !== undefined && cachedOnline !== saved.online) {
      await this.deviceRepo.update(saved.id, { online: cachedOnline, lastSeen: new Date() });
      saved.online = cachedOnline;
    }

    // 개폐기 페어링
    if (dto.pairedDeviceId) {
      const partner = await this.deviceRepo.findOne({ where: { id: dto.pairedDeviceId } });
      if (partner) {
        saved.pairedDeviceId = partner.id;
        partner.pairedDeviceId = saved.id;
        if (dto.openerGroupName) {
          saved.openerGroupName = dto.openerGroupName;
          partner.openerGroupName = dto.openerGroupName;
        }
        await this.deviceRepo.save([saved, partner]);
      }
    }

    return saved;
  }

  // ── Zigbee: 수정 (이름 / 채널매핑 / 구역) ────────────────────
  async updateZigbeeDevice(
    gatewayId: string,
    id: string,
    dto: UpdateZigbeeDeviceDto,
    userId: string,
    role: string,
  ): Promise<Device> {
    const gw = await this.assertGatewayOwner(gatewayId, userId, role);
    const device = await this.deviceRepo.findOne({ where: { id, userId: gw.userId, gatewayId } });
    if (!device) throw new NotFoundException('장치를 찾을 수 없습니다.');

    if (dto.name !== undefined) device.name = dto.name;
    if (dto.houseId !== undefined) device.houseId = dto.houseId;
    if (dto.channelMapping !== undefined) {
      const count = detectChannelCount(Object.values(dto.channelMapping));
      const allowed = count === 12 ? AVAILABLE_SWITCH_CODES_12CH : AVAILABLE_SWITCH_CODES_8CH;
      const invalid = Object.values(dto.channelMapping).filter(v => v && !allowed.includes(v));
      if (invalid.length) throw new NotFoundException(`유효하지 않은 채널: ${invalid.join(', ')}`);
      device.channelMapping = dto.channelMapping;
    }
    if (dto.deviceSettings !== undefined) {
      device.deviceSettings = { ...(device.deviceSettings ?? {}), ...dto.deviceSettings };
    }
    if (dto.enabled !== undefined) device.enabled = dto.enabled;
    return this.deviceRepo.save(device);
  }

  // ── Zigbee: 삭제 ─────────────────────────────────────────────
  /**
   * 삭제하려는 장치(및 함께 삭제될 controller/child 패밀리)가 자동화 룰에서 쓰이면
   * ConflictException(409, dependencies.automationRules) 을 던진다.
   * → 프론트가 "먼저 자동제어 룰을 삭제하세요" 팝업을 띄우도록.
   */
  private async assertNoAutomationDependency(device: Device, ownerId: string): Promise<void> {
    const rootId = (device as any).parentDeviceId || device.id;
    const family = await this.deviceRepo.find({
      where: [{ id: rootId }, { parentDeviceId: rootId } as any],
    });
    const ids = Array.from(new Set([device.id, rootId, ...family.map((f) => f.id)]));
    const rules: { id: string; name: string; enabled: boolean }[] =
      await this.deviceRepo.query(GATEWAY_ENV_DEVICE_DEP_SQL, [ownerId, ids]);
    if (rules.length > 0) {
      throw new ConflictException({
        message:
          '자동화 룰에서 사용 중인 장비는 삭제할 수 없습니다. 먼저 해당 자동제어 룰을 삭제한 뒤 장치를 삭제해 주세요.',
        dependencies: { automationRules: rules },
      });
    }
  }

  async removeZigbeeDevice(gatewayId: string, id: string, userId: string, role: string): Promise<void> {
    const gw = await this.assertGatewayOwner(gatewayId, userId, role);
    const device = await this.deviceRepo.findOne({ where: { id, userId: gw.userId, gatewayId } });
    if (!device) throw new NotFoundException('장치를 찾을 수 없습니다.');

    // 자동화 룰 사용 중이면 삭제 차단 (구 장치 페이지의 체크를 게이트웨이 삭제 경로에도 적용)
    await this.assertNoAutomationDependency(device, gw.userId);

    // 페어링 해제
    if (device.pairedDeviceId) {
      await this.deviceRepo.update(device.pairedDeviceId, { pairedDeviceId: null as any, openerGroupName: null as any });
    }

    // ── z2m 페어링 해제 — backend가 z2m bridge/request/device/remove 발행 ──
    // controller(parent) 삭제 시 1번만 발행 (children은 같은 IEEE 공유)
    // 페어 개폐기 삭제 시 양쪽 모두 z2m에서 해제
    const ieesToUnpair: { ieee: string; pairedIeee?: string | null }[] = [];
    if (device.zigbeeIeee) {
      const item: { ieee: string; pairedIeee?: string | null } = { ieee: device.zigbeeIeee };
      // 페어 개폐기 — 페어 IEEE도 함께 unpair
      if (device.pairedDeviceId) {
        const paired = await this.deviceRepo.findOne({ where: { id: device.pairedDeviceId } });
        if (paired?.zigbeeIeee && paired.zigbeeIeee !== device.zigbeeIeee) {
          item.pairedIeee = paired.zigbeeIeee;
        }
      }
      ieesToUnpair.push(item);
    }

    // Controller(parent) 삭제 시 자식들도 명시적 cascade
    // FK ON DELETE CASCADE가 있지만 환경에 따라 누락된 케이스 대비 (방어적 코드)
    if (device.equipmentType === 'controller') {
      await this.deviceRepo.delete({ parentDeviceId: device.id } as any);
      this.logger.log(`Controller ${device.name} 삭제 — children 일괄 정리`);
    }

    // child 삭제 시 parent와 다른 형제 child도 함께 (controller는 일체로 동작하므로)
    if ((device as any).parentDeviceId) {
      const parentId = (device as any).parentDeviceId;
      // parent 조회
      const parent = await this.deviceRepo.findOne({ where: { id: parentId } });
      if (parent) {
        // parent 삭제 → cascade로 나머지 children도 삭제됨
        await this.deviceRepo.remove(parent);
        this.logger.log(`Child ${device.name} 삭제 요청 → parent + 형제 children 일체 삭제 (controller 단위)`);
        await this.unpairFromZigbee2Mqtt(gw.gatewayId, ieesToUnpair);
        return;
      }
    }

    await this.deviceRepo.remove(device);
    await this.unpairFromZigbee2Mqtt(gw.gatewayId, ieesToUnpair);
  }

  /**
   * z2m bridge/request/device/remove publish (best-effort).
   * DB 삭제는 이미 완료된 상태이므로 z2m 측 실패해도 backend 흐름은 영향 없음.
   * z2m에서 정리 실패 시 사용자가 z2m UI에서 수동 정리 가능.
   */
  private async unpairFromZigbee2Mqtt(
    gatewayId: string,
    items: { ieee: string; pairedIeee?: string | null }[],
  ): Promise<void> {
    for (const it of items) {
      try {
        await this.mqttService.removeZigbeeDevice(gatewayId, it.ieee);
      } catch (e: any) {
        this.logger.warn(`z2m unpair 실패 ${gatewayId}/${it.ieee}: ${e?.message ?? e}`);
      }
      if (it.pairedIeee) {
        try {
          await this.mqttService.removeZigbeeDevice(gatewayId, it.pairedIeee);
        } catch (e: any) {
          this.logger.warn(`z2m unpair (paired) 실패 ${gatewayId}/${it.pairedIeee}: ${e?.message ?? e}`);
        }
      }
    }
  }

  // ── Zigbee: 스캔 목록 (bridge/devices 캐시) + 다채널 컨트롤러 채널 수 감지 ──
  async scanZigbeeDevices(gatewayId: string, userId: string, role: string): Promise<any[]> {
    const gw = await this.assertGatewayOwner(gatewayId, userId, role);
    const devices = await this.mqttService.requestZigbeeDevices(gw.gatewayId);
    // 다채널 컨트롤러 자동 감지 — TS0601 등 모델명에 채널 수가 없어도
    // exposes의 state_l1, state_l2, ... 개수로 채널 수 파악
    return devices.map((d: any) => {
      const channelCount = this.detectChannelCountFromExposes(d);
      return { ...d, detectedChannelCount: channelCount };
    });
  }

  /**
   * z2m bridge/devices에서 다채널 컨트롤러 여부 + 권장 채널 수 감지.
   *
   * 우선순위 (위에서 확실, 아래로 갈수록 추정):
   *   1. model_id에 `_switch_N` 명시 (TS0601_switch_8 등) — 그 값 그대로 사용
   *   2. exposes에 state_l1만 존재 → 단일 채널 (1)
   *   3. 다채널 evidence(2개 이상 state_lN endpoint) 있음:
   *        - z2m의 generic TS0601 정의가 'N gang switch' 인 경우 그 값을 그대로 믿기 어렵다.
   *          (실물은 8채널인데 description=12 gang switch 등 케이스 흔함)
   *        - 따라서 **8을 기본 권장값**으로 반환하고 사용자가 모달에서 8/12 직접 선택하도록 한다.
   *   4. 단일 채널이거나 정보 부족 → null
   *
   * 반환값은 frontend의 detectedChannelCount로 그대로 전달되며,
   * 모달의 채널 수 토글이 이 값을 default로 사용한다 (사용자 override 가능).
   */
  private detectChannelCountFromExposes(d: any): 1 | 8 | 12 | null {
    if (!d) return null;
    const modelId: string = d.model_id || d.definition?.model || '';

    // 1. model_id에 명시적 `_switch_N` — 가장 확실
    const modelMatch = modelId.toLowerCase().match(/_?switch_(\d+)/);
    if (modelMatch) {
      const n = Number(modelMatch[1]);
      if (n >= 12) return 12;
      if (n >= 2) return 8;
      if (n === 1) return 1;
    }

    // 2. exposes의 실제 state_l* endpoint 카운트
    const exposes: any[] = d.definition?.exposes ?? [];
    const stateKeys = new Set<string>();
    const collect = (e: any) => {
      if (!e) return;
      const propMatch = String(e.property || '').match(/^state_l(\d+)$/);
      if (propMatch) stateKeys.add(`l${propMatch[1]}`);
      const nameMatch = String(e.name || '').match(/^state_l(\d+)$/);
      if (nameMatch) stateKeys.add(`l${nameMatch[1]}`);
      if (e.endpoint && /^l\d+$/.test(e.endpoint) && (e.name === 'state' || e.property?.startsWith('state') || e.type === 'switch')) {
        stateKeys.add(e.endpoint);
      }
      if (Array.isArray(e.features)) e.features.forEach(collect);
      if (Array.isArray(e.exposes)) e.exposes.forEach(collect);
    };
    exposes.forEach(collect);

    if (stateKeys.size === 0) return null;
    if (stateKeys.size === 1) return 1;

    // 3. 다채널 evidence는 있지만 model_id에 채널 수 미명시.
    //    z2m generic 정의(특히 TS0601)는 실물보다 많은 채널을 보고하는 경우가 많아
    //    기본을 8로 권장 (8채널이 더 흔함). 사용자가 모달에서 12로 변경 가능.
    return 8;
  }

  // ── 통합 조회 (온보드 + 지그비 + 관주 대표 장치) ────────────
  async getAllDevices(gatewayId: string, userId: string, role: string): Promise<{ onboard: GatewayOnboardDevice[]; zigbee: Device[]; irrigationDevice: Device | null }> {
    const gw = await this.assertGatewayOwner(gatewayId, userId, role);
    const [onboard, zigbeeRaw] = await Promise.all([
      this.ensureOnboardDevices(gatewayId),
      this.deviceRepo.find({ where: { gatewayId, userId: gw.userId, source: 'zigbee' } as any, order: { createdAt: 'DESC' } }),
    ]);
    const irrigationRaw = await this.deviceRepo.findOne({
      where: { gatewayId, userId: gw.userId, source: 'onboard', equipmentType: 'irrigation' } as any,
    }) ?? null;
    // deviceSettings의 switchState/switchStates/disabledChannels를 최상위로 expose
    // (frontend의 환경설정/구역관리/위저드가 직접 device.disabledChannels 등 사용)
    const zigbee = zigbeeRaw.map(d => this.exposeSwitchFields(d));
    const irrigationDevice = irrigationRaw ? this.exposeSwitchFields(irrigationRaw) : null;
    return { onboard, zigbee, irrigationDevice };
  }

  private exposeSwitchFields(device: Device): any {
    const settings = (device.deviceSettings as any) || {};
    return {
      ...device,
      switchState: settings.switchState ?? null,
      switchStates: settings.switchStates ?? null,
      relayActivePhase: settings.relayActivePhase ?? null,
      disabledChannels: Array.isArray(settings.disabledChannels) ? settings.disabledChannels : [],
    };
  }

  // ── 온보드 관주 대표 이름 수정 ─────────────────────────────
  async updateIrrigationDeviceName(gatewayId: string, name: string, userId: string, role: string): Promise<Device> {
    const gw = await this.assertGatewayOwner(gatewayId, userId, role);
    // userId 매칭 제거: gateway-device userId 불일치(예: gateway owner 변경 후 device userId 미동기화) 시에도 동작
    // gateway-env 접근 권한은 assertGatewayOwner에서 이미 검증됨
    const device = await this.deviceRepo.findOne({
      where: { gatewayId, source: 'onboard', equipmentType: 'irrigation' } as any,
    });
    if (!device) throw new NotFoundException('관주 컨트롤러 장치를 찾을 수 없습니다.');
    device.name = name;
    // device userId도 gateway owner와 동기화 (drift 자가 치유)
    if (device.userId !== gw.userId) {
      device.userId = gw.userId;
    }
    return this.deviceRepo.save(device);
  }

  // ── 핀 테스트: 온보드 GPIO ────────────────────────────────────
  async testGpioPin(
    gatewayId: string,
    pin: number,
    state: boolean,
    durationMs: number | undefined,
    userId: string,
    role: string,
  ): Promise<void> {
    const gw = await this.assertGatewayOwner(gatewayId, userId, role);
    await this.mqttService.publishGpioRelay(gw.gatewayId, {
      slot: `test_pin_${pin}`,
      pin,
      state,
      durationMs,
    });
  }

  // ── 핀 테스트: Zigbee 채널 ────────────────────────────────────
  async testZigbeeChannel(
    gatewayId: string,
    friendlyName: string,
    switchCode: string,
    state: boolean,
    durationMs: number | undefined,
    userId: string,
    role: string,
  ): Promise<void> {
    const gw = await this.assertGatewayOwner(gatewayId, userId, role);
    // device model에 따라 z2m payload 키 변환 (Tuya TS0601 = state_l1~state_l12)
    const device = await this.deviceRepo.findOne({ where: { friendlyName, gatewayId: gw.id } as any });
    const z2mKey = this.translateSwitchKeyForZ2m(switchCode, device?.zigbeeModel);
    const command: Record<string, string> = { [z2mKey]: state ? 'ON' : 'OFF' };
    await this.mqttService.controlDevice(gw.gatewayId, friendlyName, command);
    // 자동 해제
    if (durationMs && state) {
      setTimeout(async () => {
        await this.mqttService.controlDevice(gw.gatewayId, friendlyName, { [z2mKey]: 'OFF' });
      }, durationMs);
    }
  }

  /**
   * 표준 switch_N → device 모델별 z2m payload 키로 변환.
   * - Tuya TS0601 multi-channel (TS0601, TS0601_switch_2~12): state_l1~state_lN
   * - 그 외: switch_N 그대로
   */
  private translateSwitchKeyForZ2m(switchCode: string, zigbeeModel?: string | null): string {
    if (!zigbeeModel) return switchCode;
    const model = zigbeeModel.toLowerCase();
    const isTuyaMulti = model.includes('ts0601');
    if (!isTuyaMulti) return switchCode;
    const m = switchCode.match(/^switch_(\d+)$/);
    if (!m) return switchCode;
    return `state_l${m[1]}`;
  }
}
