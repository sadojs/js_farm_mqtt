import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Device } from '../devices/entities/device.entity';
import { SensorsService } from '../sensors/sensors.service';
import { EventsGateway } from '../gateway/events.gateway';
import { SensorPayload } from './mqtt.types';

/** Zigbee2MQTT 페이로드 키 → 내부 센서 타입 매핑 */
const SENSOR_MAP: Record<string, { field: string; unit: string }> = {
  temperature:     { field: 'temperature', unit: '°C' },
  humidity:        { field: 'humidity', unit: '%' },
  co2:             { field: 'co2', unit: 'ppm' },
  illuminance_lux: { field: 'illuminance', unit: 'lux' },
  illuminance:     { field: 'illuminance', unit: 'lux' },
  soil_moisture:   { field: 'soil_moisture', unit: '%' },
  pressure:        { field: 'pressure', unit: 'hPa' },
};

@Injectable()
export class MqttSensorHandler {
  private readonly logger = new Logger(MqttSensorHandler.name);

  constructor(
    @InjectRepository(Device) private devicesRepo: Repository<Device>,
    private sensorsService: SensorsService,
    private eventsGateway: EventsGateway,
  ) {}

  async handleSensorData(gatewayId: string, deviceName: string, payload: Buffer) {
    let data: SensorPayload;
    try {
      data = JSON.parse(payload.toString());
    } catch {
      return; // 파싱 실패 무시
    }

    const device = await this.devicesRepo.findOne({
      where: { friendlyName: deviceName, deviceType: 'sensor' },
    });
    if (!device) return;

    for (const [key, mapping] of Object.entries(SENSOR_MAP)) {
      if (data[key] == null) continue;
      const value = Number(data[key]);
      if (isNaN(value)) continue;

      await this.sensorsService.storeSensorData({
        deviceId: device.id,
        userId: device.userId,
        sensorType: mapping.field,
        value,
        unit: mapping.unit,
      });

      this.eventsGateway.broadcastSensorUpdate({
        deviceId: device.id,
        houseId: device.houseId,
        sensorType: mapping.field,
        value,
        unit: mapping.unit,
        status: 'normal',
        time: new Date().toISOString(),
      });
    }

    // 장비 lastSeen 업데이트
    await this.devicesRepo.update(device.id, { online: true, lastSeen: new Date() });
  }
}
