-- Migration 017: Rain detection env_role + opener rain override support
-- 비 감지 센서(우적센서, TS0207)를 구역의 env-config에 매핑할 수 있도록 env_role 추가
-- sensor_type='rain_detection' (boolean 1/0)는 기존 'rain' (legacy 강우 boolean)과 의도적으로 분리

INSERT INTO env_roles (role_key, label, category, unit, sort_order) VALUES
  ('rain_detection', '비 감지', 'external', '', 8)
ON CONFLICT (role_key) DO NOTHING;

-- automation_rules에 rain-override 동작 추적용 신규 컬럼 (선택) — 활동 로그 기록만으로도 충분하므로 컬럼 추가는 보류
