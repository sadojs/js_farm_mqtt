import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/** 일자별 조정 — 휴일(무급) 또는 잔업·조퇴(기본시간 대비 ±시간, 0.5 단위) */
@Entity('payroll_day_overrides')
@Index(['workerId', 'date'], { unique: true })
export class WorkerDayOverride {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'worker_id', type: 'uuid' })
  workerId: string;

  @Column({ name: 'date', type: 'date' })
  date: string;

  /** 휴일 처리(무급) */
  @Column({ name: 'holiday', default: false })
  holiday: boolean;

  /** 기본시간 대비 가감(시간). 잔업 +2, 조퇴 -1.5 등 */
  @Column({ name: 'delta_hours', type: 'decimal', precision: 4, scale: 1, default: 0 })
  deltaHours: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
