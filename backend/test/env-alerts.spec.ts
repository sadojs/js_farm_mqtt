import { createTestApp, TestApp } from './utils/test-app';
import { seed, USERS, id } from './utils/seed';
import { EventsGateway } from '../src/modules/gateway/events.gateway';
import { EnvAlertsService } from '../src/modules/env-alerts/env-alerts.service';

/** 환경 경보 — 지속 시간(기본 5분)을 넘길 때만 한 번, 정상 복귀 때 한 번 (검토 §7-9 ③) */
describe('환경 경보', () => {
  let t: TestApp;
  let svc: EnvAlertsService;
  const GROUP = id(1, 10);
  const SENSOR = id(1, 40);
  const sent: any[] = [];

  beforeAll(async () => {
    t = await createTestApp();
    await seed(t.ds);
    svc = t.app.get(EnvAlertsService);
    await t.ds.query(
      `insert into env_mappings (id,group_id,role_key,source_type,device_id,sensor_type) values
       (gen_random_uuid(),$1,'internal_temp','sensor',$2,'temperature')`, [GROUP, SENSOR]);
    jest.spyOn(t.app.get(EventsGateway), 'sendNotification').mockImplementation((_u: any, n: any) => { sent.push(n); });
  });
  afterAll(async () => { await t?.app.close(); });
  beforeEach(async () => {
    sent.length = 0;
    svc.resetTracks();
    await t.ds.query(`delete from env_alert_settings`);
  });

  let sec = 0;
  const setTemp = async (v: number) => {
    sec += 1;
    await t.ds.query(
      `insert into sensor_data (time, device_id, user_id, sensor_type, value, unit) values (now() - make_interval(secs => $4), $1,$2,'temperature',$3,'°C')`,
      [SENSOR, USERS.f1.id, v, 60 - (sec % 50)]);
  };

  it('저장 전에는 기본값(지속 5분)을 보여 주고 감시하지 않는다', async () => {
    const s = await svc.get(USERS.f1.id, GROUP);
    expect(s.saved).toBe(false);
    expect(s.items.every((i) => i.minutes === 5)).toBe(true);
    await setTemp(40);
    await svc.tick(Date.now());
    await svc.tick(Date.now() + 10 * 60_000);
    expect(sent).toHaveLength(0);
  });

  it('5분 넘게 이어질 때 한 번 알리고, 되풀이하지 않고, 정상 복귀 때 한 번 더 알린다', async () => {
    await svc.save(USERS.f1.id, GROUP, { items: [{ key: 'temp_high', enabled: true, threshold: 35, minutes: 5 }] });
    await setTemp(36.2);
    const t0 = Date.now();
    await svc.tick(t0);
    await svc.tick(t0 + 4 * 60_000);
    expect(sent).toHaveLength(0); // 아직 5분 전
    await svc.tick(t0 + 5 * 60_000);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: 'warning', title: '🌡 F1-1동 내부 온도 높음' });
    expect(sent[0].message).toContain('36.2℃가 5분째');
    await svc.tick(t0 + 6 * 60_000);
    expect(sent).toHaveLength(1); // 되풀이 안 함

    await setTemp(34.8); // 기준-0.5 위 → 아직 복귀 아님
    await svc.tick(t0 + 7 * 60_000);
    expect(sent).toHaveLength(1);
    await setTemp(33.8);
    await svc.tick(t0 + 24 * 60_000);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({ type: 'info', title: '✔ F1-1동 내부 온도 정상 복귀' });
    expect(sent[1].message).toContain('경보 지속 시간 24분');
  });

  it('잠깐 튀었다 내려가면 알리지 않는다', async () => {
    await svc.save(USERS.f1.id, GROUP, { items: [{ key: 'temp_high', enabled: true, threshold: 35, minutes: 5 }] });
    const t0 = Date.now();
    await setTemp(37);
    await svc.tick(t0);
    await setTemp(30);
    await svc.tick(t0 + 2 * 60_000);
    await setTemp(37);
    await svc.tick(t0 + 4 * 60_000);
    await svc.tick(t0 + 8 * 60_000); // 다시 넘은 지 4분
    expect(sent).toHaveLength(0);
  });

  it('잘못된 값은 거부하고, 다른 농장 구역은 볼 수 없다', async () => {
    await expect(svc.save(USERS.f1.id, GROUP, { items: [{ key: 'temp_high', minutes: 0 }] })).rejects.toThrow('지속 시간');
    await expect(svc.get(USERS.f2.id, GROUP)).rejects.toThrow();
  });
});
