import request from 'supertest';
import { createTestApp, tokenFor, TestApp } from './utils/test-app';
import { seed, USERS, id } from './utils/seed';
import { isGatewayLatched } from '../src/common/emergency/emergency-latch';

/** 비상 정지 — 정지 유지(래치) / 해제 */
describe('비상 정지 유지(래치)', () => {
  let t: TestApp;
  const http = () => request(t.app.getHttpServer());
  const as = (key: keyof typeof USERS) => `Bearer ${tokenFor(USERS[key])}`;
  const FAN = id(1, 41);
  const control = (value: boolean, who: keyof typeof USERS = 'f1') =>
    http().post(`/api/devices/${FAN}/control`).set('Authorization', as(who)).send({ commands: [{ code: 'switch_1', value }] });

  beforeAll(async () => {
    t = await createTestApp();
    await seed(t.ds);
    await t.ds.query(`update devices set gateway_id = $1 where user_id = $2`, [id(1, 30), USERS.f1.id]);
  });
  afterAll(async () => { await t?.app.close(); });
  beforeEach(() => jest.clearAllMocks());

  it('정지 전에는 수동 ON 가능', async () => {
    expect((await control(true)).status).toBeLessThan(300);
  });

  it('정지: 상태 저장 + 래치 등록 + Pi 에 유지 상태(retained) 발행 + 실행자 기록', async () => {
    const res = await http().post('/api/fallback-config/f1-gw/emergency-stop').set('Authorization', as('f1')).send({ by: '위조된값' });
    expect(res.status).toBe(201);
    expect(res.body.active).toBe(true);
    expect(res.body.stoppedByName).toBe(USERS.f1.username); // 본문 by 가 아니라 로그인 사용자
    expect(isGatewayLatched('f1-gw')).toBe(true);
    expect(isGatewayLatched(id(1, 30))).toBe(true);
    const calls = (t.mqtt.publishEmergencyState as jest.Mock).mock.calls;
    expect(calls[0][0]).toBe('f1-gw');
    expect(calls[0][1].active).toBe(true);
    const log = await t.ds.query(`select count(*)::int as n from activity_logs where action = 'gateway.emergency_stop'`);
    expect(log[0].n).toBe(1);
  });

  it('정지 중: 수동 ON 거부(409), OFF 는 허용', async () => {
    const on = await control(true);
    expect(on.status).toBe(409);
    expect(on.body.message).toContain('비상 정지');
    expect((await control(false)).status).toBeLessThan(300);
  });

  it('정지 중: 다른 농장 장비는 영향 없음', async () => {
    expect(isGatewayLatched('f2-gw')).toBe(false);
  });

  it('상태 조회: GET 설정에 emergency 포함', async () => {
    const res = await http().get('/api/fallback-config/f1-gw/emergency').set('Authorization', as('f1'));
    expect(res.body.active).toBe(true);
  });

  it('해제: 래치 해제 + Pi 에 해제 발행 → 다시 ON 가능', async () => {
    const res = await http().post('/api/fallback-config/f1-gw/emergency-release').set('Authorization', as('f1'));
    expect(res.status).toBe(201);
    expect(res.body.active).toBe(false);
    expect(isGatewayLatched('f1-gw')).toBe(false);
    const calls = (t.mqtt.publishEmergencyState as jest.Mock).mock.calls;
    expect(calls[calls.length - 1][1].active).toBe(false);
    expect((await control(true)).status).toBeLessThan(300);
  });

  it('정지 상태가 아니면 해제는 409', async () => {
    const res = await http().post('/api/fallback-config/f1-gw/emergency-release').set('Authorization', as('f1'));
    expect(res.status).toBe(409);
  });

  it('다른 농장 관리자는 정지 불가(403)', async () => {
    const res = await http().post('/api/fallback-config/f1-gw/emergency-stop').set('Authorization', as('f2')).send({});
    expect(res.status).toBe(403);
    expect(isGatewayLatched('f1-gw')).toBe(false);
  });
});
