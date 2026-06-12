-- Migration 028: 방재 벌(호박벌) 사용 시 벌문 개방 일정 자동 생성
-- 약품에 has_bees 체크 → 방재일 오전 벌문 닫기 + 방재 2일 후 '벌문 개방' 이벤트 생성

ALTER TABLE spray_products ADD COLUMN IF NOT EXISTS has_bees BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE spray_events ADD COLUMN IF NOT EXISTS kind VARCHAR(12) NOT NULL DEFAULT 'spray';
ALTER TABLE spray_events ADD COLUMN IF NOT EXISTS bee BOOLEAN NOT NULL DEFAULT FALSE;
