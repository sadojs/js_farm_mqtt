-- 057: sensor_data 정리 (서비스 검토 S3)
--  1) 기본키 (time) → (time, device_id, sensor_type): 같은 ms 에 들어온 다른 센서 값이 충돌로 버려지지 않게
--  2) 조회 인덱스 (device_id, sensor_type, time DESC): '장치별 최신값' 조회가 전체 스캔하지 않게
--  3) TimescaleDB 가 있으면 하이퍼테이블(7일 청크)로 전환 + 보존 정책 2년
-- 모두 재실행해도 안전(idempotent).

DO $$
DECLARE
  pk_cols text[];
  pk_name text;
BEGIN
  SELECT array_agg(a.attname::text ORDER BY a.attname), max(c.conname)
    INTO pk_cols, pk_name
  FROM pg_constraint c
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
  WHERE c.conrelid = 'public.sensor_data'::regclass AND c.contype = 'p';

  IF pk_cols IS DISTINCT FROM ARRAY['device_id', 'sensor_type', 'time'] THEN
    IF pk_name IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.sensor_data DROP CONSTRAINT %I', pk_name);
    END IF;
    ALTER TABLE public.sensor_data ADD PRIMARY KEY (time, device_id, sensor_type);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_sensor_data_device_type_time
  ON public.sensor_data (device_id, sensor_type, time DESC);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
    IF NOT EXISTS (SELECT 1 FROM timescaledb_information.hypertables
                   WHERE hypertable_schema = 'public' AND hypertable_name = 'sensor_data') THEN
      PERFORM create_hypertable('public.sensor_data', 'time',
        chunk_time_interval => INTERVAL '7 days', migrate_data => true, if_not_exists => true);
    END IF;
    PERFORM add_retention_policy('public.sensor_data', INTERVAL '730 days', if_not_exists => true);
  END IF;
END $$;
