'use strict';

/**
 * 개폐기 평가 (월별 스케줄 + 인터록).
 * - rainActive=true: 무조건 CLOSE
 * - 해당 월의 schedule.enabled=false: 동작 없음 (현 상태 유지)
 * - mode='always-open': OPEN 유지
 * - mode='time': openTime <= now < closeTime 이면 OPEN, 아니면 CLOSE
 *
 * 채널 목록은 store.getChannels('opener_open')/('opener_close') 동적 조회 (rpi-fallback-channel-sync).
 * 인터록: 열림/닫힘 동시 ON 금지. 반대 채널 OFF → 1초 대기 → 목표 채널 ON.
 */

const OPENER_INTERLOCK_DELAY_MS = 1000;

function timeToMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map((n) => parseInt(n, 10));
  return h * 60 + m;
}

function setOpenerIntent(state, intent, reason, relay, queue, openChannels, closeChannels) {
  if (state.openerIntent === intent) return false;

  if (intent === 'open') {
    for (const ch of closeChannels) relay.setRelay(ch, false, reason);
    setTimeout(() => {
      for (const ch of openChannels) relay.setRelay(ch, true, reason);
    }, OPENER_INTERLOCK_DELAY_MS);
  } else if (intent === 'closed') {
    for (const ch of openChannels) relay.setRelay(ch, false, reason);
    setTimeout(() => {
      for (const ch of closeChannels) relay.setRelay(ch, true, reason);
    }, OPENER_INTERLOCK_DELAY_MS);
  }

  queue.enqueue({
    eventType: 'rule_fired',
    payload: { rule: 'opener-intent', from: state.openerIntent, to: intent, reason },
    occurredAt: new Date().toISOString(),
  });
  state.openerIntent = intent;
  return true;
}

function evaluate({ cfg, store, state, rainActive, now, relay, queue }) {
  if (!cfg.openerEnabled) return;
  const openChannels = store.getChannels('opener_open');
  const closeChannels = store.getChannels('opener_close');
  if (openChannels.length === 0 && closeChannels.length === 0) return;

  if (rainActive) {
    setOpenerIntent(state, 'closed', 'rain-active', relay, queue, openChannels, closeChannels);
    return;
  }

  const month = now.getMonth() + 1;
  const sched = store.scheduleFor(month);
  if (!sched || !sched.enabled) return;

  if (sched.mode === 'always-open') {
    setOpenerIntent(state, 'open', `month-${month}-always-open`, relay, queue, openChannels, closeChannels);
    return;
  }

  if (sched.mode === 'time' && sched.openTime && sched.closeTime) {
    const cur = now.getHours() * 60 + now.getMinutes();
    const o = timeToMinutes(sched.openTime);
    const c = timeToMinutes(sched.closeTime);
    const inOpenWindow = o <= c ? (cur >= o && cur < c) : (cur >= o || cur < c);
    setOpenerIntent(
      state,
      inOpenWindow ? 'open' : 'closed',
      `month-${month}-${inOpenWindow ? 'open' : 'closed'}-window`,
      relay, queue, openChannels, closeChannels,
    );
  }
}

function forceClose(state, store, relay, queue, reason) {
  const openChannels = store.getChannels('opener_open');
  const closeChannels = store.getChannels('opener_close');
  setOpenerIntent(state, 'closed', reason, relay, queue, openChannels, closeChannels);
}

module.exports = {
  OPENER_INTERLOCK_DELAY_MS,
  evaluate,
  forceClose,
};
