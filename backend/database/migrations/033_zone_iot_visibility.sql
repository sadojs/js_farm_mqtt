-- Migration 033: 구역 IoT 사용 여부 플래그
-- 비-IoT 구역(노지 등)을 IoT 화면(구역관리 카드/자동제어/장치등록/대시보드/리포트/알림/게이트웨이/환경설정)에서 숨김.
-- 방재·농작업·생육관리·일꾼·구역메모에는 그대로 표시.
-- 구역관리 우측 상단 "구역 표시 설정" 모달에서 일괄 토글.

ALTER TABLE houses
  ADD COLUMN IF NOT EXISTS iot_enabled BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN houses.iot_enabled IS
  '구역 IoT 사용 여부. FALSE 시 IoT 화면에서 숨김. 방재/농작업/생육관리 등 비-IoT 화면에는 그대로 표시.';

CREATE INDEX IF NOT EXISTS idx_houses_iot_enabled
  ON houses (user_id) WHERE iot_enabled = TRUE;
