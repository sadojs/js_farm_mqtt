-- ==========================================
-- Migration 015: gpio_pin
-- gateway_onboard_devices에 GPIO 핀 번호 컬럼 추가
-- BCM 핀 번호 (2~27), NULL=미배정
-- ==========================================

ALTER TABLE gateway_onboard_devices
  ADD COLUMN IF NOT EXISTS gpio_pin INT DEFAULT NULL;

COMMENT ON COLUMN gateway_onboard_devices.gpio_pin
  IS 'Raspberry Pi BCM GPIO 핀 번호 (2~27), NULL=미배정';
