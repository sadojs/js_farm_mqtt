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
function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}
function num(v: any): number {
  return typeof v === 'number' ? v : parseFloat(v ?? 0) || 0;
}
function daysBetween(start: string, end: string): number {
  return Math.round(
    (parseDate(end).getTime() - parseDate(start).getTime()) / 86400000,
  );
}

/**
 * 고정공제 일할 계산.
 * - prorate=false → 그대로
 * - 그 달 1일~말일 전체와 실제 근무 가능 일수(입사·퇴사·정산기간 교집합) 비율
 * - prorationReason 은 JSON 직렬화 — 프론트에서 i18n 으로 조합
 */
function prorateAmount(
  baseAmount: number,
  prorate: boolean,
  periodStart: string,
  periodEnd: string,
  worker: { startDate: string; endDate: string | null },
): { amount: number; prorationReason: string | null } {
  if (!prorate) return { amount: baseAmount, prorationReason: null };

  const ps = parseDate(periodStart);
  const monthStart = fmt(
    new Date(Date.UTC(ps.getUTCFullYear(), ps.getUTCMonth(), 1)),
  );
  const monthEnd = fmt(
    new Date(Date.UTC(ps.getUTCFullYear(), ps.getUTCMonth() + 1, 0)),
  );
  const monthDays = daysBetween(monthStart, monthEnd) + 1;

  const wStart = worker.startDate.slice(0, 10);
  const wEnd = worker.endDate ? worker.endDate.slice(0, 10) : null;
  const effStart = wStart > monthStart ? wStart : monthStart;
  const effEnd = wEnd && wEnd < monthEnd ? wEnd : monthEnd;

  if (effStart > effEnd) {
    // 그 달에 근무 일자가 전혀 없음 (퇴사 후 정산 시도 등)
    return {
      amount: 0,
      prorationReason: JSON.stringify({ key: 'prorationReason', noOverlap: true }),
    };
  }
  const effDays = daysBetween(effStart, effEnd) + 1;
  if (effDays >= monthDays) {
    return { amount: baseAmount, prorationReason: null };
  }
  const amount = Math.round((baseAmount * effDays) / monthDays);
  return {
    amount,
    prorationReason: JSON.stringify({
      key: 'prorationReason',
      base: baseAmount,
      days: effDays,
      total: monthDays,
      entryInMonth: effStart > monthStart ? effStart : null,
      exitInMonth: effEnd < monthEnd ? effEnd : null,
    }),
  };
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
        mustChangePassword: true,
      } as any);

      return this.dataSource.transaction(async (manager) => {
        const worker = await manager.save(
          manager.create(Worker, {
            userId: ownerId,
            accountUserId: account.id,
            name: dto.name,
            phone: dto.phone ?? null,
            startDate: dto.startDate,
            endDate: dto.endDate || null,
            salaryType: dto.salaryType ?? 'hourly',
            hourlyWage: dto.hourlyWage,
            fixedMonthlySalary: dto.fixedMonthlySalary ?? 0,
            settlementCycleType: dto.settlementCycleType ?? 'calendar_month',
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
        // endDate 는 '' 또는 null 이면 명시적으로 해제, undefined 면 기존 유지
        endDate: dto.endDate === undefined ? found.endDate : (dto.endDate || null),
        salaryType: dto.salaryType ?? found.salaryType,
        hourlyWage: dto.hourlyWage,
        fixedMonthlySalary: dto.fixedMonthlySalary ?? found.fixedMonthlySalary,
        settlementCycleType: dto.settlementCycleType ?? found.settlementCycleType,
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
      const kind = d.kind === 'variable' ? 'variable' : 'fixed';
      await manager.save(
        manager.create(WorkerDeduction, {
          userId: ownerId,
          workerId,
          label: d.label,
          kind,
          // 변동 공제는 금액을 미리 정하지 않음(정산 시 입력)
          amount: kind === 'variable' ? 0 : d.amount,
          // 일할 옵션 — 고정공제만 의미. 변동은 false 로 고정(어차피 매달 입력)
          prorate: kind === 'variable' ? false : d.prorate !== false,
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

  /**
   * 정산 주기 = 매월 1일 ~ 말일 (달력 월 기준).
   * - 입사한 달(첫 정산): 입사일 ~ 그 달 말일 (예: 5/16 입사 → 5/16~5/31, 6/1부터 정산).
   * - 그 이후: 매월 1일 ~ 말일 (6/1~6/30, 7/1~7/31 …).
   *
   * ref 날짜가 속한 정산 기간의 '시작일'을 반환.
   */
  private currentPeriodStart(startDate: string, ref: string): string {
    const s = parseDate(startDate);
    const r = parseDate(ref);
    // 입사월(입사일과 같은 연·월)이면 입사일이 시작, 그 외엔 해당 월 1일
    if (
      r.getUTCFullYear() === s.getUTCFullYear() &&
      r.getUTCMonth() === s.getUTCMonth()
    ) {
      return fmt(s);
    }
    return fmt(new Date(Date.UTC(r.getUTCFullYear(), r.getUTCMonth(), 1)));
  }

  /** 정산일(= 다음 기간 시작) = 기간 시작이 속한 달의 '다음 달 1일'. */
  private nextAnchor(periodStart: string): string {
    const p = parseDate(periodStart);
    let y = p.getUTCFullYear();
    let m = p.getUTCMonth() + 1 + 1; // periodStart 월의 다음 달 (1-based)
    if (m === 13) {
      m = 1;
      y += 1;
    }
    return fmt(new Date(Date.UTC(y, m - 1, 1)));
  }

  /** 해당 연·월(0-based)에서 day 를 말일로 클램프 (예: 2월 31 → 28/29) */
  private clampDayInMonth(year: number, monthIdx0: number, day: number): number {
    const last = new Date(Date.UTC(year, monthIdx0 + 1, 0)).getUTCDate();
    return Math.min(day, last);
  }

  /**
   * anniversary 정산: 입사일의 '일(day)'을 앵커로, ref 가 속한 기간의 시작일 반환.
   * 예) 입사 5/6 → 앵커 6일. ref 6/3 → 5/6 시작, ref 6/6 → 6/6 시작.
   */
  private anniversaryPeriodStart(startDate: string, ref: string): string {
    const anchor = parseDate(startDate).getUTCDate();
    const r = parseDate(ref);
    let y = r.getUTCFullYear();
    let m = r.getUTCMonth();
    const thisMonthAnchor = this.clampDayInMonth(y, m, anchor);
    if (r.getUTCDate() >= thisMonthAnchor) {
      return fmt(new Date(Date.UTC(y, m, thisMonthAnchor)));
    }
    m -= 1;
    if (m < 0) {
      m = 11;
      y -= 1;
    }
    return fmt(new Date(Date.UTC(y, m, this.clampDayInMonth(y, m, anchor))));
  }

  /** anniversary 정산: periodStart 의 다음 앵커(= 정산일). periodStart + 1개월(앵커 day). */
  private anniversaryNextAnchor(startDate: string, periodStart: string): string {
    const anchor = parseDate(startDate).getUTCDate();
    const p = parseDate(periodStart);
    let y = p.getUTCFullYear();
    let m = p.getUTCMonth() + 1;
    if (m > 11) {
      m -= 12;
      y += 1;
    }
    return fmt(new Date(Date.UTC(y, m, this.clampDayInMonth(y, m, anchor))));
  }

  private periodStartFor(worker: Worker, ref: string): string {
    return worker.settlementCycleType === 'anniversary'
      ? this.anniversaryPeriodStart(worker.startDate, ref)
      : this.currentPeriodStart(worker.startDate, ref);
  }

  private nextAnchorFor(worker: Worker, periodStart: string): string {
    return worker.settlementCycleType === 'anniversary'
      ? this.anniversaryNextAnchor(worker.startDate, periodStart)
      : this.nextAnchor(periodStart);
  }

  private resolvePeriod(worker: Worker, periodStart?: string) {
    let ps = periodStart
      ? this.periodStartFor(worker, periodStart)
      : this.periodStartFor(worker, todayStr());

    const firstPeriod = this.periodStartFor(worker, worker.startDate);
    if (parseDate(ps).getTime() < parseDate(firstPeriod).getTime()) ps = firstPeriod;

    const settleDate = this.nextAnchorFor(worker, ps);
    const periodEnd = addDays(settleDate, -1);
    const prevPeriodStart = this.periodStartFor(worker, addDays(ps, -1));
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
    const workerEnd = worker.endDate ? worker.endDate.slice(0, 10) : null;
    while (cursor <= meta.periodEnd) {
      const beforeStart = cursor < worker.startDate;
      const afterEnd = !!workerEnd && cursor > workerEnd;
      const row = dayMap.get(cursor);
      let status = 'work';
      let hours = base;
      if (row) {
        status = row.status;
        hours = num(row.hours);
      }
      if (status === 'off') hours = 0;
      const effective = beforeStart || afterEnd ? 0 : hours;
      if (!beforeStart && !afterEnd && status === 'work') {
        workDays += 1;
        totalHours += effective;
      }
      days.push({
        date: cursor,
        beforeStart,
        terminated: afterEnd,
        status: beforeStart || afterEnd ? 'none' : status,
        hours: effective,
        advance: advMap.get(cursor) ?? 0,
      });
      cursor = addDays(cursor, 1);
    }

    const grossPay =
      worker.salaryType === 'fixed_monthly'
        ? this.prorateFixedSalary(
            worker.fixedMonthlySalary,
            meta.periodStart,
            meta.periodEnd,
            worker,
          ).amount
        : Math.round(totalHours * worker.hourlyWage);

    return {
      worker: this.workerBrief(worker),
      canEdit,
      ...meta,
      kpi: {
        workDays,
        totalHours,
        grossPay,
      },
      days,
    };
  }

  private workerBrief(worker: Worker) {
    return {
      id: worker.id,
      name: worker.name,
      startDate: worker.startDate,
      endDate: worker.endDate,
      hourlyWage: worker.hourlyWage,
      dailyHours: num(worker.dailyHours),
      salaryType: worker.salaryType,
      fixedMonthlySalary: worker.fixedMonthlySalary,
      settlementCycleType: worker.settlementCycleType,
    };
  }

  /**
   * 고정 월급 일할 계산 — periodStart~periodEnd 중 실제 재직일 비율.
   * 입·퇴사로 기간이 잘리지 않으면 전액. (달력월/anniversary 공통으로 기간 자체 기준)
   */
  private prorateFixedSalary(
    baseAmount: number,
    periodStart: string,
    periodEnd: string,
    worker: { startDate: string; endDate: string | null },
  ): { amount: number; prorationReason: string | null } {
    const totalDays = daysBetween(periodStart, periodEnd) + 1;
    const wStart = worker.startDate.slice(0, 10);
    const wEnd = worker.endDate ? worker.endDate.slice(0, 10) : null;
    const effStart = wStart > periodStart ? wStart : periodStart;
    const effEnd = wEnd && wEnd < periodEnd ? wEnd : periodEnd;
    if (effStart > effEnd) return { amount: 0, prorationReason: '재직 기간 아님' };
    const effDays = daysBetween(effStart, effEnd) + 1;
    if (effDays >= totalDays) return { amount: baseAmount, prorationReason: null };
    return {
      amount: Math.round((baseAmount * effDays) / totalDays),
      prorationReason: `${effDays}/${totalDays}일 일할`,
    };
  }

  // ──── 정산 영수증 계산 (라이브) ────

  private async computeReceipt(
    worker: Worker,
    meta: ReturnType<WorkerPayrollService['resolvePeriod']>,
    variableAmounts?: Record<string, number>,
  ) {
    const base = num(worker.dailyHours);
    const dayRows = await this.dayRepo.find({ where: { workerId: worker.id } });
    const dayMap = new Map(dayRows.map((o) => [o.date.slice(0, 10), o]));

    let workDays = 0;
    let totalHours = 0;
    let cursor = meta.periodStart;
    const workerEnd = worker.endDate ? worker.endDate.slice(0, 10) : null;
    while (cursor <= meta.periodEnd) {
      const beforeStart = cursor < worker.startDate;
      const afterEnd = !!workerEnd && cursor > workerEnd;
      const row = dayMap.get(cursor);
      let status = 'work';
      let hours = base;
      if (row) {
        status = row.status;
        hours = num(row.hours);
      }
      if (!beforeStart && !afterEnd && status === 'work') {
        workDays += 1;
        totalHours += hours;
      }
      cursor = addDays(cursor, 1);
    }

    // 급여: 시급(시간×시급) 또는 고정 월급(부분 기간은 일할)
    let grossPay: number;
    let grossProrationReason: string | null = null;
    if (worker.salaryType === 'fixed_monthly') {
      const r = this.prorateFixedSalary(
        worker.fixedMonthlySalary,
        meta.periodStart,
        meta.periodEnd,
        worker,
      );
      grossPay = r.amount;
      grossProrationReason = r.prorationReason;
    } else {
      grossPay = Math.round(totalHours * worker.hourlyWage);
    }

    const deductionRows = await this.deductionRepo.find({
      where: { workerId: worker.id },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
    const deductions = deductionRows.map((d) => {
      const kind = d.kind === 'variable' ? 'variable' : 'fixed';
      if (kind === 'variable') {
        return {
          label: d.label,
          kind,
          amount: Math.max(0, Math.round(variableAmounts?.[d.id] ?? 0)),
          prorationReason: null as string | null,
        };
      }
      // fixed — 일할 옵션 적용
      const { amount, prorationReason } = prorateAmount(
        d.amount,
        d.prorate !== false,
        meta.periodStart,
        meta.periodEnd,
        { startDate: worker.startDate, endDate: worker.endDate },
      );
      return { label: d.label, kind, amount, prorationReason };
    });
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
      salaryType: worker.salaryType,
      fixedMonthlySalary: worker.fixedMonthlySalary,
      grossProrationReason,
      grossPay,
      deductions,
      deductionTotal,
      advances,
      advanceTotal,
      netPay,
    };
  }

  /** 현재 변동 공제 항목 정의 (정산 입력 모달용) */
  private async variableDefs(workerId: string) {
    const rows = await this.deductionRepo.find({
      where: { workerId, kind: 'variable' },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
    return rows.map((d) => ({ id: d.id, label: d.label }));
  }

  // ──── 정산 조회 (확정/요청된 건 snapshot 박제) ────

  async getSettlement(user: any, workerId: string, periodStart?: string) {
    const { worker, canEdit } = await this.resolveWorker(user, workerId);
    const meta = this.resolvePeriod(worker, periodStart);
    const variableDeductions = await this.variableDefs(worker.id);

    const row = await this.settlementRepo.findOne({
      where: { workerId: worker.id, periodStart: meta.periodStart },
    });
    if (row) {
      // 박제된 스냅샷 그대로 반환 (이후 설정 변경 무관)
      return {
        ...(row.snapshot as any),
        status: row.status,
        frozen: true,
        canEdit,
        requestedAt: row.requestedAt,
        confirmedAt: row.confirmedAt,
        canRequest: false,
        canApprove: canEdit && row.status === 'requested',
        variableDeductions,
      };
    }

    const receipt = await this.computeReceipt(worker, meta);
    const ended = meta.settleDate <= todayStr();
    return {
      ...receipt,
      status: ended ? 'pending' : 'open',
      frozen: false,
      canEdit,
      requestedAt: null,
      confirmedAt: null,
      // 일꾼은 요청, 관리자는 직접 승인(직접 확정)
      canRequest: ended && !canEdit,
      canApprove: canEdit && ended,
      variableDeductions,
    };
  }

  /** 정산 확정 요청 (일꾼 또는 관리자) — 정산일 경과 시 snapshot 박제 + status='requested' */
  async requestSettlement(
    user: any,
    workerId: string,
    periodStart?: string,
    variableAmounts?: Record<string, number>,
  ) {
    const { worker } = await this.resolveWorker(user, workerId);
    const meta = this.resolvePeriod(worker, periodStart);
    if (meta.settleDate > todayStr()) {
      throw new BadRequestException('아직 정산일이 지나지 않았습니다.');
    }
    const existing = await this.settlementRepo.findOne({
      where: { workerId: worker.id, periodStart: meta.periodStart },
    });
    if (existing) return existing;

    const receipt = await this.computeReceipt(worker, meta, variableAmounts);
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

  /** 정산 승인 (관리자) — 변동 금액 입력 시 스냅샷 재계산 후 확정 */
  async approveSettlement(
    ownerId: string,
    workerId: string,
    periodStart?: string,
    variableAmounts?: Record<string, number>,
  ) {
    const worker = await this.findOwnedWorker(ownerId, workerId);
    const meta = this.resolvePeriod(worker, periodStart);
    let row = await this.settlementRepo.findOne({
      where: { workerId: worker.id, periodStart: meta.periodStart },
    });
    if (!row) {
      if (meta.settleDate > todayStr()) {
        throw new BadRequestException('아직 정산일이 지나지 않았습니다.');
      }
      const receipt = await this.computeReceipt(worker, meta, variableAmounts);
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
    } else if (variableAmounts) {
      // 확정 전이므로 변동 금액 재입력 반영하여 스냅샷 재계산
      const receipt = await this.computeReceipt(worker, meta, variableAmounts);
      row.snapshot = receipt;
      row.netPay = receipt.netPay;
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
