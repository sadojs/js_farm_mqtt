-- Migration 020: 라즈베리파이 이머전시 페일오버 (Hybrid Fallback)
-- rpi-emergency-failover feature (Design v1)
-- 서버 ↔ RPi 통신 단절 시 RPi가 로컬 룰로 작물 안전 동작 수행.
--
-- gateway_id: gateways.gateway_id (VARCHAR(50)) 참조.
--   MQTT 토픽이 farm/{gateway_id}/... 형태이고, API URL도 사람이 읽는 ID 사용.
--   gateways.id (UUID, PK)가 아니라 gateways.gateway_id (UNIQUE VARCHAR)로 FK.

-- ────────────────────────────────────────────────────────────
-- 0. 기존 테이블 정리 (재실행 안전)
-- ────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_seed_fallback_for_new_gateway ON gateways;
DROP FUNCTION IF EXISTS seed_fallback_for_new_gateway();
DROP TABLE IF EXISTS fallback_events CASCADE;
DROP TABLE IF EXISTS fallback_gateway_status CASCADE;
DROP TABLE IF EXISTS fallback_opener_schedule CASCADE;
DROP TABLE IF EXISTS fallback_configs CASCADE;

-- ────────────────────────────────────────────────────────────
-- 1. 게이트웨이별 폴백 설정 (1:1)
-- ────────────────────────────────────────────────────────────
CREATE TABLE fallback_configs (
  gateway_id VARCHAR(50) PRIMARY KEY REFERENCES gateways(gateway_id) ON DELETE CASCADE ON UPDATE CASCADE,
  heartbeat_timeout_seconds INTEGER NOT NULL DEFAULT 300,
  recovery_grace_seconds INTEGER NOT NULL DEFAULT 30,
  opener_enabled BOOLEAN NOT NULL DEFAULT true,
  opener_rain_override BOOLEAN NOT NULL DEFAULT true,
  irrigation_enabled BOOLEAN NOT NULL DEFAULT true,
  irrigation_max_runtime_minutes INTEGER NOT NULL DEFAULT 30,
  fertilizer_enabled BOOLEAN NOT NULL DEFAULT true,
  fan_enabled BOOLEAN NOT NULL DEFAULT false,
  fan_on_temp NUMERIC(5,2) NOT NULL DEFAULT 35.0,
  fan_off_temp NUMERIC(5,2) NOT NULL DEFAULT 28.0,
  version INTEGER NOT NULL DEFAULT 1,
  last_applied_at TIMESTAMPTZ,
  last_applied_version INTEGER,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (fan_on_temp > fan_off_temp),
  CHECK (irrigation_max_runtime_minutes > 0),
  CHECK (irrigation_max_runtime_minutes <= 240),
  CHECK (heartbeat_timeout_seconds >= 60),
  CHECK (heartbeat_timeout_seconds <= 3600),
  CHECK (recovery_grace_seconds >= 10),
  CHECK (recovery_grace_seconds <= 600)
);

-- ────────────────────────────────────────────────────────────
-- 2. 개폐기 월별 스케줄 (1:N)
-- ────────────────────────────────────────────────────────────
CREATE TABLE fallback_opener_schedule (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gateway_id VARCHAR(50) NOT NULL REFERENCES gateways(gateway_id) ON DELETE CASCADE ON UPDATE CASCADE,
  month SMALLINT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT false,
  mode VARCHAR(20) NOT NULL DEFAULT 'time',
  open_time TIME,
  close_time TIME,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (gateway_id, month),
  CHECK (month BETWEEN 1 AND 12),
  CHECK (mode IN ('time', 'always-open')),
  CHECK (
    (mode = 'always-open') OR
    (mode = 'time' AND open_time IS NOT NULL AND close_time IS NOT NULL) OR
    (enabled = false)
  )
);

CREATE INDEX idx_fallback_opener_schedule_gw
  ON fallback_opener_schedule(gateway_id);

-- ────────────────────────────────────────────────────────────
-- 3. 게이트웨이 현재 모드 캐시 (RPi mode publish 미러)
-- ────────────────────────────────────────────────────────────
CREATE TABLE fallback_gateway_status (
  gateway_id VARCHAR(50) PRIMARY KEY REFERENCES gateways(gateway_id) ON DELETE CASCADE ON UPDATE CASCADE,
  mode VARCHAR(20) NOT NULL DEFAULT 'unknown',
  mode_changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_heartbeat_seen_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (mode IN ('online', 'fallback', 'unknown'))
);

-- ────────────────────────────────────────────────────────────
-- 4. 폴백 이벤트 로그
-- ────────────────────────────────────────────────────────────
CREATE TABLE fallback_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gateway_id VARCHAR(50) NOT NULL REFERENCES gateways(gateway_id) ON DELETE CASCADE ON UPDATE CASCADE,
  event_type VARCHAR(40) NOT NULL,
  payload JSONB NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  reported_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_fallback_events_gateway
  ON fallback_events(gateway_id, occurred_at DESC);
CREATE INDEX idx_fallback_events_type
  ON fallback_events(event_type);

-- ────────────────────────────────────────────────────────────
-- 5. updated_at 자동 갱신 트리거
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fallback_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_fallback_configs_updated_at ON fallback_configs;
CREATE TRIGGER trg_fallback_configs_updated_at
  BEFORE UPDATE ON fallback_configs
  FOR EACH ROW EXECUTE FUNCTION fallback_touch_updated_at();

DROP TRIGGER IF EXISTS trg_fallback_opener_schedule_updated_at ON fallback_opener_schedule;
CREATE TRIGGER trg_fallback_opener_schedule_updated_at
  BEFORE UPDATE ON fallback_opener_schedule
  FOR EACH ROW EXECUTE FUNCTION fallback_touch_updated_at();

DROP TRIGGER IF EXISTS trg_fallback_gateway_status_updated_at ON fallback_gateway_status;
CREATE TRIGGER trg_fallback_gateway_status_updated_at
  BEFORE UPDATE ON fallback_gateway_status
  FOR EACH ROW EXECUTE FUNCTION fallback_touch_updated_at();

-- ────────────────────────────────────────────────────────────
-- 6. 기존 게이트웨이에 대한 기본 시드
-- ────────────────────────────────────────────────────────────
INSERT INTO fallback_configs (gateway_id)
  SELECT gateway_id FROM gateways
  WHERE gateway_id NOT IN (SELECT gateway_id FROM fallback_configs)
ON CONFLICT (gateway_id) DO NOTHING;

INSERT INTO fallback_gateway_status (gateway_id, mode)
  SELECT gateway_id, 'unknown' FROM gateways
  WHERE gateway_id NOT IN (SELECT gateway_id FROM fallback_gateway_status)
ON CONFLICT (gateway_id) DO NOTHING;

DO $$
DECLARE gw VARCHAR(50);
BEGIN
  FOR gw IN SELECT gateway_id FROM gateways LOOP
    INSERT INTO fallback_opener_schedule (gateway_id, month, enabled, mode, open_time, close_time) VALUES
      (gw, 1,  false, 'time', NULL, NULL),
      (gw, 2,  false, 'time', NULL, NULL),
      (gw, 3,  false, 'time', NULL, NULL),
      (gw, 4,  true,  'time', '09:00', '17:00'),
      (gw, 5,  true,  'time', '08:00', '18:00'),
      (gw, 10, true,  'time', '08:00', '18:00'),
      (gw, 11, false, 'time', '09:00', '17:00'),
      (gw, 12, false, 'time', NULL, NULL)
      ON CONFLICT DO NOTHING;
    INSERT INTO fallback_opener_schedule (gateway_id, month, enabled, mode) VALUES
      (gw, 6, true, 'always-open'),
      (gw, 7, true, 'always-open'),
      (gw, 8, true, 'always-open'),
      (gw, 9, true, 'always-open')
      ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

-- ────────────────────────────────────────────────────────────
-- 7. 신규 게이트웨이 자동 시드 트리거
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION seed_fallback_for_new_gateway()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO fallback_configs (gateway_id) VALUES (NEW.gateway_id)
    ON CONFLICT (gateway_id) DO NOTHING;
  INSERT INTO fallback_gateway_status (gateway_id, mode) VALUES (NEW.gateway_id, 'unknown')
    ON CONFLICT (gateway_id) DO NOTHING;
  INSERT INTO fallback_opener_schedule (gateway_id, month, enabled, mode, open_time, close_time) VALUES
    (NEW.gateway_id, 1,  false, 'time', NULL, NULL),
    (NEW.gateway_id, 2,  false, 'time', NULL, NULL),
    (NEW.gateway_id, 3,  false, 'time', NULL, NULL),
    (NEW.gateway_id, 4,  true,  'time', '09:00', '17:00'),
    (NEW.gateway_id, 5,  true,  'time', '08:00', '18:00'),
    (NEW.gateway_id, 10, true,  'time', '08:00', '18:00'),
    (NEW.gateway_id, 11, false, 'time', '09:00', '17:00'),
    (NEW.gateway_id, 12, false, 'time', NULL, NULL)
    ON CONFLICT DO NOTHING;
  INSERT INTO fallback_opener_schedule (gateway_id, month, enabled, mode) VALUES
    (NEW.gateway_id, 6, true, 'always-open'),
    (NEW.gateway_id, 7, true, 'always-open'),
    (NEW.gateway_id, 8, true, 'always-open'),
    (NEW.gateway_id, 9, true, 'always-open')
    ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_seed_fallback_for_new_gateway
  AFTER INSERT ON gateways
  FOR EACH ROW EXECUTE FUNCTION seed_fallback_for_new_gateway();
