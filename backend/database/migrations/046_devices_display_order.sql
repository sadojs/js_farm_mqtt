-- 046: devices.display_order — 구역관리 카드 순서(드래그 정렬)
-- 각 장치에 '같은 구역(house_id) + 같은 섹션(측정기 vs 장치)' 내 정렬 순서를 저장.
-- forward-only, idempotent.

ALTER TABLE devices ADD COLUMN IF NOT EXISTS display_order INTEGER NOT NULL DEFAULT 0;

-- 기존 장치 백필: house_id + 섹션(sensor / device)별로 생성순서대로 0,1,2…
-- 가드: 아직 아무 장치도 순서를 갖지 않은 최초 1회만 실행(사용자 정렬 덮어쓰기 방지).
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY house_id, (CASE WHEN device_type = 'sensor' THEN 'sensor' ELSE 'device' END)
           ORDER BY created_at, id
         ) - 1 AS rn
  FROM devices
)
UPDATE devices d
SET display_order = r.rn
FROM ranked r
WHERE d.id = r.id
  AND NOT EXISTS (SELECT 1 FROM devices x WHERE x.display_order <> 0);
