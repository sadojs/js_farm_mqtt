-- 021_unique_onboard_irrigation.sql
-- 게이트웨이당 onboard 관수 device는 1개로 강제 (race condition 방지)
-- 원인: ensureOnboardDevices 동시 호출 시 findOne()이 모두 null → 다중 INSERT
-- 보호: partial unique index로 DB 레벨 강제

CREATE UNIQUE INDEX IF NOT EXISTS uniq_onboard_irrigation_per_gateway
  ON devices (gateway_id)
  WHERE source = 'onboard' AND equipment_type = 'irrigation';
