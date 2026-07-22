-- 049: 고온 무대기 강제열림 (구역 환경설정)
-- 비 그친 직후 고온 시 개폐기 온도 룰의 동작/대기 듀티사이클을 무시하고
-- 대기 없이 연속 '열림'을 발행해 최대한 빨리 완전 개방한다(10분 캡은 유지).
-- 서버 automation-runner + Pi fallback-engine 양쪽에서 사용.
-- 기본 OFF — 설정하지 않으면 기존 동작 그대로(회귀 없음). 멱등.

ALTER TABLE fallback_configs
  ADD COLUMN IF NOT EXISTS high_temp_override_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE fallback_configs
  ADD COLUMN IF NOT EXISTS high_temp_open_threshold numeric(5,2);
