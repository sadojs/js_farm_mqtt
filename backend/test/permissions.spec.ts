import request from 'supertest';
import { createTestApp, tokenFor, TestApp } from './utils/test-app';
import { seed, USERS, id } from './utils/seed';

/** 권한 회귀 — docs/03-analysis/field-conflict-review-2026-10-05.md C2·C4·C6 */
describe('권한 — 게이트웨이 소유권·농장 사용자 쓰기·비활성화', () => {
  let t: TestApp;
  const http = () => request(t.app.getHttpServer());
  const as = (key: keyof typeof USERS) => `Bearer ${tokenFor(USERS[key])}`;

  beforeAll(async () => {
    t = await createTestApp();
    await seed(t.ds);
  });
  afterAll(async () => { await t?.app.close(); });

  describe('페일오버 설정 — 게이트웨이 소유권', () => {
    it('농장 관리자: 다른 농장 게이트웨이 비상 정지·설정 조회 403', async () => {
      const stop = await http().post('/api/fallback-config/f2-gw/emergency-stop').set('Authorization', as('f1')).send({ reason: 't', by: 't' });
      expect(stop.status).toBe(403);
      const get = await http().get('/api/fallback-config/f2-gw').set('Authorization', as('f1'));
      expect(get.status).toBe(403);
    });

    it('농장 관리자: 자기 농장 게이트웨이는 통과(가드 기준 — 404/200 등 403 이 아님)', async () => {
      const res = await http().get('/api/fallback-config/f1-gw/mode').set('Authorization', as('f1'));
      expect(res.status).not.toBe(403);
    });

    it('플랫폼 관리자: 모든 게이트웨이 통과', async () => {
      const res = await http().get('/api/fallback-config/f2-gw/mode').set('Authorization', as('admin'));
      expect(res.status).not.toBe(403);
    });
  });

  describe('농장 사용자 — 구조 변경 차단, 조회는 허용', () => {
    it('룰 삭제·장치 삭제·구역 삭제 403', async () => {
      expect((await http().delete(`/api/automation/rules/${id(1, 50)}`).set('Authorization', as('u1'))).status).toBe(403);
      expect((await http().delete(`/api/devices/${id(1, 41)}`).set('Authorization', as('u1'))).status).toBe(403);
      expect((await http().delete(`/api/groups/${id(1, 10)}`).set('Authorization', as('u1'))).status).toBe(403);
      const rule = await t.ds.query('select count(*)::int as n from automation_rules where id = $1', [id(1, 50)]);
      expect(rule[0].n).toBe(1);
    });

    it('룰·장치 조회는 가능', async () => {
      expect((await http().get('/api/automation/rules').set('Authorization', as('u1'))).status).toBe(200);
      expect((await http().get('/api/devices').set('Authorization', as('u1'))).status).toBe(200);
    });
  });

  describe('계정 비활성화 즉시 반영', () => {
    it('비활성화 후 기존 access token 으로 요청 401', async () => {
      const before = await http().get('/api/devices').set('Authorization', as('u1'));
      expect(before.status).toBe(200);
      const upd = await http().put(`/api/users/${USERS.u1.id}`).set('Authorization', as('admin')).send({ status: 'inactive' });
      expect(upd.status).toBe(200);
      const after = await http().get('/api/devices').set('Authorization', as('u1'));
      expect(after.status).toBe(401);
      await http().put(`/api/users/${USERS.u1.id}`).set('Authorization', as('admin')).send({ status: 'active' });
    });
  });
});
