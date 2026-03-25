import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Device } from '../devices/entities/device.entity';
import { EventsGateway } from '../gateway/events.gateway';

@Injectable()
export class MqttDeviceHandler {
  private readonly logger = new Logger(MqttDeviceHandler.name);

  constructor(
    @InjectRepository(Device) private devicesRepo: Repository<Device>,
    private eventsGateway: EventsGateway,
  ) {}

  async handleAvailability(gatewayId: string, deviceName: string, payload: Buffer) {
    let data: { state: string };
    try {
      data = JSON.parse(payload.toString());
    } catch {
      return;
    }

    const online = data.state === 'online';
    const device = await this.devicesRepo.findOne({
      where: { friendlyName: deviceName },
    });
    if (!device) return;

    if (device.online !== online) {
      await this.devicesRepo.update(device.id, { online, lastSeen: new Date() });
      this.eventsGateway.broadcastDeviceStatus(device.id, online);
      this.logger.log(`장비 상태 변경: ${device.name} → ${online ? '온라인' : '오프라인'}`);
    }
  }
}
