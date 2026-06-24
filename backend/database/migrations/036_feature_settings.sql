-- 부가기능(농작업 일정·방재 일정·일꾼 관리) 노출 토글
-- scope = 'platform' (플랫폼 기본값) 또는 '<userId>' (농장 개인 설정)
-- 행이 없으면 enabled=true 로 간주(기본 노출). 생육관리는 별도 crop_feature_settings 사용.
CREATE TABLE IF NOT EXISTS feature_settings (
  feature     VARCHAR(40) NOT NULL,
  scope       VARCHAR(64) NOT NULL,
  enabled     BOOLEAN     NOT NULL DEFAULT TRUE,
  updated_by  VARCHAR(64),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (feature, scope)
);
