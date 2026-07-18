'use strict';

const { evaluateHysteresis } = require('./hysteresis');

/**
 * 환기팬/유동팬 평가 (동일 장치). 히스테리시스 + 동작/대기 듀티 사이클.
 * - cfg.fanEnabled=false: 동작 없음
 * - cfg.fanTriggerType: 'temperature'(°C, lastTemperature) | 'humidity'(%, lastHumidity)
 *   미지정 시 'temperature' 로 폴백 (이전 마이그레이션 호환).
 * - 트리거 측정값이 없으면(null) 동작 없음.
 * - 채널 목록은 store.getChannels('fan') 동적 조회 (rpi-fallback-channel-sync).
 *
 * 판정 2단계 (온라인 automation-runner 와 동일 semantics):
 *   1) 가동 필요 여부(히스테리시스): 현재 가동의도(fanRunning) + 측정값으로
 *      OFF→(측정값>onValue)→가동, 가동→(측정값<offValue)→정지.
 *   2) 가동 필요할 때 동작(fanOperationMinutes)/대기(fanStandbyMinutes) 주기로 릴레이 ON/OFF 순환.
 *      대기 phase 에도 '가동 의도'(fanRunning)는 유지 → 히스테리시스가 조기 재판정 안 함.
 *
 * 다중 팬 슬롯 지원: fan_1~fan_4 등 여러 채널이 있으면 모두 동시 제어.
 */

function evaluate({ cfg, store, state, relay, queue }) {
  if (!cfg.fanEnabled) return;
  const channels = store.getChannels('fan');
  if (channels.length === 0) return;

  const triggerType = cfg.fanTriggerType === 'humidity' ? 'humidity' : 'temperature';
  const reading = triggerType === 'humidity' ? state.lastHumidity : state.lastTemperature;
  if (typeof reading !== 'number') return;

  // 릴레이 실제 ON/OFF 를 상태 변화 시에만 발행.
  const applyRelay = (on) => {
    if (on === state.fanState) return;
    for (const ch of channels) {
      relay.setRelay(ch, on, `fallback-fan-${on ? 'on' : 'off'}-${triggerType[0].toUpperCase()}${reading}`);
    }
    queue.enqueue({
      eventType: 'rule_fired',
      payload: { rule: 'fan-toggle', from: state.fanState, to: on, triggerType, value: reading, channels },
      occurredAt: new Date().toISOString(),
    });
    state.fanState = on;
  };

  // 1) 가동 필요 여부 — 대기 phase 에도 유지되는 fanRunning 을 히스테리시스 기준으로 사용.
  const shouldRun = evaluateHysteresis(!!state.fanRunning, reading, cfg.fanOnTemp, cfg.fanOffTemp);
  if (!shouldRun) {
    state.fanRunning = false;
    state.fanDuty = null;
    applyRelay(false);
    return;
  }

  // 2) 가동 필요 → 동작/대기 듀티 사이클
  state.fanRunning = true;
  const onMs = Math.max(1, Number(cfg.fanOperationMinutes) || 50) * 60000;
  const offMs = Math.max(0, Number(cfg.fanStandbyMinutes) || 10) * 60000;
  if (!state.fanDuty) state.fanDuty = { anchorMs: Date.now() };
  const cycleMs = onMs + offMs;
  const onPhase = offMs === 0 ? true : (Date.now() - state.fanDuty.anchorMs) % cycleMs < onMs;
  applyRelay(onPhase);
}

module.exports = { evaluate };
