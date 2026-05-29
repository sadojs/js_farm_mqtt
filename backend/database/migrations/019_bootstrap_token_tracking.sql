-- Migration 019: Bootstrap token 1회 사용 후 무효화 (MAJOR-02 fix)
-- rpi-golden-image-system Gap Analysis MAJOR-02
--
-- 정책:
--   - 게이트웨이당 1회 등록 후 시각 기록
--   - 동일 machine_id의 재등록(재이미지)은 항상 허용
--   - 다른 machine_id가 같은 gatewayId/hostname 차지하려 시도 → 거부

ALTER TABLE gateways
  ADD COLUMN IF NOT EXISTS bootstrap_token_used_at TIMESTAMPTZ;
