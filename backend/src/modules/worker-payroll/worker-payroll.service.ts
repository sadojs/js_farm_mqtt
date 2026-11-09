import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, In } from 'typeorm';
import { Worker } from './entities/worker.entity';
import { WorkerDeduction } from './entities/worker-deduction.entity';
import { WorkerAdvance } from './entities/worker-advance.entity';
import { WorkerDayOverride } from './entities/worker-day-override.entity';
import { WorkerSettlement } from './entities/worker-settlement.entity';
import { WorkerSeason } from './entities/worker-season.entity';
import { SaveWorkerDto, DeductionInputDto } from './dto/worker.dto';
import { CreateSeasonDto, UpdateSeasonDto } from './dto/season.dto';
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
/** 끝이 없는(근무 중) 시즌의 비교용 종료일 */
const OPEN_END = '9999-12-31';
/** 시즌 하나의 정산기간 순회 상한 (무한루프 방지) */
const MAX_PERIODS = 24;

type PeriodMeta = {
  periodStart: string;
  periodEnd: string;
  settleDate: string;
  nextPeriodStart: string | null;
  prevPeriodStart: string | null;
};

/** 구버전 snapshot 에 advanceTotal 이 없으면 급여 − 공제 − 실수령 으로 역산 (프론트 SettlementHistory 와 동일 규칙) */
export function advanceOf(snapshot: any): number {
  if (snapshot?.advanceTotal != null) return num(snapshot.advanceTotal);
  return Math.max(0, num(snapshot?.grossPay) - num(snapshot?.deductionTotal) - num(snapshot?.netPay));
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
    private readonly dayRepo: Repository<WorkerDayOverride>,
    @InjectRepository(WorkerSettlement)
    private readonly settlementRepo: Repository<WorkerSettlement>,
    @InjectRepository(WorkerSeason)
    private readonly seasonRepo: Repository<WorkerSeason>,
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

  // ──── 시즌 (한 번의 고용 기간) ────
  // 근무조건·공제는 시즌이 가진다. payroll_workers 의 같은 컬럼은 기본 시즌의 미러(구버전 앱 호환).
  // 계산 로직은 그대로 두고 effectiveWorker(시즌 값을 덮어쓴 worker)를 넘긴다.

  /** 시즌이 없는 일꾼(도입 전 데이터)은 worker 컬럼으로 시즌 1개를 만들고 공제를 연결한다. start_date ASC. */
  private async ensureSeasons(worker: Worker): Promise<WorkerSeason[]> {
    const seasons = await this.seasonRepo.find({
      where: { workerId: worker.id },
      order: { startDate: 'ASC' },
    });
    if (seasons.length > 0) return seasons;
    return this.dataSource.transaction(async (m) => {
      await m.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`payroll-season:${worker.id}`]);
      const again = await m.find(WorkerSeason, {
        where: { workerId: worker.id },
        order: { startDate: 'ASC' },
      });
      if (again.length > 0) return again;
      const created = await m.save(
        m.create(WorkerSeason, {
          userId: worker.userId,
          workerId: worker.id,
          seasonYear: parseDate(worker.startDate).getUTCFullYear(),
          startDate: worker.startDate,
          endDate: worker.endDate,
          salaryType: worker.salaryType,
          hourlyWage: worker.hourlyWage,
          fixedMonthlySalary: worker.fixedMonthlySalary,
          dailyHours: num(worker.dailyHours),
          settlementCycleType: worker.settlementCycleType,
        }),
      );
      await m.query(
        'UPDATE payroll_deductions SET season_id = $1 WHERE worker_id = $2 AND season_id IS NULL',
        [created.id, worker.id],
      );
      return [created];
    });
  }

  /** 시즌 확보 + 미러가 기본 시즌과 어긋났으면(날짜가 지나 기본 시즌이 바뀐 경우 등) 바로잡는다. */
  private async loadSeasons(worker: Worker): Promise<WorkerSeason[]> {
    const seasons = await this.ensureSeasons(worker);
    const mirror = this.mirrorValues(this.pickDefaultSeason(seasons));
    if (this.mirrorDrift(worker, mirror)) {
      await this.workerRepo.update({ id: worker.id }, mirror);
      Object.assign(worker, mirror);
    }
    return seasons;
  }

  private mirrorDrift(worker: Worker, mirror: ReturnType<WorkerPayrollService['mirrorValues']>): boolean {
    return (
      mirror.startDate !== worker.startDate.slice(0, 10) ||
      mirror.endDate !== (worker.endDate ? worker.endDate.slice(0, 10) : null) ||
      mirror.salaryType !== worker.salaryType ||
      mirror.hourlyWage !== worker.hourlyWage ||
      mirror.fixedMonthlySalary !== worker.fixedMonthlySalary ||
      mirror.dailyHours !== num(worker.dailyHours) ||
      mirror.settlementCycleType !== worker.settlementCycleType
    );
  }

  /** 여러 일꾼의 시즌을 한 번에 (목록용) */
  private async loadSeasonsMany(workers: Worker[]): Promise<Map<string, WorkerSeason[]>> {
    const rows = workers.length
      ? await this.seasonRepo.find({
          where: { workerId: In(workers.map((w) => w.id)) },
          order: { startDate: 'ASC' },
        })
      : [];
    const map = new Map<string, WorkerSeason[]>();
    for (const r of rows) map.set(r.workerId, [...(map.get(r.workerId) ?? []), r]);
    for (const w of workers) {
      // 시즌 없음(지연 백필) 또는 미러 어긋남이 있을 수 있으므로 일꾼별로 확인 — 대부분 쿼리 없이 끝난다
      const own = map.get(w.id);
      if (!own || this.mirrorDrift(w, this.mirrorValues(this.pickDefaultSeason(own)))) {
        map.set(w.id, await this.loadSeasons(w));
      }
    }
    return map;
  }

  /** 기본 시즌 = 오늘을 포함하는 시즌 → 없으면 시작일이 가장 최근인 시즌 (D8) */
  private pickDefaultSeason(seasons: WorkerSeason[], today = todayStr()): WorkerSeason {
    return this.seasonForDate(seasons, today) ?? seasons[seasons.length - 1];
  }

  private seasonForDate(seasons: WorkerSeason[], date: string): WorkerSeason | null {
    const d = date.slice(0, 10);
    return (
      seasons.find((s) => s.startDate.slice(0, 10) <= d && d <= (s.endDate ? s.endDate.slice(0, 10) : OPEN_END)) ??
      null
    );
  }

  /** 날짜가 시즌 사이(공백기)면 그 직전 시즌, 첫 시즌보다 앞이면 첫 시즌 */
  private seasonNear(seasons: WorkerSeason[], date: string): WorkerSeason {
    const d = date.slice(0, 10);
    const hit = this.seasonForDate(seasons, d);
    if (hit) return hit;
    const before = seasons.filter((s) => s.startDate.slice(0, 10) <= d);
    return before.length ? before[before.length - 1] : seasons[0];
  }

  private mirrorValues(season: WorkerSeason) {
    return {
      startDate: season.startDate.slice(0, 10),
      endDate: season.endDate ? season.endDate.slice(0, 10) : null,
      salaryType: season.salaryType,
      hourlyWage: season.hourlyWage,
      fixedMonthlySalary: season.fixedMonthlySalary,
      dailyHours: num(season.dailyHours),
      settlementCycleType: season.settlementCycleType,
    };
  }

  /** worker 를 시즌 값으로 덮어쓴 계산용 객체 (D3) */
  private effectiveWorker(worker: Worker, season: WorkerSeason): Worker {
    return { ...worker, ...this.mirrorValues(season) } as Worker;
  }

  private assertSeasonOpen(season: WorkerSeason) {
    if (season.closedAt) {
      throw new ConflictException({
        code: 'SEASON_CLOSED',
        message: `${season.seasonYear} 시즌은 마감되어 수정할 수 없습니다. 수정하려면 먼저 마감을 해제하세요.`,
      });
    }
  }

  /** 기본 시즌 값을 payroll_workers 컬럼에 복사 (D2) */
  private async syncMirror(
    manager: import('typeorm').EntityManager,
    worker: Worker,
    seasons: WorkerSeason[],
  ) {
    const mirror = this.mirrorValues(this.pickDefaultSeason(seasons));
    await manager.update(Worker, { id: worker.id }, mirror);
    Object.assign(worker, mirror);
  }

  private seasonBrief(season: WorkerSeason, extra: Record<string, any> = {}) {
    return {
      id: season.id,
      seasonYear: season.seasonYear,
      startDate: season.startDate.slice(0, 10),
      endDate: season.endDate ? season.endDate.slice(0, 10) : null,
      salaryType: season.salaryType,
      hourlyWage: season.hourlyWage,
      fixedMonthlySalary: season.fixedMonthlySalary,
      dailyHours: num(season.dailyHours),
      settlementCycleType: season.settlementCycleType,
      note: season.note,
      closed: !!season.closedAt,
      closedAt: season.closedAt,
      ...extra,
    };
  }

  /** 요청의 시즌 결정: seasonId → 지정 / periodStart → 그 날짜의 시즌 / 둘 다 없음 → 기본 시즌 */
  private async seasonContext(worker: Worker, seasonId?: string, periodStart?: string) {
    const seasons = await this.loadSeasons(worker);
    let season: WorkerSeason;
    if (seasonId) {
      const found = seasons.find((s) => s.id === seasonId);
      if (!found) throw new NotFoundException('시즌을 찾을 수 없습니다.');
      season = found;
    } else if (periodStart) {
      season = this.seasonNear(seasons, periodStart);
    } else {
      season = this.pickDefaultSeason(seasons);
    }
    return { seasons, season, eff: this.effectiveWorker(worker, season) };
  }

  /** 시즌의 정산기간들 (첫 기간부터, until 이후 시작하는 기간 제외, 최대 MAX_PERIODS) */
  private seasonPeriods(eff: Worker, until?: string): PeriodMeta[] {
    const out: PeriodMeta[] = [];
    let meta: PeriodMeta = this.resolvePeriod(eff, eff.startDate);
    for (let i = 0; i < MAX_PERIODS; i++) {
      if (until && meta.periodStart > until) break;
      out.push(meta);
      if (!meta.nextPeriodStart) break;
      meta = this.resolvePeriod(eff, meta.nextPeriodStart);
    }
    return out;
  }

  /** 정산일이 지났는데 확정되지 않은 기간 수 (목록 배지용) */
  private unsettledCount(eff: Worker, confirmed: Set<string>): number {
    const today = todayStr();
    return this.seasonPeriods(eff, today).filter(
      (p) => p.settleDate <= today && !confirmed.has(`${eff.id}|${p.periodStart}`),
    ).length;
  }

  private async confirmedKeys(workerIds: string[]): Promise<Set<string>> {
    if (workerIds.length === 0) return new Set();
    const rows = await this.settlementRepo.find({
      where: { workerId: In(workerIds), status: 'confirmed' },
      select: ['workerId', 'periodStart'],
    });
    return new Set(rows.map((r) => `${r.workerId}|${r.periodStart.slice(0, 10)}`));
  }

  /**
   * 시즌 기간 검증 (D7): 종료일 ≥ 시작일, 같은 일꾼의 다른 시즌과 겹치지 않음,
   * 기존 시즌 수정이면 이미 확정된 정산기간이 새 기간 밖으로 밀려나지 않음.
   */
  private async validateSeasonRange(
    workerId: string,
    seasons: WorkerSeason[],
    target: WorkerSeason | null,
    start: string,
    end: string | null,
  ) {
    const s = start.slice(0, 10);
    const e = end ? end.slice(0, 10) : null;
    if (e && e < s) {
      throw new BadRequestException({ code: 'INVALID_RANGE', message: '종료일(귀국일)이 시작일보다 앞설 수 없습니다.' });
    }
    const overlap = seasons.find(
      (o) =>
        o.id !== target?.id &&
        o.startDate.slice(0, 10) <= (e ?? OPEN_END) &&
        s <= (o.endDate ? o.endDate.slice(0, 10) : OPEN_END),
    );
    if (overlap) {
      throw new BadRequestException({
        code: 'SEASON_OVERLAP',
        message: `${overlap.seasonYear} 시즌(${overlap.startDate.slice(0, 10)}~${overlap.endDate?.slice(0, 10) ?? ''})과 기간이 겹칩니다.`,
      });
    }
    if (!target) return;
    const oldStart = target.startDate.slice(0, 10);
    const oldEnd = target.endDate ? target.endDate.slice(0, 10) : OPEN_END;
    const settled = await this.settlementRepo.find({ where: { workerId, status: 'confirmed' } });
    const outside = settled.filter((r) => {
      const ps = r.periodStart.slice(0, 10);
      const pe = r.periodEnd.slice(0, 10);
      const inOld = pe >= oldStart && ps <= oldEnd;
      const inNew = pe >= s && ps <= (e ?? OPEN_END);
      return inOld && !inNew;
    });
    if (outside.length) {
      throw new ConflictException({
        code: 'SETTLED_PERIOD_OUTSIDE',
        message: `확정된 정산(${outside.map((r) => r.periodStart.slice(0, 10)).join(', ')})이 새 기간 밖으로 벗어납니다.`,
      });
    }
  }

  // ──── 일꾼 목록 / 본인 ────

  async listWorkers(ownerId: string, year?: number) {
    const workers = await this.workerRepo.find({
      where: { userId: ownerId, isActive: true },
      order: { createdAt: 'ASC' },
    });
    if (workers.length === 0) return [];
    const seasonMap = await this.loadSeasonsMany(workers);
    const defaults = new Map(workers.map((w) => [w.id, this.pickDefaultSeason(seasonMap.get(w.id)!)]));
    const deductions = await this.deductionRepo.find({
      where: {
        userId: ownerId,
        workerId: In(workers.map((w) => w.id)),
        seasonId: In([...defaults.values()].map((s) => s.id)),
      },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
    const unames = await this.usernameMap(
      workers.map((w) => w.accountUserId).filter(Boolean) as string[],
    );
    const confirmed = await this.confirmedKeys(workers.map((w) => w.id));
    return workers.map((w) => {
      const seasons = seasonMap.get(w.id)!;
      const briefs = seasons.map((s) =>
        this.seasonBrief(s, { unsettledCount: this.unsettledCount(this.effectiveWorker(w, s), confirmed) }),
      );
      const current = briefs.find((b) => b.id === defaults.get(w.id)!.id)!;
      const extra: Record<string, any> = {
        seasons: briefs,
        currentSeason: current,
        lastSeasonYear: Math.max(...seasons.map((s) => s.seasonYear)),
      };
      if (year) {
        extra.inYear = seasons.some(
          (s) => s.startDate.slice(0, 10) <= `${year}-12-31` && (s.endDate ? s.endDate.slice(0, 10) : OPEN_END) >= `${year}-01-01`,
        );
      }
      return {
        ...w,
        dailyHours: num(w.dailyHours),
        username: w.accountUserId ? unames[w.accountUserId] ?? null : null,
        deductions: deductions.filter((d) => d.workerId === w.id),
        ...extra,
      };
    });
  }

  /** farm_user 본인 프로필 (없으면 null) */
  async getMyWorker(accountUserId: string) {
    const worker = await this.workerRepo.findOne({
      where: { accountUserId, isActive: true },
    });
    if (!worker) return null;
    const seasons = await this.loadSeasons(worker);
    return {
      ...worker,
      dailyHours: num(worker.dailyHours),
      currentSeason: this.seasonBrief(this.pickDefaultSeason(seasons)),
      seasons: seasons.map((s) => this.seasonBrief(s)),
    };
  }

  async getWorker(user: any, id: string) {
    const { worker } = await this.resolveWorker(user, id);
    const seasons = await this.loadSeasons(worker);
    const current = this.pickDefaultSeason(seasons);
    const deductions = await this.deductionRepo.find({
      where: { workerId: id, seasonId: current.id },
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
      seasons: seasons.map((s) => this.seasonBrief(s)),
      currentSeason: this.seasonBrief(current),
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
        // 첫 시즌 = 등록한 근무조건
        const season = await manager.save(
          manager.create(WorkerSeason, {
            userId: ownerId,
            workerId: worker.id,
            seasonYear: parseDate(worker.startDate).getUTCFullYear(),
            ...this.mirrorValues(worker as any),
          }),
        );
        await this.replaceDeductions(manager, ownerId, worker.id, season.id, dto.deductions);
        return { ...worker, username: account.username };
      });
    }

    // 수정: 계정 필드 무시. 이름·연락처는 일꾼에, 근무조건·공제는 시즌(dto.seasonId 또는 기본 시즌)에 저장
    const found = await this.findOwnedWorker(ownerId, dto.id);
    const seasons = await this.loadSeasons(found);
    let target = this.pickDefaultSeason(seasons);
    if (dto.seasonId) {
      const picked = seasons.find((x) => x.id === dto.seasonId);
      if (!picked) throw new NotFoundException('시즌을 찾을 수 없습니다.');
      target = picked;
    }
    this.assertSeasonOpen(target);
    const next = {
      startDate: dto.startDate,
      // endDate 는 '' 또는 null 이면 명시적으로 해제, undefined 면 기존 유지
      endDate: dto.endDate === undefined ? target.endDate : (dto.endDate || null),
      salaryType: dto.salaryType ?? target.salaryType,
      hourlyWage: dto.hourlyWage,
      fixedMonthlySalary: dto.fixedMonthlySalary ?? target.fixedMonthlySalary,
      settlementCycleType: dto.settlementCycleType ?? target.settlementCycleType,
      dailyHours: dto.dailyHours,
    };
    await this.validateSeasonRange(found.id, seasons, target, next.startDate, next.endDate);

    return this.dataSource.transaction(async (manager) => {
      Object.assign(target, next, { seasonYear: parseDate(next.startDate).getUTCFullYear() });
      await manager.save(target);
      Object.assign(found, {
        name: dto.name,
        phone: dto.phone ?? found.phone,
        isActive: dto.isActive ?? true,
      });
      const worker = await manager.save(found);
      if (dto.deductions) {
        await this.replaceDeductions(manager, ownerId, worker.id, target.id, dto.deductions);
      }
      await this.syncMirror(manager, worker, seasons);
      return worker;
    });
  }

  /** 시즌의 공제를 통째로 교체 */
  private async replaceDeductions(
    manager: import('typeorm').EntityManager,
    ownerId: string,
    workerId: string,
    seasonId: string,
    deductions?: DeductionInputDto[],
  ) {
    if (!deductions) return;
    await manager.delete(WorkerDeduction, { workerId, seasonId });
    let idx = 0;
    for (const d of deductions) {
      const kind = d.kind === 'variable' ? 'variable' : 'fixed';
      await manager.save(
        manager.create(WorkerDeduction, {
          userId: ownerId,
          workerId,
          seasonId,
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
    this.assertSeasonOpen(this.seasonOfDateOrThrow(await this.loadSeasons(worker), dto.date));
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
    // 시즌 밖(도입 전 잘못 입력된) 가불은 정리할 수 있게 허용, 마감된 시즌의 가불만 막는다
    const worker = await this.findOwnedWorker(ownerId, adv.workerId);
    const season = this.seasonForDate(await this.loadSeasons(worker), adv.date);
    if (season) this.assertSeasonOpen(season);
    await this.advanceRepo.delete({ id });
  }

  // ──── 일자 근무 설정 (관리자) ────

  async setDay(ownerId: string, workerId: string, dto: SetDayDto) {
    const worker = await this.findOwnedWorker(ownerId, workerId);
    const season = this.seasonOfDateOrThrow(await this.loadSeasons(worker), dto.date);
    this.assertSeasonOpen(season);
    const base = num(season.dailyHours);
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

  private seasonOfDateOrThrow(seasons: WorkerSeason[], date: string): WorkerSeason {
    const season = this.seasonForDate(seasons, date);
    if (!season) {
      throw new BadRequestException({
        code: 'DATE_OUTSIDE_SEASON',
        message: '근무 기간(시즌) 밖의 날짜입니다.',
      });
    }
    return season;
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

  /** worker 는 effectiveWorker(시즌 값) — 시즌 시작~종료 기간 안으로 clamp */
  private resolvePeriod(worker: Worker, periodStart?: string): PeriodMeta {
    let ps = periodStart
      ? this.periodStartFor(worker, periodStart)
      : this.periodStartFor(worker, todayStr());

    const firstPeriod = this.periodStartFor(worker, worker.startDate);
    if (parseDate(ps).getTime() < parseDate(firstPeriod).getTime()) ps = firstPeriod;
    // 종료일(귀국일)이 있으면 그날을 포함하는 기간이 마지막
    const lastPeriod = worker.endDate ? this.periodStartFor(worker, worker.endDate) : null;
    if (lastPeriod && ps > lastPeriod) ps = lastPeriod;

    const settleDate = this.nextAnchorFor(worker, ps);
    const periodEnd = addDays(settleDate, -1);
    const prevPeriodStart = this.periodStartFor(worker, addDays(ps, -1));
    const isFirst = parseDate(ps).getTime() <= parseDate(firstPeriod).getTime();
    const isLast = !!lastPeriod && ps >= lastPeriod;
    return {
      periodStart: ps,
      periodEnd,
      settleDate,
      nextPeriodStart: isLast ? null : settleDate,
      prevPeriodStart: isFirst ? null : prevPeriodStart,
    };
  }

  // ──── 근무 달력 ────

  async getCalendar(user: any, workerId: string, periodStart?: string, seasonId?: string) {
    const { worker: rawWorker, canEdit } = await this.resolveWorker(user, workerId);
    const { season, eff: worker } = await this.seasonContext(rawWorker, seasonId, periodStart);
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
      season: this.seasonBrief(season),
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
    meta: PeriodMeta,
    season: WorkerSeason,
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
      where: { workerId: worker.id, seasonId: season.id },
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
      // 연간 결산·이력 필터용 (snapshot 에 박제됨)
      seasonId: season.id,
      seasonYear: season.seasonYear,
    };
  }

  /** 현재 변동 공제 항목 정의 (정산 입력 모달용) */
  private async variableDefs(workerId: string, seasonId: string) {
    const rows = await this.deductionRepo.find({
      where: { workerId, seasonId, kind: 'variable' },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
    return rows.map((d) => ({ id: d.id, label: d.label }));
  }

  // ──── 정산 조회 (확정/요청된 건 snapshot 박제) ────

  async getSettlement(user: any, workerId: string, periodStart?: string, seasonId?: string) {
    const { worker: rawWorker, canEdit } = await this.resolveWorker(user, workerId);
    const { season, eff: worker } = await this.seasonContext(rawWorker, seasonId, periodStart);
    const meta = this.resolvePeriod(worker, periodStart);
    const variableDeductions = await this.variableDefs(worker.id, season.id);
    const open = !season.closedAt;

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
        canApprove: canEdit && open && row.status === 'requested',
        variableDeductions,
        // 기간 이동은 현재 시즌 기준 (snapshot 의 값은 박제 당시 기준이라 덮어씀)
        nextPeriodStart: meta.nextPeriodStart,
        prevPeriodStart: meta.prevPeriodStart,
        season: this.seasonBrief(season),
      };
    }

    const receipt = await this.computeReceipt(worker, meta, season);
    const ended = meta.settleDate <= todayStr();
    return {
      ...receipt,
      status: ended ? 'pending' : 'open',
      frozen: false,
      canEdit,
      requestedAt: null,
      confirmedAt: null,
      // 일꾼은 요청, 관리자는 직접 승인(직접 확정)
      canRequest: ended && !canEdit && open,
      canApprove: canEdit && ended && open,
      variableDeductions,
      season: this.seasonBrief(season),
    };
  }

  /** 정산 확정 요청 (일꾼 또는 관리자) — 정산일 경과 시 snapshot 박제 + status='requested' */
  async requestSettlement(
    user: any,
    workerId: string,
    periodStart?: string,
    variableAmounts?: Record<string, number>,
    seasonId?: string,
  ) {
    const { worker: rawWorker } = await this.resolveWorker(user, workerId);
    const { season, eff: worker } = await this.seasonContext(rawWorker, seasonId, periodStart);
    this.assertSeasonOpen(season);
    const meta = this.resolvePeriod(worker, periodStart);
    if (meta.settleDate > todayStr()) {
      throw new BadRequestException('아직 정산일이 지나지 않았습니다.');
    }
    const existing = await this.settlementRepo.findOne({
      where: { workerId: worker.id, periodStart: meta.periodStart },
    });
    if (existing) return existing;

    const receipt = await this.computeReceipt(worker, meta, season, variableAmounts);
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
    seasonId?: string,
  ) {
    const rawWorker = await this.findOwnedWorker(ownerId, workerId);
    const { season, eff: worker } = await this.seasonContext(rawWorker, seasonId, periodStart);
    this.assertSeasonOpen(season);
    const meta = this.resolvePeriod(worker, periodStart);
    let row = await this.settlementRepo.findOne({
      where: { workerId: worker.id, periodStart: meta.periodStart },
    });
    if (!row) {
      if (meta.settleDate > todayStr()) {
        throw new BadRequestException('아직 정산일이 지나지 않았습니다.');
      }
      const receipt = await this.computeReceipt(worker, meta, season, variableAmounts);
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
      const receipt = await this.computeReceipt(worker, meta, season, variableAmounts);
      row.snapshot = receipt;
      row.netPay = receipt.netPay;
    }
    row.status = 'confirmed';
    row.confirmedAt = new Date();
    return this.settlementRepo.save(row);
  }

  // ──── 시즌 관리 (재고용 · 조건 수정 · 마감) ────

  /** 시즌 목록 + 시즌별 요약 (확정분은 snapshot, 미확정분은 현재 계산값) */
  async listSeasons(user: any, workerId: string) {
    const { worker } = await this.resolveWorker(user, workerId);
    const seasons = await this.loadSeasons(worker);
    const settlements = await this.settlementRepo.find({ where: { workerId } });
    const rowMap = new Map(settlements.map((r) => [r.periodStart.slice(0, 10), r]));
    const deductions = await this.deductionRepo.find({
      where: { workerId },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
    const today = todayStr();
    const current = this.pickDefaultSeason(seasons);
    const out: any[] = [];
    for (const season of seasons) {
      const eff = this.effectiveWorker(worker, season);
      const summary = {
        workDays: 0, totalHours: 0, grossPay: 0, netPay: 0,
        confirmedGrossPay: 0, confirmedNetPay: 0, unsettledCount: 0, periodCount: 0,
      };
      for (const meta of this.seasonPeriods(eff, today)) {
        const row = rowMap.get(meta.periodStart);
        const snap: any = row?.status === 'confirmed' ? row.snapshot : await this.computeReceipt(eff, meta, season);
        summary.periodCount += 1;
        summary.workDays += num(snap.workDays);
        summary.totalHours += num(snap.totalHours);
        summary.grossPay += num(snap.grossPay);
        summary.netPay += num(snap.netPay);
        if (row?.status === 'confirmed') {
          summary.confirmedGrossPay += num(snap.grossPay);
          summary.confirmedNetPay += num(snap.netPay);
        } else if (meta.settleDate <= today) {
          summary.unsettledCount += 1;
        }
      }
      out.push(
        this.seasonBrief(season, {
          isCurrent: season.id === current.id,
          deductions: deductions.filter((d) => d.seasonId === season.id),
          summary,
        }),
      );
    }
    return out;
  }

  /**
   * 재고용 = 새 시즌 시작. 지난 시즌 기록은 그대로.
   * 공제: dto.deductions 우선, 없으면 copyDeductionsFromSeasonId 의 공제 복사(새 id).
   * 일꾼(삭제했던 경우)과 로그인 계정(비활성화된 경우)을 다시 활성화한다.
   */
  async createSeason(ownerId: string, workerId: string, dto: CreateSeasonDto) {
    const worker = await this.findOwnedWorker(ownerId, workerId);
    const seasons = await this.loadSeasons(worker);
    const open = seasons.find((x) => !x.endDate);
    if (open) {
      throw new BadRequestException({
        code: 'PREVIOUS_SEASON_OPEN',
        message: `${open.seasonYear} 시즌의 종료일(귀국일)을 먼저 입력하세요.`,
      });
    }
    const endDate = dto.endDate || null;
    await this.validateSeasonRange(worker.id, seasons, null, dto.startDate, endDate);

    let deductions: DeductionInputDto[] | undefined = dto.deductions;
    if (!deductions && dto.copyDeductionsFromSeasonId) {
      if (!seasons.some((x) => x.id === dto.copyDeductionsFromSeasonId)) {
        throw new NotFoundException('복사할 시즌을 찾을 수 없습니다.');
      }
      const rows = await this.deductionRepo.find({
        where: { workerId, seasonId: dto.copyDeductionsFromSeasonId },
        order: { sortOrder: 'ASC', createdAt: 'ASC' },
      });
      deductions = rows.map((d) => ({
        label: d.label,
        kind: d.kind === 'variable' ? 'variable' : 'fixed',
        amount: d.amount,
        prorate: d.prorate,
        sortOrder: d.sortOrder,
      }));
    }

    const season = await this.dataSource.transaction(async (manager) => {
      const created = await manager.save(
        manager.create(WorkerSeason, {
          userId: worker.userId,
          workerId: worker.id,
          seasonYear: parseDate(dto.startDate).getUTCFullYear(),
          startDate: dto.startDate.slice(0, 10),
          endDate: endDate ? endDate.slice(0, 10) : null,
          salaryType: dto.salaryType ?? 'hourly',
          hourlyWage: dto.hourlyWage,
          fixedMonthlySalary: dto.fixedMonthlySalary ?? 0,
          dailyHours: dto.dailyHours,
          settlementCycleType: dto.settlementCycleType ?? 'calendar_month',
          note: dto.note ?? null,
        }),
      );
      await this.replaceDeductions(manager, ownerId, worker.id, created.id, deductions ?? []);
      if (!worker.isActive) await manager.update(Worker, { id: worker.id }, { isActive: true });
      await this.syncMirror(manager, worker, [...seasons, created].sort((a, b) => (a.startDate < b.startDate ? -1 : 1)));
      return created;
    });

    const accountReactivated = await this.reactivateAccount(worker.accountUserId);
    return this.seasonBrief(season, { accountReactivated });
  }

  /** 로그인 계정이 비활성화돼 있으면 다시 활성화 (재고용) */
  private async reactivateAccount(accountUserId: string | null): Promise<boolean> {
    if (!accountUserId) return false;
    const [row] = await this.dataSource.query('SELECT status FROM users WHERE id = $1', [accountUserId]);
    if (!row || row.status !== 'inactive') return false;
    await this.usersService.update(accountUserId, { status: 'active' } as any);
    return true;
  }

  private async findOwnedSeason(ownerId: string, seasonId: string) {
    const season = await this.seasonRepo.findOne({ where: { id: seasonId } });
    if (!season) throw new NotFoundException('시즌을 찾을 수 없습니다.');
    if (season.userId !== ownerId) throw new ForbiddenException();
    const worker = await this.findOwnedWorker(ownerId, season.workerId);
    const seasons = await this.loadSeasons(worker);
    return { worker, seasons, season: seasons.find((x) => x.id === season.id)! };
  }

  async updateSeason(ownerId: string, seasonId: string, dto: UpdateSeasonDto) {
    const { worker, seasons, season } = await this.findOwnedSeason(ownerId, seasonId);
    this.assertSeasonOpen(season);
    const startDate = (dto.startDate ?? season.startDate).slice(0, 10);
    const endDate =
      dto.endDate === undefined ? season.endDate : dto.endDate ? dto.endDate.slice(0, 10) : null;
    await this.validateSeasonRange(worker.id, seasons, season, startDate, endDate);

    await this.dataSource.transaction(async (manager) => {
      Object.assign(season, {
        startDate,
        endDate,
        seasonYear: parseDate(startDate).getUTCFullYear(),
        salaryType: dto.salaryType ?? season.salaryType,
        hourlyWage: dto.hourlyWage ?? season.hourlyWage,
        fixedMonthlySalary: dto.fixedMonthlySalary ?? season.fixedMonthlySalary,
        dailyHours: dto.dailyHours ?? num(season.dailyHours),
        settlementCycleType: dto.settlementCycleType ?? season.settlementCycleType,
        note: dto.note === undefined ? season.note : dto.note || null,
      });
      await manager.save(season);
      if (dto.deductions) {
        await this.replaceDeductions(manager, ownerId, worker.id, season.id, dto.deductions);
      }
      await this.syncMirror(manager, worker, seasons);
    });
    return this.seasonBrief(season);
  }

  /**
   * 시즌 마감 (D6): 종료일이 있고, 시즌의 모든 정산기간이 확정이어야 한다.
   * 마감 후 이 시즌 날짜의 달력·가불·정산·공제 수정은 409 SEASON_CLOSED.
   */
  async closeSeason(ownerId: string, seasonId: string) {
    const { worker, season } = await this.findOwnedSeason(ownerId, seasonId);
    if (season.closedAt) return this.seasonBrief(season);
    if (!season.endDate) {
      throw new BadRequestException({
        code: 'SEASON_NOT_ENDED',
        message: '종료일(귀국일)을 입력한 시즌만 마감할 수 있습니다.',
      });
    }
    const eff = this.effectiveWorker(worker, season);
    const rows = await this.settlementRepo.find({ where: { workerId: worker.id } });
    const rowMap = new Map(rows.map((r) => [r.periodStart.slice(0, 10), r]));
    const today = todayStr();
    const periods = this.seasonPeriods(eff)
      .filter((p) => rowMap.get(p.periodStart)?.status !== 'confirmed')
      .map((p) => ({
        periodStart: p.periodStart,
        periodEnd: p.periodEnd,
        settleDate: p.settleDate,
        status: rowMap.get(p.periodStart)?.status === 'requested'
          ? 'requested'
          : p.settleDate <= today ? 'pending' : 'open',
      }));
    if (periods.length) {
      throw new ConflictException({
        code: 'SEASON_UNSETTLED',
        message: `확정되지 않은 정산이 ${periods.length}건 있습니다. 모두 확정한 뒤 마감하세요.`,
        periods,
      });
    }
    season.closedAt = new Date();
    await this.seasonRepo.save(season);
    return this.seasonBrief(season);
  }

  async reopenSeason(ownerId: string, seasonId: string) {
    const { season } = await this.findOwnedSeason(ownerId, seasonId);
    if (season.closedAt) {
      season.closedAt = null;
      await this.seasonRepo.save(season);
    }
    return this.seasonBrief(season);
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
