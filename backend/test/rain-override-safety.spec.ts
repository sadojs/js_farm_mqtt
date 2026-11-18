import { createTestApp, TestApp } from './utils/test-app';
import { seed, USERS, id } from './utils/seed';
import { RainOverrideService } from '../src/modules/rain-override/rain-override.service';
import { EventsGateway } from '../src/modules/gateway/events.gateway';

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
