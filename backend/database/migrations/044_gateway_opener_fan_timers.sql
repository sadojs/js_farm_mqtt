-- Migration 042: 게이트웨이(Pi)별 개폐기/유동팬 동작·대기 타이머
-- 배경: 기존엔 개폐기/팬 동작·대기 시간이 장치별(gateway_onboard_devices.operation_time,
--       zigbee deviceSettings.operation_time)로 흩어져 있어 일관성이 없고, 한 구역 개폐기
--       열기/닫기가 서로 다른 시간이면 충돌 위험. → 게이트웨이당 1벌로 통합.
-- fallback_configs 는 이미 게이트웨이별 + Pi(fallback-engine)로 동기화되므로 여기에 추가.
-- forward-only, idempotent.

ALTER TABLE fallback_configs
  ADD COLUMN IF NOT EXISTS opener_operation_seconds INT NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS opener_standby_seconds   INT NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS fan_operation_minutes    INT NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS fan_standby_minutes      INT NOT NULL DEFAULT 10;
