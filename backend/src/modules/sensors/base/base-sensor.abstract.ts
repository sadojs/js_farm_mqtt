import {
  ISensor,
  SensorConfig,
  SensorReading,
  SensorStatus,
  SensorThresholds,
} from './sensor.interface';

/**
 * 추상 센서 클래스
 * 모든 센서는 이 클래스를 상속받아 구현
 */
export abstract class BaseSensor implements ISensor {
  constructor(public config: SensorConfig) {}

  /**
   * 센서 데이터 읽기 (추상 메서드 - 각 센서에서 구현)
   */
  abstract readRawValue(): Promise<number>;

  /**
   * 센서 단위 (추상 메서드)
   */
  abstract getUnit(): string;

  /**
   * 센서 데이터 읽기 (공통 로직)
   */
  async read(): Promise<SensorReading> {
    if (!this.config.enabled) {
      throw new Error(`Sensor ${this.config.id} is disabled`);
    }

    try {
      const rawValue = await this.readRawValue();
      const normalizedValue = this.normalize(rawValue);
      const status = this.validate(normalizedValue);

      return {
        value: normalizedValue,
        unit: this.getUnit(),
        timestamp: new Date(),
        deviceId: this.config.deviceId,
        status,
        metadata: {
          sensorId: this.config.id,
          sensorType: this.config.type,
          location: this.config.location,
        },
      };
    } catch (error) {
      return {
        value: 0,
        unit: this.getUnit(),
        timestamp: new Date(),
        deviceId: this.config.deviceId,
        status: SensorStatus.OFFLINE,
        metadata: {
          error: error.message,
        },
      };
    }
  }

  /**
   * 센서 값 검증
   */
  validate(value: number): SensorStatus {
    const thresholds = this.config.thresholds;

    // Critical 범위 체크
    if (
      thresholds.criticalMin !== undefined &&
      value < thresholds.criticalMin
    ) {
      return SensorStatus.CRITICAL;
    }
    if (
      thresholds.criticalMax !== undefined &&
      value > thresholds.criticalMax
    ) {
      return SensorStatus.CRITICAL;
    }

    // Warning 범위 체크
    if (
      thresholds.warningMin !== undefined &&
      value < thresholds.warningMin
    ) {
      return SensorStatus.WARNING;
    }
    if (
      thresholds.warningMax !== undefined &&
      value > thresholds.warningMax
    ) {
      return SensorStatus.WARNING;
    }

    // 정상 범위
    if (value >= thresholds.min && value <= thresholds.max) {
      return SensorStatus.NORMAL;
    }

    return SensorStatus.WARNING;
  }

  /**
   * 센서 값 정규화 (기본 구현 - 필요시 오버라이드)
   */
  normalize(value: number): number {
    return Math.round(value * 10) / 10; // 소수점 1자리
  }

  /**
   * 임계값 가져오기
   */
  getThresholds(): SensorThresholds {
    return this.config.thresholds;
  }

  /**
   * 센서 활성화/비활성화
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
  }
}
