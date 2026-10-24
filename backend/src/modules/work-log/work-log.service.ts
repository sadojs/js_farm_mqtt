import {
  BadRequestException,
  ConflictException,
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
  /**
   * 기본 작업 종류는 농장마다 최초 1회만 만든다(users.work_types_seeded_at 표시, migration 054).
   * 이전: 화면을 열 때마다 없는 기본 작업을 다시 만들어 삭제해도 되살아났다.
   */
  private async ensureStandardSeed(userId: string): Promise<void> {
    const [row] = await this.userRepo.query(
      'SELECT work_types_seeded_at FROM users WHERE id::text = $1', [userId],
    );
    if (!row || row.work_types_seeded_at) return;
    const existing = await this.taskTypeRepo.count({ where: { userId } });
    if (existing === 0) {
      await this.taskTypeRepo.save(STANDARD_WORK_TASK_TYPES.map((s) =>
        this.taskTypeRepo.create({
          userId,
          label: s.label,
          emoji: s.emoji,
          color: s.color,
          isStandard: true,
          displayOrder: s.order,
        }),
      ));
    }
    await this.userRepo.query('UPDATE users SET work_types_seeded_at = now() WHERE id::text = $1', [userId]);
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

  /**
   * 작업 종류 삭제 — 기본 작업(하엽 제거 등)도 삭제 가능.
   * 이 작업으로 남긴 기록이 있으면 withLogs=true 일 때만 기록과 함께 삭제(아니면 409 + 건수 → 화면이 경고 후 재요청).
   */
  async deleteTaskType(
    user: { id: string; role: string; parentUserId?: string | null },
    id: string,
    withLogs = false,
  ): Promise<{ ok: true; deletedLogs: number }> {
    if (user.role === 'farm_user') {
      throw new ForbiddenException('작업 종류 삭제는 농장 관리자만 가능합니다');
    }
    const uid = effectiveUserId(user);
    const row = await this.taskTypeRepo.findOne({ where: { id, userId: uid } });
    if (!row) throw new NotFoundException('작업 종류를 찾을 수 없습니다');
    const usedCount = await this.logRepo.count({ where: { taskTypeId: id, userId: uid } });
    if (usedCount > 0 && !withLogs) {
      throw new ConflictException({
        code: 'TASK_TYPE_IN_USE',
        count: usedCount,
        message: `"${row.label}" 작업으로 남긴 기록이 ${usedCount}건 있습니다. 삭제하면 이 기록도 함께 삭제됩니다.`,
      });
    }
    // 기록 → 작업 순서로 한 트랜잭션에서 (work_logs.task_type_id 는 RESTRICT)
    await this.logRepo.manager.transaction(async (m) => {
      if (usedCount > 0) await m.delete(WorkLog, { taskTypeId: id, userId: uid });
      await m.delete(WorkTaskType, { id, userId: uid });
    });
    return { ok: true, deletedLogs: usedCount };
  }

  /** 농작업 초기화 — 이 농장의 농작업 기록 전부 삭제(작업 종류는 유지). 농장 관리자만 */
  async resetLogs(user: { id: string; role: string; parentUserId?: string | null }): Promise<{ ok: true; deleted: number }> {
    if (user.role === 'farm_user') {
      throw new ForbiddenException('농작업 초기화는 농장 관리자만 가능합니다');
    }
    const uid = effectiveUserId(user);
    const res = await this.logRepo.delete({ userId: uid });
    return { ok: true, deleted: res.affected ?? 0 };
  }

  // ───── logs ─────

  /** 같은 날(한국 시간 기준)·같은 구역·같은 작업 중복 기록 존재 여부 */
  private async hasSameDayDuplicate(
    uid: string,
    zoneId: string,
    taskTypeId: string,
    doneAt: Date,
    excludeId?: string,
  ): Promise<boolean> {
    const qb = this.logRepo
      .createQueryBuilder('l')
      .where('l.user_id = :uid', { uid })
      .andWhere('l.zone_id = :zoneId', { zoneId })
      .andWhere('l.task_type_id = :taskTypeId', { taskTypeId })
      .andWhere(
        "date_trunc('day', l.done_at AT TIME ZONE 'Asia/Seoul') = date_trunc('day', :doneAt::timestamptz AT TIME ZONE 'Asia/Seoul')",
        { doneAt: doneAt.toISOString() },
      );
    if (excludeId) qb.andWhere('l.id <> :excludeId', { excludeId });
    return (await qb.getCount()) > 0;
  }

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
    const doneAt = dto.doneAt ? new Date(dto.doneAt) : new Date();
    if (await this.hasSameDayDuplicate(uid, dto.zoneId, dto.taskTypeId, doneAt)) {
      throw new ConflictException('이미 같은 날 같은 구역·작업이 기록되어 있습니다.');
    }
    const row = this.logRepo.create({
      userId: uid,
      zoneId: dto.zoneId,
      taskTypeId: dto.taskTypeId,
      workerId: dto.workerId ?? null,
      doneAt,
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

    // 변경 결과가 같은 날·구역·작업 중복이 되면 차단(자기 자신 제외)
    if (await this.hasSameDayDuplicate(uid, row.zoneId, row.taskTypeId, row.doneAt, row.id)) {
      throw new ConflictException('해당 날짜에 같은 구역·작업 기록이 이미 있습니다.');
    }

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
