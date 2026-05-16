-- Migration 013: Enforce one-gateway-per-house constraint
-- A gateway can only be assigned to one house at a time.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'gateways_house_id_unique'
  ) THEN
    ALTER TABLE gateways ADD CONSTRAINT gateways_house_id_unique UNIQUE (house_id);
  END IF;
END
$$;
