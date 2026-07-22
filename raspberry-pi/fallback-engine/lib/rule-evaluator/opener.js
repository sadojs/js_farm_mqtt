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
// 동일 방향(open/closed) 최대 10분간 동작/대기 반복 후 정지(상태만 유지).
// 개폐기는 실제 ~3분이면 완전 개/폐 — 무한 반복(모터 혹사) 방지. 온라인 automation-runner 와 동일.
const OPENER_DUTY_MAX_MS = 10 * 60 * 1000;

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

// 목표 방향 동작 펄스 1회 — 반대 채널 OFF → 인터록 지연(1초) → 목표 채널 ON(pulseMs 후 gpio-agent 자동 OFF).
// 열림/닫힘 동시 ON 금지(인터록) 보장.
// 반환: 발행 시도됨(true) / 보류(false). 브로커 미연결·목표채널 매핑 없음이면 false →
// 호출부가 의도를 커밋하지 않아 다음 eval tick에서 재시도. 지연 ON 전에 사전 판단.
function firePulse(intent, reason, relay, store) {
  if (typeof relay.ready === 'function' && !relay.ready()) return false; // 브로커 미연결 — 보류
  const openChannels = store.getChannels('opener_open');
  const closeChannels = store.getChannels('opener_close');
  const targetChannels = intent === 'open' ? openChannels : closeChannels;
  if (targetChannels.length === 0) return false;
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
  return true;
}

// 같은 의도 유지 중 동작(openerOperationSeconds)/대기(openerStandbySeconds) 주기로 펄스 반복.
// 각 동작 구간 진입(off→on) 시 새 펄스 재발행. 10분 경과 후에는 정지(상태 유지).
// 온라인 rain-override.service 의 tickCloseCycles 와 동일 semantics.
function tickOpenerDuty(state, store, relay) {
  const duty = state.openerDuty;
  if (!duty || duty.intent !== state.openerIntent) return;
  const elapsed = Date.now() - duty.anchorMs;
  if (elapsed >= OPENER_DUTY_MAX_MS) return; // 10분 초과 → 반복 중단, 상태만 유지
  const onMs = openerPulseMs(store);
  const offMs = Math.max(0, Number(store.config().openerStandbySeconds) || 60) * 1000;
  const cycleMs = onMs + offMs;
  if (cycleMs <= 0) return;
  const isOnPhase = (elapsed % cycleMs) < onMs;
  if (isOnPhase && !duty.lastOnPhase) {
    firePulse(state.openerIntent, `${duty.reason}-duty`, relay, store); // 새 동작 구간 → 재펄스
  }
  duty.lastOnPhase = isOnPhase;
}

function setOpenerIntent(state, intent, reason, relay, queue, store) {
  if (state.openerIntent === intent) {
    tickOpenerDuty(state, store, relay); // 같은 의도 유지 — 동작/대기 주기 반복 처리
    return false;
  }

  // 전달 보류(브로커 미연결 등)면 의도 커밋하지 않음 → 다음 tick 재시도.
  if (!firePulse(intent, reason, relay, store)) return false;
  queue.enqueue({
    eventType: 'rule_fired',
    payload: { rule: 'opener-intent', from: state.openerIntent, to: intent, reason },
    occurredAt: new Date().toISOString(),
  });
  state.openerIntent = intent;
  // 첫 동작 펄스 발행됨 → 동작/대기 듀티 시작(lastOnPhase=true).
  state.openerDuty = { intent, reason, anchorMs: Date.now(), lastOnPhase: true };
  return true;
}

// 고온 무대기 강제열림 — 비 그친 뒤 고온 시 대기 없이 매 eval tick 열림 펄스 재발행(연속 개방),
// 10분 캡 후 정지(상태 유지). rain-override 의 강제닫힘과 대칭. (온라인 automation-runner 와 동일 의미)
function forceOpenHighTemp(state, store, relay, queue, now) {
  const nowMs = now && now.getTime ? now.getTime() : Date.now();
  if (state.highTempOpen !== true) {
    const from = state.openerIntent;
    if (!firePulse('open', 'high-temp-override', relay, store)) return; // 보류 — 다음 tick 재시도
    state.openerIntent = 'open';
    state.openerDuty = null;          // 일반 동작/대기 듀티 사용 안 함
    state.highTempOpen = true;
    state.highTempAnchorMs = nowMs;
    queue.enqueue({
      eventType: 'rule_fired',
      payload: { rule: 'high-temp-override', from, to: 'open' },
      occurredAt: new Date().toISOString(),
    });
    return;
  }
  if (nowMs - (state.highTempAnchorMs || nowMs) >= OPENER_DUTY_MAX_MS) return; // 10분 캡 → 정지
  firePulse('open', 'high-temp-override-continuous', relay, store);           // 무대기 재펄스
}

function evaluate({ cfg, store, state, rainActive, now, relay, queue, sensorWatchdog }) {
  if (!cfg.openerEnabled) return;
  const openChannels = store.getChannels('opener_open');
  const closeChannels = store.getChannels('opener_close');
  if (openChannels.length === 0 && closeChannels.length === 0) return;

  // 1) 우적(비) 최우선 — 무조건 닫힘
  if (rainActive) {
    state.highTempOpen = false;
    setOpenerIntent(state, 'closed', 'rain-active', relay, queue, store);
    return;
  }

  // 1.5) 고온 무대기 강제열림 (비 아님 + 온습도계 정상 + 내부온도 ≥ 임계값)
  if (cfg.highTempOverrideEnabled && cfg.highTempOpenThreshold != null) {
    const timeoutMs = (cfg.sensorTimeoutSeconds || 1200) * 1000;
    const tempFresh = sensorWatchdog && sensorWatchdog.isFresh('temperature', state, timeoutMs, now.getTime());
    if (tempFresh && state.lastTemperature != null && state.lastTemperature >= cfg.highTempOpenThreshold) {
      forceOpenHighTemp(state, store, relay, queue, now);
      return;
    }
  }
  // 고온 세션 종료 → 일반 제어 복귀 시 intent 재초기화(듀티 재수립)
  if (state.highTempOpen) {
    state.highTempOpen = false;
    state.openerIntent = null;
    state.openerDuty = null;
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
