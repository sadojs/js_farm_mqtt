-- Migration 006: Crop Management (Growing Degree Days)
-- 적산온도 기반 생육관리 모듈
-- 독립 모듈 — 기존 테이블 변경 없음, 소프트 FK만 사용

-- ============================================================
-- 1. gdd_batches — 하우스(그룹)별 작물 재배 배치 정보
-- ============================================================
CREATE TABLE IF NOT EXISTS gdd_batches (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL,                            -- 소프트 참조 (FK 없음)
  group_id             UUID,                                     -- 소프트 참조 (FK 없음)
  crop_type            VARCHAR(30)  NOT NULL,                    -- tomato | cherry_tomato | cucumber | strawberry | paprika
  seedling_type        VARCHAR(20)  NOT NULL,                    -- seedling(실생묘) | grafted(접목묘)
  sowing_date          DATE         NOT NULL,                    -- 파종일
  transplant_date      DATE,                                     -- 정식일 (null 허용)
  base_temp            DECIMAL(4,1) NOT NULL DEFAULT 10.0,       -- 기준온도 (°C)
  target_gdd           DECIMAL(7,1),                            -- 수확 목표 GDD (null = 작물 기본값 사용)
  -- 온도 소스 관련
  temp_source          VARCHAR(20)  NOT NULL DEFAULT 'auto',     -- auto | sensor | weather
  greenhouse_offset    DECIMAL(4,1),                            -- 온실 보정값 (°C). null = 미설정
  offset_source        VARCHAR(20),                             -- calibrated | manual | borrowed | community
  borrowed_group_id    UUID,                                     -- 차용한 그룹 ID (소프트 참조)
  offset_calibrated_at TIMESTAMPTZ,                             -- 마지막 자동 보정 시각
  notes                TEXT,
  is_active            BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gdd_batches_user_id
  ON gdd_batches(user_id);

CREATE INDEX IF NOT EXISTS idx_gdd_batches_group_id
  ON gdd_batches(group_id)
  WHERE group_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_gdd_batches_active
  ON gdd_batches(user_id, is_active);

-- ============================================================
-- 2. crop_milestones — 작물별 마스터 마일스톤 (방제/시비/단계)
-- ============================================================
CREATE TABLE IF NOT EXISTS crop_milestones (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  crop_type       VARCHAR(30)  NOT NULL,                         -- tomato | cherry_tomato | ...
  seedling_type   VARCHAR(20),                                   -- NULL = 공통 (묘 타입 무관)
  milestone_type  VARCHAR(30)  NOT NULL,                         -- pest_control | fertilizer | pruning | stage
  gdd_threshold   DECIMAL(7,1) NOT NULL,                        -- 이 GDD 도달 시 트리거
  title           VARCHAR(100) NOT NULL,
  description     TEXT,
  priority        VARCHAR(10)  NOT NULL DEFAULT 'normal',        -- high | normal | low
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crop_milestones_crop
  ON crop_milestones(crop_type, seedling_type);

-- ============================================================
-- 3. crop_community_offsets — 플랫폼 작물별 온실 보정값 집계
--    매일 새벽 크론으로 갱신 (개인정보 없이 수치만)
-- ============================================================
CREATE TABLE IF NOT EXISTS crop_community_offsets (
  crop_type     VARCHAR(30)  PRIMARY KEY,
  median_offset DECIMAL(4,1),
  sample_count  INT          NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- 초기 시드 데이터 (플랫폼 운영 전 합리적인 온실 평균값)
INSERT INTO crop_community_offsets (crop_type, median_offset, sample_count) VALUES
  ('tomato',        4.0, 0),
  ('cherry_tomato', 4.0, 0),
  ('cucumber',      3.5, 0),
  ('strawberry',    2.5, 0),
  ('paprika',       4.0, 0)
ON CONFLICT (crop_type) DO NOTHING;

-- ============================================================
-- 4. 시드 데이터 — 토마토 마일스톤 (실생묘 기준)
-- ============================================================
INSERT INTO crop_milestones (crop_type, seedling_type, milestone_type, gdd_threshold, title, description, priority) VALUES
  -- 생육 단계
  ('tomato', NULL, 'stage',        80.0,   '발아 완료',                 '파종 후 발아가 완료되는 시점입니다.', 'normal'),
  ('tomato', NULL, 'stage',       200.0,   '육묘 완료 / 정식 적기',      '1~4엽이 전개되어 정식 가능한 시점입니다.', 'high'),
  ('tomato', NULL, 'stage',       600.0,   '개화착과기 진입',            '1화방 개화가 시작되는 시점입니다.', 'normal'),
  ('tomato', NULL, 'stage',       900.0,   '과비대기 진입',              '착과 후 과실이 비대해지는 시점입니다.', 'normal'),
  ('tomato', NULL, 'stage',      1200.0,   '수확 시작',                 '첫 수확이 가능한 시점입니다.', 'high'),
  -- 병해충 방제
  ('tomato', NULL, 'pest_control', 200.0,  '1차 역병 방제',             '온·습도가 높은 날 집중 발생합니다. 예방 위주 방제를 권장합니다.', 'high'),
  ('tomato', NULL, 'pest_control', 450.0,  '진딧물 방제 확인',          '신초(새순) 부위를 집중 확인하세요.', 'normal'),
  ('tomato', NULL, 'pest_control', 700.0,  '2차 역병 방제',             '개화기에 역병 감수성이 증가합니다. 개화 직전 예방 방제를 권장합니다.', 'high'),
  ('tomato', NULL, 'pest_control', 950.0,  '잿빛곰팡이 방제',           '과실 비대기에 잿빛곰팡이 발생에 주의하세요.', 'normal'),
  -- 시비
  ('tomato', NULL, 'fertilizer',  300.0,   '1차 칼슘 시비',             '배꼽썩음병 예방을 위해 칼슘제를 시비합니다.', 'high'),
  ('tomato', NULL, 'fertilizer',  600.0,   '칼리 증량',                 '과실 비대를 촉진하기 위해 칼리 비율을 높입니다.', 'normal'),
  ('tomato', NULL, 'fertilizer',  900.0,   '2차 칼슘 시비',             '과실 비대기 배꼽썩음병 추가 예방 시비.', 'normal'),
  -- 순따기
  ('tomato', NULL, 'pruning',     500.0,   '순따기 1회차',              '곁순이 2~3cm 자랐을 때 제거합니다.', 'normal'),
  ('tomato', NULL, 'pruning',     700.0,   '순따기 2회차',              '2회차 곁순 정리 및 잎 정리를 진행합니다.', 'normal')
ON CONFLICT DO NOTHING;

-- ============================================================
-- 5. 방울토마토 마일스톤 (토마토와 동일 기준)
-- ============================================================
INSERT INTO crop_milestones (crop_type, seedling_type, milestone_type, gdd_threshold, title, description, priority) VALUES
  ('cherry_tomato', NULL, 'stage',        80.0,   '발아 완료',                 '파종 후 발아가 완료되는 시점입니다.', 'normal'),
  ('cherry_tomato', NULL, 'stage',       200.0,   '육묘 완료 / 정식 적기',      '1~4엽이 전개되어 정식 가능한 시점입니다.', 'high'),
  ('cherry_tomato', NULL, 'stage',       600.0,   '개화착과기 진입',            '1화방 개화가 시작되는 시점입니다.', 'normal'),
  ('cherry_tomato', NULL, 'stage',       900.0,   '과비대기 진입',              '착과 후 과실이 비대해지는 시점입니다.', 'normal'),
  ('cherry_tomato', NULL, 'stage',      1200.0,   '수확 시작',                 '첫 수확이 가능한 시점입니다.', 'high'),
  ('cherry_tomato', NULL, 'pest_control', 200.0,  '1차 역병 방제',             '온·습도가 높은 날 집중 발생합니다. 예방 위주 방제를 권장합니다.', 'high'),
  ('cherry_tomato', NULL, 'pest_control', 450.0,  '진딧물 방제 확인',          '신초(새순) 부위를 집중 확인하세요.', 'normal'),
  ('cherry_tomato', NULL, 'pest_control', 700.0,  '2차 역병 방제',             '개화기에 역병 감수성이 증가합니다. 개화 직전 예방 방제를 권장합니다.', 'high'),
  ('cherry_tomato', NULL, 'pest_control', 950.0,  '잿빛곰팡이 방제',           '과실 비대기에 잿빛곰팡이 발생에 주의하세요.', 'normal'),
  ('cherry_tomato', NULL, 'fertilizer',  300.0,   '1차 칼슘 시비',             '배꼽썩음병 예방을 위해 칼슘제를 시비합니다.', 'high'),
  ('cherry_tomato', NULL, 'fertilizer',  600.0,   '칼리 증량',                 '과실 비대를 촉진하기 위해 칼리 비율을 높입니다.', 'normal'),
  ('cherry_tomato', NULL, 'fertilizer',  900.0,   '2차 칼슘 시비',             '과실 비대기 배꼽썩음병 추가 예방 시비.', 'normal'),
  ('cherry_tomato', NULL, 'pruning',     500.0,   '순따기 1회차',              '곁순이 2~3cm 자랐을 때 제거합니다.', 'normal'),
  ('cherry_tomato', NULL, 'pruning',     700.0,   '순따기 2회차',              '2회차 곁순 정리 및 잎 정리를 진행합니다.', 'normal')
ON CONFLICT DO NOTHING;

-- ============================================================
-- 6. 오이 마일스톤 (기본 세트)
-- ============================================================
INSERT INTO crop_milestones (crop_type, seedling_type, milestone_type, gdd_threshold, title, description, priority) VALUES
  ('cucumber', NULL, 'stage',        60.0,  '발아 완료',                '오이 발아 완료.', 'normal'),
  ('cucumber', NULL, 'stage',       150.0,  '정식 적기',                '3~4엽 전개, 정식 가능.', 'high'),
  ('cucumber', NULL, 'stage',       400.0,  '개화기 진입',              '첫 꽃 개화 시점.', 'normal'),
  ('cucumber', NULL, 'stage',       700.0,  '수확 시작',                '첫 수확 가능 시점.', 'high'),
  ('cucumber', NULL, 'pest_control', 150.0, '총채벌레 방제',            '초기 방제가 중요합니다.', 'high'),
  ('cucumber', NULL, 'pest_control', 400.0, '흰가루병 방제',            '개화기 전후 흰가루병 주의.', 'normal'),
  ('cucumber', NULL, 'fertilizer',  300.0,  '웃거름 시비',              '착과 후 생육 촉진 시비.', 'normal')
ON CONFLICT DO NOTHING;

-- ============================================================
-- 8. 딸기 마일스톤 (기본 세트)
-- ============================================================
INSERT INTO crop_milestones (crop_type, seedling_type, milestone_type, gdd_threshold, title, description, priority) VALUES
  ('strawberry', NULL, 'stage',        50.0,  '활착 완료',             '정식 후 뿌리 활착 완료.', 'normal'),
  ('strawberry', NULL, 'stage',       200.0,  '화방 분화',             '꽃눈 분화 시점 (저온 처리 확인).', 'high'),
  ('strawberry', NULL, 'stage',       400.0,  '개화기',               '첫 꽃 개화.', 'normal'),
  ('strawberry', NULL, 'stage',       600.0,  '수확 시작',             '첫 수확 가능.', 'high'),
  ('strawberry', NULL, 'pest_control', 100.0, '응애 방제',             '잎 뒷면을 확인하세요.', 'high'),
  ('strawberry', NULL, 'pest_control', 350.0, '잿빛곰팡이 방제',       '개화기 전 예방 방제.', 'high'),
  ('strawberry', NULL, 'fertilizer',  250.0,  '칼리 시비',             '과실 비대 전 칼리 증량.', 'normal')
ON CONFLICT DO NOTHING;
