import { BaseSensor } from '../base/base-sensor.abstract';
import { SensorConfig } from '../base/sensor.interface';

/**
 * 습도 센서
 * 단위: % (상대 습도)
 * 일반적인 농업 환경: 50-80%
 */
export class HumiditySensor extends BaseSensor {
  constructor(config: SensorConfig) {
    super(config);
  }

  async readRawValue(): Promise<number> {
    // TODO: Tuya API 연동
    // 임시: 시뮬레이션 데이터
    return 50 + Math.random() * 30; // 50-80%
  }

  getUnit(): string {
    return '%';
  }

  normalize(value: number): number {
    // 0-100% 범위로 제한
    return Math.max(0, Math.min(100, Math.round(value)));
  }
}
