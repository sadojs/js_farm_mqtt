-- 055_worker_seasons.sql — 일꾼 시즌(고용 기간) 도입. additive only.
-- 일꾼 = 사람(계정·연락처), 시즌 = 한 번의 고용(기간·임금 조건·공제).
-- payroll_workers 의 근무조건 컬럼은 삭제하지 않고 "현재 시즌 미러"로 유지한다(구버전 앱 호환).
-- 설계: docs/02-design/features/worker-seasons-annual.design.md

CREATE TABLE IF NOT EXISTS payroll_worker_seasons (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                UUID NOT NULL,              -- 농장 소유자 (소프트 참조)
  worker_id              UUID NOT NULL,
  season_year            INT  NOT NULL,              -- 표시용 = start_date 의 연도
  start_date             DATE NOT NULL,
  end_date               DATE NULL,                  -- NULL = 근무 중
  salary_type            VARCHAR(20) NOT NULL DEFAULT 'hourly',
  hourly_wage            INT NOT NULL DEFAULT 0,
  fixed_monthly_salary   INT NOT NULL DEFAULT 0,
  daily_hours            NUMERIC(4,1) NOT NULL DEFAULT 8,
  settlement_cycle_type  VARCHAR(20) NOT NULL DEFAULT 'calendar_month',
  note                   VARCHAR(120) NULL,
  closed_at              TIMESTAMPTZ NULL,           -- 시즌 마감 시각 (NULL = 열림)
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payroll_seasons_worker ON payroll_worker_seasons(worker_id, start_date);
CREATE INDEX IF NOT EXISTS idx_payroll_seasons_user_year ON payroll_worker_seasons(user_id, season_year);

ALTER TABLE payroll_deductions ADD COLUMN IF NOT EXISTS season_id UUID NULL;
CREATE INDEX IF NOT EXISTS idx_payroll_deductions_season ON payroll_deductions(season_id);

-- 백필: 시즌이 없는 일꾼마다 현재 컬럼으로 시즌 1개 생성 (is_active=false 인 일꾼 포함 — 기록 보존 목적)
INSERT INTO payroll_worker_seasons
  (user_id, worker_id, season_year, start_date, end_date, salary_type, hourly_wage,
   fixed_monthly_salary, daily_hours, settlement_cycle_type)
SELECT w.user_id, w.id, EXTRACT(YEAR FROM w.start_date)::int, w.start_date, w.end_date,
       w.salary_type, w.hourly_wage, w.fixed_monthly_salary, w.daily_hours, w.settlement_cycle_type
FROM payroll_workers w
WHERE NOT EXISTS (SELECT 1 FROM payroll_worker_seasons s WHERE s.worker_id = w.id);

-- 백필: 기존 공제를 그 일꾼의 (가장 최근) 시즌에 연결
UPDATE payroll_deductions d
SET season_id = s.id
FROM payroll_worker_seasons s
WHERE d.season_id IS NULL AND s.worker_id = d.worker_id
  AND s.id = (SELECT s2.id FROM payroll_worker_seasons s2 WHERE s2.worker_id = d.worker_id
              ORDER BY s2.start_date DESC LIMIT 1);
