import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('sensor_standby')
export class SensorStandby {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'device_id', type: 'uuid' })
  deviceId: string;

  @Column({ name: 'sensor_type' })
  sensorType: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
