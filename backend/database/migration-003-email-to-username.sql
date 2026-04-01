-- ==========================================
-- Migration 003: email → username 컬럼 변경
-- ==========================================
-- 주의: JWT payload 변경으로 기존 토큰 무효화 → 전체 사용자 재로그인 필요

-- 1) 기존 이메일에서 @ 앞부분 추출 + 소문자 변환
--    중복 발생 시 _2, _3 등 접미사 추가
DO $$
DECLARE
  r RECORD;
  new_username VARCHAR(50);
  base_username VARCHAR(50);
  suffix INT;
BEGIN
  FOR r IN SELECT id, email FROM users ORDER BY created_at ASC
  LOOP
    base_username := LOWER(SPLIT_PART(r.email, '@', 1));
    -- username 규칙 적용: 영문 소문자로 시작, [a-z0-9_-], 최소 3자
    -- 만약 base_username이 규칙에 안 맞으면 'user_' 접두어 추가
    IF base_username !~ '^[a-z][a-z0-9_-]{1,}$' THEN
      base_username := 'user_' || base_username;
    END IF;
    -- 50자 제한
    base_username := LEFT(base_username, 47);

    new_username := base_username;
    suffix := 2;

    -- 중복 체크
    WHILE EXISTS (SELECT 1 FROM users WHERE email = new_username AND id != r.id) LOOP
      new_username := base_username || '_' || suffix;
      suffix := suffix + 1;
    END LOOP;

    UPDATE users SET email = new_username WHERE id = r.id;
  END LOOP;
END $$;

-- 2) 컬럼 이름 변경
ALTER TABLE users RENAME COLUMN email TO username;

-- 3) VARCHAR 길이 조정
ALTER TABLE users ALTER COLUMN username TYPE VARCHAR(50);

-- 4) 인덱스 재생성
DROP INDEX IF EXISTS idx_users_email;
CREATE INDEX idx_users_username ON users(username);

-- 5) 기존 refresh_tokens 삭제 (JWT payload 변경으로 무효화)
DELETE FROM refresh_tokens;
