-- Migration 007: 생육관리 기능 on/off 설정 테이블
-- scope: 'platform' = 플랫폼 전체 / user UUID = 개인 설정
CREATE TABLE IF NOT EXISTS crop_feature_settings (
  scope      VARCHAR(40) PRIMARY KEY,  -- 'platform' or user UUID string
  enabled    BOOLEAN      NOT NULL DEFAULT TRUE,
  updated_by VARCHAR(40),              -- 변경한 user ID (감사 목적)
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 기본값: 플랫폼 전체 활성화
INSERT INTO crop_feature_settings (scope, enabled)
  VALUES ('platform', TRUE)
  ON CONFLICT (scope) DO NOTHING;
