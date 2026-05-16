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
      'farm/+/z2m/bridge/state',            // 게이트웨이 상태
      'farm/+/z2m/bridge/devices',        // 페어링된 장비 목록 (자동 발행)
      'farm/+/z2m/bridge/response/devices', // 장비 목록 요청 응답
      'farm/+/agent/status',            // Config Agent 하트비트
      'farm/+/tunnel/status',           // 리버스 SSH 터널 상태
      'farm/+/gpio/status',             // GPIO 에이전트 릴레이 상태 응답
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
    // topic: "farm/{gatewayId}/..." (z2m 또는 config)
    const parts = topic.split('/');
    if (parts.length < 4 || parts[0] !== 'farm') return;

    const gatewayId = parts[1];
    const namespace = parts[2]; // 'z2m' or 'config'

    // Config Agent 하트비트: farm/{gw}/agent/status
    if (namespace === 'agent' && parts[3] === 'status') {
      this.bridgeHandler.handleAgentStatus(gatewayId, payload);
      return;
    }

    // 리버스 SSH 터널 상태: farm/{gw}/tunnel/status
    if (namespace === 'tunnel' && parts[3] === 'status') {
      this.bridgeHandler.handleTunnelStatus(gatewayId, payload);
      return;
    }

    // GPIO 에이전트 릴레이 응답: farm/{gw}/gpio/status
    if (namespace === 'gpio' && parts[3] === 'status') {
      this.bridgeHandler.handleGpioStatus(gatewayId, payload);
      return;
    }

    if (namespace !== 'z2m') return;

    const rest = parts.slice(3).join('/');

    if (rest === 'bridge/state') {
      this.bridgeHandler.handleBridgeState(gatewayId, payload);
    } else if (rest === 'bridge/devices' || rest === 'bridge/response/devices') {
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

  /** GPIO 릴레이 명령 발행 → farm/{gatewayId}/gpio/relay */
  async publishGpioRelay(gatewayId: string, cmd: {
    slot: string; pin: number; state: boolean; durationMs?: number;
  }): Promise<void> {
    const topic = `farm/${gatewayId}/gpio/relay`;
    const payload = JSON.stringify({ ...cmd, requestId: Date.now() });
    return new Promise((resolve, reject) => {
      this.client.publish(topic, payload, { qos: 1 }, (err) => {
        if (err) {
          this.logger.error(`GPIO 명령 발행 실패: ${topic} - ${err.message}`);
          reject(err);
        } else {
          this.logger.log(`GPIO 명령: ${topic} pin=${cmd.pin} state=${cmd.state}`);
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

  /**
   * Zigbee 장치 목록 조회.
   * Z2M은 `bridge/devices` 토픽에 retained 메시지로 장치 목록을 자동 발행하므로
   * 별도 request 명령은 불필요. 캐시(브릿지 핸들러)에 항상 최신 목록이 유지된다.
   * 페어링 후 새 장치가 즉시 반영되며, 만약 짧은 시간 내 갱신이 필요하면 retained 메시지
   * 재수신(재구독)을 통해 갱신할 수도 있다.
   */
  async requestZigbeeDevices(gatewayId: string): Promise<ZigbeeDevice[]> {
    return this.bridgeHandler.getZigbeeDevices(gatewayId);
  }

  /** 캐시된 availability 상태 조회 (MQTT gateway ID + friendlyName) */
  getCachedAvailability(mqttGatewayId: string, friendlyName: string): boolean | undefined {
    return this.deviceHandler.getCachedAvailability(mqttGatewayId, friendlyName);
  }

  isConnected(): boolean {
    return this.client?.connected ?? false;
  }
}
