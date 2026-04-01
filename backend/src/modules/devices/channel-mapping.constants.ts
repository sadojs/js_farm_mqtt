export const DEFAULT_CHANNEL_MAPPING: Record<string, string> = {
  remote_control:       'switch_1',
  zone_1:               'switch_2',
  zone_2:               'switch_3',
  zone_3:               'switch_4',
  zone_4:               'switch_5',
  fertilizer_b_contact: 'switch_6',
  mixer:                'switch_usb1',
  fertilizer_motor:     'switch_usb2',
};

export const FUNCTION_LABELS: Record<string, string> = {
  remote_control:       '원격제어 ON/OFF',
  zone_1:               '1구역 관수',
  zone_2:               '2구역 관수',
  zone_3:               '3구역 관수',
  zone_4:               '4구역 관수',
  fertilizer_b_contact: '액비/교반기 B접점',
  mixer:                '교반기',
  fertilizer_motor:     '액비모터',
};

export const AVAILABLE_SWITCH_CODES = [
  'switch_1', 'switch_2', 'switch_3', 'switch_4',
  'switch_5', 'switch_6', 'switch_usb1', 'switch_usb2',
];
