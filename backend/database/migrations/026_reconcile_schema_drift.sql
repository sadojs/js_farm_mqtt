-- Migration 026: 스키마 드리프트 정정 (엔티티 ↔ 프로덕션 DB 불일치 보충)
-- 642be46 릴리스에서 엔티티에 추가됐으나 마이그레이션이 누락된 컬럼/테이블 보충.
-- 증상: GET /api/gateways·/api/users 500 (column tunnel_port/enabled 없음),
--       RetentionService notifications 정리 실패 (relation notifications 없음).
-- 모두 IF NOT EXISTS — 재실행 안전.

-- 1. gateways: RPi 역터널 관련 컬럼 (gateway.entity.ts)
ALTER TABLE gateways
  ADD COLUMN IF NOT EXISTS tunnel_port       INTEGER,
  ADD COLUMN IF NOT EXISTS tunnel_status     VARCHAR(20) NOT NULL DEFAULT 'disconnected',
  ADD COLUMN IF NOT EXISTS tunnel_public_key TEXT,
  ADD COLUMN IF NOT EXISTS tunnel_last_seen  TIMESTAMPTZ;

-- 2. devices: 활성화 플래그 (device.entity.ts — default true)
ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT true;

-- 3. notifications 테이블 (schema.sql 정의 — RetentionService 보존 정리 대상)
CREATE TABLE IF NOT EXISTS notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       VARCHAR(50) NOT NULL,
  title      VARCHAR(255) NOT NULL,
  message    TEXT NOT NULL,
  read       BOOLEAN DEFAULT false,
  metadata   JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id    ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at);
