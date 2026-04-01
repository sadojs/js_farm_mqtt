-- Migration 002: 관수 장비 채널 매핑 컬럼 추가
-- Date: 2026-03-31

ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS channel_mapping JSONB DEFAULT NULL;

COMMENT ON COLUMN devices.channel_mapping IS
  '관수 장비 릴레이 채널 매핑 (NULL이면 기본값 사용)';
