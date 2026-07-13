-- Migration 045: 자동제어 룰 정지 사유/시각 (일괄제어 원복용)
-- 일괄제어 실행 시 관련 룰을 disabled_reason='bulk'로 정지 → 새로고침/다기기/재접속에도
-- '자동제어 원복' 배너가 유지되도록 백엔드에 상태를 표기. 원복/수동 재활성화 시 NULL로 클리어.
-- forward-only, idempotent.

ALTER TABLE automation_rules
  ADD COLUMN IF NOT EXISTS disabled_reason varchar(20),
  ADD COLUMN IF NOT EXISTS disabled_at timestamptz;
