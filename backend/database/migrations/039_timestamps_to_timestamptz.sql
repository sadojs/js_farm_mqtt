-- Migration 039: naive timestamp(_at) 컬럼을 timestamptz(UTC-aware)로 변환
-- 배경: 컬럼이 'timestamp without time zone'(naive)이라, Node 프로세스 TZ가 KST(+0900)일 때
--       node-pg가 UTC 저장값을 KST로 오파싱 → API가 9시간 이른 시각을 반환(동작이력 등).
-- 저장값은 UTC 이므로 AT TIME ZONE 'UTC' 로 해석해 timestamptz로 변환(순간값 보존).
-- 이후 node-pg가 절대 순간으로 읽어 프로세스 TZ와 무관하게 정확 → 프론트에서 KST로 정상 표시.
-- forward-only, idempotent (이미 timestamptz면 no-op).

ALTER TABLE activity_logs    ALTER COLUMN created_at  TYPE timestamptz USING created_at  AT TIME ZONE 'UTC';
ALTER TABLE automation_logs  ALTER COLUMN executed_at TYPE timestamptz USING executed_at AT TIME ZONE 'UTC';
ALTER TABLE automation_rules ALTER COLUMN created_at  TYPE timestamptz USING created_at  AT TIME ZONE 'UTC';
ALTER TABLE automation_rules ALTER COLUMN updated_at  TYPE timestamptz USING updated_at  AT TIME ZONE 'UTC';
ALTER TABLE devices          ALTER COLUMN created_at  TYPE timestamptz USING created_at  AT TIME ZONE 'UTC';
ALTER TABLE devices          ALTER COLUMN updated_at  TYPE timestamptz USING updated_at  AT TIME ZONE 'UTC';
ALTER TABLE env_mappings     ALTER COLUMN created_at  TYPE timestamptz USING created_at  AT TIME ZONE 'UTC';
ALTER TABLE env_mappings     ALTER COLUMN updated_at  TYPE timestamptz USING updated_at  AT TIME ZONE 'UTC';
ALTER TABLE env_roles        ALTER COLUMN created_at  TYPE timestamptz USING created_at  AT TIME ZONE 'UTC';
ALTER TABLE gateways         ALTER COLUMN created_at  TYPE timestamptz USING created_at  AT TIME ZONE 'UTC';
ALTER TABLE gateways         ALTER COLUMN updated_at  TYPE timestamptz USING updated_at  AT TIME ZONE 'UTC';
ALTER TABLE house_groups     ALTER COLUMN created_at  TYPE timestamptz USING created_at  AT TIME ZONE 'UTC';
ALTER TABLE house_groups     ALTER COLUMN updated_at  TYPE timestamptz USING updated_at  AT TIME ZONE 'UTC';
ALTER TABLE houses           ALTER COLUMN created_at  TYPE timestamptz USING created_at  AT TIME ZONE 'UTC';
ALTER TABLE houses           ALTER COLUMN updated_at  TYPE timestamptz USING updated_at  AT TIME ZONE 'UTC';
ALTER TABLE sensor_alerts    ALTER COLUMN created_at  TYPE timestamptz USING created_at  AT TIME ZONE 'UTC';
ALTER TABLE sensor_standby   ALTER COLUMN created_at  TYPE timestamptz USING created_at  AT TIME ZONE 'UTC';
ALTER TABLE users            ALTER COLUMN created_at  TYPE timestamptz USING created_at  AT TIME ZONE 'UTC';
ALTER TABLE users            ALTER COLUMN updated_at  TYPE timestamptz USING updated_at  AT TIME ZONE 'UTC';
