-- Migration 031: 농작업 일정 (Work Log) — 구역×작업 종류 기록
-- 참고: 표준 6종은 시드 데이터로 등록, 농장별 커스텀 가능.

CREATE TABLE IF NOT EXISTS work_task_types (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label         VARCHAR(40) NOT NULL,
  color         VARCHAR(16) NOT NULL DEFAULT '#43a047',
  emoji         VARCHAR(8) NOT NULL DEFAULT '🍃',
  icon_key      VARCHAR(40),                    -- 향후 내장 라인 아이콘 키
  is_standard   BOOLEAN NOT NULL DEFAULT false, -- 표준 시드 여부 (삭제 대신 숨김)
  hidden        BOOLEAN NOT NULL DEFAULT false, -- 표준 작업 숨김 처리용
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_work_task_types_user ON work_task_types(user_id);

CREATE TABLE IF NOT EXISTS work_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  zone_id       UUID NOT NULL REFERENCES house_groups(id) ON DELETE CASCADE,
  task_type_id  UUID NOT NULL REFERENCES work_task_types(id) ON DELETE RESTRICT,
  worker_id     UUID REFERENCES payroll_workers(id) ON DELETE SET NULL,
  done_at       TIMESTAMPTZ NOT NULL,
  note          TEXT,
  qty           NUMERIC(10,2),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_work_logs_user ON work_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_work_logs_zone_done ON work_logs(zone_id, done_at DESC);
CREATE INDEX IF NOT EXISTS idx_work_logs_task_done ON work_logs(task_type_id, done_at DESC);
CREATE INDEX IF NOT EXISTS idx_work_logs_done_at ON work_logs(done_at DESC);

COMMENT ON TABLE work_task_types IS '농작업 종류 마스터 — 농장별 커스텀 가능. 표준 6종 시드.';
COMMENT ON TABLE work_logs IS '농작업 기록 — 구역×작업 종류×시각.';
