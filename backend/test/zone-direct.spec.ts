import request from 'supertest';
import { createTestApp, tokenFor, TestApp } from './utils/test-app';
import { seed, USERS, id } from './utils/seed';

/**
 * 게이트웨이 → 구역 직접 연결 (migration 053, '하우스' 중간 단계 제거 1단계)
 *  - 구역당 게이트웨이 1대
 *  - 장치의 구역 = 붙어 있는 게이트웨이의 구역 (연결 변경 시 장치가 따라감)
 *  - 게이트웨이 없는 구역(방재·일꾼·농작업만 쓰는 구역)은 영향 없음
 */
describe('구역 ↔ 게이트웨이 직접 연결', () => {
  let t: TestApp;
  const http = () => request(t.app.getHttpServer());
  const as = (key: keyof typeof USERS) => `Bearer ${tokenFor(USERS[key])}`;
  const ZONE1 = id(1, 10);
  const GW1 = id(1, 30);
  const GW1B = id(1, 31);
  const FAN = id(1, 41);
  let zone2: string;

  const groupDevices = async (groupId: string) => {
    const res = await http().get('/api/groups').set('Authorization', as('f1'));
    const g = res.body.find((x: any) => x.id === groupId);
    return (g?.devices ?? []).map((d: any) => d.id);
  };

  beforeAll(async () => {
    t = await createTestApp();
    await seed(t.ds);
    // 시드의 devices.gateway_id 는 문자열 ID — 게이트웨이 PK 로 맞춤
    await t.ds.query(`update devices set gateway_id = $1 where user_id = $2`, [GW1, USERS.f1.id]);
    // 농장1 두 번째 게이트웨이(구역 미연결)
    await t.ds.query(
      `insert into gateways (id, user_id, gateway_id, name, status, agent_status, created_at, updated_at)
       values ($1,$2,'f1-gw-b','F1-게이트웨이B','offline','offline',now(),now())`,
      [GW1B, USERS.f1.id],
    );
    const res = await http().post('/api/groups').set('Authorization', as('f1')).send({ name: 'F1-2동' });
    zone2 = res.body.id;
  });
  afterAll(async () => { await t?.app.close(); });

  it('구역 목록: 게이트웨이의 장치가 그 구역에 포함', async () => {
    expect(await groupDevices(ZONE1)).toContain(FAN);
  });

  it('구역당 게이트웨이 1대 — 이미 연결된 구역에 두 번째 게이트웨이 연결은 409', async () => {
    const res = await http().patch(`/api/gateways/${GW1B}/zone`).set('Authorization', as('f1')).send({ groupId: ZONE1 });
    expect(res.status).toBe(409);
    expect(res.body.message).toContain('1대');
  });

  it('게이트웨이를 다른 구역으로 옮기면 장치도 그 구역으로 (장치 house 값과 무관)', async () => {
    await t.ds.query(`update devices set house_id = null where gateway_id = $1`, [GW1]); // 어긋난/빈 house 값이어도
    const res = await http().patch(`/api/gateways/${GW1}/zone`).set('Authorization', as('f1')).send({ groupId: zone2 });
    expect(res.status).toBeLessThan(300);
    expect(await groupDevices(zone2)).toContain(FAN);
    expect(await groupDevices(ZONE1)).not.toContain(FAN);
  });

  it('비워진 구역에는 다른 게이트웨이 연결 가능', async () => {
    const res = await http().patch(`/api/gateways/${GW1B}/zone`).set('Authorization', as('f1')).send({ groupId: ZONE1 });
    expect(res.status).toBeLessThan(300);
  });

  it('자동화: 장치 house 값이 비어도 게이트웨이의 구역으로 대상 장치를 찾는다', async () => {
    await t.ds.query(`update automation_rules set group_id = $1 where id = $2`, [zone2, id(1, 50)]);
    const runner: any = t.app.get(require('../src/modules/automation/automation-runner.service').AutomationRunnerService);
    const rule = (await t.ds.query('select * from automation_rules where id = $1', [id(1, 50)]))[0];
    const devices = await runner.findTargetDevices({ ...rule, userId: rule.user_id, groupId: rule.group_id, conditions: rule.conditions, actions: rule.actions });
    expect(devices.map((d: any) => d.id)).toContain(FAN);
  });

  it('연결 해제하면 구역에서 장치가 빠진다', async () => {
    const res = await http().patch(`/api/gateways/${GW1}/zone`).set('Authorization', as('f1')).send({ groupId: null });
    expect(res.status).toBeLessThan(300);
    expect(await groupDevices(zone2)).not.toContain(FAN);
  });

  it('게이트웨이 없는 구역(방재·일꾼·농작업 전용)은 그대로 동작', async () => {
    const res = await http().post('/api/groups').set('Authorization', as('f1')).send({ name: 'F1-방재전용' });
    expect(res.status).toBe(201);
    const list = await http().get('/api/groups').set('Authorization', as('f1'));
    const g = list.body.find((x: any) => x.id === res.body.id);
    expect(g).toBeTruthy();
    expect(g.devices).toEqual([]);
  });

  it('게이트웨이 수정 시 groupId 로 구역 지정 (콘솔·기존 앱 편집 창)', async () => {
    const res = await http().put(`/api/gateways/${GW1}`).set('Authorization', as('admin')).send({ name: 'F1-게이트웨이', groupId: zone2 });
    expect(res.status).toBeLessThan(300);
    const gw = (await t.ds.query('select group_id from gateways where id = $1', [GW1]))[0];
    expect(gw.group_id).toBe(zone2);
  });
});
