/**
 * rpi-auto-device-provision
 * onboard slot_type → devices 표준 매핑.
 * 신규 게이트웨이 양산 시 onboard slots 12개를 devices 8개(group 2개 제외)로 자동 INSERT.
 */
import type { SlotType } from './entities/gateway-onboard-device.entity';

export interface DeviceTemplate {
  category: string;
  deviceType: string;
  equipmentType: string;
  /** false면 device로 등록 안 함 (group 컨테이너 등) */
  provisionable: boolean;
}

export const ONBOARD_TO_DEVICE: Record<SlotType, DeviceTemplate> = {
  fan: { category: 'fan', deviceType: 'actuator', equipmentType: 'fan', provisionable: true },
  irrigation_zone: { category: 'irrigation', deviceType: 'actuator', equipmentType: 'irrigation', provisionable: true },
  mixer: { category: 'irrigation', deviceType: 'actuator', equipmentType: 'mixer', provisionable: true },
  fertilizer_motor: { category: 'irrigation', deviceType: 'actuator', equipmentType: 'fertilizer_motor', provisionable: true },
  fertilizer_contact: { category: 'irrigation', deviceType: 'actuator', equipmentType: 'fertilizer_contact', provisionable: true },
  remote_control: { category: 'control', deviceType: 'actuator', equipmentType: 'remote_control', provisionable: true },
  opener_open: { category: 'opener', deviceType: 'actuator', equipmentType: 'opener_open', provisionable: true },
  opener_close: { category: 'opener', deviceType: 'actuator', equipmentType: 'opener_close', provisionable: true },
  vent_group: { category: 'opener', deviceType: 'group', equipmentType: 'vent_group', provisionable: false },
  irrigation_group: { category: 'irrigation', deviceType: 'group', equipmentType: 'irrigation_group', provisionable: false },
  // 무전압 접점 우적센서 (온보드 GPIO21 직결) — 기존 Zigbee 우적 파이프라인 재사용
  rain_sensor: { category: 'sensor', deviceType: 'sensor', equipmentType: 'rain', provisionable: true },
};
