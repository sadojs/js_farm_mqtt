import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn,
} from 'typeorm';

@Entity('devices')
export class Device {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  userId: string;

  @Column({ name: 'house_id', nullable: true })
  houseId: string;

  @Column({ name: 'tuya_device_id' })
  tuyaDeviceId: string;

  @Column()
  name: string;

  @Column()
  category: string;

  @Column({ name: 'device_type' })
  deviceType: 'sensor' | 'actuator';

  @Column({ name: 'equipment_type', nullable: true })
  equipmentType: 'fan' | 'irrigation' | 'opener_open' | 'opener_close' | 'other';

  @Column({ nullable: true })
  icon: string;

  @Column({ name: 'paired_device_id', nullable: true })
  pairedDeviceId: string;

  @Column({ name: 'opener_group_name', nullable: true })
  openerGroupName: string;

  @Column({ default: false })
  online: boolean;

  @Column({ name: 'last_seen', nullable: true })
  lastSeen: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
