-- ==========================================
-- Migration 001: Tuya Cloud → MQTT/Zigbee 전환
-- ==========================================
-- 실행: psql -h localhost -U smartfarm -d smartfarm_mqtt -f migration-001-mqtt.sql

BEGIN;

-- ==========================================
-- 1. gateways 테이블 생성 (라즈베리파이 Zigbee Gateway)
-- ==========================================

CREATE TABLE IF NOT EXISTS gateways (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gateway_id VARCHAR(50) NOT NULL UNIQUE,       -- MQTT topic prefix: farm/{이값}/z2m
  name VARCHAR(100) NOT NULL,                   -- "석문리 하우스", "화성 농장"
  location VARCHAR(200),                        -- 주소 또는 위치 설명
  rpi_ip VARCHAR(45),                           -- 라즈베리파이 IP (관리용)
  status VARCHAR(20) DEFAULT 'offline',         -- online/offline (bridge/state 기반)
  last_seen TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gateways_user ON gateways(user_id);
CREATE INDEX IF NOT EXISTS idx_gateways_gateway ON gateways(gateway_id);

-- ==========================================
-- 2. devices 테이블 변경
-- ==========================================

-- 2-1. tuya_device_id → zigbee_ieee 리네임
ALTER TABLE devices RENAME COLUMN tuya_device_id TO zigbee_ieee;

-- 2-2. gateway_id 컬럼 추가
ALTER TABLE devices ADD COLUMN IF NOT EXISTS gateway_id UUID REFERENCES gateways(id) ON DELETE SET NULL;

-- 2-3. friendly_name 컬럼 추가 (Zigbee2MQTT 표시명)
ALTER TABLE devices ADD COLUMN IF NOT EXISTS friendly_name VARCHAR(100);

-- 2-4. zigbee_model 컬럼 추가 (장비 모델명)
ALTER TABLE devices ADD COLUMN IF NOT EXISTS zigbee_model VARCHAR(100);

-- 2-5. paired_device_id 컬럼 (없으면 추가)
ALTER TABLE devices ADD COLUMN IF NOT EXISTS paired_device_id UUID;

-- 2-6. opener_group_name 컬럼 (없으면 추가)
ALTER TABLE devices ADD COLUMN IF NOT EXISTS opener_group_name VARCHAR(200);

-- 2-7. 인덱스 업데이트
DROP INDEX IF EXISTS idx_devices_tuya_device_id;
CREATE INDEX IF NOT EXISTS idx_devices_zigbee_ieee ON devices(zigbee_ieee);
CREATE INDEX IF NOT EXISTS idx_devices_gateway ON devices(gateway_id);
CREATE INDEX IF NOT EXISTS idx_devices_friendly_name ON devices(friendly_name);

-- 2-8. UNIQUE 제약 변경 (user_id + tuya_device_id → user_id + zigbee_ieee)
ALTER TABLE devices DROP CONSTRAINT IF EXISTS devices_user_id_tuya_device_id_key;
-- 새 UNIQUE 제약은 gateway 기반으로 (같은 IEEE 주소가 다른 게이트웨이에 있을 수 있음)
-- 실제로는 IEEE 주소가 전역 고유이므로 user_id + zigbee_ieee로 유지
ALTER TABLE devices ADD CONSTRAINT devices_user_id_zigbee_ieee_key UNIQUE (user_id, zigbee_ieee);

-- ==========================================
-- 3. tuya_projects 테이블 삭제
-- ==========================================

DROP TABLE IF EXISTS tuya_projects;

COMMIT;
