import { CommandAckService, ACK_WAIT_MS, ACK_MAX_RETRIES } from '../src/modules/devices/command-ack.service';

/** 명령 반영 확인 — 상태 보고가 없으면 다시 보내고, 끝내 없으면 미반영 알림 (검토 §7-9 ②) */
describe('명령 반영 확인 (단위)', () => {
  const dev = { id: 'd1', name: '1동 측창 열림', userId: 'u1' };
  let saved: any;
  let repo: any;
  let gw: any;
  let push: any;
  let svc: CommandAckService;

  beforeEach(() => {
    jest.useFakeTimers();
    saved = { id: 'd1', userId: 'u1', online: true, deviceSettings: {} };
    repo = { findOne: jest.fn(async () => saved), save: jest.fn(async (d: any) => { saved = d; return d; }) };
    gw = { sendNotification: jest.fn(), broadcastDeviceSwitchUpdate: jest.fn() };
    push = { sendToFarm: jest.fn(async () => undefined) };
    svc = new CommandAckService(repo, gw, push);
  });
  afterEach(() => { svc.onModuleDestroy(); jest.useRealTimers(); });

  const tick = async (ms: number) => { await jest.advanceTimersByTimeAsync(ms); };

  it('상태 보고가 오면 재전송·알림 없이 끝난다', async () => {
    const resend = jest.fn(async () => undefined);
    svc.expect(dev, true, resend);
    await svc.onReport({ deviceId: 'd1', on: true });
    await tick(ACK_WAIT_MS * 5);
    expect(resend).not.toHaveBeenCalled();
    expect(gw.sendNotification).not.toHaveBeenCalled();
    expect(svc.isPending('d1')).toBe(false);
  });

  it('다른 상태 보고(예: 인터록 OFF)는 무시하고 계속 기다린다', async () => {
    const resend = jest.fn(async () => undefined);
    svc.expect(dev, true, resend);
    await svc.onReport({ deviceId: 'd1', on: false });
    expect(svc.isPending('d1')).toBe(true);
    await tick(ACK_WAIT_MS);
    expect(resend).toHaveBeenCalledTimes(1);
  });

  it(`보고가 없으면 ${ACK_MAX_RETRIES}번 다시 보내고, 그래도 없으면 "명령 미반영" 알림 + 카드 표시`, async () => {
    const resend = jest.fn(async () => undefined);
    svc.expect(dev, true, resend);
    await tick(ACK_WAIT_MS * (ACK_MAX_RETRIES + 1) + 10);
    expect(resend).toHaveBeenCalledTimes(ACK_MAX_RETRIES);
    expect(gw.sendNotification).toHaveBeenCalledTimes(1);
    expect(gw.sendNotification.mock.calls[0][1]).toMatchObject({ type: 'error', title: '⚠ 1동 측창 열림 명령 미반영' });
    expect(push.sendToFarm).toHaveBeenCalledTimes(1);
    expect(saved.deviceSettings.commandUnconfirmed).toMatchObject({ on: true });

    // 다음 명령이 반영되면 표시가 지워진다
    svc.expect(dev, false, resend);
    await svc.onReport({ deviceId: 'd1', on: false });
    expect(saved.deviceSettings.commandUnconfirmed).toBeUndefined();
  });

  it('재시도 중 반영되면 알림 없음', async () => {
    const resend = jest.fn(async () => undefined);
    svc.expect(dev, true, resend);
    await tick(ACK_WAIT_MS + 10);
    expect(resend).toHaveBeenCalledTimes(1);
    await svc.onReport({ deviceId: 'd1', on: true });
    await tick(ACK_WAIT_MS * 5);
    expect(resend).toHaveBeenCalledTimes(1);
    expect(gw.sendNotification).not.toHaveBeenCalled();
  });

  it('새 명령이 오면 이전 확인은 버린다 (이전 명령을 다시 보내지 않음)', async () => {
    const first = jest.fn(async () => undefined);
    const second = jest.fn(async () => undefined);
    svc.expect(dev, true, first);
    svc.expect(dev, false, second);
    await tick(ACK_WAIT_MS + 10);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('비상 정지로 거부되면 재전송 없이 바로 알린다', async () => {
    const resend = jest.fn(async () => undefined);
    svc.expect(dev, true, resend);
    await svc.onReport({ deviceId: 'd1', on: false, rejected: 'emergency-latched' });
    expect(resend).not.toHaveBeenCalled();
    expect(gw.sendNotification.mock.calls[0][1].message).toContain('비상 정지');
  });

  it('같은 장치의 미반영 알림은 10분 안에 반복하지 않는다', async () => {
    const resend = jest.fn(async () => undefined);
    for (let i = 0; i < 2; i++) {
      svc.expect(dev, true, resend);
      await tick(ACK_WAIT_MS * (ACK_MAX_RETRIES + 1) + 10);
    }
    expect(gw.sendNotification).toHaveBeenCalledTimes(1);
  });
});
