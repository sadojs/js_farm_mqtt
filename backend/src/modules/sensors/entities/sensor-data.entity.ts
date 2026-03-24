import { Entity, Column, PrimaryColumn } from 'typeorm';

@Entity('sensor_data')
export class SensorData {
  @PrimaryColumn({ type: 'timestamptz' })
  time: Date;

  @Column({ name: 'device_id', type: 'uuid' })
  deviceId: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'sensor_type' })
  sensorType: string;

  @Column({ type: 'decimal', precision: 10, scale: 4 })
  value: number;

  @Column()
  unit: string;

  @Column({ default: 'normal' })
  status: 'normal' | 'warning' | 'critical';

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any>;
}
