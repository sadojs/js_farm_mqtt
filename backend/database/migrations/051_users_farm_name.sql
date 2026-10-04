-- 051: 농장 이름 분리
-- 지금까지 농장 = 농장 관리자 계정이라 계정의 name(사람 이름)을 농장 이름으로 써 왔다.
-- 농장 관리자 계정에 farm_name 을 따로 두고, 기존 농장은 현재 name 으로 채운다(화면 표시는 그대로).
-- 농장 사용자(farm_user)·플랫폼 관리자는 NULL — 소속 농장 이름은 부모 계정의 farm_name 을 쓴다.
-- idempotent — 재적용 안전
ALTER TABLE users ADD COLUMN IF NOT EXISTS farm_name VARCHAR(100);

UPDATE users
   SET farm_name = name
 WHERE role = 'farm_admin'
   AND (farm_name IS NULL OR farm_name = '');
