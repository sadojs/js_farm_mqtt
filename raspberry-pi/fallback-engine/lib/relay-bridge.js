'use strict';

/**
 * fallback-engine → gpio-agent 명령 발행.
 * 폴백 모드에서 룰 평가기가 결정한 명령을 GPIO Agent에게 전달.
 *
 * 동일 MQTT broker 사용. 토픽: farm/{gw}/gpio/relay
 *
 * rpi-fallback-channel-sync (v2):
 *  - channel(slot_key)을 store에서 pin 번호로 변환
 *  - gpio-agent 호환 payload: { slot, pin, state, requestId, bypass, source, reason, ts }
 *  - 매핑이 없는 channel은 drop + warn log
 *
 * bypass=true 플래그로 command-gate를 우회 (자기 자신의 publish 메시지를 fallback drop 안 되도록).
 */

class RelayBridge {
  constructor({ client, gatewayId, store }) {
    this.client = client;
    this.gatewayId = gatewayId;
    this.store = store;
  }

  setRelay(channel, state, reason) {
    if (!this.client?.connected) {
      console.warn(`[RELAY-BRIDGE] MQTT 미연결 — ${channel}=${state ? 'ON' : 'OFF'} drop`);
      return;
    }
    const mapping = this.store.findMapping(channel);
    if (!mapping) {
      console.warn(`[RELAY-BRIDGE] 채널 ${channel} 매핑 없음 — drop`);
      return;
    }
    const topic = `farm/${this.gatewayId}/gpio/relay`;
    const payload = JSON.stringify({
      slot: mapping.channel,
      pin: mapping.pin,
      state,
      source: 'fallback',
      bypass: true,
      reason: reason || 'fallback-rule',
      requestId: Date.now(),
      ts: new Date().toISOString(),
    });
    this.client.publish(topic, payload, { qos: 1 }, (err) => {
      if (err) console.error(`[RELAY-BRIDGE] publish 실패: ${err.message}`);
      else console.log(`[RELAY-BRIDGE] slot=${mapping.channel} pin=${mapping.pin} → ${state ? 'ON' : 'OFF'} (${reason})`);
    });
  }
}

module.exports = RelayBridge;
