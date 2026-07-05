-- 041_fallback_sensor_timeout_default.sql
-- sensor_timeout_seconds 기본값 600(10분) → 1200(20분) 상향.
--
-- 배경: 온습도센서(SNZB-02P) 실측 보고주기가 ~14분(840초)인데 타임아웃이 600초라,
--       폴백 모드에서 매 주기 약 4분씩 '센서 stale'로 오판되어 온도 히스테리시스(primary)
--       ↔ 월별 백업 스케줄(backup) 사이를 flip-flop 하는 문제가 관찰됨.
--       1200초로 잡으면 정상 보고 시 stale 판정이 사라지고, 센서가 실제로 죽었을 때만
--       ~20분 내 백업으로 전환됨.

ALTER TABLE fallback_configs ALTER COLUMN sensor_timeout_seconds SET DEFAULT 1200;

-- 아직 이전 기본값(600)인 기존 게이트웨이 일괄 상향(사용자가 명시적으로 다른 값을 준 경우는 보존).
-- 주의: 값만 갱신되며 Pi 반영은 다음 config sync(version bump) 시점에 일어남.
UPDATE fallback_configs SET sensor_timeout_seconds = 1200 WHERE sensor_timeout_seconds = 600;
