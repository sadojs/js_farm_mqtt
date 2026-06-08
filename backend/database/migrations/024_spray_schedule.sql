-- Migration 024: Spray Schedule (방재일정 관리)
-- 구역별 정식일 + 방재 프로그램(해충/약품) 기반 방재 달력 자동 생성
-- 독립 모듈 — 기존 테이블 변경 없음, 소프트 FK(user_id, group_id)만 사용

CREATE TABLE IF NOT EXISTS spray_zones (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL,                       -- 소프트 참조 (FK 없음)
  group_id        UUID,                                -- house_groups 소프트 참조 (선택)
  name            VARCHAR(60) NOT NULL,
  crop_type       VARCHAR(40),
  transplant_date DATE NOT NULL,
  color           VARCHAR(16) NOT NULL DEFAULT '#43a047',
  sort_order      INT NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_spray_zones_user_id ON spray_zones(user_id);

CREATE TABLE IF NOT EXISTS spray_programs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL,
  zone_id     UUID NOT NULL,
  pest        VARCHAR(40) NOT NULL,
  color       VARCHAR(16) NOT NULL DEFAULT '#e53935',
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_spray_programs_zone_id ON spray_programs(zone_id);

CREATE TABLE IF NOT EXISTS spray_products (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL,
  program_id    UUID NOT NULL,
  rank          INT NOT NULL DEFAULT 1,
  name          VARCHAR(60) NOT NULL,
  start_date    DATE NOT NULL,
  interval_days INT NOT NULL DEFAULT 3,
  count         INT NOT NULL DEFAULT 1,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_spray_products_program_id ON spray_products(program_id);

CREATE TABLE IF NOT EXISTS spray_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL,
  zone_id     UUID NOT NULL,
  program_id  UUID,
  product_id  UUID,
  date        DATE NOT NULL,
  pest        VARCHAR(40),
  product     VARCHAR(60),
  color       VARCHAR(16),
  round       INT NOT NULL DEFAULT 1,
  is_manual   BOOLEAN NOT NULL DEFAULT FALSE,
  pinned      BOOLEAN NOT NULL DEFAULT FALSE,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_spray_events_user_date ON spray_events(user_id, date);
CREATE INDEX IF NOT EXISTS idx_spray_events_zone_id ON spray_events(zone_id);
