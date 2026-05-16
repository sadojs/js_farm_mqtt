-- 014: onboard fan/opener timer settings + zigbee device settings
ALTER TABLE gateway_onboard_devices
  ADD COLUMN IF NOT EXISTS operation_time INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS standby_time INTEGER DEFAULT NULL;

ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS device_settings JSONB DEFAULT NULL;
