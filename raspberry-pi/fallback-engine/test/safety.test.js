'use strict';

/**
 * 폴백 엔진 안전 동작 단위 테스트 (외부 의존성 없음 — node:test).
 *   node --test test/
 * 다루는 것: 비상 정지 유지(래치) 중 ON 차단 / 온라인 복귀 시 폴백 관수 OFF / 방재 중 팬·개폐기 룰 정지
 */
const test = require('node:test');
const assert = require('node:assert');
const RelayBridge = require('../lib/relay-bridge');
const RuleEvaluator = require('../lib/rule-evaluator');

function fakeClient() {
  const published = [];
  return {
    connected: true,
    published,
    publish(topic, payload, opts, cb) { published.push({ topic, payload: JSON.parse(payload) }); if (cb) cb(); },
  };
}

function fakeStore(channels = {}) {
  const mapping = {};
  for (const [cat, list] of Object.entries(channels)) {
    for (const ch of list) mapping[ch] = { channel: ch, pin: 10 + Object.keys(mapping).length, type: 'gpio', category: cat };
  }
  return {
    channelMapping: () => mapping,
    findMapping: (ch) => mapping[ch] || null,
    getChannels: (cat) => Object.values(mapping).filter((m) => m.category === cat).map((m) => m.channel),
    irrigationSchedules: () => [],
    config: () => ({ irrigationEnabled: true, irrigationMaxRuntimeMinutes: 30, fanEnabled: true }),
  };
}

const fakeQueue = () => { const items = []; return { items, enqueue: (e) => items.push(e) }; };

test('래치 중 RelayBridge 는 ON 을 차단하고 OFF 는 보낸다', () => {
  const client = fakeClient();
  const bridge = new RelayBridge({ client, gatewayId: 'gw', store: fakeStore({ fan: ['fan_1'] }) });
  bridge.latched = true;
  assert.strictEqual(bridge.setRelay('fan_1', true, 't'), false);
  assert.strictEqual(client.published.length, 0);
  assert.strictEqual(bridge.setRelay('fan_1', false, 't'), true);
  assert.strictEqual(client.published[0].payload.state, false);
});

test('래치 해제 후에는 ON 을 다시 보낸다', () => {
  const client = fakeClient();
  const bridge = new RelayBridge({ client, gatewayId: 'gw', store: fakeStore({ fan: ['fan_1'] }) });
  bridge.latched = false;
  assert.strictEqual(bridge.setRelay('fan_1', true, 't'), true);
});

test('emergencyStopAll 은 모든 범주 채널에 OFF', () => {
  const client = fakeClient();
  const store = fakeStore({ irrigation: ['zone_1'], fan: ['fan_1'], opener_open: ['opener_open'], opener_close: ['opener_close'] });
  const relay = new RelayBridge({ client, gatewayId: 'gw', store });
  const ev = new RuleEvaluator({ store, queue: fakeQueue(), rain: {}, relayBridge: relay, gatewayId: 'gw' });
  ev.emergencyStopAll();
  const offs = client.published.map((p) => p.payload.slot).sort();
  assert.deepStrictEqual(offs, ['fan_1', 'opener_close', 'opener_open', 'zone_1']);
  assert.ok(client.published.every((p) => p.payload.state === false));
});

test('온라인 복귀 시 폴백 중 켜진 관수 채널을 OFF (꺼진 채널은 건드리지 않음)', () => {
  const client = fakeClient();
  const store = fakeStore({ irrigation: ['zone_1', 'zone_2'], fertilizer: ['fertilizer_motor'] });
  const relay = new RelayBridge({ client, gatewayId: 'gw', store });
  const queue = fakeQueue();
  const ev = new RuleEvaluator({ store, queue, rain: {}, relayBridge: relay, gatewayId: 'gw' });
  ev.recordChannelState('zone_1', true);
  ev.state.irrigationOnByFallback = { fertilizer_motor: true };
  ev.onExitFallback();
  const offs = client.published.map((p) => p.payload.slot).sort();
  assert.deepStrictEqual(offs, ['fertilizer_motor', 'zone_1']);
  assert.strictEqual(ev.state.channels.zone_1.state, false);
  assert.ok(queue.items.some((e) => e.payload?.reason === 'fallback-exit-irrigation-off'));
});

test('방재 중에는 팬·개폐기 룰을 평가하지 않는다', () => {
  const store = fakeStore({ fan: ['fan_1'] });
  const ev = new RuleEvaluator({ store, queue: fakeQueue(), rain: {}, relayBridge: new RelayBridge({ client: fakeClient(), gatewayId: 'gw', store }), gatewayId: 'gw' });
  const fan = require('../lib/rule-evaluator/fan');
  const opener = require('../lib/rule-evaluator/opener');
  const orig = { fan: fan.evaluate, opener: opener.evaluate };
  const calls = [];
  fan.evaluate = () => calls.push('fan');
  opener.evaluate = () => calls.push('opener');
  try {
    ev.evaluate(new Date(), { protectionActive: true });
    assert.deepStrictEqual(calls, []);
    ev.evaluate(new Date(), { protectionActive: false });
    assert.deepStrictEqual(calls, ['fan', 'opener']);
  } finally {
    fan.evaluate = orig.fan;
    opener.evaluate = orig.opener;
  }
});
