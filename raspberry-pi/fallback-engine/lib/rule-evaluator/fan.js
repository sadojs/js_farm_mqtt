'use strict';

/**
 * 환기팬/유동팬 평가 (동일 장치). 온도 히스테리시스.
 * - cfg.fanEnabled=false: 동작 없음
 * - lastTemperature가 없으면 동작 없음
 * - 채널 목록은 store.getChannels('fan') 동적 조회 (rpi-fallback-channel-sync)
 * - 현재 OFF + 온도 > onTemp → ON
 * - 현재 ON + 온도 < offTemp → OFF
 *
 * 다중 팬 슬롯 지원: fan_1~fan_4 등 여러 채널이 있으면 모두 동시 제어.
 */

function evaluate({ cfg, store, state, relay, queue }) {
  if (!cfg.fanEnabled) return;
  if (typeof state.lastTemperature !== 'number') return;
  const channels = store.getChannels('fan');
  if (channels.length === 0) return;

  const onTemp = cfg.fanOnTemp;
  const offTemp = cfg.fanOffTemp;

  let target;
  if (state.fanState) {
    target = state.lastTemperature < offTemp ? false : true;
  } else {
    target = state.lastTemperature > onTemp ? true : false;
  }

  if (target !== state.fanState) {
    for (const ch of channels) {
      relay.setRelay(ch, target, `fallback-fan-${target ? 'on' : 'off'}-T${state.lastTemperature}`);
    }
    queue.enqueue({
      eventType: 'rule_fired',
      payload: {
        rule: 'fan-toggle', from: state.fanState, to: target,
        temperature: state.lastTemperature, channels,
      },
      occurredAt: new Date().toISOString(),
    });
    state.fanState = target;
  }
}

module.exports = { evaluate };
