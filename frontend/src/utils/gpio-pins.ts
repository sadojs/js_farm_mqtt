/**
 * Raspberry Pi 4/5의 26개 BCM GPIO 핀 (BCM 2 ~ BCM 27).
 *
 * 별도 전원을 사용하는 릴레이 모듈의 경우 모든 26개 핀을 사용 가능.
 * raspi-config로 I2C/SPI/UART 비활성화 + dtoverlay로 시스템 핀도 일반 GPIO로 reassign하면
 * 모든 핀이 단순 출력으로 동작.
 *
 * 단, 다음은 default alternate function이 활성화돼 있을 수 있어 주의:
 *  - BCM 2, 3: I2C (SDA, SCL) — raspi-config에서 I2C 비활성화 필요
 *  - BCM 7, 8, 9, 10, 11: SPI (CE1, CE0, MISO, MOSI, SCLK) — SPI 비활성화
 *  - BCM 14, 15: UART (TX, RX) — serial console 비활성화
 *
 * 이 핀들의 부가 기능 라벨은 SPECIAL_FUNCTIONS에 표기.
 */
export const USABLE_BCM_PINS = [
  2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
  16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27,
] as const;

/** 핀별 부가 기능 (시스템 인터페이스 - raspi-config로 비활성화 시 일반 GPIO로 사용 가능) */
export const SPECIAL_FUNCTIONS: Record<number, string> = {
  2: 'I2C SDA',
  3: 'I2C SCL',
  7: 'SPI CE1',
  8: 'SPI CE0',
  9: 'SPI MISO',
  10: 'SPI MOSI',
  11: 'SPI SCLK',
  14: 'UART TX',
  15: 'UART RX',
};

/** 핀별 RPi 물리 핀 번호 (헤더 위치) — UI에서 핀 위치 표시용 */
export const BCM_TO_PHYSICAL: Record<number, number> = {
  2: 3, 3: 5, 4: 7, 5: 29, 6: 31, 7: 26, 8: 24, 9: 21,
  10: 19, 11: 23, 12: 32, 13: 33, 14: 8, 15: 10, 16: 36, 17: 11,
  18: 12, 19: 35, 20: 38, 21: 40, 22: 15, 23: 16, 24: 18,
  25: 22, 26: 37, 27: 13,
};

/** 핀 사용 안내 라벨 (드롭다운 등에서 사용) */
export function getBcmPinLabel(bcm: number): string {
  const phys = BCM_TO_PHYSICAL[bcm];
  const special = SPECIAL_FUNCTIONS[bcm];
  const physStr = phys ? ` (Pin ${phys})` : '';
  const specialStr = special ? ` ⚠${special}` : '';
  return `BCM ${bcm}${physStr}${specialStr}`;
}
