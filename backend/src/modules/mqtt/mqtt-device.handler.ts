import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { Device } from '../devices/entities/device.entity';
import { Gateway } from '../gateway-manager/entities/gateway.entity';
import { EventsGateway } from '../gateway/events.gateway';

// 센서 offline 판정 임계 — lastSeen 이 이 값보다 오래되면 online=false (기본 10분).
// 센서(device_type='sensor')만 대상 — 액추에이터는 상태 변화 시에만 보고하므로 제외.
const SENSOR_STALE_MS = Number(process.env.SENSOR_OFFLINE_STALE_MS) || 10 * 60 * 1000;

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

  /**
   * 매 분: stale 센서 자동 오프라인 처리.
   * z2m availability 메시지에만 의존하면(미발행 시) online=true 로 박제되는 문제 대비 fallback.
   * lastSeen 이 SENSOR_STALE_MS(기본 10분) 초과인 센서를 offline 처리.
   * 액추에이터는 상태 변화 시에만 보고하므로 제외(device_type='sensor' 만).
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async resetStaleSensorStatus() {
    const threshold = new Date(Date.now() - SENSOR_STALE_MS);
    const stale = await this.devicesRepo.find({
      where: { deviceType: 'sensor', online: true, lastSeen: LessThan(threshold) },
    });
    for (const device of stale) {
      await this.devicesRepo.update(device.id, { online: false });
      this.eventsGateway.broadcastDeviceStatus(device.userId, device.id, false);
      this.logger.warn(
        `센서 ${device.name} 무응답 ${Math.round(SENSOR_STALE_MS / 60000)}분 초과 → offline ` +
        `(lastSeen: ${device.lastSeen instanceof Date ? device.lastSeen.toISOString() : device.lastSeen})`,
      );
    }
  }
}
