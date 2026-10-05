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
    // 서버 하트비트가 돌아와 온라인 전환 대기(grace) 중 — 제어권은 이미 서버에 넘어감(폴백은 새 명령을 멈춤).
    // 이전: grace 동안 서버 GPIO 명령은 막히고 Zigbee 명령은 통과 + 폴백도 계속 제어 → 같은 장치 이중 제어.
    if (this.fsm.serverBack && this.fsm.serverBack()) return true;

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
