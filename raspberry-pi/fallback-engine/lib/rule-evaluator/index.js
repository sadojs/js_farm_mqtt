'use strict';

/**
 * Rule Evaluator — 4종 룰 통합 진입점.
 * 채널 정보는 store.getChannels(category) 동적 조회 (rpi-fallback-channel-sync).
 */

const opener = require('./opener');
const irrigation = require('./irrigation');
const irrigationSchedule = require('./irrigation-schedule');
const fertilizer = require('./fertilizer');
const fan = require('./fan');
const { SensorWatchdog } = require('../sensor-watchdog');

class RuleEvaluator {
  constructor({ store, queue, rain, relayBridge, gatewayId }) {
    this.store = store;
    this.queue = queue;
    this.rain = rain;
    this.relay = relayBridge;
    this.gatewayId = gatewayId;

    // 온습도계 신선도 감시 (개폐기 primary(온습도) vs backup(스케줄) 분기용)
    this.sensorWatchdog = new SensorWatchdog();

    // 공유 상태
    this.state = {
      channels: {},        // { channel: { state, onSince } }
      lastTemperature: null,
      lastHumidity: null,
      lastTemperatureAt: null,  // ms epoch — 온습도계 stale 판정용
      lastHumidityAt: null,
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
    const now = Date.now();
    const tempKeys = ['temperature', 'temp', 'air_temperature'];
    for (const key of tempKeys) {
      if (typeof data[key] === 'number') {
        this.state.lastTemperature = data[key];
        this.state.lastTemperatureAt = now;
        break;
      }
    }
    const humidityKeys = ['humidity', 'relative_humidity', 'rh'];
    for (const key of humidityKeys) {
      if (typeof data[key] === 'number') {
        this.state.lastHumidity = data[key];
        this.state.lastHumidityAt = now;
        break;
      }
    }
  }

  applyRainOverride(active) {
    this.state.rainActive = !!active;
    const cfg = this.store.config();
    // 설정에서 '우적 강제닫힘'(openerRainOverride)이 꺼져 있으면 비 감지가 개폐기에 영향 없음.
    // (default true — 미설정/true 는 기존 동작 유지)
    const enabled = cfg.openerRainOverride !== false;
    this.queue.enqueue({
      eventType: 'rule_fired',
      payload: { rule: 'rain-override', active, enabled },
      occurredAt: new Date().toISOString(),
    });
    if (!enabled) return; // 강제닫힘 비활성 — 개폐기 상태 건드리지 않음
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
      sensorWatchdog: this.sensorWatchdog,
    };
    fertilizer.evaluate(args);
    irrigation.evaluate(args);        // 안전망: 최대런타임 초과 구역 OFF
    irrigationSchedule.evaluate(args); // 폴백 관수 스케줄 실행(요일+시각 발화)
    fan.evaluate(args);
    opener.evaluate(args);
  }

  /** 폴백 이탈(온라인 복귀) 시 — 예약된 폴백 관수 타이머 취소(온라인 스케줄러 인계). */
  onExitFallback() {
    irrigationSchedule.cancelAll(this.state);
  }
}

module.exports = RuleEvaluator;
