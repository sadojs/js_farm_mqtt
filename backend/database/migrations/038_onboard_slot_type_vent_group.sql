-- Migration 038: gateway_onboard_devices.slot_type CHECK 제약에 vent_group / irrigation_group 추가
-- 배경: 엔티티(SlotType)에 'vent_group'(개폐기 그룹), 'irrigation_group'(관수 그룹)이 추가됐으나
--       012에서 정의한 CHECK 제약이 갱신되지 않아 온보드 개폐기 추가 시 500(제약 위반) 발생.
-- forward-only, idempotent.

ALTER TABLE gateway_onboard_devices
  DROP CONSTRAINT IF EXISTS gateway_onboard_devices_slot_type_check;

ALTER TABLE gateway_onboard_devices
  ADD CONSTRAINT gateway_onboard_devices_slot_type_check
  CHECK (slot_type IN (
    'opener_open', 'opener_close', 'fan',
    'irrigation_zone', 'irrigation_group', 'remote_control',
    'fertilizer_contact', 'mixer', 'fertilizer_motor',
    'vent_group'
  ));
