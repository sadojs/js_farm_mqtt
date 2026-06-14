-- Migration 032: 구역 메모 (zone_notes)
-- 구역별 특징/노하우(관수 40분, 총채벌레 집중 등) — 다음 작기 참고용.
-- 화면 상시 노출 없음, 메모 버튼 → 패널에서만 확인. 기존 구역 카드 기능 무영향.

CREATE TABLE IF NOT EXISTS zone_notes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL,                       -- 농장 소유자(스코프)
  zone_id          UUID NOT NULL,                       -- house_groups 소프트 참조
  tag              VARCHAR(12) NOT NULL DEFAULT 'etc',   -- water|nutrient|pest|env|etc
  text             TEXT NOT NULL,
  pinned           BOOLEAN NOT NULL DEFAULT FALSE,
  created_by_user  UUID,                                -- 작성자 user id
  created_by_name  VARCHAR(60),                         -- 작성자 표시명(스냅샷)
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_zone_notes_zone ON zone_notes(zone_id);
CREATE INDEX IF NOT EXISTS idx_zone_notes_user ON zone_notes(user_id);
