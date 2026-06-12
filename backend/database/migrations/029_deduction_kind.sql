-- Migration 029: 변동 공제(전기·수도·가스) 지원
-- 공제 항목을 고정(fixed)/변동(variable)으로 구분.
-- 변동은 설정에 금액 없이 항목만 등록 → 정산 시 그 달 금액 입력 → 스냅샷 박제.

ALTER TABLE payroll_deductions ADD COLUMN IF NOT EXISTS kind VARCHAR(10) NOT NULL DEFAULT 'fixed';
