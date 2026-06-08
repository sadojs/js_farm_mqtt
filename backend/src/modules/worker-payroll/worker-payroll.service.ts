import {
  Injectable,
  NotFoundException,
  ForbiddenException,
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
import { SetDayOverrideDto } from './dto/day-override.dto';

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
  // m1: 1~12
  return new Date(Date.UTC(y, m1, 0)).getUTCDate();
}
function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}
function num(v: any): number {
  return typeof v === 'number' ? v : parseFloat(v ?? 0) || 0;
}

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
    private readonly overrideRepo: Repository<WorkerDayOverride>,
    @InjectRepository(WorkerSettlement)
    private readonly settlementRepo: Repository<WorkerSettlement>,
    private readonly dataSource: DataSource,
  ) {}

  // ──── 일꾼 CRUD ────

  async listWorkers(userId: string) {
    const workers = await this.workerRepo.find({
      where: { userId, isActive: true },
      order: { createdAt: 'ASC' },
    });
    if (workers.length === 0) return [];
    const deductions = await this.deductionRepo.find({
      where: { userId, workerId: In(workers.map((w) => w.id)) },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
    return workers.map((w) => ({
      ...w,
      dailyHours: num(w.dailyHours),
      deductions: deductions.filter((d) => d.workerId === w.id),
    }));
  }

  async getWorker(userId: string, id: string) {
    const worker = await this.findOwnedWorker(userId, id);
    const deductions = await this.deductionRepo.find({
      where: { userId, workerId: id },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
    return { ...worker, dailyHours: num(worker.dailyHours), deductions };
  }

  async saveWorker(userId: string, dto: SaveWorkerDto) {
    return this.dataSource.transaction(async (manager) => {
      let worker: Worker;
      if (dto.id) {
        const found = await manager.findOne(Worker, { where: { id: dto.id } });
        if (!found) throw new NotFoundException('일꾼을 찾을 수 없습니다.');
        if (found.userId !== userId) throw new ForbiddenException();
        worker = found;
      } else {
        worker = manager.create(Worker, { userId });
      }
      Object.assign(worker, {
        name: dto.name,
        startDate: dto.startDate,
        hourlyWage: dto.hourlyWage,
        dailyHours: dto.dailyHours,
        isActive: dto.isActive ?? true,
      });
      worker = await manager.save(worker);

      if (dto.deductions) {
        await manager.delete(WorkerDeduction, { workerId: worker.id });
        let idx = 0;
        for (const d of dto.deductions) {
          await manager.save(
            manager.create(WorkerDeduction, {
              userId,
              workerId: worker.id,
              label: d.label,
              amount: d.amount,
              sortOrder: d.sortOrder ?? idx,
            }),
          );
          idx += 1;
        }
      }
      return worker;
    });
  }

  async removeWorker(userId: string, id: string) {
    const worker = await this.findOwnedWorker(userId, id);
    worker.isActive = false;
    await this.workerRepo.save(worker);
  }

  // ──── 가불 ────

  async listAdvances(userId: string, workerId: string) {
    await this.findOwnedWorker(userId, workerId);
    return this.advanceRepo.find({
      where: { userId, workerId },
      order: { date: 'ASC' },
    });
  }

  async addAdvance(userId: string, workerId: string, dto: UpsertAdvanceDto) {
    await this.findOwnedWorker(userId, workerId);
    return this.advanceRepo.save(
      this.advanceRepo.create({
        userId,
        workerId,
        date: dto.date,
        amount: dto.amount,
        note: dto.note ?? null,
      }),
    );
  }

  async removeAdvance(userId: string, id: string) {
    const adv = await this.advanceRepo.findOne({ where: { id } });
    if (!adv) throw new NotFoundException('가불 내역을 찾을 수 없습니다.');
    if (adv.userId !== userId) throw new ForbiddenException();
    await this.advanceRepo.delete({ id });
  }

  // ──── 일자 조정 (휴일 / 잔업·조퇴) ────

  async setDayOverride(userId: string, workerId: string, dto: SetDayOverrideDto) {
    await this.findOwnedWorker(userId, workerId);
    const holiday = dto.holiday ?? false;
    const deltaHours = dto.deltaHours ?? 0;

    let row = await this.overrideRepo.findOne({
      where: { userId, workerId, date: dto.date },
    });

    // 기본값(휴일 아님 + delta 0)이면 조정 제거
    if (!holiday && deltaHours === 0) {
      if (row) await this.overrideRepo.delete({ id: row.id });
      return { date: dto.date, holiday: false, deltaHours: 0 };
    }

    if (!row) {
      row = this.overrideRepo.create({ userId, workerId, date: dto.date });
    }
    row.holiday = holiday;
    row.deltaHours = deltaHours;
    return this.overrideRepo.save(row);
  }

  // ──── 정산 주기 계산 ────

  /** 근무시작일(anchor)을 기준으로, ref 가 포함된 정산 주기의 시작일 */
  private currentPeriodStart(startDate: string, ref: string): string {
    const anchorDay = parseDate(startDate).getUTCDate();
    const r = parseDate(ref);
    let y = r.getUTCFullYear();
    let m = r.getUTCMonth() + 1; // 1~12
    const dim = daysInMonth(y, m);
    const anchorThisMonth = Math.min(anchorDay, dim);
    if (r.getUTCDate() >= anchorThisMonth) {
      return fmt(new Date(Date.UTC(y, m - 1, anchorThisMonth)));
    }
    // 이전 달 anchor
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
    const prevAnchor = Math.min(anchorDay, daysInMonth(y, m));
    return fmt(new Date(Date.UTC(y, m - 1, prevAnchor)));
  }

  /** periodStart 로부터 다음 주기 시작일(= 마감일) */
  private nextAnchor(startDate: string, periodStart: string): string {
    const anchorDay = parseDate(startDate).getUTCDate();
    const p = parseDate(periodStart);
    let y = p.getUTCFullYear();
    let m = p.getUTCMonth() + 1 + 1; // 다음 달
    if (m === 13) {
      m = 1;
      y += 1;
    }
    const day = Math.min(anchorDay, daysInMonth(y, m));
    return fmt(new Date(Date.UTC(y, m - 1, day)));
  }

  /** periodStart 가 시작일보다 이전이면 시작일로 보정, 정렬된 주기 메타 반환 */
  private resolvePeriod(worker: Worker, periodStart?: string) {
    let ps = periodStart
      ? this.currentPeriodStart(worker.startDate, periodStart)
      : this.currentPeriodStart(worker.startDate, todayStr());

    // 근무시작일 이전 주기는 표시하지 않음 → 최소 시작일 주기로 보정
    const firstPeriod = this.currentPeriodStart(worker.startDate, worker.startDate);
    if (parseDate(ps).getTime() < parseDate(firstPeriod).getTime()) {
      ps = firstPeriod;
    }

    const settleDate = this.nextAnchor(worker.startDate, ps);
    const periodEnd = addDays(settleDate, -1);
    const prevPeriodStart = this.currentPeriodStart(
      worker.startDate,
      addDays(ps, -1),
    );
    const isFirst = parseDate(ps).getTime() <= parseDate(firstPeriod).getTime();
    return {
      periodStart: ps,
      periodEnd,
      settleDate,
      nextPeriodStart: settleDate,
      prevPeriodStart: isFirst ? null : prevPeriodStart,
    };
  }

  // ──── 근무 달력 (자동 채움) ────

  async getCalendar(userId: string, workerId: string, periodStart?: string) {
    const worker = await this.findOwnedWorker(userId, workerId);
    const meta = this.resolvePeriod(worker, periodStart);
    const dailyHours = num(worker.dailyHours);

    const overrides = await this.overrideRepo.find({
      where: { userId, workerId },
    });
    const ovMap = new Map(overrides.map((o) => [o.date, o]));
    const advances = await this.advanceRepo.find({
      where: { userId, workerId },
      order: { date: 'ASC' },
    });
    const advMap = new Map<string, number>();
    for (const a of advances) {
      if (a.date >= meta.periodStart && a.date <= meta.periodEnd) {
        advMap.set(a.date, (advMap.get(a.date) ?? 0) + a.amount);
      }
    }

    const days: any[] = [];
    let cursor = meta.periodStart;
    let workDays = 0;
    let totalHours = 0;
    let overtimeHours = 0;
    while (cursor <= meta.periodEnd) {
      const beforeStart = cursor < worker.startDate;
      const ov = ovMap.get(cursor);
      const holiday = ov?.holiday ?? false;
      const delta = ov ? num(ov.deltaHours) : 0;
      let hours = 0;
      if (!beforeStart && !holiday) {
        hours = Math.max(0, dailyHours + delta);
        workDays += 1;
        totalHours += hours;
        overtimeHours += delta;
      }
      days.push({
        date: cursor,
        beforeStart,
        holiday,
        deltaHours: delta,
        hours,
        advance: advMap.get(cursor) ?? 0,
        isSettleDay: false,
      });
      cursor = addDays(cursor, 1);
    }

    return {
      worker: {
        id: worker.id,
        name: worker.name,
        startDate: worker.startDate,
        hourlyWage: worker.hourlyWage,
        dailyHours,
      },
      ...meta,
      kpi: {
        workDays,
        totalHours,
        overtimeHours,
        grossPay: Math.round(totalHours * worker.hourlyWage),
      },
      days,
    };
  }

  // ──── 월 정산 (영수증) ────

  async getSettlement(userId: string, workerId: string, periodStart?: string) {
    const worker = await this.findOwnedWorker(userId, workerId);
    const meta = this.resolvePeriod(worker, periodStart);
    const dailyHours = num(worker.dailyHours);

    const overrides = await this.overrideRepo.find({ where: { userId, workerId } });
    const ovMap = new Map(overrides.map((o) => [o.date, o]));

    let workDays = 0;
    let totalHours = 0;
    let overtimeHours = 0;
    let cursor = meta.periodStart;
    while (cursor <= meta.periodEnd) {
      const beforeStart = cursor < worker.startDate;
      const ov = ovMap.get(cursor);
      if (!beforeStart && !(ov?.holiday ?? false)) {
        const delta = ov ? num(ov.deltaHours) : 0;
        totalHours += Math.max(0, dailyHours + delta);
        overtimeHours += delta;
        workDays += 1;
      }
      cursor = addDays(cursor, 1);
    }

    const grossPay = Math.round(totalHours * worker.hourlyWage);

    const deductionRows = await this.deductionRepo.find({
      where: { userId, workerId },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
    const deductions = deductionRows.map((d) => ({ label: d.label, amount: d.amount }));
    const deductionTotal = deductions.reduce((s, d) => s + d.amount, 0);

    const advanceRows = await this.advanceRepo.find({
      where: { userId, workerId },
      order: { date: 'ASC' },
    });
    const advances = advanceRows
      .filter((a) => a.date >= meta.periodStart && a.date <= meta.periodEnd)
      .map((a) => ({ date: a.date, amount: a.amount, note: a.note }));
    const advanceTotal = advances.reduce((s, a) => s + a.amount, 0);

    const netPay = grossPay - deductionTotal - advanceTotal;

    const confirmed = await this.settlementRepo.findOne({
      where: { userId, workerId, periodStart: meta.periodStart },
    });

    return {
      worker: {
        id: worker.id,
        name: worker.name,
        startDate: worker.startDate,
        hourlyWage: worker.hourlyWage,
        dailyHours,
      },
      ...meta,
      workDays,
      totalHours,
      overtimeHours,
      hourlyWage: worker.hourlyWage,
      grossPay,
      deductions,
      deductionTotal,
      advances,
      advanceTotal,
      netPay,
      confirmed: !!confirmed,
      confirmedAt: confirmed?.createdAt ?? null,
    };
  }

  /** 정산 확정 (주기 마감 기록) */
  async confirmSettlement(userId: string, workerId: string, periodStart?: string) {
    const receipt = await this.getSettlement(userId, workerId, periodStart);
    const existing = await this.settlementRepo.findOne({
      where: { userId, workerId, periodStart: receipt.periodStart },
    });
    if (existing) {
      existing.snapshot = receipt;
      existing.netPay = receipt.netPay;
      existing.periodEnd = receipt.periodEnd;
      existing.settleDate = receipt.settleDate;
      return this.settlementRepo.save(existing);
    }
    return this.settlementRepo.save(
      this.settlementRepo.create({
        userId,
        workerId,
        periodStart: receipt.periodStart,
        periodEnd: receipt.periodEnd,
        settleDate: receipt.settleDate,
        snapshot: receipt,
        netPay: receipt.netPay,
      }),
    );
  }

  private async findOwnedWorker(userId: string, id: string): Promise<Worker> {
    const worker = await this.workerRepo.findOne({ where: { id } });
    if (!worker) throw new NotFoundException('일꾼을 찾을 수 없습니다.');
    if (worker.userId !== userId) throw new ForbiddenException();
    return worker;
  }
}
