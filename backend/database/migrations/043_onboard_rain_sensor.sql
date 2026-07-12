-- Migration 041: 무전압 접점 우적센서 온보드 슬롯(BCM21 고정) 추가
-- 배경: 라즈베리파이 헤더 40번(BCM21)+39번(GND)에 무전압 우적 접점을 직결하여
--       기존 Zigbee 우적 파이프라인(rain_detection → 개폐기 강제 닫힘)을 온보드로 제공.
-- 엔티티 SlotType 에 'rain_sensor' 가 추가됨 → CHECK 제약 갱신 + 기존 게이트웨이 백필.
-- forward-only, idempotent.

BEGIN;

-- 1) slot_type CHECK 제약에 'rain_sensor' 추가
ALTER TABLE gateway_onboard_devices
  DROP CONSTRAINT IF EXISTS gateway_onboard_devices_slot_type_check;

ALTER TABLE gateway_onboard_devices
  ADD CONSTRAINT gateway_onboard_devices_slot_type_check
  CHECK (slot_type IN (
    'opener_open', 'opener_close', 'fan',
    'irrigation_zone', 'irrigation_group', 'remote_control',
    'fertilizer_contact', 'mixer', 'fertilizer_motor',
    'vent_group', 'rain_sensor'
  ));

-- 2) BCM21 을 점유한 기존 릴레이 슬롯이 있으면 비워서 충돌 회피 (BCM21 은 우적센서 전용 예약)
UPDATE gateway_onboard_devices
SET gpio_pin = NULL, updated_at = NOW()
WHERE gpio_pin = 21 AND slot_type <> 'rain_sensor';

-- 3) rain_sensor 슬롯이 없는 기존 게이트웨이에 기본(비활성) 슬롯 삽입.
--    단, onboard 슬롯이 하나도 없는 신규 게이트웨이는 제외 —
--    ensureOnboardDevices 가 DEFAULT_SLOTS(rain_sensor 포함)로 최초 생성하기 때문.
INSERT INTO gateway_onboard_devices
  (gateway_id, slot_key, slot_type, pair_key, name, enabled, sort_order, gpio_pin)
SELECT g.id, 'rain_sensor', 'rain_sensor', NULL, '우적센서', false, 13, 21
FROM gateways g
WHERE EXISTS (
        SELECT 1 FROM gateway_onboard_devices o2 WHERE o2.gateway_id = g.id
      )
  AND NOT EXISTS (
        SELECT 1 FROM gateway_onboard_devices o
        WHERE o.gateway_id = g.id AND o.slot_type = 'rain_sensor'
      );

COMMIT;
