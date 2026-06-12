-- Migration 027: 임시 비밀번호 첫 로그인 시 비밀번호 변경 강제
-- 일꾼 계정 등 관리자가 임시 비밀번호로 발급한 계정은 must_change_password=true.
-- 본인이 비밀번호를 변경하면 false 로 해제.

ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
