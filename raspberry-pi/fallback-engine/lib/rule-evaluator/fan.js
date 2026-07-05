'use strict';

const { evaluateHysteresis } = require('./hysteresis');

/**
 * 환기팬/유동팬 평가 (동일 장치). 히스테리시스.
 * - cfg.fanEnabled=false: 동작 없음
 * - cfg.fanTriggerType: 'temperature'(°C, lastTemperature) | 'humidity'(%, lastHumidity)
 *   미지정 시 'temperature' 로 폴백 (이전 마이그레이션 호환).
 * - 트리거 측정값이 없으면(null) 동작 없음.
 * - 채널 목록은 store.getChannels('fan') 동적 조회 (rpi-fallback-channel-sync).
 * - 현재 OFF + 측정값 > onValue → ON
 * - 현재 ON + 측정값 < offValue → OFF
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

  const onValue = cfg.fanOnTemp;
  const offValue = cfg.fanOffTemp;

  const target = evaluateHysteresis(state.fanState, reading, onValue, offValue);

  if (target !== state.fanState) {
    for (const ch of channels) {
      relay.setRelay(ch, target, `fallback-fan-${target ? 'on' : 'off'}-${triggerType[0].toUpperCase()}${reading}`);
    }
    queue.enqueue({
      eventType: 'rule_fired',
      payload: {
        rule: 'fan-toggle',
        from: state.fanState,
        to: target,
        triggerType,
        value: reading,
        channels,
      },
      occurredAt: new Date().toISOString(),
    });
    state.fanState = target;
  }
}

module.exports = { evaluate };
