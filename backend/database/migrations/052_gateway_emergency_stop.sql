-- 052: 비상 정지 유지(래치) 상태
-- 비상 정지 시 해제 전까지 해당 게이트웨이의 모든 릴레이 ON 명령을 서버·Pi 양쪽에서 차단한다.
-- { active, stoppedAt, stoppedBy, stoppedByName, reason, releasedAt, releasedBy, piConfirmedAt, piActive }
-- idempotent — 재적용 안전
ALTER TABLE gateways ADD COLUMN IF NOT EXISTS emergency_stop JSONB;
