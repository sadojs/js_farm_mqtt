import { createTestApp, TestApp } from './utils/test-app';
import { seed, USERS } from './utils/seed';
import { IrrigationSchedulerService } from '../src/modules/automation/irrigation-scheduler.service';
import { DevicesService } from '../src/modules/devices/devices.service';
import { EventsGateway } from '../src/modules/gateway/events.gateway';

/** 검토 C4·C5 — 관수 명령 재시도와 실패 알림, 서버가 꺼져 있어 놓친 관수 알림 */
describe('관수 — 명령 재시도 · 누락 알림', () => {
  let t: TestApp;
  let sched: any;
  beforeAll(async () => { t = await createTestApp(); await seed(t.ds); sched = t.app.get(IrrigationSchedulerService); });
  afterAll(async () => { await t?.app.close(); });
  beforeEach(() => jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] }));
  afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

  const active = () => ({ ruleId: 'r1', ruleName: '아침관수', userId: USERS.f1.id, device: {}, gateway: {} });
  const action = (value: boolean) => ({ switchCode: 'switch_1', value, label: '1구역' + (value ? ' ON' : ' OFF') });

  it('OFF 가 두 번 실패해도 재시도해서 전달된다', async () => {
    const pub = jest.spyOn(t.app.get(DevicesService), 'publishDeviceSwitch')
      .mockRejectedValueOnce(new Error('x')).mockRejectedValueOnce(new Error('x')).mockResolvedValue(undefined as any);
    const notify = jest.spyOn(t.app.get(EventsGateway), 'sendNotification');
    const p = sched.publishWithRetry(active(), action(false));
    await jest.advanceTimersByTimeAsync(25_000);
    await p;
    expect(pub).toHaveBeenCalledTimes(3);
    expect(notify).not.toHaveBeenCalled();
  });

  it('OFF 가 끝내 실패하면 "관수 끄기 실패" 알림', async () => {
    jest.spyOn(t.app.get(DevicesService), 'publishDeviceSwitch').mockRejectedValue(new Error('broker down'));
    const notify = jest.spyOn(t.app.get(EventsGateway), 'sendNotification');
    const p = sched.publishWithRetry(active(), action(false));
    await jest.advanceTimersByTimeAsync(80_000);
    await p;
    expect(notify.mock.calls.filter((c) => String((c[1] as any).title).includes('관수 끄기 실패'))).toHaveLength(1);
  });

  it('ON 은 관수가 이미 중지됐으면 재시도하지 않는다', async () => {
    const pub = jest.spyOn(t.app.get(DevicesService), 'publishDeviceSwitch').mockRejectedValue(new Error('x'));
    const p = sched.publishWithRetry(active(), action(true)); // activeIrrigations 에 등록되지 않음 = 중지된 상태
    await jest.advanceTimersByTimeAsync(40_000);
    await p;
    expect(pub).toHaveBeenCalledTimes(1);
  });

  it('서버 시작 전 예정 시각의 관수는 한 번만 알린다', () => {
    const now = new Date();
    const at = new Date(now.getTime() - 5 * 60_000);
    sched.bootedAt = now.getTime(); // 방금 시작
    const hhmm = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
    const rule: any = { id: 'r-miss', userId: USERS.f1.id, name: '새벽관수' };
    const cond = { startTime: hhmm, schedule: { days: [now.getDay()] } };
    const notify = jest.spyOn(t.app.get(EventsGateway), 'sendNotification');
    sched.notifyIfMissed(rule, cond, now);
    sched.notifyIfMissed(rule, cond, now);
    expect(notify.mock.calls.filter((c) => String((c[1] as any).title).includes('관수 누락'))).toHaveLength(1);
  });
});
