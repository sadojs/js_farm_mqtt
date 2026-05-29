'use strict';

/**
 * 서버 하트비트 수신을 감시한다.
 * - touch()        : 하트비트 수신 시각 갱신
 * - evaluate()     : 현재 의도 모드(online/fallback) 반환
 *   - timeout 미경과: 'online'
 *   - timeout 경과:   'fallback'
 *
 * 콜드부트 직후 60초 grace: 한 번도 하트비트를 못 받았으면 'online' 유지 (성급한 fallback 방지)
 */

const COLD_BOOT_GRACE_MS = 60_000;

class HeartbeatWatchdog {
  constructor({ timeoutSeconds, graceSeconds }) {
    this.timeoutSecondsFn = typeof timeoutSeconds === 'function'
      ? timeoutSeconds : () => timeoutSeconds;
    this.graceSecondsFn = typeof graceSeconds === 'function'
      ? graceSeconds : () => graceSeconds;
    this.lastSeenAt = null;
    this.bootedAt = Date.now();
    this.everSeen = false;
  }

  touch() {
    this.lastSeenAt = Date.now();
    this.everSeen = true;
  }

  evaluate() {
    const now = Date.now();
    const timeoutMs = this.timeoutSecondsFn() * 1000;

    if (!this.everSeen) {
      // 콜드부트 60초 grace
      if (now - this.bootedAt < COLD_BOOT_GRACE_MS) return 'online';
      return 'fallback';
    }

    if (now - this.lastSeenAt > timeoutMs) return 'fallback';
    return 'online';
  }
}

module.exports = HeartbeatWatchdog;
