-- Migration 009: 실생묘/접목묘 마일스톤 분리
-- 기존 seedling_type = NULL 공통 마일스톤 → 'seedling' (실생묘)으로 명시
-- 접목묘(grafted) 전용 마일스톤 추가 (GDD 임계값 약 -12.5%, 기저온도 낮음)

-- ============================================================
-- 1. 기존 NULL 행을 'seedling'으로 변환
-- ============================================================
UPDATE crop_milestones SET seedling_type = 'seedling' WHERE seedling_type IS NULL;

-- ============================================================
-- 2. 토마토 — 접목묘(grafted) 마일스톤 (baseTemp=8°C 기준)
-- ============================================================
INSERT INTO crop_milestones (crop_type, seedling_type, milestone_type, gdd_threshold, title, description, priority) VALUES
  -- 생육 단계
  ('tomato', 'grafted', 'stage',         70.0,   '발아 완료',                 '접목묘 파종 후 발아 완료 시점입니다.', 'normal'),
  ('tomato', 'grafted', 'stage',        175.0,   '육묘 완료 / 정식 적기',      '접목묘는 실생묘보다 활착이 빠릅니다. 1~3엽 전개 시 정식 가능합니다.', 'high'),
  ('tomato', 'grafted', 'stage',        525.0,   '개화착과기 진입',            '1화방 개화 시점. 접목묘는 개화가 빠릅니다.', 'normal'),
  ('tomato', 'grafted', 'stage',        790.0,   '과비대기 진입',              '착과 후 과실 비대 시점.', 'normal'),
  ('tomato', 'grafted', 'stage',       1050.0,   '수확 시작',                 '접목묘 첫 수확 가능 시점.', 'high'),
  -- 병해충 방제
  ('tomato', 'grafted', 'pest_control', 175.0,  '1차 역병 방제',             '예방 위주 방제를 권장합니다.', 'high'),
  ('tomato', 'grafted', 'pest_control', 395.0,  '진딧물 방제 확인',          '신초 부위를 집중 확인하세요.', 'normal'),
  ('tomato', 'grafted', 'pest_control', 615.0,  '2차 역병 방제',             '개화기 역병 감수성 증가. 예방 방제 권장.', 'high'),
  ('tomato', 'grafted', 'pest_control', 830.0,  '잿빛곰팡이 방제',           '과실 비대기 잿빛곰팡이 주의.', 'normal'),
  -- 시비
  ('tomato', 'grafted', 'fertilizer',  260.0,   '1차 칼슘 시비',             '배꼽썩음병 예방 칼슘 시비.', 'high'),
  ('tomato', 'grafted', 'fertilizer',  525.0,   '칼리 증량',                 '과실 비대 촉진 위해 칼리 비율을 높입니다.', 'normal'),
  ('tomato', 'grafted', 'fertilizer',  790.0,   '2차 칼슘 시비',             '과실 비대기 추가 칼슘 시비.', 'normal'),
  -- 순따기
  ('tomato', 'grafted', 'pruning',     440.0,   '순따기 1회차',              '접목묘는 생육이 왕성하므로 곁순 관리가 중요합니다.', 'normal'),
  ('tomato', 'grafted', 'pruning',     615.0,   '순따기 2회차',              '2회차 곁순 및 잎 정리.', 'normal')
ON CONFLICT DO NOTHING;

-- ============================================================
-- 3. 방울토마토 — 접목묘(grafted) 마일스톤 (baseTemp=8°C 기준)
-- ============================================================
INSERT INTO crop_milestones (crop_type, seedling_type, milestone_type, gdd_threshold, title, description, priority) VALUES
  ('cherry_tomato', 'grafted', 'stage',         70.0,   '발아 완료',                 '접목묘 파종 후 발아 완료.', 'normal'),
  ('cherry_tomato', 'grafted', 'stage',        175.0,   '육묘 완료 / 정식 적기',      '접목묘 조기 정식 가능 시점.', 'high'),
  ('cherry_tomato', 'grafted', 'stage',        525.0,   '개화착과기 진입',            '1화방 개화 시작.', 'normal'),
  ('cherry_tomato', 'grafted', 'stage',        790.0,   '과비대기 진입',              '과실 비대 시작.', 'normal'),
  ('cherry_tomato', 'grafted', 'stage',        960.0,   '수확 시작',                 '접목묘 방울토마토 첫 수확 가능.', 'high'),
  ('cherry_tomato', 'grafted', 'pest_control', 175.0,  '1차 역병 방제',             '예방 위주 방제 권장.', 'high'),
  ('cherry_tomato', 'grafted', 'pest_control', 395.0,  '진딧물 방제 확인',          '신초 부위 집중 확인.', 'normal'),
  ('cherry_tomato', 'grafted', 'pest_control', 615.0,  '2차 역병 방제',             '개화기 예방 방제.', 'high'),
  ('cherry_tomato', 'grafted', 'pest_control', 830.0,  '잿빛곰팡이 방제',           '과실 비대기 주의.', 'normal'),
  ('cherry_tomato', 'grafted', 'fertilizer',  260.0,   '1차 칼슘 시비',             '배꼽썩음병 예방.', 'high'),
  ('cherry_tomato', 'grafted', 'fertilizer',  525.0,   '칼리 증량',                 '과실 비대 촉진.', 'normal'),
  ('cherry_tomato', 'grafted', 'fertilizer',  790.0,   '2차 칼슘 시비',             '추가 칼슘 예방 시비.', 'normal'),
  ('cherry_tomato', 'grafted', 'pruning',     440.0,   '순따기 1회차',              '곁순 관리.', 'normal'),
  ('cherry_tomato', 'grafted', 'pruning',     615.0,   '순따기 2회차',              '2회차 곁순 정리.', 'normal')
ON CONFLICT DO NOTHING;

-- ============================================================
-- 4. 오이 — 접목묘(grafted) 마일스톤 (baseTemp=10°C 기준)
-- ============================================================
INSERT INTO crop_milestones (crop_type, seedling_type, milestone_type, gdd_threshold, title, description, priority) VALUES
  ('cucumber', 'grafted', 'stage',         52.0,  '발아 완료',                '접목묘 발아 완료.', 'normal'),
  ('cucumber', 'grafted', 'stage',        130.0,  '정식 적기',                '접목묘 3~4엽 전개. 조기 정식 가능.', 'high'),
  ('cucumber', 'grafted', 'stage',        350.0,  '개화기 진입',              '접목묘 조기 개화. 첫 꽃 확인.', 'normal'),
  ('cucumber', 'grafted', 'stage',        615.0,  '수확 시작',                '접목묘 오이 첫 수확 가능.', 'high'),
  ('cucumber', 'grafted', 'pest_control', 130.0,  '총채벌레 방제',            '초기 방제가 중요합니다.', 'high'),
  ('cucumber', 'grafted', 'pest_control', 350.0,  '흰가루병 방제',            '개화 전후 흰가루병 주의.', 'normal'),
  ('cucumber', 'grafted', 'fertilizer',  265.0,  '웃거름 시비',              '착과 후 생육 촉진 시비.', 'normal')
ON CONFLICT DO NOTHING;

-- ============================================================
-- 5. 딸기 — 접목묘(grafted) 마일스톤 (baseTemp=3°C 기준)
-- ============================================================
INSERT INTO crop_milestones (crop_type, seedling_type, milestone_type, gdd_threshold, title, description, priority) VALUES
  ('strawberry', 'grafted', 'stage',         44.0,  '활착 완료',             '접목묘 활착 완료. 신엽 전개 확인.', 'normal'),
  ('strawberry', 'grafted', 'stage',        175.0,  '화방 분화',             '꽃눈 분화 시점.', 'high'),
  ('strawberry', 'grafted', 'stage',        350.0,  '개화기',               '첫 꽃 개화.', 'normal'),
  ('strawberry', 'grafted', 'stage',        525.0,  '수확 시작',             '접목묘 딸기 첫 수확 가능.', 'high'),
  ('strawberry', 'grafted', 'pest_control',  88.0,  '응애 방제',             '잎 뒷면을 확인하세요.', 'high'),
  ('strawberry', 'grafted', 'pest_control', 310.0,  '잿빛곰팡이 방제',       '개화기 전 예방 방제.', 'high'),
  ('strawberry', 'grafted', 'fertilizer',  220.0,  '칼리 시비',             '과실 비대 전 칼리 증량.', 'normal')
ON CONFLICT DO NOTHING;

-- ============================================================
-- 6. 파프리카 — 접목묘(grafted) 마일스톤 (baseTemp=8°C 기준)
--    실생묘 마일스톤이 없으므로 seedling 세트도 함께 추가
-- ============================================================
INSERT INTO crop_milestones (crop_type, seedling_type, milestone_type, gdd_threshold, title, description, priority) VALUES
  -- 실생묘
  ('paprika', 'seedling', 'stage',         90.0,   '발아 완료',                 '파프리카 발아 완료.', 'normal'),
  ('paprika', 'seedling', 'stage',        250.0,   '정식 적기',                 '6~8엽 전개 시 정식 가능.', 'high'),
  ('paprika', 'seedling', 'stage',        700.0,   '개화착과기 진입',            '첫 꽃 개화 시작.', 'normal'),
  ('paprika', 'seedling', 'stage',       1000.0,   '과비대기 진입',              '과실 비대 시작.', 'normal'),
  ('paprika', 'seedling', 'stage',       1400.0,   '수확 시작',                 '첫 수확 가능.', 'high'),
  ('paprika', 'seedling', 'pest_control', 250.0,  '진딧물 방제',               '신초 부위 확인.', 'high'),
  ('paprika', 'seedling', 'pest_control', 700.0,  '총채벌레 방제',             '개화기 집중 방제.', 'high'),
  ('paprika', 'seedling', 'fertilizer',  400.0,   '칼슘·붕소 시비',            '낙화 예방 시비.', 'normal'),
  ('paprika', 'seedling', 'fertilizer',  800.0,   '칼리 증량',                '과실 비대 촉진.', 'normal'),
  -- 접목묘
  ('paprika', 'grafted',  'stage',         79.0,   '발아 완료',                 '접목묘 파프리카 발아 완료.', 'normal'),
  ('paprika', 'grafted',  'stage',        220.0,   '정식 적기',                 '접목묘 조기 정식 가능.', 'high'),
  ('paprika', 'grafted',  'stage',        615.0,   '개화착과기 진입',            '접목묘 조기 개화.', 'normal'),
  ('paprika', 'grafted',  'stage',        875.0,   '과비대기 진입',              '과실 비대 시작.', 'normal'),
  ('paprika', 'grafted',  'stage',       1225.0,   '수확 시작',                 '접목묘 파프리카 첫 수확.', 'high'),
  ('paprika', 'grafted',  'pest_control', 220.0,  '진딧물 방제',               '신초 부위 확인.', 'high'),
  ('paprika', 'grafted',  'pest_control', 615.0,  '총채벌레 방제',             '개화기 집중 방제.', 'high'),
  ('paprika', 'grafted',  'fertilizer',  350.0,   '칼슘·붕소 시비',            '낙화 예방 시비.', 'normal'),
  ('paprika', 'grafted',  'fertilizer',  700.0,   '칼리 증량',                '과실 비대 촉진.', 'normal')
ON CONFLICT DO NOTHING;
