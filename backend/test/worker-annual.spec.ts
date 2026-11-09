import request from 'supertest';
import { createTestApp, tokenFor, TestApp } from './utils/test-app';
import { seed, USERS, id } from './utils/seed';

/**
 * 연간 결산 GET /worker-payroll/annual — 설계 §7 A1·A2.
 * 농장1 (2025):
 *  - X: 2025-03-01~04-30 시급 10,000, 숙소비 10만 → 3월·4월 API 로 확정 (4월 가불 5만)
 *  - Y: 삭제된 일꾼, 시즌 도입 전 형식 snapshot(advanceTotal 없음) 5월 확정 + 2024-12 확정(전년)
 *  - Z: 2025-06-01~07-31 진행 중, 정산 없음 → 미확정 2건
 * 농장2: 2025 확정 1건 (섞이면 안 됨)
 */
describe('연간 결산', () => {
  let t: TestApp;
  const http = () => request(t.app.getHttpServer());
  const as = (key: keyof typeof USERS) => `Bearer ${tokenFor(USERS[key])}`;
  const X = id(1, 93);
  const Y = id(1, 94);
  const Z = id(1, 95);
  const F2W = id(2, 93);

  const worker = (wid: string, owner: string, name: string, start: string, end: string | null, active = true) =>
    t.ds.query(
      `insert into payroll_workers (id, user_id, name, start_date, end_date, hourly_wage, daily_hours, is_active, created_at, updated_at)
       values ($1,$2,$3,$4,$5,10000,8,$6,now(),now())`,
      [wid, owner, name, start, end, active],
    );
  const confirmedRow = (sid: string, owner: string, wid: string, ps: string, pe: string, snapshot: any) =>
    t.ds.query(
      `insert into payroll_settlements (id, user_id, worker_id, period_start, period_end, settle_date, snapshot, net_pay, status, confirmed_at, created_at)
       values ($1,$2,$3,$4,$5,($5::date + 1),$6,$7,'confirmed',now(),now())`,
      [sid, owner, wid, ps, pe, JSON.stringify(snapshot), snapshot.netPay],
    );

  beforeAll(async () => {
    t = await createTestApp();
    await seed(t.ds);
    await worker(X, USERS.f1.id, 'F1-엑스', '2025-03-01', '2025-04-30');
    await worker(Y, USERS.f1.id, 'F1-와이(삭제)', '2024-12-01', '2025-05-31', false);
    await worker(Z, USERS.f1.id, 'F1-제트', '2025-06-01', '2025-07-31');
    await worker(F2W, USERS.f2.id, 'F2-일꾼', '2025-03-01', '2025-03-31');
    await t.ds.query(
      `insert into payroll_deductions (id, user_id, worker_id, label, kind, amount, prorate, sort_order, created_at, updated_at)
       values ($1,$2,$3,'숙소비','fixed',100000,true,0,now(),now())`,
      [id(1, 96), USERS.f1.id, X],
    );
    await t.ds.query(
      `insert into payroll_advances (id, user_id, worker_id, date, amount, created_at, updated_at) values ($1,$2,$3,'2025-04-10',50000,now(),now())`,
      [id(1, 97), USERS.f1.id, X],
    );
    for (const ps of ['2025-03-01', '2025-04-01']) {
      const r = await http().post(`/api/worker-payroll/workers/${X}/settlement/approve`).set('Authorization', as('f1')).send({ periodStart: ps });
      expect(r.status).toBe(201);
    }
    // 시즌 도입 전 형식 (advanceTotal·seasonId 없음)
    await confirmedRow(id(1, 98), USERS.f1.id, Y, '2025-05-01', '2025-05-31', {
      grossPay: 1000000, deductionTotal: 100000, netPay: 800000, workDays: 20, totalHours: 160,
      deductions: [{ label: '식비', amount: 100000 }],
    });
    await confirmedRow(id(1, 99), USERS.f1.id, Y, '2024-12-01', '2024-12-31', {
      grossPay: 500000, deductionTotal: 50000, advanceTotal: 0, netPay: 450000, workDays: 10, totalHours: 80, deductions: [],
    });
    await confirmedRow(id(2, 98), USERS.f2.id, F2W, '2025-03-01', '2025-03-31', {
      grossPay: 9999999, deductionTotal: 0, advanceTotal: 0, netPay: 9999999, workDays: 31, totalHours: 248, deductions: [],
    });
  });
  afterAll(async () => { await t?.app.close(); });

  it('A1 확정분만 합산, period_end 연도·월 귀속, 12개월 고정, 구버전 snapshot 가불 역산', async () => {
    const res = await http().get('/api/worker-payroll/annual?year=2025').set('Authorization', as('f1'));
    expect(res.status).toBe(200);
    const { totals, monthly, deductionsByLabel } = res.body;
    // X 3월 2,480,000 / 4월 2,400,000 / Y 5월 1,000,000
    expect(totals.grossPay).toBe(5880000);
    expect(totals.deductionTotal).toBe(300000);
    expect(totals.advanceTotal).toBe(150000); // X 4월 가불 5만 + Y 역산 10만
    expect(totals.netPay).toBe(2380000 + 2250000 + 800000);
    expect(totals.cashOut).toBe(totals.netPay + totals.advanceTotal);
    expect(totals.headcount).toBe(2);
    expect(totals.workDays).toBe(31 + 30 + 20);
    expect(totals.totalCost).toBe(totals.grossPay + totals.extraCostTotal);

    expect(monthly).toHaveLength(12);
    expect(monthly[2].grossPay).toBe(2480000);
    expect(monthly[3].advanceTotal).toBe(50000);
    expect(monthly[4].advanceTotal).toBe(100000);
    expect(monthly[0].grossPay).toBe(0);
    expect(deductionsByLabel).toEqual([
      { label: '숙소비', amount: 200000 },
      { label: '식비', amount: 100000 },
    ]);
  });

  it('A2 삭제된 일꾼 포함 · 다른 농장 제외 · 미확정 집계 · 전년 비교', async () => {
    const res = await http().get('/api/worker-payroll/annual?year=2025').set('Authorization', as('f1'));
    const names = res.body.byWorker.map((w: any) => w.workerName);
    expect(names).toEqual(['F1-엑스', 'F1-와이(삭제)']);
    const x = res.body.byWorker[0];
    expect(x.seasonYear).toBe(2025);
    expect(x.seasonStart).toBe('2025-03-01');
    expect(x.seasonEnd).toBe('2025-04-30');
    expect(x.share).toBeCloseTo(4880000 / 5880000, 5);
    expect(JSON.stringify(res.body)).not.toContain('F2-');

    expect(res.body.unsettled.count).toBe(2);
    expect(res.body.unsettled.items.map((i: any) => [i.workerName, i.periodStart, i.status])).toEqual([
      ['F1-제트', '2025-06-01', 'pending'],
      ['F1-제트', '2025-07-01', 'pending'],
    ]);
    expect(res.body.unsettled.estimatedNetPay).toBe((30 + 31) * 8 * 10000);

    expect(res.body.previousYear).toEqual({ year: 2024, grossPay: 500000, netPay: 450000, headcount: 1 });
    const none = await http().get('/api/worker-payroll/annual?year=2023').set('Authorization', as('f1'));
    expect(none.body.totals.grossPay).toBe(0);
    expect(none.body.previousYear).toBeNull();

    const f2 = await http().get('/api/worker-payroll/annual?year=2025').set('Authorization', as('f2'));
    expect(f2.body.totals.grossPay).toBe(9999999);
  });

  it('정산 이력 year 필터 + seasonYear, 입력 검증·권한', async () => {
    const y2025 = await http().get('/api/worker-payroll/settlements?year=2025').set('Authorization', as('f1'));
    expect(y2025.body.map((r: any) => r.periodStart).sort()).toEqual(['2025-03-01', '2025-04-01', '2025-05-01']);
    // 시즌 연도 = 시즌 시작 연도 → Y(2024-12-01 시작) 의 2025-05 정산은 2024 시즌
    expect(Object.fromEntries(y2025.body.map((r: any) => [r.periodStart, r.seasonYear]))).toEqual({
      '2025-03-01': 2025, '2025-04-01': 2025, '2025-05-01': 2024,
    });
    const y2024 = await http().get('/api/worker-payroll/settlements?year=2024').set('Authorization', as('f1'));
    expect(y2024.body).toHaveLength(1);
    expect(y2024.body[0].seasonYear).toBe(2024);
    const all = await http().get('/api/worker-payroll/settlements').set('Authorization', as('f1'));
    expect(all.body).toHaveLength(4);

    expect((await http().get('/api/worker-payroll/annual').set('Authorization', as('f1'))).status).toBe(400);
    expect((await http().get('/api/worker-payroll/annual?year=25').set('Authorization', as('f1'))).status).toBe(400);
    expect((await http().get('/api/worker-payroll/annual?year=2025').set('Authorization', as('u1'))).status).toBe(403);
    const ctx = await http().get('/api/worker-payroll/annual?year=2025')
      .set('Authorization', as('admin')).set('X-Farm-Context', USERS.f1.id);
    expect(ctx.body.totals.grossPay).toBe(5880000);
  });

  it('기타 고용비용: CRUD · 날짜 연도 귀속 · 결산 totalCost 반영 · 권한', async () => {
    const flight = await http().post('/api/worker-payroll/extra-costs').set('Authorization', as('f1'))
      .send({ year: 2025, workerId: X, label: '항공권', amount: 800000 });
    expect(flight.status).toBe(201);
    // date 가 있으면 귀속 연도는 date 의 연도 (year 2024 로 보내도 2025)
    const visa = await http().post('/api/worker-payroll/extra-costs').set('Authorization', as('f1'))
      .send({ year: 2024, date: '2025-02-01', label: '비자·수수료', amount: 200000, note: '2명' });
    expect(visa.body.year).toBe(2025);

    const list = await http().get('/api/worker-payroll/extra-costs?year=2025').set('Authorization', as('f1'));
    expect(list.body.map((r: any) => [r.label, r.workerName])).toEqual([['비자·수수료', null], ['항공권', 'F1-엑스']]);

    const annual = await http().get('/api/worker-payroll/annual?year=2025').set('Authorization', as('f1'));
    expect(annual.body.totals.extraCostTotal).toBe(1000000);
    expect(annual.body.totals.totalCost).toBe(5880000 + 1000000);

    const upd = await http().put(`/api/worker-payroll/extra-costs/${flight.body.id}`).set('Authorization', as('f1'))
      .send({ year: 2025, workerId: X, label: '항공권(왕복)', amount: 900000 });
    expect(upd.body.amount).toBe(900000);

    // 권한: 다른 농장·농장 사용자 불가, 다른 농장 일꾼 지정 불가
    expect((await http().put(`/api/worker-payroll/extra-costs/${flight.body.id}`).set('Authorization', as('f2'))
      .send({ year: 2025, label: 'x', amount: 1 })).status).toBe(403);
    expect((await http().delete(`/api/worker-payroll/extra-costs/${flight.body.id}`).set('Authorization', as('f2'))).status).toBe(403);
    expect((await http().get('/api/worker-payroll/extra-costs?year=2025').set('Authorization', as('u1'))).status).toBe(403);
    expect((await http().post('/api/worker-payroll/extra-costs').set('Authorization', as('f2'))
      .send({ year: 2025, workerId: X, label: 'x', amount: 1 })).status).toBe(403);
    expect((await http().get('/api/worker-payroll/extra-costs?year=2025').set('Authorization', as('f2'))).body).toEqual([]);

    expect((await http().delete(`/api/worker-payroll/extra-costs/${visa.body.id}`).set('Authorization', as('f1'))).status).toBe(200);
    const after = await http().get('/api/worker-payroll/annual?year=2025').set('Authorization', as('f1'));
    expect(after.body.totals.extraCostTotal).toBe(900000);
  });
});
