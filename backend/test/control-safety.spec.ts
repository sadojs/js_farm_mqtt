import request from 'supertest';
import { createTestApp, tokenFor, TestApp } from './utils/test-app';
import { seed, USERS, id } from './utils/seed';
import { DevicesService } from '../src/modules/devices/devices.service';
import { IrrigationSchedulerService } from '../src/modules/automation/irrigation-scheduler.service';

/**
 * 현장 제어 충돌 회귀 테스트 (docs/03-analysis/field-conflict-review-2026-10-05.md A1·A2·A3)
 * MQTT 는 mock — 발행 호출만 검사한다.
 */
describe('제어 안전 — 타이머·룰·재시작', () => {
  let t: TestApp;
  const http = () => request(t.app.getHttpServer());
  const FAN = id(1, 41);
  const RULE = id(1, 50); // 시드: 농장1 유동팬 대상 룰

  const settingsOf = async (deviceId: string) =>
    (await t.ds.query('select device_settings from devices where id = $1', [deviceId]))[0].device_settings || {};
  const setSettings = (deviceId: string, s: any) =>
    t.ds.query('update devices set device_settings = $2::jsonb where id = $1', [deviceId, JSON.stringify(s)]);
  /** mqtt mock 에 기록된 '이 장비 OFF' 발행이 있는지 */
  const offPublished = () => {
    const calls = [
      ...((t.mqtt.controlDevice as jest.Mock)?.mock?.calls ?? []),
      ...((t.mqtt.publishGpioRelay as jest.Mock)?.mock?.calls ?? []),
    ];
    return calls.some((c) => JSON.stringify(c).includes('F1-유동팬') && /false|"OFF"/.test(JSON.stringify(c)));
  };

  beforeAll(async () => {
    t = await createTestApp();
    await seed(t.ds);
    // 시드의 devices.gateway_id 는 문자열 게이트웨이 ID — 장치 제어는 게이트웨이 PK(uuid)로 찾으므로 맞춰 둔다
    await t.ds.query(`update devices set gateway_id = $1 where user_id = $2`, [id(1, 30), USERS.f1.id]);
  });
  afterAll(async () => { await t?.app.close(); });
  beforeEach(() => jest.clearAllMocks());

  it('A1: ON 팬 타이머가 만료되면 OFF 를 발행하고 자동제어로 복귀', async () => {
    await setSettings(FAN, { userOverride: true, overrideUntil: new Date(Date.now() - 1000).toISOString(), overrideValue: true, switchState: true });
    await t.app.get(DevicesService).clearExpiredTimers();
    expect(offPublished()).toBe(true);
    const s = await settingsOf(FAN);
    expect(s.userOverride).toBe(false);
    expect(s.overrideUntil).toBeUndefined();
  });

  it('A1: OFF(정지) 타이머 만료는 OFF 를 추가로 보내지 않음 (방재 팬 정지 등)', async () => {
    await setSettings(FAN, { userOverride: true, overrideUntil: new Date(Date.now() - 1000).toISOString(), overrideValue: false });
    await t.app.get(DevicesService).clearExpiredTimers();
    expect(offPublished()).toBe(false);
  });

  it('A2: 방재·타이머 중 룰을 토글해도 보호가 유지됨', async () => {
    const until = new Date(Date.now() + 30 * 60000).toISOString();
    await setSettings(FAN, { userOverride: true, overrideUntil: until, overrideValue: false, overrideReason: 'protection' });
    const res = await http().patch(`/api/automation/rules/${RULE}/toggle`).set('Authorization', `Bearer ${tokenFor(USERS.f1)}`);
    expect(res.status).toBeLessThan(300);
    const s = await settingsOf(FAN);
    expect(s.userOverride).toBe(true);
    expect(s.overrideUntil).toBe(until);
  });

  it('A3: 재시작 전에 진행 중이던 관수 표시가 남아 있으면 정리하고 중단 기록', async () => {
    await setSettings(FAN, { irrigationRun: { ruleId: RULE, ruleName: '테스트 관수', startedAt: new Date().toISOString(), estimatedEndAt: new Date().toISOString() } });
    await t.app.get(IrrigationSchedulerService).recoverInterruptedRuns();
    const s = await settingsOf(FAN);
    expect(s.irrigationRun).toBeUndefined();
    const logs = await t.ds.query(
      `select count(*)::int as n from automation_logs where rule_id = $1 and conditions_met->>'type' = 'irrigation_interrupted'`, [RULE]);
    expect(logs[0].n).toBe(1);
  });
});
