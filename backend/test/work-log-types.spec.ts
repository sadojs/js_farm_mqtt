import request from 'supertest';
import { createTestApp, tokenFor, TestApp } from './utils/test-app';
import { seed, USERS, id } from './utils/seed';

/** 농작업 — 기본 작업 삭제 가능(최초 1회만 생성) · 기록 있는 작업은 경고 후 함께 삭제 · 초기화(기록만 삭제) */
describe('농작업 작업 종류 · 초기화', () => {
  let t: TestApp;
  const http = () => request(t.app.getHttpServer());
  const as = (key: keyof typeof USERS) => `Bearer ${tokenFor(USERS[key])}`;
  const types = async () => (await http().get('/api/work-log/task-types').set('Authorization', as('f1'))).body as any[];

  beforeAll(async () => {
    t = await createTestApp();
    await seed(t.ds);
    // 새 농장 상태로: 시드의 작업 기록·작업 종류 제거 + '기본 작업 생성' 표시 해제
    for (const u of [USERS.f1.id, USERS.f2.id]) {
      await t.ds.query('delete from work_logs where user_id::text = $1', [u]);
      await t.ds.query('delete from work_task_types where user_id::text = $1', [u]);
      await t.ds.query('update users set work_types_seeded_at = null where id::text = $1', [u]);
    }
  });
  afterAll(async () => { await t?.app.close(); });

  it('새 농장: 처음 열면 기본 6종이 만들어진다', async () => {
    const list = await types();
    expect(list.filter((x) => x.isStandard)).toHaveLength(6);
  });

  it('기본 작업을 삭제하면 다시 열어도 되살아나지 않는다', async () => {
    const target = (await types()).find((x) => x.label === '하엽 제거');
    const del = await http().delete(`/api/work-log/task-types/${target.id}`).set('Authorization', as('f1'));
    expect(del.status).toBe(200);
    const again = await types();
    expect(again.find((x) => x.label === '하엽 제거')).toBeUndefined();
    expect(again).toHaveLength(5);
  });

  it('이름을 바꾼 기본 작업이 있어도 원래 이름으로 다시 생기지 않는다', async () => {
    const t2 = (await types()).find((x) => x.label === '적과');
    await http().put(`/api/work-log/task-types/${t2.id}`).set('Authorization', as('f1')).send({ label: '아르바이트', emoji: t2.emoji, color: t2.color });
    const list = await types();
    expect(list.find((x) => x.label === '적과')).toBeUndefined();
    expect(list.find((x) => x.label === '아르바이트')).toBeTruthy();
  });

  it('기록이 있는 작업: 그냥 삭제는 409(건수 안내), withLogs=true 면 기록과 함께 삭제', async () => {
    const tt = (await types()).find((x) => x.label === '순지르기');
    await t.ds.query(
      `insert into work_logs (id, user_id, zone_id, task_type_id, done_at, created_at, updated_at) values ($1,$2,$3,$4,now(),now(),now())`,
      [id(1, 90), USERS.f1.id, id(1, 10), tt.id],
    );
    const first = await http().delete(`/api/work-log/task-types/${tt.id}`).set('Authorization', as('f1'));
    expect(first.status).toBe(409);
    expect(first.body.code).toBe('TASK_TYPE_IN_USE');
    expect(first.body.count).toBe(1);
    const second = await http().delete(`/api/work-log/task-types/${tt.id}?withLogs=true`).set('Authorization', as('f1'));
    expect(second.status).toBe(200);
    expect(second.body.deletedLogs).toBe(1);
    const left = await t.ds.query('select count(*)::int n from work_logs where task_type_id = $1', [tt.id]);
    expect(left[0].n).toBe(0);
  });

  it('초기화: 기록만 전부 삭제, 작업 종류는 유지 / 다른 농장 기록은 그대로', async () => {
    const tt = (await types())[0];
    await t.ds.query(
      `insert into work_logs (id, user_id, zone_id, task_type_id, done_at, created_at, updated_at) values ($1,$2,$3,$4,now(),now(),now())`,
      [id(1, 91), USERS.f1.id, id(1, 10), tt.id],
    );
    // 농장2 기록
    const f2types = (await http().get('/api/work-log/task-types').set('Authorization', as('f2'))).body;
    await t.ds.query(
      `insert into work_logs (id, user_id, zone_id, task_type_id, done_at, created_at, updated_at) values ($1,$2,$3,$4,now(),now(),now())`,
      [id(2, 91), USERS.f2.id, id(2, 10), f2types[0].id],
    );
    const before = (await types()).length;
    const res = await http().delete('/api/work-log/logs').set('Authorization', as('f1'));
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBeGreaterThanOrEqual(1);
    const mine = await t.ds.query('select count(*)::int n from work_logs where user_id::text = $1', [USERS.f1.id]);
    const theirs = await t.ds.query('select count(*)::int n from work_logs where user_id::text = $1', [USERS.f2.id]);
    expect(mine[0].n).toBe(0);
    expect(theirs[0].n).toBe(1);  // 다른 농장 기록은 그대로
    expect((await types()).length).toBe(before);
  });

  it('농장 사용자는 초기화·작업 삭제 불가(403)', async () => {
    expect((await http().delete('/api/work-log/logs').set('Authorization', as('u1'))).status).toBe(403);
    const tt = (await types())[0];
    expect((await http().delete(`/api/work-log/task-types/${tt.id}`).set('Authorization', as('u1'))).status).toBe(403);
  });
});
