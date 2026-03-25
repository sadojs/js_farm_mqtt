import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as mqtt from 'mqtt';
import { MqttSensorHandler } from './mqtt-sensor.handler';
import { MqttDeviceHandler } from './mqtt-device.handler';
import { MqttBridgeHandler } from './mqtt-bridge.handler';
import { ZigbeeDevice } from './mqtt.types';

@Injectable()
export class MqttService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MqttService.name);
  private client: mqtt.MqttClient;

  constructor(
    private config: ConfigService,
    private sensorHandler: MqttSensorHandler,
    private deviceHandler: MqttDeviceHandler,
    private bridgeHandler: MqttBridgeHandler,
  ) {}

  async onModuleInit() {
    const brokerUrl = this.config.get('MQTT_URL', 'mqtt://localhost:1883');
    const username = this.config.get('MQTT_USERNAME', '');
    const password = this.config.get('MQTT_PASSWORD', '');

    this.client = mqtt.connect(brokerUrl, {
      clientId: `smartfarm-backend-${Date.now()}`,
      clean: true,
      reconnectPeriod: 5000,
      ...(username && { username, password }),
    });

    this.client.on('connect', () => {
      this.logger.log(`MQTT Broker 연결 성공: ${brokerUrl}`);
      this.subscribeAll();
    });

    this.client.on('error', (err) => {
      this.logger.error(`MQTT 연결 오류: ${err.message}`);
    });

    this.client.on('reconnect', () => {
      this.logger.warn('MQTT 재연결 시도 중...');
    });

    this.client.on('message', (topic, payload) => {
      this.routeMessage(topic, payload);
    });
  }

  async onModuleDestroy() {
    if (this.client) {
      this.client.end();
      this.logger.log('MQTT 연결 종료');
    }
  }

  private subscribeAll() {
    const topics = [
      'farm/+/z2m/+',                  // 센서 데이터
      'farm/+/z2m/+/availability',      // 장비 온라인 상태
      'farm/+/z2m/bridge/state',        // 게이트웨이 상태
      'farm/+/z2m/bridge/devices',      // 페어링된 장비 목록
    ];

    for (const topic of topics) {
      this.client.subscribe(topic, { qos: 1 }, (err) => {
        if (err) {
          this.logger.error(`토픽 구독 실패: ${topic} - ${err.message}`);
        } else {
          this.logger.log(`토픽 구독: ${topic}`);
        }
      });
    }
  }

  private routeMessage(topic: string, payload: Buffer) {
    // topic: "farm/{gatewayId}/z2m/{rest...}"
    const parts = topic.split('/');
    if (parts.length < 4 || parts[0] !== 'farm' || parts[2] !== 'z2m') return;

    const gatewayId = parts[1];
    const rest = parts.slice(3).join('/');

    if (rest === 'bridge/state') {
      this.bridgeHandler.handleBridgeState(gatewayId, payload);
    } else if (rest === 'bridge/devices') {
      this.bridgeHandler.handleBridgeDevices(gatewayId, payload);
    } else if (rest.endsWith('/availability')) {
      const deviceName = rest.replace('/availability', '');
      this.deviceHandler.handleAvailability(gatewayId, deviceName, payload);
    } else if (!rest.includes('/')) {
      // farm/{gw}/z2m/{deviceName} → 센서 데이터
      this.sensorHandler.handleSensorData(gatewayId, rest, payload);
    }
  }

  /** 장비 제어 (MQTT publish) */
  async controlDevice(gatewayId: string, friendlyName: string, command: object): Promise<void> {
    const topic = `farm/${gatewayId}/z2m/${friendlyName}/set`;
    return new Promise((resolve, reject) => {
      this.client.publish(topic, JSON.stringify(command), { qos: 1 }, (err) => {
        if (err) {
          this.logger.error(`장비 제어 실패: ${topic} - ${err.message}`);
          reject(err);
        } else {
          this.logger.log(`장비 제어: ${topic} → ${JSON.stringify(command)}`);
          resolve();
        }
      });
    });
  }

  /** 페어링 모드 ON/OFF */
  async permitJoin(gatewayId: string, enable: boolean, duration = 120): Promise<void> {
    const topic = `farm/${gatewayId}/z2m/bridge/request/permit_join`;
    this.client.publish(topic, JSON.stringify({ value: enable, time: duration }));
    this.logger.log(`페어링 모드 ${enable ? 'ON' : 'OFF'}: ${gatewayId} (${duration}초)`);
  }

  /** 특정 게이트웨이의 Zigbee 장비 목록 (캐시) */
  getZigbeeDevices(gatewayId: string): ZigbeeDevice[] {
    return this.bridgeHandler.getZigbeeDevices(gatewayId);
  }

  isConnected(): boolean {
    return this.client?.connected ?? false;
  }
}
