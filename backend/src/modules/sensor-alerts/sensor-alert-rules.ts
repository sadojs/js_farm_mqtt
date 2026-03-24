// 강원도 횡성군 군내면 기준 + 방울토마토 하우스 재배
// 실제 sensor_data 테이블에 존재하는 센서 타입만 등록
export interface AlertRuleParams {
  epsilon: number;       // flatline 변화 감지 임계값
  spikeThreshold: number; // spike 10분 변화 임계값
  min: number;           // 물리적 최소값
  max: number;           // 물리적 최대값
  unit: string;
}

export const SENSOR_ALERT_RULES: Record<string, AlertRuleParams> = {
  // ── 하우스 내부 핵심 센서 ──
  temperature:             { epsilon: 0.3,  spikeThreshold: 8,   min: -15, max: 55,   unit: '°C' },
  humidity:                { epsilon: 0.5,  spikeThreshold: 25,  min: 0,   max: 100,  unit: '%' },
  // ── 기상 관측 센서 ──
  dew_point:               { epsilon: 0.3,  spikeThreshold: 5,   min: -30, max: 40,   unit: '°C' },
  rainfall:                { epsilon: 0.1,  spikeThreshold: 50,  min: 0,   max: 500,  unit: 'mm' },
  rain_rate:               { epsilon: 0.1,  spikeThreshold: 100, min: 0,   max: 300,  unit: 'mm/h' },
  rain_1h:                 { epsilon: 0.1,  spikeThreshold: 50,  min: 0,   max: 200,  unit: 'mm' },
  rain_24h:                { epsilon: 0.5,  spikeThreshold: 100, min: 0,   max: 500,  unit: 'mm' },
  uv:                      { epsilon: 0.5,  spikeThreshold: 5,   min: 0,   max: 20,   unit: 'mW/cm²' },
  uv_index:                { epsilon: 0.5,  spikeThreshold: 4,   min: 0,   max: 15,   unit: '' },
  atmospheric_pressture:   { epsilon: 0.3,  spikeThreshold: 10,  min: 870, max: 1085, unit: 'hPa' },
  pressure_drop:           { epsilon: 0.1,  spikeThreshold: 5,   min: -50, max: 50,   unit: 'hPa' },
  windspeed_avg:           { epsilon: 0.3,  spikeThreshold: 10,  min: 0,   max: 60,   unit: 'm/s' },
  windspeed_gust:          { epsilon: 0.5,  spikeThreshold: 15,  min: 0,   max: 80,   unit: 'm/s' },
  // ── 온도 파생 지표 ──
  feellike_temp:           { epsilon: 0.5,  spikeThreshold: 8,   min: -30, max: 55,   unit: '°C' },
  heat_index:              { epsilon: 0.5,  spikeThreshold: 8,   min: -15, max: 60,   unit: '°C' },
  windchill_index:         { epsilon: 0.5,  spikeThreshold: 8,   min: -40, max: 40,   unit: '°C' },
  dew_point_temp:          { epsilon: 0.3,  spikeThreshold: 5,   min: -30, max: 40,   unit: '°C' },
  // ── 실외 온습도 (다채널) ──
  temp_current_external:   { epsilon: 0.3,  spikeThreshold: 8,   min: -20, max: 55,   unit: '°C' },
  temp_current_external_1: { epsilon: 0.3,  spikeThreshold: 8,   min: -20, max: 55,   unit: '°C' },
  temp_current_external_2: { epsilon: 0.3,  spikeThreshold: 8,   min: -20, max: 55,   unit: '°C' },
  temp_current_external_3: { epsilon: 0.3,  spikeThreshold: 8,   min: -20, max: 55,   unit: '°C' },
  humidity_outdoor:        { epsilon: 0.5,  spikeThreshold: 25,  min: 0,   max: 100,  unit: '%' },
  humidity_outdoor_1:      { epsilon: 0.5,  spikeThreshold: 25,  min: 0,   max: 100,  unit: '%' },
  humidity_outdoor_2:      { epsilon: 0.5,  spikeThreshold: 25,  min: 0,   max: 100,  unit: '%' },
  humidity_outdoor_3:      { epsilon: 0.5,  spikeThreshold: 25,  min: 0,   max: 100,  unit: '%' },
};

// 데이터 없음 임계값 (분)
export const NO_DATA_WARNING_MINUTES = 60; // 1시간
export const NO_DATA_CRITICAL_MINUTES = 360; // 6시간

// Flatline 윈도우 (시간)
export const FLATLINE_WINDOW_HOURS = 24;

// 알림 반복(flapping) 감지: 6시간 내 3회 이상 no_data 해제 시 센서 점검 알림
export const FLAPPING_WINDOW_HOURS = 6;
export const FLAPPING_THRESHOLD = 3;

// 유형별 조치 가이드
export const ACTION_GUIDES: Record<string, string[]> = {
  no_data: [
    '배터리/전원 상태를 확인하세요',
    '게이트웨이 연결 상태를 확인하세요',
    'Tuya 앱에서 장비 온라인 상태를 확인하세요',
  ],
  flatline: [
    '센서 프로브의 접촉 상태를 확인하세요',
    '센서 전원을 리부팅하세요',
    '주변 다른 센서 값과 비교해보세요',
  ],
  spike: [
    '주변 환경에 급격한 변화가 있었는지 확인하세요',
    '센서 위치가 이탈되지 않았는지 확인하세요',
    '오작동으로 판단되면 해당 데이터를 무시하세요',
  ],
  out_of_range: [
    '센서 교정이 필요할 수 있습니다',
    '물리적 손상 여부를 확인하세요',
    '교체를 검토하세요',
  ],
  unstable: [
    '센서 연결이 불안정합니다. 센서를 점검하세요',
    '배터리 잔량 및 전원 공급 상태를 확인하세요',
    '게이트웨이와의 거리 및 장애물을 확인하세요',
  ],
};
