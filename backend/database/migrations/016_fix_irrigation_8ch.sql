-- Migration 016: 관주 레거시 슬롯 8채널 정정
-- 기존 zone_5~12 레거시 슬롯(pairKey=NULL) 제거
-- 8ch = 원격제어 + B접점 + 구역4 + 교반기 + 액비 = 8채널
-- 12ch 이상은 동적 그룹(pairKey!=NULL)으로 추가

DELETE FROM gateway_onboard_devices
WHERE pair_key IS NULL
  AND slot_key IN ('zone_5','zone_6','zone_7','zone_8',
                   'zone_9','zone_10','zone_11','zone_12');

-- mixer, fertilizer_motor sortOrder 정정 (19→11, 20→12)
UPDATE gateway_onboard_devices
SET sort_order = 11
WHERE pair_key IS NULL AND slot_key = 'mixer';

UPDATE gateway_onboard_devices
SET sort_order = 12
WHERE pair_key IS NULL AND slot_key = 'fertilizer_motor';
