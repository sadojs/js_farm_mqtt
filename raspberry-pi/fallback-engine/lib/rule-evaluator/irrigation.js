'use strict';

/**
 * 관수 평가.
 * - cfg.irrigationEnabled=false: 동작 없음
 * - 채널 목록은 store.getChannels('irrigation') 동적 조회 (rpi-fallback-channel-sync)
 * - 각 채널의 onSince timestamp 추적
 * - now - onSince >= maxRuntimeMinutes 경과 → OFF + 이벤트 로그
 * - 폴백 중 신규 ON 금지 (이 모듈은 새로 켜는 기능 없음 — drop은 command-gate에서 처리)
 */

function evaluate({ cfg, store, state, now, relay, queue }) {
  if (!cfg.irrigationEnabled) return;
  const channels = store.getChannels('irrigation');
  if (channels.length === 0) return;
  const maxMs = (cfg.irrigationMaxRuntimeMinutes || 30) * 60_000;

  for (const ch of channels) {
    const cur = state.channels[ch];
    if (!cur?.state || !cur.onSince) continue;
    const elapsed = now.getTime() - cur.onSince.getTime();
    if (elapsed >= maxMs) {
      // OFF 발행 성공 시에만 상태 커밋 — 실패 시 다음 tick 재시도(안전상 반드시 꺼져야 함).
      const ok = relay.setRelay(ch, false, `fallback-irrigation-timeout-${cfg.irrigationMaxRuntimeMinutes}min`);
      if (!ok) continue;
      queue.enqueue({
        eventType: 'rule_fired',
        payload: {
          rule: 'irrigation-timeout',
          channel: ch,
          onSince: cur.onSince.toISOString(),
          elapsedMs: elapsed,
        },
        occurredAt: new Date().toISOString(),
      });
      state.channels[ch] = { state: false, onSince: null };
    }
  }
}

module.exports = { evaluate };
