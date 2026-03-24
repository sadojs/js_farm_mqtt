import { BaseSensor } from '../base/base-sensor.abstract';
import { SensorConfig } from '../base/sensor.interface';

/**
 * 온도 센서
 * 단위: ℃ (섭씨)
 * 일반적인 농업 환경: 15-30℃
 */
export class TemperatureSensor extends BaseSensor {
  constructor(config: SensorConfig) {
    super(config);
  }

  /**
   * Tuya 디바이스에서 온도 데이터 읽기
   */
  async readRawValue(): Promise<number> {
    // TODO: Tuya API 연동하여 실제 디바이스에서 데이터 읽기
    // const tuyaService = TuyaService.getInstance();
    // return await tuyaService.getDeviceStatus(this.config.deviceId, 'temperature');

    // 임시: 시뮬레이션 데이터
    return 20 + Math.random() * 10; // 20-30℃
  }

  getUnit(): string {
    return '℃';
  }

  /**
   * 온도 값 정규화 (소수점 1자리)
   */
  normalize(value: number): number {
    return Math.round(value * 10) / 10;
  }
}
