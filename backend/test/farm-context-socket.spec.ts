import { io, Socket } from 'socket.io-client';
import { createTestApp, tokenFor, TestApp } from './utils/test-app';
import { seed, USERS, id } from './utils/seed';
import { EventsGateway } from '../src/modules/gateway/events.gateway';

/** (g) 소켓 농장 room: admin 은 선택 농장 이벤트만, 비관리자 입장은 거부 */
describe('Socket farm context (subscribe:farm)', () => {
  let t: TestApp;
  let url: string;
  let gw: EventsGateway;
  const sockets: Socket[] = [];

  const connect = (key: keyof typeof USERS) =>
    new Promise<Socket>((resolve, reject) => {
      const s = io(url, { auth: { token: tokenFor(USERS[key]) }, transports: ['websocket'], forceNew: true });
      sockets.push(s);
      s.on('connect', () => resolve(s));
      s.on('connect_error', reject);
    });

  const next = <T = any>(s: Socket, event: string, ms = 1500) =>
    new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout: ${event}`)), ms);
      s.once(event, (p: T) => { clearTimeout(timer); resolve(p); });
    });

  /** 이벤트를 일정 시간 모아 deviceId 목록으로 반환 */
  const collect = (s: Socket, event: string, ms = 400) =>
    new Promise<string[]>((resolve) => {
      const got: string[] = [];
      const h = (p: any) => got.push(p.deviceId);
      s.on(event, h);
      setTimeout(() => { s.off(event, h); resolve(got); }, ms);
    });

  const emitStatusForBothFarms = () => {
    gw.broadcastDeviceStatus(USERS.f1.id, id(1, 40), true);
    gw.broadcastDeviceStatus(USERS.f2.id, id(2, 40), true);
  };

  beforeAll(async () => {
    t = await createTestApp();
    await seed(t.ds);
    await t.app.listen(0);
    url = `http://127.0.0.1:${(t.app.getHttpServer().address() as any).port}`;
    gw = t.app.get(EventsGateway);
  });
  afterAll(async () => {
    sockets.forEach((s) => s.close());
    await t?.app.close();
  });

  it('기존 동작 유지: 입장 전 admin 은 모든 농장 이벤트 수신(admins room)', async () => {
    const admin = await connect('admin');
    const p = collect(admin, 'device:status');
    emitStatusForBothFarms();
    expect((await p).sort()).toEqual([id(1, 40), id(2, 40)].sort());
  });

  it('admin 이 농장1 입장 → 농장1 이벤트만 수신', async () => {
    const admin = await connect('admin');
    const joined = next(admin, 'farm:joined');
    admin.emit('subscribe:farm', { farmId: USERS.f1.id });
    expect(await joined).toEqual({ farmId: USERS.f1.id });

    const p = collect(admin, 'device:status');
    emitStatusForBothFarms();
    expect(await p).toEqual([id(1, 40)]);
  });

  it('농장 변경(농장1 → 농장2) 시 이전 농장 room 에서 나간다', async () => {
    const admin = await connect('admin');
    admin.emit('subscribe:farm', { farmId: USERS.f1.id });
    await next(admin, 'farm:joined');
    admin.emit('subscribe:farm', { farmId: USERS.f2.id });
    expect(await next(admin, 'farm:joined')).toEqual({ farmId: USERS.f2.id });

    const p = collect(admin, 'device:status');
    emitStatusForBothFarms();
    expect(await p).toEqual([id(2, 40)]);
  });

  it('unsubscribe(farm) → 농장 room 퇴장, admins room 복귀(다시 전체 수신)', async () => {
    const admin = await connect('admin');
    admin.emit('subscribe:farm', { farmId: USERS.f1.id });
    await next(admin, 'farm:joined');
    const left = next(admin, 'farm:left');
    admin.emit('unsubscribe', { channel: 'farm' });
    expect(await left).toEqual({ farmId: USERS.f1.id });

    const p = collect(admin, 'device:status');
    emitStatusForBothFarms();
    expect((await p).sort()).toEqual([id(1, 40), id(2, 40)].sort());
  });

  it('ack 콜백도 지원', async () => {
    const admin = await connect('admin');
    const ack = await new Promise<any>((resolve) => admin.emit('subscribe:farm', { farmId: USERS.f1.id }, resolve));
    expect(ack).toEqual({ ok: true, farmId: USERS.f1.id });
  });

  it.each([
    ['farm_admin → 다른 농장', 'f1', USERS.f2.id],
    ['farm_user → 다른 농장', 'u1', USERS.f2.id],
  ] as const)('비관리자 입장 거부: %s', async (_l, who, target) => {
    const s = await connect(who);
    const err = next(s, 'farm:error');
    s.emit('subscribe:farm', { farmId: target });
    expect((await err).code).toBe('FARM_CONTEXT_FORBIDDEN');

    const p = collect(s, 'device:status');
    gw.broadcastDeviceStatus(USERS.f2.id, id(2, 40), true);
    expect(await p).toEqual([]);
  });

  it.each([
    ['존재하지 않는 농장', '99999999-0000-4000-8000-000000000001', 'FARM_CONTEXT_NOT_FOUND'],
    ['farm_user id', USERS.u1.id, 'FARM_CONTEXT_NOT_FARM_ADMIN'],
    ['UUID 아님', 'nope', 'FARM_CONTEXT_INVALID'],
  ] as const)('잘못된 대상: %s → farm:error 이고 admins room 유지', async (_l, target, code) => {
    const admin = await connect('admin');
    const err = next(admin, 'farm:error');
    admin.emit('subscribe:farm', { farmId: target });
    expect((await err).code).toBe(code);

    const p = collect(admin, 'device:status');
    emitStatusForBothFarms();
    expect((await p).sort()).toEqual([id(1, 40), id(2, 40)].sort());
  });

  it('기존 unsubscribe(channel=room 이름) 동작은 그대로', async () => {
    const admin = await connect('admin');
    admin.emit('unsubscribe', { channel: 'admins' });
    await new Promise((r) => setTimeout(r, 100));
    const p = collect(admin, 'device:status');
    emitStatusForBothFarms();
    expect(await p).toEqual([]);
  });
});
