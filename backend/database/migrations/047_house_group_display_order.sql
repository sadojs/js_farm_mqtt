-- 047: house_groups.display_order — 구역 표시 순서(구역표시 설정에서 드래그 정렬)
ALTER TABLE house_groups ADD COLUMN IF NOT EXISTS display_order INTEGER NOT NULL DEFAULT 0;

WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at) - 1 AS rn
  FROM house_groups
)
UPDATE house_groups g SET display_order = r.rn FROM ranked r
WHERE g.id = r.id
  AND NOT EXISTS (SELECT 1 FROM house_groups x WHERE x.display_order <> 0);
