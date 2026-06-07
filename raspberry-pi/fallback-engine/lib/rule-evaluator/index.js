'use strict';

/**
 * Rule Evaluator — 4종 룰 통합 진입점.
 * 채널 정보는 store.getChannels(category) 동적 조회 (rpi-fallback-channel-sync).
 */

const opener = require('./opener');
const irrigation = require('./irrigation');
const fertilizer = require('./fertilizer');
const fan = require('./fan');

class RuleEvaluator {
  constructor({ store, queue, rain, relayBridge, gatewayId }) {
    this.store = store;
    this.queue = queue;
    this.rain = rain;
    this.relay = relayBridge;
    this.gatewayId = gatewayId;

    // 공유 상태
    this.state = {
      channels: {},        // { channel: { state, onSince } }
      lastTemperature: null,
      lastHumidity: null,
      rainActive: false,
      fanState: false,
      openerIntent: null,  // 'open' | 'closed' | null
    };
  }

  recordChannelState(channel, st) {
    const prev = this.state.channels[channel] || { state: false, onSince: null };
    const now = new Date();
    this.state.channels[channel] = {
      state: st,
      onSince: st && !prev.state ? now : (st ? prev.onSince : null),
    };
  }

  ingestSensor(deviceName, data) {
    if (!data || typeof data !== 'object') return;
    const tempKeys = ['temperature', 'temp', 'air_temperature'];
    for (const key of tempKeys) {
      if (typeof data[key] === 'number') {
        this.state.lastTemperature = data[key];
        break;
      }
    }
    const humidityKeys = ['humidity', 'relative_humidity', 'rh'];
    for (const key of humidityKeys) {
      if (typeof data[key] === 'number') {
        this.state.lastHumidity = data[key];
        break;
      }
    }
  }

  applyRainOverride(active) {
    this.state.rainActive = !!active;
    this.queue.enqueue({
      eventType: 'rule_fired',
      payload: { rule: 'rain-override', active },
      occurredAt: new Date().toISOString(),
    });
    if (this.state.rainActive) {
      opener.forceClose(this.state, this.store, this.relay, this.queue, 'rain-override-active');
    } else {
      this.state.openerIntent = null;
    }
  }

  emergencyStopAll() {
    const cm = this.store.channelMapping();
    if (cm) {
      const all = [
        ...this.store.getChannels('irrigation'),
        ...this.store.getChannels('fertilizer'),
        ...this.store.getChannels('fan'),
        ...this.store.getChannels('opener_open'),
        ...this.store.getChannels('opener_close'),
      ];
      for (const ch of all) this.relay.setRelay(ch, false, 'emergency-stop');
      this.queue.enqueue({
        eventType: 'safety_off',
        payload: { reason: 'emergency-stop-all', channels: all },
        occurredAt: new Date().toISOString(),
      });
      return;
    }

    // 매핑 미동기화 안전망: rpi-fallback-channel-sync 위험 §1 완화책.
    // gpio-agent에게 광범위 OFF 발행 (slot_key 추정 + 매핑된 핀이 없으면 RelayBridge가 drop).
    console.error('[RULE-EVAL] channelMapping 미동기화 — fallback safe-off 발행');
    const guess = [
      'zone_1', 'zone_2', 'zone_3', 'zone_4', 'zone_5', 'zone_6', 'zone_7', 'zone_8',
      'fertilizer_contact', 'mixer', 'fertilizer_motor',
      'fan_1', 'fan_2', 'fan_3', 'fan_4',
      'opener_open', 'opener_close',
    ];
    for (const ch of guess) this.relay.setRelay(ch, false, 'emergency-stop-no-mapping');
    this.queue.enqueue({
      eventType: 'safety_off',
      payload: { reason: 'emergency-stop-no-mapping', channels: guess },
      occurredAt: new Date().toISOString(),
    });
  }

  evaluate(now) {
    const cfg = this.store.config();
    const args = {
      cfg,
      store: this.store,
      state: this.state,
      rainActive: this.state.rainActive,
      now,
      relay: this.relay,
      queue: this.queue,
    };
    fertilizer.evaluate(args);
    irrigation.evaluate(args);
    fan.evaluate(args);
    opener.evaluate(args);
  }
}

module.exports = RuleEvaluator;
