import request from 'supertest';
import { io, Socket } from 'socket.io-client';
import { createTestApp, tokenFor, TestApp } from './utils/test-app';
import { seed, USERS } from './utils/seed';
import { EventsGateway } from '../src/modules/gateway/events.gateway';

/**
 * 알림 문구는 받는 사람에 따라 다르다.
 *  - 농장(농장 관리자): 원래 문구
 *  - 플랫폼 관리자: 어느 농장의 문제인지 농장 이름·담당 계정을 붙인 문구 (농장 보기 중에도 관리자 문구만)
 */
describe('알림 — 플랫폼 관리자용 문구 분리', () => {
  let t: TestApp;
  let url: string;
  let gw: EventsGateway;
  const sockets: Socket[] = [];
  const http = () => request(t.app.getHttpServer());

  const connect = (key: keyof typeof USERS) =>
    new Promise<Socket>((resolve, reject) => {
      const s = io(url, { auth: { token: tokenFor(USERS[key]) }, transports: ['websocket'], forceNew: true });
      sockets.push(s);
      s.on('connect', () => resolve(s));
      s.on('connect_error', reject);
    });

  /** 일정 시간 동안 받은 notification:new 전부 */
  const collect = (s: Socket, ms = 500) =>
    new Promise<any[]>((resolve) => {
      const got: any[] = [];
      const h = (p: any) => got.push(p);
      s.on('notification:new', h);
      setTimeout(() => { s.off('notification:new', h); resolve(got); }, ms);
    });

  const alert = { type: 'warning', title: '🔌 게이트웨이 오프라인', message: '게이트웨이 연결이 끊겼습니다.' };

  beforeAll(async () => {
    t = await createTestApp();
    await seed(t.ds);
    await t.ds.query(`update users set farm_name = '하교농장' where id = $1`, [USERS.f1.id]);
    await t.app.listen(0);
    url = `http://127.0.0.1:${(t.app.getHttpServer().address() as any).port}`;
    gw = t.app.get(EventsGateway);
  });
  afterAll(async () => {
    sockets.forEach((s) => s.close());
    await t?.app.close();
  });

  it('농장 관리자는 원래 문구, 플랫폼 관리자는 농장 이름이 붙은 문구를 받는다', async () => {
    const farm = await connect('f1');
    const admin = await connect('admin');
    const pf = collect(farm);
    const pa = collect(admin);
    gw.sendNotification(USERS.f1.id, alert);

    const [farmGot, adminGot] = [await pf, await pa];
    expect(farmGot).toEqual([alert]);
    expect(adminGot).toHaveLength(1);
    expect(adminGot[0].title).toBe('[하교농장] 🔌 게이트웨이 오프라인');
    expect(adminGot[0].message).toContain('하교농장');
    expect(adminGot[0].message).toContain('@f1admin');
    expect(adminGot[0].message).toContain(alert.message);
    expect(adminGot[0].farmId).toBe(USERS.f1.id);
    expect(adminGot[0].message).not.toBe(alert.message);
  });

  it('관리자가 농장 보기(subscribe:farm) 중이어도 농장용 문구는 받지 않고 관리자 문구 1건만', async () => {
    const admin = await connect('admin');
    await new Promise((r) => admin.emit('subscribe:farm', { farmId: USERS.f1.id }, r));
    const pa = collect(admin);
    gw.sendNotification(USERS.f1.id, alert);
    const got = await pa;
    expect(got).toHaveLength(1);
    expect(got[0].title).toBe('[하교농장] 🔌 게이트웨이 오프라인');
  });

  it('농장 사용자(하위 계정)도 소속 농장 알림·실시간 장비 상태를 농장용 문구로 받는다', async () => {
    const member = await connect('u1');
    const pn = collect(member);
    const ps = new Promise<any[]>((resolve) => {
      const got: any[] = [];
      member.on('device:status', (p) => got.push(p));
      setTimeout(() => resolve(got), 500);
    });
    gw.sendNotification(USERS.f1.id, alert);
    gw.broadcastDeviceStatus(USERS.f1.id, 'dev-x', true);
    gw.sendNotification(USERS.f2.id, alert); // 다른 농장 알림은 받지 않음
    expect(await pn).toEqual([alert]);
    expect((await ps).map((p) => p.deviceId)).toEqual(['dev-x']);
  });

  it('다른 농장 알림도 관리자에게는 그 농장 이름으로 (farm_name 없으면 계정 이름)', async () => {
    const admin = await connect('admin');
    const pa = collect(admin);
    gw.sendNotification(USERS.f2.id, alert);
    const got = await pa;
    expect(got[0].title).toBe(`[${USERS.f2.name}] ${alert.title}`);
  });

  describe('날씨 — 농장 위치 미설정 안내', () => {
    it('농장 관리자에게는 농장용 안내', async () => {
      const res = await http().get('/api/dashboard/weather').set('Authorization', `Bearer ${tokenFor(USERS.f1)}`);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('FARM_ADDRESS_MISSING');
      expect(res.body.message).toContain('플랫폼 관리자에게');
      expect(res.body.message).not.toContain('하교농장');
    });

    it('플랫폼 관리자가 농장 보기 중이면 농장 이름·계정·고칠 곳을 알려주는 관리자 안내', async () => {
      const res = await http().get('/api/dashboard/weather')
        .set('Authorization', `Bearer ${tokenFor(USERS.admin)}`)
        .set('X-Farm-Context', USERS.f1.id);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('FARM_ADDRESS_MISSING');
      expect(res.body.message).toContain('[하교농장]');
      expect(res.body.message).toContain('@f1admin');
      expect(res.body.message).toContain('농장 위치');
    });
  });
});
