import { createTestApp, TestApp } from './utils/test-app';
import { seed, USERS, id } from './utils/seed';
import { AutomationRunnerService } from '../src/modules/automation/automation-runner.service';
import { AutomationRule } from '../src/modules/automation/entities/automation-rule.entity';
import { EventsGateway } from '../src/modules/gateway/events.gateway';

/**
 * 자동 제어 회귀 — docs/03-analysis/service-review-2026-11-17.md R1~R4.
 * MQTT 는 mock: 실제로 발행된 명령만 검사한다. 룰 형태는 운영에 저장된 것과 같다.
 */
describe('자동 제어 — 히스테리시스 · 룰 충돌 · 센서 신선도', () => {
  let t: TestApp;
  const FAN = id(1, 41);
  const SENSOR = id(1, 40);
  const pubs = () => ((t.mqtt.controlDevice as jest.Mock)?.mock?.calls ?? []).map((c: any[]) => JSON.stringify(c[2]));
  const dbSwitch = async () =>
    (await t.ds.query('select device_settings from devices where id=$1', [FAN]))[0].device_settings?.switchState;
  let tick = 0;
  const setVal = async (type: string, v: number, ageMs = 0) => {
    tick += 7; // sensor_data PK 가 time 단독이라 ms 를 달리한다
    await t.ds.query(
      `insert into sensor_data (time, device_id, user_id, sensor_type, value, unit) values ($1,$2,$3,$4,$5,'')`,
      [new Date(Date.now() - ageMs - 60_000 + tick).toISOString(), SENSOR, USERS.f1.id, type, v],
    );
  };
  const mkRule = async (rid: string, name: string, cond: any) => {
    await t.ds.query(
      `insert into automation_rules (id,user_id,group_id,name,rule_type,enabled,conditions,actions,priority,created_at,updated_at)
       values ($1,$2,$3,$4,'weather',true,$5,$6,1,now(),now())`,
      [rid, USERS.f1.id, id(1, 10), name,
        JSON.stringify({ logic: 'AND', groups: [{ logic: 'AND', conditions: [cond] }], target: {} }),
        JSON.stringify({ targetDeviceId: FAN, targetDeviceIds: [FAN], sensorDeviceIds: [SENSOR] })],
    );
    return t.ds.getRepository(AutomationRule).findOneByOrFail({ id: rid });
  };
  /** 룰 1회 평가 → 그 평가에서 발행된 명령 */
  const run = async (rule: AutomationRule) => {
    jest.clearAllMocks();
    const fresh = await t.ds.getRepository(AutomationRule).findOneByOrFail({ id: rule.id });
    const r: any = await t.app.get(AutomationRunnerService).executeRule(fresh);
    return { reason: r.reason as string | undefined, published: pubs() };
  };
  const ON = ['{"state":"ON"}'];
  const OFF = ['{"state":"OFF"}'];
  const reset = async () => {
    await t.ds.query(`delete from automation_rules`);
    await t.ds.query(`delete from sensor_data where device_id=$1`, [SENSOR]);
    await t.ds.query(`update devices set device_settings='{}'::jsonb where id=$1`, [FAN]);
    (t.app.get(AutomationRunnerService) as any).lastState.clear();
  };
  const relay = { relay: true, relayOnSeconds: 3000, relayOffSeconds: 600 }; // 테스트 동안은 항상 '동작' 구간

  beforeAll(async () => {
    t = await createTestApp();
    await seed(t.ds);
    await t.ds.query(`update devices set gateway_id = $1 where user_id = $2`, [id(1, 30), USERS.f1.id]);
  });
  afterAll(async () => { await t?.app.close(); });
  beforeEach(reset);

  it('R1 주기 없는 히스테리시스(습도 50±2): 52↑ 켜짐 · 사이는 유지 · 48↓ 꺼짐', async () => {
    const r = await mkRule(id(1, 201), 'R1', { type: 'sensor', field: 'humidity', operator: 'gte', value: 50, deviation: 2, sensor_device_id: SENSOR });
    await setVal('humidity', 55);
    expect((await run(r)).published).toEqual(ON);
    await setVal('humidity', 50); // 유지 구간
    expect((await run(r)).published).toEqual([]);
    expect(await dbSwitch()).toBe(true);
    await setVal('humidity', 45);
    expect((await run(r)).published).toEqual(OFF); // 이전: ON 을 다시 보냄
    expect(await dbSwitch()).toBe(false);
    expect((await run(r)).published).toEqual([]); // 꺼진 뒤 반복 발행 없음
    await setVal('humidity', 50); // 꺼진 상태의 유지 구간 → 켜지 않음
    expect((await run(r)).published).toEqual([]);
  });

  it('R2 주기 있는 히스테리시스(습도 80±3): 유지 구간에서 끄지 않는다', async () => {
    const r = await mkRule(id(1, 202), 'R2', { type: 'sensor', field: 'humidity', operator: 'gte', value: 80, deviation: 3, ...relay, sensor_device_id: SENSOR });
    await setVal('humidity', 85);
    expect((await run(r)).published).toEqual(ON);
    await setVal('humidity', 80); // 유지 구간 — 이전: OFF 발행
    expect((await run(r)).published).toEqual([]);
    expect(await dbSwitch()).toBe(true);
    await setVal('humidity', 75);
    expect((await run(r)).published).toEqual(OFF);
  });

  it('R2 서버 재시작(메모리 상태 없음) 뒤에도 유지 구간에서 켜진 팬을 끄지 않는다', async () => {
    const r = await mkRule(id(1, 206), 'R2-restart', { type: 'sensor', field: 'humidity', operator: 'gte', value: 80, deviation: 3, ...relay, sensor_device_id: SENSOR });
    await setVal('humidity', 85);
    await run(r);
    (t.app.get(AutomationRunnerService) as any).lastState.clear(); // 재시작
    await setVal('humidity', 80);
    expect((await run(r)).published).not.toContain(OFF[0]);
    expect(await dbSwitch()).toBe(true);
    await setVal('humidity', 75);
    expect((await run(r)).published).toEqual(OFF);
  });

  it('R3 같은 팬을 룰 2개가 제어: 한 룰이 끝나도 다른 룰이 유효하면 켜진 채 유지, 둘 다 끝나면 꺼짐', async () => {
    const a = await mkRule(id(1, 203), 'A-온도', { type: 'sensor', field: 'temperature', operator: 'gte', value: 30, deviation: 1, ...relay, sensor_device_id: SENSOR });
    const b = await mkRule(id(1, 204), 'B-습도', { type: 'sensor', field: 'humidity', operator: 'gte', value: 80, deviation: 3, ...relay, sensor_device_id: SENSOR });
    await setVal('temperature', 35); await setVal('humidity', 90);
    await run(a); await run(b);
    await setVal('humidity', 70);
    expect((await run(b)).published).toEqual([]); // 이전: OFF 발행 후 A 가 다시 켜지 않음
    expect(await dbSwitch()).toBe(true);
    expect((await run(a)).published).toEqual([]);
    await setVal('temperature', 20);
    expect((await run(a)).published).toEqual(OFF);
    expect(await dbSwitch()).toBe(false);
  });

  it('R4 오래된 센서값으로는 동작하지 않고, 켜져 있었다면 끄고 한 번 알린다', async () => {
    const r = await mkRule(id(1, 205), 'R4', { type: 'sensor', field: 'humidity', operator: 'gte', value: 80, deviation: 3, ...relay, sensor_device_id: SENSOR });
    await setVal('humidity', 95, 3 * 86_400_000); // 3일 전 값만 있음
    expect((await run(r)).published).toEqual([]);

    await setVal('humidity', 95); // 정상 수신 → 켜짐
    expect((await run(r)).published).toEqual(ON);
    // 센서가 죽어 값이 오래됨
    await t.ds.query(`update sensor_data set time = time - interval '2 hours' where device_id=$1`, [SENSOR]);
    const notify = jest.spyOn(t.app.get(EventsGateway), 'sendNotification');
    const res = await run(r);
    expect(res.published).toEqual(OFF);
    const stale = notify.mock.calls.filter((c) => String((c[1] as any)?.title).includes('자동 제어 중지'));
    expect(stale).toHaveLength(1);
    await run(r); // (run 이 mock 기록을 비운다) 다음 평가에서는 같은 알림을 다시 보내지 않음
    expect(notify.mock.calls.filter((c) => String((c[1] as any)?.title).includes('자동 제어 중지'))).toHaveLength(0);
  });
});
