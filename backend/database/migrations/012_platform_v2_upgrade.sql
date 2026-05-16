-- ==========================================
-- Migration 012: platform-v2-upgrade
-- gateway_onboard_devices 신규 테이블
-- gateways.house_id 추가
-- devices.source / onboard_device_id 추가
-- ==========================================

-- 1. gateways에 house_id 추가
ALTER TABLE gateways
  ADD COLUMN IF NOT EXISTS house_id UUID REFERENCES houses(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_gateways_house_id ON gateways(house_id);

-- 2. gateway_onboard_devices 신규 테이블
CREATE TABLE IF NOT EXISTS gateway_onboard_devices (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gateway_id       UUID NOT NULL REFERENCES gateways(id) ON DELETE CASCADE,
  slot_key         VARCHAR(50) NOT NULL,
  slot_type        VARCHAR(50) NOT NULL
    CHECK (slot_type IN (
      'opener_open', 'opener_close', 'fan',
      'irrigation_zone', 'remote_control',
      'fertilizer_contact', 'mixer', 'fertilizer_motor'
    )),
  pair_key         VARCHAR(50),
  name             VARCHAR(100) NOT NULL,
  enabled          BOOLEAN NOT NULL DEFAULT true,
  sort_order       INT NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(gateway_id, slot_key)
);

CREATE INDEX IF NOT EXISTS idx_onboard_gateway    ON gateway_onboard_devices(gateway_id);
CREATE INDEX IF NOT EXISTS idx_onboard_enabled    ON gateway_onboard_devices(gateway_id, enabled);
CREATE INDEX IF NOT EXISTS idx_onboard_slot_type  ON gateway_onboard_devices(gateway_id, slot_type);

CREATE TRIGGER update_onboard_devices_updated_at
  BEFORE UPDATE ON gateway_onboard_devices
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 3. devices 테이블 확장
ALTER TABLE devices
  ALTER COLUMN zigbee_ieee DROP NOT NULL;

ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'zigbee'
    CHECK (source IN ('zigbee', 'onboard'));

ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS onboard_device_id UUID
    REFERENCES gateway_onboard_devices(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_devices_source   ON devices(source);
CREATE INDEX IF NOT EXISTS idx_devices_onboard  ON devices(onboard_device_id);

-- 4. 기존 devices 레코드 마이그레이션
UPDATE devices SET source = 'zigbee' WHERE source IS NULL OR source = '';
