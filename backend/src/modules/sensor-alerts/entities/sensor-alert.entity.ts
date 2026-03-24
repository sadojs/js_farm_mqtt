import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('sensor_alerts')
export class SensorAlert {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'device_id', type: 'uuid' })
  deviceId: string;

  @Column({ name: 'device_name', nullable: true })
  deviceName: string;

  @Column({ name: 'sensor_type' })
  sensorType: string;

  @Column({ name: 'alert_type' })
  alertType: 'no_data' | 'flatline' | 'spike' | 'out_of_range' | 'unstable';

  @Column()
  severity: 'warning' | 'critical';

  @Column({ type: 'text' })
  message: string;

  @Column({ type: 'decimal', precision: 10, scale: 4, nullable: true })
  value: number;

  @Column({ type: 'text', nullable: true })
  threshold: string;

  @Column({ default: false })
  resolved: boolean;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt: Date;

  @Column({ name: 'snoozed_until', type: 'timestamptz', nullable: true })
  snoozedUntil: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
