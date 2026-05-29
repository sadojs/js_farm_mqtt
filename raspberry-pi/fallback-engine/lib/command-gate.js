'use strict';

/**
 * 서버 GPIO 명령을 모드에 따라 필터링.
 * - online: 전부 통과
 * - fallback: drop (단, payload.bypass=true 이면 통과)
 * - emergency-stop: 별도 토픽이라 게이트 적용 안 함
 */

class CommandGate {
  constructor({ fsm, queue, gatewayId }) {
    this.fsm = fsm;
    this.queue = queue;
    this.gatewayId = gatewayId;
  }

  shouldExecute(cmd) {
    if (this.fsm.mode === 'online') return true;

    // fallback 모드
    if (cmd && cmd.bypass === true) {
      this.queue.enqueue({
        eventType: 'safety_off',
        payload: { reason: 'admin-bypass', cmd },
        occurredAt: new Date().toISOString(),
      });
      return true;
    }
    // drop
    this.queue.enqueue({
      eventType: 'safety_off',
      payload: { reason: 'fallback-mode-drop', cmd },
      occurredAt: new Date().toISOString(),
    });
    return false;
  }
}

module.exports = CommandGate;
