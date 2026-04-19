import { Injectable, Logger } from '@nestjs/common';
import { GatewayManagerService } from '../gateway-manager/gateway-manager.service';
import { ZigbeeDevice } from './mqtt.types';

@Injectable()
export class MqttBridgeHandler {
  private readonly logger = new Logger(MqttBridgeHandler.name);

  /** 게이트웨이별 Zigbee 장비 목록 캐시 */
  private deviceCache = new Map<string, ZigbeeDevice[]>();

  constructor(
    private gatewayService: GatewayManagerService,
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
      devices = JSON.parse(payload.toString());
    } catch {
      return;
    }

    // Coordinator 제외하고 캐시에 저장
    const filtered = devices.filter(d => d.type !== 'Coordinator');
    this.deviceCache.set(gatewayId, filtered);
    this.logger.log(`게이트웨이 ${gatewayId}: ${filtered.length}개 Zigbee 장비 캐시됨`);
  }

  /** 특정 게이트웨이의 Zigbee 장비 목록 반환 */
  getZigbeeDevices(gatewayId: string): ZigbeeDevice[] {
    return this.deviceCache.get(gatewayId) || [];
  }
}
