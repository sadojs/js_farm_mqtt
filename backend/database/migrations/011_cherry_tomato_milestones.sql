-- Migration 011: 방울토마토 마일스톤 실제 재배 데이터 기반 업데이트
-- 실생묘/접목묘 분리 적용

-- ============================================================
-- 1. 기존 방울토마토 마일스톤 전체 삭제 후 재삽입
-- ============================================================
DELETE FROM crop_milestones WHERE crop_type = 'cherry_tomato';

-- ============================================================
-- 2. 방울토마토 — 실생묘(seedling) 마일스톤
-- ============================================================
INSERT INTO crop_milestones (crop_type, seedling_type, milestone_type, gdd_threshold, title, description, priority) VALUES
  -- 생육 단계
  ('cherry_tomato', 'seedling', 'stage',         500.0,  '개화착과기 진입',              '1화방 개화가 시작되는 시점입니다.', 'high'),
  ('cherry_tomato', 'seedling', 'stage',         900.0,  '과비대기 진입',                '착과 후 과실이 비대해지는 시점입니다.', 'normal'),
  ('cherry_tomato', 'seedling', 'stage',        1100.0,  '수확 시작',                   '첫 수확이 가능한 시점입니다.', 'high'),
  -- 병해충 방제
  ('cherry_tomato', 'seedling', 'pest_control',  150.0,  '1차 역병 방제',               '정식 초기 역병 예방 방제를 권장합니다.', 'high'),
  ('cherry_tomato', 'seedling', 'pest_control',  450.0,  '진딧물 방제 확인',             '신초(새순) 부위를 집중 확인하세요.', 'normal'),
  ('cherry_tomato', 'seedling', 'pest_control',  700.0,  '2차 역병 방제',               '개화기 역병 감수성 증가. 예방 방제 권장.', 'high'),
  ('cherry_tomato', 'seedling', 'pest_control',  950.0,  '잿빛곰팡이 방제',              '과실 비대기 잿빛곰팡이 발생에 주의하세요.', 'normal'),
  -- 시비
  ('cherry_tomato', 'seedling', 'fertilizer',    300.0,  '1차 칼슘 시비',               '배꼽썩음병 예방을 위해 칼슘제를 시비합니다.', 'high'),
  ('cherry_tomato', 'seedling', 'fertilizer',    600.0,  '칼리 증량',                   '과실 비대를 촉진하기 위해 칼리 비율을 높입니다.', 'normal'),
  ('cherry_tomato', 'seedling', 'fertilizer',    900.0,  '2차 칼슘 시비',               '과실 비대기 배꼽썩음병 추가 예방 시비.', 'normal'),
  -- 순따기
  ('cherry_tomato', 'seedling', 'pruning',       550.0,  '순따기 1회차 (착과 확인 후)', '착과 확인 후 곁순이 2~3cm 자랐을 때 제거합니다.', 'normal'),
  ('cherry_tomato', 'seedling', 'pruning',       700.0,  '순따기 2회차',                '2회차 곁순 정리 및 잎 정리를 진행합니다.', 'normal');

-- ============================================================
-- 3. 방울토마토 — 접목묘(grafted) 마일스톤 (실생묘 기준 ×0.875)
-- ============================================================
INSERT INTO crop_milestones (crop_type, seedling_type, milestone_type, gdd_threshold, title, description, priority) VALUES
  -- 생육 단계
  ('cherry_tomato', 'grafted', 'stage',          440.0,  '개화착과기 진입',              '접목묘 조기 개화. 1화방 개화 확인.', 'high'),
  ('cherry_tomato', 'grafted', 'stage',          790.0,  '과비대기 진입',                '착과 후 과실 비대 시작.', 'normal'),
  ('cherry_tomato', 'grafted', 'stage',          960.0,  '수확 시작',                   '접목묘 방울토마토 첫 수확 가능.', 'high'),
  -- 병해충 방제
  ('cherry_tomato', 'grafted', 'pest_control',   130.0,  '1차 역병 방제',               '정식 초기 역병 예방 방제.', 'high'),
  ('cherry_tomato', 'grafted', 'pest_control',   395.0,  '진딧물 방제 확인',             '신초 부위를 집중 확인하세요.', 'normal'),
  ('cherry_tomato', 'grafted', 'pest_control',   615.0,  '2차 역병 방제',               '개화기 예방 방제 권장.', 'high'),
  ('cherry_tomato', 'grafted', 'pest_control',   830.0,  '잿빛곰팡이 방제',              '과실 비대기 주의.', 'normal'),
  -- 시비
  ('cherry_tomato', 'grafted', 'fertilizer',     260.0,  '1차 칼슘 시비',               '배꼽썩음병 예방 칼슘 시비.', 'high'),
  ('cherry_tomato', 'grafted', 'fertilizer',     525.0,  '칼리 증량',                   '과실 비대 촉진.', 'normal'),
  ('cherry_tomato', 'grafted', 'fertilizer',     790.0,  '2차 칼슘 시비',               '과실 비대기 추가 칼슘 시비.', 'normal'),
  -- 순따기
  ('cherry_tomato', 'grafted', 'pruning',        480.0,  '순따기 1회차 (착과 확인 후)', '착과 확인 후 곁순 제거.', 'normal'),
  ('cherry_tomato', 'grafted', 'pruning',        615.0,  '순따기 2회차',                '2회차 곁순 및 잎 정리.', 'normal');
