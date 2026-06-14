import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { ZoneNote } from './entities/zone-note.entity';
import { HouseGroup } from '../groups/entities/house-group.entity';
import { User } from '../users/entities/user.entity';
import { CreateZoneNoteDto, UpdateZoneNoteDto } from './dto/zone-note.dto';

function effectiveUserId(user: { id: string; role: string; parentUserId?: string | null }): string {
  if (user.role === 'farm_user' && user.parentUserId) return user.parentUserId;
  return user.id;
}

@Injectable()
export class ZoneNotesService {
  constructor(
    @InjectRepository(ZoneNote) private readonly repo: Repository<ZoneNote>,
    @InjectRepository(HouseGroup) private readonly groupRepo: Repository<HouseGroup>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
  ) {}

  /** 구역별 메모 목록 — 고정(pinned) 우선, 최신순 */
  async list(user: any, zoneId: string): Promise<ZoneNote[]> {
    const uid = effectiveUserId(user);
    return this.repo.find({
      where: { userId: uid, zoneId },
      order: { pinned: 'DESC', createdAt: 'DESC' },
    });
  }

  /** 농장 전체 구역의 메모 개수 맵 (헤더 배지용) */
  async counts(user: any): Promise<Record<string, number>> {
    const uid = effectiveUserId(user);
    const rows: { zone_id: string; cnt: string }[] = await this.repo
      .createQueryBuilder('n')
      .select('n.zone_id', 'zone_id')
      .addSelect('COUNT(*)', 'cnt')
      .where('n.user_id = :uid', { uid })
      .groupBy('n.zone_id')
      .getRawMany();
    const map: Record<string, number> = {};
    for (const r of rows) map[r.zone_id] = Number(r.cnt);
    return map;
  }

  async create(user: any, dto: CreateZoneNoteDto): Promise<ZoneNote> {
    const uid = effectiveUserId(user);
    const zone = await this.groupRepo.findOne({ where: { id: dto.zoneId, userId: uid } });
    if (!zone) throw new NotFoundException('구역을 찾을 수 없습니다.');
    const author = await this.userRepo.findOne({ where: { id: user.id } });
    const row = this.repo.create({
      userId: uid,
      zoneId: dto.zoneId,
      tag: dto.tag,
      text: dto.text,
      pinned: dto.pinned ?? false,
      createdByUser: user.id,
      createdByName: author?.name ?? user.username ?? null,
    });
    return this.repo.save(row);
  }

  async update(user: any, id: string, dto: UpdateZoneNoteDto): Promise<ZoneNote> {
    const row = await this.findOwned(user, id);
    if (dto.tag !== undefined) row.tag = dto.tag;
    if (dto.text !== undefined) row.text = dto.text;
    if (dto.pinned !== undefined) row.pinned = dto.pinned;
    return this.repo.save(row);
  }

  async remove(user: any, id: string): Promise<{ ok: true }> {
    const row = await this.findOwned(user, id);
    await this.repo.remove(row);
    return { ok: true };
  }

  private async findOwned(user: any, id: string): Promise<ZoneNote> {
    const uid = effectiveUserId(user);
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('메모를 찾을 수 없습니다.');
    if (row.userId !== uid) throw new ForbiddenException();
    return row;
  }
}
