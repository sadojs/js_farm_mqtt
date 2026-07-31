-- 050: 네이티브 푸시(iOS APNs / Android FCM) 디바이스 토큰 저장
-- idempotent — 재적용 안전
CREATE TABLE IF NOT EXISTS device_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      text NOT NULL,
  platform   varchar(16) NOT NULL DEFAULT 'unknown',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_device_tokens_token ON device_tokens (token);
CREATE INDEX IF NOT EXISTS ix_device_tokens_user ON device_tokens (user_id);
