-- ==========================================
-- 스마트 농업 플랫폼 - 로컬 개발 스키마 (TimescaleDB 없이)
-- ==========================================

-- 기존 테이블 삭제 (순서 중요)
DROP TABLE IF EXISTS automation_logs CASCADE;
DROP TABLE IF EXISTS automation_rules CASCADE;
DROP TABLE IF EXISTS sensor_data CASCADE;
DROP TABLE IF EXISTS devices CASCADE;
DROP TABLE IF EXISTS houses CASCADE;
DROP TABLE IF EXISTS house_groups CASCADE;
DROP TABLE IF EXISTS tuya_projects CASCADE;
DROP TABLE IF EXISTS user_settings CASCADE;
DROP TABLE IF EXISTS notifications CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- ==========================================
-- 1. 사용자 관리
-- ==========================================
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(100) NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'farm_admin', 'farm_user')),
  parent_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  address TEXT,
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_parent ON users(parent_user_id);

-- ==========================================
-- 2. Tuya 프로젝트 설정
-- ==========================================
CREATE TABLE tuya_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  access_id VARCHAR(255) NOT NULL,
  access_secret_encrypted TEXT NOT NULL,
  endpoint VARCHAR(255) NOT NULL,
  project_id VARCHAR(255),
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id)
);

-- ==========================================
-- 3. 하우스 그룹
-- ==========================================
CREATE TABLE house_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  manager VARCHAR(100),
  enable_group_control BOOLEAN DEFAULT true,
  enable_automation BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==========================================
-- 4. 하우스
-- ==========================================
CREATE TABLE houses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id UUID REFERENCES house_groups(id) ON DELETE SET NULL,
  name VARCHAR(255) NOT NULL,
  location VARCHAR(255),
  description TEXT,
  area DECIMAL(10, 2),
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==========================================
-- 5. 장비
-- ==========================================
CREATE TABLE devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  house_id UUID REFERENCES houses(id) ON DELETE SET NULL,
  tuya_device_id VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  category VARCHAR(100) NOT NULL,
  device_type VARCHAR(50) NOT NULL,
  icon VARCHAR(50),
  online BOOLEAN DEFAULT false,
  last_seen TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, tuya_device_id)
);

-- ==========================================
-- 6. 센서 데이터 (일반 테이블, TimescaleDB 없이)
-- ==========================================
CREATE TABLE sensor_data (
  time TIMESTAMP WITH TIME ZONE NOT NULL,
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sensor_type VARCHAR(50) NOT NULL,
  value DECIMAL(10, 4) NOT NULL,
  unit VARCHAR(20) NOT NULL,
  status VARCHAR(20) DEFAULT 'normal' CHECK (status IN ('normal', 'warning', 'critical')),
  metadata JSONB
);

CREATE INDEX idx_sensor_data_device_time ON sensor_data(device_id, time DESC);
CREATE INDEX idx_sensor_data_user_time ON sensor_data(user_id, time DESC);

-- ==========================================
-- 7. 자동화 룰
-- ==========================================
CREATE TABLE automation_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id UUID REFERENCES house_groups(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  rule_type VARCHAR(50) NOT NULL,
  enabled BOOLEAN DEFAULT true,
  conditions JSONB NOT NULL,
  actions JSONB NOT NULL,
  priority INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==========================================
-- 8. 자동화 로그
-- ==========================================
CREATE TABLE automation_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID NOT NULL REFERENCES automation_rules(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  executed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  success BOOLEAN NOT NULL,
  conditions_met JSONB,
  actions_executed JSONB,
  error_message TEXT
);

-- ==========================================
-- 9. 알림
-- ==========================================
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  read BOOLEAN DEFAULT false,
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==========================================
-- 10. 사용자 설정
-- ==========================================
CREATE TABLE user_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  visible_sensor_types JSONB DEFAULT '["temperature", "humidity", "co2", "light", "soil_moisture"]'::jsonb,
  notification_preferences JSONB DEFAULT '{}'::jsonb,
  dashboard_layout JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id)
);

-- ==========================================
-- 트리거: updated_at 자동 업데이트
-- ==========================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_tuya_projects_updated_at BEFORE UPDATE ON tuya_projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_house_groups_updated_at BEFORE UPDATE ON house_groups
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_houses_updated_at BEFORE UPDATE ON houses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_devices_updated_at BEFORE UPDATE ON devices
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_automation_rules_updated_at BEFORE UPDATE ON automation_rules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ==========================================
-- 시드 데이터
-- ==========================================

-- 관리자 계정 (비밀번호: admin123)
INSERT INTO users (email, password_hash, name, role, address)
VALUES ('admin@farm.com', '$2b$10$/3rGbaPbLwtp3WP26/rlre8O6VrocpfV8o8H.werJ0RICbknDHaV2', '관리자', 'admin', '서울시 강남구');

-- 테스트 농장 관리자 (비밀번호: user123)
INSERT INTO users (email, password_hash, name, role, address)
VALUES ('user@farm.com', '$2b$10$nzFSy4nFDGm2oP5afBzpO.r37PyM7/.7td2RrXdHfep7IzTJU3XLu', '김농부', 'farm_admin', '경기도 화성시 농업로 123');

-- 사용자에게 Tuya 프로젝트 할당
INSERT INTO tuya_projects (user_id, name, access_id, access_secret_encrypted, endpoint, project_id, enabled)
SELECT id, '1농장 프로젝트', 'demo_access_id', 'demo_encrypted_secret', 'https://openapi.tuyaus.com', 'p1234567890', true
FROM users WHERE email = 'user@farm.com';

-- 샘플 그룹
INSERT INTO house_groups (user_id, name, description, manager, enable_group_control, enable_automation)
SELECT id, '화성 1농장', '경기도 화성시 딸기 재배 농장', '김농부', true, true
FROM users WHERE email = 'user@farm.com';

-- 샘플 하우스
INSERT INTO houses (user_id, group_id, name, location, description, area, status)
SELECT u.id, g.id, '1동 하우스', '화성시 농업로 123-1', '딸기 재배 하우스 1동', 330.00, 'active'
FROM users u, house_groups g WHERE u.email = 'user@farm.com' AND g.name = '화성 1농장';

INSERT INTO houses (user_id, group_id, name, location, description, area, status)
SELECT u.id, g.id, '2동 하우스', '화성시 농업로 123-2', '딸기 재배 하우스 2동', 280.00, 'active'
FROM users u, house_groups g WHERE u.email = 'user@farm.com' AND g.name = '화성 1농장';

-- 샘플 장비
INSERT INTO devices (user_id, house_id, tuya_device_id, name, category, device_type, online)
SELECT u.id, h.id, 'tuya_temp_001', '온도 센서 1', '온도 센서', 'sensor', true
FROM users u, houses h WHERE u.email = 'user@farm.com' AND h.name = '1동 하우스';

INSERT INTO devices (user_id, house_id, tuya_device_id, name, category, device_type, online)
SELECT u.id, h.id, 'tuya_humid_001', '습도 센서 1', '습도 센서', 'sensor', true
FROM users u, houses h WHERE u.email = 'user@farm.com' AND h.name = '1동 하우스';

INSERT INTO devices (user_id, house_id, tuya_device_id, name, category, device_type, online)
SELECT u.id, h.id, 'tuya_fan_001', '환풍기 1', '환풍기', 'actuator', true
FROM users u, houses h WHERE u.email = 'user@farm.com' AND h.name = '1동 하우스';

INSERT INTO devices (user_id, house_id, tuya_device_id, name, category, device_type, online)
SELECT u.id, h.id, 'tuya_temp_002', '온도 센서 2', '온도 센서', 'sensor', false
FROM users u, houses h WHERE u.email = 'user@farm.com' AND h.name = '2동 하우스';

-- 샘플 센서 데이터 (최근 데이터)
INSERT INTO sensor_data (time, device_id, user_id, sensor_type, value, unit, status)
SELECT NOW() - interval '1 hour' * n, d.id, u.id, 'temperature',
  20 + (random() * 15)::numeric(10,4), '°C',
  CASE WHEN random() > 0.9 THEN 'warning' ELSE 'normal' END
FROM users u, devices d, generate_series(0, 23) n
WHERE u.email = 'user@farm.com' AND d.tuya_device_id = 'tuya_temp_001';

INSERT INTO sensor_data (time, device_id, user_id, sensor_type, value, unit, status)
SELECT NOW() - interval '1 hour' * n, d.id, u.id, 'humidity',
  50 + (random() * 40)::numeric(10,4), '%',
  CASE WHEN random() > 0.85 THEN 'warning' ELSE 'normal' END
FROM users u, devices d, generate_series(0, 23) n
WHERE u.email = 'user@farm.com' AND d.tuya_device_id = 'tuya_humid_001';

-- 샘플 자동화 규칙
INSERT INTO automation_rules (user_id, group_id, name, description, rule_type, enabled, conditions, actions, priority)
SELECT u.id, g.id, '고온 경보 환풍기 자동 작동', '온도 30도 이상 시 환풍기 자동 ON', 'weather', true,
  '[{"type": "sensor", "field": "temperature", "operator": "gte", "value": 30, "unit": "°C"}]'::jsonb,
  '[{"command": "turn_on", "value": true, "groupId": null}]'::jsonb,
  1
FROM users u, house_groups g WHERE u.email = 'user@farm.com' AND g.name = '화성 1농장';

INSERT INTO automation_rules (user_id, group_id, name, description, rule_type, enabled, conditions, actions, priority)
SELECT u.id, g.id, '일출 시 개폐기 오픈', '매일 오전 6시에 하우스 개폐기 열기', 'time', true,
  '[{"type": "time", "field": "hour", "operator": "eq", "value": 6}]'::jsonb,
  '[{"command": "open", "value": 100}]'::jsonb,
  2
FROM users u, house_groups g WHERE u.email = 'user@farm.com' AND g.name = '화성 1농장';

SELECT '시드 데이터 생성 완료!' as result;
SELECT 'admin@farm.com / admin123 (관리자)' as admin_account;
SELECT 'user@farm.com / user123 (농장 관리자)' as farm_admin_account;
