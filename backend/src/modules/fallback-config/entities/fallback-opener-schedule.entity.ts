import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type OpenerScheduleMode = 'time' | 'always-open';

@Entity('fallback_opener_schedule')
@Index(['gatewayId', 'month'], { unique: true })
export class FallbackOpenerSchedule {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'gateway_id', type: 'varchar', length: 50 })
  gatewayId!: string;

  @Column({ type: 'smallint' })
  month!: number; // 1~12

  @Column({ type: 'boolean', default: false })
  enabled!: boolean;

  @Column({ type: 'varchar', length: 20, default: 'time' })
  mode!: OpenerScheduleMode;

  @Column({ name: 'open_time', type: 'time', nullable: true })
  openTime!: string | null; // 'HH:mm'

  @Column({ name: 'close_time', type: 'time', nullable: true })
  closeTime!: string | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
