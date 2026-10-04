import request from 'supertest';
import { createTestApp, tokenFor, TestApp } from './utils/test-app';
import { seed, USERS, id } from './utils/seed';
import { FARM_ENDPOINTS, PLATFORM_ENDPOINTS, normalize } from './utils/endpoints';

const H = 'X-Farm-Context';

describe('X-Farm-Context (HTTP)', () => {
  let t: TestApp;
  const http = () => request(t.app.getHttpServer());
  const as = (key: keyof typeof USERS) => `Bearer ${tokenFor(USERS[key])}`;
  const snap = (res: request.Response) => ({ status: res.status, body: normalize(res.text || null) });

  beforeAll(async () => {
    t = await createTestApp();
    await seed(t.ds);
  });
  afterAll(async () => { await t?.app.close(); });

  describe('(b) admin + 유효 헤더 → 해당 농장 데이터만 (= 그 농장 관리자가 보는 것과 동일)', () => {
    for (const path of FARM_ENDPOINTS) {
      it(`GET ${path}`, async () => {
        const viaContext = await http().get(path).set('Authorization', as('admin')).set(H, USERS.f1.id);
        const asFarm = await http().get(path).set('Authorization', as('f1'));
        expect(viaContext.headers['x-farm-context-applied']).toBe(USERS.f1.id);
        expect(snap(viaContext)).toEqual(snap(asFarm));
        // 교차 오염 없음: 다른 농장의 고정 id·이름 접두사가 섞이지 않는다
        expect(viaContext.text).not.toContain('22222222-');
        expect(viaContext.text).not.toContain('F2-');
      });
    }

    it('농장2 컨텍스트는 농장2 데이터만 (groups·devices·automation)', async () => {
      for (const path of ['/api/groups', '/api/devices', '/api/automation/rules', '/api/gateways']) {
        const res = await http().get(path).set('Authorization', as('admin')).set(H, USERS.f2.id);
        expect(res.status).toBe(200);
        expect(res.text).toContain('F2-');
        expect(res.text).not.toContain('F1-');
      }
    });

    it('헤더 없는 admin 의 구역 관리는 여전히 모든 농장 합산', async () => {
      const res = await http().get('/api/groups').set('Authorization', as('admin'));
      expect(res.text).toContain('F1-');
      expect(res.text).toContain('F2-');
      expect(res.headers['x-farm-context-applied']).toBeUndefined();
    });

    it('빈 헤더는 헤더 없음과 동일', async () => {
      const a = await http().get('/api/groups').set('Authorization', as('admin')).set(H, '  ');
      const b = await http().get('/api/groups').set('Authorization', as('admin'));
      expect(snap(a)).toEqual(snap(b));
    });
  });

  describe('플랫폼 전용·본인 정보 라우트는 헤더가 있어도 원래 admin 으로 동작', () => {
    for (const path of PLATFORM_ENDPOINTS) {
      it(`GET ${path}`, async () => {
        const withHeader = await http().get(path).set('Authorization', as('admin')).set(H, USERS.f1.id);
        const without = await http().get(path).set('Authorization', as('admin'));
        expect(snap(withHeader)).toEqual(snap(without));
        expect(withHeader.headers['x-farm-context-applied']).toBe('none');
      });
    }

    it('/api/auth/me 는 실제 관리자 본인을 반환', async () => {
      const res = await http().get('/api/auth/me').set('Authorization', as('admin')).set(H, USERS.f1.id);
      expect(res.status).toBe(200);
      expect(res.text).toContain(USERS.admin.username);
      expect(res.text).not.toContain(USERS.f1.username);
    });

    it('공개 라우트는 헤더를 무시', async () => {
      const res = await http().get('/api/health/live').set(H, USERS.f1.id);
      expect(res.status).toBe(200);
    });
  });

  describe('(c) 비관리자가 헤더 전송 → 403 (권한 상승 방지)', () => {
    it.each([
      ['farm_admin → 다른 농장', 'f1', USERS.f2.id, '/api/groups'],
      ['farm_admin → 자기 농장', 'f1', USERS.f1.id, '/api/groups'],
      ['farm_user → 다른 농장', 'u1', USERS.f2.id, '/api/devices'],
      ['farm_admin → 플랫폼 라우트', 'f1', USERS.f2.id, '/api/auth/me'],
    ] as const)('%s', async (_l, who, target, path) => {
      const res = await http().get(path).set('Authorization', as(who)).set(H, target);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FARM_CONTEXT_FORBIDDEN');
      expect(res.text).not.toContain('F2-');
    });
  });

  describe('(d) 잘못된 대상 → 400/404', () => {
    it.each([
      ['UUID 형식 아님', 'not-a-uuid', 400, 'FARM_CONTEXT_INVALID'],
      ['존재하지 않는 id', '99999999-0000-4000-8000-000000000001', 404, 'FARM_CONTEXT_NOT_FOUND'],
      ['farm_user id', USERS.u1.id, 400, 'FARM_CONTEXT_NOT_FARM_ADMIN'],
      ['admin id', USERS.admin2.id, 400, 'FARM_CONTEXT_NOT_FARM_ADMIN'],
      ['비활성 farm_admin', USERS.f3inactive.id, 400, 'FARM_CONTEXT_INACTIVE'],
    ] as const)('%s', async (_l, target, status, code) => {
      const res = await http().get('/api/groups').set('Authorization', as('admin')).set(H, target);
      expect(res.status).toBe(status);
      expect(res.body.code).toBe(code);
    });
  });

  describe('(e) 쓰기: 실제 수행자(actingAdminId)가 activity-log 에 남는다', () => {
    /**
     * 컨트롤러는 activity-log 를 await 하지 않고(fire-and-forget) 기록하므로, 응답 직후엔 아직 INSERT 전일 수 있다.
     * 픽스처 행(2026-01-15)보다 새로 생긴 행이 나타날 때까지 기다린 뒤 검사한다.
     */
    const newLogFor = async (targetId: string) => {
      for (let i = 0; i < 50; i++) {
        const rows = await t.ds.query(
          `select user_id, details from activity_logs
            where action='group.update' and target_id=$1 and created_at > '2026-01-16'
            order by created_at desc limit 1`,
          [targetId],
        );
        if (rows.length) return rows[0];
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error('새 activity-log 행이 기록되지 않음');
    };

    it('farm context 로 구역 이름 변경 → user_id=농장주, details.actingAdminId=관리자', async () => {
      const res = await http()
        .put(`/api/groups/${id(1, 10)}`)
        .set('Authorization', as('admin'))
        .set(H, USERS.f1.id)
        .send({ name: 'F1-1동-변경' });
      expect(res.status).toBe(200);
      const log = await newLogFor(id(1, 10));
      expect(log.user_id).toBe(USERS.f1.id);
      expect(log.details).toMatchObject({ farmContext: true, actingAdminId: USERS.admin.id, actingAdminUsername: USERS.admin.username });
    });

    it('헤더 없는 쓰기의 activity-log 에는 farm context 표시가 없다', async () => {
      const res = await http().put(`/api/groups/${id(2, 10)}`).set('Authorization', as('f2')).send({ name: 'F2-1동-변경' });
      expect(res.status).toBe(200);
      const log = await newLogFor(id(2, 10));
      expect(log.user_id).toBe(USERS.f2.id);
      expect(log.details?.farmContext).toBeUndefined();
      expect(log.details?.actingAdminId).toBeUndefined();
    });

    it('farm context 에서는 다른 농장 데이터를 수정할 수 없다', async () => {
      const res = await http()
        .put(`/api/groups/${id(2, 10)}`)
        .set('Authorization', as('admin'))
        .set(H, USERS.f1.id)
        .send({ name: 'F1-침범' });
      expect(res.status).toBe(404);
      const [g] = await t.ds.query(`select name from house_groups where id=$1`, [id(2, 10)]);
      expect(g.name).not.toBe('F1-침범');
    });
  });
});
