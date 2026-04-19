-- Migration 010: 하우스 오프셋 기본값 현실화 (4°C → 8°C)
-- 한국 비닐하우스 평균 내외 온도차 기준으로 커뮤니티 초기값 상향
-- 실제 보정값이 누적되면 이 값은 자동으로 갱신됨 (sample_count > 0)

UPDATE crop_community_offsets
SET median_offset = 8.0
WHERE sample_count = 0;  -- 실 데이터가 없는 기본값만 변경
