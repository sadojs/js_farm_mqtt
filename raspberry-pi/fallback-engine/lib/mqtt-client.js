'use strict';

const mqtt = require('mqtt');

/**
 * MQTT 연결 + 구독 관리.
 * - 토픽 라우팅은 caller(index.js)가 수행
 * - 재연결은 mqtt 라이브러리에 위임 (reconnectPeriod)
 *
 * 옵션:
 *  - server, gatewayId, username, password
 *  - topics: 구독할 토픽 배열
 *  - onMessage(topic, payload): 메시지 핸들러
 *  - onConnect(): 연결 성공 콜백
 */

class MqttClientWrapper {
  constructor({ server, gatewayId, username, password, topics, onMessage, onConnect }) {
    this.server = server;
    this.gatewayId = gatewayId;
    this.username = username;
    this.password = password;
    this.topics = topics || [];
    this.onMessage = onMessage;
    this.onConnect = onConnect;
    this.client = null;
  }

  connect() {
    console.log(`[MQTT-CLIENT] 연결 중: ${this.server} (gw=${this.gatewayId})`);
    this.client = mqtt.connect(this.server, {
      clientId: `fallback-engine-${this.gatewayId}-${Date.now()}`,
      clean: true,
      reconnectPeriod: 5000,
      ...(this.username && { username: this.username }),
      ...(this.password && { password: this.password }),
    });

    this.client.on('connect', () => {
      console.log('[MQTT-CLIENT] 연결 성공');
      for (const t of this.topics) {
        this.client.subscribe(t, { qos: 1 }, (err) => {
          if (err) console.error(`[MQTT-CLIENT] 구독 실패: ${t} ${err.message}`);
          else console.log(`[MQTT-CLIENT] 구독: ${t}`);
        });
      }
      if (this.onConnect) this.onConnect();
    });

    this.client.on('message', (topic, payload) => {
      if (!this.onMessage) return;
      try { this.onMessage(topic, payload); }
      catch (err) { console.error(`[MQTT-CLIENT] 메시지 처리 오류 (${topic}): ${err.message}`); }
    });

    this.client.on('error', (err) => console.error(`[MQTT-CLIENT] 오류: ${err.message}`));
    this.client.on('reconnect', () => console.log('[MQTT-CLIENT] 재연결 시도...'));
    return this.client;
  }

  end(force = false, cb) {
    if (this.client) this.client.end(force, cb);
  }

  raw() {
    return this.client;
  }
}

module.exports = MqttClientWrapper;
