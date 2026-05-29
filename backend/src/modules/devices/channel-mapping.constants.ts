// 8채널 기본 매핑 (onboard 보드 — USB 채널 사용)
export const DEFAULT_CHANNEL_MAPPING_8CH: Record<string, string> = {
  remote_control:       'switch_1',
  zone_1:               'switch_2',
  zone_2:               'switch_3',
  zone_3:               'switch_4',
  zone_4:               'switch_5',
  fertilizer_b_contact: 'switch_6',
  mixer:                'switch_usb1',
  fertilizer_motor:     'switch_usb2',
};

// 8채널 기본 매핑 (zigbee — switch_7/8 사용, USB 없음)
export const DEFAULT_CHANNEL_MAPPING_8CH_ZIGBEE: Record<string, string> = {
  remote_control:       'switch_1',
  zone_1:               'switch_2',
  zone_2:               'switch_3',
  zone_3:               'switch_4',
  zone_4:               'switch_5',
  fertilizer_b_contact: 'switch_6',
  mixer:                'switch_7',
  fertilizer_motor:     'switch_8',
};

// 12채널 기본 매핑
export const DEFAULT_CHANNEL_MAPPING_12CH: Record<string, string> = {
  remote_control:       'switch_1',
  zone_1:               'switch_2',
  zone_2:               'switch_3',
  zone_3:               'switch_4',
  zone_4:               'switch_5',
  zone_5:               'switch_6',
  zone_6:               'switch_7',
  zone_7:               'switch_8',
  zone_8:               'switch_9',
  fertilizer_b_contact: 'switch_10',
  mixer:                'switch_11',
  fertilizer_motor:     'switch_12',
};

// 하위 호환용 별칭
export const DEFAULT_CHANNEL_MAPPING = DEFAULT_CHANNEL_MAPPING_8CH;

export const FUNCTION_LABELS: Record<string, string> = {
  remote_control:       '원격제어 ON/OFF',
  zone_1:               '1구역 관수',
  zone_2:               '2구역 관수',
  zone_3:               '3구역 관수',
  zone_4:               '4구역 관수',
  zone_5:               '5구역 관수',
  zone_6:               '6구역 관수',
  zone_7:               '7구역 관수',
  zone_8:               '8구역 관수',
  fertilizer_b_contact: '액비/교반기 B접점',
  mixer:                '교반기',
  fertilizer_motor:     '액비모터',
};

// 8CH 옵션 — onboard(switch_usb1/2)와 zigbee(switch_7/8) 둘 다 허용
export const AVAILABLE_SWITCH_CODES_8CH = [
  'switch_1', 'switch_2', 'switch_3', 'switch_4',
  'switch_5', 'switch_6', 'switch_7', 'switch_8',
  'switch_usb1', 'switch_usb2',
];

export const AVAILABLE_SWITCH_CODES_12CH = [
  'switch_1', 'switch_2', 'switch_3', 'switch_4',
  'switch_5', 'switch_6', 'switch_7', 'switch_8',
  'switch_9', 'switch_10', 'switch_11', 'switch_12',
];

// 하위 호환용 별칭
export const AVAILABLE_SWITCH_CODES = AVAILABLE_SWITCH_CODES_8CH;

/**
 * 채널 수 감지 — 우선순위:
 *   1. zigbeeModel '_switch_N' suffix → 명시적 채널 수
 *   2. switch_usb1/usb2 → onboard 8CH 확정
 *   3. switch_9~12 사용 → 12CH 확정 (8CH는 1~8까지만)
 *   4. 기본 8
 *
 * 주의: zigbee 8CH 모델(TS0601_switch_8)도 switch_7/switch_8을 사용하므로
 *       switch_7~8 존재만으로 12CH 판정하면 안 됨. switch_9 이상이 있을 때만 12CH.
 */
export function detectChannelCount(switchCodes: string[], zigbeeModel?: string | null): 8 | 12 {
  if (zigbeeModel) {
    const m = zigbeeModel.toLowerCase().match(/_switch_(\d+)/);
    if (m) return Number(m[1]) > 8 ? 12 : 8;
  }
  if (switchCodes.some(c => c === 'switch_usb1' || c === 'switch_usb2')) return 8;
  if (switchCodes.some(c => /^switch_(9|10|11|12)$/.test(c))) return 12;
  return 8;
}

/**
 * device source/모델에 맞는 8CH 기본 매핑 선택.
 * - onboard: switch_usb1/usb2 사용
 * - zigbee: switch_7/8 사용
 */
export function getDefault8chMapping(source?: string | null): Record<string, string> {
  return source === 'zigbee' ? DEFAULT_CHANNEL_MAPPING_8CH_ZIGBEE : DEFAULT_CHANNEL_MAPPING_8CH;
}

export function getDefaultMappingByCount(count: 8 | 12): Record<string, string> {
  return count === 12 ? DEFAULT_CHANNEL_MAPPING_12CH : DEFAULT_CHANNEL_MAPPING_8CH;
}

export function getAvailableSwitchCodesByCount(count: 8 | 12): string[] {
  return count === 12 ? AVAILABLE_SWITCH_CODES_12CH : AVAILABLE_SWITCH_CODES_8CH;
}
