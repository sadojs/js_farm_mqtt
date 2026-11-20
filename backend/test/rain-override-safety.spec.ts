import { createTestApp, TestApp } from './utils/test-app';
import { seed, USERS, id } from './utils/seed';
import { RainOverrideService } from '../src/modules/rain-override/rain-override.service';
import { HighTempOverrideService } from '../src/modules/automation/high-temp-override.service';
import { EventsGateway } from '../src/modules/gateway/events.gateway';
import { ControlStatusService } from '../src/modules/automation/control-status.service';

/** 검토 C1·C9 — 우적센서 끊김 만료, 치명 고온이면 비 닫힘 양보 */
describe('비 감지 우회 — 센서 끊김 · 치명 고온', () => {
  let t: TestApp;
  const GROUP = id(1, 10);
  const RAIN = id(1, 60);
  const TEMP = id(1, 40);
  let svc: RainOverrideService;
  const priv = () => svc as any;

  beforeAll(async () => {
    t = await createTestApp();
    await seed(t.ds);
    svc = t.app.get(RainOverrideService);
    await t.ds.query(
      `insert into devices (id,user_id,house_id,gateway_id,friendly_name,name,category,device_type,online,created_at,updated_at)
       select $1,$2,house_id,gateway_id,'F1-우적','F1-우적','sensor','sensor',true,now(),now() from devices where id=$3`,
      [RAIN, USERS.f1.id, TEMP],
    );
    await t.ds.query(
      `insert into env_mappings (id,group_id,role_key,source_type,device_id,sensor_type) values
       (gen_random_uuid(),$1,'rain_detection','sensor',$2,'rain_detection'),
       (gen_random_uuid(),$1,'internal_temp','sensor',$3,'temperature')`,
      [GROUP, RAIN, TEMP],
    );
  });
  afterAll(async () => { await t?.app.close(); });
  beforeEach(async () => {
    await t.ds.query(`delete from sensor_data where device_id=$1`, [TEMP]);
    priv().rainState.clear(); priv().rainSeenAt.clear(); priv().criticalHeat.clear(); priv().closeCycles.clear();
  });
  const setTemp = (v: number) => t.ds.query(
    `insert into sensor_data (time, device_id, user_id, sensor_type, value, unit) values (now(),$1,$2,'temperature',$3,'')`,
    [TEMP, USERS.f1.id, v]);

  it('비 감지 후 신호가 끊기면 해제되어 룰이 다시 동작한다 + 알림 1회', async () => {
    await svc.handleRainSignal(RAIN, true);
    expect(svc.isOpenerRainOverridden(GROUP)).toBe(true);
    const notify = jest.spyOn(t.app.get(EventsGateway), 'sendNotification');
    priv().rainSeenAt.set(GROUP, Date.now() - 31 * 60_000);
    await svc.tickSafety();
    expect(svc.isOpenerRainOverridden(GROUP)).toBe(false);
    expect(svc.getZoneState(GROUP).rainDetected).toBe(false);
    expect(notify.mock.calls.filter((c) => String((c[1] as any)?.title).includes('우적센서 신호 끊김'))).toHaveLength(1);
  });

  it('신호가 계속 오면 비 감지 유지', async () => {
    await svc.handleRainSignal(RAIN, true);
    await svc.handleRainSignal(RAIN, true);
    await svc.tickSafety();
    expect(svc.isOpenerRainOverridden(GROUP)).toBe(true);
  });

  it('비 중 내부온도 40°C 이상 → 닫힘 양보, 38°C 미만 → 복귀', async () => {
    await svc.handleRainSignal(RAIN, true);
    await setTemp(41);
    await svc.tickSafety();
    expect(svc.isOpenerRainOverridden(GROUP)).toBe(false);
    expect(svc.getZoneState(GROUP).rainDetected).toBe(true);
    await t.ds.query(`delete from sensor_data where device_id=$1`, [TEMP]);
    await setTemp(39); // 38~40 사이는 유지(경계 반복 방지)
    await svc.tickSafety();
    expect(svc.isOpenerRainOverridden(GROUP)).toBe(false);
    await t.ds.query(`delete from sensor_data where device_id=$1`, [TEMP]);
    await setTemp(30);
    await svc.tickSafety();
    expect(svc.isOpenerRainOverridden(GROUP)).toBe(true);
  });

  it('온도 센서가 끊겨 값이 없으면 고온 양보를 시작하지 않는다', async () => {
    await svc.handleRainSignal(RAIN, true);
    await svc.tickSafety();
    expect(svc.isOpenerRainOverridden(GROUP)).toBe(true);
  });
});

/** 우선순위: 고온 강제열림 > 비 닫힘 — 이슬비에 닫혀 고온 피해가 나지 않게 */
describe('고온 > 비 닫힘', () => {
  let t: TestApp;
  const GROUP = id(1, 10);
  const RAIN = id(1, 60);
  const TEMP = id(1, 40);
  let rain: RainOverrideService;
  let hot: HighTempOverrideService;
  const rp = () => rain as any;

  beforeAll(async () => {
    t = await createTestApp();
    await seed(t.ds);
    rain = t.app.get(RainOverrideService);
    hot = t.app.get(HighTempOverrideService);
    await t.ds.query(
      `insert into devices (id,user_id,house_id,gateway_id,friendly_name,name,category,device_type,online,created_at,updated_at)
       select $1,$2,house_id,gateway_id,'F1-우적','F1-우적','sensor','sensor',true,now(),now() from devices where id=$3`,
      [RAIN, USERS.f1.id, TEMP],
    );
    await t.ds.query(
      `insert into env_mappings (id,group_id,role_key,source_type,device_id,sensor_type) values
       (gen_random_uuid(),$1,'rain_detection','sensor',$2,'rain_detection'),
       (gen_random_uuid(),$1,'internal_temp','sensor',$3,'temperature')`,
      [GROUP, RAIN, TEMP],
    );
    await t.ds.query(
      `insert into fallback_configs (gateway_id, high_temp_override_enabled, high_temp_open_threshold)
       values ('f1-gw', true, 30) on conflict (gateway_id) do update set high_temp_override_enabled=true, high_temp_open_threshold=30`);
  });
  afterAll(async () => { await t?.app.close(); });
  beforeEach(async () => {
    await t.ds.query(`delete from sensor_data where device_id=$1`, [TEMP]);
    rp().rainState.clear(); rp().rainSeenAt.clear(); rp().criticalHeat.clear();
    rp().closeCycles.clear(); rp().highTempYield.clear();
    (hot as any).activeZones.clear();
  });
  const setTemp = async (v: number) => {
    await t.ds.query(`delete from sensor_data where device_id=$1`, [TEMP]);
    await t.ds.query(
      `insert into sensor_data (time, device_id, user_id, sensor_type, value, unit) values (now(),$1,$2,'temperature',$3,'')`,
      [TEMP, USERS.f1.id, v]);
  };

  it('제어 현황: 비+고온이면 고온이 이기고, 수동 조작은 그보다 위, 고온이 풀리면 비가 이긴다', async () => {
    const cs = t.app.get(ControlStatusService);
    const OPEN = id(1, 42);
    const CLOSE = id(1, 43);
    const winnerOf = async () => (await cs.getStatus(OPEN, USERS.f1.id));
    await setTemp(32);
    await rain.handleRainSignal(RAIN, true);
    let st = await winnerOf();
    expect(st.deviceClass).toBe('opener');
    expect(st.winner?.source).toBe('high_temp');
    expect(st.ladder.find((r) => r.source === 'rain')?.state).toBe('lose');
    expect(st.lock).toBeNull();

    // 닫힘 쪽에 수동 타이머 → 수동이 맨 위
    const until = new Date(Date.now() + 30 * 60000).toISOString();
    await t.ds.query(`update devices set device_settings = $2::jsonb where id=$1`,
      [CLOSE, JSON.stringify({ userOverride: true, overrideUntil: until, overrideDirection: 'close' })]);
    st = await winnerOf();
    expect(st.winner?.source).toBe('manual');
    expect(st.manual.releasable).toBe(true);
    expect(st.ladder.find((r) => r.source === 'high_temp')?.state).toBe('lose');

    // 수동 해제 + 고온 해제 → 비 감지 자동 닫힘이 이긴다
    await t.ds.query(`update devices set device_settings='{}'::jsonb where id=$1`, [CLOSE]);
    await setTemp(27);
    await rain.tickSafety();
    st = await winnerOf();
    expect(st.winner?.source).toBe('rain');
    // 다른 농장 사용자는 볼 수 없다
    await expect(cs.getStatus(OPEN, USERS.f2.id)).rejects.toThrow();
  });

  it('비가 와도 임계값 이상이면 닫지 않는다(고온 강제열림 유지)', async () => {
    await setTemp(32);
    await rain.handleRainSignal(RAIN, true);
    expect(rp().closeCycles.has(GROUP)).toBe(false);
    expect(rain.isOpenerRainOverridden(GROUP)).toBe(false);
    expect(await hot.isActive(GROUP)).toBe(true);
  });

  it('비 중 고온이 풀리면 비 닫힘이 시작되고, 다시 고온이면 양보한다', async () => {
    await setTemp(32);
    await rain.handleRainSignal(RAIN, true);
    await setTemp(27);
    await rain.tickSafety();
    expect(rain.isOpenerRainOverridden(GROUP)).toBe(true);
    await setTemp(31);
    await rain.tickSafety();
    expect(rain.isOpenerRainOverridden(GROUP)).toBe(false);
    expect(rp().closeCycles.has(GROUP)).toBe(false);
  });

  it('임계값 바로 아래(1℃ 이내)에서는 열림 유지 — 닫힘/열림 떨림 방지', async () => {
    await setTemp(31);
    await rain.handleRainSignal(RAIN, true);
    await setTemp(29.5);
    await rain.tickSafety();
    expect(rain.isOpenerRainOverridden(GROUP)).toBe(false);
  });

  it('고온 설정이 꺼져 있으면 비는 예전처럼 닫는다', async () => {
    await t.ds.query(`update fallback_configs set high_temp_override_enabled=false where gateway_id='f1-gw'`);
    (hot as any).cfgCache.clear();
    await setTemp(35);
    await rain.handleRainSignal(RAIN, true);
    expect(rain.isOpenerRainOverridden(GROUP)).toBe(true);
    await t.ds.query(`update fallback_configs set high_temp_override_enabled=true where gateway_id='f1-gw'`);
    (hot as any).cfgCache.clear();
  });
});
