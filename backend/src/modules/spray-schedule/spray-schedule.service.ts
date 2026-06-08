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

      // 기존 프로그램/약품 전량 교체
      const oldPrograms = await manager.find(SprayProgram, {
        where: { zoneId: zone.id },
      });
      if (oldPrograms.length > 0) {
        await manager.delete(SprayProduct, {
          programId: In(oldPrograms.map((p) => p.id)),
        });
        await manager.delete(SprayProgram, { zoneId: zone.id });
      }

      const savedPrograms: Array<{
        program: SprayProgram;
        products: SprayProduct[];
      }> = [];
      let pIdx = 0;
      for (const pi of dto.programs) {
        const program = await manager.save(
          manager.create(SprayProgram, {
            userId,
            zoneId: zone.id,
            pest: pi.pest,
            color: pi.color ?? '#e53935',
            sortOrder: pi.sortOrder ?? pIdx,
          }),
        );
        pIdx += 1;
        const products: SprayProduct[] = [];
        const sorted = [...pi.products].sort((a, b) => a.rank - b.rank);
        for (const pr of sorted) {
          products.push(
            await manager.save(
              manager.create(SprayProduct, {
                userId,
                programId: program.id,
                rank: pr.rank,
                name: pr.name,
                startDate: pr.startDate,
                intervalDays: pr.intervalDays,
                count: pr.count,
              }),
            ),
          );
        }
        savedPrograms.push({ program, products });
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
    await manager.delete(SprayEvent, {
      zoneId: zone.id,
      isManual: false,
      pinned: false,
    });

    const rows: Partial<SprayEvent>[] = [];
    for (const { program, products } of programs) {
      for (const product of products) {
        for (let i = 0; i < product.count; i++) {
          rows.push({
            userId,
            zoneId: zone.id,
            programId: program.id,
            productId: product.id,
            date: addDays(product.startDate, product.intervalDays * i),
            pest: program.pest,
            product: product.name,
            color: program.color,
            round: i + 1,
            isManual: false,
            pinned: false,
          });
        }
      }
    }
    if (rows.length > 0) {
      await manager.save(SprayEvent, rows.map((r) => manager.create(SprayEvent, r)));
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
      return this.eventRepo.save(event);
    }

    // following: 같은 약품(productId)의 이 회차 이상 전체를 delta 만큼 이동
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
