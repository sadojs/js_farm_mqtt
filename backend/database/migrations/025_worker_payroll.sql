-- Migration 025: Worker Payroll (일꾼 관리)
-- 시급·기본근무시간 기반 근무 달력 자동 채움 + 근무시작일 기준 매월 정산
-- 독립 모듈 — 기존 테이블 변경 없음, 소프트 FK(user_id)만 사용

CREATE TABLE IF NOT EXISTS payroll_workers (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL,                          -- 소프트 참조 (FK 없음)
  name         VARCHAR(60) NOT NULL,
  start_date   DATE NOT NULL,
  hourly_wage  INT NOT NULL DEFAULT 0,
  daily_hours  NUMERIC(4,1) NOT NULL DEFAULT 8,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payroll_workers_user_id ON payroll_workers(user_id);

CREATE TABLE IF NOT EXISTS payroll_deductions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL,
  worker_id   UUID NOT NULL,
  label       VARCHAR(60) NOT NULL,
  amount      INT NOT NULL DEFAULT 0,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payroll_deductions_worker_id ON payroll_deductions(worker_id);

CREATE TABLE IF NOT EXISTS payroll_advances (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL,
  worker_id   UUID NOT NULL,
  date        DATE NOT NULL,
  amount      INT NOT NULL DEFAULT 0,
  note        VARCHAR(120),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payroll_advances_worker_id ON payroll_advances(worker_id);

CREATE TABLE IF NOT EXISTS payroll_day_overrides (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL,
  worker_id    UUID NOT NULL,
  date         DATE NOT NULL,
  holiday      BOOLEAN NOT NULL DEFAULT FALSE,
  delta_hours  NUMERIC(4,1) NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_payroll_day_override UNIQUE (worker_id, date)
);
CREATE INDEX IF NOT EXISTS idx_payroll_day_overrides_worker_id ON payroll_day_overrides(worker_id);

CREATE TABLE IF NOT EXISTS payroll_settlements (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL,
  worker_id     UUID NOT NULL,
  period_start  DATE NOT NULL,
  period_end    DATE NOT NULL,
  settle_date   DATE NOT NULL,
  snapshot      JSONB NOT NULL,
  net_pay       INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_payroll_settlement UNIQUE (worker_id, period_start)
);
CREATE INDEX IF NOT EXISTS idx_payroll_settlements_worker_id ON payroll_settlements(worker_id);
