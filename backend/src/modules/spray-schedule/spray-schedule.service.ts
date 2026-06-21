import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, In } from 'typeorm';
import { SprayZone } from './entities/spray-zone.entity';
import { SprayProgram } from './entities/spray-program.entity';
import { SprayProduct } from './entities/spray-product.entity';
import { SprayEvent } from './entities/spray-event.entity';
import { SaveZoneConfigDto } from './dto/save-zone-config.dto';
import { MoveEventDto, CreateManualEventDto } from './dto/event.dto';

// ──── 날짜 헬퍼 (date-only, UTC 기준으로 TZ 영향 제거) ────
function parseDate(s: string): Date {
  return new Date(`${s.slice(0, 10)}T00:00:00.000Z`);
}
function addDays(s: string, days: number): string {
  const d = parseDate(s);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function diffDays(a: string, b: string): number {
  return Math.round((parseDate(a).getTime() - parseDate(b).getTime()) / 86400000);
}

// 벌(호박벌) 사용 방재: 벌문 개방 칩 색(꿀/앰버색)
const BEE_GATE_COLOR = '#f9a825';

@Injectable()
export class SprayScheduleService {
  constructor(
    @InjectRepository(SprayZone)
    private readonly zoneRepo: Repository<SprayZone>,
    @InjectRepository(SprayProgram)
    private readonly programRepo: Repository<SprayProgram>,
    @InjectRepository(SprayProduct)
    private readonly productRepo: Repository<SprayProduct>,
    @InjectRepository(SprayEvent)
    private readonly eventRepo: Repository<SprayEvent>,
    private readonly dataSource: DataSource,
  ) {}

  // ──── 구역 + 프로그램 + 약품 조회 ────

  async listZones(userId: string) {
    const zones = await this.zoneRepo.find({
      where: { userId, isActive: true },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
    if (zones.length === 0) return [];

    const zoneIds = zones.map((z) => z.id);
    const programs = await this.programRepo.find({
      where: { userId, zoneId: In(zoneIds) },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
    const programIds = programs.map((p) => p.id);
    const products =
      programIds.length > 0
        ? await this.productRepo.find({
            where: { userId, programId: In(programIds) },
            order: { rank: 'ASC' },
          })
        : [];

    return zones.map((z) => ({
      ...z,
      programs: programs
        .filter((p) => p.zoneId === z.id)
        .map((p) => ({
          ...p,
          products: products.filter((pr) => pr.programId === p.id),
        })),
    }));
  }

  // ──── 구역 카드 전체 저장 + 이벤트 재생성 ────

  async saveZoneConfig(userId: string, dto: SaveZoneConfigDto) {
    return this.dataSource.transaction(async (manager) => {
      let zone: SprayZone;
      if (dto.id) {
        const found = await manager.findOne(SprayZone, { where: { id: dto.id } });
        if (!found) throw new NotFoundException('구역을 찾을 수 없습니다.');
        if (found.userId !== userId) throw new ForbiddenException();
        zone = found;
      } else {
        zone = manager.create(SprayZone, { userId });
      }
      Object.assign(zone, {
        groupId: dto.groupId ?? null,
        name: dto.name,
        cropType: dto.cropType ?? null,
        transplantDate: dto.transplantDate,
        color: dto.color ?? zone.color ?? '#43a047',
        sortOrder: dto.sortOrder ?? zone.sortOrder ?? 0,
        isActive: true,
      });
      zone = await manager.save(zone);

      // 기존 프로그램/약품 — id 기준 업서트(재사용)로 productId를 안정적으로 유지.
      // (전량 삭제·재생성하면 productId가 매번 바뀌어 이동(고정)한 일정과의 연결이 끊기고
      //  재생성 시 중복이 생긴다.)
      const existingPrograms = await manager.find(SprayProgram, {
        where: { zoneId: zone.id },
      });
      const existingProducts = existingPrograms.length
        ? await manager.find(SprayProduct, {
            where: { programId: In(existingPrograms.map((p) => p.id)) },
          })
        : [];
      const progById = new Map(existingPrograms.map((p) => [p.id, p]));
      const prodById = new Map(existingProducts.map((p) => [p.id, p]));
      const keptProgramIds = new Set<string>();
      const keptProductIds = new Set<string>();

      const savedPrograms: Array<{
        program: SprayProgram;
        products: SprayProduct[];
      }> = [];
      let pIdx = 0;
      for (const pi of dto.programs) {
        let program =
          pi.id && progById.has(pi.id)
            ? progById.get(pi.id)!
            : manager.create(SprayProgram, { userId, zoneId: zone.id });
        program.pest = pi.pest;
        program.color = pi.color ?? '#e53935';
        program.sortOrder = pi.sortOrder ?? pIdx;
        program = await manager.save(program);
        keptProgramIds.add(program.id);
        pIdx += 1;

        const products: SprayProduct[] = [];
        const sorted = [...pi.products].sort((a, b) => a.rank - b.rank);
        for (const pr of sorted) {
          let product =
            pr.id && prodById.has(pr.id)
              ? prodById.get(pr.id)!
              : manager.create(SprayProduct, { userId });
          product.programId = program.id;
          product.rank = pr.rank;
          product.name = pr.name;
          product.startDate = pr.startDate;
          product.intervalDays = pr.intervalDays;
          product.count = pr.count;
          product.hasBees = pr.hasBees ?? false;
          product.timeOfDay = pr.timeOfDay === 'am' ? 'am' : 'pm';
          product = await manager.save(product);
          keptProductIds.add(product.id);
          products.push(product);
        }
        savedPrograms.push({ program, products });
      }

      // 설정에서 제거된 약품/프로그램과 그 이벤트(고정 포함) 정리
      const removedProductIds = existingProducts
        .filter((p) => !keptProductIds.has(p.id))
        .map((p) => p.id);
      if (removedProductIds.length > 0) {
        await manager.delete(SprayEvent, { productId: In(removedProductIds) });
        await manager.delete(SprayProduct, { id: In(removedProductIds) });
      }
      const removedProgramIds = existingPrograms
        .filter((p) => !keptProgramIds.has(p.id))
        .map((p) => p.id);
      if (removedProgramIds.length > 0) {
        await manager.delete(SprayProgram, { id: In(removedProgramIds) });
      }

      await this.regenerateEvents(manager, userId, zone, savedPrograms);
      return zone;
    });
  }

  /**
   * 이벤트 재생성:
   * - 자동 생성(isManual=false) & pinned=false 이벤트만 삭제 후 재생성.
   * - pinned(드래그 이동) 및 isManual(단건 추가) 이벤트는 보존.
   * - 차수 = 약품별 1차부터. 약품 시작일은 저장된 값 그대로 사용.
   */
  private async regenerateEvents(
    manager: import('typeorm').EntityManager,
    userId: string,
    zone: SprayZone,
    programs: Array<{ program: SprayProgram; products: SprayProduct[] }>,
  ) {
    // 비고정 자동 일정만 삭제 (사용자가 옮긴 '고정' 일정은 보존)
    await manager.delete(SprayEvent, {
      zoneId: zone.id,
      isManual: false,
      pinned: false,
    });

    // 보존된 고정 일정 — (약품·회차·종류) 키로 매핑해 중복 생성을 막는다.
    const pinnedExisting = await manager.find(SprayEvent, {
      where: { zoneId: zone.id, isManual: false, pinned: true },
    });
    const pinnedByKey = new Map<string, SprayEvent>();
    for (const ev of pinnedExisting) {
      if (ev.productId) pinnedByKey.set(`${ev.productId}:${ev.round}:${ev.kind}`, ev);
    }

    const fresh: Partial<SprayEvent>[] = [];
    const updates: SprayEvent[] = [];

    // 같은 일정이 이미 고정(이동)되어 있으면: 날짜는 그대로 두고 메타데이터만 최신화.
    // 없으면: 설정대로 새 일정 생성.
    const apply = (key: string, spec: Partial<SprayEvent>) => {
      const pinned = pinnedByKey.get(key);
      if (pinned) {
        pinned.programId = spec.programId ?? null;
        pinned.pest = spec.pest ?? null;
        pinned.product = spec.product ?? null;
        pinned.color = spec.color ?? null;
        pinned.bee = spec.bee ?? false;
        pinned.timeOfDay = spec.timeOfDay ?? null;
        updates.push(pinned);
        pinnedByKey.delete(key); // 매칭됨 → 남은 것은 orphan
      } else {
        fresh.push(spec);
      }
    };

    for (const { program, products } of programs) {
      for (const product of products) {
        const bee = !!product.hasBees;
        const timeOfDay = product.timeOfDay === 'am' ? 'am' : 'pm';
        // 벌문 개방 시점: 오전 방재 +2일, 오후 방재 +3일 (모두 오전 개방)
        const beeOffset = timeOfDay === 'am' ? 2 : 3;
        for (let i = 0; i < product.count; i++) {
          const round = i + 1;
          const sprayDate = addDays(product.startDate, product.intervalDays * i);
          // 방재 이벤트 (벌 사용 시 bee=true → 벌문 닫기 표시)
          apply(`${product.id}:${round}:spray`, {
            userId,
            zoneId: zone.id,
            programId: program.id,
            productId: product.id,
            date: sprayDate,
            pest: program.pest,
            product: product.name,
            color: program.color,
            round,
            kind: 'spray',
            bee,
            timeOfDay,
            isManual: false,
            pinned: false,
          });
          // 벌 사용 시: 방재 후 '벌문 개방' 이벤트 생성 (오전 개방)
          if (bee) {
            apply(`${product.id}:${round}:bee_open`, {
              userId,
              zoneId: zone.id,
              programId: program.id,
              productId: product.id,
              date: addDays(sprayDate, beeOffset),
              pest: '벌문 개방',
              product: `${program.pest} ${round}차(${timeOfDay === 'am' ? '오전' : '오후'}) 방재 후`,
              color: BEE_GATE_COLOR,
              round,
              kind: 'bee_open',
              bee: true,
              timeOfDay: 'am',
              isManual: false,
              pinned: false,
            });
          }
        }
      }
    }
    if (fresh.length > 0) {
      await manager.save(SprayEvent, fresh.map((r) => manager.create(SprayEvent, r)));
    }
    if (updates.length > 0) {
      await manager.save(SprayEvent, updates);
    }
    // 설정에서 더 이상 생성되지 않는 회차/벌문(고정 일정)은 제거
    const orphanIds = [...pinnedByKey.values()].map((e) => e.id);
    if (orphanIds.length > 0) {
      await manager.delete(SprayEvent, { id: In(orphanIds) });
    }
  }

  async deleteZone(userId: string, zoneId: string) {
    await this.dataSource.transaction(async (manager) => {
      const zone = await manager.findOne(SprayZone, { where: { id: zoneId } });
      if (!zone) throw new NotFoundException('구역을 찾을 수 없습니다.');
      if (zone.userId !== userId) throw new ForbiddenException();
      const programs = await manager.find(SprayProgram, { where: { zoneId } });
      if (programs.length > 0) {
        await manager.delete(SprayProduct, {
          programId: In(programs.map((p) => p.id)),
        });
      }
      await manager.delete(SprayProgram, { zoneId });
      await manager.delete(SprayEvent, { zoneId });
      await manager.delete(SprayZone, { id: zoneId });
    });
  }

  // ──── 달력 이벤트 조회 (전 구역 통합) ────

  async getEvents(userId: string, from?: string, to?: string) {
    const qb = this.eventRepo
      .createQueryBuilder('e')
      .where('e.user_id = :userId', { userId });
    if (from) qb.andWhere('e.date >= :from', { from });
    if (to) qb.andWhere('e.date <= :to', { to });
    qb.orderBy('e.date', 'ASC');
    const events = await qb.getMany();

    const zones = await this.zoneRepo.find({ where: { userId } });
    const zoneMap = new Map(zones.map((z) => [z.id, z]));

    return events.map((e) => {
      const z = zoneMap.get(e.zoneId);
      return {
        ...e,
        zoneName: z?.name ?? null,
        zoneColor: z?.color ?? null,
      };
    });
  }

  /** 정식일 뱃지용 구역 목록 (이름/색/정식일) */
  async getZoneMarkers(userId: string) {
    const zones = await this.zoneRepo.find({
      where: { userId, isActive: true },
      order: { sortOrder: 'ASC' },
    });
    return zones.map((z) => ({
      id: z.id,
      name: z.name,
      color: z.color,
      transplantDate: z.transplantDate,
    }));
  }

  // ──── 드래그 이동 ────

  async moveEvent(userId: string, eventId: string, dto: MoveEventDto) {
    const event = await this.findOwnedEvent(userId, eventId);
    const delta = diffDays(dto.date, event.date);
    if (delta === 0) return event;

    if (dto.mode === 'single' || event.isManual || !event.productId) {
      event.date = dto.date;
      event.pinned = true;
      await this.eventRepo.save(event);
      // 방재 이벤트를 옮기면 짝인 '벌문 개방'도 같은 만큼 이동(2일 간격 유지)
      if (event.kind === 'spray' && event.productId) {
        const paired = await this.eventRepo.find({
          where: { userId, productId: event.productId, round: event.round, kind: 'bee_open' },
        });
        for (const p of paired) {
          p.date = addDays(p.date, delta);
          p.pinned = true;
        }
        if (paired.length) await this.eventRepo.save(paired);
      }
      return this.findOwnedEvent(userId, eventId);
    }

    // following: 같은 약품(productId)의 이 회차 이상 전체(방재+벌문 개방)를 delta 만큼 이동
    const siblings = await this.eventRepo.find({
      where: { userId, productId: event.productId },
    });
    const targets = siblings.filter((s) => s.round >= event.round);
    for (const s of targets) {
      s.date = addDays(s.date, delta);
      s.pinned = true;
    }
    await this.eventRepo.save(targets);
    return this.findOwnedEvent(userId, eventId);
  }

  // ──── 단건 추가 / 삭제 ────

  async createManualEvent(userId: string, dto: CreateManualEventDto) {
    const zone = await this.zoneRepo.findOne({ where: { id: dto.zoneId } });
    if (!zone) throw new NotFoundException('구역을 찾을 수 없습니다.');
    if (zone.userId !== userId) throw new ForbiddenException();

    const event = this.eventRepo.create({
      userId,
      zoneId: dto.zoneId,
      programId: null,
      productId: null,
      date: dto.date,
      pest: dto.pest ?? null,
      product: dto.product ?? null,
      color: dto.color ?? zone.color,
      round: 1,
      isManual: true,
      pinned: true,
      note: dto.note ?? null,
    });
    return this.eventRepo.save(event);
  }

  async deleteEvent(userId: string, eventId: string) {
    const event = await this.findOwnedEvent(userId, eventId);
    await this.eventRepo.delete({ id: event.id });
  }

  private async findOwnedEvent(userId: string, id: string): Promise<SprayEvent> {
    const event = await this.eventRepo.findOne({ where: { id } });
    if (!event) throw new NotFoundException('일정을 찾을 수 없습니다.');
    if (event.userId !== userId) throw new ForbiddenException();
    return event;
  }
}
