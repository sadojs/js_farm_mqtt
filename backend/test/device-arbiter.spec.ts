import { createTestApp, TestApp } from './utils/test-app';
import { seed, USERS, id } from './utils/seed';
import { AutomationRunnerService } from '../src/modules/automation/automation-runner.service';
import { AutomationService } from '../src/modules/automation/automation.service';
import { AutomationRule } from '../src/modules/automation/entities/automation-rule.entity';
import { EventsGateway } from '../src/modules/gateway/events.gateway';
import {
  DeviceArbiterService, SOURCE_RANK, PROTECTION_DEVICE_CLASSES, ClaimInput,
} from '../src/modules/automation/device-arbiter.service';

/** 장치 목표 상태 중재기 1단계 — 우선순위 표 · 룰 충돌 · 사용자 결정 */
describe('중재기 — 우선순위 표와 요청 규칙 (단위)', () => {
  const gw = { broadcastAutomationConflict: jest.fn() };
  let arb: DeviceArbiterService;
  const c = (o: Partial<ClaimInput> & { key: string; want: ClaimInput['want'] }): ClaimInput => ({
    deviceKey: 'dev1', source: 'rule', label: o.key, userId: 'u1', deviceName: '환기팬', ...o,
  });
  beforeEach(() => { jest.restoreAllMocks(); gw.broadcastAutomationConflict.mockClear(); arb = new DeviceArbiterService(gw as any); });

  it('우선순위 표: 비상 > 방재 > 고온 > 비 > 수동 > 관수 타이머 > 룰 > 센서 끊김 시간표', () => {
    const order = Object.entries(SOURCE_RANK).sort((a, b) => a[1] - b[1]).map(([k]) => k);
    expect(order).toEqual(['emergency', 'protection', 'high_temp', 'rain', 'manual', 'irrigation_timer', 'rule', 'backup_schedule']);
  });

  it('같은 상태를 원하면 서로 막지 않는다 (R3 — 두 룰 모두 켜기)', () => {
    expect(arb.claim(c({ key: 'A', want: 'on' })).allowed).toBe(true);
    expect(arb.claim(c({ key: 'B', want: 'on' })).allowed).toBe(true);
    expect(gw.broadcastAutomationConflict).not.toHaveBeenCalled();
  });

  it('룰 우선순위가 높은 쪽이 이긴다 — 실행 순서와 무관 (우선순위 역전 해소)', () => {
    // 낮은 룰이 먼저 등록돼도, 높은 룰이 오면 높은 룰이 따라진다
    expect(arb.claim(c({ key: 'low', want: 'off', rulePriority: 1 })).allowed).toBe(true);
    const hi = arb.claim(c({ key: 'high', want: 'on', rulePriority: 5 }));
    expect(hi.allowed).toBe(true);
    // 다음 평가에서 낮은 룰은 밀린다
    const lo = arb.claim(c({ key: 'low', want: 'off', rulePriority: 1 }));
    expect(lo.allowed).toBe(false);
    expect(lo.blockedBy?.key).toBe('high');
  });

  it('주체 순위가 룰 priority 보다 먼저다: 고온 강제열림 > 룰, 룰 > 센서 끊김 시간표', () => {
    arb.claim(c({ deviceKey: 'op', source: 'rule', key: 'R', want: 'close', rulePriority: 99 }));
    expect(arb.claim(c({ deviceKey: 'op', source: 'high_temp', key: 'ht', want: 'open' })).allowed).toBe(true);
    expect(arb.claim(c({ deviceKey: 'op', source: 'rule', key: 'R', want: 'close', rulePriority: 99 })).allowed).toBe(false);

    arb.claim(c({ deviceKey: 'op2', source: 'rule', key: 'R', want: 'open' }));
    expect(arb.claim(c({ deviceKey: 'op2', source: 'backup_schedule', key: 'R2', want: 'close' })).allowed).toBe(false);
  });

  it('수동 조작은 룰보다 우선하고, 룰끼리의 충돌과 달리 팝업을 만들지 않는다', () => {
    arb.claim(c({ key: 'R', want: 'off' }));
    const m = arb.claim(c({ source: 'manual', key: 'user', want: 'on' }));
    expect(m.allowed).toBe(true);
    expect(m.conflict).toBeUndefined();
    expect(gw.broadcastAutomationConflict).not.toHaveBeenCalled();
  });

  it('요청이 갱신되지 않으면 150초 뒤 사라져 승자가 바뀐다', () => {
    let now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    arb.claim(c({ key: 'high', want: 'on', rulePriority: 5 }));
    expect(arb.claim(c({ key: 'low', want: 'off', rulePriority: 1 })).allowed).toBe(false);
    now += 151_000; // high 가 더는 갱신되지 않음(룰 종료)
    expect(arb.claim(c({ key: 'low', want: 'off', rulePriority: 1 })).allowed).toBe(true);
    expect(arb.winnerFor('dev1')?.key).toBe('low');
  });

  it('룰끼리 반대로 제어하면 충돌을 한 번만 알린다', () => {
    arb.claim(c({ key: 'A', want: 'on', rulePriority: 5, label: '온도 룰' }));
    const d = arb.claim(c({ key: 'B', want: 'off', rulePriority: 1, label: '습도 룰' }));
    expect(d.allowed).toBe(false);
    expect(d.conflict?.winner.name).toBe('온도 룰');
    expect(d.conflict?.loser.name).toBe('습도 룰');
    arb.claim(c({ key: 'B', want: 'off', rulePriority: 1, label: '습도 룰' }));
    arb.claim(c({ key: 'A', want: 'on', rulePriority: 5, label: '온도 룰' }));
    expect(gw.broadcastAutomationConflict).toHaveBeenCalledTimes(1);
    expect(arb.listConflicts('u1')).toHaveLength(1);
    expect(arb.listConflicts('other')).toHaveLength(0);
  });

  it('"그대로 두기"를 고르면 하루 동안 다시 묻지 않고, 룰이 철회되면 충돌이 사라진다', () => {
    arb.claim(c({ key: 'A', want: 'on', rulePriority: 5 }));
    const first = arb.claim(c({ key: 'B', want: 'off', rulePriority: 1 }));
    arb.dismissConflict(first.conflict!.id);
    arb.claim(c({ key: 'B', want: 'off', rulePriority: 1 }));
    expect(gw.broadcastAutomationConflict).toHaveBeenCalledTimes(1);
    expect(arb.listConflicts('u1')).toHaveLength(0);

    arb.reset();
    arb.claim(c({ key: 'A', want: 'on', rulePriority: 5 }));
    arb.claim(c({ key: 'B', want: 'off', rulePriority: 1 }));
    arb.releaseAll('rule', 'B');
    expect(arb.listConflicts('u1')).toHaveLength(0);
  });

  it('관수는 방재와 별개 — 방재는 개폐기·유동팬만 다룬다', () => {
    expect([...PROTECTION_DEVICE_CLASSES]).toEqual(['opener', 'fan']);
    // 서로 다른 장치 키(관수 밸브 / 개폐기)는 영향이 없다
    arb.claim(c({ deviceKey: 'opener-pair', source: 'protection', key: 'p', want: 'close' }));
    expect(arb.claim(c({ deviceKey: 'valve', source: 'irrigation_timer', key: 't', want: 'on' })).allowed).toBe(true);
  });
});

describe('중재기 — 룰 실행기 연동 (같은 팬을 반대로 제어하는 두 룰)', () => {
  let t: TestApp;
  const FAN = id(1, 41);
  const SENSOR = id(1, 40);
  const pubs = () => ((t.mqtt.controlDevice as jest.Mock)?.mock?.calls ?? []).map((c: any[]) => JSON.stringify(c[2]));
  let tick = 0;
  const setVal = async (type: string, v: number) => {
    tick += 7;
    await t.ds.query(
      `insert into sensor_data (time, device_id, user_id, sensor_type, value, unit) values ($1,$2,$3,$4,$5,'')`,
      [new Date(Date.now() - 60_000 + tick).toISOString(), SENSOR, USERS.f1.id, type, v],
    );
  };
  const mkRule = async (rid: string, name: string, priority: number, command: 'on' | 'off', field: string) => {
    await t.ds.query(
      `insert into automation_rules (id,user_id,group_id,name,rule_type,enabled,conditions,actions,priority,created_at,updated_at)
       values ($1,$2,$3,$4,'weather',true,$5,$6,$7,now(),now())`,
      [rid, USERS.f1.id, id(1, 10), name,
        JSON.stringify({ logic: 'AND', groups: [{ logic: 'AND', conditions: [
          { type: 'sensor', field, operator: 'gte', value: 30, sensor_device_id: SENSOR }] }], target: {} }),
        JSON.stringify({ targetDeviceId: FAN, targetDeviceIds: [FAN], sensorDeviceIds: [SENSOR], command }),
        priority],
    );
  };
  const run = async (rid: string) => {
    jest.clearAllMocks();
    const rule = await t.ds.getRepository(AutomationRule).findOneByOrFail({ id: rid });
    const r: any = await t.app.get(AutomationRunnerService).executeRule(rule);
    return { reason: r.reason as string | undefined, published: pubs() };
  };
  const reset = async () => {
    await t.ds.query(`delete from automation_rules`);
    await t.ds.query(`delete from sensor_data where device_id=$1`, [SENSOR]);
    await t.ds.query(`update devices set device_settings='{}'::jsonb where id=$1`, [FAN]);
    (t.app.get(AutomationRunnerService) as any).lastState.clear();
    t.app.get(DeviceArbiterService).reset();
  };

  beforeAll(async () => {
    t = await createTestApp();
    await seed(t.ds);
    await t.ds.query(`update devices set gateway_id = $1 where user_id = $2`, [id(1, 30), USERS.f1.id]);
  });
  afterAll(async () => { await t?.app.close(); });
  beforeEach(reset);

  it('우선순위 높은 룰이 켜기를 유지하면 낮은 룰의 끄기는 보내지 않고, 충돌 팝업을 보낸다', async () => {
    const popups: any[] = []; // run() 이 jest.clearAllMocks() 를 호출하므로 호출 기록은 따로 모은다
    jest.spyOn(t.app.get(EventsGateway), 'broadcastAutomationConflict').mockImplementation((_u, p) => { popups.push(p); });
    await mkRule(id(1, 301), 'A-온도(켜기)', 5, 'on', 'temperature');
    await mkRule(id(1, 302), 'B-습도(끄기)', 1, 'off', 'humidity');
    await setVal('temperature', 35); await setVal('humidity', 40);
    // humidity ≥ 30 → B 조건 성립
    expect((await run(id(1, 301))).published).toEqual(['{"state":"ON"}']);
    const b = await run(id(1, 302));
    expect(b.reason).toBe('arbiter_blocked');
    expect(b.published).toEqual([]); // 이전: B 가 OFF 로 덮어씀
    expect(popups).toHaveLength(1);
    expect(popups[0].loser.name).toBe('B-습도(끄기)');
    // 다음 평가들에서도 계속 밀리고 팝업은 반복되지 않는다
    expect((await run(id(1, 302))).reason).toBe('arbiter_blocked');
    expect(popups).toHaveLength(1);
  });

  it('낮은 룰이 먼저 실행돼도(예전 실행 순서) 높은 룰이 오면 높은 룰이 따라진다', async () => {
    await mkRule(id(1, 303), 'low-끄기', 1, 'off', 'humidity');
    await mkRule(id(1, 304), 'high-켜기', 5, 'on', 'temperature');
    await setVal('temperature', 35); await setVal('humidity', 40);
    expect((await run(id(1, 303))).published).toEqual(['{"state":"OFF"}']);
    expect((await run(id(1, 304))).published).toEqual(['{"state":"ON"}']);
    expect((await run(id(1, 303))).reason).toBe('arbiter_blocked');
  });

  it('사용자가 "설정"을 고르면 밀린 룰이 비활성화되고, 이후 장치는 우선 룰만 따른다', async () => {
    await mkRule(id(1, 305), 'A', 5, 'on', 'temperature');
    await mkRule(id(1, 306), 'B', 1, 'off', 'humidity');
    await setVal('temperature', 35); await setVal('humidity', 40);
    await run(id(1, 305)); await run(id(1, 306));
    const svc = t.app.get(AutomationService);
    const [conflict] = svc.getConflicts(USERS.f1.id);
    expect(conflict.loser.name).toBe('B');
    const res: any = await svc.resolveConflict(USERS.f1.id, conflict.id, 'disable_loser');
    expect(res.disabledRule.name).toBe('B');
    const row = (await t.ds.query(`select enabled, disabled_reason from automation_rules where id=$1`, [id(1, 306)]))[0];
    expect(row.enabled).toBe(false);
    expect(row.disabled_reason).toBe('conflict');
    expect(svc.getConflicts(USERS.f1.id)).toHaveLength(0);
  });

  it('"그대로 두기"는 룰을 건드리지 않고 하루 동안 다시 묻지 않는다', async () => {
    const popups: any[] = []; // run() 이 jest.clearAllMocks() 를 호출하므로 호출 기록은 따로 모은다
    jest.spyOn(t.app.get(EventsGateway), 'broadcastAutomationConflict').mockImplementation((_u, p) => { popups.push(p); });
    await mkRule(id(1, 307), 'A', 5, 'on', 'temperature');
    await mkRule(id(1, 308), 'B', 1, 'off', 'humidity');
    await setVal('temperature', 35); await setVal('humidity', 40);
    await run(id(1, 307)); await run(id(1, 308));
    const svc = t.app.get(AutomationService);
    await svc.resolveConflict(USERS.f1.id, svc.getConflicts(USERS.f1.id)[0].id, 'dismiss');
    await run(id(1, 308));
    expect(popups).toHaveLength(1);
    const row = (await t.ds.query(`select enabled from automation_rules where id=$1`, [id(1, 308)]))[0];
    expect(row.enabled).toBe(true);
  });

  it('우선 룰 조건이 풀리면 밀렸던 룰이 다시 동작한다', async () => {
    await mkRule(id(1, 309), 'A', 5, 'on', 'temperature');
    await mkRule(id(1, 310), 'B', 1, 'off', 'humidity');
    await setVal('temperature', 35); await setVal('humidity', 40);
    await run(id(1, 309));
    expect((await run(id(1, 310))).reason).toBe('arbiter_blocked');
    await setVal('temperature', 20); // A 조건 해제 → A 요청 철회
    await run(id(1, 309));
    expect((await run(id(1, 310))).published).toEqual(['{"state":"OFF"}']);
  });
});
