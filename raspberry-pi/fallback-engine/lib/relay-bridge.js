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

  /** 브로커 연결 여부 — 룰 평가기가 발행 가능 시점을 사전 판단(개폐기 지연 펄스 등). */
  ready() {
    return !!this.client?.connected;
  }

  /**
   * 릴레이 명령 발행. 반환값: 발행 시도됨(true) / drop됨(false).
   * false 면 호출부는 in-memory 상태를 커밋하지 말 것 → 다음 eval tick에서 자연 재시도.
   */
  setRelay(channel, state, reason, durationMs) {
    if (!this.client?.connected) {
      console.warn(`[RELAY-BRIDGE] MQTT 미연결 — ${channel}=${state ? 'ON' : 'OFF'} drop`);
      return false;
    }
    const mapping = this.store.findMapping(channel);
    if (!mapping) {
      console.warn(`[RELAY-BRIDGE] 채널 ${channel} 매핑 없음 — drop`);
      return false;
    }
    // Zigbee 액추에이터: 로컬 z2m 으로 발행 (서버 단절돼도 로컬 zigbee2mqtt+코디네이터는 살아있음)
    if (mapping.type === 'zigbee') {
      return this._setZigbee(mapping, state, reason, durationMs);
    }
    // 온보드 GPIO (기본)
    const topic = `farm/${this.gatewayId}/gpio/relay`;
    const payload = JSON.stringify({
      slot: mapping.channel,
      pin: mapping.pin,
      state,
      source: 'fallback',
      bypass: true,
      reason: reason || 'fallback-rule',
      // 동작 펄스: state=ON + durationMs 면 gpio-agent가 durationMs 뒤 자동 OFF (개폐기 모터 연속통전 방지)
      ...(durationMs && durationMs > 0 && state ? { durationMs } : {}),
      requestId: Date.now(),
      ts: new Date().toISOString(),
    });
    this.client.publish(topic, payload, { qos: 1 }, (err) => {
      if (err) console.error(`[RELAY-BRIDGE] publish 실패: ${err.message}`);
      else console.log(`[RELAY-BRIDGE] slot=${mapping.channel} pin=${mapping.pin} → ${state ? 'ON' : 'OFF'} (${reason})`);
    });
    return true;
  }

  /**
   * Zigbee 액추에이터 발행 — farm/{gw}/z2m/{friendlyName}/set 로 {z2mKey: ON/OFF}.
   * friendlyName/z2mKey(state_lN 사전변환 포함)는 서버 sync 시 채널맵에 실려온다(온라인 publishDeviceSwitch 미러).
   * z2m 은 gpio-agent 의 durationMs 자동 OFF 가 없으므로, 펄스(state=ON+durationMs)면 Pi 가 OFF 를 예약(개폐기 모터 보호 복제).
   */
  _setZigbee(mapping, state, reason, durationMs) {
    const topic = `farm/${this.gatewayId}/z2m/${mapping.friendlyName}/set`;
    const key = mapping.z2mKey || 'state';
    this.client.publish(topic, JSON.stringify({ [key]: state ? 'ON' : 'OFF' }), { qos: 1 }, (err) => {
      if (err) console.error(`[RELAY-BRIDGE] z2m publish 실패: ${err.message}`);
      else console.log(`[RELAY-BRIDGE] z2m ${mapping.friendlyName}.${key} → ${state ? 'ON' : 'OFF'} (${reason})`);
    });
    if (durationMs && durationMs > 0 && state) {
      setTimeout(() => {
        if (this.client?.connected) {
          this.client.publish(topic, JSON.stringify({ [key]: 'OFF' }), { qos: 1 });
        }
      }, durationMs);
    }
    return true;
  }
}

module.exports = RelayBridge;
