/**
 * 센서 타입 정의
 */
export enum SensorType {
  TEMPERATURE = 'temperature',
  HUMIDITY = 'humidity',
  CO2 = 'co2',
  LIGHT = 'light',
  SOIL_MOISTURE = 'soil_moisture',
  PH = 'ph',
  EC = 'ec',
}

/**
 * 센서 상태
 */
export enum SensorStatus {
  NORMAL = 'normal',
  WARNING = 'warning',
  CRITICAL = 'critical',
  OFFLINE = 'offline',
}

/**
 * 센서 읽기 결과
 */
export interface SensorReading {
  value: number;
  unit: string;
  timestamp: Date;
  deviceId: string;
  status: SensorStatus;
  metadata?: Record<string, any>;
}

/**
 * 센서 임계값
 */
export interface SensorThresholds {
  min: number;
  max: number;
  warningMin?: number;
  warningMax?: number;
  criticalMin?: number;
  criticalMax?: number;
}

/**
 * 센서 설정
 */
export interface SensorConfig {
  id: string;
  name: string;
  type: SensorType;
  deviceId: string;
  location?: string;
  thresholds: SensorThresholds;
  enabled: boolean;
  pollingInterval?: number; // milliseconds
}

/**
 * 센서 인터페이스
 */
export interface ISensor {
  config: SensorConfig;

  /**
   * 센서 데이터 읽기
   */
  read(): Promise<SensorReading>;

  /**
   * 센서 값 검증
   */
  validate(value: number): SensorStatus;

  /**
   * 센서 값 정규화
   */
  normalize(value: number): number;

  /**
   * 임계값 가져오기
   */
  getThresholds(): SensorThresholds;

  /**
   * 센서 활성화/비활성화
   */
  setEnabled(enabled: boolean): void;
}
