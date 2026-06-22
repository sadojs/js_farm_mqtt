-- Migration 035: 일꾼 퇴사일 + 고정공제 일할 계산 옵션
-- 입사 첫 달·퇴사 달의 고정공제(숙소비/식비 등)를 사용일수 비율로 차감.
-- 4대보험 같은 법정성 공제는 prorate=false 로 매달 정액 유지.

ALTER TABLE payroll_workers
  ADD COLUMN IF NOT EXISTS end_date DATE NULL;

COMMENT ON COLUMN payroll_workers.end_date IS
  '퇴사일. NULL=재직중. 그 일자까지 근무, 다음날부터 정산·달력에서 제외.';

ALTER TABLE payroll_deductions
  ADD COLUMN IF NOT EXISTS prorate BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN payroll_deductions.prorate IS
  '고정공제 일할 계산 적용 여부. TRUE(기본)=입사·퇴사 달에 사용일수 비율로 차감. FALSE=매달 정액(예: 4대보험).';

-- 재직 중인 일꾼 빠른 조회
CREATE INDEX IF NOT EXISTS idx_payroll_workers_active_end_date
  ON payroll_workers (user_id) WHERE end_date IS NULL;
