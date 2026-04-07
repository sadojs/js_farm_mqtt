-- 005_voice_aliases.sql
-- 음성 어시스턴트 별칭 학습 (사용자별 발음 오류 자동 매핑)

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS voice_aliases JSONB DEFAULT '{}';
