-- 022_device_parent_channel.sql
-- Zigbee 8/12채널 컨트롤러를 다중 유동팬/페어 개폐기로 활용
-- 1 컨트롤러 = 1 parent (자동제어 타겟 아님) + N children (자동제어 타겟)

-- 1. devices 테이블에 신규 컬럼 추가
ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS parent_device_id uuid REFERENCES devices(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS channel_code varchar(32);

-- 2. parent 빠른 조회용 인덱스
CREATE INDEX IF NOT EXISTS idx_devices_parent_device_id ON devices(parent_device_id);

-- 3. IEEE unique 제약 변경 — child는 parent와 IEEE 공유, root에만 unique
-- 기존 인덱스 가능한 이름들 처리
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'devices_zigbee_ieee_key') THEN
    EXECUTE 'DROP INDEX devices_zigbee_ieee_key';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_devices_zigbee_ieee') THEN
    EXECUTE 'DROP INDEX idx_devices_zigbee_ieee';
  END IF;
  -- unique 제약(constraint)이 있으면 제거
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'devices'::regclass AND conname = 'devices_zigbee_ieee_key'
  ) THEN
    EXECUTE 'ALTER TABLE devices DROP CONSTRAINT devices_zigbee_ieee_key';
  END IF;
END $$;

-- root device(parent_device_id IS NULL)에서만 (gateway_id, IEEE) unique
-- (같은 zigbee device가 게이트웨이 이전 시 옛 row가 남아있는 경우 호환)
CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_zigbee_ieee_root_per_gateway
  ON devices(gateway_id, zigbee_ieee)
  WHERE parent_device_id IS NULL AND zigbee_ieee IS NOT NULL;

-- 4. 코멘트 (문서화)
COMMENT ON COLUMN devices.parent_device_id IS 'Zigbee 다채널 컨트롤러의 child일 때 parent device.id (자동제어 타겟은 child)';
COMMENT ON COLUMN devices.channel_code IS 'child의 z2m payload 키 (switch_1~switch_12). TS0601은 자동으로 state_lN으로 변환됨';
