import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('env_mappings')
export class EnvMapping {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'group_id', type: 'uuid' })
  groupId: string;

  @Column({ name: 'role_key' })
  roleKey: string;

  @Column({ name: 'source_type', type: 'varchar' })
  sourceType: 'sensor' | 'weather';

  @Column({ name: 'device_id', type: 'uuid', nullable: true })
  deviceId: string | null;

  @Column({ name: 'sensor_type', type: 'varchar', nullable: true })
  sensorType: string | null;

  @Column({ name: 'weather_field', type: 'varchar', nullable: true })
  weatherField: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
