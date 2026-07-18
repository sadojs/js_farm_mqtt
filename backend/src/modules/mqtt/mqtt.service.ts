import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as mqtt from 'mqtt';
import { MqttSensorHandler } from './mqtt-sensor.handler';
import { MqttDeviceHandler } from './mqtt-device.handler';
import { MqttBridgeHandler } from './mqtt-bridge.handler';
import { ZigbeeDevice } from './mqtt.types';
/** 폴백 채널 매핑 엔트리 — 온보드 GPIO(pin) 또는 Zigbee(friendlyName/z2mKey) */
type ChannelEntry = {
  channel: string;
  name: string;
  type?: 'gpio' | 'zigbee';
  pin?: number;
  friendlyName?: string;
  z2mKey?: string;
};

type ConfigResponseHandler = (gatewayId: string, payload: Buffer) => void;
type FallbackModeHandler = (gatewayId: string, payload: Buffer) => void;
type FallbackEventsHandler = (gatewayId: string, payload: Buffer) => void;
type FallbackAckHandler = (gatewayId: string, payload: Buffer) => void;

@Injectable()
export class MqttService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MqttService.name);
  private client: mqtt.MqttClient;
  private configResponseHandler: ConfigResponseHandler | null = null;
  private fallbackModeHandler: FallbackModeHandler | null = null;
  private fallbackEventsHandler: FallbackEventsHandler | null = null;
  private fallbackAckHandler: FallbackAckHandler | null = null;

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
      'farm/+/config/response',         // Config Agent — 원격 설정 배포 결과
      'farm/+/fallback/mode',           // RPi fallback-engine — 현재 모드 (online/fallback)
      'farm/+/fallback/events',         // RPi fallback-engine — 폴백 이벤트 배치
      'farm/+/fallback/ack',            // RPi fallback-engine — 룰 동기화 ACK
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

    // RPi fallback-engine: farm/{gw}/fallback/{mode|events|ack}
    if (namespace === 'fallback') {
      const sub = parts[3];
      try {
        if (sub === 'mode' && this.fallbackModeHandler) {
          this.fallbackModeHandler(gatewayId, payload);
        } else if (sub === 'events' && this.fallbackEventsHandler) {
          this.fallbackEventsHandler(gatewayId, payload);
        } else if (sub === 'ack' && this.fallbackAckHandler) {
          this.fallbackAckHandler(gatewayId, payload);
        }
      } catch (err: any) {
        this.logger.warn(`fallback/${sub} 처리 실패: ${err?.message ?? err}`);
      }
      return;
    }

    // Config Agent 응답: farm/{gw}/config/response
    if (namespace === 'config' && parts[3] === 'response') {
      if (this.configResponseHandler) {
        try {
          this.configResponseHandler(gatewayId, payload);
        } catch (err: any) {
          this.logger.warn(`config response 처리 실패: ${err?.message ?? err}`);
        }
      }
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

  /**
   * device-replacement: z2m에서 옛 IEEE 장치 제거 (페어링 해제).
   * 트랜잭션 외부 best-effort 호출 — 실패해도 backend DB는 이미 swap 완료된 상태.
   */
  async removeZigbeeDevice(gatewayId: string, ieee: string): Promise<void> {
    const topic = `farm/${gatewayId}/z2m/bridge/request/device/remove`;
    const payload = JSON.stringify({ id: ieee, block: false, force: false });
    return new Promise((resolve, reject) => {
      this.client.publish(topic, payload, { qos: 1 }, (err) => {
        if (err) {
          this.logger.warn(`z2m device remove 실패 ${gatewayId}/${ieee}: ${err.message}`);
          reject(err);
        } else {
          this.logger.log(`z2m device remove 발행: ${gatewayId}/${ieee}`);
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

  /** Config Agent용 원격 요청 발행 → farm/{gatewayId}/config/request */
  async publishConfigRequest(gatewayId: string, payload: object): Promise<void> {
    const topic = `farm/${gatewayId}/config/request`;
    return new Promise((resolve, reject) => {
      this.client.publish(topic, JSON.stringify(payload), { qos: 1 }, (err) => {
        if (err) {
          this.logger.error(`config request 발행 실패: ${topic} - ${err.message}`);
          reject(err);
        } else {
          this.logger.log(`config request: ${topic}`);
          resolve();
        }
      });
    });
  }

  /**
   * Config Agent의 farm/+/config/response 메시지를 처리할 콜백 등록.
   * 순환 의존을 피하기 위해 MqttService → ConfigDeployService 직접 호출 대신
   * 콜백 패턴 사용. ConfigDeployService.onModuleInit()에서 1회 등록.
   */
  setConfigResponseHandler(handler: ConfigResponseHandler): void {
    this.configResponseHandler = handler;
  }

  // ─────────────────────────────────────────────────────────
  // rpi-emergency-failover: Fallback 관련 publish/subscribe
  // ─────────────────────────────────────────────────────────

  setFallbackHandlers(handlers: {
    mode?: FallbackModeHandler;
    events?: FallbackEventsHandler;
    ack?: FallbackAckHandler;
  }): void {
    if (handlers.mode) this.fallbackModeHandler = handlers.mode;
    if (handlers.events) this.fallbackEventsHandler = handlers.events;
    if (handlers.ack) this.fallbackAckHandler = handlers.ack;
  }

  /** 서버 → RPi 하트비트 발행 (10초 주기). retained=false (실시간 도착 기준 판정) */
  publishServerHeartbeat(gatewayId: string, ts: string): void {
    if (!this.client?.connected) return;
    const topic = `farm/${gatewayId}/server/heartbeat`;
    const payload = JSON.stringify({ ts });
    this.client.publish(topic, payload, { qos: 0, retain: false });
  }

  /** 서버 → 모든 게이트웨이 하트비트 발행 (wildcard 없이 개별 publish) */
  publishServerHeartbeatBatch(gatewayIds: string[], ts: string): void {
    for (const gw of gatewayIds) this.publishServerHeartbeat(gw, ts);
  }

  /** 서버 → RPi 폴백 룰 동기화 publish (retained) */
  async publishFallbackRulesSync(
    gatewayId: string,
    payload: {
      version: number;
      config: object;
      schedule: object[];
      // rpi-fallback-channel-sync: 채널 매핑. gpio(pin) + zigbee(friendlyName/z2mKey) 혼합.
      channelMapping?: {
        irrigation: ChannelEntry[];
        fertilizer: ChannelEntry[];
        fan: ChannelEntry[];
        opener: { open: ChannelEntry[]; close: ChannelEntry[] };
      };
      // 폴백 관수 스케줄(automation 관수룰 → 온보드 GPIO 오프라인 실행용)
      irrigationSchedules?: Array<{
        ruleId: string;
        startTime: string;
        days: number[];
        zones: Array<{ channel: string; durationMin: number; waitMin: number }>;
        mixer: { enabled: boolean; channel: string } | null;
        fertilizer: {
          enabled: boolean;
          channel: string;
          durationMin: number;
          preStopWaitMin: number;
        } | null;
      }>;
    },
  ): Promise<void> {
    const topic = `farm/${gatewayId}/fallback/rules/sync`;
    return new Promise((resolve, reject) => {
      this.client.publish(
        topic,
        JSON.stringify(payload),
        { qos: 1, retain: true },
        (err) => {
          if (err) {
            this.logger.error(`fallback rules sync 실패: ${topic} - ${err.message}`);
            reject(err);
          } else {
            this.logger.log(`fallback rules sync: ${topic} (v${payload.version})`);
            resolve();
          }
        },
      );
    });
  }

  /** 서버 → RPi 비상 정지 명령. 폴백 모드에서도 통과되어야 함. */
  async publishEmergencyStop(
    gatewayId: string,
    reason: string,
    by: string,
  ): Promise<void> {
    const topic = `farm/${gatewayId}/gpio/emergency-stop`;
    const payload = JSON.stringify({ reason, by, ts: new Date().toISOString() });
    return new Promise((resolve, reject) => {
      this.client.publish(topic, payload, { qos: 1, retain: false }, (err) => {
        if (err) {
          this.logger.error(`emergency stop 실패: ${topic} - ${err.message}`);
          reject(err);
        } else {
          this.logger.warn(`EMERGENCY STOP 발행: ${topic} (by ${by})`);
          resolve();
        }
      });
    });
  }
}
