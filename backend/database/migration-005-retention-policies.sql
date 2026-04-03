-- 005: 데이터 리텐션 정책
-- sensor_data: 3개월 → 6개월, weather_data: 6개월 (TimescaleDB retention)
-- automation_logs: 1개월, activity_logs: 3개월, sensor_alerts: 3개월, notifications: 2개월 (크론 DELETE)

-- ==========================================
-- 1. TimescaleDB Hypertable 리텐션 정책
-- ==========================================

-- sensor_data: 기존 3개월 → 6개월로 변경
SELECT remove_retention_policy('sensor_data', if_exists => true);
SELECT add_retention_policy('sensor_data', INTERVAL '6 months');

-- weather_data: 6개월 리텐션 추가
SELECT add_retention_policy('weather_data', INTERVAL '6 months', if_not_exists => true);

-- ==========================================
-- 2. 일반 테이블 리텐션 (pg_cron 또는 수동 실행)
-- ==========================================

-- automation_logs: 1개월 이전 삭제
DELETE FROM automation_logs WHERE executed_at < NOW() - INTERVAL '1 month';

-- activity_logs: 3개월 이전 삭제
DELETE FROM activity_logs WHERE created_at < NOW() - INTERVAL '3 months';

-- sensor_alerts: 3개월 이전 + 해결 완료된 것만 삭제
DELETE FROM sensor_alerts WHERE created_at < NOW() - INTERVAL '3 months' AND resolved = true;

-- notifications: 2개월 이전 삭제
DELETE FROM notifications WHERE created_at < NOW() - INTERVAL '2 months';

-- ==========================================
-- 3. 인덱스 추가 (리텐션 DELETE 성능 최적화)
-- ==========================================

CREATE INDEX IF NOT EXISTS idx_automation_logs_executed_at ON automation_logs(executed_at);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_sensor_alerts_created_at ON sensor_alerts(created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at);
