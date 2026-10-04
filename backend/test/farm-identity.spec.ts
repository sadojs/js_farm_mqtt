import request from 'supertest';
import { createTestApp, tokenFor, TestApp } from './utils/test-app';
import { seed, USERS, id } from './utils/seed';
import { AutomationRunnerService } from '../src/modules/automation/automation-runner.service';

/**
 * 농장 이름 분리(migration 051) · 소속 농장 검증 · 삭제 보호 · 자동화 날씨 농장 구분.
 * 시드: 농장1(F1-) / 농장2(F2-) 각각 구역·게이트웨이·장치·동작 이력 보유, 농장1 에 농장 사용자 1명.
 */
describe('농장 이름 · 계정 보호', () => {
  let t: TestApp;
  const http = () => request(t.app.getHttpServer());
  const as = (key: keyof typeof USERS) => `Bearer ${tokenFor(USERS[key])}`;

  beforeAll(async () => {
    t = await createTestApp();
    await seed(t.ds);
  });
  afterAll(async () => { await t?.app.close(); });

  describe('농장 이름', () => {
    it('농장 관리자 생성 시 farmName 저장, 비우면 계정 이름으로', async () => {
      const a = await http().post('/api/users').set('Authorization', as('admin'))
        .send({ username: 'fi-named', password: 'secret12', name: '김농부', role: 'farm_admin', farmName: '  하교농장 ' });
      expect(a.status).toBe(201);
      expect(a.body.farmName).toBe('하교농장');

      const b = await http().post('/api/users').set('Authorization', as('admin'))
        .send({ username: 'fi-default', password: 'secret12', name: '이농부', role: 'farm_admin' });
      expect(b.body.farmName).toBe('이농부');
    });

    it('농장 사용자·플랫폼 관리자는 farmName 을 보내도 저장하지 않음', async () => {
      const res = await http().post('/api/users').set('Authorization', as('admin'))
        .send({ username: 'fi-worker', password: 'secret12', name: '작업자', role: 'farm_user', parentUserId: USERS.f1.id, farmName: '무시' });
      expect(res.status).toBe(201);
      expect(res.body.farmName).toBeNull();
    });

    it('농장 이름 변경 → 목록·소속 농장·구역 소유자·로그인 정보에 반영', async () => {
      const upd = await http().put(`/api/users/${USERS.f1.id}`).set('Authorization', as('admin')).send({ farmName: '새이름농장' });
      expect(upd.status).toBe(200);
      expect(upd.body.farmName).toBe('새이름농장');
      expect(upd.body.name).toBe(USERS.f1.name); // 사람 이름은 그대로

      const farms = await http().get('/api/users/farm-admins').set('Authorization', as('admin'));
      expect(farms.body.find((f: any) => f.id === USERS.f1.id).farmName).toBe('새이름농장');

      const users = await http().get('/api/users').set('Authorization', as('admin'));
      const member = users.body.find((u: any) => u.id === USERS.u1.id);
      expect(member.parentFarmName).toBe('새이름농장');
      expect(member.parentUserName).toBe(USERS.f1.name);

      const groups = await http().get('/api/groups').set('Authorization', as('admin'));
      expect(groups.body.find((g: any) => g.userId === USERS.f1.id).ownerFarmName).toBe('새이름농장');

      const meFarm = await http().get('/api/auth/me').set('Authorization', as('f1'));
      expect(meFarm.body.farmName).toBe('새이름농장');
      const meMember = await http().get('/api/auth/me').set('Authorization', as('u1'));
      expect(meMember.body.farmName).toBe('새이름농장'); // 농장 사용자 = 소속 농장 이름
    });
  });

  describe('소속 농장 검증', () => {
    it('농장 사용자는 소속 농장이 필수', async () => {
      const res = await http().post('/api/users').set('Authorization', as('admin'))
        .send({ username: 'fi-orphan', password: 'secret12', name: '고아', role: 'farm_user' });
      expect(res.status).toBe(400);
    });

    it('소속 농장은 농장 관리자 계정이어야 함', async () => {
      const res = await http().post('/api/users').set('Authorization', as('admin'))
        .send({ username: 'fi-badparent', password: 'secret12', name: '잘못', role: 'farm_user', parentUserId: USERS.admin.id });
      expect(res.status).toBe(400);
    });

    it('농장 데이터가 있는 농장 관리자의 역할 변경은 차단', async () => {
      const res = await http().put(`/api/users/${USERS.f2.id}`).set('Authorization', as('admin')).send({ role: 'farm_user', parentUserId: USERS.f1.id });
      expect(res.status).toBe(409);
      const after = await t.ds.query('select role from users where id = $1', [USERS.f2.id]);
      expect(after[0].role).toBe('farm_admin');
    });
  });

  describe('삭제 보호', () => {
    it('구역·장치·소속 사용자가 있는 농장 관리자 삭제는 409, 데이터 그대로', async () => {
      const res = await http().delete(`/api/users/${USERS.f1.id}`).set('Authorization', as('admin'));
      expect(res.status).toBe(409);
      expect(res.body.message).toContain('비활성');
      const [{ count }] = await t.ds.query('select count(*)::int as count from house_groups where user_id = $1', [USERS.f1.id]);
      expect(count).toBeGreaterThan(0);
    });

    it('동작 이력이 있는 계정 삭제는 409 (DB 오류 500 아님)', async () => {
      await t.ds.query(
        `insert into activity_logs (id, user_id, user_name, action, target_type, created_at) values ($1,$2,'작업자','device.control','device',now())`,
        [id(1, 99), USERS.u1.id],
      );
      const res = await http().delete(`/api/users/${USERS.u1.id}`).set('Authorization', as('admin'));
      expect(res.status).toBe(409);
    });

    it('데이터 없는 농장 관리자는 삭제 가능', async () => {
      const created = await http().post('/api/users').set('Authorization', as('admin'))
        .send({ username: 'fi-empty', password: 'secret12', name: '빈농장', role: 'farm_admin', farmName: '빈농장' });
      const res = await http().delete(`/api/users/${created.body.id}`).set('Authorization', as('admin'));
      expect(res.status).toBe(200);
    });
  });

  describe('자동화 날씨 조건 — 구역을 소유한 농장의 날씨만', () => {
    it('농장1 구역의 weather 매핑은 농장2 의 더 최신 날씨가 아니라 농장1 날씨를 읽는다', async () => {
      // 시드: 농장1 날씨 11℃(00:00:01), 농장2 날씨 12℃(00:00:02, 더 최신)
      await t.ds.query(
        `insert into env_mappings (id, group_id, role_key, source_type, weather_field, created_at, updated_at)
         values ($1,$2,'outdoor_temp','weather','temperature',now(),now())`,
        [id(1, 95), id(1, 10)],
      );
      const runner = t.app.get(AutomationRunnerService) as any;
      const map = await runner.getEnvRoleMap(id(1, 10));
      expect(Number(map.outdoor_temp)).toBe(11);
    });
  });
});
