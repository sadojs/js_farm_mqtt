// 8채널 기본 매핑
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

export const AVAILABLE_SWITCH_CODES_8CH = [
  'switch_1', 'switch_2', 'switch_3', 'switch_4',
  'switch_5', 'switch_6', 'switch_usb1', 'switch_usb2',
];

export const AVAILABLE_SWITCH_CODES_12CH = [
  'switch_1', 'switch_2', 'switch_3', 'switch_4',
  'switch_5', 'switch_6', 'switch_7', 'switch_8',
  'switch_9', 'switch_10', 'switch_11', 'switch_12',
];

// 하위 호환용 별칭
export const AVAILABLE_SWITCH_CODES = AVAILABLE_SWITCH_CODES_8CH;

export function detectChannelCount(switchCodes: string[]): 8 | 12 {
  return switchCodes.some(c => /^switch_(7|8|9|10|11|12)$/.test(c)) ? 12 : 8;
}

export function getDefaultMappingByCount(count: 8 | 12): Record<string, string> {
  return count === 12 ? DEFAULT_CHANNEL_MAPPING_12CH : DEFAULT_CHANNEL_MAPPING_8CH;
}

export function getAvailableSwitchCodesByCount(count: 8 | 12): string[] {
  return count === 12 ? AVAILABLE_SWITCH_CODES_12CH : AVAILABLE_SWITCH_CODES_8CH;
}
