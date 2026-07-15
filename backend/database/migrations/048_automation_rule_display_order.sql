-- 048: automation_rules.display_order — 자동제어룰 표시 순서(드래그 정렬)
-- 초기값은 기존 표시순(priority DESC, created_at DESC)을 그대로 보존.
ALTER TABLE automation_rules ADD COLUMN IF NOT EXISTS display_order INTEGER NOT NULL DEFAULT 0;

WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY priority DESC, created_at DESC) - 1 AS rn
  FROM automation_rules
)
UPDATE automation_rules a SET display_order = r.rn FROM ranked r
WHERE a.id = r.id
  AND NOT EXISTS (SELECT 1 FROM automation_rules x WHERE x.display_order <> 0);
