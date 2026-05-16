import { Injectable, Logger } from '@nestjs/common';
import { GatewayManagerService } from '../gateway-manager/gateway-manager.service';
import { EventsGateway } from '../gateway/events.gateway';
import { ZigbeeDevice } from './mqtt.types';

@Injectable()
export class MqttBridgeHandler {
  private readonly logger = new Logger(MqttBridgeHandler.name);

  /** 게이트웨이별 Zigbee 장비 목록 캐시 */
  private deviceCache = new Map<string, ZigbeeDevice[]>();
  private devicesListeners: Array<(gatewayId: string) => void> = [];

  constructor(
    private gatewayService: GatewayManagerService,
    private eventsGateway: EventsGateway,
  ) {}

  async handleBridgeState(gatewayId: string, payload: Buffer) {
    let data: { state: string };
    try {
      data = JSON.parse(payload.toString());
    } catch {
      return;
    }

    await this.gatewayService.updateZigbeeStatus(gatewayId, data.state);
    this.logger.log(`게이트웨이 ${gatewayId} Zigbee → ${data.state}`);
  }

  async handleAgentStatus(gatewayId: string, payload: Buffer) {
    let data: { status: string };
    try {
      data = JSON.parse(payload.toString());
    } catch {
      return;
    }

    await this.gatewayService.updateAgentStatus(gatewayId, data.status);
    this.logger.log(`게이트웨이 ${gatewayId} Agent → ${data.status}`);
  }

  async handleBridgeDevices(gatewayId: string, payload: Buffer) {
    let devices: ZigbeeDevice[];
    try {
      const parsed = JSON.parse(payload.toString());
      // bridge/devices → 배열 직접, bridge/response/devices → { data: [...], status: 'ok' }
      devices = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.data) ? parsed.data : []);
    } catch {
      return;
    }
    if (devices.length === 0) return;

    // Coordinator 제외하고 캐시에 저장
    const filtered = devices.filter(d => d.type !== 'Coordinator');
    this.deviceCache.set(gatewayId, filtered);
    this.logger.log(`게이트웨이 ${gatewayId}: ${filtered.length}개 Zigbee 장비 캐시됨`);

    // 대기 중인 리스너에게 알림
    this.devicesListeners.forEach(fn => fn(gatewayId));
  }

  async handleTunnelStatus(gatewayId: string, payload: Buffer) {
    let data: { status: 'connected' | 'disconnected' };
    try {
      data = JSON.parse(payload.toString());
    } catch {
      return;
    }
    await this.gatewayService.updateTunnelStatus(gatewayId, data.status);
    this.logger.log(`게이트웨이 ${gatewayId} 터널 → ${data.status}`);
  }

  async handleGpioStatus(gatewayId: string, payload: Buffer) {
    let data: { slot: string; pin: number; state: boolean; auto?: boolean; timestamp: string };
    try {
      data = JSON.parse(payload.toString());
    } catch {
      return;
    }
    this.logger.log(
      `GPIO 상태 [${gatewayId}] ${data.slot}: BCM ${data.pin} → ${data.state ? 'HIGH' : 'LOW'}${data.auto ? ' (자동해제)' : ''}`,
    );
    // UUID로 변환하여 브로드캐스트 (프론트엔드는 URL param UUID 기준)
    const gw = await this.gatewayService.findByGatewayId(gatewayId);
    this.eventsGateway.broadcastGpioStatus(gw?.id ?? gatewayId, {
      slot: data.slot, pin: data.pin, state: data.state, auto: data.auto,
    });
  }

  /** 특정 게이트웨이의 Zigbee 장비 목록 반환 */
  getZigbeeDevices(gatewayId: string): ZigbeeDevice[] {
    return this.deviceCache.get(gatewayId) || [];
  }

  onDevicesUpdated(fn: (gatewayId: string) => void): void {
    this.devicesListeners.push(fn);
  }

  removeDevicesListener(fn: (gatewayId: string) => void): void {
    this.devicesListeners = this.devicesListeners.filter(l => l !== fn);
  }
}
