-- 058_env_alert_settings.sql — 구역별 환경 경보(내부 온도·습도 높음, 토양 수분 낮음) 설정. additive only.
-- 저장한 구역만 1분마다 감시하고, 지속 시간(기본 5분)을 넘기면 한 번 알리고 정상 복귀 때 한 번 더 알린다.
CREATE TABLE IF NOT EXISTS env_alert_settings (
  group_id    UUID PRIMARY KEY REFERENCES house_groups(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL,
  items       JSONB NOT NULL DEFAULT '[]'::jsonb,
  channel     VARCHAR(20) NOT NULL DEFAULT 'push',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
