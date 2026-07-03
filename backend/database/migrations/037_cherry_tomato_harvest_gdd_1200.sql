-- Migration 037: 방울토마토(실생묘) '수확 시작' 마일스톤 GDD 1100 → 1200
-- 011에서 1100으로 시드했던 값을 1200으로 상향 (배치 목표 GDD와 정합).
-- 이미 011을 적용한 환경도 forward-only로 반영되도록 UPDATE (idempotent).
UPDATE crop_milestones
SET gdd_threshold = 1200.0
WHERE crop_type = 'cherry_tomato'
  AND seedling_type = 'seedling'
  AND title = '수확 시작'
  AND gdd_threshold = 1100.0;
