-- Migration 030: 방재 시간(오전/오후) — 벌문 개방 시점 차등
-- 오전 방재 → 2일 후 오전 개방, 오후 방재 → 3일 후 오전 개방 (기본 오후)

ALTER TABLE spray_products ADD COLUMN IF NOT EXISTS time_of_day VARCHAR(2) NOT NULL DEFAULT 'pm';
ALTER TABLE spray_events ADD COLUMN IF NOT EXISTS time_of_day VARCHAR(2);
