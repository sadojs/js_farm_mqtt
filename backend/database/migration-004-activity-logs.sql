-- 004: 활동 로그 테이블
CREATE TABLE IF NOT EXISTS activity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  user_name VARCHAR(100) NOT NULL,
  group_id UUID REFERENCES house_groups(id) ON DELETE SET NULL,
  group_name VARCHAR(100),
  action VARCHAR(50) NOT NULL,
  target_type VARCHAR(30) NOT NULL,
  target_id VARCHAR(100),
  target_name VARCHAR(200),
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_logs_user ON activity_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_group ON activity_logs(group_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_action ON activity_logs(action, created_at DESC);
