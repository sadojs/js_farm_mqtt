-- 042_worker_settlement_options.sql
-- 일꾼 급여/정산 옵션 2종 추가:
--   1) salary_type: 'hourly'(시급×시간) | 'fixed_monthly'(고정 월급)
--   2) settlement_cycle_type: 'calendar_month'(매월 1일~말일) | 'anniversary'(입사일 기준 매월)
-- 기존 일꾼은 기본값(시급 / 달력월)으로 동작 — 하위호환.

ALTER TABLE payroll_workers
  ADD COLUMN IF NOT EXISTS salary_type varchar(20) NOT NULL DEFAULT 'hourly',
  ADD COLUMN IF NOT EXISTS fixed_monthly_salary integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS settlement_cycle_type varchar(20) NOT NULL DEFAULT 'calendar_month';
