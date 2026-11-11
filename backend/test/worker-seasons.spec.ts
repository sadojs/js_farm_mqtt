import request from 'supertest';
import { createTestApp, tokenFor, TestApp } from './utils/test-app';
import { seed, USERS, id } from './utils/seed';

/**
 * 일꾼 시즌(고용 기간) — docs/02-design/features/worker-seasons-annual.design.md §7 S1~S9.
 * 실제 오늘 날짜로 정산일 경과를 판단하므로 2025~2026 과거 날짜 시즌으로 시나리오를 만든다.
 *
 * 레거시 일꾼 W(시즌 도입 전 데이터): 2025-03-01~2025-10-31, 시급 10,000, 하루 8시간, 숙소비 10만(일할)
 * → 시즌A(자동 백필) → 재고용 시즌B 2026-03-01~, 시급 11,000
 */
describe('일꾼 시즌 (재고용 · 마감)', () => {
  let t: TestApp;
  const http = () => request(t.app.getHttpServer());
  const as = (key: keyof typeof USERS) => `Bearer ${tokenFor(USERS[key])}`;
  const W = id(1, 91);
  const DED = id(1, 92);
  let seasonA: string;
  let seasonB: string;

  beforeAll(async () => {
    t = await createTestApp();
    await seed(t.ds);
    // 시즌 도입 전 형태로 직접 넣는다 (payroll_worker_seasons 없음, 공제 season_id NULL)
    await t.ds.query(
      `insert into payroll_workers (id, user_id, account_user_id, name, start_date, end_date, hourly_wage, daily_hours, created_at, updated_at)
       values ($1,$2,$3,'F1-계절근로자','2025-03-01','2025-10-31',10000,8,now(),now())`,
      [W, USERS.f1.id, USERS.u1.id],
    );
    await t.ds.query(
      `insert into payroll_deductions (id, user_id, worker_id, label, kind, amount, prorate, sort_order, created_at, updated_at)
       values ($1,$2,$3,'숙소비','fixed',100000,true,0,now(),now())`,
      [DED, USERS.f1.id, W],
    );
  });
  afterAll(async () => { await t?.app.close(); });

  it('S1 레거시 일꾼: 조회 시 시즌 1개 자동 생성 + 공제 연결, 정산 금액은 도입 전과 동일', async () => {
    const res = await http().get(`/api/worker-payroll/workers/${W}/settlement?periodStart=2025-03-01`).set('Authorization', as('f1'));
    expect(res.status).toBe(200);
    // 3월 31일 × 8시간 × 10,000 = 2,480,000 / 숙소비 10만(3/1 입국 → 전액)
    expect(res.body.grossPay).toBe(2480000);
    expect(res.body.deductionTotal).toBe(100000);
    expect(res.body.netPay).toBe(2380000);
    expect(res.body.season.seasonYear).toBe(2025);

    const seasons = await t.ds.query('select id from payroll_worker_seasons where worker_id = $1', [W]);
    expect(seasons).toHaveLength(1);
    seasonA = seasons[0].id;
    const [ded] = await t.ds.query('select season_id from payroll_deductions where id = $1', [DED]);
    expect(ded.season_id).toBe(seasonA);

    // 두 번 조회해도 시즌이 늘지 않는다 (idempotent)
    await http().get(`/api/worker-payroll/workers/${W}/calendar`).set('Authorization', as('f1'));
    expect(await t.ds.query('select id from payroll_worker_seasons where worker_id = $1', [W])).toHaveLength(1);
  });

  it('S2 2025-03 확정 후 재고용(시급 11,000) → 지난 확정·미확정 정산 모두 10,000 기준 유지', async () => {
    const ok = await http().post(`/api/worker-payroll/workers/${W}/settlement/approve`)
      .set('Authorization', as('f1')).send({ periodStart: '2025-03-01' });
    expect(ok.status).toBe(201);
    expect(ok.body.status).toBe('confirmed');
    expect(ok.body.snapshot.seasonId).toBe(seasonA);
    expect(ok.body.snapshot.seasonYear).toBe(2025);

    const created = await http().post(`/api/worker-payroll/workers/${W}/seasons`).set('Authorization', as('f1'))
      .send({ startDate: '2026-03-01', hourlyWage: 11000, dailyHours: 8, copyDeductionsFromSeasonId: seasonA });
    expect(created.status).toBe(201);
    expect(created.body.seasonYear).toBe(2026);
    seasonB = created.body.id;

    const march = await http().get(`/api/worker-payroll/workers/${W}/settlement?periodStart=2025-03-01`).set('Authorization', as('f1'));
    expect(march.body.frozen).toBe(true);
    expect(march.body.grossPay).toBe(2480000);
    const april = await http().get(`/api/worker-payroll/workers/${W}/settlement?periodStart=2025-04-01`).set('Authorization', as('f1'));
    expect(april.body.frozen).toBe(false);
    expect(april.body.hourlyWage).toBe(10000);
    expect(april.body.grossPay).toBe(30 * 8 * 10000);
    expect(april.body.season.id).toBe(seasonA);
  });

  it('S3 파라미터 없으면 오늘을 포함하는 시즌B, seasonId=A 면 2025 달력(마지막 기간으로 clamp)', async () => {
    const cur = await http().get(`/api/worker-payroll/workers/${W}/calendar`).set('Authorization', as('f1'));
    expect(cur.body.season.id).toBe(seasonB);
    expect(cur.body.worker.hourlyWage).toBe(11000);
    const past = await http().get(`/api/worker-payroll/workers/${W}/calendar?seasonId=${seasonA}`).set('Authorization', as('f1'));
    expect(past.body.season.id).toBe(seasonA);
    expect(past.body.periodStart).toBe('2025-10-01');
    expect(past.body.nextPeriodStart).toBeNull(); // 귀국일이 든 기간이 마지막
    expect(past.body.worker.hourlyWage).toBe(10000);
  });

  it('S4 진행 중 시즌이 있으면 400 PREVIOUS_SEASON_OPEN, 기간이 겹치면 400 SEASON_OVERLAP', async () => {
    const open = await http().post(`/api/worker-payroll/workers/${W}/seasons`).set('Authorization', as('f1'))
      .send({ startDate: '2027-03-01', hourlyWage: 12000, dailyHours: 8 });
    expect(open.status).toBe(400);
    expect(open.body.code).toBe('PREVIOUS_SEASON_OPEN');

    const end = await http().put(`/api/worker-payroll/seasons/${seasonB}`).set('Authorization', as('f1')).send({ endDate: '2026-10-31' });
    expect(end.status).toBe(200);
    expect(end.body.endDate).toBe('2026-10-31');

    const overlap = await http().post(`/api/worker-payroll/workers/${W}/seasons`).set('Authorization', as('f1'))
      .send({ startDate: '2026-10-01', hourlyWage: 12000, dailyHours: 8 });
    expect(overlap.status).toBe(400);
    expect(overlap.body.code).toBe('SEASON_OVERLAP');

    const moveIntoA = await http().put(`/api/worker-payroll/seasons/${seasonB}`).set('Authorization', as('f1')).send({ startDate: '2025-10-15' });
    expect(moveIntoA.body.code).toBe('SEASON_OVERLAP');
  });

  it('S5 시즌 밖 날짜의 근무 설정·가불은 400 DATE_OUTSIDE_SEASON', async () => {
    const day = await http().post(`/api/worker-payroll/workers/${W}/day`).set('Authorization', as('f1')).send({ date: '2025-12-15', status: 'off' });
    expect(day.status).toBe(400);
    expect(day.body.code).toBe('DATE_OUTSIDE_SEASON');
    const adv = await http().post(`/api/worker-payroll/workers/${W}/advances`).set('Authorization', as('f1')).send({ date: '2025-12-15', amount: 50000 });
    expect(adv.status).toBe(400);
    expect(adv.body.code).toBe('DATE_OUTSIDE_SEASON');
  });

  it('S6 미확정이 남으면 마감 409, 모두 확정 후 마감 → 수정 전부 409, 마감 해제 후 다시 가능', async () => {
    const early = await http().post(`/api/worker-payroll/seasons/${seasonA}/close`).set('Authorization', as('f1'));
    expect(early.status).toBe(409);
    expect(early.body.code).toBe('SEASON_UNSETTLED');
    expect(early.body.periods.map((p: any) => p.periodStart)).toEqual([
      '2025-04-01', '2025-05-01', '2025-06-01', '2025-07-01', '2025-08-01', '2025-09-01', '2025-10-01',
    ]);

    for (const m of ['04', '05', '06', '07', '08', '09', '10']) {
      const r = await http().post(`/api/worker-payroll/workers/${W}/settlement/approve`)
        .set('Authorization', as('f1')).send({ periodStart: `2025-${m}-01`, seasonId: seasonA });
      expect(r.status).toBe(201);
    }
    const closed = await http().post(`/api/worker-payroll/seasons/${seasonA}/close`).set('Authorization', as('f1'));
    expect(closed.status).toBe(201);
    expect(closed.body.closed).toBe(true);

    const blocked = [
      await http().post(`/api/worker-payroll/workers/${W}/day`).set('Authorization', as('f1')).send({ date: '2025-05-10', status: 'off' }),
      await http().post(`/api/worker-payroll/workers/${W}/advances`).set('Authorization', as('f1')).send({ date: '2025-05-10', amount: 1000 }),
      await http().post(`/api/worker-payroll/workers/${W}/settlement/approve`).set('Authorization', as('f1')).send({ periodStart: '2025-05-01' }),
      await http().put(`/api/worker-payroll/seasons/${seasonA}`).set('Authorization', as('f1')).send({ hourlyWage: 20000 }),
      await http().post('/api/worker-payroll/workers').set('Authorization', as('f1'))
        .send({ id: W, seasonId: seasonA, name: 'F1-계절근로자', startDate: '2025-03-01', hourlyWage: 20000, dailyHours: 8 }),
    ];
    for (const r of blocked) {
      expect(r.status).toBe(409);
      expect(r.body.code).toBe('SEASON_CLOSED');
    }
    // 정산 화면: 마감 시즌은 승인 버튼 없음
    const view = await http().get(`/api/worker-payroll/workers/${W}/settlement?seasonId=${seasonA}`).set('Authorization', as('f1'));
    expect(view.body.season.closed).toBe(true);
    expect(view.body.canApprove).toBe(false);

    const reopened = await http().post(`/api/worker-payroll/seasons/${seasonA}/reopen`).set('Authorization', as('f1'));
    expect(reopened.body.closed).toBe(false);
    const day = await http().post(`/api/worker-payroll/workers/${W}/day`).set('Authorization', as('f1')).send({ date: '2025-05-10', status: 'off' });
    expect(day.status).toBe(201);
    // 확정 정산은 마감 해제와 무관하게 그대로
    const may = await http().get(`/api/worker-payroll/workers/${W}/settlement?periodStart=2025-05-01`).set('Authorization', as('f1'));
    expect(may.body.frozen).toBe(true);
    expect(may.body.grossPay).toBe(31 * 8 * 10000);
  });

  it('S7 재고용 시 공제 복사는 새 id, 원본 시즌 공제는 그대로', async () => {
    const res = await http().get(`/api/worker-payroll/workers/${W}/seasons`).set('Authorization', as('f1'));
    expect(res.status).toBe(200);
    const [a, b] = res.body;
    expect(a.id).toBe(seasonA);
    expect(a.deductions.map((d: any) => d.id)).toEqual([DED]);
    expect(b.deductions).toHaveLength(1);
    expect(b.deductions[0].id).not.toBe(DED);
    expect(b.deductions[0].label).toBe('숙소비');
    expect(a.summary.confirmedNetPay).toBeGreaterThan(0);
    expect(a.summary.unsettledCount).toBe(0);

    // 시즌B 공제를 바꿔도 시즌A 공제·확정 정산 불변
    await http().put(`/api/worker-payroll/seasons/${seasonB}`).set('Authorization', as('f1'))
      .send({ deductions: [{ label: '숙소비', amount: 150000 }] });
    const [orig] = await t.ds.query('select amount, season_id from payroll_deductions where id = $1', [DED]);
    expect(orig.amount).toBe(100000);
    expect(orig.season_id).toBe(seasonA);
  });

  it('S8 미러: 일꾼 목록·본인 화면은 기본 시즌(B) 값, 지난 시즌 일꾼 구분(inYear)', async () => {
    const list = await http().get('/api/worker-payroll/workers?year=2026').set('Authorization', as('f1'));
    const w = list.body.find((x: any) => x.id === W);
    expect(w.hourlyWage).toBe(11000);
    expect(w.startDate).toBe('2026-03-01');
    expect(w.currentSeason.id).toBe(seasonB);
    expect(w.seasons).toHaveLength(2);
    expect(w.lastSeasonYear).toBe(2026);
    expect(w.inYear).toBe(true);
    expect(w.deductions.map((d: any) => d.amount)).toEqual([150000]); // 기본 시즌 공제
    const list2024 = await http().get('/api/worker-payroll/workers?year=2024').set('Authorization', as('f1'));
    expect(list2024.body.find((x: any) => x.id === W).inYear).toBe(false);

    const me = await http().get('/api/worker-payroll/me').set('Authorization', as('u1'));
    expect(me.status).toBe(200);
    expect(me.body.id).toBe(W);
    expect(me.body.hourlyWage).toBe(11000);
    expect(me.body.currentSeason.id).toBe(seasonB);
  });

  it('S9 권한: 다른 농장 403, 농장 사용자 시즌 생성·마감 403, 관리자 + X-Farm-Context 는 그 농장으로', async () => {
    expect((await http().get(`/api/worker-payroll/workers/${W}/seasons`).set('Authorization', as('f2'))).status).toBe(403);
    expect((await http().post(`/api/worker-payroll/workers/${W}/seasons`).set('Authorization', as('f2'))
      .send({ startDate: '2027-03-01', hourlyWage: 1, dailyHours: 8 })).status).toBe(403);
    expect((await http().put(`/api/worker-payroll/seasons/${seasonB}`).set('Authorization', as('f2')).send({ hourlyWage: 1 })).status).toBe(403);
    expect((await http().post(`/api/worker-payroll/workers/${W}/seasons`).set('Authorization', as('u1'))
      .send({ startDate: '2027-03-01', hourlyWage: 1, dailyHours: 8 })).status).toBe(403);
    expect((await http().post(`/api/worker-payroll/seasons/${seasonA}/close`).set('Authorization', as('u1'))).status).toBe(403);

    // 일꾼 본인은 자기 시즌 목록 열람 가능
    expect((await http().get(`/api/worker-payroll/workers/${W}/seasons`).set('Authorization', as('u1'))).status).toBe(200);

    expect((await http().get(`/api/worker-payroll/workers/${W}/seasons`).set('Authorization', as('admin'))).status).toBe(403);
    const ctx = await http().get(`/api/worker-payroll/workers/${W}/seasons`)
      .set('Authorization', as('admin')).set('X-Farm-Context', USERS.f1.id);
    expect(ctx.status).toBe(200);
    expect(ctx.body).toHaveLength(2);
  });

  it('신규 등록: 첫 시즌이 함께 만들어지고 공제가 그 시즌에 연결된다', async () => {
    const res = await http().post('/api/worker-payroll/workers').set('Authorization', as('f1')).send({
      name: 'F1-신규', username: 'f1newworker', password: 'secret12', startDate: '2026-04-01',
      hourlyWage: 10030, dailyHours: 8, deductions: [{ label: '식비', amount: 50000 }],
    });
    expect(res.status).toBe(201);
    const [season] = await t.ds.query('select id, season_year, hourly_wage from payroll_worker_seasons where worker_id = $1', [res.body.id]);
    expect(season.season_year).toBe(2026);
    expect(season.hourly_wage).toBe(10030);
    const [ded] = await t.ds.query('select season_id from payroll_deductions where worker_id = $1', [res.body.id]);
    expect(ded.season_id).toBe(season.id);
  });

  describe('일꾼 삭제 — 목록에서만 숨김 / 기록까지 완전 삭제', () => {
    const ACC = 'aaaaaaaa-0000-4000-8000-0000000000d1';
    const mk = async (wid: string, name: string, withAccount = false) => {
      if (withAccount) {
        await t.ds.query(
          `insert into users (id, username, password_hash, name, role, parent_user_id, status, created_at, updated_at)
           values ($1,'f1purgeacct','x','삭제계정','farm_user',$2,'active',now(),now())`,
          [ACC, USERS.f1.id],
        );
      }
      if (withAccount) {
        await t.ds.query(
          `insert into refresh_tokens (id, "userId", "tokenHash", "expiresAt", "createdAt") values (gen_random_uuid(), $1, 'h-purge', now() + interval '7 days', now())`,
          [ACC],
        );
      }
      await t.ds.query(
        `insert into payroll_workers (id, user_id, account_user_id, name, start_date, end_date, hourly_wage, daily_hours, created_at, updated_at)
         values ($1,$2,$3,$4,'2025-03-01','2025-04-30',10000,8,now(),now())`,
        [wid, USERS.f1.id, withAccount ? ACC : null, name],
      );
      await t.ds.query(
        `insert into payroll_advances (id, user_id, worker_id, date, amount, created_at, updated_at) values (gen_random_uuid(),$1,$2,'2025-03-10',30000,now(),now())`,
        [USERS.f1.id, wid],
      );
      const r = await http().post(`/api/worker-payroll/workers/${wid}/settlement/approve`).set('Authorization', as('f1')).send({ periodStart: '2025-03-01' });
      expect(r.status).toBe(201);
    };
    const count = async (table: string, wid: string) =>
      (await t.ds.query(`select count(*)::int n from ${table} where worker_id = $1`, [wid]))[0].n;

    it('기록 건수 안내 → 목록에서만 삭제: 목록에서 빠지고 기록·연간 결산은 유지, 로그인 계정 비활성', async () => {
      const H = id(1, 120);
      await mk(H, 'F1-숨김일꾼', true);
      const sum = await http().get(`/api/worker-payroll/workers/${H}/records-summary`).set('Authorization', as('f1'));
      expect(sum.body).toMatchObject({ name: 'F1-숨김일꾼', seasons: 1, settlements: 1, confirmedSettlements: 1, advances: 1, hasAccount: true });

      const res = await http().delete(`/api/worker-payroll/workers/${H}`).set('Authorization', as('f1'));
      expect(res.body).toMatchObject({ ok: true, purged: false, account: 'deactivated' });
      const list = await http().get('/api/worker-payroll/workers').set('Authorization', as('f1'));
      expect(list.body.find((w: any) => w.id === H)).toBeUndefined();
      expect(await count('payroll_settlements', H)).toBe(1);
      expect(await count('payroll_advances', H)).toBe(1);
      const annual = await http().get('/api/worker-payroll/annual?year=2025').set('Authorization', as('f1'));
      expect(annual.body.byWorker.some((w: any) => w.workerId === H)).toBe(true);
      const [acct] = await t.ds.query('select status from users where id = $1', [ACC]);
      expect(acct.status).toBe('inactive');
      // 비활성화 시 로그인 유지 토큰도 폐기 (이전엔 컬럼명 오류로 조용히 실패했음)
      expect(await t.ds.query('select id from refresh_tokens where "userId"::text = $1', [ACC])).toHaveLength(0);
    });

    it('기록까지 완전 삭제(purge=true): 시즌·정산·가불·근무조정·기타비용·일꾼·계정 모두 삭제, 연간 결산에서도 빠짐', async () => {
      const P = id(1, 121);
      await mk(P, 'F1-완전삭제');
      await http().post(`/api/worker-payroll/workers/${P}/day`).set('Authorization', as('f1')).send({ date: '2025-03-05', status: 'off' });
      await http().post('/api/worker-payroll/extra-costs').set('Authorization', as('f1')).send({ year: 2025, workerId: P, label: '항공권', amount: 500000 });
      // 다른 일꾼의 기록은 그대로여야 함
      const otherBefore = await count('payroll_settlements', W);

      const res = await http().delete(`/api/worker-payroll/workers/${P}?purge=true`).set('Authorization', as('f1'));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ purged: true, deleted: { settlements: 1, advances: 1, dayOverrides: 1, extraCosts: 1, seasons: 1 } });
      for (const tb of ['payroll_settlements', 'payroll_advances', 'payroll_day_overrides', 'payroll_deductions', 'payroll_extra_costs', 'payroll_worker_seasons']) {
        expect(await count(tb, P)).toBe(0);
      }
      expect(await t.ds.query('select id from payroll_workers where id = $1', [P])).toHaveLength(0);
      expect(await count('payroll_settlements', W)).toBe(otherBefore);
      const annual = await http().get('/api/worker-payroll/annual?year=2025').set('Authorization', as('f1'));
      expect(annual.body.byWorker.some((w: any) => w.workerId === P)).toBe(false);
      const [log] = await t.ds.query(`select action from activity_logs where target_id::text = $1`, [P]);
      expect(log.action).toBe('payroll.worker.purge');
    });

    it('권한: 다른 농장·농장 사용자는 삭제·건수 조회 불가', async () => {
      expect((await http().delete(`/api/worker-payroll/workers/${W}?purge=true`).set('Authorization', as('f2'))).status).toBe(403);
      expect((await http().get(`/api/worker-payroll/workers/${W}/records-summary`).set('Authorization', as('f2'))).status).toBe(403);
      expect((await http().delete(`/api/worker-payroll/workers/${W}`).set('Authorization', as('u1'))).status).toBe(403);
      expect(await t.ds.query('select id from payroll_workers where id = $1', [W])).toHaveLength(1);
    });
  });
});
