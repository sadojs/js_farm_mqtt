-- Migration 023: 이머전시 페일오버 환기팬/유동팬 — 온도/습도 선택 지원
-- 기존 fan_on_temp / fan_off_temp 컬럼을 그대로 활용하되 fan_trigger_type 으로
-- 값의 단위(°C / %) 를 구분한다. 의미적으로 "fan_on_value/fan_off_value" 로
-- 읽지만 컬럼 rename 은 의존성이 많아 보류.

ALTER TABLE fallback_configs
  ADD COLUMN IF NOT EXISTS fan_trigger_type VARCHAR(20) NOT NULL DEFAULT 'temperature';

-- CHECK 제약: temperature | humidity 만 허용
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fallback_configs_fan_trigger_type_check'
  ) THEN
    ALTER TABLE fallback_configs
      ADD CONSTRAINT fallback_configs_fan_trigger_type_check
      CHECK (fan_trigger_type IN ('temperature', 'humidity'));
  END IF;
END
$$;

-- 기존 fan_on_temp/fan_off_temp 범위 CHECK 없으므로 추가 작업 없음.
-- (ON > OFF 는 그대로 유지 — 둘 다 켜질수록 큰 값을 의미해야 함)

COMMENT ON COLUMN fallback_configs.fan_trigger_type IS '환기팬 트리거 측정값 종류: temperature | humidity (RPi rule-evaluator/fan.js 에서 분기)';
COMMENT ON COLUMN fallback_configs.fan_on_temp IS '환기팬 ON 임계값 (단위는 fan_trigger_type 에 따라 °C 또는 %)';
COMMENT ON COLUMN fallback_configs.fan_off_temp IS '환기팬 OFF 임계값 (단위는 fan_trigger_type 에 따라 °C 또는 %)';
