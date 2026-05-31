import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Device } from '../devices/entities/device.entity';
import { Gateway } from '../gateway-manager/entities/gateway.entity';
import { SensorsService } from '../sensors/sensors.service';
import { EventsGateway } from '../gateway/events.gateway';
import { SensorPayload } from './mqtt.types';

/** Zigbee2MQTT 페이로드 키 → 내부 센서 타입 매핑 */
const SENSOR_MAP: Record<string, { field: string; unit: string; isBoolean?: boolean }> = {
  temperature:     { field: 'temperature', unit: '°C' },
  humidity:        { field: 'humidity', unit: '%' },
  co2:             { field: 'co2', unit: 'ppm' },
  illuminance_lux: { field: 'illuminance', unit: 'lux' },
  illuminance:     { field: 'illuminance', unit: 'lux' },
  soil_moisture:   { field: 'soil_moisture', unit: '%' },
  pressure:        { field: 'pressure', unit: 'hPa' },
  // Tuya TS0207 누수 센서 → rain_detection 채널로 정규화 (1/0)
  water_leak:      { field: 'rain_detection', unit: '', isBoolean: true },
  // Tuya 광학식 우적 센서 (rain detector 변종) — 'rain' boolean + 'rain_intensity' 수치
  rain:            { field: 'rain_detection', unit: '', isBoolean: true },
  rain_intensity:  { field: 'rain_intensity', unit: '' },
  illuminance_raw: { field: 'illuminance', unit: 'lux' },
  // 배터리 잔량 (% — Zigbee 배터리 device 공통)
  battery:         { field: 'battery', unit: '%' },
  battery_low:     { field: 'battery_low', unit: '', isBoolean: true },
};

@Injectable()
export class MqttSensorHandler {
  private readonly logger = new Logger(MqttSensorHandler.name);

  constructor(
    @InjectRepository(Device) private devicesRepo: Repository<Device>,
    @InjectRepository(Gateway) private gatewayRepo: Repository<Gateway>,
    private sensorsService: SensorsService,
    private eventsGateway: EventsGateway,
    private eventEmitter: EventEmitter2,
  ) {}

  async handleSensorData(gatewayId: string, deviceName: string, payload: Buffer) {
    let data: SensorPayload;
    try {
      data = JSON.parse(payload.toString());
    } catch {
      return; // 파싱 실패 무시
    }

    // gateway_id로 Gateway 조회 → device를 gateway + friendlyName으로 조회
    const gateway = await this.gatewayRepo.findOne({ where: { gatewayId } });
    const device = await this.devicesRepo.findOne({
      where: {
        friendlyName: deviceName,
        ...(gateway && { gatewayId: gateway.id }),
      },
    });
    if (!device) return;

    for (const [key, mapping] of Object.entries(SENSOR_MAP)) {
      if (data[key] == null) continue;
      // boolean 채널은 true/false를 1/0으로 변환
      const value = mapping.isBoolean
        ? (data[key] === true || data[key] === 'true' ? 1 : 0)
        : Number(data[key]);
      if (isNaN(value)) continue;

      // DB 저장 실패가 프로세스를 죽이지 않도록 try/catch (PK 중복 등)
      try {
        await this.sensorsService.storeSensorData({
          deviceId: device.id,
          userId: device.userId,
          sensorType: mapping.field,
          value,
          unit: mapping.unit,
        });
      } catch (err: any) {
        // 같은 ms 타임스탬프로 두 메시지 도착 시 PK 충돌 — 무시하고 계속
        if (err?.code !== '23505') {
          this.logger.warn(`sensor_data insert failed for ${deviceName}/${mapping.field}: ${err?.message || err}`);
        }
      }

      this.eventsGateway.broadcastSensorUpdate(device.userId, {
        deviceId: device.id,
        houseId: device.houseId,
        sensorType: mapping.field,
        value,
        unit: mapping.unit,
        status: 'normal',
        time: new Date().toISOString(),
      });

      // 우적 감지 → EventEmitter로 rain-override에 전달 (순환 의존 방지)
      if (mapping.field === 'rain_detection') {
        this.eventEmitter.emit('sensor.rain_detected', {
          deviceId: device.id,
          rainDetected: value === 1,
        });
      }
    }

    // 장비 lastSeen 업데이트 (실패해도 핸들러는 계속)
    try {
      await this.devicesRepo.update(device.id, { online: true, lastSeen: new Date() });
    } catch (err: any) {
      this.logger.warn(`device update failed for ${device.id}: ${err?.message || err}`);
    }
  }
}
