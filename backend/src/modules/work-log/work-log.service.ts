import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Repository } from 'typeorm';
import { WorkTaskType } from './entities/work-task-type.entity';
import { WorkLog } from './entities/work-log.entity';
import {
  CreateWorkLogDto,
  UpdateWorkLogDto,
  UpsertWorkTaskTypeDto,
  WorkLogListQueryDto,
} from './dto/work-log.dto';
import { STANDARD_WORK_TASK_TYPES } from './work-log.constants';
import { HouseGroup } from '../groups/entities/house-group.entity';
import { User } from '../users/entities/user.entity';

/** 사용자 자산 범위 — admin(데모): 자기 자신, farm_user: parentUserId, 그 외: 본인 */
function effectiveUserId(user: { id: string; role: string; parentUserId?: string | null }): string {
  if (user.role === 'farm_user' && user.parentUserId) return user.parentUserId;
  return user.id;
}

@Injectable()
export class WorkLogService {
  constructor(
    @InjectRepository(WorkTaskType) private readonly taskTypeRepo: Repository<WorkTaskType>,
    @InjectRepository(WorkLog) private readonly logRepo: Repository<WorkLog>,
    @InjectRepository(HouseGroup) private readonly groupRepo: Repository<HouseGroup>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
  ) {}

  // ───── seeding ─────
  private async ensureStandardSeed(userId: string): Promise<void> {
    const existing = await this.taskTypeRepo.count({ where: { userId, isStandard: true } });
    if (existing >= STANDARD_WORK_TASK_TYPES.length) return;
    const have = new Set(
      (await this.taskTypeRepo.find({ where: { userId, isStandard: true } })).map((t) => t.label),
    );
    const missing = STANDARD_WORK_TASK_TYPES.filter((s) => !have.has(s.label));
    if (missing.length === 0) return;
    const rows = missing.map((s) =>
      this.taskTypeRepo.create({
        userId,
        label: s.label,
        emoji: s.emoji,
        color: s.color,
        isStandard: true,
        displayOrder: s.order,
      }),
    );
    await this.taskTypeRepo.save(rows);
  }

  // ───── task types ─────
  async listTaskTypes(user: { id: string; role: string; parentUserId?: string | null }): Promise<WorkTaskType[]> {
    const uid = effectiveUserId(user);
    await this.ensureStandardSeed(uid);
    return this.taskTypeRepo.find({
      where: { userId: uid },
      order: { displayOrder: 'ASC', createdAt: 'ASC' },
    });
  }

  async createTaskType(
    user: { id: string; role: string; parentUserId?: string | null },
    dto: UpsertWorkTaskTypeDto,
  ): Promise<WorkTaskType> {
    if (user.role === 'farm_user') {
      throw new ForbiddenException('작업 종류 추가는 농장 관리자만 가능합니다');
    }
    const uid = effectiveUserId(user);
    const maxOrder = await this.taskTypeRepo
      .createQueryBuilder('t')
      .select('COALESCE(MAX(t.display_order), 0)', 'max')
      .where('t.user_id = :uid', { uid })
      .getRawOne<{ max: string }>();
    const row = this.taskTypeRepo.create({
      userId: uid,
      label: dto.label,
      emoji: dto.emoji,
      color: dto.color,
      iconKey: dto.iconKey ?? null,
      isStandard: false,
      displayOrder: dto.displayOrder ?? Number(maxOrder?.max ?? 0) + 1,
    });
    return this.taskTypeRepo.save(row);
  }

  async updateTaskType(
    user: { id: string; role: string; parentUserId?: string | null },
    id: string,
    dto: UpsertWorkTaskTypeDto,
  ): Promise<WorkTaskType> {
    if (user.role === 'farm_user') {
      throw new ForbiddenException('작업 종류 편집은 농장 관리자만 가능합니다');
    }
    const uid = effectiveUserId(user);
    const row = await this.taskTypeRepo.findOne({ where: { id, userId: uid } });
    if (!row) throw new NotFoundException('작업 종류를 찾을 수 없습니다');
    row.label = dto.label;
    row.emoji = dto.emoji;
    row.color = dto.color;
    if (dto.iconKey !== undefined) row.iconKey = dto.iconKey ?? null;
    if (dto.displayOrder !== undefined) row.displayOrder = dto.displayOrder;
    return this.taskTypeRepo.save(row);
  }

  async toggleHidden(
    user: { id: string; role: string; parentUserId?: string | null },
    id: string,
    hidden: boolean,
  ): Promise<WorkTaskType> {
    if (user.role === 'farm_user') {
      throw new ForbiddenException('작업 종류 숨김은 농장 관리자만 가능합니다');
    }
    const uid = effectiveUserId(user);
    const row = await this.taskTypeRepo.findOne({ where: { id, userId: uid } });
    if (!row) throw new NotFoundException('작업 종류를 찾을 수 없습니다');
    row.hidden = hidden;
    return this.taskTypeRepo.save(row);
  }

  async deleteTaskType(
    user: { id: string; role: string; parentUserId?: string | null },
    id: string,
  ): Promise<{ ok: true; hidden?: boolean }> {
    if (user.role === 'farm_user') {
      throw new ForbiddenException('작업 종류 삭제는 농장 관리자만 가능합니다');
    }
    const uid = effectiveUserId(user);
    const row = await this.taskTypeRepo.findOne({ where: { id, userId: uid } });
    if (!row) throw new NotFoundException('작업 종류를 찾을 수 없습니다');
    if (row.isStandard) {
      // 표준은 삭제 대신 숨김
      row.hidden = true;
      await this.taskTypeRepo.save(row);
      return { ok: true, hidden: true };
    }
    // 사용 중인 기록이 있으면 삭제 막음
    const usedCount = await this.logRepo.count({ where: { taskTypeId: id, userId: uid } });
    if (usedCount > 0) {
      throw new BadRequestException(
        `이 작업 종류로 ${usedCount}건의 기록이 있어 삭제할 수 없습니다. 숨김 처리만 가능합니다`,
      );
    }
    await this.taskTypeRepo.remove(row);
    return { ok: true };
  }

  // ───── logs ─────
  async createLog(
    user: { id: string; role: string; parentUserId?: string | null },
    dto: CreateWorkLogDto,
  ): Promise<WorkLog> {
    const uid = effectiveUserId(user);
    // 구역/작업 종류 소유 검증
    const zone = await this.groupRepo.findOne({ where: { id: dto.zoneId, userId: uid } });
    if (!zone) throw new NotFoundException('구역을 찾을 수 없습니다');
    const tt = await this.taskTypeRepo.findOne({ where: { id: dto.taskTypeId, userId: uid } });
    if (!tt) throw new NotFoundException('작업 종류를 찾을 수 없습니다');
    const row = this.logRepo.create({
      userId: uid,
      zoneId: dto.zoneId,
      taskTypeId: dto.taskTypeId,
      workerId: dto.workerId ?? null,
      doneAt: dto.doneAt ? new Date(dto.doneAt) : new Date(),
      note: dto.note ?? null,
      qty: dto.qty ?? null,
    });
    return this.logRepo.save(row);
  }

  /** 기록 수정 — 날짜/구역/작업종류/작업자/메모 변경 (날짜 변경 시 달력에서 이동) */
  async updateLog(
    user: { id: string; role: string; parentUserId?: string | null },
    id: string,
    dto: UpdateWorkLogDto,
  ): Promise<WorkLog> {
    const uid = effectiveUserId(user);
    const row = await this.logRepo.findOne({ where: { id, userId: uid } });
    if (!row) throw new NotFoundException('기록을 찾을 수 없습니다');

    if (dto.zoneId !== undefined) {
      const zone = await this.groupRepo.findOne({ where: { id: dto.zoneId, userId: uid } });
      if (!zone) throw new NotFoundException('구역을 찾을 수 없습니다');
      row.zoneId = dto.zoneId;
    }
    if (dto.taskTypeId !== undefined) {
      const tt = await this.taskTypeRepo.findOne({ where: { id: dto.taskTypeId, userId: uid } });
      if (!tt) throw new NotFoundException('작업 종류를 찾을 수 없습니다');
      row.taskTypeId = dto.taskTypeId;
    }
    if (dto.workerId !== undefined) row.workerId = dto.workerId ?? null;
    if (dto.doneAt !== undefined) row.doneAt = new Date(dto.doneAt);
    if (dto.note !== undefined) row.note = dto.note ?? null;
    if (dto.qty !== undefined) row.qty = dto.qty ?? null;

    return this.logRepo.save(row);
  }

  async deleteLog(
    user: { id: string; role: string; parentUserId?: string | null },
    id: string,
  ): Promise<{ ok: true }> {
    const uid = effectiveUserId(user);
    const row = await this.logRepo.findOne({ where: { id, userId: uid } });
    if (!row) throw new NotFoundException('기록을 찾을 수 없습니다');
    await this.logRepo.remove(row);
    return { ok: true };
  }

  async listLogs(
    user: { id: string; role: string; parentUserId?: string | null },
    q: WorkLogListQueryDto,
  ): Promise<WorkLog[]> {
    const uid = effectiveUserId(user);
    const where: any = { userId: uid };
    if (q.zoneId) where.zoneId = q.zoneId;
    if (q.taskTypeId) where.taskTypeId = q.taskTypeId;
    if (q.from && q.to) where.doneAt = Between(new Date(q.from), new Date(q.to));
    return this.logRepo.find({
      where,
      order: { doneAt: 'DESC' },
      take: q.limit ?? 200,
    });
  }

  // 월 단위 달력용 — 한 달치 logs 조회
  async listLogsByMonth(
    user: { id: string; role: string; parentUserId?: string | null },
    month: string,
  ): Promise<WorkLog[]> {
    const uid = effectiveUserId(user);
    const [yyyy, mm] = month.split('-').map(Number);
    const from = new Date(yyyy, mm - 1, 1);
    const to = new Date(yyyy, mm, 1);
    return this.logRepo.find({
      where: { userId: uid, doneAt: Between(from, to) },
      order: { doneAt: 'ASC' },
    });
  }

  // 보드 — 구역×작업종류 마지막 기록
  async boardMatrix(
    user: { id: string; role: string; parentUserId?: string | null },
  ): Promise<
    {
      zoneId: string;
      taskTypeId: string;
      lastDoneAt: string;
    }[]
  > {
    const uid = effectiveUserId(user);
    const rows = await this.logRepo
      .createQueryBuilder('l')
      .select('l.zone_id', 'zoneId')
      .addSelect('l.task_type_id', 'taskTypeId')
      .addSelect('MAX(l.done_at)', 'lastDoneAt')
      .where('l.user_id = :uid', { uid })
      .groupBy('l.zone_id')
      .addGroupBy('l.task_type_id')
      .getRawMany<{ zoneId: string; taskTypeId: string; lastDoneAt: Date }>();
    return rows.map((r) => ({
      zoneId: r.zoneId,
      taskTypeId: r.taskTypeId,
      lastDoneAt: r.lastDoneAt instanceof Date ? r.lastDoneAt.toISOString() : String(r.lastDoneAt),
    }));
  }
}
