import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn,
} from 'typeorm';

@Entity('devices')
export class Device {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id'  })
  userId: string;

  @Column({ name: 'house_id', nullable: true   })
  houseId: string;

  @Column({ name: 'gateway_id', nullable: true   })
  gatewayId: string;

  @Column({ name: 'zigbee_ieee', nullable: true, type: 'varchar' })
  zigbeeIeee: string | null;

  @Column({ name: 'friendly_name', nullable: true })
  friendlyName: string;

  @Column({ name: 'zigbee_model', nullable: true })
  zigbeeModel: string;

  @Column()
  name: string;

  @Column()
  category: string;

  @Column({ name: 'device_type' })
  deviceType: 'sensor' | 'actuator' | 'group';

  @Column({ name: 'equipment_type', nullable: true })
  equipmentType: 'fan' | 'irrigation' | 'opener_open' | 'opener_close' | 'mixer'
    | 'fertilizer_motor' | 'fertilizer_contact' | 'remote_control'
    | 'vent_group' | 'irrigation_group' | 'controller' | 'rain' | 'other';

  @Column({ nullable: true })
  icon: string;

  @Column({ name: 'paired_device_id', nullable: true   })
  pairedDeviceId: string;

  @Column({ name: 'opener_group_name', nullable: true })
  openerGroupName: string;

  @Column({ default: false })
  online: boolean;

  @Column({ default: true })
  enabled: boolean;

  @Column({ name: 'channel_mapping', type: 'jsonb', nullable: true })
  channelMapping: Record<string, string> | null;

  @Column({ default: 'zigbee' })
  source: 'zigbee' | 'onboard';

  @Column({ name: 'onboard_device_id', nullable: true, type: 'uuid' })
  onboardDeviceId: string | null;

  /** Zigbee 다채널 컨트롤러의 child일 때 parent device.id (자동제어 타겟은 child) */
  @Column({ name: 'parent_device_id', nullable: true, type: 'uuid' })
  parentDeviceId: string | null;

  /** child의 z2m payload 키 (switch_1~switch_12). TS0601은 자동으로 state_lN으로 변환 */
  @Column({ name: 'channel_code', nullable: true, type: 'varchar', length: 32 })
  channelCode: string | null;

  @Column({ name: 'device_settings', type: 'jsonb', nullable: true })
  deviceSettings: Record<string, any> | null;

  @Column({ name: 'last_seen', nullable: true })
  lastSeen: Date;

  /** 구역관리 화면 카드 정렬 순서 (같은 구역+섹션 내). 드래그 정렬로 갱신. */
  @Column({ name: 'display_order', type: 'int', default: 0 })
  displayOrder: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
