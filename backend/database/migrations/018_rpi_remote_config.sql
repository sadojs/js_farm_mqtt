-- Migration 018: RPi Golden Image System — 원격 설정 배포용 gateways 확장
-- rpi-golden-image-system feature (Design v0.1)
-- - hostname: 라즈베리파이 시스템 hostname (DB 저장본 — Pi 실제 값과 동기화)
-- - wifi_ssid: 현재 적용된 Wi-Fi SSID (PW는 보안상 미저장)
-- - server_ip: Pi가 사용하는 MQTT/tunnel 서버 IP (개발 172.30.1.42 ↔ 프로덕션 175.206.245.234 전환 추적)
-- - machine_id: /etc/machine-id (Pi 양산 시 hostname 충돌 회피용 unique key)
-- - last_config_applied_at: 마지막 원격 설정 적용 성공 시각
-- tunnel_public_key 컬럼은 이전 마이그레이션(005~012 어딘가)에서 이미 추가됨 — 재추가 방지

ALTER TABLE gateways
  ADD COLUMN IF NOT EXISTS hostname VARCHAR(63),
  ADD COLUMN IF NOT EXISTS wifi_ssid VARCHAR(100),
  ADD COLUMN IF NOT EXISTS server_ip VARCHAR(255),
  ADD COLUMN IF NOT EXISTS machine_id VARCHAR(64),
  ADD COLUMN IF NOT EXISTS last_config_applied_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_gateways_machine_id ON gateways(machine_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_gateways_hostname
  ON gateways(hostname) WHERE hostname IS NOT NULL;
