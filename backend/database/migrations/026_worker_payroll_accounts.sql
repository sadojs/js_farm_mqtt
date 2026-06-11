-- Migration 026: Worker Payroll — 권한 분리 + 정산 확정 워크플로우
-- 1) 일꾼 로그인 계정 연결(account_user_id) + 연락처
-- 2) 일자 모델: 잔업(delta_hours) 제거 → 절대 시간(hours) + 상태(status: work|off)
-- 3) 정산 상태 워크플로우(pending|requested|confirmed) + 요청/확정 시각
-- 기존 기능 영향 없음(소프트 FK 유지). dev 는 synchronize 로 자동 반영, 운영은 본 SQL.

-- ── 1) payroll_workers: 로그인 계정 연결 + 연락처 ──
ALTER TABLE payroll_workers ADD COLUMN IF NOT EXISTS account_user_id UUID;
ALTER TABLE payroll_workers ADD COLUMN IF NOT EXISTS phone VARCHAR(30);
CREATE INDEX IF NOT EXISTS idx_payroll_workers_account_user ON payroll_workers(account_user_id);

-- ── 2) payroll_day_overrides → 절대 시간 + 상태 ──
ALTER TABLE payroll_day_overrides ADD COLUMN IF NOT EXISTS status VARCHAR(10) NOT NULL DEFAULT 'work';
ALTER TABLE payroll_day_overrides ADD COLUMN IF NOT EXISTS hours NUMERIC(4,1) NOT NULL DEFAULT 0;

-- 기존 데이터 이관: 휴일 → off, 그 외 → work (delta_hours 는 더 이상 사용 안 함)
UPDATE payroll_day_overrides SET status = 'off' WHERE holiday = TRUE;
UPDATE payroll_day_overrides SET status = 'work' WHERE holiday = FALSE;

-- 잔업/휴일 컬럼 제거 (dev 데이터 없음, 신규 모델로 대체)
ALTER TABLE payroll_day_overrides DROP COLUMN IF EXISTS holiday;
ALTER TABLE payroll_day_overrides DROP COLUMN IF EXISTS delta_hours;

-- ── 3) payroll_settlements: 상태 워크플로우 ──
ALTER TABLE payroll_settlements ADD COLUMN IF NOT EXISTS status VARCHAR(12) NOT NULL DEFAULT 'confirmed';
ALTER TABLE payroll_settlements ADD COLUMN IF NOT EXISTS requested_at TIMESTAMPTZ;
ALTER TABLE payroll_settlements ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;

-- 기존 정산행(있다면)은 확정 상태로 간주
UPDATE payroll_settlements SET confirmed_at = COALESCE(confirmed_at, created_at) WHERE status = 'confirmed';
