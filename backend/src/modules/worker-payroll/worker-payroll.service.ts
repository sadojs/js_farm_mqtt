import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, In } from 'typeorm';
import { Worker } from './entities/worker.entity';
import { WorkerDeduction } from './entities/worker-deduction.entity';
import { WorkerAdvance } from './entities/worker-advance.entity';
import { WorkerDayOverride } from './entities/worker-day-override.entity';
import { WorkerSettlement } from './entities/worker-settlement.entity';
import { SaveWorkerDto } from './dto/worker.dto';
import { UpsertAdvanceDto } from './dto/advance.dto';
import { SetDayDto } from './dto/day-override.dto';
import { UsersService } from '../users/users.service';

// ──── 날짜 헬퍼 (date-only, UTC) ────
function parseDate(s: string): Date {
  return new Date(`${s.slice(0, 10)}T00:00:00.000Z`);
}
function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function addDays(s: string, days: number): string {
  const d = parseDate(s);
  d.setUTCDate(d.getUTCDate() + days);
  return fmt(d);
}
function daysInMonth(y: number, m1: number): number {
  return new Date(Date.UTC(y, m1, 0)).getUTCDate();
}
function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}
function num(v: any): number {
  return typeof v === 'number' ? v : parseFloat(v ?? 0) || 0;
}

const MANAGER_ROLES = ['admin', 'farm_admin'];

@Injectable()
export class WorkerPayrollService {
  constructor(
    @InjectRepository(Worker)
    private readonly workerRepo: Repository<Worker>,
    @InjectRepository(WorkerDeduction)
    private readonly deductionRepo: Repository<WorkerDeduction>,
    @InjectRepository(WorkerAdvance)
    private readonly advanceRepo: Repository<WorkerAdvance>,
    @InjectRepository(WorkerDayOverride)
    private readonly dayRepo: Repository<WorkerDayOverride>,
    @InjectRepository(WorkerSettlement)
    private readonly settlementRepo: Repository<WorkerSettlement>,
    private readonly dataSource: DataSource,
    private readonly usersService: UsersService,
  ) {}

  // ──── 스코프 / 권한 ────

  private ownerId(user: any): string {
    return user.role === 'farm_user' && user.parentUserId ? user.parentUserId : user.id;
  }
  private isManager(user: any): boolean {
    return MANAGER_ROLES.includes(user.role);
  }

  /** workerId 에 대한 접근 권한 확인 후 worker 반환 (+편집 가능 여부) */
  private async resolveWorker(
    user: any,
    workerId: string,
  ): Promise<{ worker: Worker; canEdit: boolean }> {
    const worker = await this.workerRepo.findOne({ where: { id: workerId } });
    if (!worker) throw new NotFoundException('일꾼을 찾을 수 없습니다.');
    if (this.isManager(user)) {
      if (worker.userId !== this.ownerId(user)) throw new ForbiddenException();
      return { worker, canEdit: true };
    }
    // farm_user(일꾼): 본인 계정과 연결된 프로필만, 읽기 전용
    if (worker.accountUserId !== user.id) throw new ForbiddenException();
    return { worker, canEdit: false };
  }

  private async findOwnedWorker(ownerId: string, id: string): Promise<Worker> {
    const worker = await this.workerRepo.findOne({ where: { id } });
    if (!worker) throw new NotFoundException('일꾼을 찾을 수 없습니다.');
    if (worker.userId !== ownerId) throw new ForbiddenException();
    return worker;
  }

  private async usernameMap(ids: string[]): Promise<Record<string, string>> {
    const valid = ids.filter(Boolean);
    if (valid.length === 0) return {};
    const rows: { id: string; username: string }[] = await this.dataSource.query(
      `SELECT id, username FROM users WHERE id = ANY($1)`,
      [valid],
    );
    return Object.fromEntries(rows.map((r) => [r.id, r.username]));
  }

  // ──── 일꾼 목록 / 본인 ────

  async listWorkers(ownerId: string) {
    const workers = await this.workerRepo.find({
      where: { userId: ownerId, isActive: true },
      order: { createdAt: 'ASC' },
    });
    if (workers.length === 0) return [];
    const deductions = await this.deductionRepo.find({
      where: { userId: ownerId, workerId: In(workers.map((w) => w.id)) },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
    const unames = await this.usernameMap(
      workers.map((w) => w.accountUserId).filter(Boolean) as string[],
    );
    return workers.map((w) => ({
      ...w,
      dailyHours: num(w.dailyHours),
      username: w.accountUserId ? unames[w.accountUserId] ?? null : null,
      deductions: deductions.filter((d) => d.workerId === w.id),
    }));
  }

  /** farm_user 본인 프로필 (없으면 null) */
  async getMyWorker(accountUserId: string) {
    const worker = await this.workerRepo.findOne({
      where: { accountUserId, isActive: true },
    });
    if (!worker) return null;
    return { ...worker, dailyHours: num(worker.dailyHours) };
  }

  async getWorker(user: any, id: string) {
    const { worker } = await this.resolveWorker(user, id);
    const deductions = await this.deductionRepo.find({
      where: { workerId: id },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
    const unames = worker.accountUserId
      ? await this.usernameMap([worker.accountUserId])
      : {};
    return {
      ...worker,
      dailyHours: num(worker.dailyHours),
      username: worker.accountUserId ? unames[worker.accountUserId] ?? null : null,
      deductions,
    };
  }

  // ──── 일꾼 저장 (신규 등록 시 farm_user 계정 발급) ────

  async saveWorker(ownerId: string, dto: SaveWorkerDto) {
    // 신규 등록: 로그인 계정 함께 생성
    if (!dto.id) {
      if (!dto.username || !dto.password) {
        throw new BadRequestException('아이디와 임시 비밀번호를 입력해 주세요.');
      }
      const account = await this.usersService.create({
        username: dto.username,
        password: dto.password,
        name: dto.name,
        role: 'farm_user',
        parentUserId: ownerId,
      } as any);

      return this.dataSource.transaction(async (manager) => {
        const worker = await manager.save(
          manager.create(Worker, {
            userId: ownerId,
            accountUserId: account.id,
            name: dto.name,
            phone: dto.phone ?? null,
            startDate: dto.startDate,
            hourlyWage: dto.hourlyWage,
            dailyHours: dto.dailyHours,
            isActive: true,
          }),
        );
        await this.replaceDeductions(manager, ownerId, worker.id, dto.deductions);
        return { ...worker, username: account.username };
      });
    }

    // 수정: 계정 필드 무시, 근무조건/공제만 갱신
    return this.dataSource.transaction(async (manager) => {
      const found = await manager.findOne(Worker, { where: { id: dto.id } });
      if (!found) throw new NotFoundException('일꾼을 찾을 수 없습니다.');
      if (found.userId !== ownerId) throw new ForbiddenException();
      Object.assign(found, {
        name: dto.name,
        phone: dto.phone ?? found.phone,
        startDate: dto.startDate,
        hourlyWage: dto.hourlyWage,
        dailyHours: dto.dailyHours,
        isActive: dto.isActive ?? true,
      });
      const worker = await manager.save(found);
      if (dto.deductions) {
        await this.replaceDeductions(manager, ownerId, worker.id, dto.deductions);
      }
      return worker;
    });
  }

  private async replaceDeductions(
    manager: import('typeorm').EntityManager,
    ownerId: string,
    workerId: string,
    deductions?: SaveWorkerDto['deductions'],
  ) {
    if (!deductions) return;
    await manager.delete(WorkerDeduction, { workerId });
    let idx = 0;
    for (const d of deductions) {
      await manager.save(
        manager.create(WorkerDeduction, {
          userId: ownerId,
          workerId,
          label: d.label,
          amount: d.amount,
          sortOrder: d.sortOrder ?? idx,
        }),
      );
      idx += 1;
    }
  }

  async removeWorker(ownerId: string, id: string) {
    const worker = await this.findOwnedWorker(ownerId, id);
    worker.isActive = false;
    await this.workerRepo.save(worker);
  }

  // ──── 가불 ────

  async listAdvances(user: any, workerId: string) {
    await this.resolveWorker(user, workerId);
    return this.advanceRepo.find({ where: { workerId }, order: { date: 'ASC' } });
  }

  async addAdvance(ownerId: string, workerId: string, dto: UpsertAdvanceDto) {
    const worker = await this.findOwnedWorker(ownerId, workerId);
    return this.advanceRepo.save(
      this.advanceRepo.create({
        userId: worker.userId,
        workerId,
        date: dto.date,
        amount: dto.amount,
        note: dto.note ?? null,
      }),
    );
  }

  async removeAdvance(ownerId: string, id: string) {
    const adv = await this.advanceRepo.findOne({ where: { id } });
    if (!adv) throw new NotFoundException('가불 내역을 찾을 수 없습니다.');
    if (adv.userId !== ownerId) throw new ForbiddenException();
    await this.advanceRepo.delete({ id });
  }

  // ──── 일자 근무 설정 (관리자) ────

  async setDay(ownerId: string, workerId: string, dto: SetDayDto) {
    const worker = await this.findOwnedWorker(ownerId, workerId);
    const base = num(worker.dailyHours);
    let row = await this.dayRepo.findOne({ where: { workerId, date: dto.date } });

    if (dto.status === 'work') {
      const hours = dto.hours ?? base;
      // 기본 근무시간과 같으면 조정행 삭제(기본값 복원)
      if (hours === base) {
        if (row) await this.dayRepo.delete({ id: row.id });
        return { date: dto.date, status: 'work', hours: base };
      }
      if (!row) row = this.dayRepo.create({ userId: worker.userId, workerId, date: dto.date });
      row.status = 'work';
      row.hours = hours;
      return this.dayRepo.save(row);
    }

    // off (휴일)
    if (!row) row = this.dayRepo.create({ userId: worker.userId, workerId, date: dto.date });
    row.status = 'off';
    row.hours = 0;
    return this.dayRepo.save(row);
  }

  // ──── 정산 주기 계산 ────

  private currentPeriodStart(startDate: string, ref: string): string {
    const anchorDay = parseDate(startDate).getUTCDate();
    const r = parseDate(ref);
    let y = r.getUTCFullYear();
    let m = r.getUTCMonth() + 1;
    const dim = daysInMonth(y, m);
    const anchorThisMonth = Math.min(anchorDay, dim);
    if (r.getUTCDate() >= anchorThisMonth) {
      return fmt(new Date(Date.UTC(y, m - 1, anchorThisMonth)));
    }
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
    const prevAnchor = Math.min(anchorDay, daysInMonth(y, m));
    return fmt(new Date(Date.UTC(y, m - 1, prevAnchor)));
  }

  private nextAnchor(startDate: string, periodStart: string): string {
    const anchorDay = parseDate(startDate).getUTCDate();
    const p = parseDate(periodStart);
    let y = p.getUTCFullYear();
    let m = p.getUTCMonth() + 1 + 1;
    if (m === 13) {
      m = 1;
      y += 1;
    }
    const day = Math.min(anchorDay, daysInMonth(y, m));
    return fmt(new Date(Date.UTC(y, m - 1, day)));
  }

  private resolvePeriod(worker: Worker, periodStart?: string) {
    let ps = periodStart
      ? this.currentPeriodStart(worker.startDate, periodStart)
      : this.currentPeriodStart(worker.startDate, todayStr());

    const firstPeriod = this.currentPeriodStart(worker.startDate, worker.startDate);
    if (parseDate(ps).getTime() < parseDate(firstPeriod).getTime()) ps = firstPeriod;

    const settleDate = this.nextAnchor(worker.startDate, ps);
    const periodEnd = addDays(settleDate, -1);
    const prevPeriodStart = this.currentPeriodStart(worker.startDate, addDays(ps, -1));
    const isFirst = parseDate(ps).getTime() <= parseDate(firstPeriod).getTime();
    return {
      periodStart: ps,
      periodEnd,
      settleDate,
      nextPeriodStart: settleDate,
      prevPeriodStart: isFirst ? null : prevPeriodStart,
    };
  }

  // ──── 근무 달력 ────

  async getCalendar(user: any, workerId: string, periodStart?: string) {
    const { worker, canEdit } = await this.resolveWorker(user, workerId);
    const meta = this.resolvePeriod(worker, periodStart);
    const base = num(worker.dailyHours);

    const dayRows = await this.dayRepo.find({ where: { workerId } });
    const dayMap = new Map(dayRows.map((o) => [o.date.slice(0, 10), o]));
    const advances = await this.advanceRepo.find({ where: { workerId } });
    const advMap = new Map<string, number>();
    for (const a of advances) {
      const d = a.date.slice(0, 10);
      if (d >= meta.periodStart && d <= meta.periodEnd) {
        advMap.set(d, (advMap.get(d) ?? 0) + a.amount);
      }
    }

    const days: any[] = [];
    let cursor = meta.periodStart;
    let workDays = 0;
    let totalHours = 0;
    while (cursor <= meta.periodEnd) {
      const beforeStart = cursor < worker.startDate;
      const row = dayMap.get(cursor);
      let status = 'work';
      let hours = base;
      if (row) {
        status = row.status;
        hours = num(row.hours);
      }
      if (status === 'off') hours = 0;
      const effective = beforeStart ? 0 : hours;
      if (!beforeStart && status === 'work') {
        workDays += 1;
        totalHours += effective;
      }
      days.push({
        date: cursor,
        beforeStart,
        status: beforeStart ? 'none' : status,
        hours: effective,
        advance: advMap.get(cursor) ?? 0,
      });
      cursor = addDays(cursor, 1);
    }

    return {
      worker: this.workerBrief(worker),
      canEdit,
      ...meta,
      kpi: {
        workDays,
        totalHours,
        grossPay: Math.round(totalHours * worker.hourlyWage),
      },
      days,
    };
  }

  private workerBrief(worker: Worker) {
    return {
      id: worker.id,
      name: worker.name,
      startDate: worker.startDate,
      hourlyWage: worker.hourlyWage,
      dailyHours: num(worker.dailyHours),
    };
  }

  // ──── 정산 영수증 계산 (라이브) ────

  private async computeReceipt(worker: Worker, meta: ReturnType<WorkerPayrollService['resolvePeriod']>) {
    const base = num(worker.dailyHours);
    const dayRows = await this.dayRepo.find({ where: { workerId: worker.id } });
    const dayMap = new Map(dayRows.map((o) => [o.date.slice(0, 10), o]));

    let workDays = 0;
    let totalHours = 0;
    let cursor = meta.periodStart;
    while (cursor <= meta.periodEnd) {
      const beforeStart = cursor < worker.startDate;
      const row = dayMap.get(cursor);
      let status = 'work';
      let hours = base;
      if (row) {
        status = row.status;
        hours = num(row.hours);
      }
      if (!beforeStart && status === 'work') {
        workDays += 1;
        totalHours += hours;
      }
      cursor = addDays(cursor, 1);
    }

    const grossPay = Math.round(totalHours * worker.hourlyWage);

    const deductionRows = await this.deductionRepo.find({
      where: { workerId: worker.id },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
    const deductions = deductionRows.map((d) => ({ label: d.label, amount: d.amount }));
    const deductionTotal = deductions.reduce((s, d) => s + d.amount, 0);

    const advanceRows = await this.advanceRepo.find({
      where: { workerId: worker.id },
      order: { date: 'ASC' },
    });
    const advances = advanceRows
      .filter((a) => a.date.slice(0, 10) >= meta.periodStart && a.date.slice(0, 10) <= meta.periodEnd)
      .map((a) => ({ date: a.date, amount: a.amount, note: a.note }));
    const advanceTotal = advances.reduce((s, a) => s + a.amount, 0);

    const netPay = grossPay - deductionTotal - advanceTotal;

    return {
      worker: this.workerBrief(worker),
      ...meta,
      workDays,
      totalHours,
      hourlyWage: worker.hourlyWage,
      grossPay,
      deductions,
      deductionTotal,
      advances,
      advanceTotal,
      netPay,
    };
  }

  // ──── 정산 조회 (확정/요청된 건 snapshot 박제) ────

  async getSettlement(user: any, workerId: string, periodStart?: string) {
    const { worker, canEdit } = await this.resolveWorker(user, workerId);
    const meta = this.resolvePeriod(worker, periodStart);

    const row = await this.settlementRepo.findOne({
      where: { workerId: worker.id, periodStart: meta.periodStart },
    });
    if (row) {
      // 박제된 스냅샷 그대로 반환 (이후 설정 변경 무관)
      return {
        ...(row.snapshot as any),
        status: row.status,
        frozen: true,
        requestedAt: row.requestedAt,
        confirmedAt: row.confirmedAt,
        canRequest: false,
        canApprove: canEdit && row.status === 'requested',
      };
    }

    const receipt = await this.computeReceipt(worker, meta);
    const ended = meta.settleDate <= todayStr();
    return {
      ...receipt,
      status: ended ? 'pending' : 'open',
      frozen: false,
      requestedAt: null,
      confirmedAt: null,
      // 일꾼은 요청, 관리자는 직접 승인(직접 확정)
      canRequest: ended && !canEdit,
      canApprove: canEdit && ended,
    };
  }

  /** 정산 확정 요청 (일꾼 또는 관리자) — 정산일 경과 시 snapshot 박제 + status='requested' */
  async requestSettlement(user: any, workerId: string, periodStart?: string) {
    const { worker } = await this.resolveWorker(user, workerId);
    const meta = this.resolvePeriod(worker, periodStart);
    if (meta.settleDate > todayStr()) {
      throw new BadRequestException('아직 정산일이 지나지 않았습니다.');
    }
    const existing = await this.settlementRepo.findOne({
      where: { workerId: worker.id, periodStart: meta.periodStart },
    });
    if (existing) return existing;

    const receipt = await this.computeReceipt(worker, meta);
    return this.settlementRepo.save(
      this.settlementRepo.create({
        userId: worker.userId,
        workerId: worker.id,
        periodStart: meta.periodStart,
        periodEnd: meta.periodEnd,
        settleDate: meta.settleDate,
        snapshot: receipt,
        netPay: receipt.netPay,
        status: 'requested',
        requestedAt: new Date(),
      }),
    );
  }

  /** 정산 승인 (관리자) — 요청이 없으면 즉시 박제 후 확정 */
  async approveSettlement(ownerId: string, workerId: string, periodStart?: string) {
    const worker = await this.findOwnedWorker(ownerId, workerId);
    const meta = this.resolvePeriod(worker, periodStart);
    let row = await this.settlementRepo.findOne({
      where: { workerId: worker.id, periodStart: meta.periodStart },
    });
    if (!row) {
      if (meta.settleDate > todayStr()) {
        throw new BadRequestException('아직 정산일이 지나지 않았습니다.');
      }
      const receipt = await this.computeReceipt(worker, meta);
      row = this.settlementRepo.create({
        userId: worker.userId,
        workerId: worker.id,
        periodStart: meta.periodStart,
        periodEnd: meta.periodEnd,
        settleDate: meta.settleDate,
        snapshot: receipt,
        netPay: receipt.netPay,
        status: 'requested',
        requestedAt: new Date(),
      });
    }
    row.status = 'confirmed';
    row.confirmedAt = new Date();
    return this.settlementRepo.save(row);
  }

  /** 정산 이력 (관리자) — 농장 전체 + 일꾼명 */
  async listSettlements(ownerId: string) {
    const rows = await this.settlementRepo.find({
      where: { userId: ownerId },
      order: { settleDate: 'DESC' },
    });
    const workers = await this.workerRepo.find({ where: { userId: ownerId } });
    const nameMap = Object.fromEntries(workers.map((w) => [w.id, w.name]));
    return rows.map((r) => ({
      id: r.id,
      workerId: r.workerId,
      workerName: nameMap[r.workerId] ?? '—',
      periodStart: r.periodStart,
      periodEnd: r.periodEnd,
      settleDate: r.settleDate,
      status: r.status,
      netPay: r.netPay,
      requestedAt: r.requestedAt,
      confirmedAt: r.confirmedAt,
      snapshot: r.snapshot,
    }));
  }
}
