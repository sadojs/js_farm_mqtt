'use strict';

/**
 * online ↔ fallback 모드 전환 머신.
 * - 단순 즉시 전환이 아닌 grace 안정화 후 전환
 * - online → fallback: 즉시 (watchdog가 이미 timeout 검출)
 * - fallback → online: graceSeconds 동안 안정적인 'online' 시그널 후 전환
 */

class ModeStateMachine {
  constructor({ watchdog }) {
    this.watchdog = watchdog;
    this.mode = 'online';
    this.modeChangedAt = new Date();
    this.pendingOnlineSince = null;
  }

  tryTransition(intendedMode) {
    const now = Date.now();

    // online → fallback (즉시)
    if (this.mode === 'online' && intendedMode === 'fallback') {
      this.mode = 'fallback';
      this.modeChangedAt = new Date(now);
      this.pendingOnlineSince = null;
      return true;
    }

    // fallback → online (grace 후)
    if (this.mode === 'fallback' && intendedMode === 'online') {
      if (this.pendingOnlineSince === null) {
        this.pendingOnlineSince = now;
        return false;
      }
      const graceMs = this.watchdog.graceSecondsFn() * 1000;
      if (now - this.pendingOnlineSince >= graceMs) {
        this.mode = 'online';
        this.modeChangedAt = new Date(now);
        this.pendingOnlineSince = null;
        return true;
      }
      return false;
    }

    // intendedMode가 fallback인데 fallback 모드면 grace 리셋
    if (this.mode === 'fallback' && intendedMode === 'fallback') {
      this.pendingOnlineSince = null;
    }
    return false;
  }
}

module.exports = ModeStateMachine;
