'use strict';

/**
 * 액비 평가 — 폴백 진입 즉시 OFF.
 * 채널 목록은 store.getChannels('fertilizer') 동적 조회 (rpi-fallback-channel-sync).
 * ON 상태 채널만 OFF 명령 발행 (멱등).
 */

function evaluate({ cfg, store, state, relay, queue }) {
  if (!cfg.fertilizerEnabled) return;
  const channels = store.getChannels('fertilizer');
  for (const ch of channels) {
    const cur = state.channels[ch];
    if (cur?.state) {
      relay.setRelay(ch, false, 'fallback-fertilizer-off');
      queue.enqueue({
        eventType: 'rule_fired',
        payload: { rule: 'fertilizer-off', channel: ch },
        occurredAt: new Date().toISOString(),
      });
      state.channels[ch] = { state: false, onSince: null };
    }
  }
}

module.exports = { evaluate };
