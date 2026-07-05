-- Migration 040: 이머전시 개폐기 온습도 조건 제어(primary) + 온습도계 이상 타임아웃
-- 배경: 개폐기를 유동팬과 동일하게 온도/습도 히스테리시스로 제어하고,
--       온습도계가 동작하지 않으면 기존 월별 시간 스케줄(백업)로 자동 전환한다.
-- forward-only, idempotent. fallback_opener_schedule(12행) 테이블은 백업 역할로 그대로 유지.

ALTER TABLE fallback_configs
  ADD COLUMN IF NOT EXISTS opener_trigger_type    VARCHAR(20)  NOT NULL DEFAULT 'temperature',
  ADD COLUMN IF NOT EXISTS opener_on_value        NUMERIC(5,2) NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS opener_off_value       NUMERIC(5,2) NOT NULL DEFAULT 25,
  ADD COLUMN IF NOT EXISTS sensor_timeout_seconds INT          NOT NULL DEFAULT 600;

-- 트리거 종류 제약 (유동팬과 동일)
ALTER TABLE fallback_configs
  DROP CONSTRAINT IF EXISTS fallback_configs_opener_trigger_type_check;
ALTER TABLE fallback_configs
  ADD CONSTRAINT fallback_configs_opener_trigger_type_check
  CHECK (opener_trigger_type IN ('temperature', 'humidity'));
