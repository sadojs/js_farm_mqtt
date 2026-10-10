-- 053: 게이트웨이가 구역(house_groups)을 직접 가리킴 — '하우스(houses)' 중간 단계 제거 1단계
--
-- 배경: houses 는 화면에 없는 숨은 단계로, 게이트웨이를 구역에 연결할 때 구역 이름으로 1개씩 자동 생성되어
--       사실상 구역과 1:1 이었다. 장치→구역 판단이 '장치.house_id' 와 '게이트웨이.house_id' 두 경로로 섞여
--       연결 변경 시 어긋날 수 있었다.
-- 이후: 구역 판단은 '게이트웨이.group_id' 하나로 한다(장치의 구역 = 붙어 있는 게이트웨이의 구역).
--       한 구역에는 게이트웨이 1대까지(부분 유니크 인덱스).
-- houses / house_id 컬럼은 이번엔 그대로 둔다(되돌리기 대비, 2단계에서 삭제). idempotent.

ALTER TABLE gateways ADD COLUMN IF NOT EXISTS group_id uuid REFERENCES house_groups(id) ON DELETE SET NULL;

-- 기존 연결 이관: gateways.house_id → houses.group_id
UPDATE gateways g
   SET group_id = h.group_id
  FROM houses h
 WHERE h.id::text = g.house_id::text
   AND h.group_id IS NOT NULL
   AND g.group_id IS NULL;

-- 같은 구역에 게이트웨이가 2대 이상 이관되었으면(운영엔 하우스당 1대 제약이 있어 없을 것) 가장 먼저 등록된 1대만 유지
UPDATE gateways g
   SET group_id = NULL
 WHERE g.group_id IS NOT NULL
   AND EXISTS (
     SELECT 1 FROM gateways o
      WHERE o.group_id = g.group_id
        AND (o.created_at, o.id::text) < (g.created_at, g.id::text)
   );

CREATE UNIQUE INDEX IF NOT EXISTS gateways_group_id_unique ON gateways(group_id) WHERE group_id IS NOT NULL;
