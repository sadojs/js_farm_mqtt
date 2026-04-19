-- 기후 정규값 (월별 평균 일기온) 캐시 테이블
-- KMA ASOS API 또는 현재 축적 날씨 데이터로부터 계산
CREATE TABLE IF NOT EXISTS climate_normals (
  nx          INTEGER  NOT NULL,
  ny          INTEGER  NOT NULL,
  month       SMALLINT NOT NULL, -- 1~12
  avg_temp    NUMERIC(5,2) NOT NULL, -- 월 평균 일기온 (°C)
  data_years  SMALLINT NOT NULL DEFAULT 0, -- 사용된 연도 수
  source      VARCHAR(20) NOT NULL DEFAULT 'builtin', -- 'builtin' | 'kma_asos' | 'weather_data'
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (nx, ny, month)
);

-- 기후 정규값 로딩 이력 (nx, ny 별 최근 갱신 시각)
CREATE TABLE IF NOT EXISTS climate_normals_meta (
  nx            INTEGER  NOT NULL,
  ny            INTEGER  NOT NULL,
  last_fetched  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  station_id    VARCHAR(10),
  PRIMARY KEY (nx, ny)
);
