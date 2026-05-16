import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Device } from '../devices/entities/device.entity';
import { Gateway } from '../gateway-manager/entities/gateway.entity';
import { EventsGateway } from '../gateway/events.gateway';

@Injectable()
export class MqttDeviceHandler {
  private readonly logger = new Logger(MqttDeviceHandler.name);

  /** 최근 수신된 availability 상태 캐시: `${gatewayId}::${deviceName}` → online */
  private availabilityCache = new Map<string, boolean>();

  constructor(
    @InjectRepository(Device) private devicesRepo: Repository<Device>,
    @InjectRepository(Gateway) private gatewayRepo: Repository<Gateway>,
    private eventsGateway: EventsGateway,
  ) {}

  /** 특정 장치의 마지막 availability 상태 조회 (MQTT gateway ID 기준) */
  getCachedAvailability(mqttGatewayId: string, friendlyName: string): boolean | undefined {
    return this.availabilityCache.get(`${mqttGatewayId}::${friendlyName}`);
  }

  async handleAvailability(gatewayId: string, deviceName: string, payload: Buffer) {
    const raw = payload.toString().trim();
    let online: boolean;
    try {
      const parsed = JSON.parse(raw);
      online = typeof parsed === 'string' ? parsed === 'online' : parsed?.state === 'online';
    } catch {
      online = raw === 'online';
    }

    // 캐시 갱신 (DB 장치 유무와 무관하게 저장)
    this.availabilityCache.set(`${gatewayId}::${deviceName}`, online);

    const gateway = await this.gatewayRepo.findOne({ where: { gatewayId } });
    const device = await this.devicesRepo.findOne({
      where: {
        friendlyName: deviceName,
        ...(gateway && { gatewayId: gateway.id }),
      },
    });
    if (!device) return;

    if (device.online !== online) {
      await this.devicesRepo.update(device.id, { online, lastSeen: new Date() });
      this.eventsGateway.broadcastDeviceStatus(device.userId, device.id, online);
      this.logger.log(`장비 상태 변경: ${device.name} → ${online ? '온라인' : '오프라인'}`);
    }
  }
}
