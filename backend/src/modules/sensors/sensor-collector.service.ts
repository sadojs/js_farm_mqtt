import { Injectable, Logger } from '@nestjs/common';

/**
 * SensorCollectorService는 MQTT 전환으로 더 이상 직접 센서 데이터를 수집하지 않습니다.
 *
 * Before (Tuya): @Cron(EVERY_5_MINUTES) → Tuya Cloud API polling
 * After (MQTT):  MqttSensorHandler가 MQTT subscribe로 실시간 수신
 *
 * 이 클래스는 하위 호환성을 위해 유지하며, 향후 삭제 예정입니다.
 */
@Injectable()
export class SensorCollectorService {
  private readonly logger = new Logger(SensorCollectorService.name);

  constructor() {
    this.logger.log('센서 수집은 MQTT subscribe 기반으로 동작합니다 (MqttSensorHandler)');
  }
}
