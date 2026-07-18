'use strict';

const { evaluateHysteresis } = require('./hysteresis');

/**
 * 개폐기 평가 — 우선순위: 우적 → 온습도(primary) → 월별 스케줄(backup).
 * - rainActive=true: 무조건 CLOSE (최우선)
 * - 온습도계 정상(fresh): 온도/습도 히스테리시스로 개방/닫힘 (유동팬과 동일 방식)
 *     · 현재 닫힘 + 측정값 > openerOnValue → 개방
 *     · 현재 개방 + 측정값 < openerOffValue → 닫힘
 * - 온습도계 이상(측정값 없음/오래됨, sensorTimeoutSeconds 초과): 기존 월별 시간 스케줄로 backup 동작
 *     · schedule.enabled=false: 동작 없음(현 상태 유지)
 *     · mode='always-open': OPEN 유지 / mode='time': openTime~closeTime 개방
 * - 부팅 직후 첫 수신 전(grace 60초): 상태 유지(backup 성급 전환 방지)
 *
 * 채널 목록은 store.getChannels('opener_open')/('opener_close') 동적 조회 (rpi-fallback-channel-sync).
 * 인터록: 열림/닫힘 동시 ON 금지. 반대 채널 OFF → 1초 대기 → 목표 채널 ON.
 */

const OPENER_INTERLOCK_DELAY_MS = 1000;
const DEFAULT_OPENER_PULSE_SEC = 30;

// 개폐기 동작 펄스(ms) — 게이트웨이 공통 openerOperationSeconds(동기화) 사용. ON 후 이 시간 뒤
// gpio-agent가 자동 OFF(대기). 모터 연속통전 방지 + 백엔드 rain-override durationMs와 일치.
function openerPulseMs(store) {
  const sec = Number(store.config().openerOperationSeconds);
  return (sec > 0 ? sec : DEFAULT_OPENER_PULSE_SEC) * 1000;
}

function timeToMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map((n) => parseInt(n, 10));
  return h * 60 + m;
}

function setOpenerIntent(state, intent, reason, relay, queue, store) {
  if (state.openerIntent === intent) return false;

  const openChannels = store.getChannels('opener_open');
  const closeChannels = store.getChannels('opener_close');
  const pulseMs = openerPulseMs(store);
  if (intent === 'open') {
    for (const ch of closeChannels) relay.setRelay(ch, false, reason);
    setTimeout(() => {
      for (const ch of openChannels) relay.setRelay(ch, true, reason, pulseMs);
    }, OPENER_INTERLOCK_DELAY_MS);
  } else if (intent === 'closed') {
    for (const ch of openChannels) relay.setRelay(ch, false, reason);
    setTimeout(() => {
      for (const ch of closeChannels) relay.setRelay(ch, true, reason, pulseMs);
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

function evaluate({ cfg, store, state, rainActive, now, relay, queue, sensorWatchdog }) {
  if (!cfg.openerEnabled) return;
  const openChannels = store.getChannels('opener_open');
  const closeChannels = store.getChannels('opener_close');
  if (openChannels.length === 0 && closeChannels.length === 0) return;

  // 1) 우적(비) 최우선 — 무조건 닫힘
  if (rainActive) {
    setOpenerIntent(state, 'closed', 'rain-active', relay, queue, store);
    return;
  }

  // 2) primary: 온습도 제어 (온습도계 정상일 때) — 유동팬과 동일 히스테리시스
  const triggerType = cfg.openerTriggerType === 'humidity' ? 'humidity' : 'temperature';
  const timeoutMs = (cfg.sensorTimeoutSeconds || 1200) * 1000;
  if (sensorWatchdog && sensorWatchdog.isFresh(triggerType, state, timeoutMs, now.getTime())) {
    const reading = triggerType === 'humidity' ? state.lastHumidity : state.lastTemperature;
    const currentlyOpen = state.openerIntent === 'open';
    const open = evaluateHysteresis(currentlyOpen, reading, cfg.openerOnValue, cfg.openerOffValue);
    setOpenerIntent(
      state,
      open ? 'open' : 'closed',
      `env-${triggerType}-${open ? 'open' : 'closed'}-${reading}`,
      relay, queue, store,
    );
    return;
  }

  // 부팅 직후 아직 첫 수신 전 → backup 성급 전환 방지 (상태 유지)
  if (sensorWatchdog && sensorWatchdog.neverReceivedInGrace(triggerType, state, now.getTime())) return;

  // 3) backup: 월별 시간 스케줄 (온습도계 이상 시)
  const month = now.getMonth() + 1;
  const sched = store.scheduleFor(month);
  if (!sched || !sched.enabled) return;

  if (sched.mode === 'always-open') {
    setOpenerIntent(state, 'open', `backup-month-${month}-always-open`, relay, queue, store);
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
      `backup-month-${month}-${inOpenWindow ? 'open' : 'closed'}-window`,
      relay, queue, store,
    );
  }
}

function forceClose(state, store, relay, queue, reason) {
  setOpenerIntent(state, 'closed', reason, relay, queue, store);
}

module.exports = {
  OPENER_INTERLOCK_DELAY_MS,
  evaluate,
  forceClose,
};
