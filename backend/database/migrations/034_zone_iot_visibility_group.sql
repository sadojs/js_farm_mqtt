-- Migration 034: 구역(HouseGroup) 단위 IoT 사용 여부 플래그
-- 033 에서는 houses.iot_enabled 만 추가했으나, 사용자가 화면에서 인식하는 "구역" 단위는 HouseGroup.
-- (한 group 안에 house 가 0~N 개 — 비어있을 수도 있음)
-- → group 자체에도 iot_enabled 를 두고, 모달 토글의 단위를 group 으로 통일.

ALTER TABLE house_groups
  ADD COLUMN IF NOT EXISTS iot_enabled BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN house_groups.iot_enabled IS
  '구역(그룹) IoT 사용 여부. FALSE 시 IoT 화면(대시보드/자동제어/장치등록/리포트/알림/게이트웨이)에서 숨김. 방재/농작업/생육관리에는 그대로 표시.';

CREATE INDEX IF NOT EXISTS idx_house_groups_iot_enabled
  ON house_groups (user_id) WHERE iot_enabled = TRUE;
