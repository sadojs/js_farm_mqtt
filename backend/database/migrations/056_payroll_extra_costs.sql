-- 056_payroll_extra_costs.sql — 기타 고용비용(항공권·비자/수수료·숙소 관리/공과금·보험 농장부담분 등). additive only.
-- 연간 인건비 결산(GET /worker-payroll/annual)의 extraCostTotal·totalCost 에 합산된다.
CREATE TABLE IF NOT EXISTS payroll_extra_costs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL,              -- 농장 소유자 (소프트 참조)
  year        INT  NOT NULL,              -- 귀속 연도 (date 가 있으면 그 연도)
  date        DATE NULL,
  worker_id   UUID NULL,                  -- 특정 일꾼 비용이면 지정 (선택)
  label       VARCHAR(60) NOT NULL,
  amount      INT NOT NULL DEFAULT 0,
  note        VARCHAR(120) NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payroll_extra_costs_user_year ON payroll_extra_costs(user_id, year);
