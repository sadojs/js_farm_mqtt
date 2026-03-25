/** Zigbee2MQTT bridge/devices 응답의 장비 정보 */
export interface ZigbeeDevice {
  ieee_address: string;
  friendly_name: string;
  type: 'Coordinator' | 'Router' | 'EndDevice';
  model_id?: string;
  manufacturer?: string;
  supported: boolean;
  disabled: boolean;
  definition?: {
    model: string;
    vendor: string;
    description: string;
    exposes: ZigbeeExpose[];
  };
}

export interface ZigbeeExpose {
  type: string;              // 'numeric', 'binary', 'switch', 'light', 'climate'
  name?: string;             // 'temperature', 'humidity', 'state'
  property?: string;
  unit?: string;
  access?: number;
  value_min?: number;
  value_max?: number;
}

/** MQTT 메시지 파싱 결과 */
export interface ParsedMqttTopic {
  gatewayId: string;
  rest: string;              // z2m/ 이후 부분
}

/** 센서 데이터 페이로드 (Zigbee2MQTT가 보내는 JSON) */
export interface SensorPayload {
  temperature?: number;
  humidity?: number;
  co2?: number;
  illuminance_lux?: number;
  illuminance?: number;
  soil_moisture?: number;
  pressure?: number;
  battery?: number;
  linkquality?: number;
  [key: string]: any;
}
