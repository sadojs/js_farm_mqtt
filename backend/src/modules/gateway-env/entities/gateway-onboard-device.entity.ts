import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn,
} from 'typeorm';

export type SlotType =
  | 'opener_open' | 'opener_close' | 'fan'
  | 'irrigation_zone' | 'irrigation_group' | 'remote_control'
  | 'fertilizer_contact' | 'mixer' | 'fertilizer_motor'
  | 'vent_group' | 'rain_sensor';

@Entity('gateway_onboard_devices')
export class GatewayOnboardDevice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'gateway_id', type: 'uuid' })
  gatewayId: string;

  @Column({ name: 'slot_key', type: 'varchar' })
  slotKey: string;

  @Column({ name: 'slot_type', type: 'varchar' })
  slotType: SlotType;

  @Column({ name: 'pair_key', nullable: true, type: 'varchar' })
  pairKey: string | null;

  @Column()
  name: string;

  @Column({ default: true })
  enabled: boolean;

  @Column({ name: 'sort_order', default: 0 })
  sortOrder: number;

  @Column({ name: 'operation_time', nullable: true, type: 'int' })
  operationTime: number | null;

  @Column({ name: 'standby_time', nullable: true, type: 'int' })
  standbyTime: number | null;

  @Column({ name: 'gpio_pin', nullable: true, type: 'int' })
  gpioPin: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
